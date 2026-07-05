//! MCP transport machinery: stdio (Content-Length framed JSON-RPC over a child
//! process) and Streamable HTTP (JSON-RPC POST with `application/json` or SSE
//! responses), unified behind [`McpConn`]. The transport-agnostic MCP protocol
//! operations (`initialize`, `tools/list`, `tools/call`) live here too.
//!
//! The stdio path reuses the shared `json_rpc` module for Content-Length
//! framing, message types, and pending-request bookkeeping. The HTTP path is a
//! genuinely different wire format (no Content-Length framing) and does its own
//! JSON/SSE body parsing — see the module note on `parse_jsonrpc_http_response`.

use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::BufReader;
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::Mutex;

use crate::commands::constants;
use crate::commands::json_rpc::{self, JsonRpcTransport, PendingRequests, ReadMessageResult};

use super::types::{McpContent, McpToolInfo, McpToolResult};

// ---------------------------------------------------------------------------
// MCP Transport — uses shared JsonRpcTransport from json_rpc module
// ---------------------------------------------------------------------------

/// Spawn a new MCP transport: creates a `JsonRpcTransport` for stdin and
/// starts the reader loop on stdout. Returns the transport handle.
pub(crate) fn spawn_mcp_transport(
    stdin: ChildStdin,
    stdout: ChildStdout,
    child_pid: Option<u32>,
    server_id: String,
    app: AppHandle,
) -> JsonRpcTransport {
    let transport = JsonRpcTransport::new(stdin);
    let reader_pending = transport.pending.clone();

    tokio::spawn(async move {
        if let Err(e) = mcp_reader_loop(stdout, reader_pending, child_pid, &server_id, &app).await {
            log::error!(target: "notesage::mcp", "Reader loop exited for server {}: {}", server_id, e);
            let _ = app.emit(
                "mcp-server-status",
                serde_json::json!({
                    "serverId": server_id,
                    "status": "error",
                    "error": format!("Server process exited: {}", e),
                }),
            );
        }
    });

    transport
}

// ---------------------------------------------------------------------------
// Reader loop
// ---------------------------------------------------------------------------

const MCP_READER_TIMEOUT: Duration = Duration::from_secs(30);

async fn mcp_reader_loop(
    stdout: ChildStdout,
    pending: PendingRequests,
    child_pid: Option<u32>,
    server_id: &str,
    app: &AppHandle,
) -> Result<(), String> {
    let mut reader = BufReader::new(stdout);

    loop {
        match json_rpc::read_next_message(&mut reader, MCP_READER_TIMEOUT, child_pid).await {
            ReadMessageResult::Message(msg) => {
                // MCP servers primarily send responses. We don't handle server-initiated
                // requests or notifications in v1 (no sampling, no notifications support).
                json_rpc::dispatch_response(&pending, &msg).await;
            }
            ReadMessageResult::Timeout => {
                log::warn!(target: "notesage::mcp", "Reader timeout for server {} — retrying", server_id);
                continue;
            }
            ReadMessageResult::Fatal(e) => {
                log::error!(target: "notesage::mcp", "MCP server {} reader fatal: {}", server_id, e);
                let _ = app.emit(
                    "mcp-server-status",
                    serde_json::json!({
                        "serverId": server_id,
                        "status": "error",
                        "error": format!("Server process exited: {}", e),
                    }),
                );
                return Err(format!("MCP server {} reader: {}", server_id, e));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// HTTP (Streamable HTTP) transport
// ---------------------------------------------------------------------------

/// Streamable HTTP MCP client. Each JSON-RPC request is a POST to the server's
/// single endpoint; the response arrives either as `application/json` (one
/// object) or `text/event-stream` (SSE `data:` events). The `Mcp-Session-Id`
/// header handed back on `initialize` is persisted and echoed on later requests.
///
/// MVP scope: request/response only — the optional long-lived GET stream for
/// server→client messages (and OAuth) land in follow-up slices. Cloneable
/// handles share the underlying `reqwest::Client` and session-id cell.
#[derive(Clone)]
pub struct HttpMcpClient {
    client: reqwest::Client,
    url: String,
    /// Server id used to resolve an OAuth bearer token from the keychain.
    server_id: String,
    session_id: Arc<Mutex<Option<String>>>,
}

/// Hard cap on an HTTP MCP response body. Remote MCP servers are third-party
/// endpoints; an unbounded `resp.text()` would let a hostile/buggy server
/// exhaust memory (audit batch 3 fix #7 — mirrors link_preview's
/// MAX_PREVIEW_BODY_BYTES pattern). Tool results are JSON/SSE text; 8 MiB is
/// generous.
const MAX_MCP_HTTP_BODY_BYTES: usize = 8 * 1024 * 1024;

/// Read a response body with a running-total byte cap, erroring past the cap.
async fn read_body_capped(mut resp: reqwest::Response, cap: usize) -> Result<String, String> {
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?
    {
        if body.len() + chunk.len() > cap {
            return Err(format!("Response body exceeds the {} byte limit", cap));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

impl HttpMcpClient {
    pub(crate) fn new(url: String, server_id: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        Self {
            client,
            url,
            server_id,
            session_id: Arc::new(Mutex::new(None)),
        }
    }

    async fn post(&self, body: String) -> Result<reqwest::Response, String> {
        let mut builder = self
            .client
            .post(self.url.as_str())
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .body(body);
        if let Some(sid) = self.session_id.lock().await.clone() {
            builder = builder.header("Mcp-Session-Id", sid);
        }
        // Attach an OAuth bearer token if this server has been authorized.
        if let Some(token) = crate::commands::mcp_oauth::valid_access_token(&self.server_id).await {
            builder = builder.header("Authorization", format!("Bearer {}", token));
        }
        builder
            .send()
            .await
            .map_err(|e| format!("HTTP request to {} failed: {}", self.url, e))
    }

    async fn send_request(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = json_rpc::next_request_id();
        let req = json_rpc::JsonRpcRequest::new(id, method, params);
        let body = serde_json::to_string(&req).map_err(|e| e.to_string())?;

        let resp = self.post(body).await?;
        if !resp.status().is_success() {
            return Err(format!("Server returned HTTP {}", resp.status()));
        }
        // Persist a server-assigned session id (sent on initialize).
        if let Some(sid) = resp
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
        {
            *self.session_id.lock().await = Some(sid);
        }
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let text = read_body_capped(resp, MAX_MCP_HTTP_BODY_BYTES).await?;

        parse_jsonrpc_http_response(&content_type, &text, id)
    }

    async fn send_notification(&self, method: &str, params: Option<Value>) -> Result<(), String> {
        let req = json_rpc::JsonRpcNotification::new(method, params);
        let body = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        let resp = self.post(body).await?;
        // Servers acknowledge notifications with 202 Accepted (any 2xx is fine).
        if !resp.status().is_success() {
            return Err(format!("Server returned HTTP {}", resp.status()));
        }
        Ok(())
    }
}

/// Parse `data:` events out of an SSE response body into JSON values. A blank
/// line dispatches the accumulated event; multi-line `data:` fields are joined
/// with `\n` per the SSE spec. Non-JSON data events and other fields
/// (`event:`, `id:`, `retry:`) are ignored.
fn parse_sse_data_events(body: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let mut data_buf: Vec<String> = Vec::new();
    let flush = |buf: &mut Vec<String>, out: &mut Vec<Value>| {
        if buf.is_empty() {
            return;
        }
        let joined = buf.join("\n");
        buf.clear();
        if let Ok(v) = serde_json::from_str::<Value>(&joined) {
            out.push(v);
        }
    };
    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            data_buf.push(rest.strip_prefix(' ').unwrap_or(rest).to_string());
        } else if line.is_empty() {
            flush(&mut data_buf, &mut out);
        }
    }
    flush(&mut data_buf, &mut out);
    out
}

/// Extract the JSON-RPC result for `expected_id` from an HTTP response body,
/// handling both `application/json` and `text/event-stream` content types.
/// Returns the `result` value, or an error if the server replied with a
/// JSON-RPC `error` or no matching response was found.
///
/// NOTE — this is deliberately NOT shared with `json_rpc.rs`. That module frames
/// messages with Content-Length headers over a stdio `AsyncBufRead` stream; this
/// parses a fully-buffered HTTP body that is either a single JSON object or an
/// SSE `text/event-stream`. Different transport, different framing; the only
/// genuinely shared layer (message *types* + request-id generation) is already
/// reused from `json_rpc` above.
fn parse_jsonrpc_http_response(
    content_type: &str,
    body: &str,
    expected_id: u64,
) -> Result<Value, String> {
    let messages: Vec<Value> = if content_type.contains("text/event-stream") {
        parse_sse_data_events(body)
    } else {
        match serde_json::from_str::<Value>(body) {
            Ok(v) => vec![v],
            Err(e) => return Err(format!("Invalid JSON response: {}", e)),
        }
    };

    for msg in &messages {
        if msg.get("id").and_then(|v| v.as_u64()) == Some(expected_id) {
            if let Some(err) = msg.get("error") {
                return Err(format!("Server error: {}", err));
            }
            return Ok(msg.get("result").cloned().unwrap_or(Value::Null));
        }
    }
    // Tolerate a lone response whose id didn't round-trip as a u64.
    if messages.len() == 1 {
        let msg = &messages[0];
        if let Some(err) = msg.get("error") {
            return Err(format!("Server error: {}", err));
        }
        if let Some(result) = msg.get("result") {
            return Ok(result.clone());
        }
    }
    Err("No matching JSON-RPC response in server reply".to_string())
}

// ---------------------------------------------------------------------------
// MCP connection — transport-agnostic dispatch
// ---------------------------------------------------------------------------

/// A live MCP connection, abstracting over the stdio child-process transport
/// and the remote HTTP transport so the protocol helpers (`mcp_initialize`,
/// `mcp_list_tools_from_server`, `mcp_call_tool_on_server`) work against either.
pub(crate) enum McpConn {
    Stdio(JsonRpcTransport),
    Http(HttpMcpClient),
}

impl McpConn {
    async fn send_request(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        match self {
            McpConn::Stdio(t) => t.send_request(method, params).await,
            McpConn::Http(c) => c.send_request(method, params).await,
        }
    }

    async fn send_notification(&self, method: &str, params: Option<Value>) -> Result<(), String> {
        match self {
            McpConn::Stdio(t) => t.send_notification(method, params).await,
            McpConn::Http(c) => c.send_notification(method, params).await,
        }
    }

    pub(crate) fn clone_handle(&self) -> McpConn {
        match self {
            McpConn::Stdio(t) => McpConn::Stdio(t.clone_handle()),
            McpConn::Http(c) => McpConn::Http(c.clone()),
        }
    }
}

// ---------------------------------------------------------------------------
// MCP Protocol Operations
// ---------------------------------------------------------------------------

pub(crate) async fn mcp_initialize(transport: &McpConn) -> Result<Value, String> {
    let init_params = serde_json::json!({
        "protocolVersion": constants::MCP_PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": {
            "name": "notesage",
            "version": "1.0.0"
        }
    });

    let result = transport
        .send_request("initialize", Some(init_params))
        .await?;

    // Send initialized notification
    transport
        .send_notification("notifications/initialized", None)
        .await?;

    Ok(result)
}

pub(crate) async fn mcp_list_tools_from_server(
    transport: &McpConn,
    server_id: &str,
) -> Result<Vec<McpToolInfo>, String> {
    let result = transport
        .send_request("tools/list", Some(serde_json::json!({})))
        .await?;

    let tools_arr = result
        .get("tools")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut tools = Vec::new();
    for tool_val in tools_arr {
        let name = tool_val
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let description = tool_val
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let input_schema = tool_val
            .get("inputSchema")
            .cloned()
            .unwrap_or(serde_json::json!({}));

        if !name.is_empty() {
            tools.push(McpToolInfo {
                name,
                description,
                input_schema,
                server_id: server_id.to_string(),
            });
        }
    }

    Ok(tools)
}

pub(crate) async fn mcp_call_tool_on_server(
    transport: &McpConn,
    tool_name: &str,
    arguments: Value,
) -> Result<McpToolResult, String> {
    let params = serde_json::json!({
        "name": tool_name,
        "arguments": arguments,
    });

    let result = transport.send_request("tools/call", Some(params)).await?;

    let is_error = result
        .get("isError")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let content_arr = result
        .get("content")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let content: Vec<McpContent> = content_arr
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect();

    Ok(McpToolResult { content, is_error })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_json_http_response_extracts_result() {
        let body = r#"{"jsonrpc":"2.0","id":7,"result":{"tools":[]}}"#;
        let v = parse_jsonrpc_http_response("application/json", body, 7).expect("ok");
        assert!(v.get("tools").is_some());
    }

    #[test]
    fn parse_json_http_response_surfaces_rpc_error() {
        let body = r#"{"jsonrpc":"2.0","id":7,"error":{"code":-32601,"message":"no"}}"#;
        let err = parse_jsonrpc_http_response("application/json", body, 7).unwrap_err();
        assert!(err.contains("Server error"));
    }

    #[test]
    fn parse_sse_http_response_extracts_matching_id() {
        // Two SSE events; only id=2 matches.
        let body = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"a\":1}}\n\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"b\":2}}\n\n";
        let v = parse_jsonrpc_http_response("text/event-stream; charset=utf-8", body, 2).expect("ok");
        assert_eq!(v.get("b").and_then(|x| x.as_i64()), Some(2));
    }

    #[test]
    fn parse_sse_joins_multiline_data_fields() {
        // A single event whose JSON is split across two `data:` lines.
        let body = "data: {\"jsonrpc\":\"2.0\",\"id\":5,\ndata: \"result\":{\"ok\":true}}\n\n";
        let events = parse_sse_data_events(body);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].get("id").and_then(|x| x.as_u64()), Some(5));
    }

    #[test]
    fn parse_http_response_lenient_single_message_fallback() {
        // A lone response whose id didn't round-trip still resolves to its result.
        let body = r#"{"jsonrpc":"2.0","id":99,"result":{"ok":true}}"#;
        let v = parse_jsonrpc_http_response("application/json", body, 7).expect("lenient ok");
        assert_eq!(v.get("ok").and_then(|x| x.as_bool()), Some(true));
    }

    #[test]
    fn parse_http_response_empty_stream_is_error() {
        let err = parse_jsonrpc_http_response("text/event-stream", "", 7).unwrap_err();
        assert!(err.contains("No matching"));
    }
}
