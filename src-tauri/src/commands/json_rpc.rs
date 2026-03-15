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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{oneshot, Mutex};

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

/// Read the Content-Length value from the header section of a framed message.
///
/// Reads lines until an empty line (`\r\n`) is encountered, extracting the
/// `Content-Length` value. Returns `Err` on EOF or missing header.
pub async fn read_content_length<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<usize, String> {
    let mut content_length: Option<usize> = None;

    loop {
        let mut line = String::new();
        let bytes_read = reader
            .read_line(&mut line)
            .await
            .map_err(|e| format!("Failed to read header line: {}", e))?;

        if bytes_read == 0 {
            return Err("EOF while reading headers (process exited)".to_string());
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

    content_length.ok_or_else(|| "Missing Content-Length header".to_string())
}

/// Read a complete JSON-RPC message from a Content-Length framed stream.
///
/// Returns `Ok(Some(value))` on success, `Ok(None)` should not normally occur
/// (EOF is reported as `Err`), and `Err` on I/O or parse failure.
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
}
