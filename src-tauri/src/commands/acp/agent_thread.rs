//! The agent OS thread: owns the (Send) `ConnectionTo<Agent>`, spawns the agent
//! subprocess, runs the ACP `initialize` handshake, then drives a command loop
//! that translates `AgentCmd` messages into ACP requests.
//!
//! `run_agent_thread` is the entry point. Its command loop is a thin dispatcher:
//! each `AgentCmd` arm delegates to a private `handle_*` helper below, so the
//! top-level loop reads as a table of message kinds rather than one 350-line
//! match. The `Stop` arm is the only one kept inline — it must both kill the
//! child and `break` the loop, which a helper can't express.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot};

use agent_client_protocol::schema::*;
use agent_client_protocol::ConnectionTo;

use super::helpers::build_session_result;
use super::state::{
    remove_acp_pid_file, stderr_tail_suffix, write_acp_pid_file, AgentCmd, STDERR_TAIL_LINES,
};
use super::types::{
    AcpListResult, AcpSessionInfo, AgentExitedPayload, AuthEnvVar, AuthMethodInfo, AuthStatus,
    SessionResult,
};
use crate::commands::acp_client::{
    ClientContext, InitInfo, JsonLineFilter, PermissionReply, PermissionWaiters,
};
use crate::commands::shell_path::get_shell_path;

/// The client-side ACP connection handle. `Send + Clone` as of the crate's 0.12
/// release, which is what lets the command loop hand `&AgentConn` to per-kind
/// helpers and lets `Prompt` clone it into a detached task.
type AgentConn = ConnectionTo<agent_client_protocol::Agent>;

// ---------------------------------------------------------------------------
// Per-command handlers — one per `AgentCmd` kind (except `Stop`, kept inline).
// Each mirrors the request/response shape of its ACP method and reports back
// through the command's `reply` oneshot. Errors become `Err(String)` sent to
// the reply channel; a dropped reply receiver is ignored (`let _ =`).
// ---------------------------------------------------------------------------

async fn handle_authenticate(
    conn: &AgentConn,
    agent_binary: &str,
    auth_methods_info: &[AuthMethodInfo],
    method_id: Option<String>,
    reply: oneshot::Sender<Result<AuthStatus, String>>,
) {
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
        return;
    }

    // Pick the method: explicit ID, or first available
    let selected_id = match &method_id {
        Some(id) => {
            if auth_methods_info.iter().any(|m| m.id() == id) {
                id.clone()
            } else {
                let _ = reply.send(Err(format!("Unknown auth method: {}", id)));
                return;
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
    let auth_req = AuthenticateRequest::new(AuthMethodId::new(selected_id.clone()));
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
            let _ = reply.send(Err(format!("Authentication failed: {}", e)));
        }
    }
}

async fn handle_new_session(
    conn: &AgentConn,
    cwd: String,
    mcp_servers: Vec<McpServer>,
    reply: oneshot::Sender<Result<SessionResult, String>>,
) {
    let req = NewSessionRequest::new(PathBuf::from(cwd)).mcp_servers(mcp_servers);
    match conn.send_request(req).block_task().await {
        Ok(resp) => {
            let modes = resp.modes.as_ref().and_then(|m| serde_json::to_value(m).ok());
            let _ = reply.send(Ok(build_session_result(
                resp.session_id.to_string(),
                resp.config_options.as_ref(),
                modes,
            )));
        }
        Err(e) => {
            let _ = reply.send(Err(format!("new_session failed: {}", e)));
        }
    }
}

async fn handle_load_session(
    conn: &AgentConn,
    sid: String,
    cwd: String,
    mcp_servers: Vec<McpServer>,
    reply: oneshot::Sender<Result<SessionResult, String>>,
) {
    let mut req = LoadSessionRequest::new(SessionId::new(sid.clone()), PathBuf::from(cwd));
    req.mcp_servers = mcp_servers;
    match conn.send_request(req).block_task().await {
        Ok(resp) => {
            let modes = resp.modes.as_ref().and_then(|m| serde_json::to_value(m).ok());
            let _ = reply.send(Ok(build_session_result(
                sid,
                resp.config_options.as_ref(),
                modes,
            )));
        }
        Err(e) => {
            let _ = reply.send(Err(format!("load_session failed: {}", e)));
        }
    }
}

/// ACP `StopReason` → the snake_case wire string the frontend switches on.
///
/// Mirrors the schema's own `#[serde(rename_all = "snake_case")]` rather than
/// serializing through serde_json, so the exact strings the UI depends on are
/// visible and unit-testable here. `StopReason` is `#[non_exhaustive]`: an
/// unknown future variant degrades to `"unknown"`, which the frontend treats as
/// "ended for an unrecognised reason" rather than as a clean finish.
pub(crate) fn stop_reason_str(reason: StopReason) -> String {
    match reason {
        StopReason::EndTurn => "end_turn",
        StopReason::MaxTokens => "max_tokens",
        StopReason::MaxTurnRequests => "max_turn_requests",
        StopReason::Refusal => "refusal",
        StopReason::Cancelled => "cancelled",
        _ => "unknown",
    }
    .to_string()
}

/// Prompt runs in a detached task so the command loop stays responsive for
/// `Cancel` and `PermissionRespond` while the agent processes the prompt.
/// `ConnectionTo` is Send + Clone, so a plain `tokio::spawn` suffices; using it
/// (rather than `conn.spawn`) keeps a prompt error from tearing down the whole

/// Assemble the content blocks for one `session/prompt`.
///
/// Pure and separate so the ordering and the attachment shape are testable —
/// `handle_prompt` itself spawns a task against a live connection.
///
/// Order is images, then attachments, then the user's text. The text goes last
/// so the agent reads the question after the material it refers to.
pub(crate) fn build_prompt_blocks(
    content: String,
    images: Option<&[crate::commands::ai::ImageData]>,
    attached_file_paths: &[String],
) -> Vec<ContentBlock> {
    let mut blocks: Vec<ContentBlock> = Vec::new();
    if let Some(imgs) = images {
        for img in imgs {
            blocks.push(ContentBlock::Image(ImageContent::new(
                img.data.clone(),
                img.mime_type.clone(),
            )));
        }
    }
    // Attachments as RESOURCE LINKS.
    //
    // Every ACP agent must support these ("All agents MUST support resource
    // links in prompts" — schema v2), so unlike images this needs no
    // capability gate.
    //
    // This replaces naming the path in the system prompt, which is what an
    // attachment used to do and why it did nothing: the agent received a
    // string that happened to look like a path, with no reason to connect it
    // to "read this". Pasting the path by hand produced an identical result,
    // which is exactly what was reported.
    //
    // `Resource` (embedded contents) would save a round-trip but is gated
    // behind `embeddedContext` and would inline whole files into the prompt —
    // the failure mode being avoided, not chosen.
    for path in attached_file_paths {
        let name = std::path::Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        // `ResourceLink` is #[non_exhaustive] — built through its constructor
        // so a field added upstream cannot break this.
        blocks.push(ContentBlock::ResourceLink(ResourceLink::new(
            name,
            format!("file://{path}"),
        )));
    }
    blocks.push(ContentBlock::Text(TextContent::new(content)));
    blocks
}

/// connection. Not `async` — it only spawns and returns.
fn handle_prompt(
    conn: &AgentConn,
    agent_binary: &str,
    sid: String,
    content: String,
    images: Option<Vec<crate::commands::ai::ImageData>>,
    attached_file_paths: Vec<String>,
    usage_ctx: ClientContext,
    reply: oneshot::Sender<Result<String, String>>,
) {
    let conn = conn.clone();
    let prompt_binary = agent_binary.to_string();
    let prompt_sid = sid.clone();
    tokio::task::spawn(async move {
        log::info!(
            target: "notesage::acp",
            "[{}] Prompt started (session={}, content_len={}, images={})",
            prompt_binary, prompt_sid, content.len(),
            images.as_ref().map_or(0, |v| v.len()),
        );
        let start = std::time::Instant::now();
        let blocks = build_prompt_blocks(content, images.as_deref(), &attached_file_paths);
        let req = PromptRequest::new(SessionId::new(sid), blocks);
        match conn.send_request(req).block_task().await {
            Ok(resp) => {
                // The stop reason is the ONLY signal distinguishing a completed
                // turn from one the agent abandoned because it ran out of tokens
                // or turn requests. Logging an unconditional "completed" here (and
                // replying `Ok(())`) made an abandoned long task look exactly like
                // a clean finish, both in the log and in the UI.
                let stop_reason = stop_reason_str(resp.stop_reason);
                let elapsed = start.elapsed().as_secs_f64();
                if resp.stop_reason == StopReason::EndTurn {
                    log::info!(
                        target: "notesage::acp",
                        "[{}] Prompt completed in {:.1}s (session={}, stop_reason={})",
                        prompt_binary, elapsed, prompt_sid, stop_reason,
                    );
                } else {
                    log::warn!(
                        target: "notesage::acp",
                        "[{}] Prompt ended early after {:.1}s (session={}, stop_reason={}) — the agent did not finish its work",
                        prompt_binary, elapsed, prompt_sid, stop_reason,
                    );
                }
                // Best-effort per-turn usage forwarding (UNSTABLE upstream
                // field; deserializes DefaultOnError so a shape change lands
                // here as `None`). Emitted BEFORE the reply resolves but
                // isolated from it — nothing on this path can change the
                // prompt result.
                if let Some(usage) = resp.usage.as_ref() {
                    usage_ctx.emit_turn_usage(&prompt_sid, usage);
                }
                let _ = reply.send(Ok(stop_reason));
            }
            Err(e) => {
                log::error!(
                    target: "notesage::acp",
                    "[{}] Prompt failed after {:.1}s (session={}): {}",
                    prompt_binary, start.elapsed().as_secs_f64(), prompt_sid, e,
                );
                let _ = reply.send(Err(format!("Prompt failed: {}", e)));
            }
        }
    });
}

/// Cancel is fire-and-forget (an ACP notification). Per spec the client MUST
/// resolve all pending permission requests as `Cancelled` when cancelling —
/// dropping the waiter senders makes their handler tasks resolve to `Cancelled`
/// (their `rx.await` returns `Err`). Not `async` — send_notification is sync.
fn handle_cancel(
    conn: &AgentConn,
    permission_waiters: &PermissionWaiters,
    sid: String,
    reply: oneshot::Sender<Result<(), String>>,
) {
    if let Ok(mut waiters) = permission_waiters.lock() {
        waiters.clear();
    }
    let req = CancelNotification::new(SessionId::new(sid));
    match conn.send_notification(req) {
        Ok(_) => {
            let _ = reply.send(Ok(()));
        }
        Err(e) => {
            let _ = reply.send(Err(format!("Cancel failed: {}", e)));
        }
    }
}

/// Deliver the user's permission decision to the waiting inbound handler task.
pub(super) fn handle_permission_respond(
    permission_waiters: &PermissionWaiters,
    request_id: String,
    option_id: Option<String>,
) {
    let tx = permission_waiters
        .lock()
        .ok()
        .and_then(|mut w| w.remove(&request_id));
    if let Some(tx) = tx {
        let _ = tx.send(PermissionReply { option_id });
    }
}

async fn handle_set_mode(
    conn: &AgentConn,
    sid: String,
    mode_id: String,
    reply: oneshot::Sender<Result<(), String>>,
) {
    let req = SetSessionModeRequest::new(SessionId::new(sid), SessionModeId::new(mode_id));
    match conn.send_request(req).block_task().await {
        Ok(_) => {
            let _ = reply.send(Ok(()));
        }
        Err(e) => {
            let _ = reply.send(Err(format!("set_mode failed: {}", e)));
        }
    }
}

async fn handle_set_config_option(
    conn: &AgentConn,
    sid: String,
    option_id: String,
    value_id: String,
    reply: oneshot::Sender<Result<(), String>>,
) {
    let req = SetSessionConfigOptionRequest::new(
        SessionId::new(sid),
        SessionConfigId::new(option_id),
        SessionConfigValueId::new(value_id),
    );
    match conn.send_request(req).block_task().await {
        Ok(_) => {
            let _ = reply.send(Ok(()));
        }
        Err(e) => {
            let _ = reply.send(Err(format!("set_config_option failed: {}", e)));
        }
    }
}

async fn handle_close_session(
    conn: &AgentConn,
    sid: String,
    reply: oneshot::Sender<Result<(), String>>,
) {
    let req = CloseSessionRequest::new(SessionId::new(sid));
    match conn.send_request(req).block_task().await {
        Ok(_) => {
            let _ = reply.send(Ok(()));
        }
        Err(e) => {
            let _ = reply.send(Err(format!("close_session failed: {}", e)));
        }
    }
}

async fn handle_list_sessions(
    conn: &AgentConn,
    cwd: Option<String>,
    cursor: Option<String>,
    reply: oneshot::Sender<Result<AcpListResult, String>>,
) {
    let mut req = ListSessionsRequest::new();
    if let Some(c) = cwd {
        req = req.cwd(Some(PathBuf::from(c)));
    }
    if let Some(c) = cursor {
        req = req.cursor(Some(c));
    }
    match conn.send_request(req).block_task().await {
        Ok(resp) => {
            let sessions: Vec<AcpSessionInfo> = resp
                .sessions
                .iter()
                .map(|s| AcpSessionInfo {
                    session_id: s.session_id.to_string(),
                    cwd: Some(s.cwd.to_string_lossy().into_owned()),
                })
                .collect();
            let _ = reply.send(Ok(AcpListResult {
                sessions,
                next_cursor: resp.next_cursor.clone(),
            }));
        }
        Err(e) => {
            let _ = reply.send(Err(format!("list_sessions failed: {}", e)));
        }
    }
}

async fn handle_resume_session(
    conn: &AgentConn,
    sid: String,
    cwd: String,
    reply: oneshot::Sender<Result<SessionResult, String>>,
) {
    let req = ResumeSessionRequest::new(SessionId::new(sid.clone()), PathBuf::from(cwd));
    match conn.send_request(req).block_task().await {
        Ok(resp) => {
            let modes = resp.modes.as_ref().and_then(|m| serde_json::to_value(m).ok());
            let _ = reply.send(Ok(build_session_result(
                sid,
                resp.config_options.as_ref(),
                modes,
            )));
        }
        Err(e) => {
            let _ = reply.send(Err(format!("resume_session failed: {}", e)));
        }
    }
}

async fn handle_fork_session(
    conn: &AgentConn,
    sid: String,
    cwd: String,
    reply: oneshot::Sender<Result<SessionResult, String>>,
) {
    let req = ForkSessionRequest::new(SessionId::new(sid), PathBuf::from(cwd));
    match conn.send_request(req).block_task().await {
        Ok(resp) => {
            let modes = resp.modes.as_ref().and_then(|m| serde_json::to_value(m).ok());
            let _ = reply.send(Ok(build_session_result(
                resp.session_id.to_string(),
                resp.config_options.as_ref(),
                modes,
            )));
        }
        Err(e) => {
            let _ = reply.send(Err(format!("fork_session failed: {}", e)));
        }
    }
}

/// Map an ACP `AuthMethod` into the variant-aware `AuthMethodInfo` the frontend
/// consumes. `EnvVar` carries its full var list; every other variant (including
/// future non-exhaustive ones) collapses to `Agent` so the UI still shows id/name.
fn auth_method_to_info(m: &AuthMethod) -> AuthMethodInfo {
    match m {
        AuthMethod::EnvVar(e) => AuthMethodInfo::EnvVar {
            id: e.id.to_string(),
            name: e.name.clone(),
            description: e.description.clone(),
            vars: e
                .vars
                .iter()
                .map(|v| AuthEnvVar {
                    name: v.name.clone(),
                    label: v.label.clone(),
                    secret: v.secret,
                    optional: v.optional,
                })
                .collect(),
            link: e.link.clone(),
        },
        // Terminal variant support is Batch F territory — surface it as a plain
        // `Agent`-style info block so the UI still shows the ID/name.
        AuthMethod::Terminal(_) => AuthMethodInfo::Agent {
            id: m.id().to_string(),
            name: m.name().to_string(),
            description: m.description().map(|s| s.to_string()),
        },
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
    }
}

// ---------------------------------------------------------------------------
// Agent thread: owns the (now Send) ConnectionTo<Agent>
// ---------------------------------------------------------------------------

/// Runs on a dedicated OS thread with a single-threaded tokio runtime.
///
/// As of agent-client-protocol 0.12 the connection handle (`ConnectionTo<Agent>`)
/// is `Send + Clone`, so the old `!Send` `LocalSet` isolation is no longer
/// required. We still run on a dedicated OS thread so that `AgentHandle` can hold
/// a `std::thread::JoinHandle` (used by liveness checks and `stop_all_sync`), and
/// so the child process / cleanup all live on one runtime. A `current_thread`
/// runtime is sufficient.
#[allow(clippy::too_many_arguments)]
pub(crate) fn run_agent_thread(
    app: AppHandle,
    instance_id: String,
    agent_binary: String,
    agent_args: Vec<String>,
    working_directory: String,
    env_vars: HashMap<String, String>,
    sandbox_enabled: bool,
    sandbox_writable_paths: Vec<String>,
    network_config: Option<crate::commands::network_proxy::NetworkSandboxConfig>,
    kernel_network_deny: bool,
    cmd_rx: mpsc::Receiver<AgentCmd>,
    init_tx: oneshot::Sender<Result<InitInfo, String>>,
    // Shared PID cell — written after spawn, readable from AgentHandle for SIGKILL
    captured_pid: std::sync::Arc<std::sync::atomic::AtomicU32>,
) {
    use agent_client_protocol::ByteStreams;
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
            match crate::commands::sandbox::sandboxed_command(&sandbox_instance_id, &agent_binary, &sandbox_writable_paths, network_config.as_ref(), kernel_network_deny) {
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

            // Record PID + binary for verified orphan cleanup at next startup
            // (replaces the system-wide `pkill -f` — audit batch 3 fix #9).
            write_acp_pid_file(&sandbox_instance_id, pid, &agent_binary);

            // Register PID for sandbox violation monitoring (if sandboxed)
            if sandbox_enabled {
                #[cfg(target_os = "macos")]
                {
                    let monitor_state = monitor_app.state::<crate::commands::sandbox_monitor::SandboxMonitorState>();
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
        // Cloned into the command loop for best-effort `acp-turn-usage` emits
        // from prompt responses (provider-usage-display #1).
        let usage_ctx = client_ctx.clone();

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
                            .map(auth_method_to_info)
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

                // Bind the moved values so the command-loop body reads naturally.
                let agent_binary = loop_binary;
                let permission_waiters = perm_waiters_loop;
                let stopped_intentionally = stopped_for_loop;
                let mut cmd_rx = cmd_rx;

                // Command loop — dispatch each Tauri command to its handler.
                while let Some(cmd) = cmd_rx.recv().await {
                    match cmd {
                        AgentCmd::Authenticate { method_id, reply } => {
                            handle_authenticate(&conn, &agent_binary, &auth_methods_info, method_id, reply).await;
                        }
                        AgentCmd::NewSession { working_directory: cwd, mcp_servers, reply } => {
                            handle_new_session(&conn, cwd, mcp_servers, reply).await;
                        }
                        AgentCmd::LoadSession { session_id: sid, working_directory: cwd, mcp_servers, reply } => {
                            handle_load_session(&conn, sid, cwd, mcp_servers, reply).await;
                        }
                        AgentCmd::Prompt { session_id: sid, content, images, attached_file_paths, reply } => {
                            handle_prompt(&conn, &agent_binary, sid, content, images, attached_file_paths, usage_ctx.clone(), reply);
                        }
                        AgentCmd::Cancel { session_id: sid, reply } => {
                            handle_cancel(&conn, &permission_waiters, sid, reply);
                        }
                        AgentCmd::PermissionRespond { request_id, option_id } => {
                            handle_permission_respond(&permission_waiters, request_id, option_id);
                        }
                        AgentCmd::SetMode { session_id: sid, mode_id, reply } => {
                            handle_set_mode(&conn, sid, mode_id, reply).await;
                        }
                        AgentCmd::SetConfigOption { session_id: sid, option_id, value_id, reply } => {
                            handle_set_config_option(&conn, sid, option_id, value_id, reply).await;
                        }
                        AgentCmd::CloseSession { session_id: sid, reply } => {
                            handle_close_session(&conn, sid, reply).await;
                        }
                        AgentCmd::ListSessions { cwd, cursor, reply } => {
                            handle_list_sessions(&conn, cwd, cursor, reply).await;
                        }
                        AgentCmd::ResumeSession { session_id: sid, working_directory: cwd, reply } => {
                            handle_resume_session(&conn, sid, cwd, reply).await;
                        }
                        AgentCmd::ForkSession { session_id: sid, working_directory: cwd, reply } => {
                            handle_fork_session(&conn, sid, cwd, reply).await;
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
            let proxy_state = cleanup_app.state::<crate::commands::network_proxy::NetworkProxyState>();
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
            let monitor_state = cleanup_app.state::<crate::commands::sandbox_monitor::SandboxMonitorState>();
            // Use try_lock since we're outside the tokio runtime
            if let Ok(mut pids) = monitor_state.agent_pids.try_lock() {
                pids.remove(&pid);
                log::info!(target: "notesage::acp", "Unregistered PID {} from sandbox monitoring", pid);
            };
        }
    }

    // Remove the orphan-cleanup PID record — the child is dead (command loop
    // exit drops the Child with kill_on_drop). PID-guarded so a reconnect's
    // fresh record for the same instance id is never deleted by the old
    // thread's late cleanup.
    remove_acp_pid_file(
        &proxy_instance_id,
        captured_pid.load(std::sync::atomic::Ordering::Relaxed),
    );

    // Clean up sandbox profile temp file
    if sandbox_enabled {
        crate::commands::sandbox::cleanup_profile(&proxy_instance_id);
    }
}
