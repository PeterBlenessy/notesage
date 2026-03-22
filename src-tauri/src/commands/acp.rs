use serde::{Deserialize, Serialize};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::rc::Rc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, oneshot, Mutex};

use super::shell_path::get_shell_path;
use super::constants;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentAvailability {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub authenticated: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    Interactive,
    Task,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SpawnResult {
    pub instance_id: String,
    pub agent_name: Option<String>,
    pub agent_version: Option<String>,
    pub auth_methods: Vec<AuthMethodInfo>,
    pub sandbox_enabled: bool,
    pub network_sandbox_enabled: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AuthMethodInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AuthStatus {
    pub authenticated: bool,
    pub method_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentModelInfo {
    pub model_id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionResult {
    pub session_id: String,
    pub current_model: Option<String>,
    pub available_models: Vec<AgentModelInfo>,
}

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

pub struct AcpState {
    agents: Mutex<HashMap<String, AgentHandle>>,
}

impl AcpState {
    pub fn new() -> Self {
        Self {
            agents: Mutex::new(HashMap::new()),
        }
    }

    /// Stop all running agents synchronously. Drains the agents map,
    /// drops channel senders (closing channels), and joins threads.
    /// Called from the Tauri `RunEvent::Exit` handler.
    ///
    /// When `cmd_tx` is dropped, the channel closes, causing `cmd_rx.recv()`
    /// in `run_agent_thread` to return `None`. This exits the command loop,
    /// which drops the `Child` (with `kill_on_drop(true)`) sending SIGKILL.
    pub fn stop_all_sync(&self) {
        let mut agents = match self.agents.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                log::warn!(target: "notesage::acp", "Could not acquire agent lock during shutdown");
                return;
            }
        };

        for (instance_id, mut handle) in agents.drain() {
            log::info!(target: "notesage::acp", "Stopping agent {} on exit", instance_id);
            // Drop the channel sender to close the channel
            drop(handle.cmd_tx);
            // Wait for the OS thread to finish (child kill_on_drop handles the process)
            if let Some(th) = handle.thread_handle.take() {
                let _ = th.join();
            }
        }
    }

    /// Check liveness of all ACP agent processes.
    pub async fn check_processes(&self) -> Vec<super::health::ProcessStatus> {
        let agents = self.agents.lock().await;
        agents
            .iter()
            .map(|(id, handle)| {
                // We can't easily try_wait on ACP agents since the child is managed
                // by the OS thread. Report as alive if the thread is still running.
                let alive = handle
                    .thread_handle
                    .as_ref()
                    .map(|th| !th.is_finished())
                    .unwrap_or(false);
                super::health::ProcessStatus {
                    name: id.clone(),
                    alive,
                    pid: None,
                }
            })
            .collect()
    }
}

/// Handle held in AcpState for each running agent.
/// Communication with the agent thread is done via the command channel.
struct AgentHandle {
    #[allow(dead_code)]
    role: AgentRole,
    #[allow(dead_code)]
    agent_binary: String,
    #[allow(dead_code)]
    working_directory: String,
    cmd_tx: mpsc::Sender<AgentCmd>,
    thread_handle: Option<std::thread::JoinHandle<()>>,
}

// ---------------------------------------------------------------------------
// Agent thread command channel
// ---------------------------------------------------------------------------

enum AgentCmd {
    Authenticate {
        method_id: Option<String>,
        reply: oneshot::Sender<Result<AuthStatus, String>>,
    },
    NewSession {
        working_directory: String,
        reply: oneshot::Sender<Result<SessionResult, String>>,
    },
    LoadSession {
        session_id: String,
        working_directory: String,
        reply: oneshot::Sender<Result<SessionResult, String>>,
    },
    Prompt {
        session_id: String,
        content: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Cancel {
        session_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    PermissionRespond {
        request_id: String,
        option_id: Option<String>,
    },
    Stop {
        reply: oneshot::Sender<Result<(), String>>,
    },
}

/// Result of the initialize handshake, sent back to the spawning Tauri command.
struct InitInfo {
    agent_name: Option<String>,
    agent_version: Option<String>,
    auth_methods: Vec<AuthMethodInfo>,
}

/// Reply payload for permission responses from the frontend.
struct PermissionReply {
    option_id: Option<String>,
}

// ---------------------------------------------------------------------------
// ACP Client implementation with Tauri event forwarding
// ---------------------------------------------------------------------------

/// Notesage's implementation of the ACP Client trait.
/// Forwards session notifications as `acp-session-update` Tauri events
/// and handles permission requests by emitting `acp-permission-request`
/// events and waiting for frontend responses via the command channel.
struct NotesageClient {
    app: AppHandle,
    instance_id: String,
    permission_waiters: Rc<RefCell<HashMap<String, oneshot::Sender<PermissionReply>>>>,
    next_request_id: Cell<u64>,
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
struct JsonLineFilter<R> {
    inner: tokio::io::BufReader<R>,
    buf: Vec<u8>,
}

impl<R: tokio::io::AsyncRead + Unpin> JsonLineFilter<R> {
    fn new(inner: R) -> Self {
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

// ---------------------------------------------------------------------------
// Agent thread: owns the !Send ClientSideConnection
// ---------------------------------------------------------------------------

/// Runs on a dedicated OS thread with a single-threaded tokio runtime + LocalSet.
/// This is necessary because ClientSideConnection is !Send (uses LocalBoxFuture).
fn run_agent_thread(
    app: AppHandle,
    instance_id: String,
    agent_binary: String,
    agent_args: Vec<String>,
    working_directory: String,
    env_vars: HashMap<String, String>,
    sandbox_enabled: bool,
    sandbox_writable_paths: Vec<String>,
    network_config: Option<super::network_proxy::NetworkSandboxConfig>,
    kernel_network_deny: bool,
    mut cmd_rx: mpsc::Receiver<AgentCmd>,
    init_tx: oneshot::Sender<Result<InitInfo, String>>,
) {
    use agent_client_protocol::*;
    use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

    // Clone for cleanup after the command loop exits
    let proxy_instance_id = instance_id.clone();
    let has_network_proxy = network_config.is_some();
    let proxy_cleanup_app = if has_network_proxy { Some(app.clone()) } else { None };
    let monitor_cleanup_app = if sandbox_enabled { Some(app.clone()) } else { None };
    // Shared cell to capture the agent PID from inside the async block for cleanup outside
    let captured_pid: std::sync::Arc<std::sync::atomic::AtomicU32> =
        std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
    let captured_pid_inner = std::sync::Arc::clone(&captured_pid);

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("Failed to create tokio runtime for ACP agent");

    let local = tokio::task::LocalSet::new();

    local.block_on(&rt, async move {
        // Shared permission waiters for client ↔ command loop communication
        let permission_waiters: Rc<RefCell<HashMap<String, oneshot::Sender<PermissionReply>>>> =
            Rc::new(RefCell::new(HashMap::new()));

        let sandbox_instance_id = instance_id.clone();
        let client = NotesageClient {
            app,
            instance_id,
            permission_waiters: Rc::clone(&permission_waiters),
            next_request_id: Cell::new(0),
        };

        // Spawn agent process — optionally wrapped in OS-level sandbox
        // Inject login shell PATH so the agent (and child processes) can find tools
        let mut spawn_cmd = if sandbox_enabled {
            match super::sandbox::sandboxed_command(&sandbox_instance_id, &sandbox_writable_paths, network_config.as_ref(), kernel_network_deny) {
                Ok((program, prefix_args)) => {
                    log::info!(target: "notesage::acp", "Spawning {} in sandbox ({})", agent_binary, program);
                    let mut cmd = tokio::process::Command::new(&program);
                    cmd.args(&prefix_args);
                    cmd.arg(&agent_binary);
                    cmd.args(&agent_args);
                    cmd
                }
                Err(e) => {
                    log::warn!(target: "notesage::acp", "Sandbox unavailable, spawning unsandboxed: {}", e);
                    let mut cmd = tokio::process::Command::new(&agent_binary);
                    cmd.args(&agent_args);
                    cmd
                }
            }
        } else {
            let mut cmd = tokio::process::Command::new(&agent_binary);
            cmd.args(&agent_args);
            cmd
        };
        spawn_cmd
            .current_dir(&working_directory)
            .envs(&env_vars)
            // Prevent "nested session" detection when Notesage is launched from Claude Code
            .env_remove("CLAUDECODE")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        if let Some(shell_path) = get_shell_path() {
            spawn_cmd.env("PATH", shell_path);
        }
        let mut child = match spawn_cmd.spawn()
        {
            Ok(child) => child,
            Err(e) => {
                let _ = init_tx.send(Err(format!(
                    "Failed to spawn '{}': {}",
                    agent_binary, e
                )));
                return;
            }
        };

        // Register PID for sandbox violation monitoring (if sandboxed)
        if sandbox_enabled {
            if let Some(pid) = child.id() {
                captured_pid_inner.store(pid, std::sync::atomic::Ordering::Relaxed);
                #[cfg(target_os = "macos")]
                {
                    let monitor_state = client.app.state::<super::sandbox_monitor::SandboxMonitorState>();
                    monitor_state.register_and_start(
                        &client.app,
                        sandbox_instance_id.clone(),
                        agent_binary.clone(),
                        pid,
                    ).await;
                    log::info!(target: "notesage::acp", "Registered PID {} for sandbox monitoring", pid);
                }
            }
        }

        // Pre-send "Y\n" for agents that prompt for confirmation before ACP starts
        // (e.g., Gemini CLI asks "Do you want to continue? [Y/n]:" during auth)
        {
            use tokio::io::AsyncWriteExt;
            if let Some(ref mut stdin_handle) = child.stdin {
                let _ = stdin_handle.write_all(b"Y\n").await;
                let _ = stdin_handle.flush().await;
            }
        }

        // Spawn a task to read and log stderr from the agent process
        if let Some(stderr) = child.stderr.take() {
            let stderr_binary = agent_binary.clone();
            tokio::task::spawn_local(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    log::info!(target: "notesage::acp", "[{}:stderr] {}", stderr_binary, line);
                }
            });
        }

        // Bridge tokio IO → futures IO for ACP
        // Wrap stdout in a filter that strips non-JSON lines — some agents
        // (e.g., Gemini CLI) write interactive prompts to stdout in ACP mode
        let stdin = match child.stdin.take() {
            Some(s) => s.compat_write(),
            None => {
                let _ = init_tx.send(Err("Failed to acquire agent stdin pipe".to_string()));
                return;
            }
        };
        let raw_stdout = match child.stdout.take() {
            Some(s) => s,
            None => {
                let _ = init_tx.send(Err("Failed to acquire agent stdout pipe".to_string()));
                return;
            }
        };
        let stdout = JsonLineFilter::new(raw_stdout).compat();

        let (conn, io_task) = ClientSideConnection::new(
            client,
            stdin,  // outgoing: client writes to agent's stdin
            stdout, // incoming: client reads from agent's stdout
            |fut| {
                tokio::task::spawn_local(fut);
            },
        );

        // Wrap connection in Rc so prompt can run via spawn_local while
        // the command loop stays responsive for cancel/permission commands.
        let conn = Rc::new(conn);

        // Spawn the I/O task on the LocalSet
        tokio::task::spawn_local(async move {
            if let Err(e) = io_task.await {
                log::error!(target: "notesage::acp", "IO task error: {}", e);
            }
        });

        // Initialize handshake
        log::info!(target: "notesage::acp", "Sending ACP initialize for {}", agent_binary);
        let init_req = InitializeRequest::new(ProtocolVersion::V1).client_info(
            Implementation::new("Notesage", env!("CARGO_PKG_VERSION")),
        );

        // Store auth methods from init response for later use
        let auth_method_ids: Vec<(String, String, Option<String>)>;

        match conn.initialize(init_req).await {
            Ok(resp) => {
                log::info!(
                    target: "notesage::acp",
                    "ACP initialize succeeded for {}: agent={:?}, auth_methods={:?}",
                    agent_binary,
                    resp.agent_info.as_ref().map(|i| format!("{} {}", i.name, i.version)),
                    resp.auth_methods.iter().map(|m| format!("{}({})", m.id(), m.name())).collect::<Vec<_>>(),
                );
                auth_method_ids = resp
                    .auth_methods
                    .iter()
                    .map(|m| {
                        (
                            m.id().to_string(),
                            m.name().to_string(),
                            m.description().map(|s| s.to_string()),
                        )
                    })
                    .collect();

                let info = InitInfo {
                    agent_name: resp.agent_info.as_ref().map(|i| i.name.clone()),
                    agent_version: resp.agent_info.as_ref().map(|i| i.version.clone()),
                    auth_methods: auth_method_ids
                        .iter()
                        .map(|(id, name, desc)| AuthMethodInfo {
                            id: id.clone(),
                            name: name.clone(),
                            description: desc.clone(),
                        })
                        .collect(),
                };
                let _ = init_tx.send(Ok(info));
            }
            Err(e) => {
                let _ = init_tx.send(Err(format!("ACP initialize failed: {}", e)));
                let _ = child.kill().await;
                return;
            }
        }

        // Command loop — process commands from Tauri
        while let Some(cmd) = cmd_rx.recv().await {
            match cmd {
                AgentCmd::Authenticate { method_id, reply } => {
                    // Pick the method: explicit ID, or first available
                    let selected_id = match &method_id {
                        Some(id) => {
                            if auth_method_ids.iter().any(|(mid, _, _)| mid == id) {
                                id.clone()
                            } else {
                                let _ = reply.send(Err(format!(
                                    "Unknown auth method: {}",
                                    id
                                )));
                                continue;
                            }
                        }
                        None => {
                            match auth_method_ids.first() {
                                Some((id, _, _)) => id.clone(),
                                None => {
                                    let _ = reply.send(Err(
                                        "Agent has no authentication methods".to_string(),
                                    ));
                                    continue;
                                }
                            }
                        }
                    };

                    log::info!(
                        target: "notesage::acp",
                        "Calling conn.authenticate(method={}) for agent...",
                        selected_id,
                    );
                    let auth_req = AuthenticateRequest::new(AuthMethodId::new(
                        selected_id.clone(),
                    ));
                    match conn.authenticate(auth_req).await {
                        Ok(resp) => {
                            log::info!(
                                target: "notesage::acp",
                                "Authentication succeeded for method={}: {:?}",
                                selected_id, resp,
                            );
                            let _ = reply.send(Ok(AuthStatus {
                                authenticated: true,
                                method_id: Some(selected_id),
                            }));
                        }
                        Err(e) => {
                            log::error!(
                                target: "notesage::acp",
                                "Authentication failed for method={}: {}",
                                selected_id, e,
                            );
                            let _ = reply.send(Err(format!(
                                "Authentication failed: {}",
                                e
                            )));
                        }
                    }
                }
                AgentCmd::NewSession {
                    working_directory: cwd,
                    reply,
                } => {
                    let req = NewSessionRequest::new(PathBuf::from(cwd));
                    match conn.new_session(req).await {
                        Ok(resp) => {
                            let mut current_model = None;
                            let mut available_models = Vec::new();

                            if let Some(ref model_state) = resp.models {
                                current_model =
                                    Some(model_state.current_model_id.to_string());
                                available_models = model_state
                                    .available_models
                                    .iter()
                                    .map(|m| AgentModelInfo {
                                        model_id: m.model_id.to_string(),
                                        name: m.name.clone(),
                                        description: m.description.clone(),
                                    })
                                    .collect();
                            }

                            let _ = reply.send(Ok(SessionResult {
                                session_id: resp.session_id.to_string(),
                                current_model,
                                available_models,
                            }));
                        }
                        Err(e) => {
                            let _ =
                                reply.send(Err(format!("new_session failed: {}", e)));
                        }
                    }
                }
                AgentCmd::LoadSession {
                    session_id: sid,
                    working_directory: cwd,
                    reply,
                } => {
                    let req = LoadSessionRequest::new(
                        SessionId::new(sid.clone()),
                        PathBuf::from(cwd),
                    );
                    match conn.load_session(req).await {
                        Ok(resp) => {
                            let mut current_model = None;
                            let mut available_models = Vec::new();

                            if let Some(ref model_state) = resp.models {
                                current_model =
                                    Some(model_state.current_model_id.to_string());
                                available_models = model_state
                                    .available_models
                                    .iter()
                                    .map(|m| AgentModelInfo {
                                        model_id: m.model_id.to_string(),
                                        name: m.name.clone(),
                                        description: m.description.clone(),
                                    })
                                    .collect();
                            }

                            let _ = reply.send(Ok(SessionResult {
                                session_id: sid,
                                current_model,
                                available_models,
                            }));
                        }
                        Err(e) => {
                            let _ =
                                reply.send(Err(format!("load_session failed: {}", e)));
                        }
                    }
                }
                AgentCmd::Prompt {
                    session_id: sid,
                    content,
                    reply,
                } => {
                    // Run prompt in a spawn_local so the command loop remains
                    // responsive for Cancel and PermissionRespond commands
                    // while the agent processes the prompt.
                    let conn = Rc::clone(&conn);
                    tokio::task::spawn_local(async move {
                        let req = PromptRequest::new(
                            SessionId::new(sid),
                            vec![ContentBlock::Text(TextContent::new(content))],
                        );
                        match conn.prompt(req).await {
                            Ok(_) => {
                                let _ = reply.send(Ok(()));
                            }
                            Err(e) => {
                                let _ =
                                    reply.send(Err(format!("Prompt failed: {}", e)));
                            }
                        }
                    });
                }
                AgentCmd::Cancel {
                    session_id: sid,
                    reply,
                } => {
                    let req = CancelNotification::new(SessionId::new(sid));
                    match conn.cancel(req).await {
                        Ok(_) => {
                            let _ = reply.send(Ok(()));
                        }
                        Err(e) => {
                            let _ =
                                reply.send(Err(format!("Cancel failed: {}", e)));
                        }
                    }
                }
                AgentCmd::PermissionRespond {
                    request_id,
                    option_id,
                } => {
                    if let Some(tx) =
                        permission_waiters.borrow_mut().remove(&request_id)
                    {
                        let _ = tx.send(PermissionReply { option_id });
                    }
                }
                AgentCmd::Stop { reply } => {
                    // Clear any pending permission waiters so they cancel
                    permission_waiters.borrow_mut().clear();
                    let _ = child.kill().await;
                    let _ = reply.send(Ok(()));
                    break;
                }
            }
        }
    });

    // Clean up network proxy after agent thread exits
    if has_network_proxy {
        if let Some(cleanup_app) = proxy_cleanup_app {
            let proxy_state = cleanup_app.state::<super::network_proxy::NetworkProxyState>();
            // Use a temporary runtime since the thread's runtime is shutting down
            if let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                let iid = proxy_instance_id.clone();
                rt.block_on(async {
                    proxy_state.stop_proxy(&iid).await;
                    log::info!(target: "notesage::acp", "Cleaned up network proxy for {}", iid);
                });
            }
        }
    }

    // Unregister PID from sandbox violation monitor
    let pid = captured_pid.load(std::sync::atomic::Ordering::Relaxed);
    if sandbox_enabled && pid != 0 {
        if let Some(ref cleanup_app) = monitor_cleanup_app {
            let monitor_state = cleanup_app.state::<super::sandbox_monitor::SandboxMonitorState>();
            // Use try_lock since we're outside the tokio runtime
            if let Ok(mut pids) = monitor_state.agent_pids.try_lock() {
                pids.remove(&pid);
                log::info!(target: "notesage::acp", "Unregistered PID {} from sandbox monitoring", pid);
            };
        }
    }

    // Clean up sandbox profile temp file
    if sandbox_enabled {
        super::sandbox::cleanup_profile(&proxy_instance_id);
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Resolve the path to an ACP agent binary.
/// Checks: 1) system PATH via `which`, 2) common install locations
/// (Homebrew, npm global, pnpm, nvm, ~/.local/bin), 3) bundled node_modules/.bin/.
///
/// macOS GUI apps (launched from Finder/Dock) inherit a minimal PATH that does
/// not include user-installed directories, so we must check common locations
/// explicitly as fallback.
fn resolve_agent_binary(agent_id: &str, app: &AppHandle) -> Option<String> {
    // 0. Check managed install directory (~/.notesage/agents/bin/)
    let managed_bin = dirs::home_dir()
        .unwrap_or_default()
        .join(".notesage/agents/bin")
        .join(agent_id);
    if managed_bin.exists() {
        return Some(managed_bin.to_string_lossy().to_string());
    }

    // 1. Check PATH via `which` — use login shell PATH if available
    //    (macOS GUI apps have a minimal inherited PATH)
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let mut cmd = Command::new(which_cmd);
    cmd.arg(agent_id);
    if let Some(path) = get_shell_path() {
        cmd.env("PATH", path);
    }
    if let Ok(output) = cmd.output() {
        if output.status.success() {
            let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !p.is_empty() {
                return Some(p);
            }
        }
    }

    // 2. Check common install locations (needed for production macOS GUI apps)
    let home = dirs::home_dir().unwrap_or_default();
    let mut candidates: Vec<PathBuf> = vec![
        // ~/.local/bin (Claude Code, pipx, etc.)
        home.join(".local/bin").join(agent_id),
    ];
    // macOS Homebrew paths
    for path in constants::MACOS_FALLBACK_BIN_PATHS {
        candidates.push(PathBuf::from(path).join(agent_id));
    }
    candidates.extend([
        // npm global (default prefix)
        home.join(".npm-global/bin").join(agent_id),
        // pnpm global (macOS)
        home.join("Library/pnpm").join(agent_id),
        // pnpm global (Linux)
        home.join(".local/share/pnpm").join(agent_id),
        // Volta
        home.join(".volta/bin").join(agent_id),
        // Cargo
        home.join(".cargo/bin").join(agent_id),
    ]);

    // nvm: scan for node versions
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            for entry in entries.flatten() {
                candidates.push(entry.path().join("bin").join(agent_id));
            }
        }
    }

    // 3. Tauri resource path (for future sidecar bundling)
    candidates.push(
        app.path()
            .resource_dir()
            .unwrap_or_default()
            .join("node_modules/.bin")
            .join(agent_id),
    );

    // 4. npm global prefix paths (covers non-standard npm configurations)
    //    `npm root -g` typically resolves to <prefix>/lib/node_modules
    //    and binaries are linked in <prefix>/bin — already covered above,
    //    but some setups put bins directly in the node_modules/.bin.
    for path in constants::MACOS_FALLBACK_NODE_MODULE_PATHS {
        candidates.push(PathBuf::from(path).join(agent_id));
    }

    for candidate in &candidates {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    None
}

/// Resolve a CLI binary by name, checking common install locations.
/// Used by `check_agent_auth` to find the underlying CLI that manages auth
/// (e.g., `claude`, `codex`, `copilot`) which may differ from the ACP adapter binary.
fn resolve_cli_binary(name: &str) -> Option<String> {
    // Try PATH via `which` — use login shell PATH if available
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let mut cmd = Command::new(which_cmd);
    cmd.arg(name);
    if let Some(path) = get_shell_path() {
        cmd.env("PATH", path);
    }
    if let Ok(output) = cmd.output() {
        if output.status.success() {
            let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !p.is_empty() {
                return Some(p);
            }
        }
    }

    // Fallback: check common install locations (macOS GUI apps have minimal PATH)
    let home = dirs::home_dir().unwrap_or_default();
    let mut candidates: Vec<PathBuf> = vec![
        home.join(".local/bin").join(name),
    ];
    for path in constants::MACOS_FALLBACK_BIN_PATHS {
        candidates.push(PathBuf::from(path).join(name));
    }
    candidates.extend([
        home.join(".npm-global/bin").join(name),
        home.join("Library/pnpm").join(name),
        home.join(".local/share/pnpm").join(name),
        home.join(".volta/bin").join(name),
        home.join(".cargo/bin").join(name),
    ]);

    for candidate in &candidates {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    None
}

/// Check the auth status of the underlying CLI tool for an ACP agent.
/// For claude-agent-acp, checks `claude auth status` since the adapter
/// uses Claude Code's stored credentials internally.
fn check_agent_auth(agent_id: &str) -> Option<bool> {
    // Map agent adapter binary → underlying CLI that manages auth
    match agent_id {
        "claude-agent-acp" => {
            let cli = resolve_cli_binary("claude")?;
            match Command::new(&cli).args(["auth", "status"]).output() {
                Ok(output) if output.status.success() => {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    Some(stdout.contains("\"loggedIn\": true") || stdout.contains("\"loggedIn\":true"))
                }
                _ => None,
            }
        }
        "codex-acp" | "codex" => {
            let cli = resolve_cli_binary("codex")?;
            match Command::new(&cli).args(["auth", "status"]).output() {
                Ok(output) if output.status.success() => {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    Some(stdout.contains("\"loggedIn\": true") || stdout.contains("\"loggedIn\":true")
                        || stdout.contains("authenticated"))
                }
                _ => None,
            }
        }
        "copilot" => {
            let cli = resolve_cli_binary("copilot")?;
            match Command::new(&cli).args(["auth", "status"]).output() {
                Ok(output) if output.status.success() => {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    Some(stdout.contains("Logged in") || stdout.contains("authenticated")
                        || stdout.contains("\"loggedIn\": true") || stdout.contains("\"loggedIn\":true"))
                }
                _ => None,
            }
        }
        "gemini" => {
            // Check GEMINI_API_KEY env var first
            if std::env::var("GEMINI_API_KEY").map(|v| !v.is_empty()).unwrap_or(false) {
                return Some(true);
            }

            let home = dirs::home_dir().unwrap_or_default();

            // Gemini CLI stores the selected auth type in ~/.gemini/settings.json
            // at the path: security.auth.selectedType
            // Valid values: "login_with_google", "use_gemini", "use_vertex_ai", "gateway"
            let settings = home.join(".gemini/settings.json");
            if settings.exists() {
                if let Ok(content) = std::fs::read_to_string(&settings) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        let selected_type = json
                            .get("security")
                            .and_then(|s| s.get("auth"))
                            .and_then(|a| a.get("selectedType"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if !selected_type.is_empty() {
                            // For OAuth ("login_with_google"), also verify cached credentials exist
                            if selected_type == "login_with_google" {
                                // Check for cached OAuth credentials file in ~/.gemini/
                                let creds_exist = home.join(".gemini/google_oauth_credentials.json").exists()
                                    || home.join(".gemini/oauth_credentials.json").exists()
                                    || home.join(".gemini/credentials.json").exists();
                                return Some(creds_exist);
                            }
                            // For API key or Vertex AI, selectedType being set means configured
                            return Some(true);
                        }
                    }
                }
            }

            // No settings file or no selectedType → not authenticated
            Some(false)
        }
        _ => None,
    }
}

/// Check whether an ACP agent binary is installed on the system.
#[tauri::command]
pub async fn acp_agent_check_availability(
    app: AppHandle,
    agent_id: String,
) -> Result<AgentAvailability, String> {
    let path = resolve_agent_binary(&agent_id, &app);

    if path.is_none() {
        return Ok(AgentAvailability {
            installed: false,
            path: None,
            version: None,
            authenticated: None,
        });
    }

    let binary = path.as_deref().unwrap();
    let version = match Command::new(binary).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let v = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();
            if v.is_empty() {
                None
            } else {
                Some(v)
            }
        }
        _ => None,
    };

    let authenticated = check_agent_auth(&agent_id);

    Ok(AgentAvailability {
        installed: true,
        path,
        version,
        authenticated,
    })
}

/// Spawn an ACP agent subprocess, initialize the connection, and return an instance ID.
#[tauri::command]
pub async fn acp_agent_spawn(
    app: AppHandle,
    state: State<'_, AcpState>,
    network_proxy_state: State<'_, super::network_proxy::NetworkProxyState>,
    agent_binary: String,
    agent_args: Option<Vec<String>>,
    role: AgentRole,
    working_directory: String,
    env_vars: Option<HashMap<String, String>>,
    sandbox_enabled: Option<bool>,
    sandbox_paths: Option<Vec<String>>,
    network_sandbox_enabled: Option<bool>,
    network_allowed_domains: Option<Vec<String>>,
    kernel_network_deny: Option<bool>,
) -> Result<SpawnResult, String> {
    let mut env = env_vars.unwrap_or_default();
    let args = agent_args.unwrap_or_default();

    // Resolve the actual binary path (system PATH or bundled node_modules)
    let resolved_binary = resolve_agent_binary(&agent_binary, &app)
        .ok_or_else(|| format!("Agent binary '{}' not found", agent_binary))?;

    // Determine sandbox policy: explicit override, or default based on binary source
    let sandbox = sandbox_enabled
        .unwrap_or_else(|| super::sandbox::should_sandbox_by_default(&resolved_binary));

    // Writable paths: explicit list, or fall back to [working_directory]
    let writable_paths = sandbox_paths
        .unwrap_or_else(|| vec![working_directory.clone()]);

    // Generate instance ID before spawning so the thread can use it for events
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let instance_id = format!(
        "acp-{}-{}",
        ts,
        &format!("{:x}", ts.wrapping_mul(6364136223846793005).wrapping_add(1))[..8]
    );

    // Start network proxy if network sandboxing is enabled (requires filesystem sandbox)
    let network_config = if sandbox && network_sandbox_enabled.unwrap_or(false) {
        let domains = network_allowed_domains
            .unwrap_or_else(|| super::network_proxy::default_allowed_domains(&agent_binary));

        match network_proxy_state
            .start_proxy(&instance_id, &agent_binary, domains, app.clone())
            .await
        {
            Ok(config) => {
                // Inject proxy env vars into the agent's environment
                let proxy_url = format!("http://{}", config.proxy_addr);
                env.insert("HTTP_PROXY".to_string(), proxy_url.clone());
                env.insert("HTTPS_PROXY".to_string(), proxy_url.clone());
                env.insert("http_proxy".to_string(), format!("http://{}", config.proxy_addr));
                env.insert("https_proxy".to_string(), format!("http://{}", config.proxy_addr));
                env.insert("NO_PROXY".to_string(), "localhost,127.0.0.1".to_string());
                env.insert("no_proxy".to_string(), "localhost,127.0.0.1".to_string());
                log::info!(target: "notesage::acp",
                    "Network proxy started for {} at {}",
                    agent_binary, config.proxy_addr
                );
                Some(config)
            }
            Err(e) => {
                log::warn!(target: "notesage::acp",
                    "Failed to start network proxy for {}: {} — spawning without network sandbox",
                    agent_binary, e
                );
                None
            }
        }
    } else {
        None
    };

    let has_network_sandbox = network_config.is_some();

    let (init_tx, init_rx) = oneshot::channel();
    let (cmd_tx, cmd_rx) = mpsc::channel(32);

    let binary = resolved_binary;
    let cwd = working_directory.clone();
    let iid = instance_id.clone();
    let spawn_args = args;

    let thread_handle = std::thread::Builder::new()
        .name(format!("acp-{}", &binary))
        .spawn(move || {
            let knd = kernel_network_deny.unwrap_or(false);
            run_agent_thread(app, iid, binary, spawn_args, cwd, env, sandbox, writable_paths, network_config, knd, cmd_rx, init_tx);
        })
        .map_err(|e| format!("Failed to spawn agent thread: {}", e))?;

    // Wait for initialization result from the agent thread (30s timeout)
    let init_result = tokio::time::timeout(std::time::Duration::from_secs(30), init_rx)
        .await
        .map_err(|_| {
            // Timeout — kill the agent thread
            let _ = cmd_tx.try_send(AgentCmd::Stop {
                reply: oneshot::channel().0,
            });
            "ACP initialize timed out after 30s — the agent binary may not support ACP".to_string()
        })?
        .map_err(|_| "Agent thread exited unexpectedly during initialization".to_string())?;
    let init_info = init_result?;

    let handle = AgentHandle {
        role,
        agent_binary,
        working_directory,
        cmd_tx,
        thread_handle: Some(thread_handle),
    };

    state
        .agents
        .lock()
        .await
        .insert(instance_id.clone(), handle);

    Ok(SpawnResult {
        instance_id,
        agent_name: init_info.agent_name,
        agent_version: init_info.agent_version,
        auth_methods: init_info.auth_methods,
        sandbox_enabled: sandbox,
        network_sandbox_enabled: has_network_sandbox,
    })
}

/// Authenticate with an ACP agent.
/// If `method_id` is None, uses the first available auth method from the agent.
#[tauri::command]
pub async fn acp_agent_authenticate(
    state: State<'_, AcpState>,
    instance_id: String,
    method_id: Option<String>,
) -> Result<AuthStatus, String> {
    let agents = state.agents.lock().await;
    let handle = agents
        .get(&instance_id)
        .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;

    let (reply_tx, reply_rx) = oneshot::channel();

    handle
        .cmd_tx
        .send(AgentCmd::Authenticate {
            method_id,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    // Drop lock before awaiting reply to avoid holding it during auth
    drop(agents);

    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to authenticate".to_string())?
}

/// Check if an ACP agent instance is still registered (lightweight map lookup).
#[tauri::command]
pub async fn acp_agent_exists(
    state: State<'_, AcpState>,
    instance_id: String,
) -> Result<bool, String> {
    Ok(state.agents.lock().await.contains_key(&instance_id))
}

/// Stop an ACP agent subprocess and clean up resources.
#[tauri::command]
pub async fn acp_agent_stop(
    state: State<'_, AcpState>,
    instance_id: String,
) -> Result<(), String> {
    let mut agents = state.agents.lock().await;
    let mut handle = agents
        .remove(&instance_id)
        .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;

    let (reply_tx, reply_rx) = oneshot::channel();

    // Send stop command to the agent thread
    handle
        .cmd_tx
        .send(AgentCmd::Stop { reply: reply_tx })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    // Wait for stop confirmation
    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to stop".to_string())??;

    // Wait for the OS thread to finish
    if let Some(th) = handle.thread_handle.take() {
        let _ = th.join();
    }

    Ok(())
}

/// Create a new ACP session.
#[tauri::command]
pub async fn acp_session_new(
    state: State<'_, AcpState>,
    instance_id: String,
    working_directory: String,
) -> Result<SessionResult, String> {
    let agents = state.agents.lock().await;
    let handle = agents
        .get(&instance_id)
        .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;

    let (reply_tx, reply_rx) = oneshot::channel();

    handle
        .cmd_tx
        .send(AgentCmd::NewSession {
            working_directory,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    drop(agents);

    let result = reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to new_session".to_string())??;

    Ok(result)
}

/// Load an existing ACP session.
#[tauri::command]
pub async fn acp_session_load(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    working_directory: String,
) -> Result<SessionResult, String> {
    let agents = state.agents.lock().await;
    let handle = agents
        .get(&instance_id)
        .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;

    let (reply_tx, reply_rx) = oneshot::channel();

    handle
        .cmd_tx
        .send(AgentCmd::LoadSession {
            session_id,
            working_directory,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    drop(agents);

    let result = reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to load_session".to_string())??;

    Ok(result)
}

/// Send a prompt to an ACP session. Blocks until the agent completes the turn.
/// Session updates are emitted as `acp-session-update` Tauri events.
/// Permission requests are emitted as `acp-permission-request` events.
#[tauri::command]
pub async fn acp_session_prompt(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    content: String,
) -> Result<(), String> {
    let agents = state.agents.lock().await;
    let handle = agents
        .get(&instance_id)
        .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;

    let (reply_tx, reply_rx) = oneshot::channel();

    handle
        .cmd_tx
        .send(AgentCmd::Prompt {
            session_id,
            content,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    drop(agents);

    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to prompt".to_string())?
}

/// Cancel the current prompt in an ACP session.
#[tauri::command]
pub async fn acp_session_cancel(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
) -> Result<(), String> {
    let agents = state.agents.lock().await;
    let handle = agents
        .get(&instance_id)
        .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;

    let (reply_tx, reply_rx) = oneshot::channel();

    handle
        .cmd_tx
        .send(AgentCmd::Cancel {
            session_id,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    drop(agents);

    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to cancel".to_string())?
}

/// Respond to a permission request from an ACP agent.
/// Pass `option_id: None` to cancel the permission request.
#[tauri::command]
pub async fn acp_permission_respond(
    state: State<'_, AcpState>,
    instance_id: String,
    request_id: String,
    option_id: Option<String>,
) -> Result<(), String> {
    let agents = state.agents.lock().await;
    let handle = agents
        .get(&instance_id)
        .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;

    handle
        .cmd_tx
        .send(AgentCmd::PermissionRespond {
            request_id,
            option_id,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    Ok(())
}
