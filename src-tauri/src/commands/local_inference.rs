use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use super::constants;

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

pub struct LocalInferenceState {
    server_pid: std::sync::Mutex<Option<u32>>,
    port: tokio::sync::Mutex<Option<u16>>,
    active_model: tokio::sync::Mutex<Option<String>>,
    pub models_dir: PathBuf,
    download_cancels: std::sync::Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Cached thinking tags detected from /props chat_template for the active model.
    /// Set after model load; cleared on model switch.
    detected_thinking_tags: tokio::sync::Mutex<Option<Option<(String, String)>>>,
}

impl LocalInferenceState {
    pub fn new() -> Self {
        let models_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".notesage")
            .join("models")
            .join("llm");
        Self {
            server_pid: std::sync::Mutex::new(None),
            port: tokio::sync::Mutex::new(None),
            active_model: tokio::sync::Mutex::new(None),
            models_dir,
            download_cancels: std::sync::Mutex::new(HashMap::new()),
            detected_thinking_tags: tokio::sync::Mutex::new(None),
        }
    }

    /// Blocking stop — called from RunEvent::Exit
    pub fn stop_sync(&self) {
        if let Ok(mut pid_guard) = self.server_pid.lock() {
            if let Some(pid) = pid_guard.take() {
                // SIGTERM first
                let _ = std::process::Command::new("kill")
                    .args(["-15", &pid.to_string()])
                    .output();
                // Give it a moment, then SIGKILL
                std::thread::sleep(std::time::Duration::from_millis(500));
                let _ = std::process::Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .output();
                log::info!(target: "notesage::local_ai", "Stopped local inference server (pid {})", pid);
            }
        }
        // Clean up PID file
        let pid_file = self.models_dir.join(".server.pid");
        let _ = std::fs::remove_file(&pid_file);
    }

    /// Returns (running, port) for diagnostic reporting.
    pub fn status_info(&self) -> (bool, Option<u16>) {
        let has_pid = self.server_pid.lock().map(|g| g.is_some()).unwrap_or(false);
        let port = self.port.try_lock().ok().and_then(|g| *g);
        (has_pid, port)
    }
}

// ---------------------------------------------------------------------------
// Model registry — loaded from JSON catalog + user custom models
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LocalModelInfo {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub size_bytes: u64,
    pub ram_required_bytes: u64,
    pub downloaded: bool,
    pub description: String,
    pub huggingface_url: String,
    #[serde(default)]
    pub is_custom: bool,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub supports_fim: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub architecture: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantization: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hf_repo_id: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub supports_tool_calling: bool,
    #[serde(default)]
    pub supports_thinking: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_tags: Option<ThinkingTags>,
    #[serde(default)]
    pub supports_vision: bool,
    #[serde(default)]
    pub multilingual: bool,
    #[serde(default)]
    pub recommended_for: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ThinkingTags {
    pub open: String,
    pub close: String,
}

/// A model entry in the catalog (curated or custom).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CatalogEntry {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub size_bytes: u64,
    pub ram_required_bytes: u64,
    pub description: String,
    pub huggingface_url: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub supports_fim: bool,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub organization: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub parameters: Option<String>,
    #[serde(default)]
    pub architecture: Option<String>,
    #[serde(default)]
    pub context_length: Option<u64>,
    #[serde(default)]
    pub quantization: Option<String>,
    #[serde(default)]
    pub hf_repo_id: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub supports_tool_calling: bool,
    #[serde(default)]
    pub supports_thinking: bool,
    #[serde(default)]
    pub thinking_tags: Option<ThinkingTags>,
    #[serde(default)]
    pub supports_vision: bool,
    #[serde(default)]
    pub multilingual: bool,
    #[serde(default)]
    pub recommended_for: Vec<String>,
}

/// Bundled catalog embedded at compile time.
static BUNDLED_CATALOG: &str = include_str!("../../model-catalog.json");

/// Load the curated model catalog.
fn load_curated_catalog() -> Vec<CatalogEntry> {
    serde_json::from_str(BUNDLED_CATALOG).unwrap_or_default()
}

/// Load user custom models from `~/.notesage/models/llm/custom-models.json`.
fn load_custom_models(models_dir: &std::path::Path) -> Vec<CatalogEntry> {
    let path = models_dir.join("custom-models.json");
    if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    }
}

/// Save user custom models.
fn save_custom_models(models_dir: &std::path::Path, models: &[CatalogEntry]) -> Result<(), String> {
    let path = models_dir.join("custom-models.json");
    let json = serde_json::to_string_pretty(models)
        .map_err(|e| format!("Failed to serialize custom models: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write custom models: {}", e))?;
    Ok(())
}

/// Get all models (curated + custom), marking custom entries. Public for model_metadata module.
pub fn get_all_models_pub(models_dir: &std::path::Path) -> Vec<(CatalogEntry, bool)> {
    get_all_models(models_dir)
}

/// Get all models (curated + custom), marking custom entries.
fn get_all_models(models_dir: &std::path::Path) -> Vec<(CatalogEntry, bool)> {
    let mut all: Vec<(CatalogEntry, bool)> = load_curated_catalog()
        .into_iter()
        .map(|e| (e, false))
        .collect();
    let custom = load_custom_models(models_dir);
    for entry in custom {
        // Skip duplicates (custom with same id as curated)
        if all.iter().any(|(e, _)| e.id == entry.id) {
            continue;
        }
        all.push((entry, true));
    }
    all
}

/// Find a model entry by ID across curated + custom catalogs.
fn find_model_entry(models_dir: &std::path::Path, model_id: &str) -> Option<CatalogEntry> {
    get_all_models(models_dir)
        .into_iter()
        .find(|(e, _)| e.id == model_id)
        .map(|(e, _)| e)
}

// ---------------------------------------------------------------------------
// System memory
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemMemoryInfo {
    pub total_bytes: u64,
    pub available_bytes: u64,
}

#[tauri::command]
pub async fn get_system_memory() -> Result<SystemMemoryInfo, String> {
    use sysinfo::System;
    let sys = System::new_with_specifics(
        sysinfo::RefreshKind::nothing().with_memory(sysinfo::MemoryRefreshKind::everything()),
    );
    Ok(SystemMemoryInfo {
        total_bytes: sys.total_memory(),
        available_bytes: sys.available_memory(),
    })
}

// ---------------------------------------------------------------------------
// Model listing
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_local_models(
    state: State<'_, LocalInferenceState>,
) -> Result<Vec<LocalModelInfo>, String> {
    std::fs::create_dir_all(&state.models_dir)
        .map_err(|e| format!("Failed to create models directory: {}", e))?;

    let models = get_all_models(&state.models_dir)
        .into_iter()
        .map(|(entry, is_custom)| {
            let path = state.models_dir.join(&entry.filename);
            LocalModelInfo {
                id: entry.id,
                name: entry.name,
                filename: entry.filename,
                size_bytes: entry.size_bytes,
                ram_required_bytes: entry.ram_required_bytes,
                downloaded: path.exists(),
                description: entry.description,
                huggingface_url: entry.huggingface_url,
                is_custom,
                source: if is_custom { "Custom".to_string() } else { entry.source },
                supports_fim: entry.supports_fim,
                author: entry.author,
                organization: entry.organization,
                license: entry.license,
                parameters: entry.parameters,
                architecture: entry.architecture,
                context_length: entry.context_length,
                quantization: entry.quantization,
                hf_repo_id: entry.hf_repo_id,
                category: entry.category,
                supports_tool_calling: entry.supports_tool_calling,
                supports_thinking: entry.supports_thinking,
                thinking_tags: entry.thinking_tags,
                supports_vision: entry.supports_vision,
                multilingual: entry.multilingual,
                recommended_for: entry.recommended_for,
            }
        })
        .collect();

    Ok(models)
}

// ---------------------------------------------------------------------------
// Model download
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn download_local_model(
    app: AppHandle,
    state: State<'_, LocalInferenceState>,
    model_id: String,
) -> Result<(), String> {
    let entry = find_model_entry(&state.models_dir, &model_id)
        .ok_or_else(|| format!("Unknown model: {}", model_id))?;

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut cancels = state.download_cancels.lock().unwrap();
        if cancels.contains_key(&model_id) {
            return Err(format!("Model '{}' is already being downloaded", model_id));
        }
        cancels.insert(model_id.clone(), cancel.clone());
    }

    let result = download_model_inner(&app, &state, &entry, &cancel).await;

    {
        let mut cancels = state.download_cancels.lock().unwrap();
        cancels.remove(&model_id);
    }

    result
}

async fn download_model_inner(
    app: &AppHandle,
    state: &LocalInferenceState,
    entry: &CatalogEntry,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    use futures::StreamExt;

    std::fs::create_dir_all(&state.models_dir)
        .map_err(|e| format!("Failed to create models directory: {}", e))?;

    let final_path = state.models_dir.join(&entry.filename);
    let temp_path = state.models_dir.join(format!("{}.downloading", &entry.filename));

    let _ = std::fs::remove_file(&temp_path);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&entry.huggingface_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let total = response.content_length().unwrap_or(entry.size_bytes);
    let mut downloaded: u64 = 0;
    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut last_percent: u64 = 0;

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            drop(file);
            let _ = std::fs::remove_file(&temp_path);
            return Err("Download cancelled".to_string());
        }

        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        use std::io::Write;
        file.write_all(&chunk)
            .map_err(|e| format!("Write error: {}", e))?;

        downloaded += chunk.len() as u64;

        let percent = if total > 0 { (downloaded * 100) / total } else { 0 };
        if percent != last_percent {
            last_percent = percent;
            let _ = app.emit(
                "local-model-download-progress",
                serde_json::json!({
                    "model": entry.id,
                    "downloaded": downloaded,
                    "total": total
                }),
            );
        }
    }

    drop(file);
    std::fs::rename(&temp_path, &final_path)
        .map_err(|e| format!("Failed to finalize download: {}", e))?;

    log::info!(target: "notesage::local_ai", "Downloaded model '{}' ({} bytes)", entry.id, downloaded);

    // Auto-parse GGUF header and cache metadata (Task 9)
    if entry.filename.ends_with(".gguf") {
        super::model_metadata::parse_and_cache_gguf_for_model(&entry.id, &final_path);
    }

    Ok(())
}

#[tauri::command]
pub async fn cancel_local_model_download(
    state: State<'_, LocalInferenceState>,
    model_id: String,
) -> Result<(), String> {
    let cancels = state.download_cancels.lock().unwrap();
    if let Some(cancel) = cancels.get(&model_id) {
        cancel.store(true, Ordering::Relaxed);
        Ok(())
    } else {
        Err(format!("No active download for model '{}'", model_id))
    }
}

#[tauri::command]
pub async fn delete_local_model(
    state: State<'_, LocalInferenceState>,
    model_id: String,
) -> Result<(), String> {
    {
        let active = state.active_model.lock().await;
        if active.as_deref() == Some(&model_id) {
            return Err("Cannot delete the currently active model. Stop the server first.".to_string());
        }
    }

    let entry = find_model_entry(&state.models_dir, &model_id)
        .ok_or_else(|| format!("Unknown model: {}", model_id))?;

    let path = state.models_dir.join(&entry.filename);
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete model: {}", e))?;
        log::info!(target: "notesage::local_ai", "Deleted model '{}'", model_id);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Custom model management
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn add_custom_local_model(
    state: State<'_, LocalInferenceState>,
    name: String,
    url: String,
) -> Result<LocalModelInfo, String> {
    // Validate URL
    if !url.contains("huggingface.co") && !url.ends_with(".gguf") {
        return Err("URL must point to a .gguf file (Hugging Face recommended)".to_string());
    }

    // Derive filename from URL
    let filename = url
        .split('/')
        .next_back()
        .unwrap_or("custom-model.gguf")
        .to_string();

    // Derive ID from filename (lowercase, stripped of extension)
    let id = filename
        .replace(".gguf", "")
        .to_lowercase()
        .replace(' ', "-");

    // Check for duplicate IDs
    if find_model_entry(&state.models_dir, &id).is_some() {
        return Err(format!("A model with ID '{}' already exists", id));
    }

    std::fs::create_dir_all(&state.models_dir)
        .map_err(|e| format!("Failed to create models directory: {}", e))?;

    // Probe the URL to get file size (HEAD request)
    let size_bytes = match reqwest::Client::new().head(&url).send().await {
        Ok(resp) => resp.content_length().unwrap_or(0),
        Err(_) => 0,
    };

    // Try to derive hf_repo_id from URL
    let hf_repo_id = super::model_metadata::repo_id_from_url(&url);

    let entry = CatalogEntry {
        id: id.clone(),
        name: name.clone(),
        filename: filename.clone(),
        size_bytes,
        ram_required_bytes: (size_bytes as f64 * 1.3) as u64, // rough estimate
        description: "Custom model".to_string(),
        huggingface_url: url,
        source: "Custom".to_string(),
        supports_fim: false,
        author: None,
        organization: None,
        license: None,
        parameters: None,
        architecture: None,
        context_length: None,
        quantization: None,
        hf_repo_id,
        category: None,
        supports_tool_calling: false,
        supports_thinking: false,
        thinking_tags: None,
        supports_vision: false,
        multilingual: false,
        recommended_for: vec![],
    };

    let mut custom = load_custom_models(&state.models_dir);
    custom.push(entry.clone());
    save_custom_models(&state.models_dir, &custom)?;

    log::info!(target: "notesage::local_ai", "Added custom model '{}' ({})", name, id);

    Ok(LocalModelInfo {
        id: entry.id,
        name: entry.name,
        filename: entry.filename,
        size_bytes: entry.size_bytes,
        ram_required_bytes: entry.ram_required_bytes,
        downloaded: false,
        description: entry.description,
        huggingface_url: entry.huggingface_url,
        is_custom: true,
        source: "Custom".to_string(),
        supports_fim: false,
        author: entry.author,
        organization: entry.organization,
        license: entry.license,
        parameters: entry.parameters,
        architecture: entry.architecture,
        context_length: entry.context_length,
        quantization: entry.quantization,
        hf_repo_id: entry.hf_repo_id,
        category: entry.category,
        supports_tool_calling: entry.supports_tool_calling,
        supports_thinking: entry.supports_thinking,
        thinking_tags: entry.thinking_tags,
        supports_vision: entry.supports_vision,
        multilingual: entry.multilingual,
        recommended_for: entry.recommended_for,
    })
}

#[tauri::command]
pub async fn remove_custom_local_model(
    state: State<'_, LocalInferenceState>,
    model_id: String,
) -> Result<(), String> {
    // Don't allow removing curated models
    let curated = load_curated_catalog();
    if curated.iter().any(|e| e.id == model_id) {
        return Err("Cannot remove a built-in model".to_string());
    }

    // Check if it's the active model
    {
        let active = state.active_model.lock().await;
        if active.as_deref() == Some(&model_id) {
            return Err("Cannot remove the currently active model. Stop the server first.".to_string());
        }
    }

    // Delete the model file if downloaded
    if let Some(entry) = find_model_entry(&state.models_dir, &model_id) {
        let path = state.models_dir.join(&entry.filename);
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete model file: {}", e))?;
        }
    }

    // Remove from custom-models.json
    let mut custom = load_custom_models(&state.models_dir);
    custom.retain(|e| e.id != model_id);
    save_custom_models(&state.models_dir, &custom)?;

    log::info!(target: "notesage::local_ai", "Removed custom model '{}'", model_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServerStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub model: Option<String>,
}

fn find_available_port(start: u16) -> Option<u16> {
    for port in start..start + 100 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    None
}

/// Get the Tauri sidecar binary name (with target triple suffix for prod builds).
fn sidecar_binary_name() -> String {
    let triple = format!("{}-{}", std::env::consts::ARCH, match std::env::consts::OS {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-gnu",
        "windows" => "pc-windows-msvc",
        _ => "unknown",
    });
    format!("llama-server-{}", triple)
}

/// Resolve the llama-server binary path.
/// Checks: 1) next to the app executable (bundled sidecar), 2) dev source dir, 3) PATH
fn resolve_llama_server_binary() -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()));

    if let Some(ref dir) = exe_dir {
        // 1. Bundled sidecar — next to the app executable
        if let Some(path) = resolve_bundled_sidecar(dir) {
            return Ok(path);
        }

        // 2. Dev mode fallback — source binaries directory (survives cargo clean)
        if let Some(path) = resolve_dev_binary(dir) {
            return Ok(path);
        }
    }

    // 3. System PATH
    if let Some(path) = resolve_system_path() {
        return Ok(path);
    }

    log::warn!(target: "notesage::local_ai", "llama-server binary not found at any resolution path");
    Err(
        "llama-server binary not found. It should be bundled with the app or available in PATH."
            .to_string(),
    )
}

/// Check for bundled sidecar next to the executable directory.
fn resolve_bundled_sidecar(exe_dir: &std::path::Path) -> Option<PathBuf> {
    let candidates = [sidecar_binary_name(), "llama-server".to_string()];
    for name in &candidates {
        let binary = exe_dir.join(name);
        let exists = binary.exists();
        log::debug!(target: "notesage::local_ai", "Binary check: {} exists={}", binary.display(), exists);
        if exists {
            let is_dev = exe_dir.to_string_lossy().contains("/target/");
            if !is_dev || exe_dir.join("lib").exists() {
                log::info!(target: "notesage::local_ai", "Resolved binary: {} ({})", binary.display(), if is_dev { "dev" } else { "bundled" });
                return Some(binary);
            }
            log::debug!(target: "notesage::local_ai", "Skipping {} — dev mode and lib/ not found", binary.display());
        }
    }
    None
}

/// Check dev source binaries directory (survives cargo clean).
fn resolve_dev_binary(exe_dir: &std::path::Path) -> Option<PathBuf> {
    let triple = format!("{}-{}", std::env::consts::ARCH, match std::env::consts::OS {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-gnu",
        _ => "",
    });
    // Walk up from target/debug/ to src-tauri/binaries/
    let src_tauri = exe_dir.parent()?.parent()?;
    let dev_binary = src_tauri.join("binaries").join(format!("llama-server-{}", triple));
    let exists = dev_binary.exists();
    log::debug!(target: "notesage::local_ai", "Dev fallback check: {} exists={}", dev_binary.display(), exists);
    if exists {
        log::info!(target: "notesage::local_ai", "Resolved binary: {} (dev fallback)", dev_binary.display());
        return Some(dev_binary);
    }
    None
}

/// Check system PATH via `which`.
fn resolve_system_path() -> Option<PathBuf> {
    let output = std::process::Command::new("which")
        .arg("llama-server")
        .output()
        .ok()?;
    if output.status.success() {
        let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path_str.is_empty() {
            log::info!(target: "notesage::local_ai", "Resolved binary: {} (system PATH)", path_str);
            return Some(PathBuf::from(path_str));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_resolve_bundled_sidecar_prod() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();

        // Create a binary with the sidecar name (simulating prod)
        let binary_name = sidecar_binary_name();
        fs::write(dir.join(&binary_name), b"fake binary").unwrap();

        let result = resolve_bundled_sidecar(dir);
        assert!(result.is_some(), "Should find bundled sidecar in prod-like dir");
        assert!(result.unwrap().ends_with(&binary_name));
    }

    #[test]
    fn test_resolve_bundled_sidecar_dev_with_lib() {
        // Dev mode: dir contains /target/, but lib/ exists → should resolve
        let tmp = tempfile::tempdir().unwrap();
        let target_dir = tmp.path().join("some").join("target").join("debug");
        fs::create_dir_all(&target_dir).unwrap();
        fs::write(target_dir.join("llama-server"), b"fake binary").unwrap();
        fs::create_dir_all(target_dir.join("lib")).unwrap();

        let result = resolve_bundled_sidecar(&target_dir);
        assert!(result.is_some(), "Should find binary in dev mode when lib/ exists");
    }

    #[test]
    fn test_resolve_bundled_sidecar_dev_without_lib() {
        // Dev mode: dir contains /target/, no lib/ → should skip
        let tmp = tempfile::tempdir().unwrap();
        let target_dir = tmp.path().join("some").join("target").join("debug");
        fs::create_dir_all(&target_dir).unwrap();
        fs::write(target_dir.join("llama-server"), b"fake binary").unwrap();

        let result = resolve_bundled_sidecar(&target_dir);
        assert!(result.is_none(), "Should skip dev binary when lib/ is missing");
    }

    #[test]
    fn test_resolve_bundled_sidecar_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let result = resolve_bundled_sidecar(tmp.path());
        assert!(result.is_none(), "Should return None when no binary exists");
    }

    #[test]
    fn test_resolve_dev_binary() {
        let tmp = tempfile::tempdir().unwrap();
        // Simulate: exe at src-tauri/target/debug/notesage
        let target_dir = tmp.path().join("target").join("debug");
        fs::create_dir_all(&target_dir).unwrap();

        let triple = format!("{}-{}", std::env::consts::ARCH, match std::env::consts::OS {
            "macos" => "apple-darwin",
            "linux" => "unknown-linux-gnu",
            _ => "",
        });
        let binaries_dir = tmp.path().join("binaries");
        fs::create_dir_all(&binaries_dir).unwrap();
        fs::write(binaries_dir.join(format!("llama-server-{}", triple)), b"fake binary").unwrap();

        let result = resolve_dev_binary(&target_dir);
        assert!(result.is_some(), "Should find dev binary in binaries/ relative to src-tauri");
    }

    #[test]
    fn test_resolve_dev_binary_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let target_dir = tmp.path().join("target").join("debug");
        fs::create_dir_all(&target_dir).unwrap();

        let result = resolve_dev_binary(&target_dir);
        assert!(result.is_none(), "Should return None when dev binary doesn't exist");
    }

    #[test]
    fn test_dir_total_size() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), b"hello").unwrap(); // 5 bytes
        fs::write(tmp.path().join("b.txt"), b"world!").unwrap(); // 6 bytes
        let sub = tmp.path().join("sub");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("c.txt"), b"test").unwrap(); // 4 bytes

        assert_eq!(dir_total_size(tmp.path()), 15);
    }
}

#[tauri::command]
pub async fn start_local_server(
    app: AppHandle,
    state: State<'_, LocalInferenceState>,
    model_id: String,
    context_length: Option<u32>,
    gpu_layers: Option<i32>,
) -> Result<u16, String> {
    // Stop existing server if running and clear stale port
    kill_server_process(&state);
    *state.port.lock().await = None;

    // Find model file
    let entry = find_model_entry(&state.models_dir, &model_id)
        .ok_or_else(|| format!("Unknown model: {}", model_id))?;

    let model_path = state.models_dir.join(&entry.filename);
    if !model_path.exists() {
        return Err(format!("Model file not found: {}. Download it first.", entry.filename));
    }

    // Find available port
    let port = find_available_port(8090)
        .ok_or("Could not find an available port in range 8090-8189")?;

    let ctx_len = context_length.unwrap_or(4096);
    let gpu = gpu_layers.unwrap_or(-1);

    // Resolve binary
    let binary_path = resolve_llama_server_binary()?;

    // Spawn llama-server process
    let mut cmd = tokio::process::Command::new(&binary_path);
    cmd.args([
        "--model", model_path.to_str().unwrap_or(""),
        "--port", &port.to_string(),
        "--ctx-size", &ctx_len.to_string(),
        "--n-gpu-layers", &gpu.to_string(),
        "--host", "127.0.0.1",
    ])
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped())
    .kill_on_drop(true);

    // Inject login shell PATH (same pattern as copilot_lsp.rs)
    if let Some(shell_path) = super::shell_path::get_shell_path() {
        cmd.env("PATH", shell_path);
    }

    // Set library search path for non-static builds (e.g., user-installed llama-server with dylibs)
    if let Some(binary_dir) = binary_path.parent() {
        let lib_dir = binary_dir.join("lib");
        if lib_dir.exists() {
            #[cfg(target_os = "macos")]
            cmd.env("DYLD_LIBRARY_PATH", &lib_dir);
            #[cfg(target_os = "linux")]
            cmd.env("LD_LIBRARY_PATH", &lib_dir);
            log::debug!(target: "notesage::local_ai", "Set library path to {}", lib_dir.display());
        }
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start llama-server: {}", e))?;

    let pid = child.id().unwrap_or(0);

    // Store PID immediately for cleanup
    {
        let mut pid_guard = state.server_pid.lock().unwrap();
        *pid_guard = Some(pid);
    }

    // Write PID file for crash recovery
    let pid_file = state.models_dir.join(".server.pid");
    let _ = std::fs::write(&pid_file, pid.to_string());

    // Spawn a task to wait for the child (prevents zombie) and drain output
    tokio::spawn(async move {
        let output = child.wait_with_output().await;
        match output {
            Ok(out) => {
                if !out.status.success() {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    log::warn!(target: "notesage::llama_server", "Process exited with {}: {}", out.status, stderr);
                } else {
                    log::info!(target: "notesage::llama_server", "Process exited normally");
                }
            }
            Err(e) => {
                log::warn!(target: "notesage::llama_server", "Failed to wait for process: {}", e);
            }
        }
    });

    // Wait for server to become healthy (max 30 seconds)
    let health_url = format!("http://127.0.0.1:{}/health", port);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let mut healthy = false;
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if let Ok(resp) = client.get(&health_url).send().await {
            if resp.status().is_success() {
                healthy = true;
                break;
            }
        }
    }

    if !healthy {
        kill_server_process(&state);
        return Err("llama-server failed to become healthy within 30 seconds".to_string());
    }

    // Store state
    *state.port.lock().await = Some(port);
    *state.active_model.lock().await = Some(model_id.clone());
    *state.detected_thinking_tags.lock().await = None; // clear cache on model switch

    let _ = app.emit(
        "local-server-status",
        serde_json::json!({
            "running": true,
            "port": port,
            "model": model_id
        }),
    );

    log::info!(target: "notesage::local_ai", "Started llama-server on port {} with model '{}' (pid {})", port, model_id, pid);
    Ok(port)
}

/// Kill the server process by stored PID
fn kill_server_process(state: &LocalInferenceState) {
    if let Ok(mut pid_guard) = state.server_pid.lock() {
        if let Some(pid) = pid_guard.take() {
            let _ = std::process::Command::new("kill")
                .args(["-15", &pid.to_string()])
                .output();
        }
    }
    let pid_file = state.models_dir.join(".server.pid");
    let _ = std::fs::remove_file(&pid_file);
}

#[tauri::command]
pub async fn stop_local_server(
    app: AppHandle,
    state: State<'_, LocalInferenceState>,
) -> Result<(), String> {
    kill_server_process(&state);

    *state.port.lock().await = None;
    *state.active_model.lock().await = None;

    let _ = app.emit(
        "local-server-status",
        serde_json::json!({
            "running": false,
            "port": null,
            "model": null
        }),
    );

    log::info!(target: "notesage::local_ai", "Stopped local inference server");
    Ok(())
}

#[tauri::command]
pub async fn get_local_server_status(
    state: State<'_, LocalInferenceState>,
) -> Result<ServerStatus, String> {
    let port = *state.port.lock().await;
    let model = state.active_model.lock().await.clone();

    if let Some(p) = port {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .unwrap_or_default();
        let url = format!("http://127.0.0.1:{}/health", p);
        let is_healthy = client
            .get(&url)
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);

        return Ok(ServerStatus {
            running: is_healthy,
            port: Some(p),
            model,
        });
    }

    Ok(ServerStatus {
        running: false,
        port: None,
        model,
    })
}

/// Kill orphaned llama-server processes from previous sessions.
/// Called at app startup from lib.rs setup.
pub fn kill_orphaned_servers() {
    let models_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".notesage")
        .join("models")
        .join("llm");
    let pid_file = models_dir.join(".server.pid");

    if let Ok(pid_str) = std::fs::read_to_string(&pid_file) {
        if let Ok(pid) = pid_str.trim().parse::<u32>() {
            let _ = std::process::Command::new("kill")
                .args(["-15", &pid.to_string()])
                .output();
            log::info!(target: "notesage::local_ai", "Killed orphaned llama-server (pid {})", pid);
        }
        let _ = std::fs::remove_file(&pid_file);
    }
}

// ---------------------------------------------------------------------------
// Binary availability check & runtime download
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct BinaryStatus {
    pub available: bool,
    pub location: String,  // "bundled", "managed", "system", "not_found"
    pub path: Option<String>,
}

#[tauri::command]
pub async fn check_llama_server_available() -> Result<BinaryStatus, String> {
    // Check for stale ~/.notesage/bin/ leftovers from legacy download feature
    if let Some(home) = dirs::home_dir() {
        let stale_bin_dir = home.join(".notesage").join("bin");
        if stale_bin_dir.exists() {
            let stale_size = dir_total_size(&stale_bin_dir);
            log::warn!(
                target: "notesage::local_ai",
                "Stale ~/.notesage/bin/ directory found ({} bytes) — this is a leftover from a previous version and can be safely deleted",
                stale_size
            );
        }
    }

    // Use the same resolution logic as start_local_server
    match resolve_llama_server_binary() {
        Ok(path) => {
            let location = if path.to_string_lossy().contains("/target/") || path.to_string_lossy().contains("/binaries/") {
                "dev"
            } else if path.to_string_lossy().contains("/usr/") || path.to_string_lossy().contains("/bin/") {
                "system"
            } else {
                "bundled"
            };
            Ok(BinaryStatus {
                available: true,
                location: location.to_string(),
                path: Some(path.to_string_lossy().to_string()),
            })
        }
        Err(_) => Ok(BinaryStatus {
            available: false,
            location: "not_found".to_string(),
            path: None,
        }),
    }
}

/// Calculate total size of a directory recursively.
fn dir_total_size(dir: &std::path::Path) -> u64 {
    let mut total: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total += meta.len();
                } else if meta.is_dir() {
                    total += dir_total_size(&entry.path());
                }
            }
        }
    }
    total
}

/// Collect Local AI diagnostic info for the diagnostics export.
pub fn collect_local_ai_diagnostics() -> LocalAIDiagnostics {
    let binary = resolve_llama_server_binary();
    let (binary_available, binary_location, binary_path) = match &binary {
        Ok(path) => {
            let loc = if path.to_string_lossy().contains("/target/") || path.to_string_lossy().contains("/binaries/") {
                "dev"
            } else if path.to_string_lossy().contains("/usr/") || path.to_string_lossy().contains("/bin/") {
                "system"
            } else {
                "bundled"
            };
            (true, loc.to_string(), Some(path.to_string_lossy().to_string()))
        }
        Err(_) => (false, "not_found".to_string(), None),
    };

    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let models_dir = home.join(".notesage").join("models").join("llm");
    let bin_dir = home.join(".notesage").join("bin");

    // Scan for model files on disk
    let models_on_disk = if models_dir.exists() {
        std::fs::read_dir(&models_dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter_map(|e| {
                        let meta = e.metadata().ok()?;
                        if meta.is_file() {
                            Some(DiagnosticFile {
                                name: e.file_name().to_string_lossy().to_string(),
                                size_bytes: meta.len(),
                            })
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        vec![]
    };

    // Detect stale files
    let mut stale_files: Vec<DiagnosticFile> = vec![];

    // Stale ~/.notesage/bin/ leftovers
    if bin_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&bin_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    stale_files.push(DiagnosticFile {
                        name: format!("~/.notesage/bin/{}", entry.file_name().to_string_lossy()),
                        size_bytes: if meta.is_dir() { dir_total_size(&entry.path()) } else { meta.len() },
                    });
                }
            }
        }
    }

    // Stale .tmp / .part files in models dir
    if models_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&models_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".tmp") || name.ends_with(".part") {
                    if let Ok(meta) = entry.metadata() {
                        stale_files.push(DiagnosticFile {
                            name: format!("~/.notesage/models/llm/{}", name),
                            size_bytes: meta.len(),
                        });
                    }
                }
            }
        }
    }

    LocalAIDiagnostics {
        binary_available,
        binary_location,
        binary_path,
        models_dir: models_dir.to_string_lossy().to_string(),
        models_dir_exists: models_dir.exists(),
        models_on_disk,
        stale_files,
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct DiagnosticFile {
    pub name: String,
    pub size_bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct LocalAIDiagnostics {
    pub binary_available: bool,
    pub binary_location: String,
    pub binary_path: Option<String>,
    pub models_dir: String,
    pub models_dir_exists: bool,
    pub models_on_disk: Vec<DiagnosticFile>,
    pub stale_files: Vec<DiagnosticFile>,
}

// ---------------------------------------------------------------------------
// Streaming chat proxy (local_bundled provider)
// ---------------------------------------------------------------------------

/// Detect thinking tags from llama-server's /props chat_template.
/// Returns None if no thinking pattern is found in the template.
async fn detect_thinking_tags_from_template(port: u16) -> Option<(String, String)> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;
    let resp = client
        .get(format!("http://127.0.0.1:{}/props", port))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let props: serde_json::Value = resp.json().await.ok()?;
    let template = props.get("chat_template")?.as_str()?;
    parse_thinking_tags_from_jinja(template)
}

/// Parse a Jinja2 chat template for thinking tag patterns.
/// Looks for blocks like `{% if thinking %}`, `{% if message.role == "thinking" %}`
/// and extracts the surrounding XML-like delimiter tags.
fn parse_thinking_tags_from_jinja(template: &str) -> Option<(String, String)> {
    // Common patterns in Jinja2 chat templates for thinking blocks:
    //   {% if thinking %}...<think>{{ thinking }}</think>...{% endif %}
    //   {%- if message.role == "thinking" -%}<think>{{ message.content }}</think>{%- endif -%}
    //   {%- if message['role'] == 'thinking' -%}
    // We scan for these patterns and extract the XML tags surrounding them.

    // Strategy 1: Look for a thinking-related Jinja block and extract tags
    let thinking_indicators = [
        "if thinking",
        "message.role == \"thinking\"",
        "message.role == 'thinking'",
        "message['role'] == 'thinking'",
        "message['role'] == \"thinking\"",
        "if message.thinking",
    ];

    for indicator in &thinking_indicators {
        if let Some(pos) = template.find(indicator) {
            // Search for XML-like tags near this position
            let region_start = pos.saturating_sub(200);
            let region_end = (pos + 400).min(template.len());
            let region = &template[region_start..region_end];

            if let Some(tags) = extract_xml_tags_from_region(region) {
                return Some(tags);
            }
        }
    }

    // Strategy 2: Look for known thinking tag patterns directly in the template
    let known_patterns = [
        ("<think>", "</think>"),
        ("<thinking>", "</thinking>"),
        ("<thought>", "</thought>"),
        ("<reasoning>", "</reasoning>"),
    ];

    for (open, close) in &known_patterns {
        if template.contains(open) && template.contains(close) {
            return Some((open.to_string(), close.to_string()));
        }
    }

    None
}

/// Extract XML-like opening/closing tag pair from a template region.
fn extract_xml_tags_from_region(region: &str) -> Option<(String, String)> {
    // Look for patterns like <think>...</think>, <|think|>...<|/think|>
    let re_patterns = [
        // Standard XML tags: <tagname>...</tagname>
        ("<think>", "</think>"),
        ("<thinking>", "</thinking>"),
        ("<thought>", "</thought>"),
        ("<reasoning>", "</reasoning>"),
        ("<reflection>", "</reflection>"),
        // Pipe-delimited: <|think|>...<|/think|>
        ("<|think|>", "<|/think|>"),
        ("<|thinking|>", "<|/thinking|>"),
    ];

    for (open, close) in &re_patterns {
        if region.contains(open) {
            return Some((open.to_string(), close.to_string()));
        }
    }

    None
}

/// Get thinking tags for a custom/unknown model, using cached /props detection
/// with fallback to FALLBACK_THINKING_TAGS.
async fn get_thinking_tags_for_custom_model(
    state: &LocalInferenceState,
    port: u16,
) -> Vec<(String, String)> {
    // Check cache first
    let cached = state.detected_thinking_tags.lock().await.clone();
    if let Some(cached_result) = cached {
        return match cached_result {
            Some((open, close)) => vec![(open, close)],
            None => constants::FALLBACK_THINKING_TAGS
                .iter()
                .map(|(o, c)| (o.to_string(), c.to_string()))
                .collect(),
        };
    }

    // Not cached yet — detect from /props
    let detected = detect_thinking_tags_from_template(port).await;
    *state.detected_thinking_tags.lock().await = Some(detected.clone());

    match detected {
        Some((open, close)) => vec![(open, close)],
        None => constants::FALLBACK_THINKING_TAGS
            .iter()
            .map(|(o, c)| (o.to_string(), c.to_string()))
            .collect(),
    }
}

/// Stream chat completions through the local llama-server.
/// Uses the OpenAI-compatible `/v1/chat/completions` endpoint with SSE.
pub async fn local_bundled_chat_stream(
    window: &tauri::Window,
    messages: &[super::ChatMessage],
    state: &LocalInferenceState,
    model: &Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
) -> Result<(), String> {
    use futures::StreamExt;

    let port = state.port.lock().await
        .ok_or("Local AI server is not running. Start it from Settings → Local AI.")?;

    let base_url = format!("http://127.0.0.1:{}", port);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    let active_model = state.active_model.lock().await.clone().unwrap_or_default();
    let model_name = model.as_deref().unwrap_or(&active_model);

    let mut body = serde_json::json!({
        "model": model_name,
        "messages": api_messages,
        "stream": true,
        "repeat_penalty": constants::REPEAT_PENALTY,
        "frequency_penalty": 0.1
    });

    if let Some(temp) = temperature {
        body["temperature"] = serde_json::json!(temp);
    }
    if let Some(max) = max_tokens {
        body["max_tokens"] = serde_json::json!(max);
    }

    let response = client
        .post(format!("{}/v1/chat/completions", base_url))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Local AI request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Local AI error: {}", error_text));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    // Determine thinking tags from catalog metadata if available.
    // For catalog models with explicit thinking_tags, use only those.
    // For catalog models with supports_thinking but no tags, use generic <think>.
    // For catalog models with supports_thinking: false, skip tag parsing entirely.
    // For custom models (no catalog metadata), fall back to the full hardcoded scanner.
    let active_model_id = state.active_model.lock().await.clone().unwrap_or_default();
    let catalog_entry = find_model_entry(&state.models_dir, &active_model_id);

    let catalog_thinking_tags: Vec<(String, String)> = match &catalog_entry {
        Some(entry) if !entry.supports_thinking => vec![],
        Some(entry) => match &entry.thinking_tags {
            Some(tags) => vec![(tags.open.clone(), tags.close.clone())],
            None => vec![("<think>".to_string(), "</think>".to_string())],
        },
        None => {
            // Custom/unknown model — try /props detection, then fallback
            get_thinking_tags_for_custom_model(state, port).await
        }
    };
    let thinking_tags_refs: Vec<(&str, &str)> = catalog_thinking_tags.iter()
        .map(|(o, c)| (o.as_str(), c.as_str()))
        .collect();
    let thinking_tags: &[(&str, &str)] = &thinking_tags_refs;

    let mut tag_buf = String::new();
    let mut in_thinking_tag: Option<&str> = None; // closing tag we're looking for

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("Stream error: {}", e))?;
        let text = String::from_utf8_lossy(&bytes);
        buffer.push_str(&text);

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || line.starts_with(':') {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if data.trim() == "[DONE]" {
                    break;
                }

                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                        if content.is_empty() {
                            continue;
                        }

                        // Parse thinking tags from the content stream
                        tag_buf.push_str(content);
                        while !tag_buf.is_empty() {
                            if let Some(closing) = in_thinking_tag {
                                // Inside a thinking tag — look for the closing tag
                                if let Some(end) = tag_buf.find(closing) {
                                    let thinking_text = &tag_buf[..end];
                                    if !thinking_text.is_empty() {
                                        window.emit("ai-stream-thinking-chunk", thinking_text)
                                            .map_err(|e| format!("Failed to emit thinking: {}", e))?;
                                    }
                                    tag_buf = tag_buf[end + closing.len()..].to_string();
                                    in_thinking_tag = None;
                                } else {
                                    // No closing tag yet — emit everything except a trailing
                                    // partial that starts with '<' (could be start of </close>)
                                    if let Some(lt) = tag_buf.rfind('<') {
                                        let before = &tag_buf[..lt];
                                        if !before.is_empty() {
                                            window.emit("ai-stream-thinking-chunk", before)
                                                .map_err(|e| format!("Failed to emit thinking: {}", e))?;
                                        }
                                        tag_buf = tag_buf[lt..].to_string();
                                    } else {
                                        // No '<' at all — emit everything
                                        window.emit("ai-stream-thinking-chunk", &tag_buf)
                                            .map_err(|e| format!("Failed to emit thinking: {}", e))?;
                                        tag_buf.clear();
                                    }
                                    break;
                                }
                            } else {
                                // Outside thinking tags — look for any opening tag
                                let mut earliest: Option<(usize, &str, &str)> = None;
                                for &(open, close) in thinking_tags {
                                    if let Some(pos) = tag_buf.find(open) {
                                        if earliest.is_none() || pos < earliest.unwrap().0 {
                                            earliest = Some((pos, open, close));
                                        }
                                    }
                                }

                                if let Some((pos, open, close)) = earliest {
                                    // Emit content before the tag as regular text
                                    let before = &tag_buf[..pos];
                                    if !before.is_empty() {
                                        window.emit("ai-stream-chunk", before)
                                            .map_err(|e| format!("Failed to emit chunk: {}", e))?;
                                    }
                                    tag_buf = tag_buf[pos + open.len()..].to_string();
                                    in_thinking_tag = Some(close);
                                } else {
                                    // No opening tag found — only hold back if buffer
                                    // ends with a '<' that could be start of a tag
                                    if let Some(lt) = tag_buf.rfind('<') {
                                        let before = &tag_buf[..lt];
                                        if !before.is_empty() {
                                            window.emit("ai-stream-chunk", before)
                                                .map_err(|e| format!("Failed to emit chunk: {}", e))?;
                                        }
                                        tag_buf = tag_buf[lt..].to_string();
                                    } else {
                                        // No '<' at all — emit everything immediately
                                        window.emit("ai-stream-chunk", &tag_buf)
                                            .map_err(|e| format!("Failed to emit chunk: {}", e))?;
                                        tag_buf.clear();
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Flush any remaining content in the tag buffer
    if !tag_buf.is_empty() {
        let event = if in_thinking_tag.is_some() { "ai-stream-thinking-chunk" } else { "ai-stream-chunk" };
        window.emit(event, &tag_buf)
            .map_err(|e| format!("Failed to emit final chunk: {}", e))?;
    }

    window
        .emit("ai-stream-done", ())
        .map_err(|e| format!("Failed to emit done event: {}", e))?;

    Ok(())
}

/// Non-streaming chat through local llama-server.
pub async fn local_bundled_chat(
    messages: &[super::ChatMessage],
    state: &LocalInferenceState,
    model: &Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    let port = state.port.lock().await
        .ok_or("Local AI server is not running. Start it from Settings → Local AI.")?;

    let base_url = format!("http://127.0.0.1:{}", port);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    let active_model = state.active_model.lock().await.clone().unwrap_or_default();
    let model_name = model.as_deref().unwrap_or(&active_model);

    let mut body = serde_json::json!({
        "model": model_name,
        "messages": api_messages,
        "repeat_penalty": constants::REPEAT_PENALTY,
        "frequency_penalty": 0.1
    });

    if let Some(temp) = temperature {
        body["temperature"] = serde_json::json!(temp);
    }
    if let Some(max) = max_tokens {
        body["max_tokens"] = serde_json::json!(max);
    }

    let response = client
        .post(format!("{}/v1/chat/completions", base_url))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Local AI request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Local AI error: {}", error_text));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let raw_content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Invalid response format from local AI")?
        .to_string();

    // Strip thinking/reasoning tags from non-streaming responses using catalog metadata
    let active_model_id = state.active_model.lock().await.clone().unwrap_or_default();
    let catalog_entry = find_model_entry(&state.models_dir, &active_model_id);
    // For custom models, use cached /props detection
    let detected_tags = if catalog_entry.is_none() {
        state.detected_thinking_tags.lock().await.clone().flatten()
    } else {
        None
    };
    let content = strip_thinking_tags_for_model(&raw_content, catalog_entry.as_ref(), detected_tags.as_ref());

    Ok(content)
}

/// Strip thinking/reasoning XML tags from model output, using catalog metadata when available.
/// `detected_tags` provides /props-detected tags for custom models (cached by the streaming path).
fn strip_thinking_tags_for_model(
    text: &str,
    catalog_entry: Option<&CatalogEntry>,
    detected_tags: Option<&(String, String)>,
) -> String {
    let tag_pairs_owned: Vec<(String, String)> = match catalog_entry {
        Some(entry) if !entry.supports_thinking => return text.trim().to_string(),
        Some(entry) => match &entry.thinking_tags {
            Some(tags) => vec![(tags.open.clone(), tags.close.clone())],
            None => vec![("<think>".to_string(), "</think>".to_string())],
        },
        None => match detected_tags {
            Some((open, close)) => vec![(open.clone(), close.clone())],
            None => {
                // Custom/unknown model, no /props detection — use shared fallback set
                constants::FALLBACK_THINKING_TAGS
                    .iter().map(|(o, c)| (o.to_string(), c.to_string())).collect()
            }
        }
    };

    let mut result = text.to_string();
    for (open, close) in &tag_pairs_owned {
        loop {
            let Some(start) = result.find(open.as_str()) else { break };
            if let Some(end) = result[start..].find(close.as_str()) {
                result = format!("{}{}", &result[..start], &result[start + end + close.len()..]);
            } else {
                // Opening tag without closing — strip from opening tag to end
                result = result[..start].to_string();
                break;
            }
        }
    }
    result.trim().to_string()
}

/// Non-streaming generate through local llama-server.
pub async fn local_bundled_generate(
    prompt: &str,
    state: &LocalInferenceState,
    model: &Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    let messages = vec![super::ChatMessage {
        role: "user".to_string(),
        content: prompt.to_string(),
    }];
    local_bundled_chat(&messages, state, model, temperature, max_tokens).await
}

/// FIM (Fill-in-the-Middle) completion through local llama-server.
/// Tries the native `/infill` endpoint first (code models with FIM tokens).
/// Falls back to chat-based completion for general chat models.
#[tauri::command]
pub async fn local_bundled_fim(
    state: tauri::State<'_, LocalInferenceState>,
    prefix: String,
    suffix: String,
    _model: Option<String>,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    let port = state.port.lock().await
        .ok_or("Local AI server is not running")?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let base = format!("http://127.0.0.1:{}", port);
    let max_tok = max_tokens.unwrap_or(40);

    // Try /infill first (works with code models that have FIM tokens)
    let infill_body = serde_json::json!({
        "input_prefix": prefix,
        "input_suffix": suffix,
        "n_predict": max_tok,
        "temperature": constants::FIM_TEMPERATURE,
        "stop": ["\n\n", "\n"],
    });

    let infill_resp = client
        .post(format!("{}/infill", base))
        .header("content-type", "application/json")
        .json(&infill_body)
        .send()
        .await
        .map_err(|e| format!("FIM request failed: {}", e))?;

    if infill_resp.status().is_success() {
        let json: serde_json::Value = infill_resp.json().await
            .map_err(|e| format!("Failed to parse FIM response: {}", e))?;
        return Ok(json["content"].as_str().unwrap_or("").to_string());
    }

    // If 501 (model doesn't support FIM), fall back to chat-based completion.
    // Chat models need an instruction to complete text rather than respond conversationally.
    let status = infill_resp.status().as_u16();
    if status == 501 {
        let chat_body = serde_json::json!({
            "messages": [
                {
                    "role": "system",
                    "content": "You are a text completion engine. Complete the user's text naturally. Output ONLY the continuation — no explanations, no quotes, no markdown formatting. Just the next few words or sentence fragment that logically follows."
                },
                {
                    "role": "user",
                    "content": format!("Continue this text:\n{}", prefix)
                }
            ],
            "max_tokens": max_tok,
            "temperature": constants::FIM_TEMPERATURE,
            "stop": ["\n\n"],
            "repeat_penalty": constants::REPEAT_PENALTY,
        });

        let chat_resp = client
            .post(format!("{}/v1/chat/completions", base))
            .header("content-type", "application/json")
            .json(&chat_body)
            .send()
            .await
            .map_err(|e| format!("Chat completion fallback failed: {}", e))?;

        if !chat_resp.status().is_success() {
            let error_text = chat_resp.text().await.unwrap_or_default();
            return Err(format!("Completion error: {}", error_text));
        }

        let json: serde_json::Value = chat_resp.json().await
            .map_err(|e| format!("Failed to parse chat completion response: {}", e))?;

        let content = json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        return Ok(content);
    }

    // Other errors (503 loading, etc.)
    let error_text = infill_resp.text().await.unwrap_or_default();
    Err(format!("FIM error: {}", error_text))
}
