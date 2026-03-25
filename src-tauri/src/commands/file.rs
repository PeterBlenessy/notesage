use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize, Deserialize, Clone)]
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

    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(dir_path).map_err(|e| format!("Failed to read directory {}: {e}", path))?;

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
    if Path::new(&new_path).exists() {
        return Err(format!("Destination already exists: {}", new_path));
    }

    fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to rename {} to {}: {}", old_path, new_path, e))
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
    let src = Path::new(&source);
    if !src.exists() {
        return Err(format!("Source file does not exist: {}", source));
    }
    if !src.is_file() {
        return Err(format!("Source is not a file: {}", source));
    }
    // Ensure destination parent directory exists
    if let Some(parent) = Path::new(&destination).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directory {}: {e}", parent.display()))?;
        }
    }
    fs::copy(&source, &destination)
        .map(|_| ())
        .map_err(|e| format!("Failed to copy file {} → {}: {e}", source, destination))
}

#[tauri::command]
pub async fn copy_directory(source: String, destination: String) -> Result<(), String> {
    let src = Path::new(&source);
    if !src.exists() {
        return Err(format!("Source directory does not exist: {}", source));
    }
    if !src.is_dir() {
        return Err(format!("Source is not a directory: {}", source));
    }
    if Path::new(&destination).exists() {
        return Err(format!("Destination already exists: {}", destination));
    }
    copy_dir_recursive(src, Path::new(&destination))
        .map_err(|e| format!("Failed to copy directory {} → {}: {e}", source, destination))
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
