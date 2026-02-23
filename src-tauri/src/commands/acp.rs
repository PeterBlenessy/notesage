use serde::{Deserialize, Serialize};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::rc::Rc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, oneshot, Mutex};

use super::shell_path::get_shell_path;

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
pub struct SessionResult {
    pub session_id: String,
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
                eprintln!("[acp] Could not acquire agent lock during shutdown");
                return;
            }
        };

        for (instance_id, mut handle) in agents.drain() {
            eprintln!("[acp] Stopping agent {} on exit", instance_id);
            // Drop the channel sender to close the channel
            drop(handle.cmd_tx);
            // Wait for the OS thread to finish (child kill_on_drop handles the process)
            if let Some(th) = handle.thread_handle.take() {
                let _ = th.join();
            }
        }
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
        reply: oneshot::Sender<Result<String, String>>,
    },
    LoadSession {
        session_id: String,
        working_directory: String,
        reply: oneshot::Sender<Result<String, String>>,
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
    mut cmd_rx: mpsc::Receiver<AgentCmd>,
    init_tx: oneshot::Sender<Result<InitInfo, String>>,
) {
    use agent_client_protocol::*;
    use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("Failed to create tokio runtime for ACP agent");

    let local = tokio::task::LocalSet::new();

    local.block_on(&rt, async move {
        // Shared permission waiters for client ↔ command loop communication
        let permission_waiters: Rc<RefCell<HashMap<String, oneshot::Sender<PermissionReply>>>> =
            Rc::new(RefCell::new(HashMap::new()));

        let client = NotesageClient {
            app,
            instance_id,
            permission_waiters: Rc::clone(&permission_waiters),
            next_request_id: Cell::new(0),
        };

        // Spawn agent process — inject login shell PATH so the agent
        // (and its child processes) can find Node.js and other tools
        let mut spawn_cmd = tokio::process::Command::new(&agent_binary);
        spawn_cmd
            .args(&agent_args)
            .current_dir(&working_directory)
            .envs(&env_vars)
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

        // Bridge tokio IO → futures IO for ACP
        let stdin = child.stdin.take().unwrap().compat_write();
        let stdout = child.stdout.take().unwrap().compat();

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
                eprintln!("[acp] IO task error: {}", e);
            }
        });

        // Initialize handshake
        let init_req = InitializeRequest::new(ProtocolVersion::V1).client_info(
            Implementation::new("Notesage", env!("CARGO_PKG_VERSION")),
        );

        // Store auth methods from init response for later use
        let auth_method_ids: Vec<(String, String, Option<String>)>;

        match conn.initialize(init_req).await {
            Ok(resp) => {
                auth_method_ids = resp
                    .auth_methods
                    .iter()
                    .map(|m| {
                        (
                            m.id.to_string(),
                            m.name.clone(),
                            m.description.clone(),
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

                    let auth_req = AuthenticateRequest::new(AuthMethodId::new(
                        selected_id.clone(),
                    ));
                    match conn.authenticate(auth_req).await {
                        Ok(_) => {
                            let _ = reply.send(Ok(AuthStatus {
                                authenticated: true,
                                method_id: Some(selected_id),
                            }));
                        }
                        Err(e) => {
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
                            let _ = reply.send(Ok(resp.session_id.to_string()));
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
                        Ok(_) => {
                            // LoadSessionResponse doesn't return session_id —
                            // it was provided in the request.
                            let _ = reply.send(Ok(sid));
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
        // Homebrew (macOS Apple Silicon)
        PathBuf::from("/opt/homebrew/bin").join(agent_id),
        // Homebrew (macOS Intel) / system-level
        PathBuf::from("/usr/local/bin").join(agent_id),
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
    ];

    // nvm: scan for node versions
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            for entry in entries.flatten() {
                candidates.push(entry.path().join("bin").join(agent_id));
            }
        }
    }

    // 3. Bundled node_modules/.bin/ (development and Tauri resource path)
    candidates.push(
        std::env::current_dir()
            .unwrap_or_default()
            .join("node_modules/.bin")
            .join(agent_id),
    );
    candidates.push(
        app.path()
            .resource_dir()
            .unwrap_or_default()
            .join("node_modules/.bin")
            .join(agent_id),
    );

    for candidate in candidates {
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
    let candidates = [
        home.join(".local/bin").join(name),
        PathBuf::from("/opt/homebrew/bin").join(name),
        PathBuf::from("/usr/local/bin").join(name),
        home.join(".npm-global/bin").join(name),
        home.join("Library/pnpm").join(name),
        home.join(".local/share/pnpm").join(name),
        home.join(".volta/bin").join(name),
        home.join(".cargo/bin").join(name),
    ];

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
    agent_binary: String,
    agent_args: Option<Vec<String>>,
    role: AgentRole,
    working_directory: String,
    env_vars: Option<HashMap<String, String>>,
) -> Result<SpawnResult, String> {
    let env = env_vars.unwrap_or_default();
    let args = agent_args.unwrap_or_default();

    // Resolve the actual binary path (system PATH or bundled node_modules)
    let resolved_binary = resolve_agent_binary(&agent_binary, &app)
        .ok_or_else(|| format!("Agent binary '{}' not found", agent_binary))?;

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

    let (init_tx, init_rx) = oneshot::channel();
    let (cmd_tx, cmd_rx) = mpsc::channel(32);

    let binary = resolved_binary;
    let cwd = working_directory.clone();
    let iid = instance_id.clone();
    let spawn_args = args;

    let thread_handle = std::thread::Builder::new()
        .name(format!("acp-{}", &binary))
        .spawn(move || {
            run_agent_thread(app, iid, binary, spawn_args, cwd, env, cmd_rx, init_tx);
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

    let session_id = reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to new_session".to_string())??;

    Ok(SessionResult { session_id })
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

    let sid = reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to load_session".to_string())??;

    Ok(SessionResult { session_id: sid })
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
