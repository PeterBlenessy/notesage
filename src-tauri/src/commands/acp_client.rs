use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

// ---------------------------------------------------------------------------
// Internal types shared between client and agent thread
// ---------------------------------------------------------------------------

/// Result of the initialize handshake, sent back to the spawning Tauri command.
pub(super) struct InitInfo {
    pub agent_name: Option<String>,
    pub agent_version: Option<String>,
    pub auth_methods: Vec<super::acp::AuthMethodInfo>,
}

/// Reply payload for permission responses from the frontend.
pub(super) struct PermissionReply {
    pub option_id: Option<String>,
}

// ---------------------------------------------------------------------------
// ACP Client implementation with Tauri event forwarding
// ---------------------------------------------------------------------------

/// Notesage's implementation of the ACP Client trait.
/// Forwards session notifications as `acp-session-update` Tauri events
/// and handles permission requests by emitting `acp-permission-request`
/// events and waiting for frontend responses via the command channel.
pub(super) struct NotesageClient {
    pub app: AppHandle,
    pub instance_id: String,
    pub permission_waiters: Rc<RefCell<HashMap<String, oneshot::Sender<PermissionReply>>>>,
    pub next_request_id: Cell<u64>,
}

#[async_trait::async_trait(?Send)]
impl agent_client_protocol::Client for NotesageClient {
    async fn request_permission(
        &self,
        args: agent_client_protocol::RequestPermissionRequest,
    ) -> agent_client_protocol::Result<agent_client_protocol::RequestPermissionResponse> {
        use agent_client_protocol::{
            PermissionOptionId, RequestPermissionOutcome, RequestPermissionResponse,
            SelectedPermissionOutcome,
        };

        // Generate a unique request ID
        let id = self.next_request_id.get();
        self.next_request_id.set(id + 1);
        let request_id = format!("perm-{}", id);

        // Create the response channel
        let (tx, rx) = oneshot::channel();
        self.permission_waiters
            .borrow_mut()
            .insert(request_id.clone(), tx);

        // Emit permission request to frontend
        let payload = serde_json::json!({
            "instanceId": self.instance_id,
            "sessionId": args.session_id.to_string(),
            "requestId": request_id,
            "toolCall": serde_json::to_value(&args.tool_call).unwrap_or_default(),
            "options": serde_json::to_value(&args.options).unwrap_or_default(),
        });
        let _ = self.app.emit("acp-permission-request", payload);

        // Wait for the frontend to respond
        match rx.await {
            Ok(reply) => match reply.option_id {
                Some(oid) => Ok(RequestPermissionResponse::new(
                    RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                        PermissionOptionId::new(oid),
                    )),
                )),
                None => Ok(RequestPermissionResponse::new(
                    RequestPermissionOutcome::Cancelled,
                )),
            },
            Err(_) => {
                // Waiter dropped (agent stopped) — cancel
                Ok(RequestPermissionResponse::new(
                    RequestPermissionOutcome::Cancelled,
                ))
            }
        }
    }

    async fn session_notification(
        &self,
        args: agent_client_protocol::SessionNotification,
    ) -> agent_client_protocol::Result<()> {
        // Serialize the full update and emit as a single event type.
        // The frontend dispatches based on the `sessionUpdate` tag in the JSON.
        let payload = serde_json::json!({
            "instanceId": self.instance_id,
            "sessionId": args.session_id.to_string(),
            "update": serde_json::to_value(&args.update).unwrap_or_default(),
        });
        let _ = self.app.emit("acp-session-update", payload);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Stdout JSON line filter — strips non-JSON lines from agent stdout
// ---------------------------------------------------------------------------

/// Wraps an AsyncRead and filters out non-JSON lines.
/// Some agents (e.g., Gemini CLI) write interactive prompts or log messages
/// to stdout in ACP mode, corrupting the JSON-RPC stream. This filter reads
/// line-by-line and only passes through lines that start with '{'.
pub(super) struct JsonLineFilter<R> {
    inner: tokio::io::BufReader<R>,
    buf: Vec<u8>,
}

impl<R: tokio::io::AsyncRead + Unpin> JsonLineFilter<R> {
    pub fn new(inner: R) -> Self {
        Self {
            inner: tokio::io::BufReader::new(inner),
            buf: Vec::new(),
        }
    }
}

impl<R: tokio::io::AsyncRead + Unpin> tokio::io::AsyncRead for JsonLineFilter<R> {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        use tokio::io::AsyncBufRead;

        let this = self.get_mut();

        // If we have buffered JSON data, return it first
        if !this.buf.is_empty() {
            let n = std::cmp::min(buf.remaining(), this.buf.len());
            buf.put_slice(&this.buf[..n]);
            this.buf.drain(..n);
            return std::task::Poll::Ready(Ok(()));
        }

        // Read lines until we find one starting with '{'
        loop {
            let inner = std::pin::Pin::new(&mut this.inner);
            let internal_buf = match inner.poll_fill_buf(cx) {
                std::task::Poll::Ready(Ok(data)) => data,
                std::task::Poll::Ready(Err(e)) => {
                    return std::task::Poll::Ready(Err(e));
                }
                std::task::Poll::Pending => return std::task::Poll::Pending,
            };

            if internal_buf.is_empty() {
                // EOF
                return std::task::Poll::Ready(Ok(()));
            }

            // Find a newline in the buffer
            if let Some(newline_pos) = internal_buf.iter().position(|&b| b == b'\n') {
                let line = &internal_buf[..=newline_pos];
                let trimmed = line.iter().position(|b| !b.is_ascii_whitespace());

                if let Some(start) = trimmed {
                    if line[start] == b'{' {
                        // JSON line — buffer it and return
                        this.buf.extend_from_slice(line);
                        let consume_len = newline_pos + 1;
                        std::pin::Pin::new(&mut this.inner).consume(consume_len);

                        let n = std::cmp::min(buf.remaining(), this.buf.len());
                        buf.put_slice(&this.buf[..n]);
                        this.buf.drain(..n);
                        return std::task::Poll::Ready(Ok(()));
                    }
                }

                // Non-JSON line — skip it but log at info level for debugging
                let skip_text = String::from_utf8_lossy(&internal_buf[..newline_pos]).to_string();
                if !skip_text.trim().is_empty() {
                    log::info!(target: "notesage::acp", "[agent:stdout] {}", skip_text.trim());
                }
                let consume_len = newline_pos + 1;
                std::pin::Pin::new(&mut this.inner).consume(consume_len);
                // Loop to try the next line
            } else {
                // No newline yet — need more data. Return pending to let the reader buffer more.
                // But first check if the entire buffer is non-JSON (very long non-JSON line)
                if internal_buf.len() > 4096 {
                    let consume_len = internal_buf.len();
                    std::pin::Pin::new(&mut this.inner).consume(consume_len);
                }
                return std::task::Poll::Pending;
            }
        }
    }
}
