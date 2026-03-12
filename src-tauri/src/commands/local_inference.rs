use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

pub struct LocalInferenceState {
    server_pid: std::sync::Mutex<Option<u32>>,
    port: tokio::sync::Mutex<Option<u16>>,
    active_model: tokio::sync::Mutex<Option<String>>,
    pub models_dir: PathBuf,
    download_cancels: std::sync::Mutex<HashMap<String, Arc<AtomicBool>>>,
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

/// Resolve the llama-server binary path.
/// Checks: 1) next to the app executable (bundled sidecar), 2) ~/.notesage/bin/, 3) PATH
fn resolve_llama_server_binary() -> Result<PathBuf, String> {
    // 1. Bundled sidecar — next to the app executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let binary = dir.join("llama-server");
            if binary.exists() {
                return Ok(binary);
            }
        }
    }

    // 2. Managed install location
    if let Some(home) = dirs::home_dir() {
        let managed = home.join(".notesage").join("bin").join("llama-server");
        if managed.exists() {
            return Ok(managed);
        }
    }

    // 3. System PATH
    if let Ok(output) = std::process::Command::new("which")
        .arg("llama-server")
        .output()
    {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                return Ok(PathBuf::from(path_str));
            }
        }
    }

    Err(
        "llama-server binary not found. It should be bundled with the app, \
         installed at ~/.notesage/bin/llama-server, or available in PATH."
            .to_string(),
    )
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
    // 1. Bundled sidecar
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let binary = dir.join("llama-server");
            if binary.exists() {
                return Ok(BinaryStatus {
                    available: true,
                    location: "bundled".to_string(),
                    path: Some(binary.to_string_lossy().to_string()),
                });
            }
        }
    }

    // 2. Managed install
    if let Some(home) = dirs::home_dir() {
        let managed = home.join(".notesage").join("bin").join("llama-server");
        if managed.exists() {
            return Ok(BinaryStatus {
                available: true,
                location: "managed".to_string(),
                path: Some(managed.to_string_lossy().to_string()),
            });
        }
    }

    // 3. System PATH
    if let Ok(output) = std::process::Command::new("which").arg("llama-server").output() {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                return Ok(BinaryStatus {
                    available: true,
                    location: "system".to_string(),
                    path: Some(path_str),
                });
            }
        }
    }

    Ok(BinaryStatus {
        available: false,
        location: "not_found".to_string(),
        path: None,
    })
}

#[tauri::command]
pub async fn download_llama_server_binary(
    app: AppHandle,
    state: State<'_, LocalInferenceState>,
) -> Result<String, String> {
    let version = "b5460";
    let arch = std::env::consts::ARCH;
    let release_name = match arch {
        "aarch64" => "macos-arm64",
        "x86_64" => "macos-x64",
        _ => return Err(format!("Unsupported architecture: {}", arch)),
    };

    let url = format!(
        "https://github.com/ggml-org/llama.cpp/releases/download/{}/llama-{}-bin-{}.zip",
        version, version, release_name
    );

    let dest_dir = dirs::home_dir()
        .ok_or("Could not determine home directory")?
        .join(".notesage")
        .join("bin");
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;
    let dest_path = dest_dir.join("llama-server");

    log::info!(target: "notesage::local_ai", "Downloading llama-server {} for {} from {}", version, arch, url);

    // Set up cancel signal
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut cancels = state.download_cancels.lock().unwrap();
        cancels.insert("__llama_server_binary__".to_string(), cancel.clone());
    }

    // Download
    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status: {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut bytes = Vec::new();

    use futures::StreamExt;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Err("Download cancelled".to_string());
        }
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        downloaded += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);

        if total > 0 {
            let _ = app.emit(
                "llama-binary-download-progress",
                serde_json::json!({
                    "downloaded": downloaded,
                    "total": total,
                }),
            );
        }
    }

    // Extract llama-server and shared libraries from the zip
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("Failed to open zip: {}", e))?;

    let lib_dir = dest_dir.join("lib");
    std::fs::create_dir_all(&lib_dir)
        .map_err(|e| format!("Failed to create lib directory: {}", e))?;

    let mut found_binary = false;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;
        let name = file.name().to_string();

        // Extract the llama-server binary
        if name.ends_with("/llama-server") || name == "llama-server" {
            let mut out = std::fs::File::create(&dest_path)
                .map_err(|e| format!("Failed to create binary file: {}", e))?;
            std::io::copy(&mut file, &mut out)
                .map_err(|e| format!("Failed to write binary: {}", e))?;
            found_binary = true;
        }

        // Extract shared libraries (.dylib / .so) and Metal shader files (.metal, .h)
        if name.ends_with(".dylib") || name.ends_with(".so")
            || name.ends_with(".metal") || name.ends_with("ggml-metal-impl.h") || name.ends_with("ggml-common.h") {
            if let Some(lib_name) = name.rsplit('/').next() {
                let lib_path = lib_dir.join(lib_name);
                let mut out = std::fs::File::create(&lib_path)
                    .map_err(|e| format!("Failed to create library file: {}", e))?;
                std::io::copy(&mut file, &mut out)
                    .map_err(|e| format!("Failed to write library: {}", e))?;
                log::debug!(target: "notesage::local_ai", "Extracted library: {}", lib_name);
            }
        }
    }

    if !found_binary {
        return Err("llama-server not found in downloaded archive".to_string());
    }

    // Set executable permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    // Fix rpath so the binary finds dylibs in lib/ next to itself
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("install_name_tool")
            .args(["-add_rpath", "@executable_path/lib", dest_path.to_str().unwrap_or("")])
            .output();
    }

    // Cleanup cancel signal
    {
        let mut cancels = state.download_cancels.lock().unwrap();
        cancels.remove("__llama_server_binary__");
    }

    log::info!(target: "notesage::local_ai", "Installed llama-server to {}", dest_path.display());
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn cancel_llama_server_download(
    state: State<'_, LocalInferenceState>,
) -> Result<(), String> {
    let cancels = state.download_cancels.lock().unwrap();
    if let Some(cancel) = cancels.get("__llama_server_binary__") {
        cancel.store(true, Ordering::Relaxed);
        Ok(())
    } else {
        Err("No active binary download".to_string())
    }
}

// ---------------------------------------------------------------------------
// Streaming chat proxy (local_bundled provider)
// ---------------------------------------------------------------------------

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
        "repeat_penalty": 1.1,
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
            // Custom/unknown model — use full hardcoded set
            [
                ("<think>", "</think>"),
                ("<summary>", "</summary>"),
                ("<discussion>", "</discussion>"),
                ("<reflection>", "</reflection>"),
                ("<reasoning>", "</reasoning>"),
                ("<scratchpad>", "</scratchpad>"),
                ("<internal_thoughts>", "</internal_thoughts>"),
            ].iter().map(|(o, c)| (o.to_string(), c.to_string())).collect()
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
        "repeat_penalty": 1.1,
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
    let content = strip_thinking_tags_for_model(&raw_content, catalog_entry.as_ref());

    Ok(content)
}

/// Strip thinking/reasoning XML tags from model output, using catalog metadata when available.
fn strip_thinking_tags_for_model(text: &str, catalog_entry: Option<&CatalogEntry>) -> String {
    let tag_pairs_owned: Vec<(String, String)> = match catalog_entry {
        Some(entry) if !entry.supports_thinking => return text.trim().to_string(),
        Some(entry) => match &entry.thinking_tags {
            Some(tags) => vec![(tags.open.clone(), tags.close.clone())],
            None => vec![("<think>".to_string(), "</think>".to_string())],
        },
        None => {
            // Custom/unknown model — use full hardcoded set
            [
                ("<think>", "</think>"),
                ("<summary>", "</summary>"),
                ("<discussion>", "</discussion>"),
                ("<reflection>", "</reflection>"),
                ("<reasoning>", "</reasoning>"),
                ("<scratchpad>", "</scratchpad>"),
                ("<internal_thoughts>", "</internal_thoughts>"),
            ].iter().map(|(o, c)| (o.to_string(), c.to_string())).collect()
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
        "temperature": 0.1,
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
            "temperature": 0.1,
            "stop": ["\n\n"],
            "repeat_penalty": 1.1,
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
