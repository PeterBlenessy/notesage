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
// Streaming chat proxy (local_bundled provider)
// ---------------------------------------------------------------------------

/// Stream chat completions through the local llama-server.
/// Uses the OpenAI-compatible `/v1/chat/completions` endpoint with SSE.
///
/// **llama-server limitation:** streaming + tools cannot be used together.
/// When tools are provided, falls back to a non-streaming request and emits
/// the response as events to maintain the same frontend interface.
pub async fn local_bundled_chat_stream(
    window: &tauri::Window,
    messages: &[super::ChatMessage],
    state: &LocalInferenceState,
    tools: &Option<Vec<super::ai::ToolDefinition>>,
    model: &Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
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
            let content_value = if has_tool_calls && m.content.is_empty() {
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
            } else {
                Some(serde_json::json!({ "role": m.role, "content": m.content }))
            }
        }).collect()
    };

    let mut body = serde_json::json!({
        "model": model_name,
        "messages": api_messages,
        "stream": !has_tools,
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

    // --- Non-streaming path: tools present, parse full JSON response ---
    if has_tools {
        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse local AI response: {}", e))?;

        // Extract text content
        if let Some(content) = json["choices"][0]["message"]["content"].as_str() {
            if !content.is_empty() {
                window.emit("ai-stream-chunk", content)
                    .map_err(|e| format!("Failed to emit chunk: {}", e))?;
            }
        }

        // Extract tool calls
        let mut has_tool_calls = false;
        if let Some(tool_calls) = json["choices"][0]["message"]["tool_calls"].as_array() {
            for tc in tool_calls {
                has_tool_calls = true;
                let id = tc["id"].as_str().unwrap_or("").to_string();
                let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
                let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}");
                let arguments: serde_json::Value = serde_json::from_str(args_str)
                    .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

                if !name.is_empty() {
                    window.emit("ai-tool-call", serde_json::json!({
                        "id": id,
                        "name": name,
                        "arguments": arguments
                    })).map_err(|e| format!("Failed to emit tool call: {}", e))?;
                }
            }
        }

        if has_tool_calls {
            window.emit("ai-tool-calls-done", ())
                .map_err(|e| format!("Failed to emit tool calls done: {}", e))?;
        } else {
            window.emit("ai-stream-done", ())
                .map_err(|e| format!("Failed to emit done: {}", e))?;
        }

        return Ok(());
    }

    // --- Streaming path: no tools, use SSE ---
    use futures::StreamExt;

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

/// Build the llama-server command arguments for a given model entry.
/// Used by `start_local_server` and extracted here for testability.
#[allow(dead_code)]
pub fn build_server_args(
    model_path: &str,
    port: u16,
    ctx_len: u32,
    gpu_layers: i32,
    supports_tool_calling: bool,
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
    args
}
