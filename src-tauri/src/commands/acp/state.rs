//! Managed state, the per-agent handle, the agent-thread command protocol, and
//! the orphan-PID-file discipline.
//!
//! `AcpState` is the Tauri-managed registry of running agents. `AgentHandle` is
//! the per-agent record held in that registry (channel sender + spawn config for
//! reconnection + shutdown metadata). `AgentCmd` is the message protocol between
//! the Tauri command layer and the dedicated agent OS thread.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex as StdMutex;
use tokio::sync::{mpsc, oneshot};

use super::types::{AcpListResult, AgentRole, AuthStatus, SessionResult};

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

pub struct AcpState {
    pub(crate) agents: tokio::sync::Mutex<HashMap<String, AgentHandle>>,
}

impl AcpState {
    pub fn new() -> Self {
        Self {
            agents: tokio::sync::Mutex::new(HashMap::new()),
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
    pub async fn check_processes(&self) -> Vec<crate::commands::health::ProcessStatus> {
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
                crate::commands::health::ProcessStatus {
                    name: id.clone(),
                    alive,
                    pid: if pid != 0 { Some(pid) } else { None },
                }
            })
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Orphan PID files (audit batch 3 fix #9)
//
// Startup used to `pkill -f claude-agent-acp` / `codex-acp` system-wide, which
// kills matching processes belonging to OTHER apps (a user's own terminal
// Claude Code session, another editor's ACP integration). Instead, every spawn
// records its child PID + binary in `~/.notesage/agents/pids/<instance>.pid`
// (the same PID-file discipline llama-server uses), the agent thread removes
// the file on clean exit, and startup kills only PIDs whose current command
// line still matches the recorded binary (see `process_guard`).
// ---------------------------------------------------------------------------

fn acp_pid_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".notesage")
        .join("agents")
        .join("pids")
}

/// Record a spawned agent's PID and binary for startup orphan cleanup.
/// Best-effort — a failure to write just means the old behavior (no record).
pub(crate) fn write_acp_pid_file(instance_id: &str, pid: u32, agent_binary: &str) {
    let dir = acp_pid_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = std::fs::write(
        dir.join(format!("{}.pid", instance_id)),
        format!("{}\n{}\n", pid, agent_binary),
    );
}

/// Parse a PID-file body (`<pid>\n<binary>\n`) into its parts. Returns `None`
/// when the pid line is missing/non-numeric or the binary line is empty —
/// a record we can't verify must never be signalled.
pub(crate) fn parse_acp_pid_file(content: &str) -> Option<(u32, String)> {
    let mut lines = content.lines();
    let pid = lines.next()?.trim().parse::<u32>().ok()?;
    let binary = lines.next()?.trim();
    if pid == 0 || binary.is_empty() {
        return None;
    }
    Some((pid, binary.to_string()))
}

/// Remove the PID file for a finished agent, but only when it still records
/// `pid` — a reconnect reuses the instance id, so the OLD thread's late
/// cleanup must not delete the NEW spawn's record.
pub(crate) fn remove_acp_pid_file(instance_id: &str, pid: u32) {
    if pid == 0 {
        return;
    }
    let path = acp_pid_dir().join(format!("{}.pid", instance_id));
    let recorded = std::fs::read_to_string(&path)
        .ok()
        .and_then(|c| parse_acp_pid_file(&c).map(|(p, _)| p));
    if recorded == Some(pid) {
        let _ = std::fs::remove_file(&path);
    }
}

/// Kill orphaned ACP agent subprocesses recorded by previous sessions.
/// Called once at app startup from `lib.rs` setup. Each PID is verified
/// against its recorded binary before being signalled (PID-reuse guard); the
/// PID file is removed either way.
pub fn kill_orphaned_acp_agents() {
    let Ok(entries) = std::fs::read_dir(acp_pid_dir()) else {
        return; // no dir yet — nothing was ever recorded
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("pid") {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Some((pid, binary)) = parse_acp_pid_file(&content) {
                let binary = binary.as_str();
                let cmdline = crate::commands::process_guard::process_cmdline(pid);
                if crate::commands::process_guard::should_signal_pid(cmdline.as_deref(), binary) {
                    crate::commands::process_guard::terminate_with_escalation(pid);
                    log::info!(
                        target: "notesage::acp",
                        "Killed orphaned ACP agent (pid {}, binary {})",
                        pid, binary
                    );
                } else {
                    log::info!(
                        target: "notesage::acp",
                        "Skipping orphaned ACP PID {} — process is gone or no longer matches {} ({:?})",
                        pid, binary, cmdline
                    );
                }
            }
        }
        let _ = std::fs::remove_file(&path);
    }
}

/// Handle held in AcpState for each running agent.
/// Communication with the agent thread is done via the command channel.
pub(crate) struct AgentHandle {
    #[allow(dead_code)]
    pub(crate) role: AgentRole,
    pub(crate) agent_binary: String,
    pub(crate) working_directory: String,
    /// Child process PID — written by agent thread after spawn, readable from any thread.
    /// Used by recovery and shutdown flows to SIGKILL the subprocess directly.
    pub(crate) child_pid: std::sync::Arc<std::sync::atomic::AtomicU32>,
    pub(crate) cmd_tx: mpsc::Sender<AgentCmd>,
    pub(crate) thread_handle: Option<std::thread::JoinHandle<()>>,
    // --- Spawn config (stored for reconnection) ---
    pub(crate) agent_args: Vec<String>,
    pub(crate) env_vars: HashMap<String, String>,
    pub(crate) sandbox_enabled: bool,
    pub(crate) sandbox_writable_paths: Vec<String>,
    pub(crate) network_sandbox_enabled: bool,
    pub(crate) network_allowed_domains: Option<Vec<String>>,
    pub(crate) kernel_network_deny: bool,
    /// Extra direct-localhost ports (e.g. llama-server for the Goose preset).
    /// Stored so a reconnect re-applies the same network confinement.
    pub(crate) extra_localhost_ports: Vec<u16>,
    /// Whether the agent supports image content (from promptCapabilities)
    pub(crate) supports_images: bool,
}

// ---------------------------------------------------------------------------
// Agent thread command channel
// ---------------------------------------------------------------------------

pub(crate) enum AgentCmd {
    Authenticate {
        method_id: Option<String>,
        reply: oneshot::Sender<Result<AuthStatus, String>>,
    },
    NewSession {
        working_directory: String,
        /// MCP servers to attach to the new session (task #11). Built on the
        /// command side (keychain secrets resolved) so the agent thread just
        /// forwards them to the ACP `session/new` request.
        mcp_servers: Vec<agent_client_protocol::schema::McpServer>,
        reply: oneshot::Sender<Result<SessionResult, String>>,
    },
    LoadSession {
        session_id: String,
        working_directory: String,
        /// MCP servers for the reloaded session. ACP treats this as the complete
        /// list for the loaded session, so callers re-send the current set (#11).
        mcp_servers: Vec<agent_client_protocol::schema::McpServer>,
        reply: oneshot::Sender<Result<SessionResult, String>>,
    },
    Prompt {
        session_id: String,
        content: String,
        images: Option<Vec<crate::commands::ai::ImageData>>,
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

/// How many trailing stderr lines to retain for error reporting.
pub(crate) const STDERR_TAIL_LINES: usize = 12;

/// Render the retained stderr tail as an error-message suffix (empty when the
/// agent wrote nothing). Mirrors the `mcp_validate_server` stderr_tail pattern:
/// a failing agent's own output must reach the user, not just the app log.
pub(crate) fn stderr_tail_suffix(
    tail: &StdMutex<std::collections::VecDeque<String>>,
) -> String {
    let lines: Vec<String> = match tail.lock() {
        Ok(t) => t.iter().cloned().collect(),
        Err(_) => return String::new(),
    };
    if lines.is_empty() {
        return String::new();
    }
    format!("\nAgent stderr (last {} lines):\n{}", lines.len(), lines.join("\n"))
}
