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
                // Nothing will ever answer the requests still in flight. Drop
                // their senders so the callers fail with "channel closed"
                // rather than waiting forever: `conversation/turn` no longer
                // holds the process lock while it waits, so it would
                // otherwise outlive the process it was sent to.
                pending.lock().await.clear();
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

/// How to answer a server→client request.
enum ServerRequestPlan {
    /// The answer is known without asking anyone.
    Reply(Value),
    /// The frontend has to answer: emit `event` with `payload` (plus a
    /// `requestId`) and wait for the matching `copilot_lsp_*` reply command.
    AskFrontend(FrontendRequest),
}

/// A request forwarded to the frontend, with what the server is told when
/// no answer comes back.
struct FrontendRequest {
    /// Prefix of the generated request id (`ctx`, `tool`, `confirm`).
    id_prefix: &'static str,
    event: &'static str,
    payload: Value,
    /// How long the frontend has to answer.
    timeout: Duration,
    /// Sent when the frontend does not answer in time.
    on_timeout: Value,
    /// Sent when the reply channel is dropped (the request was abandoned).
    on_closed: Value,
}

fn str_param<'a>(params: Option<&'a Value>, key: &str) -> &'a str {
    params
        .and_then(|p| p.get(key))
        .and_then(|v| v.as_str())
        .unwrap_or("")
}

/// Decide how a server→client request is answered. Pure: every side effect
/// (emitting, waiting, writing the response) is the caller's.
fn plan_server_request(method: &str, params: Option<&Value>) -> ServerRequestPlan {
    use ServerRequestPlan::{AskFrontend, Reply};
    match method {
        // The device-flow side effects are in `handle_sign_in`.
        "signIn" => Reply(serde_json::json!({})),

        // LSP wants to open a URL (e.g., GitHub login page during auth).
        // Don't auto-open — let the frontend control when the browser opens
        // so the user sees the device code first.
        "window/showDocument" => Reply(serde_json::json!({ "success": true })),

        // Server wants to show a message with action buttons: no action selected.
        "window/showMessageRequest" => Reply(Value::Null),

        "workspace/configuration" => Reply({
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
        }),

        // Server requests editor context during conversation turn processing.
        "conversation/context" => {
            let skill_id = match str_param(params, "skillId") {
                "" => "current-editor",
                id => id,
            };
            AskFrontend(FrontendRequest {
                id_prefix: "ctx",
                event: "copilot-context-request",
                payload: serde_json::json!({
                    "skillId": skill_id,
                    "conversationId": str_param(params, "conversationId"),
                    "turnId": str_param(params, "turnId"),
                }),
                timeout: Duration::from_secs(10),
                on_timeout: serde_json::json!([null, null]),
                on_closed: serde_json::json!([null, null]),
            })
        }

        // Server requests tool execution. The frontend executes it and
        // answers via the copilot_lsp_tool_result command.
        "conversation/invokeClientTool" => AskFrontend(FrontendRequest {
            id_prefix: "tool",
            event: "copilot-tool-call",
            payload: serde_json::json!({
                "id": str_param(params, "toolCallId"),
                "name": str_param(params, "name"),
                "arguments": params.and_then(|p| p.get("input")).cloned().unwrap_or(Value::Null),
                "conversationId": str_param(params, "conversationId"),
            }),
            timeout: Duration::from_secs(60),
            on_timeout: serde_json::json!({"status": "error", "content": [{"value": "Tool execution timed out"}]}),
            on_closed: serde_json::json!({"status": "error", "content": [{"value": "Tool execution channel closed"}]}),
        }),

        // Server requests user confirmation before tool execution. No answer
        // is a dismissal, never an approval.
        "conversation/invokeClientToolConfirmation" => AskFrontend(FrontendRequest {
            id_prefix: "confirm",
            event: "copilot-tool-confirmation",
            payload: serde_json::json!({
                "id": str_param(params, "toolCallId"),
                "name": str_param(params, "name"),
                "arguments": params.and_then(|p| p.get("input")).cloned().unwrap_or(Value::Null),
                "title": str_param(params, "title"),
                "description": str_param(params, "message"),
                "conversationId": str_param(params, "conversationId"),
            }),
            timeout: Duration::from_secs(30),
            on_timeout: serde_json::json!({"result": "dismiss"}),
            on_closed: serde_json::json!({"result": "dismiss"}),
        }),

        _ => {
            log::debug!(target: "notesage::copilot", "Unhandled server request: {}", method);
            Reply(Value::Null)
        }
    }
}

/// Why a frontend request ended without an answer.
#[derive(Debug, PartialEq)]
enum NoReply {
    TimedOut,
    Closed,
}

/// Wait for the frontend's answer to a [`FrontendRequest`], falling back to
/// the request's `on_timeout` / `on_closed` value. The second element says
/// which fallback was used, so the caller can drop the pending entry.
async fn await_frontend_reply(
    rx: tokio::sync::oneshot::Receiver<Value>,
    request: &FrontendRequest,
) -> (Value, Option<NoReply>) {
    match tokio::time::timeout(request.timeout, rx).await {
        Ok(Ok(result)) => (result, None),
        Ok(Err(_)) => (request.on_closed.clone(), Some(NoReply::Closed)),
        Err(_) => (request.on_timeout.clone(), Some(NoReply::TimedOut)),
    }
}

/// The JSON-RPC response to a server→client request.
fn server_request_response(id: &Value, result: Value) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })
}

/// `signIn`: OAuth device flow sign-in data. The Copilot LSP sends this after
/// sign-in is initiated, containing the device code the user must enter on
/// GitHub.
async fn handle_sign_in(
    params: Option<&Value>,
    writer: &Arc<Mutex<BufWriter<ChildStdin>>>,
    app: &AppHandle,
) {
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
}

/// Handle a request from the server that expects a response.
async fn handle_server_request(
    method: &str,
    id: &Value,
    params: Option<&Value>,
    writer: &Arc<Mutex<BufWriter<ChildStdin>>>,
    app: &AppHandle,
    pending_server_requests: &PendingServerRequests,
) {
    if method == "signIn" {
        handle_sign_in(params, writer, app).await;
    }
    if let Some(params) = params {
        match method {
            "window/showDocument" => {
                if let Some(uri) = params.get("uri").and_then(|v| v.as_str()) {
                    log::info!(target: "notesage::copilot", "window/showDocument: {} (suppressed auto-open)", uri);
                }
            }
            "window/showMessageRequest" => {
                if let Some(message) = params.get("message").and_then(|v| v.as_str()) {
                    log::debug!(target: "notesage::copilot", "showMessageRequest: {}", message);
                }
            }
            _ => {}
        }
    }

    let response_result = match plan_server_request(method, params) {
        ServerRequestPlan::Reply(value) => value,
        ServerRequestPlan::AskFrontend(mut request) => {
            let request_id = format!("{}-{}", request.id_prefix, json_rpc::next_request_id());
            let (tx, rx) = tokio::sync::oneshot::channel();
            pending_server_requests.lock().await.insert(request_id.clone(), tx);

            request.payload["requestId"] = Value::String(request_id.clone());
            let _ = app.emit(request.event, request.payload.clone());

            let (result, no_reply) = await_frontend_reply(rx, &request).await;
            match no_reply {
                Some(NoReply::TimedOut) => {
                    log::warn!(
                        target: "notesage::copilot",
                        "{} timed out after {}s",
                        method,
                        request.timeout.as_secs()
                    );
                    pending_server_requests.lock().await.remove(&request_id);
                }
                Some(NoReply::Closed) => {
                    log::warn!(target: "notesage::copilot", "{} channel closed", method);
                }
                None => {}
            }
            result
        }
    };

    // Send response
    if let Ok(json) = serde_json::to_string(&server_request_response(id, response_result)) {
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
            for (event, payload) in progress_events(params) {
                let _ = app.emit(event, payload);
            }
        }

        _ => {
            // Ignore other notifications silently
        }
    }
}

// ---------------------------------------------------------------------------
// Conversation progress
// ---------------------------------------------------------------------------

/// Prefix of the `workDoneToken` of a conversation request. `$/progress`
/// notifications with any other token are not ours.
pub(super) const CHAT_TOKEN_PREFIX: &str = "copilot-chat-";

/// The `workDoneToken` for a conversation request: the caller's own
/// correlation token when it is well formed, otherwise a fresh one.
///
/// The frontend generates the token BEFORE it sends the request, so it can
/// tell its own stream's events from another conversation's (a chat turn, a
/// one-shot generation and a background task can all be streaming at once).
/// The conversation id cannot do that for a new conversation: it is only
/// known once the first event has already arrived.
pub(super) fn chat_work_done_token(requested: Option<&str>) -> String {
    if let Some(token) = requested {
        let well_formed = token.len() > CHAT_TOKEN_PREFIX.len()
            && token.len() <= 128
            && token.starts_with(CHAT_TOKEN_PREFIX)
            && token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        if well_formed {
            return token.to_string();
        }
    }
    format!(
        "{}{}-{}",
        CHAT_TOKEN_PREFIX,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        json_rpc::next_request_id()
    )
}

/// Turn one `$/progress` notification into the frontend events it stands for
/// (text chunks, tool-call rounds, steps, completion). Every payload carries
/// the notification's `token`, which is what a listener matches on.
fn progress_events(params: Option<&Value>) -> Vec<(&'static str, Value)> {
    let mut events = Vec::new();
    let Some(params) = params else {
        return events;
    };
    let token = params.get("token").and_then(|v| v.as_str()).unwrap_or("");
    // Only process conversation-related progress tokens
    if !token.starts_with(CHAT_TOKEN_PREFIX) {
        return events;
    }
    let Some(value) = params.get("value") else {
        return events;
    };

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
            // Lets the listener tie its token to the conversation id before
            // the first tool call or confirmation, which carry only the id.
            events.push(("copilot-chat-begin", serde_json::json!({
                "token": token,
                "conversationId": conversation_id,
                "turnId": turn_id,
            })));
        }

        "report" => {
            // Text chunks
            if let Some(reply) = value.get("reply").and_then(|v| v.as_str()) {
                if !reply.is_empty() {
                    events.push(("copilot-chat-chunk", serde_json::json!({
                        "token": token,
                        "text": reply,
                        "conversationId": conversation_id,
                        "turnId": turn_id,
                    })));
                }
            }

            // Agent rounds with tool calls
            if let Some(rounds) = value.get("editAgentRounds").and_then(|v| v.as_array()) {
                for round in rounds {
                    // Emit round reply text if present
                    if let Some(round_reply) = round.get("reply").and_then(|v| v.as_str()) {
                        if !round_reply.is_empty() {
                            events.push(("copilot-chat-chunk", serde_json::json!({
                                "token": token,
                                "text": round_reply,
                                "conversationId": conversation_id,
                                "turnId": turn_id,
                            })));
                        }
                    }

                    // Emit tool call status updates
                    if let Some(tool_calls) = round.get("toolCalls").and_then(|v| v.as_array()) {
                        for tc in tool_calls {
                            events.push(("copilot-chat-tool-update", serde_json::json!({
                                "token": token,
                                "conversationId": conversation_id,
                                "turnId": turn_id,
                                "toolCallId": tc.get("id"),
                                "name": tc.get("name"),
                                "status": tc.get("status"),
                                "input": tc.get("input"),
                                "result": tc.get("result"),
                                "error": tc.get("error"),
                                "progressMessage": tc.get("progressMessage"),
                            })));
                        }
                    }
                }
            }

            // Progress steps (skill resolution, searching, etc.)
            if let Some(steps) = value.get("steps").and_then(|v| v.as_array()) {
                for step in steps {
                    events.push(("copilot-chat-step", serde_json::json!({
                        "token": token,
                        "conversationId": conversation_id,
                        "turnId": turn_id,
                        "stepId": step.get("id"),
                        "title": step.get("title"),
                        "status": step.get("status"),
                    })));
                }
            }

            // Notification messages from the server
            if let Some(notifications) = value.get("notifications").and_then(|v| v.as_array()) {
                for notif in notifications {
                    events.push(("copilot-chat-thinking", serde_json::json!({
                        "token": token,
                        "text": notif.get("message").and_then(|v| v.as_str()).unwrap_or(""),
                        "conversationId": conversation_id,
                        "turnId": turn_id,
                    })));
                }
            }
        }

        "end" => {
            events.push(("copilot-chat-done", serde_json::json!({
                "token": token,
                "conversationId": conversation_id,
                "turnId": turn_id,
                "error": value.get("error"),
                "followUp": value.get("followUp"),
                "suggestedTitle": value.get("suggestedTitle").and_then(|v| v.as_str()),
            })));
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
    events
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ask(method: &str, params: Value) -> FrontendRequest {
        match plan_server_request(method, Some(&params)) {
            ServerRequestPlan::AskFrontend(request) => request,
            ServerRequestPlan::Reply(value) => panic!("{method} replied directly with {value}"),
        }
    }

    fn reply(method: &str, params: Option<Value>) -> Value {
        match plan_server_request(method, params.as_ref()) {
            ServerRequestPlan::Reply(value) => value,
            ServerRequestPlan::AskFrontend(request) => {
                panic!("{method} unexpectedly asked the frontend ({})", request.event)
            }
        }
    }

    // --- direct replies ---

    #[test]
    fn simple_requests_are_answered_without_the_frontend() {
        assert_eq!(reply("signIn", Some(json!({"userCode": "ABCD-1234"}))), json!({}));
        assert_eq!(
            reply("window/showDocument", Some(json!({"uri": "https://github.com/login/device"}))),
            json!({"success": true})
        );
        assert_eq!(reply("window/showMessageRequest", Some(json!({"message": "hi"}))), Value::Null);
        assert_eq!(reply("some/unknownMethod", None), Value::Null);
    }

    #[test]
    fn workspace_configuration_answers_each_requested_section() {
        let result = reply(
            "workspace/configuration",
            Some(json!({"items": [
                {"section": "github.copilot"},
                {"section": "github.copilot.inlineSuggest"},
                {"section": "editor"},
            ]})),
        );
        let items = result.as_array().expect("one entry per item");
        assert_eq!(items.len(), 3);
        assert_eq!(items[0]["enable"]["markdown"], json!(true));
        assert_eq!(items[1], json!({"enable": true}));
        assert_eq!(items[2], json!({}));

        assert_eq!(reply("workspace/configuration", None), json!([]));
        assert_eq!(reply("workspace/configuration", Some(json!({}))), json!([]));
    }

    // --- requests forwarded to the frontend ---

    #[test]
    fn tool_call_is_forwarded_with_a_60s_error_fallback() {
        let request = ask(
            "conversation/invokeClientTool",
            json!({"name": "read_file", "input": {"path": "a.md"}, "toolCallId": "tc-1", "conversationId": "conv-1"}),
        );
        assert_eq!(request.event, "copilot-tool-call");
        assert_eq!(request.id_prefix, "tool");
        assert_eq!(request.timeout, Duration::from_secs(60));
        assert_eq!(
            request.payload,
            json!({"id": "tc-1", "name": "read_file", "arguments": {"path": "a.md"}, "conversationId": "conv-1"})
        );
        assert_eq!(
            request.on_timeout,
            json!({"status": "error", "content": [{"value": "Tool execution timed out"}]})
        );
        assert_eq!(request.on_closed["status"], json!("error"));
    }

    #[test]
    fn tool_confirmation_falls_back_to_dismiss_never_accept() {
        let request = ask(
            "conversation/invokeClientToolConfirmation",
            json!({"name": "write_file", "input": {}, "toolCallId": "tc-2", "title": "Write?", "message": "Overwrite a.md", "conversationId": "conv-1"}),
        );
        assert_eq!(request.event, "copilot-tool-confirmation");
        assert_eq!(request.timeout, Duration::from_secs(30));
        assert_eq!(request.payload["title"], json!("Write?"));
        assert_eq!(request.payload["description"], json!("Overwrite a.md"));
        assert_eq!(request.on_timeout, json!({"result": "dismiss"}));
        assert_eq!(request.on_closed, json!({"result": "dismiss"}));
    }

    #[test]
    fn context_request_defaults_the_skill_and_falls_back_to_no_context() {
        let request = ask("conversation/context", json!({"conversationId": "conv-1", "turnId": "t-1"}));
        assert_eq!(request.event, "copilot-context-request");
        assert_eq!(request.timeout, Duration::from_secs(10));
        assert_eq!(
            request.payload,
            json!({"skillId": "current-editor", "conversationId": "conv-1", "turnId": "t-1"})
        );
        assert_eq!(request.on_timeout, json!([null, null]));

        let named = ask("conversation/context", json!({"skillId": "problems-in-active-document"}));
        assert_eq!(named.payload["skillId"], json!("problems-in-active-document"));
        // A request that names no conversation says so with an empty id; the
        // frontend treats that as "not addressed to any one listener".
        assert_eq!(named.payload["conversationId"], json!(""));
    }

    fn quick(on_timeout: Value, on_closed: Value) -> FrontendRequest {
        FrontendRequest {
            id_prefix: "tool",
            event: "copilot-tool-call",
            payload: json!({}),
            timeout: Duration::from_millis(30),
            on_timeout,
            on_closed,
        }
    }

    #[tokio::test]
    async fn the_frontends_answer_is_used_when_it_arrives_in_time() {
        let request = quick(json!("timeout"), json!("closed"));
        let (tx, rx) = tokio::sync::oneshot::channel();
        tx.send(json!({"status": "success"})).unwrap();
        assert_eq!(
            await_frontend_reply(rx, &request).await,
            (json!({"status": "success"}), None)
        );
    }

    #[tokio::test]
    async fn no_answer_in_time_uses_the_timeout_fallback() {
        let request = quick(json!({"result": "dismiss"}), json!("closed"));
        let (_tx, rx) = tokio::sync::oneshot::channel::<Value>();
        assert_eq!(
            await_frontend_reply(rx, &request).await,
            (json!({"result": "dismiss"}), Some(NoReply::TimedOut))
        );
    }

    #[tokio::test]
    async fn a_dropped_reply_channel_uses_the_closed_fallback() {
        let request = quick(json!("timeout"), json!({"status": "error"}));
        let (tx, rx) = tokio::sync::oneshot::channel::<Value>();
        drop(tx);
        assert_eq!(
            await_frontend_reply(rx, &request).await,
            (json!({"status": "error"}), Some(NoReply::Closed))
        );
    }

    #[test]
    fn response_echoes_the_request_id_whatever_its_type() {
        assert_eq!(
            server_request_response(&json!(7), json!({"success": true})),
            json!({"jsonrpc": "2.0", "id": 7, "result": {"success": true}})
        );
        assert_eq!(
            server_request_response(&json!("abc"), Value::Null),
            json!({"jsonrpc": "2.0", "id": "abc", "result": null})
        );
    }

    // --- $/progress correlation ---

    fn progress(token: &str, value: Value) -> Vec<(&'static str, Value)> {
        progress_events(Some(&json!({"token": token, "value": value})))
    }

    #[test]
    fn every_progress_event_carries_the_work_done_token() {
        let token = "copilot-chat-abc";
        let mut events = progress(token, json!({"kind": "begin", "conversationId": "c1", "turnId": "t1"}));
        events.extend(progress(token, json!({
            "kind": "report",
            "conversationId": "c1",
            "turnId": "t1",
            "reply": "Hello",
            "editAgentRounds": [{"reply": " world", "toolCalls": [{"id": "tc-1", "name": "read_file", "status": "running"}]}],
            "steps": [{"id": "s1", "title": "Searching", "status": "running"}],
            "notifications": [{"message": "thinking"}],
        })));
        events.extend(progress(token, json!({"kind": "end", "conversationId": "c1", "turnId": "t1"})));

        let names: Vec<&str> = events.iter().map(|(name, _)| *name).collect();
        assert_eq!(
            names,
            vec![
                "copilot-chat-begin",
                "copilot-chat-chunk",
                "copilot-chat-chunk",
                "copilot-chat-tool-update",
                "copilot-chat-step",
                "copilot-chat-thinking",
                "copilot-chat-done",
            ]
        );
        for (name, payload) in &events {
            assert_eq!(payload["token"], json!(token), "{name} lost its token");
            assert_eq!(payload["conversationId"], json!("c1"), "{name}");
        }
    }

    #[test]
    fn progress_for_other_tokens_is_ignored() {
        assert!(progress("some-other-token", json!({"kind": "report", "reply": "x"})).is_empty());
        assert!(progress_events(None).is_empty());
        assert!(progress_events(Some(&json!({"token": "copilot-chat-1"}))).is_empty());
    }

    #[test]
    fn a_missing_conversation_id_stays_empty_rather_than_invented() {
        let events = progress("copilot-chat-1", json!({"kind": "report", "reply": "x"}));
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1["conversationId"], json!(""));
        assert_eq!(events[0].1["token"], json!("copilot-chat-1"));
    }

    #[test]
    fn done_reports_the_error_and_suggested_title() {
        let events = progress(
            "copilot-chat-1",
            json!({"kind": "end", "conversationId": "c1", "error": {"message": "quota"}, "suggestedTitle": "Notes"}),
        );
        assert_eq!(events[0].0, "copilot-chat-done");
        assert_eq!(events[0].1["error"]["message"], json!("quota"));
        assert_eq!(events[0].1["suggestedTitle"], json!("Notes"));
    }

    #[test]
    fn the_callers_token_is_used_only_when_well_formed() {
        assert_eq!(chat_work_done_token(Some("copilot-chat-1732-ab_12")), "copilot-chat-1732-ab_12");
        for bad in ["", "copilot-chat-", "other-1", "copilot-chat-a b", "copilot-chat-\u{e9}"] {
            let token = chat_work_done_token(Some(bad));
            assert_ne!(token, bad);
            assert!(token.starts_with(CHAT_TOKEN_PREFIX), "{token}");
        }
        let too_long = format!("copilot-chat-{}", "a".repeat(200));
        assert_ne!(chat_work_done_token(Some(&too_long)), too_long);
        // Two generated tokens differ even within the same millisecond.
        assert_ne!(chat_work_done_token(None), chat_work_done_token(None));
    }

    // --- path_to_uri ---

    #[test]
    fn path_to_uri_encodes_spaces_and_reserved_characters() {
        assert_eq!(path_to_uri("/Users/me/notes/a.md"), "file:///Users/me/notes/a.md");
        assert_eq!(
            path_to_uri("/Users/me/My Notes/a b#1?.md"),
            "file:///Users/me/My%20Notes/a%20b%231%3F.md"
        );
        // Unreserved characters are left alone.
        assert_eq!(path_to_uri("/a-b_c.d~e/f"), "file:///a-b_c.d~e/f");
    }

    #[test]
    fn path_to_uri_percent_encodes_unicode_as_utf8_bytes() {
        assert_eq!(path_to_uri("/notes/r\u{e9}sum\u{e9}.md"), "file:///notes/r%C3%A9sum%C3%A9.md");
        assert_eq!(path_to_uri("/\u{65e5}\u{672c}"), "file:///%E6%97%A5%E6%9C%AC");
    }

    #[test]
    fn path_to_uri_gives_non_rooted_paths_a_third_slash() {
        // A Windows path already written with forward slashes: the drive
        // colon is percent-encoded, which LSP clients accept.
        assert_eq!(path_to_uri("C:/Users/me/a.md"), "file:///C%3A/Users/me/a.md");
        assert_eq!(path_to_uri("relative/a.md"), "file:///relative/a.md");
    }
}
