//! Integration tests for the mock ACP agent binary.
//!
//! These tests spawn the `mock_acp_agent` binary and exercise a full ACP session
//! lifecycle over its stdio transport.  The binary is built as a Cargo `[[bin]]`
//! target so `env!("CARGO_BIN_EXE_mock_acp_agent")` is available here.
//!
//! ## Running
//!
//! ```bash
//! cd src-tauri
//! cargo test --test mock_acp_agent
//! ```

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::time::timeout;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Path to the compiled mock binary.
const MOCK_BINARY: &str = env!("CARGO_BIN_EXE_mock_acp_agent");

/// Generate a unique JSON-RPC id for a test.
fn next_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    COUNTER.fetch_add(1, Ordering::Relaxed)
}

/// Write a JSON-RPC request to the mock binary's stdin and return a parsed
/// response object.  Uses Content-Length framing (the ACP wire format).
async fn send_request(
    stdin: &mut tokio::process::ChildStdin,
    stdout: &mut BufReader<tokio::process::ChildStdout>,
    method: &str,
    params: serde_json::Value,
) -> serde_json::Value {
    let id = next_id();
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });
    let body_str = serde_json::to_string(&body).unwrap();
    let frame = format!("Content-Length: {}\r\n\r\n{}", body_str.len(), body_str);
    stdin.write_all(frame.as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    // Read messages until we find the matching response (skip notifications).
    loop {
        let msg = read_message(stdout).await;
        // Notifications lack an "id" field at the top level (or have null id).
        if let Some(resp_id) = msg.get("id") {
            if resp_id == id {
                return msg;
            }
        }
    }
}

/// Read a single Content-Length-framed JSON-RPC message from stdout.
async fn read_message(stdout: &mut BufReader<tokio::process::ChildStdout>) -> serde_json::Value {
    let deadline = Duration::from_secs(10);
    let result = timeout(deadline, async {
        let mut headers = String::new();
        let mut content_length: Option<usize> = None;

        // Read header lines until blank line.
        loop {
            let mut line = String::new();
            stdout.read_line(&mut line).await.unwrap();
            let trimmed = line.trim();
            if trimmed.is_empty() {
                break;
            }
            if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
                content_length = Some(rest.trim().parse().unwrap());
            }
            headers.push_str(&line);
        }

        let len = content_length.expect("no Content-Length header");
        let mut body = vec![0u8; len];
        use tokio::io::AsyncReadExt;
        stdout.read_exact(&mut body).await.unwrap();
        serde_json::from_slice(&body).unwrap()
    })
    .await;
    result.expect("timeout reading ACP message")
}

/// Collect all notification messages that arrive within `wait_ms` milliseconds
/// after a `send_request` is sent for `method`.  Useful for capturing session
/// updates that the mock sends before the final PromptResponse.
async fn collect_notifications(
    stdout: &mut BufReader<tokio::process::ChildStdout>,
    wait_ms: u64,
) -> Vec<serde_json::Value> {
    let mut notifications = Vec::new();
    let deadline = Duration::from_millis(wait_ms);
    while let Ok(Ok(msg)) = timeout(deadline, async {
        read_message(stdout).await
    })
    .await
    {
        // Notifications have no "id" field or a null id.
        match msg.get("id") {
            None | Some(serde_json::Value::Null) => notifications.push(msg),
            _ => {
                // It's a response — re-push it for the caller somehow.
                // For our usage this situation doesn't arise; keep it simple.
            }
        }
    }
    notifications
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Full happy-path lifecycle: initialize → session/new → session/prompt → session/close.
/// The mock returns a plain text response for the "text" fixture.
#[tokio::test]
#[ignore = "requires compiled mock_acp_agent binary; run with `cargo test --test mock_acp_agent -- --ignored`"]
async fn full_session_lifecycle_text_fixture() {
    let mut child = TokioCommand::new(MOCK_BINARY)
        .arg("--fixture")
        .arg("text")
        .arg("--profile")
        .arg("full")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to spawn mock_acp_agent");

    let stdin = child.stdin.as_mut().unwrap();
    let stdout = BufReader::new(child.stdout.take().unwrap());
    let mut stdout = stdout;

    // initialize
    let init_resp = send_request(
        stdin,
        &mut stdout,
        "initialize",
        serde_json::json!({
            "protocolVersion": "0.1",
            "clientInfo": { "name": "test-client", "version": "0.0.1" }
        }),
    )
    .await;
    assert!(init_resp.get("result").is_some(), "initialize failed: {init_resp}");
    let caps = &init_resp["result"]["agentCapabilities"];
    assert!(
        caps.get("session").is_some(),
        "full profile must advertise session capabilities: {caps}"
    );

    // session/new
    let new_resp = send_request(
        stdin,
        &mut stdout,
        "session/new",
        serde_json::json!({ "cwd": "/tmp/test" }),
    )
    .await;
    assert!(new_resp.get("result").is_some(), "session/new failed: {new_resp}");
    let session_id = new_resp["result"]["sessionId"]
        .as_str()
        .expect("no sessionId in session/new response")
        .to_owned();

    // session/prompt — collect notifications, then read the response
    let id = next_id();
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "session/prompt",
        "params": {
            "sessionId": session_id,
            "messages": [{ "role": "user", "content": [{ "type": "text", "text": "hello" }] }],
        },
    });
    let body_str = serde_json::to_string(&body).unwrap();
    let frame = format!("Content-Length: {}\r\n\r\n{}", body_str.len(), body_str);
    stdin.write_all(frame.as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    // Drain notifications + find the prompt response.
    let mut prompt_resp: Option<serde_json::Value> = None;
    let mut got_agent_message_chunk = false;
    let mut got_agent_turn_complete = false;

    for _ in 0..50 {
        let msg = timeout(Duration::from_secs(5), read_message(&mut stdout))
            .await
            .expect("timeout waiting for prompt messages")
            .expect("stream ended");

        // Notification (no id or null id)?
        let is_notification = matches!(msg.get("id"), None | Some(serde_json::Value::Null));
        if is_notification {
            let params = &msg["params"];
            let update = &params["update"];
            let update_type = update["sessionUpdate"].as_str().unwrap_or("");
            if update_type == "agent_message_chunk" {
                got_agent_message_chunk = true;
            }
            if update_type == "agent_turn_complete" {
                got_agent_turn_complete = true;
            }
        } else if msg.get("id").and_then(|v| v.as_u64()) == Some(id) {
            prompt_resp = Some(msg);
            break;
        }
    }

    let prompt_resp = prompt_resp.expect("did not receive prompt response");
    assert!(prompt_resp.get("result").is_some(), "session/prompt failed: {prompt_resp}");
    assert!(got_agent_message_chunk, "expected at least one agent_message_chunk notification");
    assert!(got_agent_turn_complete, "expected agent_turn_complete notification");

    // session/close
    let close_resp = send_request(
        stdin,
        &mut stdout,
        "session/close",
        serde_json::json!({ "sessionId": session_id }),
    )
    .await;
    assert!(close_resp.get("result").is_some(), "session/close failed: {close_resp}");

    child.kill().await.ok();
}

/// Minimal profile: the mock must NOT advertise session fork/resume/close capabilities.
#[tokio::test]
#[ignore = "requires compiled mock_acp_agent binary; run with `cargo test --test mock_acp_agent -- --ignored`"]
async fn minimal_profile_lacks_session_fork_and_close() {
    let mut child = TokioCommand::new(MOCK_BINARY)
        .arg("--fixture")
        .arg("text")
        .arg("--profile")
        .arg("minimal")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to spawn mock_acp_agent");

    let stdin = child.stdin.as_mut().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());

    let resp = send_request(
        stdin,
        &mut stdout,
        "initialize",
        serde_json::json!({
            "protocolVersion": "0.1",
            "clientInfo": { "name": "test-client", "version": "0.0.1" }
        }),
    )
    .await;
    assert!(resp.get("result").is_some(), "initialize failed: {resp}");
    let caps = &resp["result"]["agentCapabilities"];
    // Minimal profile has no session fork or close capabilities.
    let session_caps = &caps["session"];
    assert!(
        session_caps.get("fork").is_none() || session_caps["fork"].is_null(),
        "minimal profile must NOT advertise session.fork: {session_caps}"
    );
    assert!(
        session_caps.get("close").is_none() || session_caps["close"].is_null(),
        "minimal profile must NOT advertise session.close: {session_caps}"
    );

    child.kill().await.ok();
}

/// The "thinking" fixture emits an `agent_thought_chunk` notification before the text response.
#[tokio::test]
#[ignore = "requires compiled mock_acp_agent binary; run with `cargo test --test mock_acp_agent -- --ignored`"]
async fn thinking_fixture_emits_thought_chunk() {
    let mut child = TokioCommand::new(MOCK_BINARY)
        .arg("--fixture")
        .arg("thinking")
        .arg("--profile")
        .arg("full")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to spawn mock_acp_agent");

    let stdin = child.stdin.as_mut().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());

    // initialize + session/new
    send_request(
        stdin,
        &mut stdout,
        "initialize",
        serde_json::json!({ "protocolVersion": "0.1", "clientInfo": { "name": "t", "version": "0" } }),
    )
    .await;
    let new_resp = send_request(
        stdin,
        &mut stdout,
        "session/new",
        serde_json::json!({ "cwd": "/tmp" }),
    )
    .await;
    let session_id = new_resp["result"]["sessionId"].as_str().unwrap().to_owned();

    // session/prompt — send and collect notifications
    let id = next_id();
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": id, "method": "session/prompt",
        "params": { "sessionId": session_id, "messages": [{ "role": "user", "content": [{ "type": "text", "text": "think" }] }] },
    });
    let body_str = serde_json::to_string(&body).unwrap();
    stdin.write_all(format!("Content-Length: {}\r\n\r\n{}", body_str.len(), body_str).as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    let mut got_thought_chunk = false;
    for _ in 0..50 {
        let msg = timeout(Duration::from_secs(5), read_message(&mut stdout))
            .await
            .expect("timeout")
            .expect("stream ended");
        let is_notification = matches!(msg.get("id"), None | Some(serde_json::Value::Null));
        if is_notification {
            let update_type = msg["params"]["update"]["sessionUpdate"].as_str().unwrap_or("");
            if update_type == "agent_thought_chunk" {
                got_thought_chunk = true;
            }
        } else if msg.get("id").and_then(|v| v.as_u64()) == Some(id) {
            break;
        }
    }

    assert!(got_thought_chunk, "thinking fixture must emit agent_thought_chunk");
    child.kill().await.ok();
}

/// The "tool_call" fixture emits a `tool_call` notification and requests permission.
#[tokio::test]
#[ignore = "requires compiled mock_acp_agent binary; run with `cargo test --test mock_acp_agent -- --ignored`"]
async fn tool_call_fixture_emits_permission_request() {
    let mut child = TokioCommand::new(MOCK_BINARY)
        .arg("--fixture")
        .arg("tool_call")
        .arg("--profile")
        .arg("full")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to spawn mock_acp_agent");

    let stdin = child.stdin.as_mut().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());

    send_request(
        stdin,
        &mut stdout,
        "initialize",
        serde_json::json!({ "protocolVersion": "0.1", "clientInfo": { "name": "t", "version": "0" } }),
    )
    .await;
    let new_resp = send_request(stdin, &mut stdout, "session/new", serde_json::json!({ "cwd": "/tmp" })).await;
    let session_id = new_resp["result"]["sessionId"].as_str().unwrap().to_owned();

    // session/prompt
    let id = next_id();
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": id, "method": "session/prompt",
        "params": { "sessionId": session_id, "messages": [{ "role": "user", "content": [{ "type": "text", "text": "use a tool" }] }] },
    });
    let body_str = serde_json::to_string(&body).unwrap();
    stdin.write_all(format!("Content-Length: {}\r\n\r\n{}", body_str.len(), body_str).as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    let mut got_tool_call = false;
    let mut got_permission_request = false;

    for _ in 0..50 {
        let msg = timeout(Duration::from_secs(5), read_message(&mut stdout))
            .await
            .expect("timeout")
            .expect("stream ended");

        let is_notification = matches!(msg.get("id"), None | Some(serde_json::Value::Null));
        if is_notification {
            let update_type = msg["params"]["update"]["sessionUpdate"].as_str().unwrap_or("");
            if update_type == "tool_call" {
                got_tool_call = true;
            }
        } else {
            // Could be a session/requestPermission request — it has an id and method.
            if msg.get("method").and_then(|m| m.as_str()) == Some("session/requestPermission") {
                got_permission_request = true;
                // Respond with the first option id.
                let req_id = msg["id"].clone();
                let options = msg["params"]["options"].as_array().unwrap();
                let first_option_id = options[0]["optionId"].as_str().unwrap();
                let response = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": { "outcome": first_option_id },
                });
                let resp_str = serde_json::to_string(&response).unwrap();
                stdin.write_all(format!("Content-Length: {}\r\n\r\n{}", resp_str.len(), resp_str).as_bytes()).await.unwrap();
                stdin.flush().await.unwrap();
            } else if msg.get("id").and_then(|v| v.as_u64()) == Some(id) {
                break;
            }
        }
    }

    assert!(got_tool_call, "tool_call fixture must emit a tool_call notification");
    assert!(got_permission_request, "tool_call fixture must request permission before executing");
    child.kill().await.ok();
}

/// The "plan" fixture emits a `plan` notification.
#[tokio::test]
#[ignore = "requires compiled mock_acp_agent binary; run with `cargo test --test mock_acp_agent -- --ignored`"]
async fn plan_fixture_emits_plan_notification() {
    let mut child = TokioCommand::new(MOCK_BINARY)
        .arg("--fixture")
        .arg("plan")
        .arg("--profile")
        .arg("full")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to spawn mock_acp_agent");

    let stdin = child.stdin.as_mut().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());

    send_request(
        stdin,
        &mut stdout,
        "initialize",
        serde_json::json!({ "protocolVersion": "0.1", "clientInfo": { "name": "t", "version": "0" } }),
    )
    .await;
    let new_resp = send_request(stdin, &mut stdout, "session/new", serde_json::json!({ "cwd": "/tmp" })).await;
    let session_id = new_resp["result"]["sessionId"].as_str().unwrap().to_owned();

    let id = next_id();
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": id, "method": "session/prompt",
        "params": { "sessionId": session_id, "messages": [{ "role": "user", "content": [{ "type": "text", "text": "plan" }] }] },
    });
    let body_str = serde_json::to_string(&body).unwrap();
    stdin.write_all(format!("Content-Length: {}\r\n\r\n{}", body_str.len(), body_str).as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    let mut got_plan = false;
    for _ in 0..50 {
        let msg = timeout(Duration::from_secs(5), read_message(&mut stdout))
            .await
            .expect("timeout")
            .expect("stream ended");
        let is_notification = matches!(msg.get("id"), None | Some(serde_json::Value::Null));
        if is_notification {
            let update_type = msg["params"]["update"]["sessionUpdate"].as_str().unwrap_or("");
            if update_type == "plan" {
                got_plan = true;
                let entries = &msg["params"]["update"]["entries"];
                assert!(entries.is_array(), "plan notification must have entries array");
                assert!(!entries.as_array().unwrap().is_empty(), "plan must have at least one entry");
            }
        } else if msg.get("id").and_then(|v| v.as_u64()) == Some(id) {
            break;
        }
    }

    assert!(got_plan, "plan fixture must emit a plan notification");
    child.kill().await.ok();
}

/// The "usage" fixture emits a `usageUpdate` notification.
#[tokio::test]
#[ignore = "requires compiled mock_acp_agent binary; run with `cargo test --test mock_acp_agent -- --ignored`"]
async fn usage_fixture_emits_usage_update() {
    let mut child = TokioCommand::new(MOCK_BINARY)
        .arg("--fixture")
        .arg("usage")
        .arg("--profile")
        .arg("full")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to spawn mock_acp_agent");

    let stdin = child.stdin.as_mut().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());

    send_request(
        stdin,
        &mut stdout,
        "initialize",
        serde_json::json!({ "protocolVersion": "0.1", "clientInfo": { "name": "t", "version": "0" } }),
    )
    .await;
    let new_resp = send_request(stdin, &mut stdout, "session/new", serde_json::json!({ "cwd": "/tmp" })).await;
    let session_id = new_resp["result"]["sessionId"].as_str().unwrap().to_owned();

    let id = next_id();
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": id, "method": "session/prompt",
        "params": { "sessionId": session_id, "messages": [{ "role": "user", "content": [{ "type": "text", "text": "usage" }] }] },
    });
    let body_str = serde_json::to_string(&body).unwrap();
    stdin.write_all(format!("Content-Length: {}\r\n\r\n{}", body_str.len(), body_str).as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    let mut got_usage_update = false;
    for _ in 0..50 {
        let msg = timeout(Duration::from_secs(5), read_message(&mut stdout))
            .await
            .expect("timeout")
            .expect("stream ended");
        let is_notification = matches!(msg.get("id"), None | Some(serde_json::Value::Null));
        if is_notification {
            let update_type = msg["params"]["update"]["sessionUpdate"].as_str().unwrap_or("");
            if update_type == "usageUpdate" {
                got_usage_update = true;
                let used = msg["params"]["update"]["used"].as_u64();
                let size = msg["params"]["update"]["size"].as_u64();
                assert!(used.is_some(), "usageUpdate must have 'used' field");
                assert!(size.is_some(), "usageUpdate must have 'size' field");
            }
        } else if msg.get("id").and_then(|v| v.as_u64()) == Some(id) {
            break;
        }
    }

    assert!(got_usage_update, "usage fixture must emit a usageUpdate notification");
    child.kill().await.ok();
}
