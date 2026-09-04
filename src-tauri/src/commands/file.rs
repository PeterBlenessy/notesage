use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<FileEntry>>,
    pub hidden: bool,
    /// Files-app-style row metadata (seconds since 1970). Populated by the
    /// iOS library listing (#588) and by the desktop's shallow listing (the
    /// Inbox groups by it); absent on the recursive desktop listing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified: Option<f64>,
    /// Number of visible children, for DIRECTORIES only. Populated by the iOS
    /// library listing (#684) so folder rows can show a count without one IPC
    /// round trip per row; absent on every desktop path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub child_count: Option<u32>,
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file {}: {}", path, e))
}

#[tauri::command]
pub async fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Failed to read file {}: {}", path, e))
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("Failed to write file {}: {}", path, e))
}

const MAX_DIRECTORY_DEPTH: usize = 50;

/// Subdirectories of `.git/` that are always excluded even when `show_hidden` is true,
/// to prevent performance degradation from thousands of pack/object files.
const GIT_ALWAYS_HIDDEN_CHILDREN: &[&str] = &["objects", "pack", "logs"];

#[tauri::command]
pub async fn list_directory(path: String, show_hidden: Option<bool>) -> Result<Vec<FileEntry>, String> {
    list_directory_recursive(&path, 0, show_hidden.unwrap_or(false), false).await
}

async fn list_directory_recursive(
    path: &str,
    depth: usize,
    show_hidden: bool,
    inside_git: bool,
) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(path);

    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(dir_path)
        .map_err(|e| format!("Failed to read directory {}: {}", path, e))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry in {}: {}", path, e))?;
        let entry_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        let is_hidden = file_name.starts_with('.');

        // Always exclude .DS_Store
        if file_name == ".DS_Store" {
            continue;
        }

        // Skip hidden files unless show_hidden is enabled
        if is_hidden && !show_hidden {
            continue;
        }

        // Inside .git/, exclude bulk subdirectories (objects, pack, logs)
        if inside_git && GIT_ALWAYS_HIDDEN_CHILDREN.contains(&file_name.as_str()) {
            continue;
        }

        let is_directory = entry_path.is_dir();
        let path_str = entry_path.to_string_lossy().to_string();

        let child_inside_git = inside_git || (is_hidden && file_name == ".git");

        let children = if is_directory && depth < MAX_DIRECTORY_DEPTH {
            match Box::pin(list_directory_recursive(&path_str, depth + 1, show_hidden, child_inside_git)).await {
                Ok(children) => Some(children),
                Err(e) => {
                    log::warn!(target: "notesage::file", "Skipping unreadable directory {}: {}", path_str, e);
                    Some(Vec::new())
                }
            }
        } else if is_directory {
            // Depth limit reached — return empty children
            Some(Vec::new())
        } else {
            None
        };

        entries.push(FileEntry {
            name: file_name,
            path: path_str,
            is_directory,
            hidden: is_hidden,
            children,
            modified: None,
            child_count: None,
        });
    }

    // Sort: directories first, then hidden last within each group, then alphabetically
    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => match (a.hidden, b.hidden) {
                (false, true) => std::cmp::Ordering::Less,
                (true, false) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            },
        }
    });

    Ok(entries)
}

/// List only files (not directories) at the top level of a directory.
/// No recursive descent — much faster than list_directory for flat file listings.
#[tauri::command]
pub async fn list_files_shallow(path: String, show_hidden: Option<bool>) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);
    let show_hidden = show_hidden.unwrap_or(false);

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(dir_path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => format!("Path does not exist: {}", path),
        std::io::ErrorKind::NotADirectory => format!("Path is not a directory: {}", path),
        _ => format!("Failed to read directory {}: {}", path, e),
    })?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry in {}: {e}", path))?;
        let entry_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        let is_hidden = file_name.starts_with('.');

        // Always exclude .DS_Store
        if file_name == ".DS_Store" {
            continue;
        }

        // Skip hidden files unless show_hidden is enabled
        if is_hidden && !show_hidden {
            continue;
        }

        // Skip directories entirely
        if entry_path.is_dir() {
            continue;
        }

        entries.push(FileEntry {
            name: file_name,
            path: entry_path.to_string_lossy().to_string(),
            is_directory: false,
            hidden: is_hidden,
            children: None,
            // The desktop Inbox groups its rows by date (Today · Yesterday · …)
            // and keys its header cache on the mtime, so the shallow listing
            // carries it. One `stat` per entry; the recursive listing still
            // leaves it out — a tree of thousands of files would pay for a
            // field nothing there reads.
            modified: entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as f64),
            child_count: None,
        });
    }

    // Sort: hidden last, then alphabetically
    entries.sort_by(|a, b| {
        match (a.hidden, b.hidden) {
            (false, true) => std::cmp::Ordering::Less,
            (true, false) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

#[tauri::command]
pub async fn create_file(path: String) -> Result<(), String> {
    fs::write(&path, "").map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!("File already exists: {}", path),
        _ => format!("Failed to create file {}: {}", path, e),
    })
}

#[tauri::command]
pub async fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory {}: {}", path, e))
}

#[tauri::command]
pub async fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    // Avoid TOCTOU: instead of checking exists() then renaming, use hard_link which
    // atomically fails if the destination already exists. Fall back to rename for
    // cross-device moves (hard_link doesn't work across filesystems).
    match fs::hard_link(&old_path, &new_path) {
        Ok(()) => {
            // Link created — remove the original
            fs::remove_file(&old_path).map_err(|e| {
                // Clean up the new link on failure
                let _ = fs::remove_file(&new_path);
                format!("Failed to remove original {}: {}", old_path, e)
            })?;
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(format!("Destination already exists: {}", new_path))
        }
        Err(e) if e.kind() == std::io::ErrorKind::CrossesDevices
            || e.raw_os_error() == Some(18) /* EXDEV */ =>
        {
            // Cross-device: hard_link won't work. Check destination via metadata,
            // then rename (which will move across devices on some systems).
            if Path::new(&new_path).exists() {
                return Err(format!("Destination already exists: {}", new_path));
            }
            fs::rename(&old_path, &new_path)
                .map_err(|e| format!("Failed to rename {} to {}: {}", old_path, new_path, e))
        }
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied
            && Path::new(&old_path).is_dir() =>
        {
            // Directories can't be hard-linked. For directories, the exists() check
            // is acceptable since rename won't overwrite a non-empty directory anyway.
            if Path::new(&new_path).exists() {
                return Err(format!("Destination already exists: {}", new_path));
            }
            fs::rename(&old_path, &new_path)
                .map_err(|e| format!("Failed to rename {} to {}: {}", old_path, new_path, e))
        }
        Err(e) => Err(format!("Failed to rename {} to {}: {}", old_path, new_path, e)),
    }
}

/// Move a file or folder to the Trash — recoverable, where `delete_path` is
/// not. The Inbox uses this: throwing away a read-later item should be as
/// safe as it is in Mail. Desktop-only, like the `trash` crate behind it.
#[cfg(not(target_os = "ios"))]
#[tauri::command]
pub async fn trash_path(path: String) -> Result<(), String> {
    // Finder does the work on macOS, and the Inbox usually sits on an iCloud
    // volume — off the async runtime, like the other slow file paths.
    tokio::task::spawn_blocking(move || {
        trash::delete(&path).map_err(|e| format!("Failed to move {path} to the Trash: {e}"))
    })
    .await
    .map_err(|e| format!("Trash task failed: {e}"))?
}

#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);

    if file_path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete directory {}: {}", path, e))
    } else {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete file {}: {}", path, e))
    }
}

#[tauri::command]
pub async fn path_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
pub async fn copy_file(source: String, destination: String) -> Result<(), String> {
    // Ensure destination parent directory exists (create_dir_all is a no-op if it exists)
    if let Some(parent) = Path::new(&destination).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory {}: {}", parent.display(), e))?;
    }
    fs::copy(&source, &destination)
        .map(|_| ())
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => format!("Source file does not exist: {}", source),
            _ => format!("Failed to copy file {} → {}: {}", source, destination, e),
        })
}

#[tauri::command]
pub async fn copy_directory(source: String, destination: String) -> Result<(), String> {
    let src = Path::new(&source);
    let dst = Path::new(&destination);
    // Use create_dir (not create_dir_all) so it fails with AlreadyExists if destination exists
    fs::create_dir(dst).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!("Destination already exists: {}", destination),
        _ => format!("Failed to create destination directory {}: {}", destination, e),
    })?;
    copy_dir_recursive(src, dst).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => format!("Source directory does not exist: {}", source),
        std::io::ErrorKind::NotADirectory => format!("Source is not a directory: {}", source),
        _ => format!("Failed to copy directory {} → {}: {}", source, destination, e),
    })
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let entry_type = entry.file_type()?;
        let dest_path = dst.join(entry.file_name());
        if entry_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}

#[tauri::command]
pub async fn reveal_in_finder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("Failed to reveal {}: {e}", path))
}

/// Grant the WebView asset-protocol read access to a user-opened workspace root.
///
/// Replaces the old blanket `$HOME/**` static asset scope (audit security H1).
/// The static scope in `tauri.conf.json` now covers only the app's own dirs
/// (`$APPDATA`, `$APPCACHE`, `$RESOURCE`, `$TEMP`, ...); every *user content*
/// root — the Notesage library, opened projects, explorer folders — is granted
/// here at runtime as it is opened (see `useStartWatchers`). Net effect:
/// agent-authored markdown can no longer point an `<img>` at `~/.ssh/id_rsa`
/// (or any home-dir file outside an opened root) and have the WebView fetch it
/// through the `asset:` protocol — the asset reads are NOT covered by the agent
/// Seatbelt profile, which only constrains the agent subprocess.
///
/// Idempotent and recursive: re-granting an already-allowed directory is a
/// no-op (mirrors the watcher's dedup), and nested images / drawing SVGs /
/// viewer files under the root resolve.
#[tauri::command]
pub fn allow_asset_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = Path::new(&path);
    let home = dirs::home_dir();
    validate_asset_dir(dir, home.as_deref())?;
    app.asset_protocol_scope()
        .allow_directory(dir, true)
        .map_err(|e| format!("Failed to allow asset dir '{}': {}", path, e))
}

/// Guard `allow_asset_dir` against re-opening the H1 exfil surface at runtime
/// (security audit MEDIUM). The static `tauri.conf.json` scope is locked down
/// and regression-tested, but `allow_asset_dir` widens the asset-protocol scope
/// at runtime — an unvalidated grant of `/` or `$HOME` would make every file
/// (`.ssh`, `.aws`, browser profiles, sibling projects) `convertFileSrc`-able
/// again. Legitimate callers only ever grant a *content root* (an opened
/// project, the Notesage library, an explorer folder), so we reject:
///   - relative paths and paths containing `..` traversal components
///   - the filesystem root and any ancestor of `$HOME` (incl. `$HOME` itself)
///   - known-sensitive subtrees under `$HOME` (`.ssh`, `.aws`, `.gnupg`,
///     `.config/gcloud`, `Library/Keychains`)
fn validate_asset_dir(dir: &Path, home: Option<&Path>) -> Result<(), String> {
    if !dir.is_absolute() {
        return Err(format!("asset dir must be an absolute path: {}", dir.display()));
    }
    if dir
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(format!("asset dir must not contain '..': {}", dir.display()));
    }
    // Reject the filesystem root outright.
    if dir.parent().is_none() {
        return Err("Refusing to grant the filesystem root as an asset dir".to_string());
    }

    if let Some(home) = home {
        // Reject $HOME itself and any ANCESTOR of $HOME (`/`, `/Users`,
        // `/Users/<me>`) — granting those exposes the whole home dir.
        if home.starts_with(dir) {
            return Err(format!(
                "Refusing to grant '{}' as an asset dir — it is the home directory or an ancestor of it",
                dir.display()
            ));
        }
        // Reject known-sensitive subtrees under $HOME.
        for sensitive in [
            ".ssh",
            ".aws",
            ".gnupg",
            ".config/gcloud",
            "Library/Keychains",
        ] {
            if dir.starts_with(home.join(sensitive)) {
                return Err(format!(
                    "Refusing to grant '{}' as an asset dir — it is a sensitive directory",
                    dir.display()
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[tokio::test]
    async fn list_files_shallow_returns_error_for_nonexistent_path() {
        let result = list_files_shallow("/nonexistent/path/abc123".to_string(), None).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("/nonexistent/path/abc123"), "Error should contain the path: {}", err);
    }

    // --- validate_asset_dir (security audit MEDIUM) ---

    #[test]
    fn validate_asset_dir_allows_content_roots() {
        let home = Path::new("/Users/me");
        // Opened project / library / explorer-folder roots are fine.
        assert!(validate_asset_dir(Path::new("/Users/me/Notesage/projectA"), Some(home)).is_ok());
        assert!(validate_asset_dir(Path::new("/Users/me/Documents/notes"), Some(home)).is_ok());
        assert!(validate_asset_dir(Path::new("/Volumes/ext/stuff"), Some(home)).is_ok());
    }

    #[test]
    fn validate_asset_dir_rejects_home_and_ancestors() {
        let home = Path::new("/Users/me");
        assert!(validate_asset_dir(Path::new("/"), Some(home)).is_err());
        assert!(validate_asset_dir(Path::new("/Users"), Some(home)).is_err());
        assert!(validate_asset_dir(Path::new("/Users/me"), Some(home)).is_err());
    }

    #[test]
    fn validate_asset_dir_rejects_sensitive_subtrees() {
        let home = Path::new("/Users/me");
        for sensitive in [
            "/Users/me/.ssh",
            "/Users/me/.ssh/keys",
            "/Users/me/.aws",
            "/Users/me/.gnupg",
            "/Users/me/.config/gcloud",
            "/Users/me/Library/Keychains",
        ] {
            assert!(
                validate_asset_dir(Path::new(sensitive), Some(home)).is_err(),
                "{} should be rejected",
                sensitive
            );
        }
    }

    #[test]
    fn validate_asset_dir_rejects_relative_and_traversal() {
        let home = Path::new("/Users/me");
        assert!(validate_asset_dir(Path::new("relative/path"), Some(home)).is_err());
        assert!(validate_asset_dir(Path::new("/Users/me/../../etc"), Some(home)).is_err());
    }

    #[tokio::test]
    async fn rename_path_rejects_when_destination_exists() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("source.txt");
        let dst = tmp.path().join("dest.txt");
        fs::write(&src, "source content").unwrap();
        fs::write(&dst, "dest content").unwrap();

        let result = rename_path(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
        ).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("already exists"), "Error should mention 'already exists': {}", err);
        // Verify destination was NOT overwritten
        assert_eq!(fs::read_to_string(&dst).unwrap(), "dest content");
    }

    #[tokio::test]
    async fn rename_path_succeeds_for_valid_rename() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("source.txt");
        let dst = tmp.path().join("renamed.txt");
        fs::write(&src, "hello").unwrap();

        let result = rename_path(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
        ).await;

        assert!(result.is_ok());
        assert!(!src.exists());
        assert_eq!(fs::read_to_string(&dst).unwrap(), "hello");
    }

    #[tokio::test]
    async fn rename_path_works_for_directories() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("srcdir");
        let dst = tmp.path().join("dstdir");
        fs::create_dir(&src).unwrap();
        fs::write(src.join("file.txt"), "content").unwrap();

        let result = rename_path(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
        ).await;

        assert!(result.is_ok());
        assert!(!src.exists());
        assert_eq!(fs::read_to_string(dst.join("file.txt")).unwrap(), "content");
    }

    #[tokio::test]
    async fn copy_directory_rejects_when_destination_exists() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        fs::create_dir(&src).unwrap();
        fs::create_dir(&dst).unwrap();

        let result = copy_directory(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
        ).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("already exists"), "Error should mention 'already exists': {}", err);
    }

    #[tokio::test]
    async fn copy_file_returns_error_for_nonexistent_source() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("nonexistent.txt");
        let dst = tmp.path().join("dest.txt");

        let result = copy_file(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
        ).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains(&src.to_string_lossy().to_string()), "Error should contain source path: {}", err);
    }

    #[tokio::test]
    async fn create_file_error_includes_path() {
        // Try to create a file in a nonexistent directory
        let result = create_file("/nonexistent/dir/file.txt".to_string()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("/nonexistent/dir/file.txt"), "Error should contain the path: {}", err);
    }

    // --- Hidden file visibility tests ---

    fn create_test_tree(tmp: &TempDir) {
        // Regular files/dirs
        fs::write(tmp.path().join("readme.md"), "hello").unwrap();
        fs::write(tmp.path().join("notes.txt"), "world").unwrap();
        fs::create_dir(tmp.path().join("docs")).unwrap();
        fs::write(tmp.path().join("docs/guide.md"), "guide").unwrap();

        // Hidden files/dirs
        fs::write(tmp.path().join(".gitignore"), "node_modules").unwrap();
        fs::write(tmp.path().join(".DS_Store"), "junk").unwrap();
        fs::create_dir_all(tmp.path().join(".git/objects")).unwrap();
        fs::create_dir_all(tmp.path().join(".git/pack")).unwrap();
        fs::create_dir_all(tmp.path().join(".git/logs")).unwrap();
        fs::create_dir_all(tmp.path().join(".git/refs")).unwrap();
        fs::write(tmp.path().join(".git/config"), "[core]").unwrap();
        fs::write(tmp.path().join(".git/HEAD"), "ref: refs/heads/main").unwrap();
        fs::create_dir(tmp.path().join(".notesage")).unwrap();
        fs::write(tmp.path().join(".notesage/project.json"), "{}").unwrap();
    }

    #[tokio::test]
    async fn list_directory_hides_dotfiles_by_default() {
        let tmp = TempDir::new().unwrap();
        create_test_tree(&tmp);

        let entries = list_directory(tmp.path().to_string_lossy().to_string(), None).await.unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

        assert!(names.contains(&"readme.md"));
        assert!(names.contains(&"notes.txt"));
        assert!(names.contains(&"docs"));
        assert!(!names.contains(&".gitignore"), "dotfiles should be hidden by default");
        assert!(!names.contains(&".git"), "dot-directories should be hidden by default");
        assert!(!names.contains(&".DS_Store"), ".DS_Store should always be hidden");
    }

    #[tokio::test]
    async fn list_directory_shows_dotfiles_when_enabled() {
        let tmp = TempDir::new().unwrap();
        create_test_tree(&tmp);

        let entries = list_directory(tmp.path().to_string_lossy().to_string(), Some(true)).await.unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

        assert!(names.contains(&"readme.md"));
        assert!(names.contains(&".gitignore"), "dotfiles should be visible when show_hidden=true");
        assert!(names.contains(&".git"), ".git dir should be visible");
        assert!(names.contains(&".notesage"), ".notesage dir should be visible");
        assert!(!names.contains(&".DS_Store"), ".DS_Store should always be excluded");
    }

    #[tokio::test]
    async fn list_directory_excludes_git_bulk_subdirs() {
        let tmp = TempDir::new().unwrap();
        create_test_tree(&tmp);

        let entries = list_directory(tmp.path().to_string_lossy().to_string(), Some(true)).await.unwrap();
        let git_entry = entries.iter().find(|e| e.name == ".git").unwrap();
        let git_children: Vec<&str> = git_entry.children.as_ref().unwrap().iter().map(|e| e.name.as_str()).collect();

        assert!(git_children.contains(&"config"), ".git/config should be visible");
        assert!(git_children.contains(&"HEAD"), ".git/HEAD should be visible");
        assert!(git_children.contains(&"refs"), ".git/refs should be visible");
        assert!(!git_children.contains(&"objects"), ".git/objects should be excluded");
        assert!(!git_children.contains(&"pack"), ".git/pack should be excluded");
        assert!(!git_children.contains(&"logs"), ".git/logs should be excluded");
    }

    #[tokio::test]
    async fn file_entry_hidden_flag_is_set_correctly() {
        let tmp = TempDir::new().unwrap();
        create_test_tree(&tmp);

        let entries = list_directory(tmp.path().to_string_lossy().to_string(), Some(true)).await.unwrap();

        for entry in &entries {
            if entry.name.starts_with('.') {
                assert!(entry.hidden, "{} should have hidden=true", entry.name);
            } else {
                assert!(!entry.hidden, "{} should have hidden=false", entry.name);
            }
        }
    }

    #[tokio::test]
    async fn hidden_entries_sorted_after_regular_entries() {
        let tmp = TempDir::new().unwrap();
        create_test_tree(&tmp);

        let entries = list_directory(tmp.path().to_string_lossy().to_string(), Some(true)).await.unwrap();

        // Find the boundary between regular and hidden entries (within each group: dirs then files)
        let dirs: Vec<&FileEntry> = entries.iter().filter(|e| e.is_directory).collect();
        let files: Vec<&FileEntry> = entries.iter().filter(|e| !e.is_directory).collect();

        // Within directories: regular dirs before hidden dirs
        let first_hidden_dir = dirs.iter().position(|e| e.hidden);
        if let Some(pos) = first_hidden_dir {
            for d in &dirs[..pos] {
                assert!(!d.hidden, "regular dirs should come before hidden dirs");
            }
            for d in &dirs[pos..] {
                assert!(d.hidden, "hidden dirs should come after regular dirs");
            }
        }

        // Within files: regular files before hidden files
        let first_hidden_file = files.iter().position(|e| e.hidden);
        if let Some(pos) = first_hidden_file {
            for f in &files[..pos] {
                assert!(!f.hidden, "regular files should come before hidden files");
            }
            for f in &files[pos..] {
                assert!(f.hidden, "hidden files should come after regular files");
            }
        }
    }

    #[tokio::test]
    async fn list_files_shallow_respects_show_hidden() {
        let tmp = TempDir::new().unwrap();
        create_test_tree(&tmp);

        // Default: no hidden files
        let entries = list_files_shallow(tmp.path().to_string_lossy().to_string(), None).await.unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"readme.md"));
        assert!(!names.contains(&".gitignore"));
        assert!(!names.contains(&".DS_Store"));

        // With show_hidden: includes dotfiles (except .DS_Store)
        let entries = list_files_shallow(tmp.path().to_string_lossy().to_string(), Some(true)).await.unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"readme.md"));
        assert!(names.contains(&".gitignore"));
        assert!(!names.contains(&".DS_Store"), ".DS_Store should always be excluded");
    }
}
