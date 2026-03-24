use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use super::watcher::WatcherState;
use super::acp::AcpState;
use super::mcp::McpState;
use super::local_inference::LocalInferenceState;
use super::transcription::TranscriptionState;
use crate::index::IndexState;

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

#[derive(Serialize)]
pub struct DiagnosticDump {
    pub os: String,
    pub arch: String,
    pub log_dir: String,
    pub log_size_bytes: u64,
    pub watcher_alive: bool,
    pub watched_paths_count: usize,
    pub acp_agent_count: usize,
    pub mcp_server_count: usize,
    pub local_server_running: bool,
    pub local_server_port: Option<u16>,
    pub index_healthy: bool,
    pub index_project_count: usize,
    pub local_ai: super::local_inference::LocalAIDiagnostics,
    pub whisper: super::transcription::WhisperDiagnostics,
}

/// Collects backend diagnostic state for export. No sensitive data included.
#[tauri::command]
pub async fn collect_diagnostics(
    app: AppHandle,
    watcher: tauri::State<'_, WatcherState>,
    acp: tauri::State<'_, AcpState>,
    mcp: tauri::State<'_, McpState>,
    local_inference: tauri::State<'_, LocalInferenceState>,
    transcription: tauri::State<'_, TranscriptionState>,
) -> Result<DiagnosticDump, String> {
    let log_dir = log_directory().unwrap_or_default();
    let log_size = log_dir_size(&log_dir);

    let (watcher_alive, watched_paths) = watcher.health_info();
    let acp_agents = acp.check_processes().await;
    let mcp_servers = mcp.check_processes().await;
    let (local_running, local_port) = local_inference.status_info();

    let (index_healthy, index_project_count, _queue_len) = app
        .try_state::<IndexState>()
        .map(|s| s.health_info())
        .unwrap_or((false, 0, 0));

    let local_ai = super::local_inference::collect_local_ai_diagnostics();
    let whisper = transcription.collect_diagnostics();

    Ok(DiagnosticDump {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        log_dir: log_dir.to_string_lossy().to_string(),
        log_size_bytes: log_size,
        watcher_alive,
        watched_paths_count: watched_paths.len(),
        acp_agent_count: acp_agents.len(),
        mcp_server_count: mcp_servers.len(),
        local_server_running: local_running,
        local_server_port: local_port,
        index_healthy,
        index_project_count,
        local_ai,
        whisper,
    })
}

fn log_dir_size(dir: &PathBuf) -> u64 {
    if !dir.exists() {
        return 0;
    }
    let mut total: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total += meta.len();
                }
            }
        }
    }
    total
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
