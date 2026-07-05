//! MCP client command surface (thin IPC layer).
//!
//! This module holds only the 12 `#[tauri::command]` handlers — defined
//! directly here so `commands/mod.rs`'s `pub use mcp::*` keeps re-exporting
//! every command path that `lib.rs`'s `generate_handler![]` references. The
//! transport/protocol machinery, managed state, config parsing, catalog, and
//! security guard live in the submodules below.
//!
//! Submodules:
//! - [`types`] — wire/config data types + env-secret resolution (`resolve_env`)
//! - [`transport`] — stdio + HTTP transports, `McpConn`, protocol operations
//! - [`state`] — `McpState` / `McpServerHandle` (incl. exit-cleanup `stop_all_sync`)
//! - [`config`] — `mcp.json` / Claude Desktop / Cursor / VS Code parsing
//! - [`catalog`] — embedded curated server catalog
//! - [`validation`] — `validate_mcp_command` guard + dry-run helpers

mod catalog;
mod config;
mod state;
mod transport;
mod types;
mod validation;

// Public re-exports — preserve the `mcp::*` paths that cross-module importers
// (`acp.rs`, `logging.rs`, `health.rs`) and the frontend TypeScript bindings
// depend on.
pub use catalog::*;
pub use state::McpState;
pub use transport::HttpMcpClient;
pub use types::*;
pub use validation::validate_mcp_command;

// Internal helpers used by the command bodies below.
use catalog::load_catalog;
use config::{
    parse_claude_desktop_config, parse_config_file, parse_vscode_config, vscode_settings_path,
};
use crate::commands::shell_path::get_shell_path;
use state::McpServerHandle;
use transport::{
    mcp_call_tool_on_server, mcp_initialize, mcp_list_tools_from_server, spawn_mcp_transport,
    McpConn,
};
use validation::{map_spawn_error, read_stderr_tail, validation_error, MCP_VALIDATE_TIMEOUT};

use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tokio::process::Child;

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

    // Block inline-code launch commands before doing anything else. Applies to
    // stdio transport only (HTTP has no child process).
    if config.transport == McpTransport::Stdio {
        validate_mcp_command(&config.command, &config.args)?;
    }

    // Emit starting status
    let _ = app.emit(
        "mcp-server-status",
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

    // Establish the connection per transport, outside the lock.
    let (child, conn): (Option<Child>, McpConn) = match config.transport {
        McpTransport::Stdio => {
            let mut spawn_cmd = tokio::process::Command::new(&config.command);
            spawn_cmd
                .args(&config.args)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true);

            // Inject login shell PATH
            if let Some(shell_path) = get_shell_path() {
                spawn_cmd.env("PATH", shell_path);
            }
            // Inject configured environment variables (secrets resolved from keychain)
            for (key, val) in resolve_env(&config.id, &config.env) {
                spawn_cmd.env(key, val);
            }

            let mut child = spawn_cmd
                .spawn()
                .map_err(|e| format!("Failed to spawn MCP server '{}': {}", config.name, e))?;

            let child_pid = child.id();
            let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
            let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
            let transport =
                spawn_mcp_transport(stdin, stdout, child_pid, server_id.clone(), app.clone());
            (Some(child), McpConn::Stdio(transport))
        }
        McpTransport::Http => {
            let url = config
                .url
                .clone()
                .ok_or_else(|| format!("HTTP MCP server '{}' is missing a url", config.name))?;
            (None, McpConn::Http(HttpMcpClient::new(url, config.id.clone())))
        }
    };

    // Initialize the MCP protocol
    let _server_caps = mcp_initialize(&conn).await.map_err(|e| {
        format!(
            "MCP initialization failed for '{}': {}",
            config.name, e
        )
    })?;

    // Discover tools
    let tools = mcp_list_tools_from_server(&conn, &server_id)
        .await
        .unwrap_or_default();

    let handle = McpServerHandle {
        config: config.clone(),
        child,
        conn,
        tools: tools.clone(),
        status: McpServerStatus::Running,
        error: None,
    };

    let info = handle.to_info();

    // Re-acquire lock only to insert the ready handle
    state.servers.lock().await.insert(server_id.clone(), handle);

    // Emit running status
    let _ = app.emit(
        "mcp-server-status",
        serde_json::json!({
            "serverId": server_id,
            "status": "running",
            "tools": tools,
        }),
    );

    Ok(info)
}

/// Dry-run a candidate MCP server config: spawn → initialize → tools/list →
/// stop, without ever inserting it into `McpState`. Returns a structured
/// result so the Add/Edit dialog can preview tools (on success) or show an
/// actionable cause (on failure) before the config is written to disk.
#[tauri::command]
pub async fn mcp_validate_server(
    app: AppHandle,
    config: McpServerConfig,
) -> Result<McpValidationResult, String> {
    // Ephemeral id — never inserted into state. The reader loop may emit a
    // status event under this id when we kill the child; the frontend ignores
    // unknown ids, so no phantom server appears.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let ephemeral_id = format!("__validate__{}", nanos);

    // HTTP transport: no process to spawn — probe the endpoint directly.
    if config.transport == McpTransport::Http {
        let url = match config.url.clone() {
            Some(u) => u,
            None => {
                return Ok(validation_error(
                    "spawn_failed",
                    "HTTP transport requires a URL".to_string(),
                    None,
                ))
            }
        };
        let conn = McpConn::Http(HttpMcpClient::new(url, config.id.clone()));
        let probe = async {
            let caps = mcp_initialize(&conn).await?;
            let tools = mcp_list_tools_from_server(&conn, &ephemeral_id)
                .await
                .unwrap_or_default();
            Ok::<(Value, Vec<McpToolInfo>), String>((caps, tools))
        };
        return match tokio::time::timeout(MCP_VALIDATE_TIMEOUT, probe).await {
            Ok(Ok((caps, tools))) => Ok(McpValidationResult {
                ok: true,
                tools,
                server_info: caps.get("serverInfo").cloned(),
                error: None,
                error_kind: None,
                stderr_tail: None,
            }),
            Ok(Err(e)) => Ok(validation_error(
                "init_failed",
                format!("Couldn't complete the MCP handshake with '{}': {}", config.name, e),
                None,
            )),
            Err(_) => Ok(validation_error(
                "timeout",
                format!(
                    "Timed out after {}s waiting for '{}' to respond.",
                    MCP_VALIDATE_TIMEOUT.as_secs(),
                    config.name
                ),
                None,
            )),
        };
    }

    // Block inline-code launch commands during the dry-run too, so a malicious
    // mcp.json can't even be validated/previewed into looking legitimate.
    if let Err(e) = validate_mcp_command(&config.command, &config.args) {
        return Ok(validation_error("blocked_command", e, None));
    }

    let mut spawn_cmd = tokio::process::Command::new(&config.command);
    spawn_cmd
        .args(&config.args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(shell_path) = get_shell_path() {
        spawn_cmd.env("PATH", shell_path);
    }
    for (key, val) in resolve_env(&config.id, &config.env) {
        spawn_cmd.env(key, val);
    }

    let mut child = match spawn_cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let (kind, msg) = map_spawn_error(&e, &config.command);
            return Ok(validation_error(kind, msg, None));
        }
    };

    let child_pid = child.id();
    let stdin = match child.stdin.take() {
        Some(s) => s,
        None => {
            let _ = child.start_kill();
            return Ok(validation_error(
                "spawn_failed",
                "Failed to capture server stdin".to_string(),
                None,
            ));
        }
    };
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = child.start_kill();
            return Ok(validation_error(
                "spawn_failed",
                "Failed to capture server stdout".to_string(),
                None,
            ));
        }
    };
    let stderr = child.stderr.take();

    let conn = McpConn::Stdio(spawn_mcp_transport(
        stdin,
        stdout,
        child_pid,
        ephemeral_id.clone(),
        app.clone(),
    ));

    // Initialize + list tools under one overall budget.
    let probe = async {
        let caps = mcp_initialize(&conn).await?;
        let tools = mcp_list_tools_from_server(&conn, &ephemeral_id)
            .await
            .unwrap_or_default();
        Ok::<(Value, Vec<McpToolInfo>), String>((caps, tools))
    };
    let outcome = tokio::time::timeout(MCP_VALIDATE_TIMEOUT, probe).await;

    // Always tear down — validation servers are never kept alive.
    let _ = child.start_kill();
    let _ = child.wait().await;
    drop(conn);
    let stderr_tail = read_stderr_tail(stderr).await;

    match outcome {
        Ok(Ok((caps, tools))) => Ok(McpValidationResult {
            ok: true,
            tools,
            server_info: caps.get("serverInfo").cloned(),
            error: None,
            error_kind: None,
            stderr_tail,
        }),
        Ok(Err(e)) => Ok(validation_error(
            "init_failed",
            format!("The server started but did not complete the MCP handshake: {}", e),
            stderr_tail,
        )),
        Err(_) => Ok(validation_error(
            "timeout",
            format!(
                "Timed out after {}s waiting for the server to respond.",
                MCP_VALIDATE_TIMEOUT.as_secs()
            ),
            stderr_tail,
        )),
    }
}

#[tauri::command]
pub async fn mcp_stop_server(
    app: AppHandle,
    state: State<'_, McpState>,
    server_id: String,
) -> Result<(), String> {
    let mut servers = state.servers.lock().await;

    if let Some(mut handle) = servers.remove(&server_id) {
        // Stdio: kill the child. Http: dropping the handle is enough.
        if let Some(child) = handle.child.as_mut() {
            let _ = child.start_kill();
        }

        let _ = app.emit(
            "mcp-server-status",
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
    let config = {
        let servers = state.servers.lock().await;
        servers
            .get(&server_id)
            .map(|h| h.config.clone())
            .ok_or_else(|| format!("Server '{}' not found", server_id))?
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
        (handle.tools.clone(), handle.conn.clone_handle())
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
            handle.tools = tools.clone();
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
) -> Result<McpToolResult, String> {
    // Extract transport Arcs under the lock, then release before the network call
    let transport = {
        let servers = state.servers.lock().await;
        let handle = servers
            .get(&server_id)
            .ok_or_else(|| format!("Server '{}' not found or not running", server_id))?;
        handle.conn.clone_handle()
    };

    mcp_call_tool_on_server(&transport, &tool_name, arguments).await
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

#[tauri::command]
pub async fn mcp_discover_configs(
    base_dirs: Vec<String>,
) -> Result<Vec<McpServerConfig>, String> {
    let mut all_configs: Vec<McpServerConfig> = Vec::new();

    // Scan project config files (base_dirs are project paths, not global)
    for dir in &base_dirs {
        let path = PathBuf::from(dir).join(".notesage").join("mcp.json");
        if path.exists() {
            if let Ok(configs) = parse_config_file(&path, McpConfigSource::NotesageProject) {
                all_configs.extend(configs);
            }
        }
    }

    // Also check global ~/.notesage/mcp.json
    if let Some(home) = dirs::home_dir() {
        let global_path = home.join(".notesage").join("mcp.json");
        if global_path.exists() {
            if let Ok(configs) = parse_config_file(&global_path, McpConfigSource::NotesageGlobal) {
                // Only add if not already found via base_dirs
                for config in configs {
                    if !all_configs.iter().any(|c| c.id == config.id) {
                        all_configs.push(config);
                    }
                }
            }
        }
    }

    Ok(all_configs)
}

#[tauri::command]
pub async fn mcp_import_configs(source: String) -> Result<Vec<McpServerConfig>, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;

    match source.as_str() {
        "claude-desktop" => {
            // ~/.claude/claude_desktop_config.json
            let path = home.join(".claude").join("claude_desktop_config.json");
            if !path.exists() {
                return Ok(Vec::new());
            }
            parse_claude_desktop_config(&path)
        }
        "cursor" => {
            // ~/.cursor/mcp.json
            let path = home.join(".cursor").join("mcp.json");
            if !path.exists() {
                return Ok(Vec::new());
            }
            parse_config_file(&path, McpConfigSource::Cursor)
        }
        "vscode" => {
            let path = vscode_settings_path(&home);
            if !path.exists() {
                return Ok(Vec::new());
            }
            parse_vscode_config(&path)
        }
        _ => Err(format!("Unknown import source: {}", source)),
    }
}

#[tauri::command]
pub async fn mcp_save_config(
    path: String,
    configs: HashMap<String, McpConfigEntry>,
) -> Result<(), String> {
    let config_file = McpConfigFile {
        mcp_servers: configs,
    };

    let json = serde_json::to_string_pretty(&config_file)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    // Ensure parent directory exists
    let file_path = PathBuf::from(&path);
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

    let mut available = Vec::new();

    if home
        .join(".claude")
        .join("claude_desktop_config.json")
        .exists()
    {
        available.push("claude-desktop".to_string());
    }

    if home.join(".cursor").join("mcp.json").exists() {
        available.push("cursor".to_string());
    }

    if vscode_settings_path(&home).exists() {
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
