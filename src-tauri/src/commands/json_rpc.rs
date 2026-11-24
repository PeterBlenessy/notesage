//! Shared JSON-RPC 2.0 types and Content-Length framing for stdio transports.
//!
//! Both the Copilot LSP (`copilot_lsp.rs`) and MCP client (`mcp.rs`) communicate
//! with child processes over stdin/stdout using the JSON-RPC 2.0 protocol with
//! Content-Length header framing (the same wire format used by LSP and MCP).
//!
//! This module extracts the duplicated message types, framing logic, request ID
//! generation, and pending-request bookkeeping into a single shared implementation.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::process::ChildStdin;
use tokio::sync::{oneshot, Mutex};
use tokio::io::BufWriter;
use tokio::time::timeout;

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 message types
// ---------------------------------------------------------------------------

/// A JSON-RPC 2.0 request (has `id` — expects a response).
#[derive(Serialize, Debug)]
pub struct JsonRpcRequest {
    pub jsonrpc: &'static str,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl JsonRpcRequest {
    pub fn new(id: u64, method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            method: method.into(),
            params,
        }
    }
}

/// A JSON-RPC 2.0 notification (no `id` — no response expected).
#[derive(Serialize, Debug)]
pub struct JsonRpcNotification {
    pub jsonrpc: &'static str,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl JsonRpcNotification {
    pub fn new(method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: "2.0",
            method: method.into(),
            params,
        }
    }
}

/// An incoming JSON-RPC 2.0 message (response, server request, or notification).
///
/// This is a superset struct that can represent any of the three message types.
/// Discriminate by checking which fields are present:
/// - Response: has `id`, no `method`
/// - Server request: has `id` AND `method`
/// - Server notification: has `method`, no `id`
#[derive(Deserialize, Debug)]
pub struct JsonRpcMessage {
    #[allow(dead_code)]
    pub jsonrpc: Option<String>,
    pub id: Option<Value>,
    pub method: Option<String>,
    pub params: Option<Value>,
    pub result: Option<Value>,
    pub error: Option<JsonRpcError>,
}

/// A JSON-RPC 2.0 error object.
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
// Request ID generation
// ---------------------------------------------------------------------------

/// Global atomic counter for generating unique JSON-RPC request IDs.
static GLOBAL_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

/// Returns the next unique request ID (monotonically increasing, process-wide).
pub fn next_request_id() -> u64 {
    GLOBAL_REQUEST_ID.fetch_add(1, Ordering::SeqCst)
}

// ---------------------------------------------------------------------------
// Pending request map
// ---------------------------------------------------------------------------

/// A map of in-flight request IDs to their response channels.
///
/// When a request is sent, a oneshot sender is inserted. When the corresponding
/// response arrives, the sender is removed and the result is delivered.
pub type PendingRequests = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, JsonRpcError>>>>>;

/// Create a new empty pending requests map.
pub fn new_pending_requests() -> PendingRequests {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Dispatch an incoming response to its pending request channel.
///
/// Returns `true` if a matching pending request was found and dispatched.
pub async fn dispatch_response(pending: &PendingRequests, msg: &JsonRpcMessage) -> bool {
    if let Some(id_val) = &msg.id {
        let id = match id_val {
            Value::Number(n) => n.as_u64().unwrap_or(0),
            _ => 0,
        };

        let mut map = pending.lock().await;
        if let Some(tx) = map.remove(&id) {
            if let Some(ref err) = msg.error {
                let _ = tx.send(Err(err.clone()));
            } else {
                let _ = tx.send(Ok(msg.result.clone().unwrap_or(Value::Null)));
            }
            return true;
        }
    }
    false
}

/// JSON-RPC "server error" code used for requests that are failed locally
/// because the peer went away (a server never sends it for this reason).
pub const PEER_GONE_ERROR_CODE: i64 = -32000;

/// Fail every in-flight request with `reason` and empty the map.
///
/// A reader loop calls this when it exits for good. The transport kept in
/// managed state holds its own `Arc` to the map, so the senders would otherwise
/// never be dropped and every waiter would hang forever. Returns how many
/// requests were failed.
pub async fn fail_all_pending(pending: &PendingRequests, reason: &str) -> usize {
    let drained: Vec<_> = pending.lock().await.drain().collect();
    let count = drained.len();
    for (_, tx) in drained {
        let _ = tx.send(Err(JsonRpcError {
            code: PEER_GONE_ERROR_CODE,
            message: reason.to_string(),
            data: None,
        }));
    }
    count
}

/// Mark a transport closed (see [`JsonRpcTransport::closed_flag`]) and fail
/// everything in flight, for a reader loop's fatal exit.
///
/// The flag is set BEFORE the map is drained, and `send_request_with_timeout`
/// checks it AFTER inserting, so a request racing the close is failed by one
/// side or the other and is never left waiting.
pub async fn close_pending(pending: &PendingRequests, closed: &AtomicBool, reason: &str) -> usize {
    closed.store(true, Ordering::SeqCst);
    fail_all_pending(pending, reason).await
}

// ---------------------------------------------------------------------------
// Content-Length framing — write
// ---------------------------------------------------------------------------

/// Write a JSON-RPC message with Content-Length framing to a writer.
///
/// The wire format is:
/// ```text
/// Content-Length: <len>\r\n
/// \r\n
/// <json-body>
/// ```
pub async fn write_message<W: AsyncWrite + Unpin>(
    writer: &mut W,
    json: &str,
) -> Result<(), String> {
    let header = format!("Content-Length: {}\r\n\r\n", json.len());
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

// ---------------------------------------------------------------------------
// Content-Length framing — read
// ---------------------------------------------------------------------------

/// Hard cap on a single framed JSON-RPC message body. The length comes from an
/// untrusted peer (an MCP/LSP subprocess — including agent-spawned or
/// third-party servers). Without a cap, a `Content-Length: 99999999999` header
/// drives a multi-GB `vec![0u8; n]` allocation that aborts the process *before*
/// any read timeout fires (audit rust H1). 64 MiB is far above any legitimate
/// LSP/MCP message while keeping a hostile header from exhausting memory.
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024 * 1024;

/// Hard cap on the cumulative size of the header section. A peer that never
/// sends the terminating blank line would otherwise grow the line buffer
/// without bound (audit rust M3/M4).
const MAX_HEADER_BYTES: usize = 64 * 1024;

/// Read the Content-Length value from the header section of a framed message.
///
/// Reads lines until an empty line (`\r\n`) is encountered, extracting the
/// `Content-Length` value. Returns `Err` on EOF, a missing header, a header
/// section larger than [`MAX_HEADER_BYTES`], or a body length larger than
/// [`MAX_MESSAGE_BYTES`].
pub async fn read_content_length<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<usize, String> {
    let mut content_length: Option<usize> = None;
    let mut header_bytes: usize = 0;

    loop {
        let mut line = String::new();
        let bytes_read = reader
            .read_line(&mut line)
            .await
            .map_err(|e| format!("Failed to read header line: {}", e))?;

        if bytes_read == 0 {
            return Err("EOF while reading headers (process exited)".to_string());
        }

        header_bytes = header_bytes.saturating_add(bytes_read);
        if header_bytes > MAX_HEADER_BYTES {
            return Err(format!(
                "JSON-RPC header section exceeds {} bytes — refusing to read further",
                MAX_HEADER_BYTES
            ));
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }

        if let Some(val) = trimmed.strip_prefix("Content-Length:") {
            content_length = val.trim().parse().ok();
        }
        // Ignore other headers (e.g., Content-Type)
    }

    let len = content_length.ok_or_else(|| "Missing Content-Length header".to_string())?;
    if len > MAX_MESSAGE_BYTES {
        return Err(format!(
            "JSON-RPC message length {} exceeds maximum of {} bytes",
            len, MAX_MESSAGE_BYTES
        ));
    }
    Ok(len)
}

/// Read a complete JSON-RPC message from a Content-Length framed stream.
///
/// Returns `Ok(Some(value))` on success, `Ok(None)` should not normally occur
/// (EOF is reported as `Err`), and `Err` on I/O or parse failure.
#[allow(dead_code)] // Used in tests; kept as public utility for JSON-RPC consumers
pub async fn read_message<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Value, String> {
    let content_length = read_content_length(reader).await?;

    let mut body = vec![0u8; content_length];
    reader
        .read_exact(&mut body)
        .await
        .map_err(|e| format!("Failed to read body: {}", e))?;

    let body_str =
        String::from_utf8(body).map_err(|e| format!("Invalid UTF-8 in body: {}", e))?;

    serde_json::from_str(&body_str)
        .map_err(|e| format!("Failed to parse JSON-RPC message: {}", e))
}

// ---------------------------------------------------------------------------
// Process liveness check
// ---------------------------------------------------------------------------

/// Check if a process is still alive using its PID.
///
/// On Unix, uses `kill(pid, 0)` which checks existence without sending a signal.
/// Returns `true` if the process exists or if the PID is `None` (unknown).
pub fn is_process_alive(pid: Option<u32>) -> bool {
    match pid {
        Some(pid) => {
            #[cfg(unix)]
            {
                unsafe { libc::kill(pid as i32, 0) == 0 }
            }
            #[cfg(not(unix))]
            {
                let _ = pid;
                true
            }
        }
        None => true,
    }
}

// ---------------------------------------------------------------------------
// Shared JSON-RPC transport
// ---------------------------------------------------------------------------

/// A reusable JSON-RPC 2.0 transport over Content-Length framed stdio.
///
/// Wraps a child process's stdin writer and a pending-request map. Both the
/// Copilot LSP and MCP client use this to send requests and notifications.
/// Each caller spawns its own reader loop (they handle server→client messages
/// differently) using [`read_next_message`] for the common read/parse/timeout logic.
pub struct JsonRpcTransport {
    pub writer: Arc<Mutex<BufWriter<ChildStdin>>>,
    pub pending: PendingRequests,
    /// Set once the reader loop has exited for good (see [`close_pending`]).
    /// A request sent after that fails at once instead of waiting for a reply
    /// that nothing will ever read.
    closed: Arc<AtomicBool>,
}

impl JsonRpcTransport {
    /// Create a new transport from a child process's stdin.
    ///
    /// The caller is responsible for spawning a reader loop on stdout that
    /// calls [`dispatch_response`] for incoming responses.
    pub fn new(stdin: ChildStdin) -> Self {
        Self {
            writer: Arc::new(Mutex::new(BufWriter::new(stdin))),
            pending: new_pending_requests(),
            closed: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Create a lightweight clone sharing the same writer and pending map.
    pub fn clone_handle(&self) -> Self {
        Self {
            writer: self.writer.clone(),
            pending: self.pending.clone(),
            closed: self.closed.clone(),
        }
    }

    /// The closed flag, for the reader loop, which holds the pending map but
    /// not the transport itself (holding the transport would keep the child's
    /// stdin open). It passes both to [`close_pending`] on its fatal exit.
    pub fn closed_flag(&self) -> Arc<AtomicBool> {
        self.closed.clone()
    }

    /// Send a JSON-RPC request and wait for the response, with no time limit.
    pub async fn send_request(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, String> {
        self.send_request_with_timeout(method, params, None).await
    }

    /// Send a JSON-RPC request and wait at most `limit` for the response
    /// (`None` waits indefinitely).
    ///
    /// The pending entry is removed on every failure path (write error,
    /// timeout, closed transport), so a request that will never be answered
    /// does not stay in the map.
    pub async fn send_request_with_timeout(
        &self,
        method: &str,
        params: Option<Value>,
        limit: Option<Duration>,
    ) -> Result<Value, String> {
        let id = next_request_id();
        let msg = JsonRpcRequest::new(id, method, params);
        let json = serde_json::to_string(&msg).map_err(|e| e.to_string())?;

        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        if self.closed.load(Ordering::SeqCst) {
            self.pending.lock().await.remove(&id);
            return Err("Server process has exited".to_string());
        }

        let written = {
            let mut writer = self.writer.lock().await;
            write_message(&mut *writer, &json).await
        };
        if let Err(e) = written {
            self.pending.lock().await.remove(&id);
            return Err(e);
        }

        let outcome = match limit {
            Some(limit) => match timeout(limit, rx).await {
                Ok(outcome) => outcome,
                Err(_) => {
                    self.pending.lock().await.remove(&id);
                    return Err(format!(
                        "Request '{}' timed out after {}s",
                        method,
                        limit.as_secs_f32()
                    ));
                }
            },
            None => rx.await,
        };

        match outcome {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(rpc_err)) => Err(rpc_err.to_string()),
            Err(_) => Err("Response channel closed (process may have exited)".to_string()),
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
        write_message(&mut *writer, &json).await
    }
}

// ---------------------------------------------------------------------------
// Reader loop helper
// ---------------------------------------------------------------------------

/// Result of attempting to read the next JSON-RPC message from a framed stream.
pub enum ReadMessageResult {
    /// Successfully read and parsed a message.
    Message(JsonRpcMessage),
    /// No message started within the timeout (or one was skipped as
    /// unparseable) and the process is still alive — caller should retry.
    /// Never returned part-way through a message: the stream is always at a
    /// message boundary when the caller reads again.
    Timeout,
    /// Fatal error — process exited, EOF, or IO failure.
    Fatal(String),
}

/// Read the next Content-Length framed JSON-RPC message with timeout and
/// process health checking.
///
/// This encapsulates the read/timeout/health-check/parse pattern shared by
/// both the Copilot LSP and MCP reader loops. Parse failures are logged and
/// returned as `Timeout` (caller retries) to match the existing behavior of
/// both readers.
pub async fn read_next_message<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    timeout_duration: Duration,
    child_pid: Option<u32>,
) -> ReadMessageResult {
    // 1. Read Content-Length header with timeout
    let content_length = match timeout(timeout_duration, read_content_length(reader)).await {
        Ok(Ok(len)) => len,
        Ok(Err(e)) => return ReadMessageResult::Fatal(e),
        Err(_) => {
            if !is_process_alive(child_pid) {
                return ReadMessageResult::Fatal(
                    "Process died during header read".to_string(),
                );
            }
            return ReadMessageResult::Timeout;
        }
    };

    // 2. Read the body. A timeout here must NOT abandon the message: the bytes
    //    already consumed would be lost and the next header read would start
    //    in the middle of this body, breaking the framing for good. So the
    //    partial buffer is kept and the read resumes for as long as the
    //    process is alive (the size cap above already bounds the body).
    let mut body = vec![0u8; content_length];
    let mut filled = 0usize;
    while filled < content_length {
        match timeout(timeout_duration, reader.read(&mut body[filled..])).await {
            Ok(Ok(0)) => {
                return ReadMessageResult::Fatal(
                    "EOF while reading body (process exited)".to_string(),
                )
            }
            Ok(Ok(n)) => filled += n,
            Ok(Err(e)) => {
                return ReadMessageResult::Fatal(format!("Failed to read body: {}", e))
            }
            Err(_) => {
                if !is_process_alive(child_pid) {
                    return ReadMessageResult::Fatal(
                        "Process died during body read".to_string(),
                    );
                }
                log::debug!(
                    "JSON-RPC body read stalled at {}/{} bytes, still waiting",
                    filled,
                    content_length
                );
            }
        }
    }

    // 3. Parse UTF-8 + JSON
    let body_str = match String::from_utf8(body) {
        Ok(s) => s,
        Err(e) => return ReadMessageResult::Fatal(format!("Invalid UTF-8 in body: {}", e)),
    };

    match serde_json::from_str(&body_str) {
        Ok(msg) => ReadMessageResult::Message(msg),
        Err(e) => {
            log::warn!(
                "Failed to parse JSON-RPC message: {} — {}",
                e,
                &body_str[..body_str.len().min(200)]
            );
            // Not fatal — skip this message and retry
            ReadMessageResult::Timeout
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader;

    #[test]
    fn test_next_request_id_increments() {
        let id1 = next_request_id();
        let id2 = next_request_id();
        assert!(id2 > id1, "IDs should be monotonically increasing");
    }

    #[test]
    fn test_json_rpc_request_serialization() {
        let req = JsonRpcRequest::new(1, "initialize", Some(serde_json::json!({"foo": "bar"})));
        let json = serde_json::to_string(&req).unwrap();
        let parsed: Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["jsonrpc"], "2.0");
        assert_eq!(parsed["id"], 1);
        assert_eq!(parsed["method"], "initialize");
        assert_eq!(parsed["params"]["foo"], "bar");
    }

    #[test]
    fn test_json_rpc_request_no_params() {
        let req = JsonRpcRequest::new(42, "shutdown", None);
        let json = serde_json::to_string(&req).unwrap();
        let parsed: Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["id"], 42);
        assert_eq!(parsed["method"], "shutdown");
        assert!(parsed.get("params").is_none(), "params should be omitted when None");
    }

    #[test]
    fn test_json_rpc_notification_serialization() {
        let notif = JsonRpcNotification::new("initialized", None);
        let json = serde_json::to_string(&notif).unwrap();
        let parsed: Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["jsonrpc"], "2.0");
        assert_eq!(parsed["method"], "initialized");
        assert!(parsed.get("id").is_none(), "notifications must not have id");
        assert!(parsed.get("params").is_none());
    }

    #[test]
    fn test_json_rpc_error_display() {
        let err = JsonRpcError {
            code: -32600,
            message: "Invalid Request".to_string(),
            data: None,
        };
        assert_eq!(err.to_string(), "JSON-RPC error -32600: Invalid Request");
    }

    #[test]
    fn test_json_rpc_message_deserialization_response() {
        let json = r#"{"jsonrpc":"2.0","id":1,"result":{"capabilities":{}}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(json).unwrap();

        assert!(msg.id.is_some());
        assert!(msg.method.is_none());
        assert!(msg.result.is_some());
        assert!(msg.error.is_none());
    }

    #[test]
    fn test_json_rpc_message_deserialization_error() {
        let json = r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"Method not found"}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(json).unwrap();

        assert!(msg.id.is_some());
        assert!(msg.error.is_some());
        let err = msg.error.unwrap();
        assert_eq!(err.code, -32601);
        assert_eq!(err.message, "Method not found");
    }

    #[test]
    fn test_json_rpc_message_deserialization_notification() {
        let json = r#"{"jsonrpc":"2.0","method":"window/logMessage","params":{"type":3,"message":"hello"}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(json).unwrap();

        assert!(msg.id.is_none());
        assert_eq!(msg.method.as_deref(), Some("window/logMessage"));
        assert!(msg.params.is_some());
    }

    #[tokio::test]
    async fn test_write_message_framing() {
        let mut buf: Vec<u8> = Vec::new();
        let json = r#"{"jsonrpc":"2.0","id":1,"method":"test"}"#;

        write_message(&mut buf, json).await.unwrap();

        let output = String::from_utf8(buf).unwrap();
        let expected = format!("Content-Length: {}\r\n\r\n{}", json.len(), json);
        assert_eq!(output, expected);
    }

    #[tokio::test]
    async fn test_read_content_length_basic() {
        let input = b"Content-Length: 42\r\n\r\n";
        let mut reader = BufReader::new(&input[..]);
        let len = read_content_length(&mut reader).await.unwrap();
        assert_eq!(len, 42);
    }

    #[tokio::test]
    async fn test_read_content_length_with_extra_headers() {
        let input = b"Content-Type: application/json\r\nContent-Length: 100\r\n\r\n";
        let mut reader = BufReader::new(&input[..]);
        let len = read_content_length(&mut reader).await.unwrap();
        assert_eq!(len, 100);
    }

    #[tokio::test]
    async fn test_read_content_length_missing() {
        let input = b"Content-Type: application/json\r\n\r\n";
        let mut reader = BufReader::new(&input[..]);
        let result = read_content_length(&mut reader).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Missing Content-Length"));
    }

    #[tokio::test]
    async fn test_read_content_length_eof() {
        let input = b"";
        let mut reader = BufReader::new(&input[..]);
        let result = read_content_length(&mut reader).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("EOF"));
    }

    #[tokio::test]
    async fn test_read_content_length_rejects_oversized_body() {
        // A hostile peer advertising a multi-GB body must be rejected before we
        // ever allocate (audit rust H1) — not parsed into a giant Vec.
        let huge = MAX_MESSAGE_BYTES + 1;
        let input = format!("Content-Length: {}\r\n\r\n", huge);
        let mut reader = BufReader::new(input.as_bytes());
        let result = read_content_length(&mut reader).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("exceeds maximum"));
    }

    #[tokio::test]
    async fn test_read_content_length_accepts_at_cap() {
        let input = format!("Content-Length: {}\r\n\r\n", MAX_MESSAGE_BYTES);
        let mut reader = BufReader::new(input.as_bytes());
        let len = read_content_length(&mut reader).await.unwrap();
        assert_eq!(len, MAX_MESSAGE_BYTES);
    }

    #[tokio::test]
    async fn test_read_content_length_rejects_unbounded_header() {
        // No terminating blank line, endless header bytes — must bail rather
        // than grow the line buffer without bound (audit rust M3/M4).
        let mut input = Vec::new();
        input.extend_from_slice(b"X-Junk: ");
        input.resize(MAX_HEADER_BYTES + 1024, b'a');
        let mut reader = BufReader::new(&input[..]);
        let result = read_content_length(&mut reader).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("header section exceeds"));
    }

    #[tokio::test]
    async fn test_read_message_complete() {
        let body = r#"{"jsonrpc":"2.0","id":1,"result":null}"#;
        let framed = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
        let mut reader = BufReader::new(framed.as_bytes());

        let value = read_message(&mut reader).await.unwrap();
        assert_eq!(value["jsonrpc"], "2.0");
        assert_eq!(value["id"], 1);
    }

    #[tokio::test]
    async fn test_write_read_roundtrip() {
        let original = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 7,
            "method": "tools/list",
            "params": {"cursor": null}
        });

        let json_str = serde_json::to_string(&original).unwrap();

        // Write
        let mut buf: Vec<u8> = Vec::new();
        write_message(&mut buf, &json_str).await.unwrap();

        // Read back
        let mut reader = BufReader::new(&buf[..]);
        let parsed = read_message(&mut reader).await.unwrap();

        assert_eq!(parsed, original);
    }

    #[tokio::test]
    async fn test_dispatch_response_success() {
        let pending = new_pending_requests();
        let (tx, rx) = oneshot::channel();
        pending.lock().await.insert(5, tx);

        let msg = JsonRpcMessage {
            jsonrpc: Some("2.0".to_string()),
            id: Some(Value::Number(5.into())),
            method: None,
            params: None,
            result: Some(serde_json::json!({"ok": true})),
            error: None,
        };

        let dispatched = dispatch_response(&pending, &msg).await;
        assert!(dispatched);

        let result = rx.await.unwrap().unwrap();
        assert_eq!(result["ok"], true);
    }

    #[tokio::test]
    async fn test_dispatch_response_error() {
        let pending = new_pending_requests();
        let (tx, rx) = oneshot::channel();
        pending.lock().await.insert(3, tx);

        let msg = JsonRpcMessage {
            jsonrpc: Some("2.0".to_string()),
            id: Some(Value::Number(3.into())),
            method: None,
            params: None,
            result: None,
            error: Some(JsonRpcError {
                code: -32601,
                message: "Method not found".to_string(),
                data: None,
            }),
        };

        let dispatched = dispatch_response(&pending, &msg).await;
        assert!(dispatched);

        let result = rx.await.unwrap();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code, -32601);
    }

    #[tokio::test]
    async fn test_dispatch_response_no_match() {
        let pending = new_pending_requests();

        let msg = JsonRpcMessage {
            jsonrpc: Some("2.0".to_string()),
            id: Some(Value::Number(999.into())),
            method: None,
            params: None,
            result: Some(Value::Null),
            error: None,
        };

        let dispatched = dispatch_response(&pending, &msg).await;
        assert!(!dispatched, "should return false when no pending request matches");
    }

    #[tokio::test]
    async fn fail_all_pending_resolves_every_waiter_with_the_reason() {
        let pending = new_pending_requests();
        let (tx1, rx1) = oneshot::channel();
        let (tx2, rx2) = oneshot::channel();
        pending.lock().await.insert(1, tx1);
        pending.lock().await.insert(2, tx2);

        assert_eq!(fail_all_pending(&pending, "server exited").await, 2);

        for rx in [rx1, rx2] {
            let err = rx.await.expect("waiter is resolved, not dropped").unwrap_err();
            assert_eq!(err.code, PEER_GONE_ERROR_CODE);
            assert_eq!(err.message, "server exited");
        }
        assert!(pending.lock().await.is_empty());
    }

    #[tokio::test]
    async fn read_next_message_survives_a_stall_in_the_middle_of_a_body() {
        // The peer pauses mid-body for longer than the read timeout, then
        // finishes and sends a second message. Both must arrive intact: the
        // old code returned `Timeout` with the first half already consumed,
        // so the retry parsed the second half as a header.
        use tokio::io::AsyncWriteExt;
        let first = r#"{"jsonrpc":"2.0","id":1,"result":{"text":"a slow tool result"}}"#;
        let second = r#"{"jsonrpc":"2.0","id":2,"result":null}"#;
        let (mut tx, rx) = tokio::io::duplex(4096);
        let writer = tokio::spawn(async move {
            let (head, tail) = first.split_at(first.len() / 2);
            let framed_head = format!("Content-Length: {}\r\n\r\n{}", first.len(), head);
            tx.write_all(framed_head.as_bytes()).await.unwrap();
            tokio::time::sleep(Duration::from_millis(200)).await;
            tx.write_all(tail.as_bytes()).await.unwrap();
            let framed_second = format!("Content-Length: {}\r\n\r\n{}", second.len(), second);
            tx.write_all(framed_second.as_bytes()).await.unwrap();
            tx
        });
        let mut reader = BufReader::new(rx);
        let short = Duration::from_millis(40);

        let mut ids = Vec::new();
        while ids.len() < 2 {
            match read_next_message(&mut reader, short, None).await {
                ReadMessageResult::Message(m) => ids.push(m.id.and_then(|v| v.as_u64())),
                ReadMessageResult::Timeout => continue,
                ReadMessageResult::Fatal(e) => panic!("framing was lost: {e}"),
            }
        }
        assert_eq!(ids, vec![Some(1), Some(2)]);
        drop(writer.await.unwrap());
    }

    #[tokio::test]
    async fn read_next_message_reports_eof_inside_a_body_as_fatal() {
        let input = b"Content-Length: 50\r\n\r\n{\"jsonrpc\":";
        let mut reader = BufReader::new(&input[..]);
        match read_next_message(&mut reader, Duration::from_secs(1), None).await {
            ReadMessageResult::Fatal(e) => assert!(e.contains("EOF"), "{e}"),
            _ => panic!("a truncated body must be fatal"),
        }
    }

    /// A transport over a real child's stdin (the writer type is concrete).
    /// `sleep` never reads it and never answers: the silent-server case.
    #[cfg(unix)]
    fn transport_over_sleep(seconds: &str) -> (tokio::process::Child, JsonRpcTransport) {
        let mut child = tokio::process::Command::new("sleep")
            .arg(seconds)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .expect("spawn sleep");
        let stdin = child.stdin.take().expect("piped");
        (child, JsonRpcTransport::new(stdin))
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn send_request_times_out_and_forgets_the_request() {
        let (_child, transport) = transport_over_sleep("30");

        let err = transport
            .send_request_with_timeout("tools/call", None, Some(Duration::from_millis(100)))
            .await
            .unwrap_err();

        assert!(err.contains("timed out"), "{err}");
        assert!(
            transport.pending.lock().await.is_empty(),
            "a timed-out request must not stay in the pending map"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn send_request_forgets_the_request_when_the_write_fails() {
        let (mut child, transport) = transport_over_sleep("0");
        let _ = child.wait().await; // the read end of its stdin is now closed

        let result = transport
            .send_request_with_timeout("initialize", None, Some(Duration::from_secs(5)))
            .await;

        assert!(result.is_err());
        assert!(
            transport.pending.lock().await.is_empty(),
            "a request that was never written must not stay in the pending map"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn close_fails_requests_in_flight_and_every_later_one() {
        let (_child, transport) = transport_over_sleep("30");
        let in_flight = transport.clone_handle();
        let waiting =
            tokio::spawn(async move { in_flight.send_request("tools/call", None).await });
        // Let the request reach the pending map.
        while transport.pending.lock().await.is_empty() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }

        let failed = close_pending(
            &transport.pending,
            &transport.closed_flag(),
            "Server process exited: EOF",
        )
        .await;
        assert_eq!(failed, 1);

        let err = tokio::time::timeout(Duration::from_secs(5), waiting)
            .await
            .expect("the in-flight request is failed, not left hanging")
            .unwrap()
            .unwrap_err();
        assert!(err.contains("Server process exited"), "{err}");

        // No time limit given: this would hang if `closed` were ignored.
        let later = tokio::time::timeout(
            Duration::from_secs(5),
            transport.send_request("tools/list", None),
        )
        .await
        .expect("a request on a closed transport fails at once");
        assert!(later.is_err());
        assert!(transport.pending.lock().await.is_empty());
    }
}
