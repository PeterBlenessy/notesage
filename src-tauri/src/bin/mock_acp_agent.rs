//! Mock ACP agent binary for CI regression testing.
//!
//! Speaks the ACP stdio protocol (JSON-RPC 2.0 with Content-Length framing) and
//! replays canned fixture streams.  Used by `src-tauri/tests/mock_acp_agent.rs`
//! to exercise `acp_client.rs` and `useAcpSessionListeners.ts` without real agents,
//! API keys, or network access.
//!
//! ## Usage
//!
//! ```
//! mock_acp_agent --fixture <name> --profile <full|minimal>
//! ```
//!
//! **Fixtures** (select which session updates `session/prompt` emits):
//! - `text`      — plain `agent_message_chunk` + `agent_turn_complete`
//! - `thinking`  — `agent_thought_chunk` before the text chunk
//! - `tool_call` — `tool_call` notification + `session/requestPermission` request
//! - `plan`      — `plan` notification before the text chunk
//! - `usage`     — `usageUpdate` notification after the text chunk
//!
//! **Profiles** (capability advertisements on `initialize`):
//! - `full`    — all session capabilities (fork, resume, close, list)
//! - `minimal` — no optional session capabilities

use std::io::{Read, Write};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// JSON-RPC wire format
// ---------------------------------------------------------------------------

fn read_message(reader: &mut impl Read) -> Option<serde_json::Value> {
    // Parse Content-Length header
    let mut header_buf = Vec::new();
    let mut byte = [0u8; 1];
    let mut last_four = [0u8; 4];
    loop {
        reader.read_exact(&mut byte).ok()?;
        header_buf.push(byte[0]);
        let len = header_buf.len();
        if len >= 4 {
            last_four[0] = header_buf[len - 4];
            last_four[1] = header_buf[len - 3];
            last_four[2] = header_buf[len - 2];
            last_four[3] = header_buf[len - 1];
            // \r\n\r\n signals end of headers
            if last_four == [b'\r', b'\n', b'\r', b'\n'] {
                break;
            }
        }
    }
    let headers = String::from_utf8_lossy(&header_buf);
    let content_length: usize = headers
        .lines()
        .find(|l| l.to_lowercase().starts_with("content-length:"))?
        .split(':')
        .nth(1)?
        .trim()
        .parse()
        .ok()?;

    let mut body = vec![0u8; content_length];
    reader.read_exact(&mut body).ok()?;
    serde_json::from_slice(&body).ok()
}

fn send_message(writer: &mut impl Write, msg: &serde_json::Value) {
    let body = serde_json::to_string(msg).unwrap();
    write!(writer, "Content-Length: {}\r\n\r\n{}", body.len(), body).unwrap();
    writer.flush().unwrap();
}

fn make_response(id: &serde_json::Value, result: serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn make_error(id: &serde_json::Value, code: i64, message: &str) -> serde_json::Value {
    serde_json::json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Notification (no id — fire-and-forget session update).
fn make_notification(method: &str, params: serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "jsonrpc": "2.0", "method": method, "params": params })
}

// ---------------------------------------------------------------------------
// Capability profiles
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
enum Profile {
    Full,
    Minimal,
}

fn capabilities(profile: Profile) -> serde_json::Value {
    match profile {
        Profile::Full => serde_json::json!({
            "session": {
                "list": {},
                "fork": {},
                "resume": {},
                "close": {}
            },
            "prompt": {
                "images": true,
                "thinking": true
            }
        }),
        Profile::Minimal => serde_json::json!({
            "session": {}
        }),
    }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
enum Fixture {
    Text,
    Thinking,
    ToolCall,
    Plan,
    Usage,
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Parse --fixture and --profile flags.
    let fixture = {
        let idx = args.iter().position(|a| a == "--fixture").unwrap_or(0);
        match args.get(idx + 1).map(|s| s.as_str()) {
            Some("thinking") => Fixture::Thinking,
            Some("tool_call") => Fixture::ToolCall,
            Some("plan") => Fixture::Plan,
            Some("usage") => Fixture::Usage,
            _ => Fixture::Text,
        }
    };

    let profile = {
        let idx = args.iter().position(|a| a == "--profile").unwrap_or(0);
        match args.get(idx + 1).map(|s| s.as_str()) {
            Some("minimal") => Profile::Minimal,
            _ => Profile::Full,
        }
    };

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();

    // Session state: map session_id → cwd
    let mut sessions: HashMap<String, String> = HashMap::new();
    let mut next_session: u64 = 1;

    // Permission request tracking: each tool_call fixture emits one request.
    // We use a simple counter to give unique request IDs.
    let mut next_perm_id: u64 = 1;

    loop {
        let msg = match read_message(&mut reader) {
            Some(m) => m,
            None => break, // stdin closed
        };

        let id = msg.get("id").cloned().unwrap_or(serde_json::Value::Null);
        let method = msg["method"].as_str().unwrap_or("").to_owned();
        let params = msg.get("params").cloned().unwrap_or(serde_json::Value::Object(Default::default()));

        match method.as_str() {
            // ------------------------------------------------------------------
            // initialize
            // ------------------------------------------------------------------
            "initialize" => {
                let response = make_response(
                    &id,
                    serde_json::json!({
                        "protocolVersion": "1",
                        "agentInfo": { "name": "mock-acp-agent", "version": "0.1.0" },
                        "agentCapabilities": capabilities(profile),
                    }),
                );
                send_message(&mut writer, &response);
            }

            // ------------------------------------------------------------------
            // authenticate
            // ------------------------------------------------------------------
            "authenticate" => {
                let response = make_response(&id, serde_json::json!({}));
                send_message(&mut writer, &response);
            }

            // ------------------------------------------------------------------
            // session/new
            // ------------------------------------------------------------------
            "session/new" => {
                let session_id = format!("mock-session-{}", next_session);
                next_session += 1;
                let cwd = params["cwd"].as_str().unwrap_or("/tmp").to_owned();
                sessions.insert(session_id.clone(), cwd);
                let response = make_response(
                    &id,
                    serde_json::json!({ "sessionId": session_id }),
                );
                send_message(&mut writer, &response);
            }

            // ------------------------------------------------------------------
            // session/resume
            // ------------------------------------------------------------------
            "session/resume" => {
                let session_id = params["sessionId"].as_str().unwrap_or("").to_owned();
                let cwd = params.get("cwd")
                    .and_then(|v| v.as_str())
                    .unwrap_or("/tmp")
                    .to_owned();
                sessions.entry(session_id.clone()).or_insert_with(|| cwd);
                let response = make_response(
                    &id,
                    serde_json::json!({ "sessionId": session_id }),
                );
                send_message(&mut writer, &response);
            }

            // ------------------------------------------------------------------
            // session/load
            // ------------------------------------------------------------------
            "session/load" => {
                let session_id = params["sessionId"].as_str().unwrap_or("").to_owned();
                let cwd = params.get("cwd")
                    .and_then(|v| v.as_str())
                    .unwrap_or("/tmp")
                    .to_owned();
                sessions.entry(session_id.clone()).or_insert_with(|| cwd);
                let response = make_response(
                    &id,
                    serde_json::json!({ "sessionId": session_id }),
                );
                send_message(&mut writer, &response);
            }

            // ------------------------------------------------------------------
            // session/fork
            // ------------------------------------------------------------------
            "session/fork" => {
                let new_session_id = format!("mock-session-{}", next_session);
                next_session += 1;
                let cwd = params.get("cwd")
                    .and_then(|v| v.as_str())
                    .unwrap_or("/tmp")
                    .to_owned();
                sessions.insert(new_session_id.clone(), cwd);
                let response = make_response(
                    &id,
                    serde_json::json!({ "sessionId": new_session_id }),
                );
                send_message(&mut writer, &response);
            }

            // ------------------------------------------------------------------
            // session/list
            // ------------------------------------------------------------------
            "session/list" => {
                let session_list: Vec<serde_json::Value> = sessions
                    .iter()
                    .map(|(sid, cwd)| serde_json::json!({ "sessionId": sid, "cwd": cwd }))
                    .collect();
                let response = make_response(
                    &id,
                    serde_json::json!({ "sessions": session_list }),
                );
                send_message(&mut writer, &response);
            }

            // ------------------------------------------------------------------
            // session/close
            // ------------------------------------------------------------------
            "session/close" => {
                let session_id = params["sessionId"].as_str().unwrap_or("");
                sessions.remove(session_id);
                let response = make_response(&id, serde_json::json!({}));
                send_message(&mut writer, &response);
            }

            // ------------------------------------------------------------------
            // session/cancel
            // ------------------------------------------------------------------
            "session/cancel" => {
                // Fire-and-forget notification from client — no response needed.
            }

            // ------------------------------------------------------------------
            // session/prompt — the main fixture dispatch
            // ------------------------------------------------------------------
            "session/prompt" => {
                let session_id = params["sessionId"].as_str().unwrap_or("").to_owned();

                match fixture {
                    // ---- text ------------------------------------------------
                    Fixture::Text => {
                        // agent_message_chunk
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": {
                                        "sessionUpdate": "agent_message_chunk",
                                        "content": { "type": "text", "text": "Hello from mock agent." }
                                    }
                                }),
                            ),
                        );
                        // agent_turn_complete
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": { "sessionUpdate": "agent_turn_complete" }
                                }),
                            ),
                        );
                        let response = make_response(
                            &id,
                            serde_json::json!({ "stopReason": "done" }),
                        );
                        send_message(&mut writer, &response);
                    }

                    // ---- thinking --------------------------------------------
                    Fixture::Thinking => {
                        // agent_thought_chunk
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": {
                                        "sessionUpdate": "agent_thought_chunk",
                                        "content": { "type": "text", "text": "Let me think about this..." }
                                    }
                                }),
                            ),
                        );
                        // agent_message_chunk
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": {
                                        "sessionUpdate": "agent_message_chunk",
                                        "content": { "type": "text", "text": "After thinking: the answer is 42." }
                                    }
                                }),
                            ),
                        );
                        // agent_turn_complete
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": { "sessionUpdate": "agent_turn_complete" }
                                }),
                            ),
                        );
                        let response = make_response(
                            &id,
                            serde_json::json!({ "stopReason": "done" }),
                        );
                        send_message(&mut writer, &response);
                    }

                    // ---- tool_call -------------------------------------------
                    Fixture::ToolCall => {
                        let tool_call_id = "tc-mock-1";
                        // tool_call notification
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": {
                                        "sessionUpdate": "tool_call",
                                        "kind": "read",
                                        "title": "Read /tmp/example.txt",
                                        "rawInput": r#"{"file_path":"/tmp/example.txt"}"#,
                                        "toolCallId": tool_call_id
                                    }
                                }),
                            ),
                        );

                        // session/requestPermission (inbound request from agent to client)
                        let perm_id = next_perm_id;
                        next_perm_id += 1;
                        let perm_request = serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": perm_id,
                            "method": "session/requestPermission",
                            "params": {
                                "sessionId": session_id,
                                "toolCall": {
                                    "toolCallId": tool_call_id,
                                    "title": "Read /tmp/example.txt",
                                    "fields": {}
                                },
                                "options": [
                                    {
                                        "optionId": "allow_once",
                                        "name": "Allow once",
                                        "kind": "allow_once"
                                    },
                                    {
                                        "optionId": "reject_once",
                                        "name": "Reject",
                                        "kind": "reject_once"
                                    }
                                ]
                            }
                        });
                        send_message(&mut writer, &perm_request);

                        // Wait for the permission response from the client.
                        let perm_resp = match read_message(&mut reader) {
                            Some(m) => m,
                            None => break,
                        };

                        // Regardless of the client's choice, send a tool_result and done.
                        let outcome = perm_resp.get("result")
                            .and_then(|r| r.get("outcome"))
                            .cloned()
                            .unwrap_or(serde_json::json!({"outcome": "cancelled"}));

                        // tool_call_update (mark as done)
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": {
                                        "sessionUpdate": "tool_call_update",
                                        "toolCallId": tool_call_id,
                                        "kind": "read",
                                        "status": "completed"
                                    }
                                }),
                            ),
                        );

                        // agent_message_chunk with result
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": {
                                        "sessionUpdate": "agent_message_chunk",
                                        "content": { "type": "text", "text": "I read the file successfully." }
                                    }
                                }),
                            ),
                        );

                        // agent_turn_complete
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": { "sessionUpdate": "agent_turn_complete" }
                                }),
                            ),
                        );
                        let response = make_response(
                            &id,
                            serde_json::json!({ "stopReason": "done" }),
                        );
                        send_message(&mut writer, &response);
                    }

                    // ---- plan ------------------------------------------------
                    Fixture::Plan => {
                        // plan notification
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": {
                                        "sessionUpdate": "plan",
                                        "entries": [
                                            { "content": "Analyse the request", "priority": "high", "status": "in_progress" },
                                            { "content": "Draft a response", "priority": "medium", "status": "pending" },
                                            { "content": "Review and finalise", "priority": "low", "status": "pending" }
                                        ]
                                    }
                                }),
                            ),
                        );
                        // agent_message_chunk
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": {
                                        "sessionUpdate": "agent_message_chunk",
                                        "content": { "type": "text", "text": "Here is my plan output." }
                                    }
                                }),
                            ),
                        );
                        // agent_turn_complete
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": { "sessionUpdate": "agent_turn_complete" }
                                }),
                            ),
                        );
                        let response = make_response(
                            &id,
                            serde_json::json!({ "stopReason": "done" }),
                        );
                        send_message(&mut writer, &response);
                    }

                    // ---- usage -----------------------------------------------
                    Fixture::Usage => {
                        // agent_message_chunk
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": {
                                        "sessionUpdate": "agent_message_chunk",
                                        "content": { "type": "text", "text": "Done." }
                                    }
                                }),
                            ),
                        );
                        // usageUpdate notification
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": {
                                        "sessionUpdate": "usageUpdate",
                                        "used": 1234,
                                        "size": 200000,
                                        "cost": { "amount": 0.0025, "currency": "USD" }
                                    }
                                }),
                            ),
                        );
                        // agent_turn_complete
                        send_message(
                            &mut writer,
                            &make_notification(
                                "session/update",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "update": { "sessionUpdate": "agent_turn_complete" }
                                }),
                            ),
                        );
                        let response = make_response(
                            &id,
                            serde_json::json!({ "stopReason": "done" }),
                        );
                        send_message(&mut writer, &response);
                    }
                }
            }

            // ------------------------------------------------------------------
            // Unknown method
            // ------------------------------------------------------------------
            _ => {
                let err = make_error(&id, -32601, &format!("Method not found: {method}"));
                send_message(&mut writer, &err);
            }
        }
    }
}
