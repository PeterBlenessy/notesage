use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{BufReader, BufWriter};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;

use super::json_rpc::{
    self, JsonRpcRequest, JsonRpcTransport, PendingRequests,
    ReadMessageResult,
};
use super::shell_path::get_shell_path;
use super::constants;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "PascalCase")]
pub enum CopilotStatusKind {
    Normal,
    Error,
    Warning,
    Inactive,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CopilotStatus {
    pub authenticated: bool,
    pub message: String,
    pub kind: CopilotStatusKind,
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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CopilotModel {
    pub id: String,
    pub name: String,
    pub provider: String,
}

/// Pending server→client request responses (tool calls, context requests).
/// Key: a unique request correlation ID, Value: oneshot sender for the response.
type PendingServerRequests = Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>>;

// ---------------------------------------------------------------------------
// Copilot LSP Transport — wraps shared JsonRpcTransport with LSP-specific
// logging and reader loop setup.
// ---------------------------------------------------------------------------

/// Spawn a Copilot LSP transport: creates a `JsonRpcTransport` for stdin and
/// starts the LSP-specific reader loop on stdout (handles server→client
/// requests, notifications, and auth flows). Returns the transport handle.
fn spawn_copilot_transport(
    stdin: ChildStdin,
    stdout: ChildStdout,
    child_pid: Option<u32>,
    app: AppHandle,
    pending_server_requests: PendingServerRequests,
) -> JsonRpcTransport {
    let transport = JsonRpcTransport::new(stdin);
    let reader_pending = transport.pending.clone();
    let reader_writer = transport.writer.clone();

    tokio::spawn(async move {
        if let Err(e) = reader_loop(
            stdout,
            reader_pending,
            reader_writer,
            child_pid,
            app,
            pending_server_requests,
        )
        .await
        {
            log::error!(target: "notesage::copilot", "Reader loop exited: {}", e);
        }
    });

    transport
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
    pending_server_requests: PendingServerRequests,
) -> Result<(), String> {
    let mut reader = BufReader::new(stdout);

    loop {
        let msg = match json_rpc::read_next_message(&mut reader, READER_TIMEOUT, child_pid).await {
            ReadMessageResult::Message(msg) => msg,
            ReadMessageResult::Timeout => {
                log::warn!(target: "notesage::copilot_lsp", "Reader timeout — retrying");
                continue;
            }
            ReadMessageResult::Fatal(e) => {
                log::error!(target: "notesage::copilot_lsp", "Reader fatal: {}", e);
                let _ = app.emit(
                    "copilot-status-changed",
                    serde_json::json!({
                        "message": "LSP process exited unexpectedly",
                        "kind": "Error",
                    }),
                );
                return Err(format!("Copilot LSP reader: {}", e));
            }
        };

        // --- Comprehensive message logging ---
        // Log every incoming LSP message at info level for auth debugging.
        // Also emit to frontend as `copilot-lsp-message` event for browser console.
        if let Some(method) = &msg.method {
            if msg.id.is_some() {
                let log_msg = format!(
                    "LSP ← server request: method={}, id={}, params={}",
                    method,
                    msg.id.as_ref().map(|v| v.to_string()).unwrap_or_default(),
                    msg.params.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "null".to_string()),
                );
                log::debug!(target: "notesage::copilot", "{}", log_msg);
                let _ = app.emit("copilot-lsp-message", serde_json::json!({
                    "direction": "incoming",
                    "type": "server_request",
                    "method": method,
                    "id": msg.id,
                    "params": msg.params,
                }));
            } else {
                let log_msg = format!(
                    "LSP ← notification: method={}, params={}",
                    method,
                    msg.params.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "null".to_string()),
                );
                log::debug!(target: "notesage::copilot", "{}", log_msg);
                let _ = app.emit("copilot-lsp-message", serde_json::json!({
                    "direction": "incoming",
                    "type": "notification",
                    "method": method,
                    "params": msg.params,
                }));
            }
        } else if msg.id.is_some() {
            let log_msg = format!(
                "LSP ← response: id={}, result={}, error={}",
                msg.id.as_ref().map(|v| v.to_string()).unwrap_or_default(),
                msg.result.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "null".to_string()),
                msg.error.as_ref().map(|e| format!("{}", e)).unwrap_or_else(|| "null".to_string()),
            );
            log::debug!(target: "notesage::copilot", "{}", log_msg);
            let _ = app.emit("copilot-lsp-message", serde_json::json!({
                "direction": "incoming",
                "type": "response",
                "id": msg.id,
                "result": msg.result,
                "error": msg.error.as_ref().map(|e| format!("{}", e)),
            }));
        }

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
                    &pending_server_requests,
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
    pending_server_requests: &PendingServerRequests,
) {
    let response_result = match method {
        "signIn" => {
            // Server→client request: OAuth device flow sign-in data.
            // The Copilot LSP sends this after sign-in is initiated, containing
            // the device code the user must enter on GitHub.
            if let Some(params) = params {
                log::info!(
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

                log::info!(
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
            // LSP wants to open a URL (e.g., GitHub login page during auth).
            // Don't auto-open — let the frontend control when the browser opens
            // so the user sees the device code first.
            if let Some(params) = params {
                if let Some(uri) = params.get("uri").and_then(|v| v.as_str()) {
                    log::info!(target: "notesage::copilot", "window/showDocument: {} (suppressed auto-open)", uri);
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

        "conversation/context" => {
            // Server requests editor context during conversation turn processing.
            // Emit a Tauri event to collect context from the frontend, wait for response
            // via oneshot channel with 10s timeout.
            let request_id = format!("ctx-{}", json_rpc::next_request_id());
            let (tx, rx) = tokio::sync::oneshot::channel();
            pending_server_requests.lock().await.insert(request_id.clone(), tx);

            let _ = app.emit("copilot-context-request", serde_json::json!({
                "requestId": request_id,
                "skillId": params.and_then(|p| p.get("skillId")).and_then(|v| v.as_str()).unwrap_or("current-editor"),
                "conversationId": params.and_then(|p| p.get("conversationId")).and_then(|v| v.as_str()).unwrap_or(""),
                "turnId": params.and_then(|p| p.get("turnId")).and_then(|v| v.as_str()).unwrap_or(""),
            }));

            match tokio::time::timeout(Duration::from_secs(10), rx).await {
                Ok(Ok(result)) => result,
                Ok(Err(_)) => {
                    log::warn!(target: "notesage::copilot", "conversation/context channel closed");
                    serde_json::json!([null, null])
                }
                Err(_) => {
                    log::warn!(target: "notesage::copilot", "conversation/context timed out after 10s");
                    pending_server_requests.lock().await.remove(&request_id);
                    serde_json::json!([null, null])
                }
            }
        }

        "conversation/invokeClientTool" => {
            // Server requests tool execution. Emit event, wait for frontend to execute
            // and send result back via copilot_lsp_tool_result command.
            let request_id = format!("tool-{}", json_rpc::next_request_id());
            let (tx, rx) = tokio::sync::oneshot::channel();
            pending_server_requests.lock().await.insert(request_id.clone(), tx);

            let tool_name = params.and_then(|p| p.get("name")).and_then(|v| v.as_str()).unwrap_or("");
            let tool_input = params.and_then(|p| p.get("input")).cloned().unwrap_or(Value::Null);
            let tool_call_id = params.and_then(|p| p.get("toolCallId")).and_then(|v| v.as_str()).unwrap_or("");

            let _ = app.emit("copilot-tool-call", serde_json::json!({
                "requestId": request_id,
                "id": tool_call_id,
                "name": tool_name,
                "arguments": tool_input,
                "conversationId": params.and_then(|p| p.get("conversationId")).and_then(|v| v.as_str()).unwrap_or(""),
            }));

            match tokio::time::timeout(Duration::from_secs(60), rx).await {
                Ok(Ok(result)) => result,
                Ok(Err(_)) => {
                    log::warn!(target: "notesage::copilot", "conversation/invokeClientTool channel closed");
                    serde_json::json!({"status": "error", "content": [{"value": "Tool execution channel closed"}]})
                }
                Err(_) => {
                    log::warn!(target: "notesage::copilot", "conversation/invokeClientTool timed out after 60s");
                    pending_server_requests.lock().await.remove(&request_id);
                    serde_json::json!({"status": "error", "content": [{"value": "Tool execution timed out"}]})
                }
            }
        }

        "conversation/invokeClientToolConfirmation" => {
            // Server requests user confirmation before tool execution.
            let request_id = format!("confirm-{}", json_rpc::next_request_id());
            let (tx, rx) = tokio::sync::oneshot::channel();
            pending_server_requests.lock().await.insert(request_id.clone(), tx);

            let tool_name = params.and_then(|p| p.get("name")).and_then(|v| v.as_str()).unwrap_or("");
            let tool_call_id = params.and_then(|p| p.get("toolCallId")).and_then(|v| v.as_str()).unwrap_or("");
            let title = params.and_then(|p| p.get("title")).and_then(|v| v.as_str()).unwrap_or("");
            let message = params.and_then(|p| p.get("message")).and_then(|v| v.as_str()).unwrap_or("");

            let _ = app.emit("copilot-tool-confirmation", serde_json::json!({
                "requestId": request_id,
                "id": tool_call_id,
                "name": tool_name,
                "title": title,
                "description": message,
                "conversationId": params.and_then(|p| p.get("conversationId")).and_then(|v| v.as_str()).unwrap_or(""),
            }));

            match tokio::time::timeout(Duration::from_secs(30), rx).await {
                Ok(Ok(result)) => result,
                Ok(Err(_)) => {
                    log::warn!(target: "notesage::copilot", "conversation/invokeClientToolConfirmation channel closed");
                    serde_json::json!({"result": "dismiss"})
                }
                Err(_) => {
                    log::warn!(target: "notesage::copilot", "conversation/invokeClientToolConfirmation timed out — auto-dismiss");
                    pending_server_requests.lock().await.remove(&request_id);
                    serde_json::json!({"result": "dismiss"})
                }
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

        "$/progress" => {
            // Conversation streaming: $/progress notifications carry text chunks,
            // tool call rounds, and completion signals via workDoneToken correlation.
            if let Some(params) = params {
                let token = params.get("token").and_then(|v| v.as_str()).unwrap_or("");
                let value = params.get("value");

                // Only process conversation-related progress tokens
                if !token.starts_with("copilot-chat-") {
                    return;
                }

                if let Some(value) = value {
                    let kind = value.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                    let conversation_id = value.get("conversationId").and_then(|v| v.as_str()).unwrap_or("");
                    let turn_id = value.get("turnId").and_then(|v| v.as_str()).unwrap_or("");

                    match kind {
                        "begin" => {
                            log::debug!(
                                target: "notesage::copilot",
                                "$/progress begin: conv={}, turn={}",
                                conversation_id, turn_id
                            );
                        }

                        "report" => {
                            // Text chunks
                            if let Some(reply) = value.get("reply").and_then(|v| v.as_str()) {
                                if !reply.is_empty() {
                                    let _ = app.emit("copilot-chat-chunk", serde_json::json!({
                                        "text": reply,
                                        "conversationId": conversation_id,
                                        "turnId": turn_id,
                                    }));
                                }
                            }

                            // Agent rounds with tool calls
                            if let Some(rounds) = value.get("editAgentRounds").and_then(|v| v.as_array()) {
                                for round in rounds {
                                    // Emit round reply text if present
                                    if let Some(round_reply) = round.get("reply").and_then(|v| v.as_str()) {
                                        if !round_reply.is_empty() {
                                            let _ = app.emit("copilot-chat-chunk", serde_json::json!({
                                                "text": round_reply,
                                                "conversationId": conversation_id,
                                                "turnId": turn_id,
                                            }));
                                        }
                                    }

                                    // Emit tool call status updates
                                    if let Some(tool_calls) = round.get("toolCalls").and_then(|v| v.as_array()) {
                                        for tc in tool_calls {
                                            let _ = app.emit("copilot-chat-tool-update", serde_json::json!({
                                                "conversationId": conversation_id,
                                                "turnId": turn_id,
                                                "toolCallId": tc.get("id"),
                                                "name": tc.get("name"),
                                                "status": tc.get("status"),
                                                "input": tc.get("input"),
                                                "result": tc.get("result"),
                                                "error": tc.get("error"),
                                                "progressMessage": tc.get("progressMessage"),
                                            }));
                                        }
                                    }
                                }
                            }

                            // Progress steps (skill resolution, searching, etc.)
                            if let Some(steps) = value.get("steps").and_then(|v| v.as_array()) {
                                for step in steps {
                                    let _ = app.emit("copilot-chat-step", serde_json::json!({
                                        "conversationId": conversation_id,
                                        "turnId": turn_id,
                                        "stepId": step.get("id"),
                                        "title": step.get("title"),
                                        "status": step.get("status"),
                                    }));
                                }
                            }

                            // Notification messages from the server
                            if let Some(notifications) = value.get("notifications").and_then(|v| v.as_array()) {
                                for notif in notifications {
                                    let _ = app.emit("copilot-chat-thinking", serde_json::json!({
                                        "text": notif.get("message").and_then(|v| v.as_str()).unwrap_or(""),
                                        "conversationId": conversation_id,
                                        "turnId": turn_id,
                                    }));
                                }
                            }
                        }

                        "end" => {
                            let error = value.get("error");
                            let follow_up = value.get("followUp");
                            let suggested_title = value.get("suggestedTitle").and_then(|v| v.as_str());

                            let _ = app.emit("copilot-chat-done", serde_json::json!({
                                "conversationId": conversation_id,
                                "turnId": turn_id,
                                "error": error,
                                "followUp": follow_up,
                                "suggestedTitle": suggested_title,
                            }));
                        }

                        _ => {
                            log::debug!(
                                target: "notesage::copilot",
                                "$/progress unknown kind={}: {}",
                                kind,
                                serde_json::to_string(value).unwrap_or_default()
                            );
                        }
                    }
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
    pub transport: json_rpc::JsonRpcTransport,
    pub child: Child,
    pub status: tokio::sync::Mutex<CopilotStatus>,
    /// Stashed embedded command from signIn response (e.g. finishDeviceFlow).
    /// The frontend calls `copilot_lsp_finish_auth` to trigger it when the user
    /// clicks "Open GitHub", so the browser doesn't open before the code is shown.
    pub pending_auth_command: tokio::sync::Mutex<Option<(String, Value)>>,
    /// Active conversation IDs for cleanup on LSP stop/crash.
    pub active_conversations: tokio::sync::Mutex<Vec<String>>,
    /// Pending server→client request responses (context requests, tool calls).
    /// The reader loop inserts a oneshot sender; a Tauri command resolves it.
    pub pending_server_requests: PendingServerRequests,
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
    // 0. Check managed install directory (~/.notesage/agents/bin/)
    let managed_bin = dirs::home_dir()
        .unwrap_or_default()
        .join(".notesage/agents/bin")
        .join(COPILOT_BINARY);
    if managed_bin.exists() {
        return Some(managed_bin.to_string_lossy().to_string());
    }

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
    let pending_server_requests: PendingServerRequests = Arc::new(Mutex::new(HashMap::new()));
    let transport = spawn_copilot_transport(stdin, stdout, child_pid, app.clone(), pending_server_requests.clone());

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
        kind: CopilotStatusKind::Normal,
    };

    *guard = Some(CopilotLspProcess {
        transport,
        child,
        status: tokio::sync::Mutex::new(status),
        pending_auth_command: tokio::sync::Mutex::new(None),
        active_conversations: tokio::sync::Mutex::new(Vec::new()),
        pending_server_requests,
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
        // Destroy active conversations before shutdown
        let convs = process.active_conversations.lock().await.clone();
        for conv_id in &convs {
            let _ = process
                .transport
                .send_request(
                    "conversation/destroy",
                    Some(serde_json::json!({ "conversationId": conv_id })),
                )
                .await;
        }
        process.active_conversations.lock().await.clear();

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
                        kind: if authenticated { CopilotStatusKind::Normal } else { CopilotStatusKind::Inactive },
                    })
                }
                Err(e) => {
                    log::warn!(target: "notesage::copilot", "checkStatus failed: {}", e);
                    Ok(CopilotStatus {
                        authenticated: false,
                        message: format!("checkStatus failed: {}", e),
                        kind: CopilotStatusKind::Error,
                    })
                }
            }
        }
        None => {
            Ok(CopilotStatus {
                authenticated: false,
                message: "Not running".to_string(),
                kind: CopilotStatusKind::Inactive,
            })
        }
    }
}

/// Sign in to GitHub Copilot via OAuth device flow.
///
/// The Copilot LSP supports two authentication protocols:
///
/// **Protocol A** (copilot.lua-era, direct methods):
///   1. `signInInitiate` → returns `{ status, userCode, verificationUri }`
///   2. Display code to user, open browser
///   3. `signInConfirm` with `{ userCode }` → blocks until auth completes
///
/// **Protocol B** (newer @github/copilot-language-server):
///   1. `signIn` → may return device code directly, or via server→client request
///   2. Execute embedded `finishDeviceFlow` command (fire-and-forget)
///   3. Auth completion arrives via `didChangeStatus` notification
///
/// This function tries Protocol B first, then Protocol A, then waits for
/// asynchronous device code delivery via server→client request.
#[tauri::command]
pub async fn copilot_lsp_sign_in(
    app: AppHandle,
    state: State<'_, CopilotLspState>,
) -> Result<SignInResponse, String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running. Call copilot_lsp_start first.")?;

    // --- Phase 1: Protocol B — Try direct `signIn` RPC ---
    // Newer LSP versions support `signIn` as a client→server method that returns
    // `{ userCode, verificationUri, command }` directly, or delivers the code
    // via a server→client `signIn` request.
    log::info!(target: "notesage::copilot", "Phase 1: Sending signIn RPC (Protocol B)...");
    match process
        .transport
        .send_request("signIn", Some(serde_json::json!({})))
        .await
    {
        Ok(result) => {
            log::info!(target: "notesage::copilot", "Phase 1 signIn response: {}", result);

            // Check if the response indicates already signed in
            let status = result.get("status").and_then(|v| v.as_str()).unwrap_or("");
            if status == "AlreadySignedIn" || status == "OK" || status == "MaybeOk" {
                log::info!(target: "notesage::copilot", "Phase 1: Already signed in (status={})", status);
                return Ok(SignInResponse {
                    user_code: String::new(),
                    verification_uri: String::new(),
                });
            }

            let user_code = extract_user_code_from_result(&result);
            let verification_uri = extract_verification_uri(&result);

            if !user_code.is_empty() {
                log::info!(
                    target: "notesage::copilot",
                    "Phase 1 succeeded — userCode={}, verificationUri={}",
                    user_code, verification_uri
                );

                // Emit device code to frontend. Do NOT execute finishDeviceFlow
                // yet — it opens the browser immediately. The frontend will call
                // copilot_lsp_finish_auth when the user clicks "Open GitHub".
                let _ = app.emit(
                    "copilot-auth-device-code",
                    serde_json::json!({
                        "userCode": user_code.clone(),
                        "verificationUri": verification_uri.clone(),
                    }),
                );

                // Stash the embedded command so the frontend can trigger it later
                if let Some(command) = result.get("command") {
                    let cmd_name = command.get("command").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let cmd_args = command.get("arguments").cloned().unwrap_or(Value::Array(vec![]));
                    if !cmd_name.is_empty() {
                        *process.pending_auth_command.lock().await = Some((cmd_name, cmd_args));
                    }
                }

                return Ok(SignInResponse {
                    user_code,
                    verification_uri,
                });
            }

            log::info!(target: "notesage::copilot", "Phase 1: signIn returned no device code, falling to Phase 2");
        }
        Err(e) => {
            log::info!(
                target: "notesage::copilot",
                "Phase 1: signIn RPC failed (non-fatal, falling to Phase 2): {}",
                e
            );
        }
    }

    // --- Phase 2: Protocol A — `signInInitiate` direct method ---
    // copilot.lua/copilot.el-era protocol: `signInInitiate` as a direct JSON-RPC
    // method returns `{ status: "PromptUserDeviceFlow", userCode, verificationUri }`.
    // Auth is confirmed by a separate `signInConfirm` call (fire-and-forget).
    log::info!(target: "notesage::copilot", "Phase 2: Sending signInInitiate direct method (Protocol A)...");
    match process
        .transport
        .send_request("signInInitiate", Some(serde_json::json!({})))
        .await
    {
        Ok(result) => {
            log::info!(target: "notesage::copilot", "Phase 2 signInInitiate response: {}", result);

            let user_code = extract_user_code_from_result(&result);
            let verification_uri = extract_verification_uri(&result);

            if !user_code.is_empty() {
                log::info!(
                    target: "notesage::copilot",
                    "Phase 2 succeeded — userCode={}, verificationUri={}",
                    user_code, verification_uri
                );

                // Emit device code to frontend
                let _ = app.emit(
                    "copilot-auth-device-code",
                    serde_json::json!({
                        "userCode": user_code.clone(),
                        "verificationUri": verification_uri.clone(),
                    }),
                );

                // Fire-and-forget: `signInConfirm` blocks server-side while
                // polling GitHub until the user authenticates or the code expires.
                let confirm_code = user_code.clone();
                let confirm_writer = process.transport.writer.clone();
                let confirm_pending = process.transport.pending.clone();
                tokio::spawn(async move {
                    let id = json_rpc::next_request_id();
                    let msg = JsonRpcRequest::new(
                        id,
                        "signInConfirm",
                        Some(serde_json::json!({ "userCode": confirm_code })),
                    );
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    confirm_pending.lock().await.insert(id, tx);
                    let json = match serde_json::to_string(&msg) {
                        Ok(j) => j,
                        Err(e) => {
                            log::error!(target: "notesage::copilot", "Failed to serialize signInConfirm: {}", e);
                            return;
                        }
                    };
                    let mut writer = confirm_writer.lock().await;
                    if let Err(e) = json_rpc::write_message(&mut *writer, &json).await {
                        log::error!(target: "notesage::copilot", "Failed to send signInConfirm: {}", e);
                        return;
                    }
                    drop(writer);
                    log::info!(target: "notesage::copilot", "signInConfirm sent, waiting for auth completion...");
                    match rx.await {
                        Ok(Ok(val)) => log::info!(target: "notesage::copilot", "signInConfirm completed: {}", val),
                        Ok(Err(e)) => log::error!(target: "notesage::copilot", "signInConfirm failed: {}", e),
                        Err(_) => log::warn!(target: "notesage::copilot", "signInConfirm channel closed"),
                    }
                });

                return Ok(SignInResponse {
                    user_code,
                    verification_uri,
                });
            }

            log::info!(
                target: "notesage::copilot",
                "Phase 2: signInInitiate returned no device code"
            );
        }
        Err(e) => {
            log::info!(target: "notesage::copilot", "Phase 2: signInInitiate direct method failed: {}", e);
        }
    }

    // --- Phase 3: Protocol B — `signInInitiate` as workspace command ---
    // Some LSP versions expose signInInitiate as a workspace command rather than
    // a direct method.
    log::info!(target: "notesage::copilot", "Phase 3: Sending workspace/executeCommand(signInInitiate)...");
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
            log::info!(target: "notesage::copilot", "Phase 3 signInInitiate response: {}", result);

            let user_code = extract_user_code_from_result(&result);
            let verification_uri = extract_verification_uri(&result);

            if !user_code.is_empty() {
                log::info!(
                    target: "notesage::copilot",
                    "Phase 3 succeeded — userCode={}, verificationUri={}",
                    user_code, verification_uri
                );

                let _ = app.emit(
                    "copilot-auth-device-code",
                    serde_json::json!({
                        "userCode": user_code.clone(),
                        "verificationUri": verification_uri.clone(),
                    }),
                );

                // Stash the embedded command for frontend-triggered execution
                if let Some(command) = result.get("command") {
                    let cmd_name = command.get("command").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let cmd_args = command.get("arguments").cloned().unwrap_or(Value::Array(vec![]));
                    if !cmd_name.is_empty() {
                        *process.pending_auth_command.lock().await = Some((cmd_name, cmd_args));
                    }
                }

                return Ok(SignInResponse {
                    user_code,
                    verification_uri,
                });
            }

            log::info!(
                target: "notesage::copilot",
                "Phase 3: signInInitiate workspace command returned no device code"
            );
        }
        Err(e) => {
            log::info!(target: "notesage::copilot", "Phase 3: signInInitiate workspace command failed: {}", e);
        }
    }

    // --- Phase 4: Wait for asynchronous device code ---
    // No phase returned a device code in the response. The LSP may send
    // the code asynchronously via a server→client `signIn` request, which is
    // handled in `handle_server_request` and emitted as `copilot-auth-device-code`.
    log::info!(
        target: "notesage::copilot",
        "All phases returned no device code — waiting for server→client signIn request"
    );

    Ok(SignInResponse {
        user_code: String::new(),
        verification_uri: "https://github.com/login/device".to_string(),
    })
}

/// Execute the stashed finishDeviceFlow command. Called by the frontend when
/// the user clicks "Open GitHub" — this starts the OAuth polling and opens
/// the browser via the LSP's internal `open` call.
#[tauri::command]
pub async fn copilot_lsp_finish_auth(
    state: State<'_, CopilotLspState>,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    let cmd = process.pending_auth_command.lock().await.take();
    if let Some((cmd_name, cmd_args)) = cmd {
        log::info!(
            target: "notesage::copilot",
            "Frontend triggered finishDeviceFlow: {} with args: {}",
            cmd_name, cmd_args
        );

        // Fire-and-forget — this polls GitHub until auth completes
        let writer = process.transport.writer.clone();
        let pending = process.transport.pending.clone();
        tokio::spawn(async move {
            let id = json_rpc::next_request_id();
            let msg = JsonRpcRequest::new(
                id,
                "workspace/executeCommand",
                Some(serde_json::json!({
                    "command": cmd_name,
                    "arguments": cmd_args,
                })),
            );
            let (tx, rx) = tokio::sync::oneshot::channel();
            pending.lock().await.insert(id, tx);
            let json = match serde_json::to_string(&msg) {
                Ok(j) => j,
                Err(e) => {
                    log::error!(target: "notesage::copilot", "Failed to serialize finishDeviceFlow: {}", e);
                    return;
                }
            };
            let mut w = writer.lock().await;
            if let Err(e) = json_rpc::write_message(&mut *w, &json).await {
                log::error!(target: "notesage::copilot", "Failed to send finishDeviceFlow: {}", e);
                return;
            }
            drop(w);
            match rx.await {
                Ok(Ok(val)) => log::info!(target: "notesage::copilot", "finishDeviceFlow completed: {}", val),
                Ok(Err(e)) => log::error!(target: "notesage::copilot", "finishDeviceFlow failed: {}", e),
                Err(_) => log::warn!(target: "notesage::copilot", "finishDeviceFlow channel closed"),
            }
        });
    } else {
        log::info!(target: "notesage::copilot", "No pending auth command to execute");
    }

    Ok(())
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

// ---------------------------------------------------------------------------
// Conversation commands
// ---------------------------------------------------------------------------

/// Create a new conversation session and send the first message.
/// Returns the conversation ID. Streaming response arrives via $/progress
/// events (copilot-chat-chunk, copilot-chat-thinking, copilot-chat-done).
#[tauri::command]
pub async fn copilot_lsp_conversation_create(
    state: State<'_, CopilotLspState>,
    message: String,
    model: Option<String>,
    tools: Option<Vec<Value>>,
) -> Result<Value, String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    let work_done_token = format!("copilot-chat-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis());

    let mut params = serde_json::json!({
        "workDoneToken": work_done_token,
        "turns": [{
            "request": message,
        }],
        "capabilities": {
            "allSkills": true,
        },
        "source": "panel",
    });

    if let Some(model_id) = &model {
        log::info!(target: "notesage::copilot", "conversation/create with model={}", model_id);
        params["model"] = Value::String(model_id.clone());
    } else {
        log::info!(target: "notesage::copilot", "conversation/create with no model (server default)");
    }

    let result = process
        .transport
        .send_request("conversation/create", Some(params))
        .await
        .map_err(|e| format!("conversation/create failed: {}", e))?;

    let conversation_id = result
        .get("conversationId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if !conversation_id.is_empty() {
        process.active_conversations.lock().await.push(conversation_id.clone());

        // Register tools if provided (Task #5)
        if let Some(tool_defs) = tools {
            if !tool_defs.is_empty() {
                let reg_result = process
                    .transport
                    .send_request(
                        "conversation/registerTools",
                        Some(serde_json::json!({ "tools": tool_defs })),
                    )
                    .await;

                match reg_result {
                    Ok(_) => log::debug!(
                        target: "notesage::copilot",
                        "Registered {} tools for conversation {}",
                        tool_defs.len(), conversation_id
                    ),
                    Err(e) => log::warn!(
                        target: "notesage::copilot",
                        "Tool registration failed (non-fatal): {}", e
                    ),
                }
            }
        }
    }

    Ok(result)
}

/// Send a follow-up message in an existing conversation.
/// Streaming response arrives via $/progress events.
#[tauri::command]
pub async fn copilot_lsp_conversation_turn(
    state: State<'_, CopilotLspState>,
    conversation_id: String,
    message: String,
    model: Option<String>,
) -> Result<Value, String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    let work_done_token = format!("copilot-chat-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis());

    let mut params = serde_json::json!({
        "workDoneToken": work_done_token,
        "conversationId": conversation_id,
        "message": message,
        "source": "panel",
    });

    if let Some(model_id) = &model {
        params["model"] = Value::String(model_id.clone());
    }

    let result = process
        .transport
        .send_request("conversation/turn", Some(params))
        .await
        .map_err(|e| format!("conversation/turn failed: {}", e))?;

    Ok(result)
}

/// Destroy a conversation session.
#[tauri::command]
pub async fn copilot_lsp_conversation_destroy(
    state: State<'_, CopilotLspState>,
    conversation_id: String,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_request(
            "conversation/destroy",
            Some(serde_json::json!({ "conversationId": conversation_id })),
        )
        .await
        .map_err(|e| format!("conversation/destroy failed: {}", e))?;

    // Remove from active conversations
    let mut convs = process.active_conversations.lock().await;
    convs.retain(|id| id != &conversation_id);

    Ok(())
}

/// List available models for Copilot chat.
#[tauri::command]
pub async fn copilot_lsp_conversation_models(
    state: State<'_, CopilotLspState>,
) -> Result<Vec<CopilotModel>, String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    let result = process
        .transport
        .send_request("copilot/models", Some(serde_json::json!({})))
        .await;

    match result {
        Ok(Value::Array(ref models)) => {
            log::info!(
                target: "notesage::copilot",
                "copilot/models returned {} models: {}",
                models.len(),
                serde_json::to_string(&models).unwrap_or_default()
            );
            let parsed: Vec<CopilotModel> = models
                .iter()
                .filter_map(|m| {
                    let id = m.get("id").and_then(|v| v.as_str())
                        .or_else(|| m.get("modelFamily").and_then(|v| v.as_str()))?;
                    let name = m.get("modelName").and_then(|v| v.as_str())
                        .or_else(|| m.get("id").and_then(|v| v.as_str()))
                        .unwrap_or(id);

                    // Filter to chat-eligible models (scopes includes "chat-panel")
                    let scopes = m.get("scopes").and_then(|v| v.as_array());
                    let is_chat = scopes.map_or(true, |s| {
                        s.iter().any(|scope| scope.as_str() == Some("chat-panel"))
                    });
                    if !is_chat {
                        return None;
                    }

                    Some(CopilotModel {
                        id: id.to_string(),
                        name: name.to_string(),
                        provider: m.get("modelProviderName")
                            .and_then(|v| v.as_str())
                            .unwrap_or("copilot")
                            .to_string(),
                    })
                })
                .collect();

            Ok(parsed)
        }
        Ok(_) => {
            log::warn!(target: "notesage::copilot", "copilot/models returned non-array");
            Ok(hardcoded_fallback_models())
        }
        Err(e) => {
            log::warn!(target: "notesage::copilot", "copilot/models failed: {}, using fallback", e);
            Ok(hardcoded_fallback_models())
        }
    }
}

/// Fallback model list when copilot/models is unavailable.
fn hardcoded_fallback_models() -> Vec<CopilotModel> {
    vec![
        CopilotModel { id: "gpt-4o".into(), name: "GPT-4o".into(), provider: "openai".into() },
        CopilotModel { id: "gpt-4.1".into(), name: "GPT-4.1".into(), provider: "openai".into() },
        CopilotModel { id: "claude-sonnet-4".into(), name: "Claude Sonnet 4".into(), provider: "anthropic".into() },
        CopilotModel { id: "gemini-2.5-pro".into(), name: "Gemini 2.5 Pro".into(), provider: "google".into() },
        CopilotModel { id: "o4-mini".into(), name: "o4-mini".into(), provider: "openai".into() },
    ]
}

// ---------------------------------------------------------------------------
// Server→client response bridges
// ---------------------------------------------------------------------------

/// Send a context response back to a pending conversation/context request.
/// Called by the frontend after collecting editor state.
#[tauri::command]
pub async fn copilot_lsp_context_response(
    state: State<'_, CopilotLspState>,
    request_id: String,
    context: Value,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    let mut pending = process.pending_server_requests.lock().await;
    if let Some(tx) = pending.remove(&request_id) {
        let _ = tx.send(context);
        Ok(())
    } else {
        Err(format!("No pending context request with id {}", request_id))
    }
}

/// Send a tool execution result back to a pending conversation/invokeClientTool request.
/// Called by the frontend after executing the tool.
#[tauri::command]
pub async fn copilot_lsp_tool_result(
    state: State<'_, CopilotLspState>,
    request_id: String,
    result: Value,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    let mut pending = process.pending_server_requests.lock().await;
    if let Some(tx) = pending.remove(&request_id) {
        let _ = tx.send(result);
        Ok(())
    } else {
        Err(format!("No pending tool request with id {}", request_id))
    }
}

/// Send a tool confirmation response back to a pending invokeClientToolConfirmation request.
/// Called by the frontend after user approves/denies.
#[tauri::command]
pub async fn copilot_lsp_tool_confirmation_response(
    state: State<'_, CopilotLspState>,
    request_id: String,
    accepted: bool,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    let mut pending = process.pending_server_requests.lock().await;
    if let Some(tx) = pending.remove(&request_id) {
        let response = serde_json::json!({
            "result": if accepted { "accept" } else { "dismiss" }
        });
        let _ = tx.send(response);
        Ok(())
    } else {
        Err(format!("No pending confirmation request with id {}", request_id))
    }
}
