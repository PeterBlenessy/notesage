use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, oneshot, Mutex};

use super::acp_binary::{resolve_absolute_binary, resolve_agent_binary};
use super::acp_client::{ClientContext, InitInfo, JsonLineFilter, PermissionReply, PermissionWaiters};
use super::shell_path::get_shell_path;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct AgentExitedPayload {
    #[serde(rename = "instanceId")]
    instance_id: String,
    #[serde(rename = "exitCode")]
    exit_code: Option<i32>,
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
    pub supports_images: bool,
    /// AgentCapabilities from the initialize response (passed as JSON to frontend)
    pub capabilities: Option<serde_json::Value>,
}

/// Variant-aware auth method descriptor forwarded to the frontend.
///
/// Mirrors ACP's `AuthMethod` enum (see `agent-client-protocol-schema::agent::AuthMethod`)
/// with the `unstable_auth_methods` feature enabled. The `EnvVar` variant carries the
/// list of environment variables the client must collect from the user, plus an optional
/// link to the credentials page.
///
/// Serialized as an externally-tagged discriminated union via `#[serde(tag = "type")]`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthMethodInfo {
    /// Agent handles authentication internally (OAuth, keychain, etc.).
    /// This is the default when ACP doesn't specify a `type`.
    Agent {
        id: String,
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
    /// User supplies env var values; client passes them via environment at spawn time.
    EnvVar {
        id: String,
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        vars: Vec<AuthEnvVar>,
        #[serde(skip_serializing_if = "Option::is_none")]
        link: Option<String>,
    },
}

impl AuthMethodInfo {
    pub fn id(&self) -> &str {
        match self {
            AuthMethodInfo::Agent { id, .. } => id,
            AuthMethodInfo::EnvVar { id, .. } => id,
        }
    }
}

/// Environment variable descriptor for `AuthMethodInfo::EnvVar`.
///
/// Mirrors ACP's `AuthEnvVar`. `secret` defaults to true (password-style input);
/// `optional` defaults to false.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuthEnvVar {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub secret: bool,
    pub optional: bool,
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
    /// Session modes (passed as JSON to frontend)
    pub modes: Option<serde_json::Value>,
    /// Session config options (passed as JSON to frontend)
    pub config_options: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AcpSessionInfo {
    pub session_id: String,
    pub cwd: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AcpListResult {
    pub sessions: Vec<AcpSessionInfo>,
    pub next_cursor: Option<String>,
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

            // SIGKILL the child process directly via PID — don't rely on the
            // command channel which may be stuck on a blocked prompt.
            let pid = handle.child_pid.load(std::sync::atomic::Ordering::Relaxed);
            if pid != 0 {
                unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL); }
                log::info!(target: "notesage::acp", "Sent SIGKILL to agent PID {}", pid);
            }

            // Drop the channel sender to unblock any pending recv()
            drop(handle.cmd_tx);

            // 500ms thread join timeout — if stuck, abandon (OS cleans up on exit)
            if let Some(th) = handle.thread_handle.take() {
                let (done_tx, done_rx) = std::sync::mpsc::channel();
                let join_thread = std::thread::spawn(move || {
                    let _ = th.join();
                    let _ = done_tx.send(());
                });
                match done_rx.recv_timeout(std::time::Duration::from_millis(500)) {
                    Ok(_) => {
                        let _ = join_thread.join();
                    }
                    Err(_) => {
                        log::warn!(target: "notesage::acp", "Agent thread {} did not exit within 500ms, abandoning", instance_id);
                    }
                }
            }
        }
    }

    /// Check liveness of all ACP agent processes.
    pub async fn check_processes(&self) -> Vec<super::health::ProcessStatus> {
        let agents = self.agents.lock().await;
        agents
            .iter()
            .map(|(id, handle)| {
                let alive = handle
                    .thread_handle
                    .as_ref()
                    .map(|th| !th.is_finished())
                    .unwrap_or(false);
                let pid = handle.child_pid.load(std::sync::atomic::Ordering::Relaxed);
                super::health::ProcessStatus {
                    name: id.clone(),
                    alive,
                    pid: if pid != 0 { Some(pid) } else { None },
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
    agent_binary: String,
    working_directory: String,
    /// Child process PID — written by agent thread after spawn, readable from any thread.
    /// Used by recovery and shutdown flows to SIGKILL the subprocess directly.
    child_pid: std::sync::Arc<std::sync::atomic::AtomicU32>,
    cmd_tx: mpsc::Sender<AgentCmd>,
    thread_handle: Option<std::thread::JoinHandle<()>>,
    // --- Spawn config (stored for reconnection) ---
    agent_args: Vec<String>,
    env_vars: HashMap<String, String>,
    sandbox_enabled: bool,
    sandbox_writable_paths: Vec<String>,
    network_sandbox_enabled: bool,
    network_allowed_domains: Option<Vec<String>>,
    kernel_network_deny: bool,
    /// Whether the agent supports image content (from promptCapabilities)
    supports_images: bool,
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
        images: Option<Vec<super::ai::ImageData>>,
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
    SetMode {
        session_id: String,
        mode_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    SetConfigOption {
        session_id: String,
        option_id: String,
        value_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    CloseSession {
        session_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    ListSessions {
        cwd: Option<String>,
        cursor: Option<String>,
        reply: oneshot::Sender<Result<AcpListResult, String>>,
    },
    ResumeSession {
        session_id: String,
        working_directory: String,
        reply: oneshot::Sender<Result<SessionResult, String>>,
    },
    ForkSession {
        session_id: String,
        working_directory: String,
        reply: oneshot::Sender<Result<SessionResult, String>>,
    },
    Stop {
        reply: oneshot::Sender<Result<(), String>>,
    },
}


// ---------------------------------------------------------------------------
// Session response helpers
// ---------------------------------------------------------------------------

/// Derive `(current_model, available_models)` from a session response's config
/// options.
///
/// ACP 0.14 removed the dedicated session-model API (`SessionModelState`,
/// `session/set_model`); the stable replacement is the config option whose
/// `category` is `Model`. Agents without such an option simply have no model
/// selector — `(None, [])` is returned rather than an error.
fn extract_model_info(
    config_options: Option<&Vec<agent_client_protocol::schema::SessionConfigOption>>,
) -> (Option<String>, Vec<AgentModelInfo>) {
    use agent_client_protocol::schema::{
        SessionConfigKind, SessionConfigOptionCategory, SessionConfigSelectOption,
        SessionConfigSelectOptions,
    };

    let model_option = config_options
        .into_iter()
        .flatten()
        .find(|opt| opt.category == Some(SessionConfigOptionCategory::Model));

    let Some(option) = model_option else {
        return (None, Vec::new());
    };

    let to_info = |o: &SessionConfigSelectOption| AgentModelInfo {
        model_id: o.value.to_string(),
        name: o.name.clone(),
        description: o.description.clone(),
    };

    match &option.kind {
        SessionConfigKind::Select(select) => {
            let current_model = Some(select.current_value.to_string());
            let available_models = match &select.options {
                SessionConfigSelectOptions::Ungrouped(opts) => {
                    opts.iter().map(to_info).collect()
                }
                SessionConfigSelectOptions::Grouped(groups) => groups
                    .iter()
                    .flat_map(|g| g.options.iter())
                    .map(to_info)
                    .collect(),
                // Non-exhaustive upstream enum — unknown layouts yield no list.
                _ => Vec::new(),
            };
            (current_model, available_models)
        }
        // Future / non-select option kinds carry no model list to surface.
        _ => (None, Vec::new()),
    }
}

// ---------------------------------------------------------------------------
// Agent thread: owns the (now Send) ConnectionTo<Agent>
// ---------------------------------------------------------------------------

/// How many trailing stderr lines to retain for error reporting.
const STDERR_TAIL_LINES: usize = 12;

/// Render the retained stderr tail as an error-message suffix (empty when the
/// agent wrote nothing). Mirrors the `mcp_validate_server` stderr_tail pattern:
/// a failing agent's own output must reach the user, not just the app log.
fn stderr_tail_suffix(tail: &StdMutex<std::collections::VecDeque<String>>) -> String {
    let lines: Vec<String> = match tail.lock() {
        Ok(t) => t.iter().cloned().collect(),
        Err(_) => return String::new(),
    };
    if lines.is_empty() {
        return String::new();
    }
    format!("\nAgent stderr (last {} lines):\n{}", lines.len(), lines.join("\n"))
}

/// Runs on a dedicated OS thread with a single-threaded tokio runtime.
///
/// As of agent-client-protocol 0.12 the connection handle (`ConnectionTo<Agent>`)
/// is `Send + Clone`, so the old `!Send` `LocalSet` isolation is no longer
/// required. We still run on a dedicated OS thread so that `AgentHandle` can hold
/// a `std::thread::JoinHandle` (used by liveness checks and `stop_all_sync`), and
/// so the child process / cleanup all live on one runtime. A `current_thread`
/// runtime is sufficient.
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
    cmd_rx: mpsc::Receiver<AgentCmd>,
    init_tx: oneshot::Sender<Result<InitInfo, String>>,
    // Shared PID cell — written after spawn, readable from AgentHandle for SIGKILL
    captured_pid: std::sync::Arc<std::sync::atomic::AtomicU32>,
) {
    use agent_client_protocol::schema::*;
    use agent_client_protocol::{ByteStreams, ConnectionTo};
    use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

    // Clone for cleanup after the command loop exits
    let proxy_instance_id = instance_id.clone();
    let has_network_proxy = network_config.is_some();
    let proxy_cleanup_app = if has_network_proxy { Some(app.clone()) } else { None };
    let monitor_cleanup_app = if sandbox_enabled { Some(app.clone()) } else { None };
    let captured_pid_inner = std::sync::Arc::clone(&captured_pid);

    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            let _ = init_tx.send(Err(format!("Failed to create tokio runtime: {e}")));
            return;
        }
    };

    rt.block_on(async move {
        // Flag to distinguish intentional Stop from unexpected process exit
        let stopped_intentionally = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        // Ring buffer of the agent's most recent stderr lines — appended to
        // spawn/initialize error messages so binaries that crash on startup
        // (wrong args, missing config, not actually an ACP agent) surface
        // their own diagnostics to the frontend.
        let stderr_tail: Arc<StdMutex<std::collections::VecDeque<String>>> =
            Arc::new(StdMutex::new(std::collections::VecDeque::new()));

        // Shared permission waiters for inbound handler ↔ command loop communication.
        // Send + Sync now that the connection is Send.
        let permission_waiters: PermissionWaiters =
            Arc::new(StdMutex::new(HashMap::new()));

        let sandbox_instance_id = instance_id.clone();
        let exit_app = app.clone();
        let exit_instance_id = instance_id.clone();
        // Context shared into the inbound ACP handlers (permission + session update).
        let client_ctx =
            ClientContext::new(app.clone(), instance_id.clone(), Arc::clone(&permission_waiters));
        // Used for sandbox-monitor registration before the connection is built.
        let monitor_app = app.clone();

        // Spawn agent process — optionally wrapped in OS-level sandbox
        // Inject login shell PATH so the agent (and child processes) can find tools
        let mut spawn_cmd = if sandbox_enabled {
            match super::sandbox::sandboxed_command(&sandbox_instance_id, &agent_binary, &sandbox_writable_paths, network_config.as_ref(), kernel_network_deny) {
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

        // Always capture PID for recovery/shutdown SIGKILL
        if let Some(pid) = child.id() {
            captured_pid_inner.store(pid, std::sync::atomic::Ordering::Relaxed);

            // Register PID for sandbox violation monitoring (if sandboxed)
            if sandbox_enabled {
                #[cfg(target_os = "macos")]
                {
                    let monitor_state = monitor_app.state::<super::sandbox_monitor::SandboxMonitorState>();
                    monitor_state.register_and_start(
                        &monitor_app,
                        sandbox_instance_id.clone(),
                        agent_binary.clone(),
                        pid,
                    ).await;
                    log::info!(target: "notesage::acp", "Registered PID {} for sandbox monitoring", pid);
                }
            }
        }

        // Pre-send "Y\n" ONLY for Gemini CLI which prompts for confirmation
        // before entering ACP mode ("Do you want to continue? [Y/n]:").
        // Other agents (claude-agent-acp, codex-acp, copilot) speak JSON-RPC
        // immediately — sending "Y\n" corrupts their protocol stream.
        if agent_binary.contains("gemini") {
            use tokio::io::AsyncWriteExt;
            if let Some(ref mut stdin_handle) = child.stdin {
                log::info!(target: "notesage::acp", "Sending confirmation 'Y' to {} (Gemini CLI workaround)", agent_binary);
                let _ = stdin_handle.write_all(b"Y\n").await;
                let _ = stdin_handle.flush().await;
            }
        }

        // Spawn a task to read and log stderr from the agent process.
        // Plain `spawn` (not `spawn_local`): the runtime is a bare
        // `new_current_thread` with no `LocalSet`, and the captured values
        // (`String` + `ChildStderr`) are `Send`.
        if let Some(stderr) = child.stderr.take() {
            let stderr_binary = agent_binary.clone();
            let tail = Arc::clone(&stderr_tail);
            tokio::task::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    log::info!(target: "notesage::acp", "[{}:stderr] {}", stderr_binary, line);
                    if let Ok(mut t) = tail.lock() {
                        if t.len() == STDERR_TAIL_LINES {
                            t.pop_front();
                        }
                        t.push_back(line);
                    }
                }
            });
        }

        // Bridge tokio IO → futures IO for ACP.
        // Wrap stdout in a filter that strips non-JSON lines — some agents
        // (e.g., Gemini CLI) write interactive prompts to stdout in ACP mode.
        let stdin = match child.stdin.take() {
            Some(s) => s.compat_write(),
            None => {
                let _ = init_tx.send(Err(format!(
                    "Failed to acquire agent stdin pipe{}",
                    stderr_tail_suffix(&stderr_tail)
                )));
                return;
            }
        };
        let raw_stdout = match child.stdout.take() {
            Some(s) => s,
            None => {
                let _ = init_tx.send(Err(format!(
                    "Failed to acquire agent stdout pipe{}",
                    stderr_tail_suffix(&stderr_tail)
                )));
                return;
            }
        };
        let stdout = JsonLineFilter::new(raw_stdout).compat();

        // Transport: the child's stdio. `ByteStreams::new(outgoing_write, incoming_read)`
        // — we write to the agent's stdin and read from its (filtered) stdout.
        let transport = ByteStreams::new(stdin, stdout);

        // Inbound handler context, cloned into each registered handler closure.
        let notif_ctx = client_ctx.clone();
        let perm_ctx = client_ctx.clone();

        // The command loop and initialize handshake live inside `connect_with`'s
        // closure — the future returned by `connect_with` drives the connection for
        // the closure's lifetime, then shuts it down when the closure returns.
        let stopped_for_loop = std::sync::Arc::clone(&stopped_intentionally);
        let loop_binary = agent_binary.clone();
        let perm_waiters_loop = Arc::clone(&permission_waiters);
        let stderr_tail_loop = Arc::clone(&stderr_tail);

        let connect_result = agent_client_protocol::Client
            .builder()
            .name(format!("notesage-acp:{}", agent_binary))
            // Inbound: session updates → `acp-session-update` Tauri event.
            .on_receive_notification(
                move |notification: SessionNotification, _cx: ConnectionTo<agent_client_protocol::Agent>| {
                    let ctx = notif_ctx.clone();
                    async move {
                        ctx.emit_session_update(&notification);
                        Ok(())
                    }
                },
                agent_client_protocol::on_receive_notification!(),
            )
            // Inbound: permission requests → `acp-permission-request` event + await user.
            // The round-trip to the user must not block the event loop, so the wait +
            // response is offloaded to `cx.spawn`.
            .on_receive_request(
                move |request: RequestPermissionRequest,
                      responder: agent_client_protocol::Responder<RequestPermissionResponse>,
                      cx: ConnectionTo<agent_client_protocol::Agent>| {
                    let ctx = perm_ctx.clone();
                    async move {
                        let rx = ctx.begin_permission_request(&request);
                        cx.spawn(async move {
                            let outcome = match rx.await {
                                Ok(reply) => match reply.option_id {
                                    Some(oid) => RequestPermissionOutcome::Selected(
                                        SelectedPermissionOutcome::new(PermissionOptionId::new(oid)),
                                    ),
                                    None => RequestPermissionOutcome::Cancelled,
                                },
                                // Waiter dropped (agent stopped / cancelled) — cancel.
                                Err(_) => RequestPermissionOutcome::Cancelled,
                            };
                            responder.respond(RequestPermissionResponse::new(outcome))?;
                            Ok(())
                        })?;
                        Ok(())
                    }
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_with(transport, async move |conn: ConnectionTo<agent_client_protocol::Agent>| {
                // Initialize handshake
                log::info!(target: "notesage::acp", "Sending ACP initialize for {}", loop_binary);
                let init_req = InitializeRequest::new(ProtocolVersion::V1).client_info(
                    Implementation::new("Notesage", env!("CARGO_PKG_VERSION")),
                );

                // Store auth methods from init response for later use — variant-aware so the
                // authenticate command can look up EnvVar vs Agent methods without a second
                // round-trip to the agent.
                let auth_methods_info: Vec<AuthMethodInfo>;

                match conn.send_request(init_req).block_task().await {
                    Ok(resp) => {
                        log::info!(
                            target: "notesage::acp",
                            "ACP initialize succeeded for {}: agent={:?}, auth_methods={:?}",
                            loop_binary,
                            resp.agent_info.as_ref().map(|i| format!("{} {}", i.name, i.version)),
                            resp.auth_methods.iter().map(|m| format!("{}({})", m.id(), m.name())).collect::<Vec<_>>(),
                        );
                        auth_methods_info = resp
                            .auth_methods
                            .iter()
                            .map(|m| match m {
                                AuthMethod::EnvVar(e) => AuthMethodInfo::EnvVar {
                                    id: e.id.to_string(),
                                    name: e.name.clone(),
                                    description: e.description.clone(),
                                    vars: e
                                        .vars
                                        .iter()
                                        .map(|v| super::acp::AuthEnvVar {
                                            name: v.name.clone(),
                                            label: v.label.clone(),
                                            secret: v.secret,
                                            optional: v.optional,
                                        })
                                        .collect(),
                                    link: e.link.clone(),
                                },
                                AuthMethod::Terminal(_) => {
                                    // Terminal variant support is Batch F territory — surface it as
                                    // a plain `Agent`-style info block so the UI still shows the ID/name.
                                    AuthMethodInfo::Agent {
                                        id: m.id().to_string(),
                                        name: m.name().to_string(),
                                        description: m.description().map(|s| s.to_string()),
                                    }
                                }
                                AuthMethod::Agent(_) => AuthMethodInfo::Agent {
                                    id: m.id().to_string(),
                                    name: m.name().to_string(),
                                    description: m.description().map(|s| s.to_string()),
                                },
                                // Non-exhaustive guard: any future ACP variant surfaces as Agent.
                                _ => AuthMethodInfo::Agent {
                                    id: m.id().to_string(),
                                    name: m.name().to_string(),
                                    description: m.description().map(|s| s.to_string()),
                                },
                            })
                            .collect();

                        let supports_images_flag = resp.agent_capabilities.prompt_capabilities.image;
                        log::info!(
                            target: "notesage::acp",
                            "Agent {} supports_images={}",
                            loop_binary, supports_images_flag,
                        );
                        let capabilities_json = serde_json::to_value(&resp.agent_capabilities).ok();
                        let info = InitInfo {
                            agent_name: resp.agent_info.as_ref().map(|i| i.name.clone()),
                            agent_version: resp.agent_info.as_ref().map(|i| i.version.clone()),
                            auth_methods: auth_methods_info.clone(),
                            supports_images: supports_images_flag,
                            capabilities: capabilities_json,
                        };
                        let _ = init_tx.send(Ok(info));
                    }
                    Err(e) => {
                        // Brief drain window: an agent that crashed mid-handshake is
                        // typically still flushing its final stderr lines when the
                        // request errors — give the reader task a beat to catch them.
                        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                        let _ = init_tx.send(Err(format!(
                            "ACP initialize failed: {}{}",
                            e,
                            stderr_tail_suffix(&stderr_tail_loop)
                        )));
                        let _ = child.kill().await;
                        return Ok(());
                    }
                }

                // Bind the moved values so the existing command-loop body compiles
                // unchanged (it references these names).
                let agent_binary = loop_binary;
                let permission_waiters = perm_waiters_loop;
                let stopped_intentionally = stopped_for_loop;
                let mut cmd_rx = cmd_rx;

                // Command loop — process commands from Tauri
                while let Some(cmd) = cmd_rx.recv().await {
            match cmd {
                AgentCmd::Authenticate { method_id, reply } => {
                    // If agent has no auth methods, it handles auth internally
                    // (e.g., claude-agent-acp v0.24+ uses stored CLI credentials)
                    if auth_methods_info.is_empty() {
                        log::info!(
                            target: "notesage::acp",
                            "[{}] Agent has no auth methods — assuming internally authenticated",
                            agent_binary,
                        );
                        let _ = reply.send(Ok(AuthStatus {
                            authenticated: true,
                            method_id: None,
                        }));
                        continue;
                    }

                    // Pick the method: explicit ID, or first available
                    let selected_id = match &method_id {
                        Some(id) => {
                            if auth_methods_info.iter().any(|m| m.id() == id) {
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
                            // Fallback to first available method
                            auth_methods_info.first().unwrap().id().to_string()
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
                    match conn.send_request(auth_req).block_task().await {
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
                    match conn.send_request(req).block_task().await {
                        Ok(resp) => {
                            let (current_model, available_models) =
                                extract_model_info(resp.config_options.as_ref());

                            let modes = resp.modes.as_ref()
                                .and_then(|m| serde_json::to_value(m).ok());
                            let config_options = resp.config_options.as_ref()
                                .and_then(|c| serde_json::to_value(c).ok());

                            let _ = reply.send(Ok(SessionResult {
                                session_id: resp.session_id.to_string(),
                                current_model,
                                available_models,
                                modes,
                                config_options,
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
                    match conn.send_request(req).block_task().await {
                        Ok(resp) => {
                            let (current_model, available_models) =
                                extract_model_info(resp.config_options.as_ref());

                            let modes = resp.modes.as_ref()
                                .and_then(|m| serde_json::to_value(m).ok());
                            let config_options = resp.config_options.as_ref()
                                .and_then(|c| serde_json::to_value(c).ok());

                            let _ = reply.send(Ok(SessionResult {
                                session_id: sid,
                                current_model,
                                available_models,
                                modes,
                                config_options,
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
                    images,
                    reply,
                } => {
                    // Run prompt in a background task so the command loop remains
                    // responsive for Cancel and PermissionRespond commands while the
                    // agent processes the prompt. `ConnectionTo` is Send + Clone, so a
                    // plain tokio task suffices; using `tokio::spawn` (rather than
                    // `conn.spawn`) keeps a prompt error from tearing down the whole
                    // connection.
                    let conn = conn.clone();
                    let prompt_binary = agent_binary.clone();
                    let prompt_sid = sid.clone();
                    tokio::task::spawn(async move {
                        log::info!(
                            target: "notesage::acp",
                            "[{}] Prompt started (session={}, content_len={}, images={})",
                            prompt_binary, prompt_sid, content.len(),
                            images.as_ref().map_or(0, |v| v.len()),
                        );
                        let start = std::time::Instant::now();
                        let mut blocks: Vec<ContentBlock> = Vec::new();
                        if let Some(ref imgs) = images {
                            for img in imgs {
                                blocks.push(ContentBlock::Image(ImageContent::new(
                                    img.data.clone(),
                                    img.mime_type.clone(),
                                )));
                            }
                        }
                        blocks.push(ContentBlock::Text(TextContent::new(content)));
                        let req = PromptRequest::new(
                            SessionId::new(sid),
                            blocks,
                        );
                        match conn.send_request(req).block_task().await {
                            Ok(_) => {
                                log::info!(
                                    target: "notesage::acp",
                                    "[{}] Prompt completed in {:.1}s (session={})",
                                    prompt_binary, start.elapsed().as_secs_f64(), prompt_sid,
                                );
                                let _ = reply.send(Ok(()));
                            }
                            Err(e) => {
                                log::error!(
                                    target: "notesage::acp",
                                    "[{}] Prompt failed after {:.1}s (session={}): {}",
                                    prompt_binary, start.elapsed().as_secs_f64(), prompt_sid, e,
                                );
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
                    // ACP spec: when sending cancel, the client MUST respond Cancelled
                    // to all pending session/request_permission requests. Dropping the
                    // waiter senders makes the in-flight permission handler tasks resolve
                    // to `Cancelled` (their `rx.await` returns `Err`).
                    if let Ok(mut waiters) = permission_waiters.lock() {
                        waiters.clear();
                    }
                    // Cancel is a notification (fire-and-forget) in ACP.
                    let req = CancelNotification::new(SessionId::new(sid));
                    match conn.send_notification(req) {
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
                    let tx = permission_waiters
                        .lock()
                        .ok()
                        .and_then(|mut w| w.remove(&request_id));
                    if let Some(tx) = tx {
                        let _ = tx.send(PermissionReply { option_id });
                    }
                }
                AgentCmd::SetMode {
                    session_id: sid,
                    mode_id,
                    reply,
                } => {
                    let req = SetSessionModeRequest::new(
                        SessionId::new(sid),
                        SessionModeId::new(mode_id),
                    );
                    match conn.send_request(req).block_task().await {
                        Ok(_) => { let _ = reply.send(Ok(())); }
                        Err(e) => { let _ = reply.send(Err(format!("set_mode failed: {}", e))); }
                    }
                }
                AgentCmd::SetConfigOption {
                    session_id: sid,
                    option_id,
                    value_id,
                    reply,
                } => {
                    let req = SetSessionConfigOptionRequest::new(
                        SessionId::new(sid),
                        SessionConfigId::new(option_id),
                        SessionConfigValueId::new(value_id),
                    );
                    match conn.send_request(req).block_task().await {
                        Ok(_) => { let _ = reply.send(Ok(())); }
                        Err(e) => { let _ = reply.send(Err(format!("set_config_option failed: {}", e))); }
                    }
                }
                AgentCmd::CloseSession {
                    session_id: sid,
                    reply,
                } => {
                    let req = CloseSessionRequest::new(SessionId::new(sid));
                    match conn.send_request(req).block_task().await {
                        Ok(_) => { let _ = reply.send(Ok(())); }
                        Err(e) => { let _ = reply.send(Err(format!("close_session failed: {}", e))); }
                    }
                }
                AgentCmd::ListSessions { cwd, cursor, reply } => {
                    let mut req = ListSessionsRequest::new();
                    if let Some(c) = cwd { req = req.cwd(Some(PathBuf::from(c))); }
                    if let Some(c) = cursor { req = req.cursor(Some(c)); }
                    match conn.send_request(req).block_task().await {
                        Ok(resp) => {
                            let sessions: Vec<crate::commands::acp::AcpSessionInfo> =
                                resp.sessions.iter().map(|s| crate::commands::acp::AcpSessionInfo {
                                    session_id: s.session_id.to_string(),
                                    cwd: Some(s.cwd.to_string_lossy().into_owned()),
                                }).collect();
                            let _ = reply.send(Ok(crate::commands::acp::AcpListResult {
                                sessions,
                                next_cursor: resp.next_cursor.clone(),
                            }));
                        }
                        Err(e) => { let _ = reply.send(Err(format!("list_sessions failed: {}", e))); }
                    }
                }
                AgentCmd::ResumeSession {
                    session_id: sid,
                    working_directory: cwd,
                    reply,
                } => {
                    let req = ResumeSessionRequest::new(
                        SessionId::new(sid.clone()),
                        PathBuf::from(cwd),
                    );
                    match conn.send_request(req).block_task().await {
                        Ok(resp) => {
                            let (current_model, available_models) =
                                extract_model_info(resp.config_options.as_ref());
                            let modes = resp.modes.as_ref()
                                .and_then(|m| serde_json::to_value(m).ok());
                            let config_options = resp.config_options.as_ref()
                                .and_then(|c| serde_json::to_value(c).ok());
                            let _ = reply.send(Ok(SessionResult {
                                session_id: sid,
                                current_model,
                                available_models,
                                modes,
                                config_options,
                            }));
                        }
                        Err(e) => { let _ = reply.send(Err(format!("resume_session failed: {}", e))); }
                    }
                }
                AgentCmd::ForkSession {
                    session_id: sid,
                    working_directory: cwd,
                    reply,
                } => {
                    let req = ForkSessionRequest::new(
                        SessionId::new(sid),
                        PathBuf::from(cwd),
                    );
                    match conn.send_request(req).block_task().await {
                        Ok(resp) => {
                            let (current_model, available_models) =
                                extract_model_info(resp.config_options.as_ref());
                            let modes = resp.modes.as_ref()
                                .and_then(|m| serde_json::to_value(m).ok());
                            let config_options = resp.config_options.as_ref()
                                .and_then(|c| serde_json::to_value(c).ok());
                            let _ = reply.send(Ok(SessionResult {
                                session_id: resp.session_id.to_string(),
                                current_model,
                                available_models,
                                modes,
                                config_options,
                            }));
                        }
                        Err(e) => { let _ = reply.send(Err(format!("fork_session failed: {}", e))); }
                    }
                }
                AgentCmd::Stop { reply } => {
                    stopped_intentionally.store(true, std::sync::atomic::Ordering::Relaxed);
                    // Clear any pending permission waiters so they cancel
                    if let Ok(mut waiters) = permission_waiters.lock() {
                        waiters.clear();
                    }
                    let _ = child.kill().await;
                    let _ = reply.send(Ok(()));
                    break;
                }
                }
            }

            // Emit exit event if the agent died unexpectedly (not via Stop command).
            // `child` and `stopped_intentionally` live in this closure, so the
            // detection happens here before `connect_with` returns.
            if !stopped_intentionally.load(std::sync::atomic::Ordering::Relaxed) {
                let exit_code = child.try_wait().ok().flatten().map(|s| s.code()).flatten();
                let _ = exit_app.emit("acp-agent-exited", AgentExitedPayload {
                    instance_id: exit_instance_id.clone(),
                    exit_code,
                });
                log::warn!(
                    target: "notesage::acp",
                    "Agent {} exited unexpectedly (code: {:?})",
                    exit_instance_id, exit_code,
                );
            }

            Ok(())
        })
        .await;

        if let Err(e) = connect_result {
            log::error!(
                target: "notesage::acp",
                "[{}] ACP connection ended with error: {}",
                agent_binary, e,
            );
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

    // Resolve the actual binary path. Absolute paths (custom agents) go through
    // `resolve_absolute_binary` directly so its precise validation errors
    // ("not found at <path>" / "not executable") reach the frontend instead of
    // collapsing into the generic not-found message; agent names keep the
    // PATH/Homebrew/npm/bundled lookup.
    let resolved_binary = if std::path::Path::new(&agent_binary).is_absolute() {
        resolve_absolute_binary(&agent_binary)?
    } else {
        resolve_agent_binary(&agent_binary, &app)
            .ok_or_else(|| format!("Agent binary '{}' not found", agent_binary))?
    };

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

    // Save a copy of allowed domains for AgentHandle before they're consumed
    let saved_network_domains = network_allowed_domains.clone();

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
    let knd = kernel_network_deny.unwrap_or(false);

    let (init_tx, init_rx) = oneshot::channel();
    let (cmd_tx, cmd_rx) = mpsc::channel(32);

    // Shared PID cell — thread writes after spawn, AgentHandle reads for SIGKILL
    let child_pid = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
    let child_pid_thread = std::sync::Arc::clone(&child_pid);

    let binary = resolved_binary;
    let cwd = working_directory.clone();
    let iid = instance_id.clone();
    let spawn_args = args.clone();
    let spawn_env = env.clone();
    let spawn_writable = writable_paths.clone();

    let thread_handle = std::thread::Builder::new()
        .name(format!("acp-{}", &binary))
        .spawn(move || {
            run_agent_thread(app, iid, binary, spawn_args, cwd, spawn_env, sandbox, spawn_writable, network_config, knd, cmd_rx, init_tx, child_pid_thread);
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
        agent_binary: agent_binary.clone(),
        working_directory: working_directory.clone(),
        child_pid,
        cmd_tx,
        thread_handle: Some(thread_handle),
        agent_args: args,
        env_vars: env,
        sandbox_enabled: sandbox,
        sandbox_writable_paths: writable_paths,
        network_sandbox_enabled: has_network_sandbox,
        network_allowed_domains: if has_network_sandbox {
            saved_network_domains
        } else {
            None
        },
        kernel_network_deny: knd,
        supports_images: init_info.supports_images,
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
        supports_images: init_info.supports_images,
        capabilities: init_info.capabilities,
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
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    }; // lock released here

    let (reply_tx, reply_rx) = oneshot::channel();

    cmd_tx
        .send(AgentCmd::Authenticate {
            method_id,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

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

/// Check whether the agent's background thread is still running.
/// Returns `false` if the agent is unknown or its thread has exited.
#[tauri::command]
pub async fn acp_is_agent_alive(
    state: State<'_, AcpState>,
    instance_id: String,
) -> Result<bool, String> {
    let agents = state.agents.lock().await;
    match agents.get(&instance_id) {
        Some(handle) => Ok(handle
            .thread_handle
            .as_ref()
            .map_or(false, |th| !th.is_finished())),
        None => Ok(false),
    }
}

/// Stop an ACP agent subprocess and clean up resources.
#[tauri::command]
pub async fn acp_agent_stop(
    state: State<'_, AcpState>,
    instance_id: String,
) -> Result<(), String> {
    // Remove the handle and DROP the map lock before any `.await`, so concurrent
    // ACP commands aren't blocked for the whole stop round-trip (which can be as
    // long as an in-flight prompt). Holding `agents` across the send/reply/join
    // below would serialize every other command behind this one.
    let mut handle = {
        let mut agents = state.agents.lock().await;
        agents
            .remove(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?
    };

    let thread_handle = handle.thread_handle.take();

    // Best-effort graceful stop. On any failure we still join the OS thread
    // below so we never leak a zombie (dropping `handle` releases `cmd_tx`, and
    // `kill_on_drop` tears down the child).
    let (reply_tx, reply_rx) = oneshot::channel();
    let result = match handle.cmd_tx.send(AgentCmd::Stop { reply: reply_tx }).await {
        Ok(()) => reply_rx
            .await
            .map_err(|_| "Agent thread did not respond to stop".to_string())
            .and_then(|r| r),
        Err(_) => Err("Agent thread is no longer running".to_string()),
    };

    // Drop the handle (releases cmd_tx → the command loop ends), then join the
    // OS thread on a blocking-safe task so we don't park the async executor.
    drop(handle);
    if let Some(th) = thread_handle {
        let _ = tokio::task::spawn_blocking(move || th.join()).await;
    }

    result
}

/// Kill a hung agent, respawn with the same config, re-authenticate, and load the session.
/// Returns a new `SpawnResult` with a fresh `instance_id`.
#[tauri::command]
pub async fn acp_agent_reconnect(
    app: AppHandle,
    state: State<'_, AcpState>,
    network_proxy_state: State<'_, super::network_proxy::NetworkProxyState>,
    instance_id: String,
    session_id: String,
) -> Result<SpawnResult, String> {
    // 1. Remove the old agent from the map and extract its spawn config
    let old_handle = {
        let mut agents = state.agents.lock().await;
        agents.remove(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?
    };

    // 2. SIGKILL the old subprocess directly via PID
    let pid = old_handle.child_pid.load(std::sync::atomic::Ordering::Relaxed);
    if pid != 0 {
        unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL); }
        log::info!(target: "notesage::acp", "Reconnect: sent SIGKILL to old agent PID {}", pid);
    }

    // 3. Drop the command channel and join the thread with 500ms timeout
    drop(old_handle.cmd_tx);
    if let Some(th) = old_handle.thread_handle {
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let join_thread = std::thread::spawn(move || {
            let _ = th.join();
            let _ = done_tx.send(());
        });
        match done_rx.recv_timeout(std::time::Duration::from_millis(500)) {
            Ok(_) => { let _ = join_thread.join(); }
            Err(_) => {
                log::warn!(target: "notesage::acp", "Reconnect: old agent thread did not exit within 500ms, abandoning");
            }
        }
    }

    // 4. Spawn a fresh agent with the same config
    let working_dir = old_handle.working_directory.clone();
    let result = acp_agent_spawn(
        app,
        state.clone(),
        network_proxy_state,
        old_handle.agent_binary,
        Some(old_handle.agent_args),
        AgentRole::Interactive,
        working_dir.clone(),
        Some(old_handle.env_vars),
        Some(old_handle.sandbox_enabled),
        Some(old_handle.sandbox_writable_paths),
        Some(old_handle.network_sandbox_enabled),
        old_handle.network_allowed_domains,
        Some(old_handle.kernel_network_deny),
    ).await?;

    // 5. Re-authenticate (best-effort, same as initial spawn)
    if let Err(auth_err) = acp_agent_authenticate(
        state.clone(),
        result.instance_id.clone(),
        None,
    ).await {
        let msg = auth_err.to_string();
        if !msg.to_lowercase().contains("not implemented") {
            log::warn!(target: "notesage::acp", "Reconnect: auth failed: {}", msg);
            return Err(format!("Reconnect auth failed: {}", msg));
        }
    }

    // 6. Load the existing session
    let _session = acp_session_load(
        state,
        result.instance_id.clone(),
        session_id,
        working_dir,
    ).await
    .map_err(|e| format!("Reconnect session/load failed: {}", e))?;

    log::info!(target: "notesage::acp", "Reconnect succeeded: old={} new={}", instance_id, result.instance_id);

    Ok(result)
}

/// Create a new ACP session.
#[tauri::command]
pub async fn acp_session_new(
    state: State<'_, AcpState>,
    instance_id: String,
    working_directory: String,
) -> Result<SessionResult, String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    }; // lock released here

    let (reply_tx, reply_rx) = oneshot::channel();

    cmd_tx
        .send(AgentCmd::NewSession {
            working_directory,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

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
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    }; // lock released here

    let (reply_tx, reply_rx) = oneshot::channel();

    cmd_tx
        .send(AgentCmd::LoadSession {
            session_id,
            working_directory,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    let result = reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to load_session".to_string())??;

    Ok(result)
}

/// Send a prompt to an ACP session. Blocks until the agent completes the turn.
/// Session updates are emitted as `acp-session-update` Tauri events.
/// Permission requests are emitted as `acp-permission-request` events.
///
/// Message identity is agent-assigned: `agent_message_chunk` updates carry an
/// optional `messageId` (`ContentChunk.message_id`) grouping the chunks of one
/// message — there is no client-supplied message id in ACP 0.14.
#[tauri::command]
pub async fn acp_session_prompt(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    content: String,
    images: Option<Vec<super::ai::ImageData>>,
) -> Result<(), String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    }; // lock released here

    let (reply_tx, reply_rx) = oneshot::channel();

    cmd_tx
        .send(AgentCmd::Prompt {
            session_id,
            content,
            images,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    // 30-minute timeout — prompts can take very long for research tasks with many
    // tool calls, web fetches, and file reads. The frontend has a 60s unresponsive
    // timer (reset by each ACP event) for actual hangs; this backend timeout is
    // only a hard ceiling to prevent truly abandoned prompts from leaking forever.
    tokio::time::timeout(std::time::Duration::from_secs(1800), reply_rx)
        .await
        .map_err(|_| "Prompt timed out after 30 minutes — the agent may be hung or crashed".to_string())?
        .map_err(|_| "Agent thread did not respond to prompt (channel dropped — agent likely crashed)".to_string())?
}

/// Check whether the agent supports image content in prompts.
#[tauri::command]
pub async fn acp_supports_images(
    state: State<'_, AcpState>,
    instance_id: String,
) -> Result<bool, String> {
    let agents = state.agents.lock().await;
    let handle = agents
        .get(&instance_id)
        .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
    Ok(handle.supports_images)
}

/// Cancel the current prompt in an ACP session.
#[tauri::command]
pub async fn acp_session_cancel(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
) -> Result<(), String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    }; // lock released here

    let (reply_tx, reply_rx) = oneshot::channel();

    cmd_tx
        .send(AgentCmd::Cancel {
            session_id,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to cancel".to_string())?
}

/// Set the session mode for an ACP agent.
#[tauri::command]
pub async fn acp_session_set_mode(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    mode_id: String,
) -> Result<(), String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    cmd_tx
        .send(AgentCmd::SetMode {
            session_id,
            mode_id,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to set_mode".to_string())?
}

/// Set a session config option for an ACP agent.
#[tauri::command]
pub async fn acp_session_set_config_option(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    option_id: String,
    value_id: String,
) -> Result<(), String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    cmd_tx
        .send(AgentCmd::SetConfigOption {
            session_id,
            option_id,
            value_id,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to set_config_option".to_string())?
}

/// Close an ACP session. Best-effort — agents may not support this.
/// Capability-gated on `session_capabilities.close` from the frontend.
#[tauri::command]
pub async fn acp_session_close(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
) -> Result<(), String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    cmd_tx
        .send(AgentCmd::CloseSession { session_id, reply: reply_tx })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to close_session".to_string())?
}

/// List the agent's sessions, optionally filtered by `cwd` and paginated via `cursor`.
/// Capability-gated on `session_capabilities.list` from the frontend.
#[tauri::command]
pub async fn acp_session_list(
    state: State<'_, AcpState>,
    instance_id: String,
    cwd: Option<String>,
    cursor: Option<String>,
) -> Result<AcpListResult, String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    cmd_tx
        .send(AgentCmd::ListSessions { cwd, cursor, reply: reply_tx })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to list_sessions".to_string())?
}

/// Resume an existing ACP session. Lightweight alternative to `session/load` when the
/// agent still has the session in memory. Capability-gated on `session_capabilities.resume`.
#[tauri::command]
pub async fn acp_session_resume(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    working_directory: String,
) -> Result<SessionResult, String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    cmd_tx
        .send(AgentCmd::ResumeSession {
            session_id,
            working_directory,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    let result = reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to resume_session".to_string())??;

    Ok(result)
}

/// Fork an existing ACP session, returning a new session ID that inherits the agent's state.
/// Capability-gated on `session_capabilities.fork` from the frontend.
#[tauri::command]
pub async fn acp_session_fork(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    working_directory: String,
) -> Result<SessionResult, String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    cmd_tx
        .send(AgentCmd::ForkSession {
            session_id,
            working_directory,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    let result = reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to fork_session".to_string())??;

    Ok(result)
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
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    }; // lock released here

    cmd_tx
        .send(AgentCmd::PermissionRespond {
            request_id,
            option_id,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::{extract_model_info, AuthEnvVar, AuthMethodInfo};
    use agent_client_protocol::schema::{
        ContentBlock, ContentChunk, MessageId, SessionConfigOption, SessionConfigOptionCategory,
        SessionConfigSelectOption, TextContent,
    };

    /// `AuthMethodInfo::EnvVar` must round-trip through serde so the frontend receives
    /// the full `{ vars, link }` payload. Tagged as `{ "type": "env_var", ... }`.
    #[test]
    fn auth_method_info_env_var_serializes_vars_and_link() {
        let info = AuthMethodInfo::EnvVar {
            id: "api-key".to_string(),
            name: "API Key".to_string(),
            description: Some("Paste your provider key".to_string()),
            vars: vec![
                AuthEnvVar {
                    name: "OPENAI_API_KEY".to_string(),
                    label: Some("API Key".to_string()),
                    secret: true,
                    optional: false,
                },
                AuthEnvVar {
                    name: "OPENAI_ORG_ID".to_string(),
                    label: None,
                    secret: false,
                    optional: true,
                },
            ],
            link: Some("https://example.com/keys".to_string()),
        };

        let json = serde_json::to_value(&info).expect("AuthMethodInfo must serialize");
        assert_eq!(json.get("type").and_then(|v| v.as_str()), Some("env_var"));
        assert_eq!(json.get("id").and_then(|v| v.as_str()), Some("api-key"));
        assert_eq!(json.get("name").and_then(|v| v.as_str()), Some("API Key"));
        assert_eq!(
            json.get("link").and_then(|v| v.as_str()),
            Some("https://example.com/keys"),
        );

        let vars = json.get("vars").and_then(|v| v.as_array()).expect("vars[]");
        assert_eq!(vars.len(), 2);
        assert_eq!(vars[0].get("name").and_then(|v| v.as_str()), Some("OPENAI_API_KEY"));
        assert_eq!(vars[0].get("secret").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(vars[0].get("optional").and_then(|v| v.as_bool()), Some(false));
        assert_eq!(vars[1].get("optional").and_then(|v| v.as_bool()), Some(true));

        // Round-trip back to AuthMethodInfo and confirm the EnvVar variant is preserved.
        let round: AuthMethodInfo =
            serde_json::from_value(json).expect("AuthMethodInfo must deserialize");
        match round {
            AuthMethodInfo::EnvVar { vars, link, .. } => {
                assert_eq!(vars.len(), 2);
                assert_eq!(vars[0].name, "OPENAI_API_KEY");
                assert_eq!(link.as_deref(), Some("https://example.com/keys"));
            }
            _ => panic!("Expected EnvVar variant after round-trip"),
        }
    }

    /// `AuthMethodInfo::Agent` serializes as `{ "type": "agent", ... }`.
    #[test]
    fn auth_method_info_agent_serializes_without_vars() {
        let info = AuthMethodInfo::Agent {
            id: "default".to_string(),
            name: "Default".to_string(),
            description: None,
        };
        let json = serde_json::to_value(&info).expect("AuthMethodInfo must serialize");
        assert_eq!(json.get("type").and_then(|v| v.as_str()), Some("agent"));
        assert!(json.get("vars").is_none(), "Agent variant should not carry vars");
        assert!(json.get("link").is_none(), "Agent variant should not carry link");
    }

    /// `ContentChunk.message_id` is the stable (0.13.6) message-identity design:
    /// the agent assigns the id, and all chunks of one message share it. The
    /// frontend reads it from `agent_message_chunk` updates as `messageId`
    /// (camelCase) — this test locks that wire shape.
    #[test]
    fn content_chunk_serializes_message_id_when_present() {
        let chunk = ContentChunk::new(ContentBlock::Text(TextContent::new("hello".to_string())))
            .message_id(MessageId::new("msg-1"));

        let json = serde_json::to_value(&chunk).expect("ContentChunk must serialize");
        assert_eq!(
            json.get("messageId").and_then(|v| v.as_str()),
            Some("msg-1"),
            "ContentChunk should serialize `messageId` (camelCase) when present"
        );

        let bare = ContentChunk::new(ContentBlock::Text(TextContent::new("hi".to_string())));
        let json = serde_json::to_value(&bare).expect("ContentChunk must serialize");
        assert!(
            json.get("messageId").is_none(),
            "messageId should be omitted when absent (got {json:?})",
        );
    }

    /// The session-model API was removed in ACP 0.14; `extract_model_info` derives
    /// the model picker from the config option with category `Model`. No such
    /// option → graceful empty result, never an error.
    #[test]
    fn extract_model_info_reads_model_category_config_option() {
        let model_option = SessionConfigOption::select(
            "model",
            "Model",
            "claude-sonnet-4",
            vec![
                SessionConfigSelectOption::new("claude-sonnet-4", "Claude Sonnet 4")
                    .description("Fast and capable".to_string()),
                SessionConfigSelectOption::new("claude-opus-4", "Claude Opus 4"),
            ],
        )
        .category(SessionConfigOptionCategory::Model);
        let unrelated_option = SessionConfigOption::select(
            "effort",
            "Thinking effort",
            "medium",
            vec![SessionConfigSelectOption::new("medium", "Medium")],
        )
        .category(SessionConfigOptionCategory::ThoughtLevel);

        let options = vec![unrelated_option.clone(), model_option];
        let (current, available) = extract_model_info(Some(&options));
        assert_eq!(current.as_deref(), Some("claude-sonnet-4"));
        assert_eq!(available.len(), 2);
        assert_eq!(available[0].model_id, "claude-sonnet-4");
        assert_eq!(available[0].name, "Claude Sonnet 4");
        assert_eq!(available[0].description.as_deref(), Some("Fast and capable"));
        assert_eq!(available[1].model_id, "claude-opus-4");

        // No model-category option → empty result (graceful degradation).
        let (current, available) = extract_model_info(Some(&vec![unrelated_option]));
        assert!(current.is_none());
        assert!(available.is_empty());

        let (current, available) = extract_model_info(None);
        assert!(current.is_none());
        assert!(available.is_empty());
    }
}
