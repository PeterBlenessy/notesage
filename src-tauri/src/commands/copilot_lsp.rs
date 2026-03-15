use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, BufReader, BufWriter};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;
use tokio::time::timeout;

use super::json_rpc::{
    self, JsonRpcMessage, JsonRpcNotification, JsonRpcRequest, PendingRequests,
};
use super::shell_path::get_shell_path;
use super::constants;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CopilotStatus {
    pub authenticated: bool,
    pub message: String,
    pub kind: String, // "Normal" | "Error" | "Warning" | "Inactive"
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InlineCompletionItem {
    pub insert_text: String,
    pub range: Option<CompletionRange>,
    pub command: Option<CompletionCommand>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CompletionRange {
    pub start: LspPosition,
    pub end: LspPosition,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LspPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CompletionCommand {
    pub command: String,
    pub arguments: Option<Vec<Value>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SignInResponse {
    pub user_code: String,
    pub verification_uri: String,
}

// ---------------------------------------------------------------------------
// JSON-RPC Transport
// ---------------------------------------------------------------------------

/// Minimal JSON-RPC 2.0 transport over stdio (Content-Length framing).
///
/// The writer half sends requests and notifications to the LSP server.
/// The reader half runs in a separate task, dispatching responses to
/// pending request channels and server-initiated notifications/requests
/// to Tauri events.
pub struct JsonRpcTransport {
    writer: Arc<Mutex<BufWriter<ChildStdin>>>,
    pending: PendingRequests,
}

impl JsonRpcTransport {
    /// Create a new transport from a child process's stdin/stdout.
    ///
    /// Spawns a background reader task that:
    /// - Routes responses to pending request channels
    /// - Handles server→client requests (window/showDocument, etc.)
    /// - Emits server→client notifications as Tauri events
    pub fn new(stdin: ChildStdin, stdout: ChildStdout, child_pid: Option<u32>, app: AppHandle) -> Self {
        let writer = Arc::new(Mutex::new(BufWriter::new(stdin)));
        let pending = json_rpc::new_pending_requests();

        let reader_pending = pending.clone();
        let reader_writer = writer.clone();

        // Spawn the reader loop
        tokio::spawn(async move {
            if let Err(e) = reader_loop(
                stdout,
                reader_pending,
                reader_writer,
                child_pid,
                app,
            )
            .await
            {
                log::error!(target: "notesage::copilot", "Reader loop exited: {}", e);
            }
        });

        Self {
            writer,
            pending,
        }
    }

    /// Send a JSON-RPC request and wait for the response.
    pub async fn send_request(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, String> {
        let id = json_rpc::next_request_id();
        let msg = JsonRpcRequest::new(id, method, params);

        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        let json = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        let mut writer = self.writer.lock().await;
        json_rpc::write_message(&mut *writer, &json).await?;
        drop(writer);

        match rx.await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(rpc_err)) => Err(rpc_err.to_string()),
            Err(_) => Err("Response channel closed (LSP process may have exited)".to_string()),
        }
    }

    /// Send a JSON-RPC notification (no response expected).
    pub async fn send_notification(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), String> {
        let msg = JsonRpcNotification::new(method, params);
        let json = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        let mut writer = self.writer.lock().await;
        json_rpc::write_message(&mut *writer, &json).await
    }
}

// ---------------------------------------------------------------------------
// Reader loop
// ---------------------------------------------------------------------------

const READER_TIMEOUT: Duration = Duration::from_secs(30);

/// Continuously reads JSON-RPC messages from the LSP server stdout.
async fn reader_loop(
    stdout: ChildStdout,
    pending: PendingRequests,
    writer: Arc<Mutex<BufWriter<ChildStdin>>>,
    child_pid: Option<u32>,
    app: AppHandle,
) -> Result<(), String> {
    let mut reader = BufReader::new(stdout);

    loop {
        // 1. Read headers until we find Content-Length (with timeout)
        let content_length = match timeout(READER_TIMEOUT, json_rpc::read_content_length(&mut reader)).await {
            Ok(result) => result?,
            Err(_) => {
                log::warn!(target: "notesage::copilot_lsp", "Reader timeout — checking process health");
                if !json_rpc::is_process_alive(child_pid) {
                    log::error!(target: "notesage::copilot_lsp", "LSP process is dead after reader timeout");
                    let _ = app.emit(
                        "copilot-status-changed",
                        serde_json::json!({
                            "message": "LSP process exited unexpectedly",
                            "kind": "Error",
                        }),
                    );
                    return Err("LSP process died during header read".to_string());
                }
                // Process is alive but slow — retry
                continue;
            }
        };

        // 2. Read the body (with timeout)
        let mut body = vec![0u8; content_length];
        match timeout(READER_TIMEOUT, reader.read_exact(&mut body)).await {
            Ok(result) => {
                result.map_err(|e| format!("Failed to read body: {}", e))?;
            }
            Err(_) => {
                log::warn!(target: "notesage::copilot_lsp", "Reader timeout reading body — checking process health");
                if !json_rpc::is_process_alive(child_pid) {
                    log::error!(target: "notesage::copilot_lsp", "LSP process is dead after body read timeout");
                    let _ = app.emit(
                        "copilot-status-changed",
                        serde_json::json!({
                            "message": "LSP process exited unexpectedly",
                            "kind": "Error",
                        }),
                    );
                    return Err("LSP process died during body read".to_string());
                }
                continue;
            }
        };

        let body_str =
            String::from_utf8(body).map_err(|e| format!("Invalid UTF-8 in body: {}", e))?;

        // 3. Parse the JSON-RPC message
        let msg: JsonRpcMessage = match serde_json::from_str(&body_str) {
            Ok(m) => m,
            Err(e) => {
                log::warn!(target: "notesage::copilot", "Failed to parse message: {} — {}", e, body_str);
                continue;
            }
        };

        // 4. Dispatch based on message type
        if let Some(method) = &msg.method {
            if msg.id.is_some() {
                // Server→client request (needs a response)
                handle_server_request(
                    method,
                    msg.id.as_ref().unwrap(),
                    msg.params.as_ref(),
                    &writer,
                    &app,
                )
                .await;
            } else {
                // Server→client notification
                handle_server_notification(method, msg.params.as_ref(), &app).await;
            }
        } else if msg.id.is_some() {
            // Response to a client→server request
            json_rpc::dispatch_response(&pending, &msg).await;
        }
    }
}

// ---------------------------------------------------------------------------
// Server→client handlers
// ---------------------------------------------------------------------------

/// Handle a request from the server that expects a response.
async fn handle_server_request(
    method: &str,
    id: &Value,
    params: Option<&Value>,
    writer: &Arc<Mutex<BufWriter<ChildStdin>>>,
    app: &AppHandle,
) {
    let response_result = match method {
        "signIn" => {
            // Server→client request: OAuth device flow sign-in data.
            // The Copilot LSP sends this after sign-in is initiated, containing
            // the device code the user must enter on GitHub.
            if let Some(params) = params {
                log::debug!(
                    target: "notesage::copilot",
                    "signIn server→client request received, raw params: {}",
                    params
                );

                let user_code = params
                    .get("userCode")
                    .and_then(|v| v.as_str())
                    .or_else(|| params.get("user_code").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string();
                let verification_uri = params
                    .get("verificationUri")
                    .and_then(|v| v.as_str())
                    .or_else(|| params.get("verification_uri").and_then(|v| v.as_str()))
                    .unwrap_or("https://github.com/login/device")
                    .to_string();

                log::debug!(
                    target: "notesage::copilot",
                    "signIn server request: userCode={}, verificationUri={}",
                    user_code, verification_uri
                );

                // Emit device code to frontend
                if !user_code.is_empty() {
                    let _ = app.emit(
                        "copilot-auth-device-code",
                        serde_json::json!({
                            "userCode": user_code,
                            "verificationUri": verification_uri,
                        }),
                    );
                }

                // Execute the embedded command to finish the device flow
                // (tells the LSP to start polling GitHub for OAuth completion)
                if let Some(command) = params.get("command") {
                    let cmd_name = command
                        .get("command")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let cmd_args = command
                        .get("arguments")
                        .cloned()
                        .unwrap_or(Value::Array(vec![]));

                    if !cmd_name.is_empty() {
                        let exec_req = JsonRpcRequest::new(
                            json_rpc::next_request_id(),
                            "workspace/executeCommand",
                            Some(serde_json::json!({
                                "command": cmd_name,
                                "arguments": cmd_args,
                            })),
                        );
                        if let Ok(json) = serde_json::to_string(&exec_req) {
                            let mut w = writer.lock().await;
                            let _ = json_rpc::write_message(&mut *w, &json).await;
                        }
                    }
                }
            }
            serde_json::json!({})
        }

        "window/showDocument" => {
            // LSP wants to open a URL (e.g., GitHub login page during auth)
            if let Some(params) = params {
                if let Some(uri) = params.get("uri").and_then(|v| v.as_str()) {
                    // Open in default browser via Tauri opener plugin
                    let _ = app.opener().open_url(uri, None::<&str>);
                    let _ = app.emit(
                        "copilot-auth-browser-open",
                        serde_json::json!({ "uri": uri }),
                    );
                }
            }
            serde_json::json!({ "success": true })
        }

        "window/showMessageRequest" => {
            // Server wants to show a message with action buttons.
            // Log it and return null (no action selected).
            if let Some(params) = params {
                if let Some(message) = params.get("message").and_then(|v| v.as_str()) {
                    log::debug!(target: "notesage::copilot", "showMessageRequest: {}", message);
                }
            }
            Value::Null
        }

        "workspace/configuration" => {
            // Server is pulling configuration. Return appropriate settings for each requested item.
            if let Some(params) = params {
                if let Some(items) = params.get("items").and_then(|v| v.as_array()) {
                    let results: Vec<Value> = items.iter().map(|item| {
                        let section = item.get("section").and_then(|v| v.as_str()).unwrap_or("");
                        match section {
                            "github.copilot" | "copilot" => serde_json::json!({
                                "enable": { "*": true, "markdown": true },
                                "inlineSuggest.enable": true,
                            }),
                            "github.copilot.inlineSuggest" => serde_json::json!({
                                "enable": true,
                            }),
                            _ => serde_json::json!({}),
                        }
                    }).collect();
                    Value::Array(results)
                } else {
                    Value::Array(vec![])
                }
            } else {
                Value::Array(vec![])
            }
        }

        _ => {
            log::debug!(target: "notesage::copilot", "Unhandled server request: {}", method);
            Value::Null
        }
    };

    // Send response
    let response = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": response_result,
    });

    if let Ok(json) = serde_json::to_string(&response) {
        let mut w = writer.lock().await;
        let _ = json_rpc::write_message(&mut *w, &json).await;
    }
}

/// Handle a notification from the server (no response needed).
async fn handle_server_notification(method: &str, params: Option<&Value>, app: &AppHandle) {
    match method {
        "didChangeStatus" => {
            // Auth status or general status change
            if let Some(params) = params {
                let message = params
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let kind = params
                    .get("kind")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Normal")
                    .to_string();

                let _ = app.emit(
                    "copilot-status-changed",
                    serde_json::json!({
                        "message": message,
                        "kind": kind,
                    }),
                );
            }
        }

        "window/logMessage" => {
            if let Some(params) = params {
                let message = params
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let msg_type = params.get("type").and_then(|v| v.as_u64()).unwrap_or(4);
                let level = match msg_type {
                    1 => "ERROR",
                    2 => "WARN",
                    3 => "INFO",
                    _ => "LOG",
                };
                log::debug!(target: "notesage::copilot", "[{}] {}", level, message);
            }
        }

        "window/showMessage" => {
            if let Some(params) = params {
                if let Some(message) = params.get("message").and_then(|v| v.as_str()) {
                    log::debug!(target: "notesage::copilot", "showMessage: {}", message);
                }
            }
        }

        _ => {
            // Ignore other notifications silently
        }
    }
}

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

pub struct CopilotLspState {
    pub process: Mutex<Option<CopilotLspProcess>>,
}

pub struct CopilotLspProcess {
    pub transport: JsonRpcTransport,
    pub child: Child,
    pub status: tokio::sync::Mutex<CopilotStatus>,
}

impl CopilotLspState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }

    /// Check liveness of the Copilot LSP process.
    pub async fn check_process(&self) -> Option<super::health::ProcessStatus> {
        let mut guard = self.process.lock().await;
        let proc = guard.as_mut()?;
        let pid = proc.child.id();
        let alive = match proc.child.try_wait() {
            Ok(None) => true,  // Still running
            Ok(Some(_)) => false, // Exited
            Err(_) => false,
        };
        Some(super::health::ProcessStatus {
            name: "copilot-language-server".to_string(),
            alive,
            pid,
        })
    }
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

const COPILOT_BINARY: &str = "copilot-language-server";

/// Resolve the path to the copilot-language-server binary.
/// Checks: 1) system PATH via `which`, 2) common npm global install locations,
/// 3) bundled node_modules relative to the app.
fn resolve_copilot_binary(app: &AppHandle) -> Option<String> {
    // 1. Check PATH via `which` — use login shell PATH if available
    //    (macOS GUI apps have a minimal inherited PATH)
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let mut cmd = Command::new(which_cmd);
    cmd.arg(COPILOT_BINARY);
    if let Some(path) = get_shell_path() {
        cmd.env("PATH", path);
    }
    if let Ok(output) = cmd.output() {
        if output.status.success() {
            let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !p.is_empty() {
                return Some(p);
            }
        }
    }

    // 2. Check common npm global install locations (Tauri GUI apps don't inherit shell PATH)
    let home = dirs::home_dir().unwrap_or_default();
    let mut candidates: Vec<PathBuf> = Vec::new();
    // Homebrew (macOS)
    for path in constants::MACOS_FALLBACK_BIN_PATHS {
        candidates.push(PathBuf::from(path).join(COPILOT_BINARY));
    }
    candidates.extend([
        // npm global (default)
        home.join(".npm-global/bin").join(COPILOT_BINARY),
        // pnpm global
        home.join("Library/pnpm").join(COPILOT_BINARY),
        home.join(".local/share/pnpm").join(COPILOT_BINARY),
    ]);

    // nvm: scan for node versions
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            for entry in entries.flatten() {
                candidates.push(entry.path().join("bin").join(COPILOT_BINARY));
            }
        }
    }

    // 3. Bundled node_modules (dev and Tauri resource path)
    candidates.push(
        std::env::current_dir()
            .unwrap_or_default()
            .join("node_modules/.bin")
            .join(COPILOT_BINARY),
    );
    candidates.push(
        app.path()
            .resource_dir()
            .unwrap_or_default()
            .join("node_modules/.bin")
            .join(COPILOT_BINARY),
    );

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Check whether the copilot-language-server binary is installed.
#[tauri::command]
pub async fn copilot_lsp_check_availability(app: AppHandle) -> Result<bool, String> {
    Ok(resolve_copilot_binary(&app).is_some())
}

/// Start the Copilot LSP server process and complete the initialize handshake.
/// If an LSP is already running, updates the workspace folder via
/// `workspace/didChangeWorkspaceFolders` instead of restarting.
#[tauri::command]
pub async fn copilot_lsp_start(
    app: AppHandle,
    state: State<'_, CopilotLspState>,
    working_directory: String,
) -> Result<(), String> {
    let mut guard = state.process.lock().await;

    // If already running, reuse and update workspace folder
    if let Some(proc) = guard.as_mut() {
        match proc.child.try_wait() {
            Ok(Some(_)) => {
                // Process already exited — clear stale state, restart below
                *guard = None;
            }
            Ok(None) => {
                // Still running — update workspace folder instead of restarting
                let new_uri = path_to_uri(&working_directory);
                let folder_name = working_directory.rsplit('/').next().unwrap_or("workspace");

                proc.transport
                    .send_notification(
                        "workspace/didChangeWorkspaceFolders",
                        Some(serde_json::json!({
                            "event": {
                                "added": [{
                                    "uri": new_uri,
                                    "name": folder_name,
                                }],
                                "removed": [],
                            },
                        })),
                    )
                    .await
                    .map_err(|e| format!("Failed to update workspace folders: {}", e))?;

                return Ok(());
            }
            Err(_) => {
                *guard = None;
            }
        }
    }

    let binary_path = resolve_copilot_binary(&app)
        .ok_or_else(|| "copilot-language-server not found. Install via: npm install -g @github/copilot-language-server".to_string())?;

    // Spawn the LSP process — inject login shell PATH so the process
    // (a Node.js script) can find Node and other dependencies
    let mut spawn_cmd = tokio::process::Command::new(&binary_path);
    spawn_cmd
        .arg("--stdio")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    if let Some(shell_path) = get_shell_path() {
        spawn_cmd.env("PATH", shell_path);
    }
    let mut child = spawn_cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn copilot-language-server: {}", e))?;

    let child_pid = child.id();
    let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

    // Create the JSON-RPC transport (spawns reader loop)
    let transport = JsonRpcTransport::new(stdin, stdout, child_pid, app.clone());

    // Read app version from package.json (via Tauri config)
    let app_version = app
        .config()
        .version
        .clone()
        .unwrap_or_else(|| "0.0.0".to_string());

    // --- LSP initialize handshake ---

    // 1. Send initialize request
    let workspace_uri = path_to_uri(&working_directory);

    let init_params = serde_json::json!({
        "processId": std::process::id(),
        "workspaceFolders": [{
            "uri": workspace_uri,
            "name": working_directory.rsplit('/').next().unwrap_or("workspace"),
        }],
        "capabilities": {
            "workspace": {
                "workspaceFolders": true,
                "configuration": true,
            },
            "textDocument": {
                "synchronization": {
                    "dynamicRegistration": false,
                    "willSave": false,
                    "didSave": false,
                    "willSaveWaitUntil": false,
                },
                "inlineCompletion": {
                    "dynamicRegistration": false,
                },
            },
        },
        "initializationOptions": {
            "editorInfo": {
                "name": "Notesage",
                "version": app_version,
            },
            "editorPluginInfo": {
                "name": "notesage-copilot",
                "version": app_version,
            },
        },
    });

    transport
        .send_request("initialize", Some(init_params))
        .await
        .map_err(|e| format!("LSP initialize failed: {}", e))?;

    // 2. Send initialized notification
    transport
        .send_notification("initialized", Some(serde_json::json!({})))
        .await
        .map_err(|e| format!("LSP initialized notification failed: {}", e))?;

    // 3. Send configuration: enable copilot + inline suggestions, disable telemetry
    transport
        .send_notification(
            "workspace/didChangeConfiguration",
            Some(serde_json::json!({
                "settings": {
                    "telemetry": { "telemetryLevel": "off" },
                    "github.copilot": {
                        "enable": { "*": true, "markdown": true },
                        "inlineSuggest.enable": true,
                    },
                },
            })),
        )
        .await
        .map_err(|e| format!("LSP didChangeConfiguration failed: {}", e))?;

    let status = CopilotStatus {
        authenticated: false,
        message: "Started".to_string(),
        kind: "Normal".to_string(),
    };

    *guard = Some(CopilotLspProcess {
        transport,
        child,
        status: tokio::sync::Mutex::new(status),
    });

    Ok(())
}

/// Stop the Copilot LSP server process.
#[tauri::command]
pub async fn copilot_lsp_stop(
    app: AppHandle,
    state: State<'_, CopilotLspState>,
) -> Result<(), String> {
    let mut guard = state.process.lock().await;

    if let Some(mut process) = guard.take() {
        // Try graceful shutdown: send shutdown request, then exit notification
        let shutdown_result = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            process.transport.send_request("shutdown", None),
        )
        .await;

        if shutdown_result.is_ok() {
            let _ = process
                .transport
                .send_notification("exit", None)
                .await;
        }

        // Give the process a moment to exit, then force kill
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            process.child.wait(),
        )
        .await;

        // Force kill if still alive
        let _ = process.child.kill().await;

        let _ = app.emit(
            "copilot-status-changed",
            serde_json::json!({
                "message": "Stopped",
                "kind": "Inactive",
            }),
        );
    }

    Ok(())
}

/// Get the current Copilot LSP status by sending a checkStatus request.
#[tauri::command]
pub async fn copilot_lsp_status(
    state: State<'_, CopilotLspState>,
) -> Result<CopilotStatus, String> {
    let guard = state.process.lock().await;

    match guard.as_ref() {
        Some(process) => {
            // Actively query the LSP for current auth status
            match process
                .transport
                .send_request("checkStatus", Some(serde_json::json!({})))
                .await
            {
                Ok(result) => {
                    let status_str = result
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let user = result
                        .get("user")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    // Copilot LSP returns status: "OK" when authenticated,
                    // "NotSignedIn" or similar when not
                    let authenticated = status_str == "OK"
                        || status_str == "MaybeOk"
                        || status_str.contains("OK");
                    let message = if authenticated {
                        format!("Signed in as {}", user)
                    } else {
                        format!("Status: {}", status_str)
                    };
                    Ok(CopilotStatus {
                        authenticated,
                        message,
                        kind: if authenticated { "Normal".to_string() } else { "Inactive".to_string() },
                    })
                }
                Err(e) => {
                    log::warn!(target: "notesage::copilot", "checkStatus failed: {}", e);
                    Ok(CopilotStatus {
                        authenticated: false,
                        message: format!("checkStatus failed: {}", e),
                        kind: "Error".to_string(),
                    })
                }
            }
        }
        None => {
            Ok(CopilotStatus {
                authenticated: false,
                message: "Not running".to_string(),
                kind: "Inactive".to_string(),
            })
        }
    }
}

/// Sign in to GitHub Copilot via OAuth device flow.
///
/// Three-phase approach:
/// 1. Try the direct `signIn` JSON-RPC method — works with older LSP versions
///    that return `{ userCode, verificationUri, command }` directly.
/// 2. If step 1 fails or returns an empty device code, fall back to executing
///    the `github.copilot.signInInitiate` workspace command. Per the official
///    Copilot LSP docs, this returns `{ userCode, command }` in the response.
///    The embedded command (`github.copilot.finishDeviceFlow`) is executed to
///    start the OAuth device flow polling.
/// 3. As a last resort, if neither phase returns a device code in the response,
///    wait for the LSP to send the code asynchronously via a server→client
///    `signIn` request (handled in `handle_server_request`, emitted as the
///    `copilot-auth-device-code` Tauri event).
///
/// Auth completion is signalled asynchronously via
/// `didChangeStatus` → `copilot-status-changed` Tauri event.
#[tauri::command]
pub async fn copilot_lsp_sign_in(
    app: AppHandle,
    state: State<'_, CopilotLspState>,
) -> Result<SignInResponse, String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running. Call copilot_lsp_start first.")?;

    // --- Phase 1: Try direct signIn RPC ---
    // Some older LSP versions support `signIn` as a client→server method.
    // Use `match` instead of `?` so we can fall through to Phase 2 on error.
    log::debug!(target: "notesage::copilot", "Phase 1: Sending signIn RPC...");
    match process
        .transport
        .send_request("signIn", Some(serde_json::json!({})))
        .await
    {
        Ok(result) => {
            log::debug!(target: "notesage::copilot", "Phase 1 signIn response: {}", result);

            let user_code = extract_user_code_from_result(&result);
            let verification_uri = extract_verification_uri(&result);

            if !user_code.is_empty() {
                log::debug!(
                    target: "notesage::copilot",
                    "Phase 1 succeeded — userCode={}, verificationUri={}",
                    user_code, verification_uri
                );

                // Execute the embedded command to trigger the device flow.
                execute_embedded_command(process, &result).await;

                let _ = app.emit(
                    "copilot-auth-device-code",
                    serde_json::json!({
                        "userCode": user_code,
                        "verificationUri": verification_uri,
                    }),
                );

                return Ok(SignInResponse {
                    user_code,
                    verification_uri,
                });
            }

            log::debug!(target: "notesage::copilot", "Phase 1: signIn returned no device code, falling to Phase 2");
        }
        Err(e) => {
            // signIn might not be supported — fall through to Phase 2
            log::debug!(
                target: "notesage::copilot",
                "Phase 1: signIn RPC failed (non-fatal, falling to Phase 2): {}",
                e
            );
        }
    }

    // --- Phase 2: signInInitiate workspace command (official flow) ---
    // Per the Copilot LSP docs, `signInInitiate` returns `{ userCode, command }`
    // in the response. We must extract it and execute the embedded command.
    log::debug!(target: "notesage::copilot", "Phase 2: Sending workspace/executeCommand(signInInitiate)...");

    match process
        .transport
        .send_request(
            "workspace/executeCommand",
            Some(serde_json::json!({
                "command": "github.copilot.signInInitiate",
                "arguments": [],
            })),
        )
        .await
    {
        Ok(result) => {
            log::debug!(target: "notesage::copilot", "Phase 2 signInInitiate response: {}", result);

            let user_code = extract_user_code_from_result(&result);
            let verification_uri = extract_verification_uri(&result);

            if !user_code.is_empty() {
                log::debug!(
                    target: "notesage::copilot",
                    "Phase 2 succeeded — userCode={}, verificationUri={}",
                    user_code, verification_uri
                );

                // Execute the embedded command (e.g. github.copilot.finishDeviceFlow)
                // to start OAuth polling and open the browser.
                execute_embedded_command(process, &result).await;

                let _ = app.emit(
                    "copilot-auth-device-code",
                    serde_json::json!({
                        "userCode": user_code,
                        "verificationUri": verification_uri,
                    }),
                );

                return Ok(SignInResponse {
                    user_code,
                    verification_uri,
                });
            }

            log::debug!(
                target: "notesage::copilot",
                "Phase 2: signInInitiate returned no device code in response"
            );
        }
        Err(e) => {
            log::debug!(target: "notesage::copilot", "Phase 2: signInInitiate command failed: {}", e);
        }
    }

    // --- Phase 3: Wait for asynchronous device code ---
    // Neither phase returned a device code in the response. The LSP may send
    // the code asynchronously via a server→client `signIn` request, which is
    // handled in `handle_server_request` and emitted as `copilot-auth-device-code`.
    log::debug!(
        target: "notesage::copilot",
        "Both phases returned no device code — waiting for server→client signIn request"
    );

    Ok(SignInResponse {
        user_code: String::new(),
        verification_uri: "https://github.com/login/device".to_string(),
    })
}

/// Sign out of GitHub Copilot.
#[tauri::command]
pub async fn copilot_lsp_sign_out(
    state: State<'_, CopilotLspState>,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_request("signOut", Some(serde_json::json!({})))
        .await
        .map_err(|e| format!("signOut failed: {}", e))?;

    // Update local status
    let mut status = process.status.lock().await;
    status.authenticated = false;
    status.message = "Signed out".to_string();

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract userCode from a JSON-RPC result, trying multiple field name variants.
/// Also falls back to extracting from verificationUri query parameters.
fn extract_user_code_from_result(result: &Value) -> String {
    // Try direct field names (LSP versions vary between camelCase and snake_case)
    let user_code = result
        .get("userCode")
        .and_then(|v| v.as_str())
        .or_else(|| result.get("user_code").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();

    if !user_code.is_empty() {
        return user_code;
    }

    // Try extracting from verificationUri query parameters
    let verification_uri = result
        .get("verificationUri")
        .and_then(|v| v.as_str())
        .or_else(|| result.get("verification_uri").and_then(|v| v.as_str()))
        .unwrap_or("");
    if let Some(code) = extract_code_from_uri(verification_uri) {
        log::debug!(target: "notesage::copilot", "Extracted user_code from URI: {}", code);
        return code;
    }

    String::new()
}

/// Extract verificationUri from a JSON-RPC result.
fn extract_verification_uri(result: &Value) -> String {
    result
        .get("verificationUri")
        .and_then(|v| v.as_str())
        .or_else(|| result.get("verification_uri").and_then(|v| v.as_str()))
        .unwrap_or("https://github.com/login/device")
        .to_string()
}

/// Execute the embedded command from a signIn/signInInitiate response.
/// The response typically contains a `command` object like:
/// `{ "command": "github.copilot.finishDeviceFlow", "arguments": [...] }`
async fn execute_embedded_command(process: &CopilotLspProcess, result: &Value) {
    if let Some(command) = result.get("command") {
        let cmd_name = command
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let cmd_args = command
            .get("arguments")
            .cloned()
            .unwrap_or(Value::Array(vec![]));

        if !cmd_name.is_empty() {
            log::debug!(
                target: "notesage::copilot",
                "Executing embedded command: {} with args: {}",
                cmd_name, cmd_args
            );
            if let Err(e) = process
                .transport
                .send_request(
                    "workspace/executeCommand",
                    Some(serde_json::json!({
                        "command": cmd_name,
                        "arguments": cmd_args,
                    })),
                )
                .await
            {
                log::error!(target: "notesage::copilot", "Failed to execute embedded command '{}': {}", cmd_name, e);
            }
        }
    }
}

/// Try to extract a user code from a verification URI's query parameters.
/// e.g. `https://github.com/login/device?user_code=ABCD-1234` → Some("ABCD-1234")
fn extract_code_from_uri(uri: &str) -> Option<String> {
    let query = uri.split('?').nth(1)?;
    for param in query.split('&') {
        let mut kv = param.splitn(2, '=');
        let key = kv.next()?;
        let value = kv.next()?;
        if key == "user_code" || key == "userCode" || key == "code" {
            let decoded = value.replace("%20", " ").replace('+', " ");
            if !decoded.is_empty() {
                return Some(decoded);
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Document sync commands
// ---------------------------------------------------------------------------

/// Convert a file path to a file:// URI.
fn path_to_uri(path: &str) -> String {
    // URL-encode path segments (spaces → %20, etc.) while preserving /
    let encoded: String = path
        .split('/')
        .map(|seg| {
            seg.bytes()
                .map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                        format!("{}", b as char)
                    }
                    _ => format!("%{:02X}", b),
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/");

    if path.starts_with('/') {
        format!("file://{}", encoded)
    } else {
        // Windows: file:///C:/path
        format!("file:///{}", encoded)
    }
}

/// Notify the LSP that a document was opened.
#[tauri::command]
pub async fn copilot_lsp_did_open(
    state: State<'_, CopilotLspState>,
    uri: String,
    content: String,
    version: u32,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard.as_ref().ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_notification(
            "textDocument/didOpen",
            Some(serde_json::json!({
                "textDocument": {
                    "uri": path_to_uri(&uri),
                    "languageId": "markdown",
                    "version": version,
                    "text": content,
                },
            })),
        )
        .await
}

/// Notify the LSP that a document's content changed.
/// Uses full-content replacement (single change covering the entire document).
#[tauri::command]
pub async fn copilot_lsp_did_change(
    state: State<'_, CopilotLspState>,
    uri: String,
    content: String,
    version: u32,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard.as_ref().ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_notification(
            "textDocument/didChange",
            Some(serde_json::json!({
                "textDocument": {
                    "uri": path_to_uri(&uri),
                    "version": version,
                },
                "contentChanges": [{
                    "text": content,
                }],
            })),
        )
        .await
}

/// Notify the LSP that a document was closed.
#[tauri::command]
pub async fn copilot_lsp_did_close(
    state: State<'_, CopilotLspState>,
    uri: String,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard.as_ref().ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_notification(
            "textDocument/didClose",
            Some(serde_json::json!({
                "textDocument": {
                    "uri": path_to_uri(&uri),
                },
            })),
        )
        .await
}

/// Notify the LSP that a document received focus (custom Copilot method).
#[tauri::command]
pub async fn copilot_lsp_did_focus(
    state: State<'_, CopilotLspState>,
    uri: String,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard.as_ref().ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_notification(
            "textDocument/didFocus",
            Some(serde_json::json!({
                "textDocument": {
                    "uri": path_to_uri(&uri),
                },
            })),
        )
        .await
}

// ---------------------------------------------------------------------------
// Completion commands
// ---------------------------------------------------------------------------

/// Request inline completions at a cursor position.
#[tauri::command]
pub async fn copilot_lsp_request_completion(
    state: State<'_, CopilotLspState>,
    uri: String,
    line: u32,
    character: u32,
    version: u32,
) -> Result<Vec<InlineCompletionItem>, String> {
    let guard = state.process.lock().await;
    let process = guard.as_ref().ok_or("Copilot LSP not running.")?;

    let req_params = serde_json::json!({
        "textDocument": {
            "uri": path_to_uri(&uri),
            "version": version,
        },
        "position": {
            "line": line,
            "character": character,
        },
        "context": {
            "triggerKind": 2,
        },
        "formattingOptions": {
            "tabSize": 2,
            "insertSpaces": true,
        },
    });

    let result = process
        .transport
        .send_request("textDocument/inlineCompletion", Some(req_params))
        .await
        .map_err(|e| format!("Completion request failed: {}", e))?;

    // Parse the response: { items: [...] } or null
    let items = result
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let completions: Vec<InlineCompletionItem> = items
        .into_iter()
        .filter_map(|item| {
            let insert_text = item.get("insertText")?.as_str()?.to_string();

            let range = item.get("range").and_then(|r| {
                Some(CompletionRange {
                    start: LspPosition {
                        line: r.get("start")?.get("line")?.as_u64()? as u32,
                        character: r.get("start")?.get("character")?.as_u64()? as u32,
                    },
                    end: LspPosition {
                        line: r.get("end")?.get("line")?.as_u64()? as u32,
                        character: r.get("end")?.get("character")?.as_u64()? as u32,
                    },
                })
            });

            let command = item.get("command").and_then(|c| {
                Some(CompletionCommand {
                    command: c.get("command")?.as_str()?.to_string(),
                    arguments: c
                        .get("arguments")
                        .and_then(|a| a.as_array().cloned()),
                })
            });

            Some(InlineCompletionItem {
                insert_text,
                range,
                command,
            })
        })
        .collect();

    Ok(completions)
}

/// Notify the LSP that a completion was shown to the user.
#[tauri::command]
pub async fn copilot_lsp_did_show_completion(
    state: State<'_, CopilotLspState>,
    item: Value,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard.as_ref().ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_notification(
            "textDocument/didShowCompletion",
            Some(serde_json::json!({ "item": item })),
        )
        .await
}

/// Accept a completion by executing its tracking command.
#[tauri::command]
pub async fn copilot_lsp_accept_completion(
    state: State<'_, CopilotLspState>,
    command: String,
    arguments: Option<Vec<Value>>,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard.as_ref().ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_request(
            "workspace/executeCommand",
            Some(serde_json::json!({
                "command": command,
                "arguments": arguments.unwrap_or_default(),
            })),
        )
        .await
        .map_err(|e| format!("Accept completion failed: {}", e))?;

    Ok(())
}
