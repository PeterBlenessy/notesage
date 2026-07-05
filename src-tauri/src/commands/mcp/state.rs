//! MCP managed state: the registry of live server handles plus the
//! exit-cleanup and liveness paths. `stop_all_sync` / `start_kill` behaviour is
//! load-bearing for the `RunEvent::Exit` hook in `lib.rs` — preserve it exactly.

use std::collections::HashMap;
use tokio::process::Child;
use tokio::sync::Mutex;

use super::transport::McpConn;
use super::types::{McpServerConfig, McpServerInfo, McpServerStatus, McpToolInfo};

// ---------------------------------------------------------------------------
// MCP Server Handle
// ---------------------------------------------------------------------------

pub(crate) struct McpServerHandle {
    pub(crate) config: McpServerConfig,
    /// `Some` for stdio servers (the child process); `None` for http servers.
    pub(crate) child: Option<Child>,
    pub(crate) conn: McpConn,
    pub(crate) tools: Vec<McpToolInfo>,
    pub(crate) status: McpServerStatus,
    pub(crate) error: Option<String>,
}

impl McpServerHandle {
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
        }
    }
}

// ---------------------------------------------------------------------------
// MCP Managed State
// ---------------------------------------------------------------------------

pub struct McpState {
    pub(crate) servers: Mutex<HashMap<String, McpServerHandle>>,
}

impl McpState {
    pub fn new() -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
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

    /// Check liveness of all MCP server processes. HTTP servers have no PID;
    /// they report as alive (a request-based liveness ping is a follow-up).
    pub async fn check_processes(&self) -> Vec<crate::commands::health::ProcessStatus> {
        let mut servers = self.servers.lock().await;
        servers
            .iter_mut()
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

    #[test]
    fn mcp_state_new_and_stop_all_sync_no_panic() {
        let state = McpState::new();
        // stop_all_sync on empty state should be a no-op without panicking
        state.stop_all_sync();
    }
}
