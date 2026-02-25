use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::{oneshot, Mutex};

use super::shell_path::get_shell_path;

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
// JSON-RPC 2.0 message types
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug)]
struct JsonRpcRequest {
    jsonrpc: &'static str,
    id: u64,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Serialize, Debug)]
struct JsonRpcNotification {
    jsonrpc: &'static str,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

/// A response from the server, or a request from the server (has id + method).
#[derive(Deserialize, Debug)]
struct JsonRpcMessage {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    id: Option<Value>,
    method: Option<String>,
    params: Option<Value>,
    result: Option<Value>,
    error: Option<JsonRpcError>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[allow(dead_code)]
    pub data: Option<Value>,
}

impl std::fmt::Display for JsonRpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "JSON-RPC error {}: {}", self.code, self.message)
    }
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
    next_id: Arc<AtomicU64>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, JsonRpcError>>>>>,
}

impl JsonRpcTransport {
    /// Create a new transport from a child process's stdin/stdout.
    ///
    /// Spawns a background reader task that:
    /// - Routes responses to pending request channels
    /// - Handles server→client requests (window/showDocument, etc.)
    /// - Emits server→client notifications as Tauri events
    pub fn new(stdin: ChildStdin, stdout: ChildStdout, app: AppHandle) -> Self {
        let writer = Arc::new(Mutex::new(BufWriter::new(stdin)));
        let next_id = Arc::new(AtomicU64::new(1));
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, JsonRpcError>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let reader_pending = pending.clone();
        let reader_writer = writer.clone();
        let reader_next_id = next_id.clone();

        // Spawn the reader loop
        tokio::spawn(async move {
            if let Err(e) = reader_loop(
                stdout,
                reader_pending,
                reader_writer,
                reader_next_id,
                app,
            )
            .await
            {
                eprintln!("[copilot-lsp] reader loop exited: {}", e);
            }
        });

        Self {
            writer,
            next_id,
            pending,
        }
    }

    /// Send a JSON-RPC request and wait for the response.
    pub async fn send_request(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);

        let msg = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method: method.to_string(),
            params,
        };

        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        self.write_message(&serde_json::to_string(&msg).map_err(|e| e.to_string())?)
            .await?;

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
        let msg = JsonRpcNotification {
            jsonrpc: "2.0",
            method: method.to_string(),
            params,
        };

        self.write_message(&serde_json::to_string(&msg).map_err(|e| e.to_string())?)
            .await
    }

    /// Write a raw JSON-RPC message with Content-Length framing.
    async fn write_message(&self, json: &str) -> Result<(), String> {
        let header = format!("Content-Length: {}\r\n\r\n", json.len());
        let mut writer = self.writer.lock().await;
        writer
            .write_all(header.as_bytes())
            .await
            .map_err(|e| format!("Failed to write header: {}", e))?;
        writer
            .write_all(json.as_bytes())
            .await
            .map_err(|e| format!("Failed to write body: {}", e))?;
        writer
            .flush()
            .await
            .map_err(|e| format!("Failed to flush: {}", e))?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Reader loop
// ---------------------------------------------------------------------------

/// Continuously reads JSON-RPC messages from the LSP server stdout.
async fn reader_loop(
    stdout: ChildStdout,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, JsonRpcError>>>>>,
    writer: Arc<Mutex<BufWriter<ChildStdin>>>,
    next_id: Arc<AtomicU64>,
    app: AppHandle,
) -> Result<(), String> {
    let mut reader = BufReader::new(stdout);

    loop {
        // 1. Read headers until we find Content-Length
        let content_length = read_content_length(&mut reader).await?;

        // 2. Read the body
        let mut body = vec![0u8; content_length];
        reader
            .read_exact(&mut body)
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;

        let body_str =
            String::from_utf8(body).map_err(|e| format!("Invalid UTF-8 in body: {}", e))?;

        // 3. Parse the JSON-RPC message
        let msg: JsonRpcMessage = match serde_json::from_str(&body_str) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[copilot-lsp] Failed to parse message: {} — {}", e, body_str);
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
                    &next_id,
                    &app,
                )
                .await;
            } else {
                // Server→client notification
                handle_server_notification(method, msg.params.as_ref(), &app).await;
            }
        } else if let Some(id_val) = &msg.id {
            // Response to a client→server request
            let id = match id_val {
                Value::Number(n) => n.as_u64().unwrap_or(0),
                _ => 0,
            };

            let mut map = pending.lock().await;
            if let Some(tx) = map.remove(&id) {
                if let Some(err) = msg.error {
                    let _ = tx.send(Err(err));
                } else {
                    let _ = tx.send(Ok(msg.result.unwrap_or(Value::Null)));
                }
            }
        }
    }
}

/// Parse Content-Length from LSP headers.
/// Headers are `Key: Value\r\n` lines terminated by an empty `\r\n` line.
async fn read_content_length(
    reader: &mut BufReader<ChildStdout>,
) -> Result<usize, String> {
    let mut content_length: Option<usize> = None;

    loop {
        let mut line = String::new();
        let bytes_read = reader
            .read_line(&mut line)
            .await
            .map_err(|e| format!("Failed to read header line: {}", e))?;

        if bytes_read == 0 {
            return Err("EOF while reading headers (LSP process exited)".to_string());
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            // End of headers
            break;
        }

        if let Some(val) = trimmed.strip_prefix("Content-Length:") {
            content_length = val.trim().parse().ok();
        }
        // Ignore other headers (e.g., Content-Type)
    }

    content_length.ok_or_else(|| "Missing Content-Length header".to_string())
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
    _next_id: &Arc<AtomicU64>,
    app: &AppHandle,
) {
    let response_result = match method {
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
                    eprintln!("[copilot-lsp] showMessageRequest: {}", message);
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
            eprintln!("[copilot-lsp] Unhandled server request: {}", method);
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
        let header = format!("Content-Length: {}\r\n\r\n", json.len());
        let mut w = writer.lock().await;
        let _ = w.write_all(header.as_bytes()).await;
        let _ = w.write_all(json.as_bytes()).await;
        let _ = w.flush().await;
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
                eprintln!("[copilot-lsp] [{}] {}", level, message);
            }
        }

        "window/showMessage" => {
            if let Some(params) = params {
                if let Some(message) = params.get("message").and_then(|v| v.as_str()) {
                    eprintln!("[copilot-lsp] showMessage: {}", message);
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
    let mut candidates: Vec<PathBuf> = vec![
        // Homebrew (macOS)
        PathBuf::from("/opt/homebrew/bin").join(COPILOT_BINARY),
        PathBuf::from("/usr/local/bin").join(COPILOT_BINARY),
        // npm global (default)
        home.join(".npm-global/bin").join(COPILOT_BINARY),
        // pnpm global
        home.join("Library/pnpm").join(COPILOT_BINARY),
        home.join(".local/share/pnpm").join(COPILOT_BINARY),
    ];

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

    let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

    // Create the JSON-RPC transport (spawns reader loop)
    let transport = JsonRpcTransport::new(stdin, stdout, app.clone());

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
                    eprintln!("[copilot-lsp] checkStatus failed: {}", e);
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
/// Sends the `signIn` request to the LSP, which returns a device code.
/// The LSP then opens a browser via `window/showDocument` (handled by the
/// reader loop). Auth completion is signalled asynchronously via
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

    // Send signIn request — returns { userCode, command } or { user_code, verification_uri }
    let result = process
        .transport
        .send_request("signIn", Some(serde_json::json!({})))
        .await
        .map_err(|e| format!("signIn failed: {}", e))?;

    eprintln!("[copilot-lsp] signIn response: {}", result);

    // Try multiple field names for the device code (LSP versions vary)
    let user_code = result
        .get("userCode")
        .and_then(|v| v.as_str())
        .or_else(|| result.get("user_code").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();

    // Try to extract verification URI from response, with fallback
    let verification_uri = result
        .get("verificationUri")
        .and_then(|v| v.as_str())
        .or_else(|| result.get("verification_uri").and_then(|v| v.as_str()))
        .unwrap_or("https://github.com/login/device")
        .to_string();

    // If user_code is empty, try extracting from verificationUri query params
    let user_code = if user_code.is_empty() {
        if let Some(code) = extract_code_from_uri(&verification_uri) {
            eprintln!("[copilot-lsp] Extracted user_code from URI: {}", code);
            code
        } else {
            eprintln!("[copilot-lsp] WARNING: Could not extract user_code from signIn response");
            let _ = app.emit(
                "copilot-sign-in-error",
                serde_json::json!({
                    "message": "Sign-in returned empty device code. The LSP response format may have changed.",
                    "response": result.to_string(),
                }),
            );
            String::new()
        }
    } else {
        user_code
    };

    // Extract the command to execute (triggers browser opening)
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
            // Execute the command via workspace/executeCommand
            // This tells the LSP to proceed with the device flow
            let _ = process
                .transport
                .send_request(
                    "workspace/executeCommand",
                    Some(serde_json::json!({
                        "command": cmd_name,
                        "arguments": cmd_args,
                    })),
                )
                .await;
        }
    }

    // Emit device code event for the frontend
    let _ = app.emit(
        "copilot-auth-device-code",
        serde_json::json!({
            "userCode": user_code,
            "verificationUri": verification_uri,
        }),
    );

    Ok(SignInResponse {
        user_code,
        verification_uri,
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
