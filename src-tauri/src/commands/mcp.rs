use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, BufReader, BufWriter};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;
use tokio::time::timeout;

use super::json_rpc::{
    self, JsonRpcMessage, JsonRpcNotification, JsonRpcRequest, PendingRequests,
};
use super::shell_path::get_shell_path;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub source: McpConfigSource,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum McpConfigSource {
    NotesageGlobal,
    NotesageProject,
    ClaudeDesktop,
    Cursor,
    VsCode,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum McpServerStatus {
    Stopped,
    Starting,
    Running,
    Error,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpServerInfo {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub source: McpConfigSource,
    pub enabled: bool,
    pub status: McpServerStatus,
    pub error: Option<String>,
    pub tools: Vec<McpToolInfo>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpToolInfo {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Value,
    pub server_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpToolResult {
    pub content: Vec<McpContent>,
    pub is_error: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: Option<String>,
    pub data: Option<String>,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
}

// ---------------------------------------------------------------------------
// MCP Transport
// ---------------------------------------------------------------------------

struct McpTransport {
    writer: Arc<Mutex<BufWriter<ChildStdin>>>,
    pending: PendingRequests,
}

impl McpTransport {
    /// Create a lightweight clone of the Arc-wrapped transport fields for use outside the mutex.
    fn clone_handle(&self) -> Self {
        Self {
            writer: self.writer.clone(),
            pending: self.pending.clone(),
        }
    }

    fn new(stdin: ChildStdin, stdout: ChildStdout, child_pid: Option<u32>, server_id: String, app: AppHandle) -> Self {
        let writer = Arc::new(Mutex::new(BufWriter::new(stdin)));
        let pending = json_rpc::new_pending_requests();

        let reader_pending = pending.clone();

        tokio::spawn(async move {
            if let Err(e) = mcp_reader_loop(stdout, reader_pending, child_pid, &server_id, &app).await {
                log::error!(target: "notesage::mcp", "Reader loop exited for server {}: {}", server_id, e);
                let _ = app.emit(
                    "mcp-server-status",
                    serde_json::json!({
                        "serverId": server_id,
                        "status": "error",
                        "error": format!("Server process exited: {}", e),
                    }),
                );
            }
        });

        Self {
            writer,
            pending,
        }
    }

    async fn send_request(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = json_rpc::next_request_id();

        let msg = JsonRpcRequest::new(id, method, params);

        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        let json_str = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        let mut writer = self.writer.lock().await;
        json_rpc::write_message(&mut *writer, &json_str).await?;
        drop(writer);

        match rx.await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(rpc_err)) => Err(rpc_err.to_string()),
            Err(_) => Err("Response channel closed (MCP server may have exited)".to_string()),
        }
    }

    async fn send_notification(&self, method: &str, params: Option<Value>) -> Result<(), String> {
        let msg = JsonRpcNotification::new(method, params);

        let json_str = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        let mut writer = self.writer.lock().await;
        json_rpc::write_message(&mut *writer, &json_str).await
    }
}

// ---------------------------------------------------------------------------
// Reader loop
// ---------------------------------------------------------------------------

const MCP_READER_TIMEOUT: Duration = Duration::from_secs(30);

async fn mcp_reader_loop(
    stdout: ChildStdout,
    pending: PendingRequests,
    child_pid: Option<u32>,
    server_id: &str,
    app: &AppHandle,
) -> Result<(), String> {
    let mut reader = BufReader::new(stdout);

    loop {
        let content_length = match timeout(MCP_READER_TIMEOUT, json_rpc::read_content_length(&mut reader)).await {
            Ok(result) => result?,
            Err(_) => {
                log::warn!(target: "notesage::mcp", "Reader timeout for server {} — checking process health", server_id);
                if !json_rpc::is_process_alive(child_pid) {
                    log::error!(target: "notesage::mcp", "MCP server {} process is dead after reader timeout", server_id);
                    let _ = app.emit(
                        "mcp-server-status",
                        serde_json::json!({
                            "serverId": server_id,
                            "status": "error",
                            "error": "Server process exited unexpectedly",
                        }),
                    );
                    return Err(format!("MCP server {} process died during header read", server_id));
                }
                // Process is alive but slow — retry
                continue;
            }
        };

        let mut body = vec![0u8; content_length];
        match timeout(MCP_READER_TIMEOUT, reader.read_exact(&mut body)).await {
            Ok(result) => {
                result.map_err(|e| format!("Failed to read body: {}", e))?;
            }
            Err(_) => {
                log::warn!(target: "notesage::mcp", "Reader timeout reading body for server {} — checking process health", server_id);
                if !json_rpc::is_process_alive(child_pid) {
                    log::error!(target: "notesage::mcp", "MCP server {} process is dead after body read timeout", server_id);
                    let _ = app.emit(
                        "mcp-server-status",
                        serde_json::json!({
                            "serverId": server_id,
                            "status": "error",
                            "error": "Server process exited unexpectedly",
                        }),
                    );
                    return Err(format!("MCP server {} process died during body read", server_id));
                }
                continue;
            }
        };

        let body_str =
            String::from_utf8(body).map_err(|e| format!("Invalid UTF-8 in body: {}", e))?;

        let msg: JsonRpcMessage = match serde_json::from_str(&body_str) {
            Ok(m) => m,
            Err(e) => {
                log::warn!(target: "notesage::mcp", "Failed to parse message from server {}: {} — {}", server_id, e, &body_str[..body_str.len().min(200)]);
                continue;
            }
        };

        // MCP servers primarily send responses. We don't handle server-initiated
        // requests or notifications in v1 (no sampling, no notifications support).
        json_rpc::dispatch_response(&pending, &msg).await;
    }
}

// ---------------------------------------------------------------------------
// MCP Server Handle
// ---------------------------------------------------------------------------

struct McpServerHandle {
    config: McpServerConfig,
    child: Child,
    transport: McpTransport,
    tools: Vec<McpToolInfo>,
    status: McpServerStatus,
    error: Option<String>,
}

impl McpServerHandle {
    fn to_info(&self) -> McpServerInfo {
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
        }
    }
}

// ---------------------------------------------------------------------------
// MCP Managed State
// ---------------------------------------------------------------------------

pub struct McpState {
    servers: Mutex<HashMap<String, McpServerHandle>>,
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
            // kill_on_drop will handle the process when Child is dropped
            let _ = handle.child.start_kill();
        }
    }

    /// Check liveness of all MCP server processes.
    pub async fn check_processes(&self) -> Vec<super::health::ProcessStatus> {
        let mut servers = self.servers.lock().await;
        servers
            .iter_mut()
            .map(|(id, handle)| {
                let pid = handle.child.id();
                let alive = match handle.child.try_wait() {
                    Ok(None) => true,
                    Ok(Some(_)) => false,
                    Err(_) => false,
                };
                super::health::ProcessStatus {
                    name: id.clone(),
                    alive,
                    pid,
                }
            })
            .collect()
    }
}

// ---------------------------------------------------------------------------
// MCP Protocol Operations
// ---------------------------------------------------------------------------

async fn mcp_initialize(transport: &McpTransport) -> Result<Value, String> {
    let init_params = serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {
            "name": "notesage",
            "version": "1.0.0"
        }
    });

    let result = transport
        .send_request("initialize", Some(init_params))
        .await?;

    // Send initialized notification
    transport
        .send_notification("notifications/initialized", None)
        .await?;

    Ok(result)
}

async fn mcp_list_tools_from_server(
    transport: &McpTransport,
    server_id: &str,
) -> Result<Vec<McpToolInfo>, String> {
    let result = transport
        .send_request("tools/list", Some(serde_json::json!({})))
        .await?;

    let tools_arr = result
        .get("tools")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut tools = Vec::new();
    for tool_val in tools_arr {
        let name = tool_val
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let description = tool_val
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let input_schema = tool_val
            .get("inputSchema")
            .cloned()
            .unwrap_or(serde_json::json!({}));

        if !name.is_empty() {
            tools.push(McpToolInfo {
                name,
                description,
                input_schema,
                server_id: server_id.to_string(),
            });
        }
    }

    Ok(tools)
}

async fn mcp_call_tool_on_server(
    transport: &McpTransport,
    tool_name: &str,
    arguments: Value,
) -> Result<McpToolResult, String> {
    let params = serde_json::json!({
        "name": tool_name,
        "arguments": arguments,
    });

    let result = transport.send_request("tools/call", Some(params)).await?;

    let is_error = result
        .get("isError")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let content_arr = result
        .get("content")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let content: Vec<McpContent> = content_arr
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect();

    Ok(McpToolResult { content, is_error })
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn mcp_start_server(
    app: AppHandle,
    state: State<'_, McpState>,
    config: McpServerConfig,
) -> Result<McpServerInfo, String> {
    let server_id = config.id.clone();

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
            let _ = existing.child.start_kill();
        }
    }

    // Spawn process and perform initialization outside the lock
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

    // Inject configured environment variables
    for (key, val) in &config.env {
        spawn_cmd.env(key, val);
    }

    let mut child = spawn_cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn MCP server '{}': {}", config.name, e))?;

    let child_pid = child.id();
    let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

    let transport = McpTransport::new(stdin, stdout, child_pid, server_id.clone(), app.clone());

    // Initialize the MCP protocol
    let _server_caps = mcp_initialize(&transport).await.map_err(|e| {
        format!(
            "MCP initialization failed for '{}': {}",
            config.name, e
        )
    })?;

    // Discover tools
    let tools = mcp_list_tools_from_server(&transport, &server_id)
        .await
        .unwrap_or_default();

    let handle = McpServerHandle {
        config: config.clone(),
        child,
        transport,
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

#[tauri::command]
pub async fn mcp_stop_server(
    app: AppHandle,
    state: State<'_, McpState>,
    server_id: String,
) -> Result<(), String> {
    let mut servers = state.servers.lock().await;

    if let Some(mut handle) = servers.remove(&server_id) {
        let _ = handle.child.start_kill();

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

#[tauri::command]
pub async fn mcp_list_tools(
    state: State<'_, McpState>,
    server_id: String,
) -> Result<Vec<McpToolInfo>, String> {
    let servers = state.servers.lock().await;
    let handle = servers
        .get(&server_id)
        .ok_or_else(|| format!("Server '{}' not found", server_id))?;

    Ok(handle.tools.clone())
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
        handle.transport.clone_handle()
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
// Config File Parsing & Import
// ---------------------------------------------------------------------------

/// Config file entry (matches Claude Desktop format)
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpConfigEntry {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: HashMap<String, String>,
    #[serde(default)]
    disabled: bool,
}

/// Config file format
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpConfigFile {
    #[serde(rename = "mcpServers", default)]
    mcp_servers: HashMap<String, McpConfigEntry>,
}

fn source_prefix(source: &McpConfigSource) -> &'static str {
    match source {
        McpConfigSource::NotesageGlobal => "global",
        McpConfigSource::NotesageProject => "project",
        McpConfigSource::ClaudeDesktop => "claude",
        McpConfigSource::Cursor => "cursor",
        McpConfigSource::VsCode => "vscode",
    }
}

fn map_config_entries(
    entries: HashMap<String, McpConfigEntry>,
    source: McpConfigSource,
) -> Vec<McpServerConfig> {
    entries
        .into_iter()
        .map(|(name, entry)| {
            // Project-scoped MCP servers default to disabled for security —
            // prevents auto-execution of commands from cloned repos
            let enabled = if source == McpConfigSource::NotesageProject {
                false
            } else {
                !entry.disabled
            };
            McpServerConfig {
                id: format!("{}:{}", source_prefix(&source), name),
                name,
                command: entry.command,
                args: entry.args,
                env: entry.env,
                source: source.clone(),
                enabled,
            }
        })
        .collect()
}

fn parse_config_file(
    path: &PathBuf,
    source: McpConfigSource,
) -> Result<Vec<McpServerConfig>, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let config: McpConfigFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;

    Ok(map_config_entries(config.mcp_servers, source))
}

/// Parse Claude Desktop config which wraps mcpServers inside a larger config
fn parse_claude_desktop_config(path: &PathBuf) -> Result<Vec<McpServerConfig>, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let full_config: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;

    let mcp_servers = full_config
        .get("mcpServers")
        .cloned()
        .unwrap_or(Value::Object(serde_json::Map::new()));

    let servers: HashMap<String, McpConfigEntry> = serde_json::from_value(mcp_servers)
        .map_err(|e| format!("Failed to parse mcpServers: {}", e))?;

    Ok(map_config_entries(servers, McpConfigSource::ClaudeDesktop))
}

fn vscode_settings_path(home: &std::path::Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        home.join("Library")
            .join("Application Support")
            .join("Code")
            .join("User")
            .join("settings.json")
    } else if cfg!(target_os = "windows") {
        home.join("AppData")
            .join("Roaming")
            .join("Code")
            .join("User")
            .join("settings.json")
    } else {
        home.join(".config")
            .join("Code")
            .join("User")
            .join("settings.json")
    }
}

/// Parse VS Code settings which have mcp servers under a different key structure
fn parse_vscode_config(path: &PathBuf) -> Result<Vec<McpServerConfig>, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let settings: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;

    // VS Code stores MCP servers under "mcp.servers" or "mcp" > "servers"
    let servers_val = settings
        .get("mcp")
        .and_then(|v| v.get("servers"))
        .or_else(|| settings.get("mcp.servers"))
        .cloned()
        .unwrap_or(Value::Object(serde_json::Map::new()));

    let servers: HashMap<String, McpConfigEntry> = serde_json::from_value(servers_val)
        .map_err(|e| format!("Failed to parse mcp.servers: {}", e))?;

    Ok(map_config_entries(servers, McpConfigSource::VsCode))
}

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
