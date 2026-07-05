//! Copilot LSP JSON-RPC transport layer.
//!
//! Handles the reader loop, server→client request dispatching, and the
//! `path_to_uri` utility used throughout the Copilot LSP module.

use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{BufReader, BufWriter};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::Mutex;

use super::json_rpc::{
    self, JsonRpcRequest, JsonRpcTransport, PendingRequests,
    ReadMessageResult,
};

use super::PendingServerRequests;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

pub(super) const READER_TIMEOUT: Duration = Duration::from_secs(30);

// ---------------------------------------------------------------------------
// Transport setup
// ---------------------------------------------------------------------------

/// Spawn a Copilot LSP transport: creates a `JsonRpcTransport` for stdin and
/// starts the LSP-specific reader loop on stdout (handles server→client
/// requests, notifications, and auth flows). Returns the transport handle.
pub(super) fn spawn_copilot_transport(
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
            let tool_input = params.and_then(|p| p.get("input")).cloned().unwrap_or(Value::Null);
            let title = params.and_then(|p| p.get("title")).and_then(|v| v.as_str()).unwrap_or("");
            let message = params.and_then(|p| p.get("message")).and_then(|v| v.as_str()).unwrap_or("");

            let _ = app.emit("copilot-tool-confirmation", serde_json::json!({
                "requestId": request_id,
                "id": tool_call_id,
                "name": tool_name,
                "arguments": tool_input,
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
// URI helpers
// ---------------------------------------------------------------------------

/// Convert a file path to a file:// URI.
pub(super) fn path_to_uri(path: &str) -> String {
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
