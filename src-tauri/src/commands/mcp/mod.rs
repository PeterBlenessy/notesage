//! MCP client command surface (thin IPC layer).
//!
//! This module holds only the 13 `#[tauri::command]` handlers — defined
//! directly here so `commands/mod.rs`'s `pub use mcp::*` keeps re-exporting
//! every command path that `lib.rs`'s `generate_handler![]` references. The
//! transport/protocol machinery, managed state, config parsing, catalog, and
//! security guard live in the submodules below.
//!
//! Submodules:
//! - [`types`] — wire/config data types + env-secret resolution (`resolve_env`)
//! - [`transport`] — stdio + HTTP transports, `McpConn`, protocol operations
//! - [`launch`] — connecting from a config: spawn environment, remote client
//! - [`state`] — `McpState` / `McpServerHandle` (incl. exit-cleanup `stop_all_sync`)
//! - [`config`] — `mcp.json` / Claude Desktop / Cursor / VS Code parsing
//! - [`catalog`] — embedded curated server catalog
//! - [`validation`] — `validate_mcp_command` guard + dry-run helpers
//! - [`stderr_drain`] — keeps a running stdio server's stderr pipe empty

mod catalog;
mod config;
mod launch;
mod state;
mod stderr_drain;
mod transport;
mod types;
mod validation;

// Public re-exports — preserve the `mcp::*` paths that cross-module importers
// (`acp.rs`, `logging.rs`, `health.rs`) and the frontend TypeScript bindings
// depend on.
pub use catalog::*;
pub use state::McpState;
pub use types::*;

// Internal helpers used by the command bodies below.
use catalog::load_catalog;
use config::{
    discover_notesage_configs, find_claude_desktop_config, find_vscode_configs,
    parse_claude_desktop_config, parse_config_file, parse_vscode_configs, render_config_file,
};
use launch::{connect_http, connect_stdio};
use state::McpServerHandle;
use stderr_drain::{with_server_output, StderrTail};
use transport::{
    mcp_call_tool_on_server, mcp_handshake, mcp_list_tools_from_server, resolve_tool_call_timeout,
    ExitHook, McpConn,
};
use validation::{validation_error, MCP_VALIDATE_TIMEOUT};

use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::process::Child;

/// The one status event the frontend listens to for MCP servers.
const STATUS_EVENT: &str = "mcp-server-status";

/// How long a failed start waits for the server's last stderr lines before
/// reporting without them.
const FAILURE_OUTPUT_PATIENCE: Duration = Duration::from_millis(400);

fn emit_error_status(app: &AppHandle, server_id: &str, error: &str) {
    let _ = app.emit(
        STATUS_EVENT,
        serde_json::json!({
            "serverId": server_id,
            "status": "error",
            "error": error,
        }),
    );
}

/// The hook a running server's reader loop calls when its stdout closes: mark
/// the server failed in `McpState` and tell the frontend, unless the server
/// was stopped or restarted meanwhile (`mark_exited` decides).
fn exit_hook(app: &AppHandle, server_id: &str, generation: u64) -> ExitHook {
    let app = app.clone();
    let server_id = server_id.to_string();
    Box::new(move |reason: String| {
        tokio::spawn(async move {
            let state = app.state::<McpState>();
            if let Some(error) = state.mark_exited(&server_id, generation, &reason).await {
                log::warn!(target: "notesage::mcp", "MCP server {} is down: {}", server_id, error);
                emit_error_status(&app, &server_id, &error);
            }
        });
    })
}

// ---------------------------------------------------------------------------
// Server lifecycle commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn mcp_start_server(
    app: AppHandle,
    state: State<'_, McpState>,
    config: McpServerConfig,
) -> Result<McpServerInfo, String> {
    let server_id = config.id.clone();
    let generation = state.next_generation();
    // Remembered before anything can fail, so "Restart" has something to
    // start from whatever happens next.
    state.remember_config(&config).await;

    // Emit starting status
    let _ = app.emit(
        STATUS_EVENT,
        serde_json::json!({
            "serverId": server_id,
            "status": "starting",
        }),
    );

    // Stop existing server with same ID if running (short lock)
    {
        let mut servers = state.servers.lock().await;
        if let Some(mut existing) = servers.remove(&server_id) {
            if let Some(child) = existing.child.as_mut() {
                let _ = child.start_kill();
            }
        }
    }

    match start_server(&app, &state, &config, generation).await {
        Ok(info) => Ok(info),
        Err(error) => {
            // What the server printed is logged at info, so a failed start
            // can be diagnosed from the log without raising the log level.
            log::info!(target: "notesage::mcp", "MCP server {} failed to start: {}", server_id, error);
            state
                .register_failed(config.clone(), error.clone(), generation)
                .await;
            emit_error_status(&app, &server_id, &error);
            Err(error)
        }
    }
}

/// Connect, handshake and register one server. Any error is the complete
/// message for the user, server output included.
async fn start_server(
    app: &AppHandle,
    state: &McpState,
    config: &McpServerConfig,
    generation: u64,
) -> Result<McpServerInfo, String> {
    let server_id = config.id.clone();

    // Establish the connection per transport, outside the lock. The launch
    // guard (inline-code commands, the app's data folder) runs inside
    // `connect_stdio`, on the expanded command.
    let mut output: Option<StderrTail> = None;
    let (mut child, conn): (Option<Child>, McpConn) = match config.transport {
        McpTransport::Stdio => {
            let hook = exit_hook(app, &server_id, generation);
            let connection =
                connect_stdio(config, &server_id, Some(hook)).map_err(|e| e.message)?;
            output = Some(connection.output);
            (Some(connection.child), connection.conn)
        }
        McpTransport::Http => (None, connect_http(config)?),
    };

    // Initialize the MCP protocol and discover tools.
    let tools = match mcp_handshake(&conn, &server_id, &config.name).await {
        Ok((_server_caps, tools)) => tools,
        Err(e) => {
            if let Some(child) = child.as_mut() {
                let _ = child.start_kill();
            }
            // What the server printed is usually the real reason it never
            // answered (missing API key, bad argument, a stack trace).
            let tail = match &output {
                Some(output) => output.settled_snapshot(FAILURE_OUTPUT_PATIENCE).await,
                None => None,
            };
            return Err(with_server_output(
                format!("MCP initialization failed for '{}': {}", config.name, e),
                tail.as_deref(),
            ));
        }
    };

    let handle = McpServerHandle {
        config: config.clone(),
        child,
        conn: Some(conn.clone_handle()),
        tools: tools.clone(),
        status: McpServerStatus::Running,
        error: None,
        output,
        generation,
    };

    let info = handle.to_info();

    // Re-acquire lock only to insert the ready handle. "running" is emitted
    // while the lock is held: the exit hook needs the same lock to mark the
    // server failed, so its "error" can only ever come after this event.
    let already_gone = {
        let mut servers = state.servers.lock().await;
        servers.insert(server_id.clone(), handle);
        if conn.is_closed() {
            true
        } else {
            let _ = app.emit(
                STATUS_EVENT,
                serde_json::json!({
                    "serverId": server_id,
                    "status": "running",
                    "tools": tools,
                }),
            );
            false
        }
    };

    // The process died between its last reply and the insert: its exit hook
    // found no handle to mark (or is marking it right now), so the start is
    // reported as the failure it is.
    if already_gone {
        let marked = state
            .mark_exited(&server_id, generation, "Server process exited")
            .await;
        let mut servers = state.servers.lock().await;
        let error = marked
            .or_else(|| servers.get(&server_id).and_then(|h| h.error.clone()))
            .unwrap_or_else(|| "Server process exited".to_string());
        // Taken out again: the caller registers the failure.
        servers.remove(&server_id);
        return Err(error);
    }

    Ok(info)
}

/// Dry-run a candidate MCP server config: spawn → initialize → tools/list →
/// stop, without ever inserting it into `McpState`. Returns a structured
/// result so the Add/Edit dialog can preview tools (on success) or show an
/// actionable cause (on failure) before the config is written to disk.
#[tauri::command]
pub async fn mcp_validate_server(config: McpServerConfig) -> Result<McpValidationResult, String> {
    // Ephemeral id — never inserted into state, and never the subject of a
    // status event (a validation run has no exit hook).
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let ephemeral_id = format!("__validate__{}", nanos);

    // Connect. HTTP has no process to spawn — the endpoint is probed directly.
    let mut output: Option<StderrTail> = None;
    let (mut child, conn): (Option<Child>, McpConn) = match config.transport {
        McpTransport::Http => match connect_http(&config) {
            Ok(conn) => (None, conn),
            Err(e) => return Ok(validation_error("spawn_failed", e, None)),
        },
        // The launch guard runs here too, so a malicious mcp.json can't even
        // be validated/previewed into looking legitimate.
        McpTransport::Stdio => match connect_stdio(&config, &ephemeral_id, None) {
            Ok(connection) => {
                output = Some(connection.output);
                (Some(connection.child), connection.conn)
            }
            Err(e) => return Ok(validation_error(e.kind, e.message, None)),
        },
    };

    // Initialize + list tools under one overall budget.
    let outcome = tokio::time::timeout(
        MCP_VALIDATE_TIMEOUT,
        mcp_handshake(&conn, &ephemeral_id, &config.name),
    )
    .await;

    // Always tear down — validation servers are never kept alive.
    if let Some(child) = child.as_mut() {
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
    drop(conn);
    let stderr_tail = match &output {
        Some(output) => output.settled_snapshot(FAILURE_OUTPUT_PATIENCE).await,
        None => None,
    };
    let is_remote = config.transport == McpTransport::Http;

    match outcome {
        Ok(Ok((caps, tools))) => Ok(McpValidationResult {
            ok: true,
            tools,
            server_info: caps.get("serverInfo").cloned(),
            error: None,
            error_kind: None,
            stderr_tail,
        }),
        Ok(Err(e)) => {
            let message = if is_remote {
                format!("Couldn't complete the MCP handshake with '{}': {}", config.name, e)
            } else {
                format!("The server started but did not complete the MCP handshake: {}", e)
            };
            Ok(validation_error("init_failed", message, stderr_tail))
        }
        Err(_) => {
            let message = if is_remote {
                format!(
                    "Timed out after {}s waiting for '{}' to respond.",
                    MCP_VALIDATE_TIMEOUT.as_secs(),
                    config.name
                )
            } else {
                format!(
                    "Timed out after {}s waiting for the server to respond.",
                    MCP_VALIDATE_TIMEOUT.as_secs()
                )
            };
            Ok(validation_error("timeout", message, stderr_tail))
        }
    }
}

#[tauri::command]
pub async fn mcp_stop_server(
    app: AppHandle,
    state: State<'_, McpState>,
    server_id: String,
) -> Result<(), String> {
    let mut servers = state.servers.lock().await;

    // Removing the handle BEFORE the kill is what keeps the reader loop's
    // exit from being reported: its hook finds no handle and stays silent, so
    // the card ends on "stopped" rather than "error".
    if let Some(mut handle) = servers.remove(&server_id) {
        // Stdio: kill the child. Http: dropping the handle is enough.
        if let Some(child) = handle.child.as_mut() {
            let _ = child.start_kill();
        }

        let _ = app.emit(
            STATUS_EVENT,
            serde_json::json!({
                "serverId": server_id,
                "status": "stopped",
            }),
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn mcp_restart_server(
    app: AppHandle,
    state: State<'_, McpState>,
    server_id: String,
) -> Result<McpServerInfo, String> {
    // A server that failed to start, exited, or was stopped has no running
    // handle, but it can still be restarted: from its failed handle, from the
    // config it was last started with, or, never having been started in this
    // session, from the global config file.
    let config = match state.config_for_restart(&server_id).await {
        Some(config) => config,
        None => discover_notesage_configs(&[], dirs::home_dir().as_deref())
            .configs
            .into_iter()
            .find(|c| c.id == server_id)
            .ok_or_else(|| {
                format!(
                    "Server '{}' has not been started in this session; start it instead",
                    server_id
                )
            })?,
    };

    // Stop existing
    mcp_stop_server(app.clone(), state.clone(), server_id).await?;

    // Start fresh
    mcp_start_server(app, state, config).await
}

// ---------------------------------------------------------------------------
// Tool commands
// ---------------------------------------------------------------------------

/// Cache-first read-through decision for `mcp_list_tools`: use the handle's
/// cached tools when the cache is non-empty and the caller did not ask for a
/// refresh; otherwise fall through to a live `tools/list` query. Pure so the
/// decision is unit-testable without a live server.
fn should_live_query_tools(cached_len: usize, refresh: Option<bool>) -> bool {
    refresh.unwrap_or(false) || cached_len == 0
}

fn not_running(server_id: &str) -> String {
    format!("Server '{}' is not running", server_id)
}

/// List a running server's tools — cache-first read-through.
///
/// Returns the cached tool list (populated at `mcp_start_server`) when it is
/// non-empty. When the cache is empty, or when `refresh: true` is passed, a
/// live `tools/list` is issued and the handle's cache is updated with the
/// result before returning. This unifies the previous split between the cached
/// `mcp_list_tools` and the live-query helper `mcp_list_tools_from_server`
/// (which remains as the transport-level helper used by start/validate).
#[tauri::command]
pub async fn mcp_list_tools(
    state: State<'_, McpState>,
    server_id: String,
    refresh: Option<bool>,
) -> Result<Vec<McpToolInfo>, String> {
    // Read the cache (and grab a connection handle for a possible live query)
    // under a short lock.
    let (cached, conn) = {
        let servers = state.servers.lock().await;
        let handle = servers
            .get(&server_id)
            .ok_or_else(|| format!("Server '{}' not found", server_id))?;
        let conn = handle
            .conn
            .as_ref()
            .ok_or_else(|| not_running(&server_id))?
            .clone_handle();
        (handle.tools.clone(), conn)
    };

    if !should_live_query_tools(cached.len(), refresh) {
        return Ok(cached);
    }

    // Live query outside the lock, then write the result back into the cache
    // (the server may have been stopped/removed meanwhile — skip silently).
    let tools = mcp_list_tools_from_server(&conn, &server_id).await?;
    {
        let mut servers = state.servers.lock().await;
        if let Some(handle) = servers.get_mut(&server_id) {
            if handle.conn.is_some() {
                handle.tools = tools.clone();
            }
        }
    }
    Ok(tools)
}

#[tauri::command]
pub async fn mcp_call_tool(
    state: State<'_, McpState>,
    server_id: String,
    tool_name: String,
    arguments: Value,
    // Optional per-call limit in milliseconds (`timeoutMs` over IPC). Omitted,
    // the call gets the default; see `resolve_tool_call_timeout`.
    timeout_ms: Option<u64>,
) -> Result<McpToolResult, String> {
    // Extract transport Arcs under the lock, then release before the network call
    let transport = {
        let servers = state.servers.lock().await;
        let handle = servers
            .get(&server_id)
            .ok_or_else(|| format!("Server '{}' not found or not running", server_id))?;
        handle
            .conn
            .as_ref()
            .ok_or_else(|| not_running(&server_id))?
            .clone_handle()
    };

    mcp_call_tool_on_server(
        &transport,
        &tool_name,
        arguments,
        resolve_tool_call_timeout(timeout_ms),
    )
    .await
}

#[tauri::command]
pub async fn mcp_get_server_status(
    state: State<'_, McpState>,
) -> Result<Vec<McpServerInfo>, String> {
    let servers = state.servers.lock().await;
    let infos: Vec<McpServerInfo> = servers.values().map(|h| h.to_info()).collect();
    Ok(infos)
}

// ---------------------------------------------------------------------------
// Config discovery / import / save commands
// ---------------------------------------------------------------------------

/// The servers defined in Notesage's config files (`base_dirs` are project
/// paths; the global `~/.notesage/mcp.json` is always included). Entries that
/// cannot be read are left out — see [`mcp_config_problems`] for those.
#[tauri::command]
pub async fn mcp_discover_configs(
    base_dirs: Vec<String>,
) -> Result<Vec<McpServerConfig>, String> {
    Ok(discover_notesage_configs(&base_dirs, dirs::home_dir().as_deref()).configs)
}

/// What is wrong with Notesage's config files: each entry (or whole file)
/// that [`mcp_discover_configs`] could not load, with the reason. Empty when
/// everything loaded. Takes the same project paths as discovery.
#[tauri::command]
pub async fn mcp_config_problems(
    project_paths: Vec<String>,
) -> Result<Vec<McpConfigProblem>, String> {
    let problems = discover_notesage_configs(&project_paths, dirs::home_dir().as_deref()).problems;
    for problem in &problems {
        log::warn!(target: "notesage::mcp", "MCP config problem ({}) '{}': {}", problem.source, problem.name, problem.reason);
    }
    Ok(problems)
}

#[tauri::command]
pub async fn mcp_import_configs(source: String) -> Result<Vec<McpServerConfig>, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let os = std::env::consts::OS;

    match source.as_str() {
        "claude-desktop" => match find_claude_desktop_config(&home, os) {
            Some(path) => parse_claude_desktop_config(&path),
            None => Ok(Vec::new()),
        },
        "cursor" => {
            // ~/.cursor/mcp.json
            let path = home.join(".cursor").join("mcp.json");
            if !path.exists() {
                return Ok(Vec::new());
            }
            parse_config_file(&path, McpConfigSource::Cursor)
        }
        "vscode" => {
            let paths = find_vscode_configs(&home, os);
            if paths.is_empty() {
                return Ok(Vec::new());
            }
            parse_vscode_configs(&paths)
        }
        _ => Err(format!("Unknown import source: {}", source)),
    }
}

/// Write `configs` as the `mcpServers` of the config file at `path`.
///
/// Each entry is a JSON object written verbatim (see
/// `config::render_config_file`): the frontend reads the file, changes one
/// entry and saves them all, and an entry this app cannot parse must survive
/// that round trip.
#[tauri::command]
pub async fn mcp_save_config(
    path: String,
    configs: serde_json::Map<String, Value>,
) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    let existing = std::fs::read_to_string(&file_path).ok();
    let json = render_config_file(existing.as_deref(), configs)?;

    // Ensure parent directory exists
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

/// Check which import sources are available on this system
#[tauri::command]
pub async fn mcp_check_import_sources() -> Result<Vec<String>, String> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Ok(Vec::new()),
    };
    let os = std::env::consts::OS;

    let mut available = Vec::new();

    if find_claude_desktop_config(&home, os).is_some() {
        available.push("claude-desktop".to_string());
    }

    if home.join(".cursor").join("mcp.json").exists() {
        available.push("cursor".to_string());
    }

    if !find_vscode_configs(&home, os).is_empty() {
        available.push("vscode".to_string());
    }

    Ok(available)
}

// ---------------------------------------------------------------------------
// Catalog command
// ---------------------------------------------------------------------------

/// Return the curated MCP server catalog (embedded at compile time).
#[tauri::command]
pub fn mcp_catalog_list() -> Result<Vec<McpCatalogItem>, String> {
    load_catalog()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_tools_uses_cache_when_populated_and_no_refresh() {
        // Cached hit: non-empty cache + no refresh → no live query.
        assert!(!should_live_query_tools(3, None));
        assert!(!should_live_query_tools(1, Some(false)));
    }

    #[test]
    fn list_tools_live_queries_when_cache_empty() {
        // Empty cache triggers a live query regardless of the refresh flag.
        assert!(should_live_query_tools(0, None));
        assert!(should_live_query_tools(0, Some(false)));
    }

    #[test]
    fn list_tools_refresh_forces_live_query() {
        // refresh: true forces a live query even with a populated cache.
        assert!(should_live_query_tools(5, Some(true)));
        assert!(should_live_query_tools(0, Some(true)));
    }
}
