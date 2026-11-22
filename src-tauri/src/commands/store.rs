use std::path::{Path, PathBuf};

/// Read one state file, keeping "there is no file" (`Ok(None)`) apart from
/// "there is a file and it could not be read" (`Err`).
///
/// The difference matters: the frontend treats `None` as a fresh store and
/// will later write its defaults back. If a failed read looked the same, one
/// transient error (permissions, I/O, a corrupt file) would be followed by
/// the real file being overwritten with an empty store.
///
/// Only `NotFound` counts as missing. `Path::exists()` is not used because it
/// also answers `false` when the file is there but cannot be stat'ed.
fn read_state_file(path: &Path, key: &str) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read state file '{}': {}", key, e)),
    }
}

/// Read every `(key, path)` pair. Missing files are omitted from the map; a
/// file that exists but cannot be read fails the whole batch, naming each
/// such key, so the caller can never mistake it for a missing one.
fn read_state_files(
    files: Vec<(String, PathBuf)>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut results = std::collections::HashMap::new();
    let mut errors: Vec<String> = Vec::new();
    for (key, path) in files {
        match read_state_file(&path, &key) {
            Ok(Some(content)) => {
                results.insert(key, content);
            }
            Ok(None) => {}
            Err(e) => {
                log::warn!(target: "notesage::store", "store_read_batch: {}", e);
                errors.push(e);
            }
        }
    }
    if errors.is_empty() {
        Ok(results)
    } else {
        Err(errors.join("; "))
    }
}

/// Read a state file. Returns None if the file doesn't exist, and an error if
/// it exists but cannot be read.
#[tauri::command]
pub fn store_read(key: String) -> Result<Option<String>, String> {
    let path = state_file_path(&key)?;
    read_state_file(&path, &key)
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
///
/// If any file exists but cannot be read the whole call fails (it used to
/// omit that key, which made a failed read indistinguishable from "no file
/// yet"). The frontend then re-reads each key with `store_read` to find out
/// which keys failed and which are fine.
/// Uses sync I/O — these are tiny files (<50KB total) and sync avoids
/// tokio thread pool scheduling overhead that adds ~100ms per file.
#[tauri::command]
pub fn store_read_batch(keys: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
    let start = std::time::Instant::now();
    let mut files = Vec::with_capacity(keys.len());
    for key in keys {
        let path = state_file_path(&key)?;
        files.push((key, path));
    }
    let results = read_state_files(files)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn file(dir: &Path, key: &str) -> (String, PathBuf) {
        (key.to_string(), dir.join(format!("{}.json", key)))
    }

    #[test]
    fn missing_file_reads_as_none_not_as_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let (key, path) = file(dir.path(), "absent");
        assert_eq!(read_state_file(&path, &key), Ok(None));
    }

    #[test]
    fn existing_file_reads_its_content() {
        let dir = tempfile::tempdir().unwrap();
        let (key, path) = file(dir.path(), "chat");
        std::fs::write(&path, "{\"state\":{}}").unwrap();
        assert_eq!(
            read_state_file(&path, &key),
            Ok(Some("{\"state\":{}}".to_string()))
        );
    }

    #[test]
    fn unreadable_file_is_an_error_not_none() {
        let dir = tempfile::tempdir().unwrap();
        // Not valid UTF-8: the file is there, but `read_to_string` fails.
        let (key, path) = file(dir.path(), "corrupt");
        std::fs::write(&path, [0xFF, 0xFE, 0x00, 0xC3]).unwrap();
        let err = read_state_file(&path, &key).unwrap_err();
        assert!(err.contains("corrupt"), "error should name the key: {}", err);

        // A directory where the file should be: also "exists but unreadable".
        let (key, path) = file(dir.path(), "is-a-dir");
        std::fs::create_dir(&path).unwrap();
        assert!(read_state_file(&path, &key).is_err());
    }

    #[test]
    fn batch_omits_missing_keys() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.json"), "A").unwrap();
        let result =
            read_state_files(vec![file(dir.path(), "a"), file(dir.path(), "absent")]).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result.get("a").map(String::as_str), Some("A"));
    }

    /// The regression: a failed read used to be dropped from the map, so the
    /// frontend saw "no file", hydrated an empty store and overwrote the file.
    #[test]
    fn batch_fails_when_a_file_exists_but_cannot_be_read() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("good.json"), "ok").unwrap();
        std::fs::write(dir.path().join("bad.json"), [0xFF, 0xFE]).unwrap();
        let err = read_state_files(vec![
            file(dir.path(), "good"),
            file(dir.path(), "bad"),
            file(dir.path(), "absent"),
        ])
        .unwrap_err();
        assert!(err.contains("'bad'"), "error should name the failed key: {}", err);
        assert!(!err.contains("'good'"));
        assert!(!err.contains("'absent'"));
    }
}
