use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use super::constants;
use super::model_management::{find_model_entry, find_available_port, resolve_llama_server_binary};
use super::thinking_tags::{get_thinking_tags_for_custom_model, strip_thinking_tags_for_model};

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
    /// Dedicated FIM (`/infill`) server. Resolves the `--jinja`/FIM conflict
    /// (item #8 of the local-LLM agentic-behavior stack): when the main chat
    /// model has tool calling enabled, `--jinja` breaks the `/infill`
    /// endpoint, forcing a degraded chat-based fallback for inline
    /// completions. Running a second llama-server WITHOUT `--jinja` and
    /// pointed at a FIM-capable model (e.g. Qwen2.5-Coder) gives users
    /// simultaneous tool calling AND fast native FIM. Slot stays unset
    /// (and `local_bundled_fim` falls back to the main server) until the
    /// user explicitly starts a completion server.
    completion_server_pid: std::sync::Mutex<Option<u32>>,
    completion_port: tokio::sync::Mutex<Option<u16>>,
    completion_model: tokio::sync::Mutex<Option<String>>,
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
            completion_server_pid: std::sync::Mutex::new(None),
            completion_port: tokio::sync::Mutex::new(None),
            completion_model: tokio::sync::Mutex::new(None),
        }
    }

    /// Blocking stop — called from RunEvent::Exit
    pub fn stop_sync(&self) {
        // Stop both the main chat server and the completion server.
        // SIGTERM → 500ms → SIGKILL for each, then clean up PID files.
        for (slot, label, pid_filename) in [
            (&self.server_pid, "chat", ".server.pid"),
            (&self.completion_server_pid, "completion", ".completion.pid"),
        ] {
            if let Ok(mut pid_guard) = slot.lock() {
                if let Some(pid) = pid_guard.take() {
                    let _ = std::process::Command::new("kill")
                        .args(["-15", &pid.to_string()])
                        .output();
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let _ = std::process::Command::new("kill")
                        .args(["-9", &pid.to_string()])
                        .output();
                    log::info!(target: "notesage::local_ai", "Stopped {} server (pid {})", label, pid);
                }
            }
            let pid_file = self.models_dir.join(pid_filename);
            let _ = std::fs::remove_file(&pid_file);
        }
    }

    /// Returns (running, port) for diagnostic reporting.
    pub fn status_info(&self) -> (bool, Option<u16>) {
        let has_pid = self.server_pid.lock().map(|g| g.is_some()).unwrap_or(false);
        let port = self.port.try_lock().ok().and_then(|g| *g);
        (has_pid, port)
    }

    // -- Accessors for model_management and thinking_tags modules --

    /// Get models directory path.
    pub fn models_dir(&self) -> &std::path::Path {
        &self.models_dir
    }

    /// Register a download cancel token. Returns false if already downloading.
    pub fn register_download(&self, model_id: &str, cancel: Arc<AtomicBool>) -> bool {
        let mut cancels = self.download_cancels.lock().unwrap();
        if cancels.contains_key(model_id) {
            return false;
        }
        cancels.insert(model_id.to_string(), cancel);
        true
    }

    /// Unregister a download cancel token.
    pub fn unregister_download(&self, model_id: &str) {
        let mut cancels = self.download_cancels.lock().unwrap();
        cancels.remove(model_id);
    }

    /// Cancel an active download. Returns false if no active download.
    pub fn cancel_download(&self, model_id: &str) -> bool {
        let cancels = self.download_cancels.lock().unwrap();
        if let Some(cancel) = cancels.get(model_id) {
            cancel.store(true, Ordering::Relaxed);
            true
        } else {
            false
        }
    }

    /// Check if a model is the currently active model.
    pub async fn is_active_model(&self, model_id: &str) -> bool {
        let active = self.active_model.lock().await;
        active.as_deref() == Some(model_id)
    }

    /// Get cached detected thinking tags.
    pub async fn detected_thinking_tags(&self) -> Option<Option<(String, String)>> {
        self.detected_thinking_tags.lock().await.clone()
    }

    /// Set cached detected thinking tags.
    pub async fn set_detected_thinking_tags(&self, tags: Option<Option<(String, String)>>) {
        *self.detected_thinking_tags.lock().await = tags;
    }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct ServerStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub model: Option<String>,
}

/// Download a multimodal projector file on demand (e.g., when server starts with
/// a vision model whose mmproj was not yet downloaded).
async fn download_mmproj(
    models_dir: &std::path::Path,
    filename: &str,
    url: &str,
) -> Result<(), String> {
    use futures::StreamExt;

    let final_path = models_dir.join(filename);
    let temp_path = models_dir.join(format!("{}.downloading", filename));
    let _ = std::fs::remove_file(&temp_path);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client.get(url).send().await
        .map_err(|e| format!("mmproj download failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("mmproj download HTTP {}", resp.status()));
    }

    let mut stream = resp.bytes_stream();
    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        use std::io::Write;
        file.write_all(&chunk).map_err(|e| format!("Write error: {}", e))?;
    }

    drop(file);
    std::fs::rename(&temp_path, &final_path)
        .map_err(|e| format!("Failed to finalize mmproj: {}", e))?;
    Ok(())
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
    ]);

    // Enable Jinja2 template engine for models that support tool calling.
    // Required for llama-server to process tool definitions in chat requests.
    // NOT added unconditionally because --jinja breaks the /infill FIM endpoint.
    if entry.supports_tool_calling {
        cmd.arg("--jinja");
        log::debug!(target: "notesage::local_ai", "Enabling --jinja for model '{}' (supports tool calling)", model_id);
    }

    // Speculative decoding: if the catalog pairs this model with a smaller
    // draft from the same family AND the draft file is downloaded, llama-server
    // verifies its tokens in parallel for a 1.5-2x speedup on long outputs.
    // Silently skip when the draft isn't on disk — we don't auto-download
    // because the draft adds significant RAM/VRAM pressure, and the user
    // should opt in by downloading it from Settings → Local AI.
    if let Some(ref draft_id) = entry.draft_model_id {
        if let Some(draft_entry) = find_model_entry(&state.models_dir, draft_id) {
            let draft_path = state.models_dir.join(&draft_entry.filename);
            if draft_path.exists() {
                cmd.args(["--model-draft", draft_path.to_str().unwrap_or("")]);
                log::info!(
                    target: "notesage::local_ai",
                    "Enabling speculative decoding: main='{}' draft='{}'",
                    model_id, draft_id
                );
            } else {
                log::debug!(
                    target: "notesage::local_ai",
                    "Speculative decoding available for '{}' (draft '{}') but draft file not downloaded — skipping",
                    model_id, draft_id
                );
            }
        }
    }

    // Pass multimodal projector file for vision models.
    // llama-server requires --mmproj to process image inputs.
    // If the mmproj file is missing (model was downloaded before vision support), download it now.
    if let (Some(ref mmproj_filename), Some(ref mmproj_url)) = (&entry.mmproj_filename, &entry.mmproj_url) {
        let mmproj_path = state.models_dir.join(mmproj_filename);
        if !mmproj_path.exists() {
            log::info!(target: "notesage::local_ai", "mmproj missing for '{}', downloading: {}", model_id, mmproj_filename);
            let _ = app.emit("local-ai-status", serde_json::json!({ "status": "downloading_mmproj", "model": model_id }));
            match download_mmproj(&state.models_dir, mmproj_filename, mmproj_url).await {
                Ok(_) => log::info!(target: "notesage::local_ai", "Downloaded mmproj '{}'", mmproj_filename),
                Err(e) => log::warn!(target: "notesage::local_ai", "Failed to download mmproj: {} — vision will not work", e),
            }
        }
        if mmproj_path.exists() {
            cmd.args(["--mmproj", mmproj_path.to_str().unwrap_or("")]);
            log::info!(target: "notesage::local_ai", "Enabling --mmproj for model '{}': {}", model_id, mmproj_filename);
        }
    }

    cmd.stdin(std::process::Stdio::null())
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

/// Current resident memory (bytes) of the running bundled chat server, sampled
/// via `ps`. Returns 0 when no server is running. Used by the Phase 2 runtime
/// calibration loop to track peak RAM during a generation.
#[tauri::command]
pub async fn get_local_server_rss(
    state: State<'_, LocalInferenceState>,
) -> Result<u64, String> {
    let pid = state.server_pid.lock().map(|g| *g).unwrap_or(None);
    Ok(match pid {
        Some(pid) => super::model_fit::calibration::sample_rss_bytes(pid),
        None => 0,
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
    // Both the main chat server and the completion server (item #8) leave
    // their PID on disk for crash recovery — clean up either if found.
    for (label, pid_filename) in [
        ("chat", ".server.pid"),
        ("completion", ".completion.pid"),
    ] {
        let pid_file = models_dir.join(pid_filename);
        if let Ok(pid_str) = std::fs::read_to_string(&pid_file) {
            if let Ok(pid) = pid_str.trim().parse::<u32>() {
                let _ = std::process::Command::new("kill")
                    .args(["-15", &pid.to_string()])
                    .output();
                log::info!(target: "notesage::local_ai", "Killed orphaned {} llama-server (pid {})", label, pid);
            }
            let _ = std::fs::remove_file(&pid_file);
        }
    }
}

// ---------------------------------------------------------------------------
// Completion server (item #8 — `--jinja` / FIM coexistence)
//
// llama-server has a hard rule: `--jinja` is required for tool calling but
// breaks the `/infill` FIM endpoint. With a single server, users have to
// pick: tool calling in chat OR fast FIM in completions. The completion
// server is a second llama-server process spawned WITHOUT `--jinja`,
// dedicated to FIM. `local_bundled_fim` prefers it when running and falls
// back to the main server's `/infill` → chat fallback chain otherwise.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn start_completion_server(
    app: AppHandle,
    state: State<'_, LocalInferenceState>,
    model_id: String,
    context_length: Option<u32>,
    gpu_layers: Option<i32>,
) -> Result<u16, String> {
    // Stop any existing completion server first.
    kill_completion_server_process(&state);
    *state.completion_port.lock().await = None;
    *state.completion_model.lock().await = None;

    let entry = find_model_entry(&state.models_dir, &model_id)
        .ok_or_else(|| format!("Unknown model: {}", model_id))?;

    let model_path = state.models_dir.join(&entry.filename);
    if !model_path.exists() {
        return Err(format!(
            "Model file not found: {}. Download it first.",
            entry.filename
        ));
    }

    // Use a different port range from the main server (8090-8189) so the
    // two never collide. 8190-8289 is reserved here.
    let port = find_available_port(8190)
        .ok_or("Could not find an available port in range 8190-8289")?;

    let ctx_len = context_length.unwrap_or(4096);
    let gpu = gpu_layers.unwrap_or(-1);

    let binary_path = resolve_llama_server_binary()?;

    let mut cmd = tokio::process::Command::new(&binary_path);
    cmd.args([
        "--model", model_path.to_str().unwrap_or(""),
        "--port", &port.to_string(),
        "--ctx-size", &ctx_len.to_string(),
        "--n-gpu-layers", &gpu.to_string(),
        "--host", "127.0.0.1",
    ]);

    // NB: deliberately NO `--jinja` here, even when the model's catalog
    // entry has `supports_tool_calling: true`. The whole point of this
    // server is to keep `/infill` working — `--jinja` breaks it.

    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    if let Some(shell_path) = super::shell_path::get_shell_path() {
        cmd.env("PATH", shell_path);
    }

    if let Some(binary_dir) = binary_path.parent() {
        let lib_dir = binary_dir.join("lib");
        if lib_dir.exists() {
            #[cfg(target_os = "macos")]
            cmd.env("DYLD_LIBRARY_PATH", &lib_dir);
            #[cfg(target_os = "linux")]
            cmd.env("LD_LIBRARY_PATH", &lib_dir);
        }
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start completion server: {}", e))?;

    let pid = child.id().unwrap_or(0);
    {
        let mut pid_guard = state.completion_server_pid.lock().unwrap();
        *pid_guard = Some(pid);
    }
    let pid_file = state.models_dir.join(".completion.pid");
    let _ = std::fs::write(&pid_file, pid.to_string());

    tokio::spawn(async move {
        let output = child.wait_with_output().await;
        if let Ok(out) = output {
            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr);
                log::warn!(
                    target: "notesage::llama_server",
                    "Completion server exited with {}: {}",
                    out.status, stderr
                );
            }
        }
    });

    // Health check with the same 30-second budget as the main server.
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
        kill_completion_server_process(&state);
        return Err("Completion server failed to become healthy within 30 seconds".to_string());
    }

    *state.completion_port.lock().await = Some(port);
    *state.completion_model.lock().await = Some(model_id.clone());

    let _ = app.emit(
        "local-completion-server-status",
        serde_json::json!({
            "running": true,
            "port": port,
            "model": model_id
        }),
    );

    log::info!(
        target: "notesage::local_ai",
        "Started completion server on port {} with model '{}' (pid {})",
        port, model_id, pid
    );
    Ok(port)
}

#[tauri::command]
pub async fn stop_completion_server(
    app: AppHandle,
    state: State<'_, LocalInferenceState>,
) -> Result<(), String> {
    kill_completion_server_process(&state);
    *state.completion_port.lock().await = None;
    *state.completion_model.lock().await = None;

    let _ = app.emit(
        "local-completion-server-status",
        serde_json::json!({ "running": false, "port": null, "model": null }),
    );
    Ok(())
}

#[tauri::command]
pub async fn get_completion_server_status(
    state: State<'_, LocalInferenceState>,
) -> Result<ServerStatus, String> {
    let pid_present = state
        .completion_server_pid
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false);
    let port = *state.completion_port.lock().await;
    let model = state.completion_model.lock().await.clone();
    Ok(ServerStatus {
        running: pid_present && port.is_some(),
        port,
        model,
    })
}

/// Kill the completion server process by stored PID (SIGTERM only —
/// `stop_sync` is the SIGKILL path used at app exit).
fn kill_completion_server_process(state: &LocalInferenceState) {
    if let Ok(mut pid_guard) = state.completion_server_pid.lock() {
        if let Some(pid) = pid_guard.take() {
            let _ = std::process::Command::new("kill")
                .args(["-15", &pid.to_string()])
                .output();
        }
    }
    let pid_file = state.models_dir.join(".completion.pid");
    let _ = std::fs::remove_file(&pid_file);
}

// ---------------------------------------------------------------------------
// Streaming chat proxy (local_bundled provider)
// ---------------------------------------------------------------------------

/// Stream chat completions through the local llama-server.
/// Uses the OpenAI-compatible `/v1/chat/completions` endpoint with SSE.
///
/// Tool calls stream incrementally in `delta.tool_calls` (llama.cpp b9000+
/// via the toolParser compatibility layer added in PR #16531). The single
/// SSE loop interleaves content deltas, thinking-tag parsing, and tool-call
/// accumulation — no non-streaming fallback. The version pin is enforced by
/// `llama_cpp_version_is_at_least_b9000` to keep this invariant.
pub async fn local_bundled_chat_stream(
    window: &tauri::Window,
    messages: &[super::ChatMessage],
    state: &LocalInferenceState,
    tools: &Option<Vec<super::ai::ToolDefinition>>,
    model: &Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    response_format: &Option<serde_json::Value>,
) -> Result<(), String> {
    let port = state.port.lock().await
        .ok_or("Local AI server is not running. Start it from Settings → Local AI.")?;

    let base_url = format!("http://127.0.0.1:{}", port);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let active_model = state.active_model.lock().await.clone().unwrap_or_default();
    let model_name = model.as_deref().unwrap_or(&active_model);

    let has_tools = tools.as_ref().map_or(false, |t| !t.is_empty());

    // Check if the model's template supports native tool calling.
    // Models with supports_tool_calling in the catalog can receive tool_calls/tool
    // messages in OpenAI format. Others need tool messages flattened to text.
    let catalog_entry = find_model_entry(&state.models_dir, &active_model);
    let model_supports_tools = catalog_entry.as_ref().map_or(false, |e| e.supports_tool_calling);

    let api_messages: Vec<serde_json::Value> = if model_supports_tools {
        // Native tool calling: send tool_calls and tool role as-is.
        // Key detail: assistant messages with tool_calls must have `content: null`
        // (not empty string) — Qwen3/Llama templates check `content is string` and
        // crash if it's "" when tool_calls are present.
        messages.iter().map(|m| {
            let has_tool_calls = m.tool_calls.as_ref().map_or(false, |tc| !tc.is_empty());
            let content_value = if m.role == "user" {
                if let Some(ref images) = m.images {
                    if !images.is_empty() {
                        let mut content_parts: Vec<serde_json::Value> = images.iter().map(|img| {
                            serde_json::json!({
                                "type": "image_url",
                                "image_url": { "url": format!("data:{};base64,{}", img.mime_type, img.data) }
                            })
                        }).collect();
                        content_parts.push(serde_json::json!({
                            "type": "text",
                            "text": m.content
                        }));
                        return serde_json::json!({
                            "role": m.role,
                            "content": content_parts
                        });
                    }
                }
                serde_json::json!(m.content)
            } else if has_tool_calls && m.content.is_empty() {
                serde_json::Value::Null
            } else {
                serde_json::json!(m.content)
            };
            let mut msg = serde_json::json!({ "role": m.role, "content": content_value });
            if let Some(ref tc) = m.tool_calls {
                msg["tool_calls"] = serde_json::json!(tc.iter().map(|t| {
                    serde_json::json!({
                        "id": t.id,
                        "type": "function",
                        "function": { "name": t.name, "arguments": t.arguments.to_string() }
                    })
                }).collect::<Vec<_>>());
            }
            if let Some(ref id) = m.tool_call_id {
                msg["tool_call_id"] = serde_json::json!(id);
            }
            msg
        }).collect()
    } else {
        // Flatten tool messages to text for models without native tool support.
        // - Assistant messages with tool_calls → append "[Called tool: name(args)]"
        // - Tool result messages (role: "tool") → convert to user message with result text
        messages.iter().filter_map(|m| {
            if m.role == "tool" {
                // Convert tool result to a user message
                let tool_id = m.tool_call_id.as_deref().unwrap_or("unknown");
                let content = format!("[Tool result for {}]:\n{}", tool_id, m.content);
                Some(serde_json::json!({ "role": "user", "content": content }))
            } else if m.role == "assistant" {
                let mut content = m.content.clone();
                if let Some(ref tc) = m.tool_calls {
                    for t in tc {
                        content.push_str(&format!(
                            "\n[Calling tool: {}({})]",
                            t.name,
                            serde_json::to_string(&t.arguments).unwrap_or_default()
                        ));
                    }
                }
                Some(serde_json::json!({ "role": "assistant", "content": content }))
            } else if m.role == "user" {
                if let Some(ref images) = m.images {
                    if !images.is_empty() {
                        let mut content_parts: Vec<serde_json::Value> = images.iter().map(|img| {
                            serde_json::json!({
                                "type": "image_url",
                                "image_url": { "url": format!("data:{};base64,{}", img.mime_type, img.data) }
                            })
                        }).collect();
                        content_parts.push(serde_json::json!({
                            "type": "text",
                            "text": m.content
                        }));
                        return Some(serde_json::json!({
                            "role": "user",
                            "content": content_parts
                        }));
                    }
                }
                Some(serde_json::json!({ "role": m.role, "content": m.content }))
            } else {
                Some(serde_json::json!({ "role": m.role, "content": m.content }))
            }
        }).collect()
    };

    let mut body = serde_json::json!({
        "model": model_name,
        "messages": api_messages,
        "stream": true,
        "stream_options": { "include_usage": true },
        "repeat_penalty": constants::REPEAT_PENALTY,
        "frequency_penalty": 0.1
    });

    if let Some(temp) = temperature {
        body["temperature"] = serde_json::json!(temp);
    }
    if let Some(max) = max_tokens {
        body["max_tokens"] = serde_json::json!(max);
    }

    // Add tools in OpenAI function-calling format
    if let Some(ref tool_defs) = tools {
        if !tool_defs.is_empty() {
            body["tools"] = serde_json::Value::Array(
                super::ai_streaming::tools_to_openai_format(tool_defs)
            );
        }
    }

    // Schema-constrained output via llama-server's response_format. The server
    // converts the JSON schema to a GBNF grammar internally — invalid tokens
    // get -inf logits, so output is guaranteed to satisfy the schema.
    // Not sent together with tools: llama-server treats them as mutually
    // exclusive grammar sources and the tool autoparser already constrains
    // tool-call output via the model's Jinja template.
    if !has_tools {
        if let Some(rf) = response_format {
            body["response_format"] = rf.clone();
        }
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

    // --- Streaming SSE path (handles both content and tool calls) ---
    //
    // llama-server b9000+ supports streaming + tool calls together via the
    // toolParser compatibility layer (llama.cpp PR #16531). The single SSE
    // loop below handles content deltas (with thinking-tag parsing) AND
    // incrementally-streamed tool calls in `delta.tool_calls`.
    use futures::StreamExt;
    use super::tool_execution::ChatCompletionsToolCallAccumulator;

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

    // Tool call accumulation. Each SSE chunk may carry partial tool-call data:
    //   first chunk for an index → id + function.name
    //   subsequent chunks       → function.arguments (concatenated)
    // Mirror of the openai_compatible_chat_stream pattern.
    let mut tool_calls: Vec<ChatCompletionsToolCallAccumulator> = Vec::new();
    let mut finish_reason = String::new();

    // Phase 2 runtime calibration: capture the model's real decode rate +
    // token count from llama-server's `timings` (and `usage` as fallback) in
    // the final SSE chunk, so the frontend can replace its estimate with a
    // measurement. See PRD 2026-06-03-model-fit-runtime-calibration.
    let mut measured_tok_per_sec: Option<f64> = None;
    let mut measured_tokens: Option<u64> = None;

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
                    // llama-server emits a top-level `timings` object on the
                    // final chunk; `usage.completion_tokens` is the fallback
                    // token count when timings are absent.
                    if let Some(timings) = json.get("timings") {
                        if let Some(tps) = timings.get("predicted_per_second").and_then(|v| v.as_f64()) {
                            measured_tok_per_sec = Some(tps);
                        }
                        if let Some(n) = timings.get("predicted_n").and_then(|v| v.as_u64()) {
                            measured_tokens = Some(n);
                        }
                    }
                    if measured_tokens.is_none() {
                        if let Some(n) = json["usage"]["completion_tokens"].as_u64() {
                            measured_tokens = Some(n);
                        }
                    }

                    let choice = &json["choices"][0];

                    if let Some(reason) = choice["finish_reason"].as_str() {
                        finish_reason = reason.to_string();
                    }

                    if let Some(tc_array) = choice["delta"]["tool_calls"].as_array() {
                        for tc in tc_array {
                            let index = tc["index"].as_u64().unwrap_or(0) as usize;
                            while tool_calls.len() <= index {
                                tool_calls.push(ChatCompletionsToolCallAccumulator {
                                    id: String::new(),
                                    name: String::new(),
                                    arguments: String::new(),
                                });
                            }
                            if let Some(id) = tc["id"].as_str() {
                                tool_calls[index].id = id.to_string();
                            }
                            if let Some(name) = tc["function"]["name"].as_str() {
                                tool_calls[index].name = name.to_string();
                            }
                            if let Some(args) = tc["function"]["arguments"].as_str() {
                                tool_calls[index].arguments.push_str(args);
                            }
                        }
                    }

                    if let Some(content) = choice["delta"]["content"].as_str() {
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

    // Emit any accumulated tool calls, then signal the frontend to execute them.
    let has_tool_calls = tool_calls.iter().any(|tc| !tc.name.is_empty());
    if has_tool_calls {
        for tc in &tool_calls {
            if tc.name.is_empty() {
                continue;
            }
            // Arguments accumulate as a JSON string across deltas; parse to a Value.
            // If parsing fails (truncated stream, malformed), fall back to Null so the
            // frontend still receives the call and can surface the error.
            let arguments: serde_json::Value = serde_json::from_str(&tc.arguments)
                .unwrap_or(serde_json::Value::Null);
            let id = if tc.id.is_empty() {
                format!("local-{}", super::tool_execution::uuid_v4())
            } else {
                tc.id.clone()
            };
            window.emit("ai-tool-call", serde_json::json!({
                "id": id,
                "name": tc.name,
                "arguments": arguments
            })).map_err(|e| format!("Failed to emit tool call: {}", e))?;
        }
    }

    if has_tool_calls || finish_reason == "tool_calls" {
        window
            .emit("ai-tool-calls-done", ())
            .map_err(|e| format!("Failed to emit tool calls done: {}", e))?;
    } else {
        // Emit measured timings (if any) before done so the frontend's
        // ai-stream-done handler can record the calibration sample.
        if measured_tok_per_sec.is_some() || measured_tokens.is_some() {
            let _ = window.emit(
                "ai-stream-timings",
                serde_json::json!({
                    "tokPerSec": measured_tok_per_sec,
                    "tokens": measured_tokens,
                }),
            );
        }
        window
            .emit("ai-stream-done", ())
            .map_err(|e| format!("Failed to emit done event: {}", e))?;
    }

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
        tool_calls: None,
        tool_call_id: None,
        images: None,
    }];
    local_bundled_chat(&messages, state, model, temperature, max_tokens).await
}

/// FIM (Fill-in-the-Middle) completion through local llama-server.
/// Prefers the dedicated completion server (no `--jinja`, FIM-capable
/// model) when running; otherwise falls back to the main chat server's
/// `/infill` → instructed-chat fallback chain. This is the user-facing
/// resolution of item #8's `--jinja`/FIM conflict.
#[tauri::command]
pub async fn local_bundled_fim(
    state: tauri::State<'_, LocalInferenceState>,
    prefix: String,
    suffix: String,
    _model: Option<String>,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    // Prefer the dedicated completion server when it's up — that's the
    // whole point of running it. Fall back to the main chat server's port
    // so a missing completion server doesn't silently break FIM for
    // existing users.
    let completion = *state.completion_port.lock().await;
    let main = *state.port.lock().await;
    let port = resolve_fim_port(completion, main)?;

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

    // Try /infill — may fail at connection level when --jinja is enabled (breaks /infill endpoint).
    // On any failure (connection error OR non-success status), fall back to chat-based completion.
    let infill_result = client
        .post(format!("{}/infill", base))
        .header("content-type", "application/json")
        .json(&infill_body)
        .send()
        .await;

    let should_fallback = match infill_result {
        Ok(resp) if resp.status().is_success() => {
            let json: serde_json::Value = resp.json().await
                .map_err(|e| format!("Failed to parse FIM response: {}", e))?;
            return Ok(json["content"].as_str().unwrap_or("").to_string());
        }
        Ok(resp) => {
            let status = resp.status().as_u16();
            // 501 = model doesn't support FIM, other errors = server issue
            // Both should fall back to chat-based completion
            log::debug!(target: "notesage::local_ai", "FIM /infill returned {}, falling back to chat", status);
            true
        }
        Err(e) => {
            // Connection error (e.g., --jinja breaks /infill endpoint)
            log::debug!(target: "notesage::local_ai", "FIM /infill connection error: {}, falling back to chat", e);
            true
        }
    };

    if !should_fallback {
        return Err("FIM: unexpected state".to_string());
    }

    // Fall back to chat-based completion
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

    Ok(content)
}

/// Pick the port for FIM requests: prefer the dedicated completion server
/// when running, fall back to the main chat server's port. Extracted here
/// so the tie-breaking behaviour (which is the user-visible resolution of
/// item #8) can be unit-tested without spawning real servers.
pub fn resolve_fim_port(
    completion: Option<u16>,
    main: Option<u16>,
) -> Result<u16, String> {
    if let Some(p) = completion {
        return Ok(p);
    }
    main.ok_or_else(|| "Local AI server is not running".to_string())
}

/// Build the llama-server command arguments for a given model entry.
/// Used by `start_local_server` and extracted here for testability.
///
/// `draft_model_path` enables speculative decoding (llama.cpp `--model-draft`).
/// When `Some`, the small draft model generates candidate tokens that the main
/// model verifies in parallel — typically 1.5-2x speedup on long outputs. The
/// draft model MUST share the same tokenizer as the main model.
#[allow(dead_code)]
pub fn build_server_args(
    model_path: &str,
    port: u16,
    ctx_len: u32,
    gpu_layers: i32,
    supports_tool_calling: bool,
    draft_model_path: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "--model".to_string(), model_path.to_string(),
        "--port".to_string(), port.to_string(),
        "--ctx-size".to_string(), ctx_len.to_string(),
        "--n-gpu-layers".to_string(), gpu_layers.to_string(),
        "--host".to_string(), "127.0.0.1".to_string(),
    ];
    if supports_tool_calling {
        args.push("--jinja".to_string());
    }
    if let Some(draft_path) = draft_model_path {
        args.push("--model-draft".to_string());
        args.push(draft_path.to_string());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify the bundled llama.cpp version pin is at least b9000.
    ///
    /// b9000+ contains the toolParser compatibility layer (llama.cpp PR #16531)
    /// that makes streaming + tool calling work together — the foundation that
    /// `local_bundled_chat_stream` depends on after dropping the non-streaming
    /// fallback. Downgrading below b9000 would re-introduce the bug where tool
    /// calls either error or land in the `reasoning` field instead of
    /// `tool_calls`. Format must be `b{number}`.
    #[test]
    fn llama_cpp_version_is_at_least_b9000() {
        let version = include_str!("../../binaries/LLAMA_CPP_VERSION").trim();
        assert!(
            version.starts_with('b'),
            "LLAMA_CPP_VERSION must be in bNNNN format, got: {version}"
        );
        let build_num: u32 = version[1..]
            .parse()
            .expect("LLAMA_CPP_VERSION build number must be a valid integer");
        assert!(
            build_num >= 9000,
            "LLAMA_CPP_VERSION must be at least b9000 for this bump; currently pinned to {version}"
        );
    }

    #[test]
    fn build_server_args_omits_model_draft_when_none() {
        let args = build_server_args("/tmp/main.gguf", 8090, 4096, -1, false, None);
        assert!(!args.iter().any(|a| a == "--model-draft"));
    }

    #[test]
    fn build_server_args_appends_model_draft_with_path() {
        let args = build_server_args(
            "/tmp/main.gguf",
            8090,
            4096,
            -1,
            false,
            Some("/tmp/draft.gguf"),
        );
        // Flag + path appear consecutively at the tail.
        let flag_idx = args.iter().position(|a| a == "--model-draft");
        assert!(flag_idx.is_some(), "--model-draft missing from args: {args:?}");
        let i = flag_idx.unwrap();
        assert_eq!(args[i + 1], "/tmp/draft.gguf");
    }

    #[test]
    fn build_server_args_speculative_and_jinja_coexist() {
        // Regression: both --jinja (for tool calling) and --model-draft (for
        // speculative decoding) must land in the same arg list. Earlier drafts
        // of this change accidentally mutually excluded them.
        let args = build_server_args(
            "/tmp/main.gguf",
            8090,
            4096,
            -1,
            /* supports_tool_calling */ true,
            Some("/tmp/draft.gguf"),
        );
        assert!(args.iter().any(|a| a == "--jinja"));
        assert!(args.iter().any(|a| a == "--model-draft"));
    }

    /// All `draft_model_id` references in the bundled catalog must resolve to
    /// a real model in the same architecture (same tokenizer is implied by same
    /// arch + same family). A typo or arch mismatch would either crash
    /// llama-server at spawn or produce gibberish output.
    #[test]
    fn catalog_draft_model_ids_resolve_to_compatible_models() {
        use std::collections::HashMap;
        let catalog: Vec<super::super::model_management::CatalogEntry> =
            serde_json::from_str(include_str!("../../model-catalog.json"))
                .expect("model-catalog.json is valid JSON");

        let by_id: HashMap<&str, &super::super::model_management::CatalogEntry> =
            catalog.iter().map(|e| (e.id.as_str(), e)).collect();

        let mut pairings_checked = 0;
        for entry in &catalog {
            if let Some(draft_id) = &entry.draft_model_id {
                let draft = by_id.get(draft_id.as_str()).unwrap_or_else(|| {
                    panic!(
                        "catalog entry '{}' references draft_model_id '{}' which does not exist",
                        entry.id, draft_id
                    )
                });
                assert_eq!(
                    entry.architecture, draft.architecture,
                    "draft model '{}' arch ({:?}) must match main model '{}' arch ({:?})",
                    draft.id, draft.architecture, entry.id, entry.architecture
                );
                pairings_checked += 1;
            }
        }
        // Guard against silent regression where every draft pairing got dropped.
        assert!(pairings_checked >= 5, "expected at least 5 draft pairings, found {pairings_checked}");
    }

    // --- FIM port resolution (item #8: --jinja/FIM conflict) ---

    #[test]
    fn resolve_fim_port_prefers_completion_server() {
        // The whole point of the completion server is to take FIM traffic off
        // the --jinja-loaded chat server. Even if both ports are running,
        // the completion port must win.
        let result = super::resolve_fim_port(Some(8190), Some(8090));
        assert_eq!(result, Ok(8190));
    }

    #[test]
    fn resolve_fim_port_falls_back_to_main_when_completion_unset() {
        // Backwards compat: users who haven't started a completion server
        // still get FIM via the main server's /infill → chat fallback chain.
        let result = super::resolve_fim_port(None, Some(8090));
        assert_eq!(result, Ok(8090));
    }

    #[test]
    fn resolve_fim_port_errors_when_neither_is_running() {
        let result = super::resolve_fim_port(None, None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not running"));
    }

    /// The completion server is useless without at least one FIM-capable
    /// model in the catalog to point it at. If a future edit drops the last
    /// `supports_fim: true` entry, this test fails before the regression
    /// lands in a release.
    #[test]
    fn catalog_has_at_least_one_fim_capable_model() {
        let catalog: Vec<super::super::model_management::CatalogEntry> =
            serde_json::from_str(include_str!("../../model-catalog.json"))
                .expect("model-catalog.json is valid JSON");

        let fim_count = catalog.iter().filter(|e| e.supports_fim).count();
        assert!(
            fim_count > 0,
            "expected at least one model with supports_fim: true — the \
             completion server (item #8) has nothing to load otherwise"
        );
    }
}
