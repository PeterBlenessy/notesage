use serde::Serialize;
use tauri::{AppHandle, State};
use super::watcher::WatcherState;
use super::acp::AcpState;
use super::copilot_lsp::CopilotLspState;
use super::mcp::McpState;

#[derive(Serialize, Clone)]
pub struct ProcessStatus {
    pub name: String,
    pub alive: bool,
    pub pid: Option<u32>,
}

#[derive(Serialize)]
pub struct HealthStatus {
    pub watcher_alive: bool,
    pub watched_paths: Vec<String>,
    pub acp_agents: Vec<ProcessStatus>,
    pub copilot_lsp: Option<ProcessStatus>,
    pub mcp_servers: Vec<ProcessStatus>,
}

/// No-op IPC liveness test — returns immediately.
#[tauri::command]
pub fn ping() -> Result<(), String> {
    Ok(())
}

/// Check health of all subsystems (watcher, ACP agents, Copilot LSP, MCP servers).
#[tauri::command]
pub async fn health_check(
    app: AppHandle,
    watcher: State<'_, WatcherState>,
    acp: State<'_, AcpState>,
    copilot: State<'_, CopilotLspState>,
    mcp: State<'_, McpState>,
) -> Result<HealthStatus, String> {
    // Check watcher (uses std::sync::Mutex — call from sync context)
    let (watcher_alive, watched_paths) = watcher.health_info();

    // Auto-recover watcher if it died but paths are still registered
    let (watcher_alive, watched_paths) = if !watcher_alive && !watched_paths.is_empty() {
        log::warn!(
            target: "notesage::health",
            "Watcher is dead with {} registered paths — attempting recovery",
            watched_paths.len()
        );
        match watcher.recover_watcher(&app) {
            Ok(()) => {
                log::info!(target: "notesage::health", "Watcher recovery succeeded");
            }
            Err(e) => {
                log::error!(target: "notesage::health", "Watcher recovery failed: {}", e);
            }
        }
        // Re-read health info after recovery attempt
        watcher.health_info()
    } else {
        (watcher_alive, watched_paths)
    };

    // Check ACP agents
    let acp_agents = acp.check_processes().await;

    // Check Copilot LSP
    let copilot_lsp = copilot.check_process().await;

    // Check MCP servers
    let mcp_servers = mcp.check_processes().await;

    let status = HealthStatus {
        watcher_alive,
        watched_paths,
        acp_agents,
        copilot_lsp,
        mcp_servers,
    };

    log::info!(
        target: "notesage::health",
        "Health check: watcher={}, acp={}/{} alive, copilot={}, mcp={}/{} alive",
        status.watcher_alive,
        status.acp_agents.iter().filter(|a| a.alive).count(),
        status.acp_agents.len(),
        status.copilot_lsp.as_ref().map_or("none".to_string(), |c| if c.alive { "alive".to_string() } else { "dead".to_string() }),
        status.mcp_servers.iter().filter(|s| s.alive).count(),
        status.mcp_servers.len(),
    );

    Ok(status)
}
