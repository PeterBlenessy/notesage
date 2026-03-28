use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<FileEntry>>,
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

#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    list_directory_recursive(&path, 0).await
}

async fn list_directory_recursive(path: &str, depth: usize) -> Result<Vec<FileEntry>, String> {
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

        // Skip hidden files (starting with .)
        if file_name.starts_with('.') {
            continue;
        }

        let is_directory = entry_path.is_dir();
        let path_str = entry_path.to_string_lossy().to_string();

        let children = if is_directory && depth < MAX_DIRECTORY_DEPTH {
            match Box::pin(list_directory_recursive(&path_str, depth + 1)).await {
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
            children,
        });
    }

    // Sort: directories first, then alphabetically
    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

/// List only files (not directories) at the top level of a directory.
/// No recursive descent — much faster than list_directory for flat file listings.
#[tauri::command]
pub async fn list_files_shallow(path: String) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);

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

        // Skip hidden files and directories
        if file_name.starts_with('.') {
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
            children: None,
        });
    }

    // Sort alphabetically
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[tokio::test]
    async fn list_files_shallow_returns_error_for_nonexistent_path() {
        let result = list_files_shallow("/nonexistent/path/abc123".to_string()).await;
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
}
