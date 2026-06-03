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
    if !dir.is_absolute() {
        return Err(format!("asset dir must be an absolute path: {}", path));
    }
    app.asset_protocol_scope()
        .allow_directory(dir, true)
        .map_err(|e| format!("Failed to allow asset dir '{}': {}", path, e))
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
