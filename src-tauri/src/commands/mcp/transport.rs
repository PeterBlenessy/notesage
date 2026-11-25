//! MCP transport machinery: stdio (newline-delimited JSON-RPC over a child
//! process) and Streamable HTTP (JSON-RPC POST with `application/json` or SSE
//! responses), unified behind [`McpConn`]. The transport-agnostic MCP protocol
//! operations (`initialize`, `tools/list`, `tools/call`) live here too.
//!
//! The stdio path reuses the shared `json_rpc` module for the newline framing,
//! message types, and pending-request bookkeeping. MCP stdio is NOT the
//! `Content-Length` framing LSP uses: it is one JSON message per line. The
//! HTTP path is a different wire format again and does its own JSON/SSE body
//! parsing — see the module note on `parse_jsonrpc_http_response`.
//!
//! Nothing here depends on Tauri: a reader loop reports its exit through an
//! [`ExitHook`], so the whole client can be driven from a test against a real
//! server process.

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::BufReader;
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{mpsc, Mutex};

use crate::commands::constants;
use crate::commands::json_rpc::{
    self, Framing, JsonRpcMessage, JsonRpcTransport, PendingRequests, ReadMessageResult,
};

use super::stderr_drain::StderrTail;
use super::types::{McpContent, McpToolInfo, McpToolResult};

// ---------------------------------------------------------------------------
// MCP Transport — uses shared JsonRpcTransport from json_rpc module
// ---------------------------------------------------------------------------

/// Called once, with the reason, when a server's stdout closes for good.
pub(crate) type ExitHook = Box<dyn FnOnce(String) + Send + 'static>;

/// Spawn a new MCP transport: creates a newline-framed `JsonRpcTransport` for
/// stdin and starts the reader loop on stdout. Returns the transport handle.
///
/// `output` receives the non-protocol lines the server prints on stdout (it
/// is normally the same tail its stderr goes to). `on_exit` runs when the
/// reader loop ends, after every in-flight request has been failed.
pub(crate) fn spawn_mcp_transport(
    stdin: ChildStdin,
    stdout: ChildStdout,
    child_pid: Option<u32>,
    server_id: String,
    output: Option<StderrTail>,
    on_exit: Option<ExitHook>,
) -> JsonRpcTransport {
    let transport = JsonRpcTransport::with_framing(stdin, Framing::NewlineDelimited);
    let reader_pending = transport.pending.clone();
    let reader_closed = transport.closed_flag();

    // Replies to the server's own requests (`ping`, …) are written by a
    // separate task that holds only a WEAK reference to the writer: a strong
    // one would keep the child's stdin open for as long as it lives.
    let (reply_tx, mut reply_rx) = mpsc::unbounded_channel::<String>();
    let weak_writer = Arc::downgrade(&transport.writer);
    tokio::spawn(async move {
        while let Some(json) = reply_rx.recv().await {
            let Some(writer) = weak_writer.upgrade() else {
                break;
            };
            let mut writer = writer.lock().await;
            if json_rpc::write_line_message(&mut *writer, &json).await.is_err() {
                break;
            }
        }
    });

    tokio::spawn(async move {
        let reason = mcp_reader_loop(
            stdout,
            reader_pending,
            reader_closed,
            child_pid,
            &server_id,
            reply_tx,
            output,
        )
        .await;
        if let Some(on_exit) = on_exit {
            on_exit(reason);
        }
    });

    transport
}

// ---------------------------------------------------------------------------
// Reader loop
// ---------------------------------------------------------------------------

const MCP_READER_TIMEOUT: Duration = Duration::from_secs(30);

/// How long `initialize` may take. A binary that never speaks MCP (it waits on
/// stdin, or prints a prompt) must not leave the start command, and the
/// "starting" status, hanging forever — but the first run of an `npx -y …` /
/// `uvx …` server downloads its package before it can answer, and 30 s was
/// routinely too short for that.
pub(crate) const MCP_INIT_TIMEOUT: Duration = Duration::from_secs(120);

/// How long `tools/list` may take.
pub(crate) const MCP_LIST_TOOLS_TIMEOUT: Duration = Duration::from_secs(30);

/// Default limit for one `tools/call`. Generous, because real tools (a build,
/// a crawl, a long query) legitimately run for minutes; the point is that one
/// hung tool cannot stall the AI tool loop indefinitely. Callers override it
/// per call, see [`resolve_tool_call_timeout`].
pub(crate) const MCP_TOOL_CALL_DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);

/// Ceiling for a caller-supplied `tools/call` limit.
pub(crate) const MCP_TOOL_CALL_MAX_TIMEOUT: Duration = Duration::from_secs(3600);

/// The limit for one `tools/call`: the caller's `timeout_ms` clamped to
/// 1 s ..= [`MCP_TOOL_CALL_MAX_TIMEOUT`], or the default when none is given.
pub(crate) fn resolve_tool_call_timeout(timeout_ms: Option<u64>) -> Duration {
    match timeout_ms {
        Some(ms) => Duration::from_millis(ms)
            .clamp(Duration::from_secs(1), MCP_TOOL_CALL_MAX_TIMEOUT),
        None => MCP_TOOL_CALL_DEFAULT_TIMEOUT,
    }
}

/// The reply a server-initiated REQUEST must get, serialized, or `None` when
/// `msg` is not a request (a response, or a notification, which has no id).
///
/// A server may ask the client things: `ping` to check it is alive,
/// `roots/list`, `sampling/createMessage`, `elicitation/create`. Leaving one
/// unanswered makes a well-behaved server wait until its own timeout — some
/// send `ping` right after `initialize` and treat silence as a dead client.
/// `ping` gets the empty result the spec asks for; everything else gets
/// "method not found", which is the truthful answer from a client that
/// declared no capabilities.
fn reply_to_server_request(msg: &JsonRpcMessage) -> Option<String> {
    let method = msg.method.as_deref()?;
    let id = msg.id.as_ref().filter(|id| !id.is_null())?;
    Some(match method {
        "ping" => json_rpc::response_json(id, serde_json::json!({})),
        other => json_rpc::error_response_json(
            id,
            json_rpc::METHOD_NOT_FOUND_ERROR_CODE,
            &format!("Method not found: {}", other),
        ),
    })
}

/// Pump a server's stdout into the pending-request table until it dies, and
/// return why it ended.
///
/// On the way out it fails every request still in flight and marks the
/// transport closed (`closed` is the transport's own flag). The transport in
/// `McpServerHandle` holds another `Arc` to `pending`, so without that the
/// waiters of a crashed server would never be woken.
///
/// Generic over the reader, and free of any Tauri type, so a test can drive
/// it with any stream: replies to the server's own requests leave through
/// `replies`, and lines that are not protocol messages go to `output`.
async fn mcp_reader_loop<R: tokio::io::AsyncRead + Unpin>(
    stdout: R,
    pending: PendingRequests,
    closed: Arc<AtomicBool>,
    child_pid: Option<u32>,
    server_id: &str,
    replies: mpsc::UnboundedSender<String>,
    output: Option<StderrTail>,
) -> String {
    let mut reader = BufReader::new(stdout);

    loop {
        let next = json_rpc::read_next_line_message(
            &mut reader,
            MCP_READER_TIMEOUT,
            child_pid,
            |line| {
                // A server that logs to stdout, or a wrapper script's banner.
                // Not fatal, but worth showing if the server then fails.
                log::debug!(target: "notesage::mcp", "[{}] non-protocol stdout line: {}", server_id, line);
                if let Some(output) = &output {
                    output.push(format!("[stdout] {}", line));
                }
            },
        )
        .await;
        match next {
            ReadMessageResult::Message(msg) => {
                if let Some(reply) = reply_to_server_request(&msg) {
                    log::debug!(
                        target: "notesage::mcp",
                        "[{}] answering server request '{}'",
                        server_id,
                        msg.method.as_deref().unwrap_or("")
                    );
                    let _ = replies.send(reply);
                } else if let Some(method) = msg.method.as_deref() {
                    // A notification (progress, log message, list_changed).
                    // Nothing acts on these yet.
                    log::debug!(target: "notesage::mcp", "[{}] notification '{}'", server_id, method);
                } else {
                    json_rpc::dispatch_response(&pending, &msg).await;
                }
            }
            ReadMessageResult::Timeout => {
                // An idle server sends nothing; this is only a liveness tick.
                log::debug!(target: "notesage::mcp", "Reader idle for server {}", server_id);
                continue;
            }
            ReadMessageResult::Fatal(e) => {
                log::info!(target: "notesage::mcp", "MCP server {} stdout closed: {}", server_id, e);
                let reason = format!("Server process exited: {}", e);
                let failed = json_rpc::close_pending(&pending, &closed, &reason).await;
                if failed > 0 {
                    log::warn!(target: "notesage::mcp", "Failed {} in-flight request(s) of server {}", failed, server_id);
                }
                return reason;
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
/// header handed back on `initialize` is persisted and echoed on later
/// requests, as is the negotiated `MCP-Protocol-Version`.
///
/// Scope: request/response only — the optional long-lived GET stream for
/// server→client messages is not opened, and the older HTTP+SSE transport
/// (a GET stream that announces a separate POST endpoint) is not supported;
/// such a server is recognised and reported as such. Cloneable handles share
/// the underlying `reqwest::Client` and session cells.
#[derive(Clone)]
pub struct HttpMcpClient {
    client: reqwest::Client,
    url: String,
    /// Server id used to resolve an OAuth bearer token from the keychain.
    server_id: String,
    session_id: Arc<Mutex<Option<String>>>,
    /// Static headers from the server's config (API keys and the like),
    /// already resolved from the keychain. Values are marked sensitive and
    /// are never logged.
    static_headers: Arc<HeaderMap>,
    /// The protocol version agreed in `initialize`, sent as
    /// `MCP-Protocol-Version` on every later request.
    protocol_version: Arc<std::sync::Mutex<Option<String>>>,
}

/// Hard cap on an HTTP MCP response body. Remote MCP servers are third-party
/// endpoints; an unbounded `resp.text()` would let a hostile/buggy server
/// exhaust memory (audit batch 3 fix #7 — mirrors link_preview's
/// MAX_PREVIEW_BODY_BYTES pattern). Tool results are JSON/SSE text; 8 MiB is
/// generous.
const MAX_MCP_HTTP_BODY_BYTES: usize = 8 * 1024 * 1024;

/// How long connecting, and sending a notification, may take. Requests carry
/// their own limit (see [`McpConn::send_request`]); the client itself has no
/// overall timeout, because that would cap a long `tools/call` at this value
/// whatever limit the caller asked for.
const MCP_HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// How long the "is this a legacy SSE endpoint?" probe may take.
const MCP_HTTP_PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// Headers this client sets itself; a configured header of the same name is
/// ignored rather than allowed to break the protocol.
const RESERVED_HEADERS: &[&str] = &[
    "content-type",
    "content-length",
    "accept",
    "host",
    "mcp-session-id",
    "mcp-protocol-version",
];

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

/// Turn configured header pairs into a `HeaderMap`, or say which NAME is
/// unusable. A value never appears in the error.
fn build_static_headers(headers: &HashMap<String, String>) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        let trimmed = name.trim();
        let header_name = HeaderName::from_bytes(trimmed.as_bytes())
            .map_err(|_| format!("'{}' is not a valid HTTP header name", trimmed))?;
        if RESERVED_HEADERS.contains(&header_name.as_str()) {
            log::warn!(target: "notesage::mcp", "Ignoring configured header '{}': it is set by the MCP client", trimmed);
            continue;
        }
        let mut header_value = HeaderValue::from_str(value.trim()).map_err(|_| {
            format!(
                "The value of header '{}' contains characters that are not allowed in an HTTP header",
                trimmed
            )
        })?;
        header_value.set_sensitive(true);
        map.insert(header_name, header_value);
    }
    Ok(map)
}

/// What to tell the user when the server answers a request with a non-2xx
/// status. `legacy_sse` is the result of probing the URL for the old HTTP+SSE
/// transport after `initialize` was refused.
fn describe_http_failure(status: u16, reason: &str, legacy_sse: bool) -> String {
    let line = if reason.is_empty() {
        format!("Server returned HTTP {}", status)
    } else {
        format!("Server returned HTTP {} {}", status, reason)
    };
    if legacy_sse {
        return format!(
            "{}. This server uses the legacy SSE transport, which is not supported. Use its Streamable HTTP endpoint instead (the URL usually ends in /mcp rather than /sse).",
            line
        );
    }
    match status {
        401 => format!(
            "{}. The server requires credentials: use Authorize to sign in, or add an API key header (for example Authorization) to this server's settings.",
            line
        ),
        403 => format!(
            "{}. The server refused these credentials: authorize again, or check the API key header in this server's settings.",
            line
        ),
        404 | 405 => format!(
            "{}. Check the URL: it must be the server's MCP endpoint (usually ending in /mcp). Servers that only offer the legacy SSE transport (/sse) are not supported.",
            line
        ),
        _ => line,
    }
}

impl HttpMcpClient {
    /// A client that sends `headers` (name → resolved value) with every
    /// request. Fails on a header name or value HTTP cannot carry.
    pub(crate) fn with_headers(
        url: String,
        server_id: String,
        headers: &HashMap<String, String>,
    ) -> Result<Self, String> {
        Ok(Self::build(url, server_id, build_static_headers(headers)?))
    }

    fn build(url: String, server_id: String, static_headers: HeaderMap) -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(MCP_HTTP_CONNECT_TIMEOUT)
            .build()
            .unwrap_or_default();
        Self {
            client,
            url,
            server_id,
            session_id: Arc::new(Mutex::new(None)),
            static_headers: Arc::new(static_headers),
            protocol_version: Arc::new(std::sync::Mutex::new(None)),
        }
    }

    /// Record the protocol version the server agreed to; it is sent as
    /// `MCP-Protocol-Version` from the next request on.
    fn set_protocol_version(&self, version: &str) {
        if let Ok(mut cell) = self.protocol_version.lock() {
            *cell = Some(version.to_string());
        }
    }

    /// The headers of one request: the configured ones, then the protocol's
    /// own on top (so a configured `Accept` cannot break the exchange), then
    /// an OAuth bearer unless the config supplies its own `Authorization`.
    async fn request_headers(&self) -> HeaderMap {
        let mut headers: HeaderMap = (*self.static_headers).clone();
        headers.insert("content-type", HeaderValue::from_static("application/json"));
        headers.insert(
            "accept",
            HeaderValue::from_static("application/json, text/event-stream"),
        );
        if let Some(sid) = self.session_id.lock().await.clone() {
            if let Ok(value) = HeaderValue::from_str(&sid) {
                headers.insert("mcp-session-id", value);
            }
        }
        let version = self.protocol_version.lock().ok().and_then(|v| v.clone());
        if let Some(value) = version.and_then(|v| HeaderValue::from_str(&v).ok()) {
            headers.insert("mcp-protocol-version", value);
        }
        if !headers.contains_key("authorization") {
            // Attach an OAuth bearer token if this server has been authorized.
            if let Some(token) =
                crate::commands::mcp_oauth::valid_access_token(&self.server_id).await
            {
                if let Ok(mut value) = HeaderValue::from_str(&format!("Bearer {}", token)) {
                    value.set_sensitive(true);
                    headers.insert("authorization", value);
                }
            }
        }
        headers
    }

    async fn post(&self, body: String) -> Result<reqwest::Response, String> {
        self.client
            .post(self.url.as_str())
            .headers(self.request_headers().await)
            .body(body)
            .send()
            .await
            .map_err(|e| format!("HTTP request to {} failed: {}", self.url, e))
    }

    /// True if the URL answers a plain GET with an event stream: the old
    /// HTTP+SSE transport, where the client is expected to open that stream
    /// and POST somewhere else. Only asked after `initialize` was refused.
    async fn looks_like_legacy_sse(&self) -> bool {
        let mut headers: HeaderMap = (*self.static_headers).clone();
        headers.insert("accept", HeaderValue::from_static("text/event-stream"));
        let probe = self.client.get(self.url.as_str()).headers(headers).send();
        match tokio::time::timeout(MCP_HTTP_PROBE_TIMEOUT, probe).await {
            // Only the status and headers are read; the stream is dropped.
            Ok(Ok(resp)) => {
                resp.status().is_success()
                    && resp
                        .headers()
                        .get("content-type")
                        .and_then(|v| v.to_str().ok())
                        .is_some_and(|ct| ct.starts_with("text/event-stream"))
            }
            _ => false,
        }
    }

    async fn failure(&self, resp: &reqwest::Response, method: &str) -> String {
        let status = resp.status();
        let refused_outright = matches!(status.as_u16(), 400 | 404 | 405);
        let legacy_sse =
            method == "initialize" && refused_outright && self.looks_like_legacy_sse().await;
        describe_http_failure(
            status.as_u16(),
            status.canonical_reason().unwrap_or(""),
            legacy_sse,
        )
    }

    async fn send_request(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = json_rpc::next_request_id();
        let req = json_rpc::JsonRpcRequest::new(id, method, params);
        let body = serde_json::to_string(&req).map_err(|e| e.to_string())?;

        let resp = self.post(body).await?;
        if !resp.status().is_success() {
            return Err(self.failure(&resp, method).await);
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
        if content_type.contains("text/event-stream") {
            return read_sse_response(resp, MAX_MCP_HTTP_BODY_BYTES, id).await;
        }
        let text = read_body_capped(resp, MAX_MCP_HTTP_BODY_BYTES).await?;

        parse_jsonrpc_http_response(&content_type, &text, id)
    }

    async fn send_notification(&self, method: &str, params: Option<Value>) -> Result<(), String> {
        let req = json_rpc::JsonRpcNotification::new(method, params);
        let body = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        let resp = tokio::time::timeout(MCP_HTTP_CONNECT_TIMEOUT, self.post(body))
            .await
            .map_err(|_| format!("Notification '{}' timed out", method))??;
        // Servers acknowledge notifications with 202 Accepted (any 2xx is fine).
        if !resp.status().is_success() {
            return Err(self.failure(&resp, method).await);
        }
        Ok(())
    }
}

/// The response to request `expected_id` among SSE events, if it is there
/// yet. A message with a `method` is the server's own request or
/// notification travelling on the same stream, never our response.
fn sse_response_for(events: &[Value], expected_id: u64) -> Option<Result<Value, String>> {
    let msg = events.iter().find(|msg| {
        msg.get("method").is_none() && msg.get("id").and_then(|v| v.as_u64()) == Some(expected_id)
    })?;
    Some(match msg.get("error") {
        Some(err) => Err(format!("Server error: {}", err)),
        None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
    })
}

/// Read an SSE response until the reply to `expected_id` has arrived.
///
/// The stream is NOT read to its end first: a server may keep it open after
/// the response (the spec only says it SHOULD close it), and waiting for the
/// close turned every such reply into a timeout. If the stream ends without
/// the reply, whatever arrived is parsed leniently, as before.
async fn read_sse_response(
    mut resp: reqwest::Response,
    cap: usize,
    expected_id: u64,
) -> Result<Value, String> {
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
        // Only whole lines: a `data:` line still arriving is not parsed.
        if let Some(last_newline) = body.iter().rposition(|b| *b == b'\n') {
            let so_far = String::from_utf8_lossy(&body[..=last_newline]);
            if let Some(outcome) = sse_response_for(&parse_sse_data_events(&so_far), expected_id) {
                return outcome;
            }
        }
    }
    parse_jsonrpc_http_response(
        "text/event-stream",
        &String::from_utf8_lossy(&body),
        expected_id,
    )
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
/// messages over a stdio `AsyncBufRead` stream; this parses a fully-buffered
/// HTTP body that is either a single JSON object or an SSE `text/event-stream`.
/// Different transport, different framing; the only genuinely shared layer
/// (message *types* + request-id generation) is already reused from `json_rpc`
/// above.
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
    /// Send a request and wait at most `limit` for the reply. Every MCP
    /// request is bounded: a server that stops answering must not hang its
    /// caller.
    async fn send_request(
        &self,
        method: &str,
        params: Option<Value>,
        limit: Duration,
    ) -> Result<Value, String> {
        match self {
            McpConn::Stdio(t) => t.send_request_with_timeout(method, params, Some(limit)).await,
            McpConn::Http(c) => tokio::time::timeout(limit, c.send_request(method, params))
                .await
                .unwrap_or_else(|_| {
                    Err(format!(
                        "Request '{}' timed out after {}s",
                        method,
                        limit.as_secs_f32()
                    ))
                }),
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

    /// True once a stdio server's process is gone. An HTTP connection has no
    /// lasting state to lose and never reports closed.
    pub(crate) fn is_closed(&self) -> bool {
        match self {
            McpConn::Stdio(t) => t.is_closed(),
            McpConn::Http(_) => false,
        }
    }

    /// Tell the transport which protocol version was agreed. Only HTTP needs
    /// it (as a header on every later request).
    fn set_protocol_version(&self, version: &str) {
        if let McpConn::Http(c) = self {
            c.set_protocol_version(version);
        }
    }
}

// ---------------------------------------------------------------------------
// MCP Protocol Operations
// ---------------------------------------------------------------------------

/// Protocol revisions this client can talk to. All of them are the same for
/// what it uses (`initialize`, `tools/list`, `tools/call`).
const KNOWN_PROTOCOL_VERSIONS: &[&str] = &["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];

/// The protocol version in an `initialize` result, and whether this client
/// knows it. `None` when the server did not say (a non-conforming server; the
/// version we asked for is then assumed).
fn negotiated_protocol_version(init_result: &Value) -> Option<(&str, bool)> {
    let version = init_result.get("protocolVersion")?.as_str()?;
    Some((version, KNOWN_PROTOCOL_VERSIONS.contains(&version)))
}

/// Run the `initialize` handshake. `label` names the server in the log.
pub(crate) async fn mcp_initialize(transport: &McpConn, label: &str) -> Result<Value, String> {
    let init_params = serde_json::json!({
        "protocolVersion": constants::MCP_PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": {
            "name": "notesage",
            "version": "1.0.0"
        }
    });

    let result = transport
        .send_request("initialize", Some(init_params), MCP_INIT_TIMEOUT)
        .await?;

    // The server answers with the version it will speak: ours if it supports
    // it, otherwise its own. Everything this client uses is the same across
    // the known revisions, so a different one is logged, not refused.
    match negotiated_protocol_version(&result) {
        Some((version, known)) => {
            if known {
                log::info!(target: "notesage::mcp", "MCP server '{}' speaks protocol {} (asked for {})", label, version, constants::MCP_PROTOCOL_VERSION);
            } else {
                log::warn!(target: "notesage::mcp", "MCP server '{}' answered with unknown protocol version {} (asked for {}); continuing", label, version, constants::MCP_PROTOCOL_VERSION);
            }
            transport.set_protocol_version(version);
        }
        None => {
            log::warn!(target: "notesage::mcp", "MCP server '{}' did not state a protocol version; assuming {}", label, constants::MCP_PROTOCOL_VERSION);
            transport.set_protocol_version(constants::MCP_PROTOCOL_VERSION);
        }
    }

    // Send initialized notification
    transport
        .send_notification("notifications/initialized", None)
        .await?;

    Ok(result)
}

/// Upper bound on `tools/list` pages followed, so a server that hands out
/// cursors forever cannot keep a start running forever.
const MCP_LIST_TOOLS_MAX_PAGES: usize = 200;

/// The tools of one `tools/list` result page.
fn parse_tools_page(result: &Value, server_id: &str) -> Vec<McpToolInfo> {
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
    tools
}

/// The cursor for the page after `result`, if the server says there is one.
fn next_cursor(result: &Value) -> Option<String> {
    result
        .get("nextCursor")
        .and_then(|v| v.as_str())
        .filter(|c| !c.is_empty())
        .map(str::to_string)
}

/// List every tool of a server, following `nextCursor` across pages.
pub(crate) async fn mcp_list_tools_from_server(
    transport: &McpConn,
    server_id: &str,
) -> Result<Vec<McpToolInfo>, String> {
    let mut tools = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen_cursors: HashSet<String> = HashSet::new();

    for _ in 0..MCP_LIST_TOOLS_MAX_PAGES {
        let params = match &cursor {
            Some(cursor) => serde_json::json!({ "cursor": cursor }),
            None => serde_json::json!({}),
        };
        let result = transport
            .send_request("tools/list", Some(params), MCP_LIST_TOOLS_TIMEOUT)
            .await?;
        tools.extend(parse_tools_page(&result, server_id));

        match next_cursor(&result) {
            // A cursor seen before would loop for ever.
            Some(next) if seen_cursors.insert(next.clone()) => cursor = Some(next),
            _ => return Ok(tools),
        }
    }
    log::warn!(target: "notesage::mcp", "Server {} still had more tool pages after {}; using the {} tools read so far", server_id, MCP_LIST_TOOLS_MAX_PAGES, tools.len());
    Ok(tools)
}

/// True if a `tools/list` failure only means "this server has no tools"
/// (JSON-RPC method not found) rather than something being wrong.
pub(crate) fn tools_list_unsupported(error: &str) -> bool {
    error.contains("-32601")
}

/// `initialize`, then `tools/list`: what both starting and validating a
/// server do. A server without the tools feature yields an empty list; any
/// other `tools/list` failure is an error — it used to be swallowed, leaving
/// a server "running" with no tools and no reason.
pub(crate) async fn mcp_handshake(
    conn: &McpConn,
    server_id: &str,
    label: &str,
) -> Result<(Value, Vec<McpToolInfo>), String> {
    let caps = mcp_initialize(conn, label).await?;
    match mcp_list_tools_from_server(conn, server_id).await {
        Ok(tools) => Ok((caps, tools)),
        Err(e) if tools_list_unsupported(&e) => {
            log::info!(target: "notesage::mcp", "MCP server '{}' does not offer tools", label);
            Ok((caps, Vec::new()))
        }
        Err(e) => Err(format!("The server connected, but listing its tools failed: {}", e)),
    }
}

pub(crate) async fn mcp_call_tool_on_server(
    transport: &McpConn,
    tool_name: &str,
    arguments: Value,
    limit: Duration,
) -> Result<McpToolResult, String> {
    let params = serde_json::json!({
        "name": tool_name,
        "arguments": arguments,
    });

    let result = transport
        .send_request("tools/call", Some(params), limit)
        .await?;

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

    let structured_content = result.get("structuredContent").filter(|v| !v.is_null()).cloned();

    Ok(McpToolResult { content, is_error, structured_content })
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
        // ... in a form the "server has no tools" check recognises.
        assert!(tools_list_unsupported(&err));
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

    #[test]
    fn tool_call_timeout_defaults_and_clamps() {
        assert_eq!(resolve_tool_call_timeout(None), MCP_TOOL_CALL_DEFAULT_TIMEOUT);
        assert_eq!(resolve_tool_call_timeout(Some(45_000)), Duration::from_secs(45));
        // Zero would fail every call before the server could answer.
        assert_eq!(resolve_tool_call_timeout(Some(0)), Duration::from_secs(1));
        assert_eq!(resolve_tool_call_timeout(Some(u64::MAX)), MCP_TOOL_CALL_MAX_TIMEOUT);
    }

    #[test]
    fn initialize_budget_covers_a_cold_package_download() {
        // `npx -y …` / `uvx …` download on first run; 30 s was not enough.
        assert_eq!(MCP_INIT_TIMEOUT, Duration::from_secs(120));
    }

    fn message(json: &str) -> JsonRpcMessage {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn server_requests_are_answered_and_nothing_else_is() {
        // ping → the empty result the spec asks for, id echoed as received.
        let reply = reply_to_server_request(&message(r#"{"jsonrpc":"2.0","id":"srv-1","method":"ping"}"#)).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&reply).unwrap(),
            serde_json::json!({"jsonrpc":"2.0","id":"srv-1","result":{}})
        );
        // Anything else → method not found, so the server does not wait.
        for method in ["roots/list", "sampling/createMessage", "elicitation/create", "made/up"] {
            let request = format!(r#"{{"jsonrpc":"2.0","id":17,"method":"{}","params":{{}}}}"#, method);
            let reply: Value = serde_json::from_str(&reply_to_server_request(&message(&request)).unwrap()).unwrap();
            assert_eq!(reply["id"], 17, "{method}");
            assert_eq!(reply["error"]["code"], -32601, "{method}");
            assert!(reply["error"]["message"].as_str().unwrap().contains(method));
            assert!(reply.get("result").is_none());
        }
        // A notification has no id; a response has no method. Neither is answered.
        for not_a_request in [
            r#"{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}"#,
            r#"{"jsonrpc":"2.0","method":"ping","id":null}"#,
            r#"{"jsonrpc":"2.0","id":3,"result":{}}"#,
            r#"{"jsonrpc":"2.0","id":3,"error":{"code":-1,"message":"x"}}"#,
        ] {
            assert!(reply_to_server_request(&message(not_a_request)).is_none(), "{not_a_request}");
        }
    }

    #[test]
    fn negotiated_version_is_read_from_the_initialize_result() {
        let cases: &[(Value, Option<(&str, bool)>)] = &[
            (serde_json::json!({"protocolVersion": "2024-11-05"}), Some(("2024-11-05", true))),
            (serde_json::json!({"protocolVersion": "2025-06-18", "capabilities": {}}), Some(("2025-06-18", true))),
            (serde_json::json!({"protocolVersion": "2025-11-25"}), Some(("2025-11-25", true))),
            (serde_json::json!({"protocolVersion": "2031-01-01"}), Some(("2031-01-01", false))),
            (serde_json::json!({"capabilities": {}}), None),
            (serde_json::json!({"protocolVersion": 3}), None),
        ];
        for (result, expected) in cases {
            assert_eq!(negotiated_protocol_version(result), *expected, "{result}");
        }
        assert!(KNOWN_PROTOCOL_VERSIONS.contains(&constants::MCP_PROTOCOL_VERSION));
    }

    #[test]
    fn tools_page_and_cursor_parsing() {
        let page = serde_json::json!({
            "tools": [
                {"name": "a", "description": "A", "inputSchema": {"type": "object"}},
                {"name": "", "description": "nameless tools are dropped"},
                {"name": "b"}
            ],
            "nextCursor": "c2"
        });
        let tools = parse_tools_page(&page, "global:srv");
        assert_eq!(tools.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
        assert_eq!(tools[0].server_id, "global:srv");
        assert_eq!(tools[1].input_schema, serde_json::json!({}));
        assert_eq!(next_cursor(&page).as_deref(), Some("c2"));
        assert_eq!(next_cursor(&serde_json::json!({"tools": []})), None);
        assert_eq!(next_cursor(&serde_json::json!({"nextCursor": ""})), None);
        assert_eq!(next_cursor(&serde_json::json!({"nextCursor": null})), None);
    }

    #[test]
    fn http_failures_point_at_what_to_do() {
        let unauthorized = describe_http_failure(401, "Unauthorized", false);
        assert!(unauthorized.starts_with("Server returned HTTP 401 Unauthorized"));
        assert!(unauthorized.contains("Authorize"), "{unauthorized}");
        assert!(unauthorized.contains("header"), "{unauthorized}");

        assert!(describe_http_failure(403, "Forbidden", false).contains("refused these credentials"));
        assert!(describe_http_failure(404, "Not Found", false).contains("Check the URL"));
        assert_eq!(describe_http_failure(500, "Internal Server Error", false), "Server returned HTTP 500 Internal Server Error");
        assert_eq!(describe_http_failure(599, "", false), "Server returned HTTP 599");

        let legacy = describe_http_failure(405, "Method Not Allowed", true);
        assert!(legacy.contains("legacy SSE transport, which is not supported"), "{legacy}");
    }

    #[test]
    fn static_headers_are_validated_by_name_and_never_echo_a_value() {
        let pairs = |list: &[(&str, &str)]| -> HashMap<String, String> {
            list.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
        };
        let ok = build_static_headers(&pairs(&[("X-Api-Key", "s3cret"), (" Authorization ", "Bearer abc ")])).unwrap();
        assert_eq!(ok.get("x-api-key").unwrap(), "s3cret");
        assert_eq!(ok.get("authorization").unwrap(), "Bearer abc");
        assert!(ok.get("x-api-key").unwrap().is_sensitive());

        // The protocol's own headers cannot be overridden from a config.
        let reserved = build_static_headers(&pairs(&[("Accept", "text/plain"), ("Mcp-Session-Id", "x"), ("X-Ok", "1")])).unwrap();
        assert_eq!(reserved.len(), 1);
        assert!(reserved.contains_key("x-ok"));

        let bad_name = build_static_headers(&pairs(&[("Bad Header", "s3cret")])).unwrap_err();
        assert!(bad_name.contains("Bad Header") && !bad_name.contains("s3cret"), "{bad_name}");
        let bad_value = build_static_headers(&pairs(&[("X-Api-Key", "s3cret\nInjected: 1")])).unwrap_err();
        assert!(bad_value.contains("X-Api-Key") && !bad_value.contains("s3cret"), "{bad_value}");
    }

    /// Run the reader loop over an in-memory stdout; returns its exit reason,
    /// the replies it sent to the server, and the output tail.
    async fn run_reader(stdout: &[u8], pending: PendingRequests) -> (String, Vec<String>, Option<String>, Arc<AtomicBool>) {
        let closed = Arc::new(AtomicBool::new(false));
        let (reply_tx, mut reply_rx) = mpsc::unbounded_channel();
        let tail = StderrTail::default();
        let reason = mcp_reader_loop(stdout, pending, closed.clone(), None, "srv", reply_tx, Some(tail.clone())).await;
        let mut replies = Vec::new();
        while let Ok(reply) = reply_rx.try_recv() {
            replies.push(reply);
        }
        (reason, replies, tail.snapshot(), closed)
    }

    #[tokio::test]
    async fn reader_exit_fails_requests_in_flight_and_closes_the_transport() {
        // A request is waiting when the server's stdout hits EOF (it crashed).
        // The map is shared with the transport in managed state, so unless the
        // loop drains it the waiter is never woken.
        let pending = json_rpc::new_pending_requests();
        let (tx, rx) = tokio::sync::oneshot::channel();
        pending.lock().await.insert(41, tx);

        let (reason, _, _, closed) = run_reader(b"", pending.clone()).await;

        assert!(reason.contains("Server process exited"), "{reason}");
        let reply = tokio::time::timeout(Duration::from_secs(5), rx)
            .await
            .expect("the waiter is woken when the reader exits")
            .expect("with an error, not a dropped channel");
        assert!(reply.unwrap_err().message.contains("Server process exited"));
        assert!(pending.lock().await.is_empty());
        assert!(closed.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[tokio::test]
    async fn reader_dispatches_line_framed_responses_and_keeps_stdout_noise() {
        // The B1 regression at the reader: a `{...}\n` response used to be
        // read as an unknown header, so the request never completed.
        let pending = json_rpc::new_pending_requests();
        let (tx, rx) = tokio::sync::oneshot::channel();
        pending.lock().await.insert(7, tx);

        let stdout = b"Starting server...\n\n{\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"ok\":true}}\n";
        let (_, replies, tail, _) = run_reader(stdout, pending.clone()).await;

        let value = rx.await.expect("dispatched").expect("a result");
        assert_eq!(value["ok"], true);
        assert!(replies.is_empty());
        assert_eq!(tail.as_deref(), Some("[stdout] Starting server..."));
    }

    #[tokio::test]
    async fn reader_answers_ping_and_refuses_other_server_requests() {
        let stdout = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n{\"jsonrpc\":\"2.0\",\"id\":\"r\",\"method\":\"roots/list\"}\n{\"jsonrpc\":\"2.0\",\"method\":\"notifications/message\",\"params\":{}}\n";
        let (_, replies, _, _) = run_reader(stdout, json_rpc::new_pending_requests()).await;
        assert_eq!(replies.len(), 2, "{replies:?}");
        let ping: Value = serde_json::from_str(&replies[0]).unwrap();
        assert_eq!(ping, serde_json::json!({"jsonrpc":"2.0","id":1,"result":{}}));
        let roots: Value = serde_json::from_str(&replies[1]).unwrap();
        assert_eq!(roots["id"], "r");
        assert_eq!(roots["error"]["code"], -32601);
    }
}

#[cfg(test)]
mod http_harness {
    //! The HTTP client against a local mock server: real sockets, real
    //! `reqwest`, so header handling and status mapping are exercised end to
    //! end rather than through their pure helpers only.

    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// One request as the mock saw it. Header names are lowercased.
    #[derive(Clone, Debug)]
    struct Seen {
        method: String,
        headers: HashMap<String, String>,
        body: String,
    }

    type Response = (u16, Vec<(&'static str, String)>, String);

    /// Serve `respond` on a loopback port, one request per connection.
    /// Returns the URL and the log of requests seen.
    async fn serve(
        respond: impl Fn(&Seen) -> Response + Send + Sync + 'static,
    ) -> (String, Arc<std::sync::Mutex<Vec<Seen>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let log = Arc::new(std::sync::Mutex::new(Vec::new()));
        let task_log = log.clone();
        let respond = Arc::new(respond);
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let log = task_log.clone();
                let respond = respond.clone();
                tokio::spawn(async move {
                    let mut raw = Vec::new();
                    let mut chunk = [0u8; 4096];
                    let (head_end, content_length) = loop {
                        let n = socket.read(&mut chunk).await.unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        raw.extend_from_slice(&chunk[..n]);
                        if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                            let head = String::from_utf8_lossy(&raw[..pos]).to_lowercase();
                            let length = head
                                .lines()
                                .find_map(|l| l.strip_prefix("content-length:"))
                                .and_then(|v| v.trim().parse::<usize>().ok())
                                .unwrap_or(0);
                            break (pos + 4, length);
                        }
                    };
                    while raw.len() < head_end + content_length {
                        let n = socket.read(&mut chunk).await.unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        raw.extend_from_slice(&chunk[..n]);
                    }
                    let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
                    let mut lines = head.lines();
                    let method = lines.next().unwrap_or("").split(' ').next().unwrap_or("").to_string();
                    let headers = lines
                        .filter_map(|l| l.split_once(':'))
                        .map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_string()))
                        .collect();
                    let seen = Seen {
                        method,
                        headers,
                        body: String::from_utf8_lossy(&raw[head_end..]).to_string(),
                    };
                    let (status, extra, body) = respond(&seen);
                    log.lock().unwrap().push(seen);
                    // `x-test-hold-open`: send the body and then keep the
                    // connection open, like a server that leaves its event
                    // stream running after the response.
                    let hold_open = extra.iter().any(|(name, _)| *name == "x-test-hold-open");
                    let mut out = format!("HTTP/1.1 {} X\r\nconnection: close\r\n", status);
                    if !hold_open {
                        out.push_str(&format!("content-length: {}\r\n", body.len()));
                    }
                    for (name, value) in extra {
                        out.push_str(&format!("{}: {}\r\n", name, value));
                    }
                    out.push_str("\r\n");
                    out.push_str(&body);
                    let _ = socket.write_all(out.as_bytes()).await;
                    let _ = socket.flush().await;
                    if hold_open {
                        tokio::time::sleep(Duration::from_secs(120)).await;
                    }
                    let _ = socket.shutdown().await;
                });
            }
        });
        (url, log)
    }

    /// A minimal Streamable HTTP MCP server: JSON responses, a session id,
    /// two pages of tools.
    fn streamable(seen: &Seen) -> Response {
        let request: Value = serde_json::from_str(&seen.body).unwrap_or(Value::Null);
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let json = |result: Value| {
            (
                200,
                vec![("content-type", "application/json".to_string()), ("mcp-session-id", "sess-1".to_string())],
                serde_json::json!({"jsonrpc": "2.0", "id": id, "result": result}).to_string(),
            )
        };
        match request.get("method").and_then(|m| m.as_str()) {
            Some("initialize") => json(serde_json::json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "http-mock", "version": "1"}
            })),
            Some("notifications/initialized") => (202, vec![], String::new()),
            Some("tools/list") => match request["params"].get("cursor").and_then(|c| c.as_str()) {
                None => json(serde_json::json!({"tools": [{"name": "one"}], "nextCursor": "p2"})),
                Some(_) => json(serde_json::json!({"tools": [{"name": "two"}]})),
            },
            Some("tools/call") => {
                // SSE, to cover the other response type.
                let event = serde_json::json!({"jsonrpc": "2.0", "id": id, "result": {"content": [{"type": "text", "text": "hi"}]}});
                (200, vec![("content-type", "text/event-stream".to_string())], format!("event: message\ndata: {}\n\n", event))
            }
            _ => (400, vec![], String::new()),
        }
    }

    fn headers(list: &[(&str, &str)]) -> HashMap<String, String> {
        list.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[tokio::test]
    async fn sends_configured_headers_and_the_negotiated_protocol_version() {
        let (url, log) = serve(streamable).await;
        // A configured Authorization also keeps the keychain out of the test.
        let client = HttpMcpClient::with_headers(
            url,
            "test:http".to_string(),
            &headers(&[("Authorization", "Bearer static-key"), ("X-Tenant", "acme")]),
        )
        .unwrap();
        let conn = McpConn::Http(client);

        let (caps, tools) = mcp_handshake(&conn, "test:http", "http-mock").await.expect("handshake");
        assert_eq!(caps["serverInfo"]["name"], "http-mock");
        // Pagination over HTTP as well.
        assert_eq!(tools.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["one", "two"]);
        let result = mcp_call_tool_on_server(&conn, "one", serde_json::json!({}), Duration::from_secs(10))
            .await
            .expect("tools/call over SSE");
        assert_eq!(result.content[0].text.as_deref(), Some("hi"));

        let seen = log.lock().unwrap().clone();
        assert!(seen.len() >= 5, "initialize, initialized, 2x tools/list, tools/call: {}", seen.len());
        for request in &seen {
            assert_eq!(request.headers.get("authorization").map(String::as_str), Some("Bearer static-key"));
            assert_eq!(request.headers.get("x-tenant").map(String::as_str), Some("acme"));
            assert!(request.headers.get("accept").unwrap().contains("text/event-stream"));
        }
        // Not on `initialize` (nothing is agreed yet), on everything after.
        assert_eq!(seen[0].headers.get("mcp-protocol-version"), None);
        assert_eq!(seen[0].headers.get("mcp-session-id"), None);
        for request in &seen[1..] {
            // The SERVER's answer (2025-06-18), not the version we asked for.
            assert_eq!(request.headers.get("mcp-protocol-version").map(String::as_str), Some("2025-06-18"));
            assert_eq!(request.headers.get("mcp-session-id").map(String::as_str), Some("sess-1"));
        }
    }

    #[tokio::test]
    async fn an_sse_response_is_taken_as_soon_as_it_arrives() {
        // The server answers on an event stream and leaves it open, after
        // first sending a request of its own with the SAME numeric id.
        let (url, _) = serve(|seen| {
            let request: Value = serde_json::from_str(&seen.body).unwrap_or(Value::Null);
            let id = request.get("id").cloned().unwrap_or(Value::Null);
            let own = serde_json::json!({"jsonrpc": "2.0", "id": id, "method": "ping"});
            let reply = serde_json::json!({"jsonrpc": "2.0", "id": id, "result": {"tools": [{"name": "streamed"}]}});
            (
                200,
                vec![("content-type", "text/event-stream".to_string()), ("x-test-hold-open", "1".to_string())],
                format!("event: message\ndata: {}\n\nevent: message\ndata: {}\n\n", own, reply),
            )
        })
        .await;
        let client = HttpMcpClient::with_headers(url, "test:sse-open".to_string(), &headers(&[("Authorization", "Bearer k")])).unwrap();
        let conn = McpConn::Http(client);
        let tools = tokio::time::timeout(Duration::from_secs(15), mcp_list_tools_from_server(&conn, "test:sse-open"))
            .await
            .expect("the reply is returned without waiting for the stream to close")
            .expect("tools/list");
        assert_eq!(tools.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["streamed"]);
    }

    #[test]
    fn sse_response_lookup_ignores_the_servers_own_requests() {
        let events = vec![
            serde_json::json!({"jsonrpc": "2.0", "id": 5, "method": "ping"}),
            serde_json::json!({"jsonrpc": "2.0", "method": "notifications/progress"}),
            serde_json::json!({"jsonrpc": "2.0", "id": 6, "result": {"other": true}}),
        ];
        assert!(sse_response_for(&events, 5).is_none());
        assert_eq!(sse_response_for(&events, 6), Some(Ok(serde_json::json!({"other": true}))));
        let failed = vec![serde_json::json!({"jsonrpc": "2.0", "id": 7, "error": {"code": -32000, "message": "no"}})];
        assert!(sse_response_for(&failed, 7).unwrap().unwrap_err().contains("Server error"));
    }

    #[tokio::test]
    async fn a_401_says_to_authorize_or_add_a_header() {
        let (url, _) = serve(|_| (401, vec![("www-authenticate", "Bearer".to_string())], String::new())).await;
        let client = HttpMcpClient::with_headers(url, "test:401".to_string(), &headers(&[("Authorization", "Bearer wrong")])).unwrap();
        let err = mcp_initialize(&McpConn::Http(client), "locked").await.unwrap_err();
        assert!(err.contains("HTTP 401"), "{err}");
        assert!(err.contains("Authorize") && err.contains("header"), "{err}");
        assert!(!err.contains("wrong"), "a header value leaked: {err}");
    }

    #[tokio::test]
    async fn a_legacy_sse_endpoint_is_named_as_such() {
        // The old transport: POST is refused, GET opens an event stream that
        // announces where to POST.
        let (url, log) = serve(|seen| {
            if seen.method == "GET" {
                (200, vec![("content-type", "text/event-stream".to_string())], "event: endpoint\ndata: /messages?sessionId=1\n\n".to_string())
            } else {
                (405, vec![], String::new())
            }
        })
        .await;
        let client = HttpMcpClient::with_headers(url, "test:sse".to_string(), &headers(&[("Authorization", "Bearer k")])).unwrap();
        let err = mcp_initialize(&McpConn::Http(client), "old").await.unwrap_err();
        assert!(err.contains("legacy SSE transport, which is not supported"), "{err}");
        let methods: Vec<String> = log.lock().unwrap().iter().map(|s| s.method.clone()).collect();
        assert_eq!(methods, vec!["POST", "GET"]);
    }

    #[tokio::test]
    async fn a_plain_404_is_not_called_legacy_sse() {
        let (url, _) = serve(|_| (404, vec![], String::new())).await;
        let client = HttpMcpClient::with_headers(url, "test:404".to_string(), &headers(&[("Authorization", "Bearer k")])).unwrap();
        let err = mcp_initialize(&McpConn::Http(client), "gone").await.unwrap_err();
        assert!(err.contains("HTTP 404") && err.contains("Check the URL"), "{err}");
        assert!(!err.contains("which is not supported. Use its"), "{err}");
    }
}

#[cfg(test)]
mod stdio_harness {
    //! A real MCP server on stdio.
    //!
    //! The server is `tests/fixtures/mcp/mock-mcp-server.mjs`, which speaks
    //! newline-delimited JSON like every real MCP server and picks a behaviour
    //! from argv. It is driven two ways:
    //!
    //! - through the real client path ([`spawn_mcp_transport`] → [`McpConn`]
    //!   → `mcp_handshake` / `mcp_call_tool_on_server`), which is what the
    //!   app runs. This became possible when the reader loop stopped needing
    //!   a Tauri `AppHandle` (it reports its exit through a hook instead);
    //! - by hand, one line at a time, for the era-detection cases of #573/#576
    //!   (`server/discover`), which the client does not send yet.
    //!
    //! What is deliberately NOT done: making `JsonRpcTransport` generic over
    //! its writer. It holds a concrete `ChildStdin` and is shared with the
    //! Copilot LSP client, so a type parameter there would cascade into a
    //! subsystem that has nothing to do with MCP. Spawning a real process
    //! avoids that, and is the higher-fidelity test anyway — the framing, the
    //! chunk boundaries and the process lifetime are all genuine.
    //!
    //! In-module rather than under `tests/` because the crate's `commands`
    //! module is private, and widening it to `pub` for a test would be a
    //! bigger change than the test is worth.
    //!
    //! Node keeps the mock legible and easy to extend; the Rust CI job has a
    //! `setup-node` step for it.

    use std::process::Stdio;
    use std::time::Duration;

    use serde_json::{json, Value};
    use tokio::io::{AsyncWriteExt, BufReader};
    use tokio::process::{Child, ChildStdin, ChildStdout, Command};

    use super::super::stderr_drain::spawn_stderr_drain;
    use super::*;
    use crate::commands::json_rpc::read_next_line_message;

    fn mock_command(behaviour: &str) -> Command {
        let script = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/mcp/mock-mcp-server.mjs"
        );
        let mut command = Command::new("node");
        command
            .arg(script)
            .arg(behaviour)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true);
        command
    }

    fn spawn_mock(behaviour: &str) -> (Child, ChildStdin, ChildStdout) {
        let mut child = mock_command(behaviour)
            .stderr(Stdio::null())
            .spawn()
            .expect("node is required for the MCP harness — see the module comment");
        let stdin = child.stdin.take().expect("piped");
        let stdout = child.stdout.take().expect("piped");
        (child, stdin, stdout)
    }

    /// A mock connected the way `mcp_start_server` connects a real server.
    struct Connected {
        _child: Child,
        conn: McpConn,
        output: StderrTail,
        exited: tokio::sync::oneshot::Receiver<String>,
    }

    fn connect(behaviour: &str) -> Connected {
        let mut child = mock_command(behaviour)
            .stderr(Stdio::piped())
            .spawn()
            .expect("node is required for the MCP harness — see the module comment");
        let stdin = child.stdin.take().expect("piped");
        let stdout = child.stdout.take().expect("piped");
        let output = spawn_stderr_drain(child.stderr.take().expect("piped"), behaviour.to_string());
        let (exit_tx, exited) = tokio::sync::oneshot::channel();
        let transport = spawn_mcp_transport(
            stdin,
            stdout,
            child.id(),
            format!("test:{}", behaviour),
            Some(output.clone()),
            Some(Box::new(move |reason| {
                let _ = exit_tx.send(reason);
            })),
        );
        Connected { _child: child, conn: McpConn::Stdio(transport), output, exited }
    }

    const PATIENCE: Duration = Duration::from_secs(20);

    async fn within<T>(what: &str, future: impl std::future::Future<Output = T>) -> T {
        tokio::time::timeout(PATIENCE, future)
            .await
            .unwrap_or_else(|_| panic!("timed out: {what}"))
    }

    fn text_of(result: &McpToolResult) -> &str {
        result.content.first().and_then(|c| c.text.as_deref()).unwrap_or("")
    }

    #[tokio::test]
    async fn the_client_completes_a_whole_session_over_newline_framing() {
        // The B1 regression, end to end: initialize → initialized →
        // tools/list → tools/call against a server that reads lines.
        let server = connect("legacy");
        let (caps, tools) = within("handshake", mcp_handshake(&server.conn, "test:legacy", "mock"))
            .await
            .expect("a line-framed server answers");
        assert_eq!(caps["serverInfo"]["name"], "mock");
        // The mock agrees to the version the client asks for.
        assert_eq!(caps["protocolVersion"], constants::MCP_PROTOCOL_VERSION);
        assert_eq!(tools.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["echo"]);
        assert_eq!(tools[0].server_id, "test:legacy");

        let text = "line one\nline two — åäö ✓ \"quoted\"";
        let result = within(
            "tools/call",
            mcp_call_tool_on_server(&server.conn, "echo", json!({ "text": text }), PATIENCE),
        )
        .await
        .expect("tools/call");
        assert!(!result.is_error);
        // Newlines and non-ASCII survive the one-message-per-line framing.
        assert_eq!(text_of(&result), text);
    }

    #[tokio::test]
    async fn log_lines_on_stdout_do_not_break_the_session() {
        let server = connect("noisy");
        let (_, tools) = within("handshake", mcp_handshake(&server.conn, "test:noisy", "mock"))
            .await
            .expect("noise is skipped");
        assert_eq!(tools.len(), 1);
        let result = within(
            "tools/call",
            mcp_call_tool_on_server(&server.conn, "echo", json!({ "text": "still here" }), PATIENCE),
        )
        .await
        .expect("tools/call");
        assert_eq!(text_of(&result), "still here");
        // ... and they are kept, for the error message if the server fails.
        let output = server.output.snapshot().unwrap_or_default();
        assert!(output.contains("[stdout] Mock MCP server v0.0.0 listening on stdio"), "{output}");
        assert!(output.contains("[stdout] [mock] listing tools {not json}"), "{output}");
    }

    #[tokio::test]
    async fn tools_list_follows_next_cursor_to_the_last_page() {
        let server = connect("paginated");
        let (_, tools) = within("handshake", mcp_handshake(&server.conn, "test:paginated", "mock"))
            .await
            .expect("handshake");
        // Only the first page (two tools) used to be read.
        assert_eq!(
            tools.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
            vec!["tool_1", "tool_2", "tool_3", "tool_4", "tool_5"]
        );
    }

    #[tokio::test]
    async fn a_tools_list_error_fails_the_handshake_with_the_reason() {
        // It used to be swallowed: "Running", no tools, no reason.
        let server = connect("tools-error");
        let err = within("handshake", mcp_handshake(&server.conn, "test:tools-error", "mock"))
            .await
            .unwrap_err();
        assert!(err.contains("listing its tools failed"), "{err}");
        assert!(err.contains("tool registry unavailable"), "{err}");
    }

    #[tokio::test]
    async fn a_server_without_tools_is_not_an_error() {
        let server = connect("no-tools");
        let (_, tools) = within("handshake", mcp_handshake(&server.conn, "test:no-tools", "mock"))
            .await
            .expect("method-not-found on tools/list means no tools");
        assert!(tools.is_empty());
    }

    #[tokio::test]
    async fn server_initiated_requests_get_an_answer() {
        // After `initialized` the mock sends `ping` and `roots/list`, and its
        // `await_replies` tool only answers once both replies have arrived —
        // so an unanswered request shows up here as a timeout.
        let server = connect("pinger");
        within("handshake", mcp_handshake(&server.conn, "test:pinger", "mock"))
            .await
            .expect("handshake");
        let result = within(
            "the server waits for our replies",
            mcp_call_tool_on_server(&server.conn, "await_replies", json!({}), PATIENCE),
        )
        .await
        .expect("tools/call");
        let replies: Value = serde_json::from_str(text_of(&result)).expect("JSON");
        assert_eq!(replies["srv-ping"], json!({ "result": {} }));
        assert_eq!(replies["srv-roots"]["error"]["code"], -32601);
    }

    #[tokio::test]
    async fn an_exit_mid_session_fails_the_call_and_reports_through_the_hook() {
        let server = connect("exit-mid-session");
        within("handshake", mcp_handshake(&server.conn, "test:exit", "mock"))
            .await
            .expect("handshake");
        assert!(!server.conn.is_closed());

        let err = within(
            "the in-flight call is failed, not left hanging",
            mcp_call_tool_on_server(&server.conn, "echo", json!({ "text": "x" }), PATIENCE),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Server process exited"), "{err}");

        let reason = within("exit hook", server.exited).await.expect("the hook runs");
        assert!(reason.contains("Server process exited"), "{reason}");
        assert!(server.conn.is_closed());
        // What it said on the way out is available for the error message.
        let output = within("stderr", server.output.settled_snapshot(Duration::from_secs(5))).await;
        assert_eq!(output.as_deref(), Some("fatal: the mock was told to crash"));

        // Later requests fail at once instead of waiting for a timeout.
        let later = within("later request", mcp_list_tools_from_server(&server.conn, "test:exit")).await;
        assert!(later.is_err());
    }

    #[tokio::test]
    async fn a_server_that_dies_on_start_fails_initialize_with_its_stderr_at_hand() {
        let server = connect("exit-on-start");
        let err = within("initialize", mcp_initialize(&server.conn, "mock")).await.unwrap_err();
        assert!(
            err.contains("exited") || err.contains("Failed to write") || err.contains("closed"),
            "{err}"
        );
        let output = within("stderr", server.output.settled_snapshot(Duration::from_secs(5))).await;
        assert_eq!(output.as_deref(), Some("Error: MOCK_API_KEY is not set"));
    }

    // --- by hand, for the era-detection cases (#573) ---

    /// Write one request as a line, the way the client does.
    async fn write_frame(stdin: &mut ChildStdin, body: &Value) {
        let text = serde_json::to_string(body).unwrap();
        stdin.write_all(format!("{}\n", text).as_bytes()).await.unwrap();
        stdin.flush().await.unwrap();
    }

    /// Read one message back, or None if the server stays silent.
    async fn read_frame(
        stdout: &mut BufReader<ChildStdout>,
        within: Duration,
    ) -> Option<JsonRpcMessage> {
        match read_next_line_message(stdout, within, None, |_| {}).await {
            ReadMessageResult::Message(m) => Some(m),
            _ => None,
        }
    }

    /// The protocol version out of a successful result.
    fn protocol_version(message: &JsonRpcMessage) -> Option<&str> {
        message.result.as_ref()?.get("protocolVersion")?.as_str()
    }

    /// The JSON-RPC error code, which is what classifies an era.
    fn error_code(message: &JsonRpcMessage) -> Option<i64> {
        message.error.as_ref().map(|e| e.code)
    }

    #[tokio::test]
    async fn a_modern_server_answers_server_discover() {
        let (mut child, mut stdin, stdout) = spawn_mock("modern");
        let mut reader = BufReader::new(stdout);

        write_frame(&mut stdin, &json!({"jsonrpc":"2.0","id":1,"method":"server/discover"})).await;
        let reply = read_frame(&mut reader, Duration::from_secs(5))
            .await
            .expect("a modern server replies to server/discover");

        assert_eq!(protocol_version(&reply), Some("2026-07-28"));
        let _ = child.kill().await;
    }

    #[tokio::test]
    async fn a_legacy_server_rejects_discover_and_answers_initialize() {
        let (mut child, mut stdin, stdout) = spawn_mock("legacy");
        let mut reader = BufReader::new(stdout);

        write_frame(&mut stdin, &json!({"jsonrpc":"2.0","id":1,"method":"server/discover"})).await;
        let probe = read_frame(&mut reader, Duration::from_secs(5)).await.expect("a reply");
        // Method-not-found is the signal that classifies a server as legacy.
        assert_eq!(error_code(&probe), Some(-32601));

        write_frame(&mut stdin, &json!({"jsonrpc":"2.0","id":2,"method":"initialize"})).await;
        let init = read_frame(&mut reader, Duration::from_secs(5)).await.expect("a reply");
        assert_eq!(protocol_version(&init), Some("2025-06-18"));
        let _ = child.kill().await;
    }

    #[tokio::test]
    async fn a_modern_server_may_reject_our_version_before_agreeing() {
        // The retry case: rejected once with -32021, then answers. Era
        // detection must read this as Modern and retry, never as a reason to
        // fall back to the legacy handshake.
        let (mut child, mut stdin, stdout) = spawn_mock("modern-newer");
        let mut reader = BufReader::new(stdout);

        write_frame(&mut stdin, &json!({"jsonrpc":"2.0","id":1,"method":"server/discover"})).await;
        let rejected = read_frame(&mut reader, Duration::from_secs(5)).await.expect("a reply");
        assert_eq!(error_code(&rejected), Some(-32021));

        write_frame(&mut stdin, &json!({"jsonrpc":"2.0","id":2,"method":"server/discover"})).await;
        let agreed = read_frame(&mut reader, Duration::from_secs(5)).await.expect("a reply");
        assert_eq!(protocol_version(&agreed), Some("2026-07-28"));
        let _ = child.kill().await;
    }

    #[tokio::test]
    async fn a_silent_server_times_out_rather_than_hanging() {
        // The probe-timeout case. A short window because the point is that it
        // returns at all, not how long the real probe waits.
        let (mut child, mut stdin, stdout) = spawn_mock("silent");
        let mut reader = BufReader::new(stdout);

        write_frame(&mut stdin, &json!({"jsonrpc":"2.0","id":1,"method":"server/discover"})).await;
        assert!(
            read_frame(&mut reader, Duration::from_millis(600)).await.is_none(),
            "a server that never answers must time out, not block the test"
        );
        let _ = child.kill().await;
    }
}
