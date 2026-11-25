//! MCP managed state: the registry of server handles plus the exit-cleanup
//! and liveness paths. `stop_all_sync` / `start_kill` behaviour is load-bearing
//! for the `RunEvent::Exit` hook in `lib.rs` — preserve it exactly.
//!
//! A handle is kept for a server that is running AND for one that failed to
//! start or whose process exited (status `Error`, no connection): the status
//! snapshot then says what happened instead of the server silently vanishing,
//! and "Restart" has a config to start from.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::process::Child;
use tokio::sync::Mutex;

use super::stderr_drain::{with_server_output, StderrTail};
use super::transport::McpConn;
use super::types::{McpServerConfig, McpServerInfo, McpServerStatus, McpToolInfo};

// ---------------------------------------------------------------------------
// MCP Server Handle
// ---------------------------------------------------------------------------

pub(crate) struct McpServerHandle {
    pub(crate) config: McpServerConfig,
    /// `Some` for a live stdio server (the child process); `None` for http
    /// servers and for a server that is not running.
    pub(crate) child: Option<Child>,
    /// `None` when the server is not running (failed start, exited process).
    pub(crate) conn: Option<McpConn>,
    pub(crate) tools: Vec<McpToolInfo>,
    pub(crate) status: McpServerStatus,
    pub(crate) error: Option<String>,
    /// What a stdio server printed (stderr, and stray stdout lines).
    pub(crate) output: Option<StderrTail>,
    /// Which start of this server id the handle belongs to. A reader loop
    /// that outlives its handle (the server was stopped, or restarted) must
    /// not report its exit against the handle that replaced it.
    pub(crate) generation: u64,
}

impl McpServerHandle {
    /// A handle for a server that could not be started.
    pub(crate) fn failed(config: McpServerConfig, error: String, generation: u64) -> Self {
        Self {
            config,
            child: None,
            conn: None,
            tools: Vec::new(),
            status: McpServerStatus::Error,
            error: Some(error),
            output: None,
            generation,
        }
    }

    pub(crate) fn to_info(&self) -> McpServerInfo {
        McpServerInfo {
            id: self.config.id.clone(),
            name: self.config.name.clone(),
            command: self.config.command.clone(),
            args: self.config.args.clone(),
            env: self.config.env.clone(),
            source: self.config.source.clone(),
            enabled: self.config.enabled,
            status: self.status.clone(),
            error: self.error.clone(),
            tools: self.tools.clone(),
            transport: self.config.transport.clone(),
            url: self.config.url.clone(),
            headers: self.config.headers.clone(),
            cwd: self.config.cwd.clone(),
        }
    }
}

/// How a server process ended, for the error shown on its card.
/// `code` / `signal` come from its exit status when that could be collected.
pub(crate) fn describe_exit(code: Option<i32>, signal: Option<i32>, reader_reason: &str) -> String {
    match (code, signal) {
        (Some(code), _) => format!("Server process exited (exit code {})", code),
        (None, Some(signal)) => format!("Server process was terminated (signal {})", signal),
        (None, None) if reader_reason.trim().is_empty() => "Server process exited".to_string(),
        (None, None) => reader_reason.to_string(),
    }
}

#[cfg(unix)]
fn exit_signal(status: &std::process::ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}

#[cfg(not(unix))]
fn exit_signal(_status: &std::process::ExitStatus) -> Option<i32> {
    None
}

// ---------------------------------------------------------------------------
// MCP Managed State
// ---------------------------------------------------------------------------

pub struct McpState {
    pub(crate) servers: Mutex<HashMap<String, McpServerHandle>>,
    /// The config each server id was last started with. Outlives the handle,
    /// so a server that was stopped can be restarted by id.
    last_configs: Mutex<HashMap<String, McpServerConfig>>,
    next_generation: AtomicU64,
}

/// How long a just-exited process is given to be reaped and to have its last
/// stderr lines read, before the exit is reported without them.
const EXIT_SETTLE: Duration = Duration::from_millis(1500);

impl McpState {
    pub fn new() -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
            last_configs: Mutex::new(HashMap::new()),
            next_generation: AtomicU64::new(1),
        }
    }

    /// A fresh generation number for one start attempt.
    pub(crate) fn next_generation(&self) -> u64 {
        self.next_generation.fetch_add(1, Ordering::SeqCst)
    }

    /// Remember the config a server was asked to start with.
    pub(crate) async fn remember_config(&self, config: &McpServerConfig) {
        self.last_configs
            .lock()
            .await
            .insert(config.id.clone(), config.clone());
    }

    /// The config to restart `server_id` from: its handle's (running or
    /// failed), else the one it was last started with.
    pub(crate) async fn config_for_restart(&self, server_id: &str) -> Option<McpServerConfig> {
        if let Some(handle) = self.servers.lock().await.get(server_id) {
            return Some(handle.config.clone());
        }
        self.last_configs.lock().await.get(server_id).cloned()
    }

    /// Record a start that failed, so the status snapshot reports it and a
    /// restart can find the config. Does nothing if a newer start of the same
    /// id has registered a handle meanwhile.
    pub(crate) async fn register_failed(
        &self,
        config: McpServerConfig,
        error: String,
        generation: u64,
    ) {
        let mut servers = self.servers.lock().await;
        let newer = servers
            .get(&config.id)
            .is_some_and(|existing| existing.generation > generation);
        if !newer {
            servers.insert(
                config.id.clone(),
                McpServerHandle::failed(config, error, generation),
            );
        }
    }

    /// The process behind a RUNNING server has exited: mark the handle as
    /// failed and return the error to show, or `None` when there is nothing
    /// to report — the handle is gone (the server was stopped), belongs to a
    /// later start, or is already marked.
    ///
    /// The server stays registered, with status `Error` and no tools, so a
    /// status refresh does not flip it back to "running".
    pub(crate) async fn mark_exited(
        &self,
        server_id: &str,
        generation: u64,
        reader_reason: &str,
    ) -> Option<String> {
        // Take what is needed out of the handle under a short lock.
        let (mut child, output) = {
            let mut servers = self.servers.lock().await;
            let handle = servers.get_mut(server_id)?;
            if handle.generation != generation || !matches!(handle.status, McpServerStatus::Running) {
                return None;
            }
            handle.status = McpServerStatus::Error;
            handle.error = Some(describe_exit(None, None, reader_reason));
            handle.tools.clear();
            handle.conn = None;
            (handle.child.take(), handle.output.clone())
        };

        // Outside the lock: reap the process for its exit status, and let the
        // stderr drain catch up with what it wrote on the way out.
        let status = match child.as_mut() {
            Some(child) => match tokio::time::timeout(EXIT_SETTLE, child.wait()).await {
                Ok(Ok(status)) => Some(status),
                _ => {
                    // stdout closed but the process lives on: it is of no
                    // use without a protocol stream.
                    let _ = child.start_kill();
                    None
                }
            },
            None => None,
        };
        let tail = match &output {
            Some(output) => output.settled_snapshot(Duration::from_millis(300)).await,
            None => None,
        };
        let error = with_server_output(
            describe_exit(
                status.as_ref().and_then(|s| s.code()),
                status.as_ref().and_then(exit_signal),
                reader_reason,
            ),
            tail.as_deref(),
        );

        let mut servers = self.servers.lock().await;
        match servers.get_mut(server_id) {
            Some(handle) if handle.generation == generation => {
                handle.error = Some(error.clone());
                Some(error)
            }
            // Stopped or restarted while the exit was being examined.
            _ => None,
        }
    }

    pub fn stop_all_sync(&self) {
        let mut servers = match self.servers.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                log::warn!(target: "notesage::mcp", "Could not acquire server lock during shutdown");
                return;
            }
        };

        for (id, mut handle) in servers.drain() {
            log::info!(target: "notesage::mcp", "Stopping server {} on exit", id);
            // kill_on_drop will handle the process when Child is dropped.
            // http servers have no child to kill.
            if let Some(child) = handle.child.as_mut() {
                let _ = child.start_kill();
            }
        }
    }

    /// Check liveness of all running MCP server processes. HTTP servers have
    /// no PID; they report as alive (a request-based liveness ping is a
    /// follow-up). A server already known to be down (status `Error`) is not
    /// listed: its failure has been reported, and listing it as dead on every
    /// health check would announce the same death again and again.
    pub async fn check_processes(&self) -> Vec<crate::commands::health::ProcessStatus> {
        let mut servers = self.servers.lock().await;
        servers
            .iter_mut()
            .filter(|(_, handle)| matches!(handle.status, McpServerStatus::Running))
            .map(|(id, handle)| {
                let (alive, pid) = match handle.child.as_mut() {
                    Some(child) => {
                        let pid = child.id();
                        let alive = matches!(child.try_wait(), Ok(None));
                        (alive, pid)
                    }
                    None => (true, None),
                };
                crate::commands::health::ProcessStatus {
                    name: id.clone(),
                    alive,
                    pid,
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::{McpConfigSource, McpTransport};

    fn config(id: &str) -> McpServerConfig {
        McpServerConfig {
            id: id.to_string(),
            name: id.to_string(),
            command: "node".to_string(),
            args: vec!["server.js".to_string()],
            env: HashMap::new(),
            source: McpConfigSource::NotesageGlobal,
            enabled: true,
            transport: McpTransport::Stdio,
            url: None,
            headers: HashMap::new(),
            cwd: None,
        }
    }

    /// A handle that looks like a running stdio server whose process is `child`.
    fn running(id: &str, child: Option<Child>, generation: u64) -> McpServerHandle {
        McpServerHandle {
            config: config(id),
            child,
            conn: None,
            tools: vec![McpToolInfo {
                name: "echo".to_string(),
                description: None,
                input_schema: serde_json::json!({}),
                server_id: id.to_string(),
            }],
            status: McpServerStatus::Running,
            error: None,
            output: None,
            generation,
        }
    }

    #[test]
    fn mcp_state_new_and_stop_all_sync_no_panic() {
        let state = McpState::new();
        // stop_all_sync on empty state should be a no-op without panicking
        state.stop_all_sync();
    }

    #[test]
    fn describe_exit_prefers_the_exit_status() {
        assert_eq!(describe_exit(Some(3), None, "Server process exited: EOF"), "Server process exited (exit code 3)");
        assert_eq!(describe_exit(Some(0), None, ""), "Server process exited (exit code 0)");
        assert_eq!(describe_exit(None, Some(9), "x"), "Server process was terminated (signal 9)");
        assert_eq!(describe_exit(None, None, "Server process exited: EOF"), "Server process exited: EOF");
        assert_eq!(describe_exit(None, None, " "), "Server process exited");
    }

    #[tokio::test]
    async fn a_failed_start_is_registered_and_can_be_restarted_from() {
        // "Restart" on a failed server used to say "Server '…' not found":
        // failed starts were never registered.
        let state = McpState::new();
        assert!(state.config_for_restart("global:x").await.is_none());

        let generation = state.next_generation();
        state.register_failed(config("global:x"), "Command not found: 'nope'".to_string(), generation).await;

        let servers = state.servers.lock().await;
        let info = servers.get("global:x").expect("registered").to_info();
        drop(servers);
        assert!(matches!(info.status, McpServerStatus::Error));
        assert_eq!(info.error.as_deref(), Some("Command not found: 'nope'"));
        assert!(info.tools.is_empty());
        assert_eq!(state.config_for_restart("global:x").await.map(|c| c.command), Some("node".to_string()));
        // Known to be down: not reported as a dead process on every health check.
        assert!(state.check_processes().await.is_empty());
    }

    #[tokio::test]
    async fn a_stopped_server_can_still_be_restarted_by_id() {
        let state = McpState::new();
        state.remember_config(&config("global:y")).await;
        // Stopping removes the handle; the remembered config remains.
        assert!(state.servers.lock().await.is_empty());
        assert!(state.config_for_restart("global:y").await.is_some());
        assert!(state.config_for_restart("global:never-seen").await.is_none());
    }

    #[tokio::test]
    async fn an_older_failure_does_not_replace_a_newer_start() {
        let state = McpState::new();
        let old = state.next_generation();
        let new = state.next_generation();
        state.servers.lock().await.insert("global:z".to_string(), running("global:z", None, new));
        state.register_failed(config("global:z"), "late failure".to_string(), old).await;
        let servers = state.servers.lock().await;
        assert!(matches!(servers.get("global:z").unwrap().status, McpServerStatus::Running));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn process_exit_marks_the_server_failed_with_its_exit_code() {
        // The reader used to emit an event while the handle stayed `Running`,
        // so a status refresh showed a dead server as running with its tools.
        let state = McpState::new();
        let generation = state.next_generation();
        let child = tokio::process::Command::new("sh")
            .args(["-c", "exit 3"])
            .kill_on_drop(true)
            .spawn()
            .expect("spawn sh");
        state.servers.lock().await.insert("global:dead".to_string(), running("global:dead", Some(child), generation));

        let error = state
            .mark_exited("global:dead", generation, "Server process exited: EOF while reading (process exited)")
            .await
            .expect("a running server's exit is reported");
        assert_eq!(error, "Server process exited (exit code 3)");

        let servers = state.servers.lock().await;
        let info = servers.get("global:dead").expect("still registered").to_info();
        drop(servers);
        assert!(matches!(info.status, McpServerStatus::Error));
        assert_eq!(info.error.as_deref(), Some("Server process exited (exit code 3)"));
        assert!(info.tools.is_empty(), "a dead server offers no tools");
        // ... and it is reported once, not again.
        assert_eq!(state.mark_exited("global:dead", generation, "again").await, None);
    }

    #[tokio::test]
    async fn process_exit_includes_what_the_server_printed() {
        let state = McpState::new();
        let generation = state.next_generation();
        let output = StderrTail::default();
        output.push("Error: GITHUB_TOKEN is not set".to_string());
        let mut handle = running("global:said", None, generation);
        handle.output = Some(output);
        state.servers.lock().await.insert("global:said".to_string(), handle);

        let error = state.mark_exited("global:said", generation, "Server process exited: EOF").await.unwrap();
        assert_eq!(error, "Server process exited: EOF\n\nServer output:\nError: GITHUB_TOKEN is not set");
    }

    #[tokio::test]
    async fn the_exit_of_a_stopped_or_replaced_server_is_not_reported() {
        // Stop removes the handle before the reader sees EOF: the trailing
        // "error" used to overwrite "stopped" on the card.
        let state = McpState::new();
        let old = state.next_generation();
        assert_eq!(state.mark_exited("global:stopped", old, "EOF").await, None);

        // Restarted: the old reader's EOF must not fail the new handle.
        let new = state.next_generation();
        state.servers.lock().await.insert("global:r".to_string(), running("global:r", None, new));
        assert_eq!(state.mark_exited("global:r", old, "EOF").await, None);
        let servers = state.servers.lock().await;
        assert!(matches!(servers.get("global:r").unwrap().status, McpServerStatus::Running));
        assert_eq!(servers.get("global:r").unwrap().tools.len(), 1);
    }
}
