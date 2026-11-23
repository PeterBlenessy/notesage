use std::collections::HashMap;
use std::sync::{Arc, Mutex};
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
    pub supports_images: bool,
    /// AgentCapabilities serialized as JSON (passed through to frontend)
    pub capabilities: Option<serde_json::Value>,
}

/// Reply payload for permission responses from the frontend.
pub(super) struct PermissionReply {
    pub option_id: Option<String>,
}

/// Shared map of pending permission requests, keyed by request id.
///
/// The inbound `request_permission` handler inserts a waiter here and forwards
/// the request to the frontend as an `acp-permission-request` Tauri event; the
/// command loop's `PermissionRespond` / `Cancel` arms resolve or clear waiters.
///
/// Uses `Arc<std::sync::Mutex<…>>` (rather than the old `Rc<RefCell<…>>`) because
/// the 0.12 `ConnectionTo<Agent>` handle is `Send + Clone` — handlers and the
/// command loop now run on tokio tasks that may move across threads. The lock is
/// only ever held for the duration of a `HashMap` insert/remove/clear, so there
/// is no risk of holding it across an `.await`.
pub(super) type PermissionWaiters =
    Arc<Mutex<HashMap<String, oneshot::Sender<PermissionReply>>>>;

/// Shared client-side context captured by the inbound ACP handlers.
///
/// Cloned into both the `on_receive_request` (permission) and
/// `on_receive_notification` (session update) closures registered on the
/// connection builder. Everything here is `Send + Sync + Clone` so the handlers
/// satisfy the 0.12 builder bounds.
#[derive(Clone)]
pub(super) struct ClientContext {
    pub app: AppHandle,
    pub instance_id: String,
    pub permission_waiters: PermissionWaiters,
    /// Monotonic counter for generating unique permission request ids.
    pub next_request_id: Arc<std::sync::atomic::AtomicU64>,
}

impl ClientContext {
    pub fn new(app: AppHandle, instance_id: String, permission_waiters: PermissionWaiters) -> Self {
        Self {
            app,
            instance_id,
            permission_waiters,
            next_request_id: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }

    /// Forward a `SessionNotification` to the frontend as an `acp-session-update`
    /// Tauri event. Payload shape is identical to the pre-0.12 client:
    /// `{ instanceId, sessionId, update }`.
    pub fn emit_session_update(
        &self,
        notification: &agent_client_protocol::schema::SessionNotification,
    ) {
        let payload = serde_json::json!({
            "instanceId": self.instance_id,
            "sessionId": notification.session_id.to_string(),
            "update": serde_json::to_value(&notification.update).unwrap_or_default(),
        });
        let _ = self.app.emit("acp-session-update", payload);
    }

    /// Forward the end-of-turn token usage (`PromptResponse.usage`, gated behind
    /// the UNSTABLE `unstable_end_turn_token_usage` feature) to the frontend as
    /// an `acp-turn-usage` Tauri event. Payload: `{ instanceId, sessionId, usage }`
    /// with camelCase usage fields (the schema type serializes camelCase).
    ///
    /// Strictly best-effort: a serialization failure skips the emit — this must
    /// never affect the prompt reply path (provider-usage-display #1).
    pub fn emit_turn_usage(
        &self,
        session_id: &str,
        usage: &agent_client_protocol::schema::Usage,
    ) {
        let Ok(usage_json) = serde_json::to_value(usage) else {
            return;
        };
        let payload = serde_json::json!({
            "instanceId": self.instance_id,
            "sessionId": session_id,
            "usage": usage_json,
        });
        let _ = self.app.emit("acp-turn-usage", payload);
    }

    /// Register a permission waiter and emit the `acp-permission-request` event.
    /// Returns the receiver the handler awaits for the user's decision. Payload
    /// shape is identical to the pre-0.12 client:
    /// `{ instanceId, sessionId, requestId, toolCall, options }`.
    pub fn begin_permission_request(
        &self,
        args: &agent_client_protocol::schema::RequestPermissionRequest,
    ) -> oneshot::Receiver<PermissionReply> {
        let id = self
            .next_request_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let request_id = format!("perm-{}", id);

        let (tx, rx) = oneshot::channel();
        // Recover from a poisoned lock (into_inner) rather than silently skipping
        // the insert — if we dropped `tx` here the handler's `rx` would error and
        // respond Cancelled for a request the user never saw.
        self.permission_waiters
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(request_id.clone(), tx);

        let payload = serde_json::json!({
            "instanceId": self.instance_id,
            "sessionId": args.session_id.to_string(),
            "requestId": request_id,
            "toolCall": serde_json::to_value(&args.tool_call).unwrap_or_default(),
            "options": serde_json::to_value(&args.options).unwrap_or_default(),
        });
        let _ = self.app.emit("acp-permission-request", payload);

        rx
    }
}

// ---------------------------------------------------------------------------
// Stdout JSON line filter — strips non-JSON lines from agent stdout
// ---------------------------------------------------------------------------

/// Wraps an AsyncRead and filters out non-JSON lines.
/// Some agents (e.g., Gemini CLI) write interactive prompts or log messages
/// to stdout in ACP mode, corrupting the JSON-RPC stream. This filter only
/// passes through lines whose first non-whitespace byte is '{'.
///
/// A line is classified by that first byte alone, so the filter never has to
/// hold a whole line: JSON bytes are forwarded as they arrive (the ACP crate's
/// own `read_line` reassembles a message that spans several reads) and
/// non-JSON bytes are dropped as they arrive, however long the line is.
///
/// The filter reads from `inner` directly and returns `Pending` only when
/// `inner` did. An earlier version sat on a `BufReader` and returned `Pending`
/// after a *successful* fill when the buffered bytes had no newline yet — with
/// no waker registered and a buffer that only refills once empty, so a prompt
/// written without `\n` stalled the agent's stdout for good.
pub(super) struct JsonLineFilter<R> {
    inner: R,
    /// Read buffer for `inner`. 64KB, to move large JSON-RPC messages in few reads.
    scratch: Box<[u8]>,
    /// Filtered bytes not yet handed to the caller.
    out: Vec<u8>,
    state: LineState,
    /// Size and first bytes of the non-JSON line being dropped, for the log.
    skipped_len: usize,
    skipped_sample: Vec<u8>,
    eof: bool,
}

/// Where the filter is within the current line.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum LineState {
    /// Only whitespace seen so far; the line is not classified yet.
    Start,
    /// The line began with '{' — forward it up to and including its newline.
    Json,
    /// The line began with something else — drop it up to its newline.
    NonJson,
}

/// How much of a dropped line is quoted in the log.
const SKIPPED_SAMPLE_BYTES: usize = 200;
const JSON_FILTER_READ_BYTES: usize = 65536;

impl<R: tokio::io::AsyncRead + Unpin> JsonLineFilter<R> {
    pub fn new(inner: R) -> Self {
        Self {
            inner,
            scratch: vec![0u8; JSON_FILTER_READ_BYTES].into_boxed_slice(),
            out: Vec::new(),
            state: LineState::Start,
            skipped_len: 0,
            skipped_sample: Vec::new(),
            eof: false,
        }
    }
}

impl<R> JsonLineFilter<R> {
    /// Classify `n` freshly read bytes of `scratch`, appending the JSON ones to `out`.
    fn feed(&mut self, n: usize) {
        let mut rest = &self.scratch[..n];
        while !rest.is_empty() {
            match self.state {
                LineState::Start => {
                    // Leading whitespace (blank lines included) is not part of
                    // any JSON-RPC message; drop it.
                    match rest.iter().position(|b| !b.is_ascii_whitespace()) {
                        None => rest = &[],
                        Some(i) => {
                            self.state = if rest[i] == b'{' {
                                LineState::Json
                            } else {
                                LineState::NonJson
                            };
                            rest = &rest[i..];
                        }
                    }
                }
                LineState::Json => match rest.iter().position(|&b| b == b'\n') {
                    Some(nl) => {
                        self.out.extend_from_slice(&rest[..=nl]);
                        self.state = LineState::Start;
                        rest = &rest[nl + 1..];
                    }
                    None => {
                        self.out.extend_from_slice(rest);
                        rest = &[];
                    }
                },
                LineState::NonJson => {
                    let (line_part, after, ended) = match rest.iter().position(|&b| b == b'\n') {
                        Some(nl) => (&rest[..nl], &rest[nl + 1..], true),
                        None => (rest, &rest[rest.len()..], false),
                    };
                    self.skipped_len += line_part.len();
                    let room = SKIPPED_SAMPLE_BYTES.saturating_sub(self.skipped_sample.len());
                    self.skipped_sample
                        .extend_from_slice(&line_part[..line_part.len().min(room)]);
                    rest = after;
                    if ended {
                        Self::log_skipped(self.skipped_len, &self.skipped_sample);
                        self.skipped_len = 0;
                        self.skipped_sample.clear();
                        self.state = LineState::Start;
                    }
                }
            }
        }
    }

    fn log_skipped(len: usize, sample: &[u8]) {
        log::warn!(
            target: "notesage::acp",
            "[agent:stdout] Skipped non-JSON line ({} bytes, first {}: {:?})",
            len,
            sample.len(),
            String::from_utf8_lossy(sample).trim(),
        );
    }
}

impl<R: tokio::io::AsyncRead + Unpin> tokio::io::AsyncRead for JsonLineFilter<R> {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        use std::task::Poll;

        let this = self.get_mut();
        if buf.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }

        loop {
            // Hand over filtered bytes first; whatever does not fit stays in
            // `out` for the next call.
            if !this.out.is_empty() {
                let n = std::cmp::min(buf.remaining(), this.out.len());
                buf.put_slice(&this.out[..n]);
                this.out.drain(..n);
                return Poll::Ready(Ok(()));
            }
            if this.eof {
                return Poll::Ready(Ok(()));
            }

            // `out` is empty, so every pass through here either produces
            // output, reaches EOF, or parks on `inner` — whose `Pending` has
            // registered the waker. Never return `Pending` on our own.
            let mut read_buf = tokio::io::ReadBuf::new(&mut this.scratch);
            match std::pin::Pin::new(&mut this.inner).poll_read(cx, &mut read_buf) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
                Poll::Ready(Ok(())) => {}
            }
            let n = read_buf.filled().len();
            if n == 0 {
                this.eof = true;
                if this.state == LineState::NonJson {
                    Self::log_skipped(this.skipped_len, &this.skipped_sample);
                }
                continue;
            }
            this.feed(n);
        }
    }
}

#[cfg(test)]
mod json_line_filter_tests {
    use super::JsonLineFilter;
    use std::collections::VecDeque;
    use std::pin::Pin;
    use std::task::{Context, Poll};
    use std::time::Duration;
    use tokio::io::{AsyncRead, AsyncReadExt, ReadBuf};

    /// Yields one scripted chunk per read, with a `Pending` (that wakes
    /// itself) in between — i.e. data that arrives in separate writes.
    struct ScriptedReader {
        chunks: VecDeque<Vec<u8>>,
        pending_next: bool,
    }

    impl ScriptedReader {
        fn new(chunks: &[&[u8]]) -> Self {
            Self {
                chunks: chunks.iter().map(|c| c.to_vec()).collect(),
                pending_next: false,
            }
        }
    }

    impl AsyncRead for ScriptedReader {
        fn poll_read(
            mut self: Pin<&mut Self>,
            cx: &mut Context<'_>,
            buf: &mut ReadBuf<'_>,
        ) -> Poll<std::io::Result<()>> {
            if self.pending_next {
                self.pending_next = false;
                cx.waker().wake_by_ref();
                return Poll::Pending;
            }
            let Some(mut chunk) = self.chunks.pop_front() else {
                return Poll::Ready(Ok(())); // EOF
            };
            let n = chunk.len().min(buf.remaining());
            buf.put_slice(&chunk[..n]);
            if n < chunk.len() {
                self.chunks.push_front(chunk.split_off(n));
            } else {
                self.pending_next = true;
            }
            Poll::Ready(Ok(()))
        }
    }

    /// Read the filter to EOF. A stalled filter fails the test instead of
    /// hanging the suite.
    async fn filtered(chunks: &[&[u8]]) -> String {
        let mut filter = JsonLineFilter::new(ScriptedReader::new(chunks));
        let mut out = Vec::new();
        tokio::time::timeout(Duration::from_secs(5), filter.read_to_end(&mut out))
            .await
            .expect("JsonLineFilter stalled")
            .expect("read failed");
        String::from_utf8(out).expect("utf8")
    }

    #[tokio::test]
    async fn passes_json_lines_and_drops_the_rest() {
        let out = filtered(&[b"hello\n{\"a\":1}\n\nnot json\n  {\"b\":2}\n"]).await;
        assert_eq!(out, "{\"a\":1}\n{\"b\":2}\n");
    }

    /// The stall: a prompt written without a newline, the rest arriving later.
    #[tokio::test]
    async fn partial_non_json_line_then_json_does_not_stall() {
        let out = filtered(&[b"Waiting for auth", b"... done\n{\"id\":1}\n"]).await;
        assert_eq!(out, "{\"id\":1}\n");
    }

    #[tokio::test]
    async fn partial_non_json_line_at_eof_ends_cleanly() {
        assert_eq!(filtered(&[b"{\"id\":1}\n", b"prompt> "]).await, "{\"id\":1}\n");
    }

    #[tokio::test]
    async fn oversized_non_json_without_newline_is_dropped() {
        let junk = vec![b'x'; 5000];
        let more_junk = vec![b'y'; 70_000];
        let out = filtered(&[&junk, &more_junk, b"\n{\"id\":2}\n"]).await;
        assert_eq!(out, "{\"id\":2}\n");
    }

    #[tokio::test]
    async fn json_line_split_across_reads_is_reassembled() {
        let out = filtered(&[b"{\"jsonrpc\":\"2.0\",", b"\"method\":\"x\"", b"}\n", b"{\"id\":3}\n"]).await;
        assert_eq!(out, "{\"jsonrpc\":\"2.0\",\"method\":\"x\"}\n{\"id\":3}\n");
    }

    #[tokio::test]
    async fn json_line_larger_than_the_read_buffer_passes_whole() {
        let big = format!("{{\"data\":\"{}\"}}\n", "z".repeat(200_000));
        let out = filtered(&[b"noise\n", big.as_bytes(), b"noise again\n"]).await;
        assert_eq!(out, big);
    }

    #[tokio::test]
    async fn text_after_a_json_line_in_the_same_read_is_still_filtered() {
        let out = filtered(&[b"{\"id\":4}\nplain", b" text\n{\"id\":5}\n"]).await;
        assert_eq!(out, "{\"id\":4}\n{\"id\":5}\n");
    }

    #[tokio::test]
    async fn small_caller_buffer_gets_every_byte_in_order() {
        let mut filter = JsonLineFilter::new(ScriptedReader::new(&[
            b"skip me\n{\"first\":true}\n{\"second\":",
            b"true}\nskip me too\n",
        ]));
        let mut out = Vec::new();
        let mut small = [0u8; 3];
        let read_all = async {
            loop {
                let n = filter.read(&mut small).await.expect("read failed");
                if n == 0 {
                    break;
                }
                out.extend_from_slice(&small[..n]);
            }
        };
        tokio::time::timeout(Duration::from_secs(5), read_all)
            .await
            .expect("JsonLineFilter stalled");
        assert_eq!(
            String::from_utf8(out).unwrap(),
            "{\"first\":true}\n{\"second\":true}\n"
        );
    }
}
