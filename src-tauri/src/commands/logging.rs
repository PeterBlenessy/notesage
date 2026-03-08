use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize)]
pub struct LogEntry {
    pub level: String,
    pub category: String,
    pub message: String,
    pub data: Option<serde_json::Value>,
    #[allow(dead_code)]
    pub timestamp: Option<f64>,
}

/// Receives batched log entries from the frontend and writes them to the backend log.
#[tauri::command]
pub fn log_frontend(entries: Vec<LogEntry>) -> Result<(), String> {
    for entry in entries {
        let target = format!("notesage::frontend::{}", entry.category);
        let data_str = entry
            .data
            .as_ref()
            .map(|d| format!(" {}", d))
            .unwrap_or_default();

        match entry.level.as_str() {
            "debug" => log::debug!(target: &target, "{}{}", entry.message, data_str),
            "info" => log::info!(target: &target, "{}{}", entry.message, data_str),
            "warn" => log::warn!(target: &target, "{}{}", entry.message, data_str),
            "error" => log::error!(target: &target, "{}{}", entry.message, data_str),
            _ => log::info!(target: &target, "{}{}", entry.message, data_str),
        }
    }
    Ok(())
}

/// Returns the path to the log directory.
#[tauri::command]
pub fn get_log_path() -> Result<String, String> {
    let log_dir = log_directory()?;
    Ok(log_dir.to_string_lossy().to_string())
}

/// Returns the total size of all log files in bytes.
#[tauri::command]
pub async fn get_log_size() -> Result<u64, String> {
    let log_dir = log_directory()?;
    let mut total: u64 = 0;

    if log_dir.exists() {
        let entries = std::fs::read_dir(&log_dir).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    total += metadata.len();
                }
            }
        }
    }

    Ok(total)
}

/// Deletes all log files.
#[tauri::command]
pub async fn clear_logs() -> Result<(), String> {
    let log_dir = log_directory()?;

    if log_dir.exists() {
        let entries = std::fs::read_dir(&log_dir).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |ext| ext == "log") {
                std::fs::remove_file(&path).map_err(|e| e.to_string())?;
            }
        }
    }

    log::info!(target: "notesage::lifecycle", "Log files cleared");
    Ok(())
}

/// Resolve the log directory path (macOS: ~/Library/Logs/com.notesage.app/).
fn log_directory() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or("Could not determine home directory")?;
        Ok(home.join("Library/Logs/com.notesage.app"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        dirs::data_local_dir()
            .map(|d| d.join("com.notesage.app").join("logs"))
            .ok_or_else(|| "Could not determine log directory".to_string())
    }
}
