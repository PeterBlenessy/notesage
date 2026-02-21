use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};
use tauri::State;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentAvailability {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
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
    Stop {
        reply: oneshot::Sender<Result<(), String>>,
    },
    // Future tasks (14-15) will add:
    // Authenticate { ... },
    // NewSession { ... },
    // Prompt { ... },
    // Cancel { ... },
}

/// Result of the initialize handshake, sent back to the spawning Tauri command.
struct InitInfo {
    agent_name: Option<String>,
    agent_version: Option<String>,
}

// ---------------------------------------------------------------------------
// Minimal ACP Client implementation
// ---------------------------------------------------------------------------

/// Notesage's implementation of the ACP Client trait.
/// For task 13 this is a minimal stub: auto-approves permissions
/// and silently accepts session notifications.
/// Task 15 will replace this with full Tauri event forwarding.
struct NotesageClient;

#[async_trait::async_trait(?Send)]
impl agent_client_protocol::Client for NotesageClient {
    async fn request_permission(
        &self,
        args: agent_client_protocol::RequestPermissionRequest,
    ) -> agent_client_protocol::Result<agent_client_protocol::RequestPermissionResponse> {
        use agent_client_protocol::{
            PermissionOptionKind, RequestPermissionOutcome, RequestPermissionResponse,
            SelectedPermissionOutcome,
        };

        // Auto-approve: pick the first AllowOnce or AllowAlways option
        let allow_option = args.options.iter().find(|o| {
            matches!(
                o.kind,
                PermissionOptionKind::AllowOnce | PermissionOptionKind::AllowAlways
            )
        });

        match allow_option {
            Some(opt) => Ok(RequestPermissionResponse::new(
                RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                    opt.option_id.clone(),
                )),
            )),
            None => {
                // No allow option available — cancel
                Ok(RequestPermissionResponse::new(
                    RequestPermissionOutcome::Cancelled,
                ))
            }
        }
    }

    async fn session_notification(
        &self,
        _args: agent_client_protocol::SessionNotification,
    ) -> agent_client_protocol::Result<()> {
        // Silently accept — task 15 will forward as Tauri events
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Agent thread: owns the !Send ClientSideConnection
// ---------------------------------------------------------------------------

/// Runs on a dedicated OS thread with a single-threaded tokio runtime + LocalSet.
/// This is necessary because ClientSideConnection is !Send (uses LocalBoxFuture).
fn run_agent_thread(
    agent_binary: String,
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
        // Spawn agent process
        let mut child = match tokio::process::Command::new(&agent_binary)
            .current_dir(&working_directory)
            .envs(&env_vars)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
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
            NotesageClient,
            stdin,  // outgoing: client writes to agent's stdin
            stdout, // incoming: client reads from agent's stdout
            |fut| {
                tokio::task::spawn_local(fut);
            },
        );

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

        match conn.initialize(init_req).await {
            Ok(resp) => {
                let info = InitInfo {
                    agent_name: resp.agent_info.as_ref().map(|i| i.name.clone()),
                    agent_version: resp.agent_info.as_ref().map(|i| i.version.clone()),
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
                AgentCmd::Stop { reply } => {
                    // Drop connection to trigger graceful shutdown
                    drop(conn);
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

/// Check whether an ACP agent binary is installed on the system.
#[tauri::command]
pub async fn acp_agent_check_availability(
    agent_id: String,
) -> Result<AgentAvailability, String> {
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let path = match Command::new(which_cmd).arg(&agent_id).output() {
        Ok(output) if output.status.success() => {
            let p = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();
            if p.is_empty() {
                None
            } else {
                Some(p)
            }
        }
        _ => None,
    };

    if path.is_none() {
        return Ok(AgentAvailability {
            installed: false,
            path: None,
            version: None,
        });
    }

    let version = match Command::new(&agent_id).arg("--version").output() {
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

    Ok(AgentAvailability {
        installed: true,
        path,
        version,
    })
}

/// Spawn an ACP agent subprocess, initialize the connection, and return an instance ID.
#[tauri::command]
pub async fn acp_agent_spawn(
    state: State<'_, AcpState>,
    agent_binary: String,
    role: AgentRole,
    working_directory: String,
    env_vars: Option<HashMap<String, String>>,
) -> Result<SpawnResult, String> {
    let env = env_vars.unwrap_or_default();

    let (init_tx, init_rx) = oneshot::channel();
    let (cmd_tx, cmd_rx) = mpsc::channel(32);

    let binary = agent_binary.clone();
    let cwd = working_directory.clone();

    let thread_handle = std::thread::Builder::new()
        .name(format!("acp-{}", &binary))
        .spawn(move || {
            run_agent_thread(binary, cwd, env, cmd_rx, init_tx);
        })
        .map_err(|e| format!("Failed to spawn agent thread: {}", e))?;

    // Wait for initialization result from the agent thread
    let init_result = init_rx
        .await
        .map_err(|_| "Agent thread exited unexpectedly during initialization".to_string())?;
    let init_info = init_result?;

    // Generate instance ID
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let instance_id = format!(
        "acp-{}-{}",
        ts,
        &format!("{:x}", ts.wrapping_mul(6364136223846793005).wrapping_add(1))[..8]
    );

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
    })
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
