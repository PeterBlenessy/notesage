use std::path::PathBuf;

/// Read a state file. Returns None if the file doesn't exist.
#[tauri::command]
pub fn store_read(key: String) -> Result<Option<String>, String> {
    let path = state_file_path(&key)?;

    if !path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read state file '{}': {}", key, e))?;

    Ok(Some(content))
}

/// Write a state file atomically (write to .tmp, then rename).
#[tauri::command]
pub async fn store_write(key: String, value: String) -> Result<(), String> {
    let path = state_file_path(&key)?;
    let size = value.len();

    // Ensure the directory exists
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create state directory: {}", e))?;
    }

    // Atomic write: write to .tmp file, then rename
    let tmp_path = path.with_extension("json.tmp");
    tokio::fs::write(&tmp_path, &value)
        .await
        .map_err(|e| format!("Failed to write temp state file '{}': {}", key, e))?;

    tokio::fs::rename(&tmp_path, &path)
        .await
        .map_err(|e| format!("Failed to rename state file '{}': {}", key, e))?;

    log::debug!(target: "notesage::store", "store_write: '{}' ({} bytes)", key, size);
    Ok(())
}

/// Read multiple state files in a single call. Returns a map of key → value.
/// Keys that don't exist are omitted from the result.
/// Uses sync I/O — these are tiny files (<50KB total) and sync avoids
/// tokio thread pool scheduling overhead that adds ~100ms per file.
#[tauri::command]
pub fn store_read_batch(keys: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
    let start = std::time::Instant::now();
    let mut results = std::collections::HashMap::new();
    for key in keys {
        let path = state_file_path(&key)?;
        if path.exists() {
            match std::fs::read_to_string(&path) {
                Ok(content) => {
                    results.insert(key, content);
                }
                Err(e) => {
                    log::warn!(target: "notesage::store", "store_read_batch: failed to read '{}': {}", key, e);
                }
            }
        }
    }
    log::info!(target: "notesage::store", "store_read_batch: loaded {} stores in {:?}", results.len(), start.elapsed());
    Ok(results)
}

/// Delete a state file.
#[tauri::command]
pub async fn store_delete(key: String) -> Result<(), String> {
    let path = state_file_path(&key)?;

    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| format!("Failed to delete state file '{}': {}", key, e))?;
        log::info!(target: "notesage::store", "store_delete: '{}'", key);
    }

    Ok(())
}

/// Resolve the state file path: ~/.notesage/state/{key}.json
fn state_file_path(key: &str) -> Result<PathBuf, String> {
    // Sanitize key to prevent path traversal
    if key.contains('/') || key.contains('\\') || key.contains("..") {
        return Err(format!("Invalid state key: '{}'", key));
    }

    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    Ok(home.join(".notesage").join("state").join(format!("{}.json", key)))
}
