//! Copilot Language Server (LSP) integration.
//!
//! This module is the orchestrator — it owns the `CopilotLspState` managed
//! state, binary resolution, and all `#[tauri::command]` functions.
//!
//! Internal concerns are delegated to sub-modules:
//! - [`copilot_protocol`] — JSON-RPC transport layer, reader loop, server→client handlers
//! - [`copilot_signin`]   — Device code auth helpers (field extraction)
//! - [`copilot_models`]   — `CopilotModel` type, parser, fallback list

#[path = "copilot_protocol.rs"]
mod copilot_protocol;
#[path = "copilot_signin.rs"]
mod copilot_signin;
#[path = "copilot_models.rs"]
mod copilot_models;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::process::Child;
use tokio::sync::Mutex;

use super::json_rpc;
use super::shell_path::get_shell_path;
use super::constants;

pub use copilot_models::CopilotModel;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "PascalCase")]
pub enum CopilotStatusKind {
    Normal,
    Error,
    Warning,
    Inactive,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CopilotStatus {
    pub authenticated: bool,
    pub message: String,
    pub kind: CopilotStatusKind,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InlineCompletionItem {
    pub insert_text: String,
    pub range: Option<CompletionRange>,
    pub command: Option<CompletionCommand>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CompletionRange {
    pub start: LspPosition,
    pub end: LspPosition,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LspPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CompletionCommand {
    pub command: String,
    pub arguments: Option<Vec<Value>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SignInResponse {
    pub user_code: String,
    pub verification_uri: String,
}

/// Pending server→client request responses (tool calls, context requests).
/// Key: a unique request correlation ID, Value: oneshot sender for the response.
pub(crate) type PendingServerRequests = Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>>;

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

pub struct CopilotLspState {
    pub process: Mutex<Option<CopilotLspProcess>>,
}

pub struct CopilotLspProcess {
    pub transport: json_rpc::JsonRpcTransport,
    pub child: Child,
    pub status: tokio::sync::Mutex<CopilotStatus>,
    /// Stashed embedded command from signIn response (e.g. finishDeviceFlow).
    /// The frontend calls `copilot_lsp_finish_auth` to trigger it when the user
    /// clicks "Open GitHub", so the browser doesn't open before the code is shown.
    pub pending_auth_command: tokio::sync::Mutex<Option<(String, Value)>>,
    /// Active conversation IDs for cleanup on LSP stop/crash.
    pub active_conversations: tokio::sync::Mutex<Vec<String>>,
    /// Pending server→client request responses (context requests, tool calls).
    /// The reader loop inserts a oneshot sender; a Tauri command resolves it.
    pub pending_server_requests: PendingServerRequests,
}

impl CopilotLspState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }

    /// Check liveness of the Copilot LSP process.
    pub async fn check_process(&self) -> Option<super::health::ProcessStatus> {
        let mut guard = self.process.lock().await;
        let proc = guard.as_mut()?;
        let pid = proc.child.id();
        let alive = match proc.child.try_wait() {
            Ok(None) => true,  // Still running
            Ok(Some(_)) => false, // Exited
            Err(_) => false,
        };
        Some(super::health::ProcessStatus {
            name: "copilot-language-server".to_string(),
            alive,
            pid,
        })
    }
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

const COPILOT_BINARY: &str = "copilot-language-server";

/// Resolve the path to the copilot-language-server binary.
/// Checks: 1) system PATH via `which`, 2) common npm global install locations,
/// 3) bundled node_modules relative to the app.
fn resolve_copilot_binary(app: &AppHandle) -> Option<String> {
    // 0. Check managed install directory (~/.notesage/agents/bin/)
    let managed_bin = dirs::home_dir()
        .unwrap_or_default()
        .join(".notesage/agents/bin")
        .join(COPILOT_BINARY);
    if managed_bin.exists() {
        return Some(managed_bin.to_string_lossy().to_string());
    }

    // 1. Check PATH via `which` — use login shell PATH if available
    //    (macOS GUI apps have a minimal inherited PATH)
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let mut cmd = Command::new(which_cmd);
    cmd.arg(COPILOT_BINARY);
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

    // 2. Check common npm global install locations (Tauri GUI apps don't inherit shell PATH)
    let home = dirs::home_dir().unwrap_or_default();
    let mut candidates: Vec<PathBuf> = Vec::new();
    // Homebrew (macOS)
    for path in constants::MACOS_FALLBACK_BIN_PATHS {
        candidates.push(PathBuf::from(path).join(COPILOT_BINARY));
    }
    candidates.extend([
        // npm global (default)
        home.join(".npm-global/bin").join(COPILOT_BINARY),
        // pnpm global
        home.join("Library/pnpm").join(COPILOT_BINARY),
        home.join(".local/share/pnpm").join(COPILOT_BINARY),
    ]);

    // nvm: scan for node versions
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            for entry in entries.flatten() {
                candidates.push(entry.path().join("bin").join(COPILOT_BINARY));
            }
        }
    }

    // 3. Bundled node_modules (dev and Tauri resource path)
    candidates.push(
        std::env::current_dir()
            .unwrap_or_default()
            .join("node_modules/.bin")
            .join(COPILOT_BINARY),
    );
    candidates.push(
        app.path()
            .resource_dir()
            .unwrap_or_default()
            .join("node_modules/.bin")
            .join(COPILOT_BINARY),
    );

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Tauri commands — lifecycle
// ---------------------------------------------------------------------------

/// Check whether the copilot-language-server binary is installed.
#[tauri::command]
pub async fn copilot_lsp_check_availability(app: AppHandle) -> Result<bool, String> {
    Ok(resolve_copilot_binary(&app).is_some())
}

/// Start the Copilot LSP server process and complete the initialize handshake.
/// If an LSP is already running, updates the workspace folder via
/// `workspace/didChangeWorkspaceFolders` instead of restarting.
#[tauri::command]
pub async fn copilot_lsp_start(
    app: AppHandle,
    state: State<'_, CopilotLspState>,
    working_directory: String,
) -> Result<(), String> {
    let mut guard = state.process.lock().await;

    // If already running, reuse and update workspace folder
    if let Some(proc) = guard.as_mut() {
        match proc.child.try_wait() {
            Ok(Some(_)) => {
                // Process already exited — clear stale state, restart below
                *guard = None;
            }
            Ok(None) => {
                // Still running — update workspace folder instead of restarting
                let new_uri = copilot_protocol::path_to_uri(&working_directory);
                let folder_name = working_directory.rsplit('/').next().unwrap_or("workspace");

                proc.transport
                    .send_notification(
                        "workspace/didChangeWorkspaceFolders",
                        Some(serde_json::json!({
                            "event": {
                                "added": [{
                                    "uri": new_uri,
                                    "name": folder_name,
                                }],
                                "removed": [],
                            },
                        })),
                    )
                    .await
                    .map_err(|e| format!("Failed to update workspace folders: {}", e))?;

                return Ok(());
            }
            Err(_) => {
                *guard = None;
            }
        }
    }

    let binary_path = resolve_copilot_binary(&app)
        .ok_or_else(|| "copilot-language-server not found. Install via: npm install -g @github/copilot-language-server".to_string())?;

    // Spawn the LSP process — inject login shell PATH so the process
    // (a Node.js script) can find Node and other dependencies
    let mut spawn_cmd = tokio::process::Command::new(&binary_path);
    spawn_cmd
        .arg("--stdio")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    if let Some(shell_path) = get_shell_path() {
        spawn_cmd.env("PATH", shell_path);
    }
    let mut child = spawn_cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn copilot-language-server: {}", e))?;

    let child_pid = child.id();
    let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

    // Create the JSON-RPC transport (spawns reader loop)
    let pending_server_requests: PendingServerRequests = Arc::new(Mutex::new(HashMap::new()));
    let transport = copilot_protocol::spawn_copilot_transport(
        stdin, stdout, child_pid, app.clone(), pending_server_requests.clone(),
    );

    // Read app version from package.json (via Tauri config)
    let app_version = app
        .config()
        .version
        .clone()
        .unwrap_or_else(|| "0.0.0".to_string());

    // --- LSP initialize handshake ---

    // 1. Send initialize request
    let workspace_uri = copilot_protocol::path_to_uri(&working_directory);

    let init_params = serde_json::json!({
        "processId": std::process::id(),
        "workspaceFolders": [{
            "uri": workspace_uri,
            "name": working_directory.rsplit('/').next().unwrap_or("workspace"),
        }],
        "capabilities": {
            "workspace": {
                "workspaceFolders": true,
                "configuration": true,
            },
            "textDocument": {
                "synchronization": {
                    "dynamicRegistration": false,
                    "willSave": false,
                    "didSave": false,
                    "willSaveWaitUntil": false,
                },
                "inlineCompletion": {
                    "dynamicRegistration": false,
                },
            },
        },
        "initializationOptions": {
            "editorInfo": {
                "name": "Notesage",
                "version": app_version,
            },
            "editorPluginInfo": {
                "name": "notesage-copilot",
                "version": app_version,
            },
        },
    });

    transport
        .send_request("initialize", Some(init_params))
        .await
        .map_err(|e| format!("LSP initialize failed: {}", e))?;

    // 2. Send initialized notification
    transport
        .send_notification("initialized", Some(serde_json::json!({})))
        .await
        .map_err(|e| format!("LSP initialized notification failed: {}", e))?;

    // 3. Send configuration: enable copilot + inline suggestions, disable telemetry
    transport
        .send_notification(
            "workspace/didChangeConfiguration",
            Some(serde_json::json!({
                "settings": {
                    "telemetry": { "telemetryLevel": "off" },
                    "github.copilot": {
                        "enable": { "*": true, "markdown": true },
                        "inlineSuggest.enable": true,
                    },
                },
            })),
        )
        .await
        .map_err(|e| format!("LSP didChangeConfiguration failed: {}", e))?;

    let status = CopilotStatus {
        authenticated: false,
        message: "Started".to_string(),
        kind: CopilotStatusKind::Normal,
    };

    *guard = Some(CopilotLspProcess {
        transport,
        child,
        status: tokio::sync::Mutex::new(status),
        pending_auth_command: tokio::sync::Mutex::new(None),
        active_conversations: tokio::sync::Mutex::new(Vec::new()),
        pending_server_requests,
    });

    Ok(())
}

/// Stop the Copilot LSP server process.
#[tauri::command]
pub async fn copilot_lsp_stop(
    app: AppHandle,
    state: State<'_, CopilotLspState>,
) -> Result<(), String> {
    let mut guard = state.process.lock().await;

    if let Some(mut process) = guard.take() {
        // Destroy active conversations before shutdown
        let convs = process.active_conversations.lock().await.clone();
        for conv_id in &convs {
            let _ = process
                .transport
                .send_request(
                    "conversation/destroy",
                    Some(serde_json::json!({ "conversationId": conv_id })),
                )
                .await;
        }
        process.active_conversations.lock().await.clear();

        // Try graceful shutdown: send shutdown request, then exit notification
        let shutdown_result = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            process.transport.send_request("shutdown", None),
        )
        .await;

        if shutdown_result.is_ok() {
            let _ = process
                .transport
                .send_notification("exit", None)
                .await;
        }

        // Give the process a moment to exit, then force kill
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            process.child.wait(),
        )
        .await;

        // Force kill if still alive
        let _ = process.child.kill().await;

        let _ = app.emit(
            "copilot-status-changed",
            serde_json::json!({
                "message": "Stopped",
                "kind": "Inactive",
            }),
        );
    }

    Ok(())
}

/// Get the current Copilot LSP status by sending a checkStatus request.
#[tauri::command]
pub async fn copilot_lsp_status(
    state: State<'_, CopilotLspState>,
) -> Result<CopilotStatus, String> {
    let mut guard = state.process.lock().await;

    // Check if the process is actually alive — clear stale state if it exited
    if let Some(proc) = guard.as_mut() {
        match proc.child.try_wait() {
            Ok(Some(_)) | Err(_) => {
                log::warn!(target: "notesage::copilot", "LSP process found dead during status check — clearing stale state");
                *guard = None;
            }
            Ok(None) => {} // Still alive
        }
    }

    match guard.as_ref() {
        Some(process) => {
            // Actively query the LSP for current auth status
            match process
                .transport
                .send_request("checkStatus", Some(serde_json::json!({})))
                .await
            {
                Ok(result) => {
                    let status_str = result
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let user = result
                        .get("user")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    // Copilot LSP returns status: "OK" when authenticated,
                    // "NotSignedIn" or similar when not
                    let authenticated = status_str == "OK"
                        || status_str == "MaybeOk"
                        || status_str.contains("OK");
                    let message = if authenticated {
                        format!("Signed in as {}", user)
                    } else {
                        format!("Status: {}", status_str)
                    };
                    Ok(CopilotStatus {
                        authenticated,
                        message,
                        kind: if authenticated { CopilotStatusKind::Normal } else { CopilotStatusKind::Inactive },
                    })
                }
                Err(e) => {
                    log::warn!(target: "notesage::copilot", "checkStatus failed: {}", e);
                    Ok(CopilotStatus {
                        authenticated: false,
                        message: format!("checkStatus failed: {}", e),
                        kind: CopilotStatusKind::Error,
                    })
                }
            }
        }
        None => {
            Ok(CopilotStatus {
                authenticated: false,
                message: "Not running".to_string(),
                kind: CopilotStatusKind::Inactive,
            })
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands — authentication
// ---------------------------------------------------------------------------

/// Sign in to GitHub Copilot via OAuth device flow.
///
/// The Copilot LSP supports two authentication protocols:
///
/// **Protocol A** (copilot.lua-era, direct methods):
///   1. `signInInitiate` → returns `{ status, userCode, verificationUri }`
///   2. Display code to user, open browser
///   3. `signInConfirm` with `{ userCode }` → blocks until auth completes
///
/// **Protocol B** (newer @github/copilot-language-server):
///   1. `signIn` → may return device code directly, or via server→client request
///   2. Execute embedded `finishDeviceFlow` command (fire-and-forget)
///   3. Auth completion arrives via `didChangeStatus` notification
///
/// This function tries Protocol B first, then Protocol A, then waits for
/// asynchronous device code delivery via server→client request.
#[tauri::command]
pub async fn copilot_lsp_sign_in(
    app: AppHandle,
    state: State<'_, CopilotLspState>,
) -> Result<SignInResponse, String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running. Call copilot_lsp_start first.")?;

    // --- Phase 1: Protocol B — Try direct `signIn` RPC ---
    log::info!(target: "notesage::copilot", "Phase 1: Sending signIn RPC (Protocol B)...");
    match process
        .transport
        .send_request("signIn", Some(serde_json::json!({})))
        .await
    {
        Ok(result) => {
            log::info!(target: "notesage::copilot", "Phase 1 signIn response: {}", result);

            // Check if the response indicates already signed in
            let status = result.get("status").and_then(|v| v.as_str()).unwrap_or("");
            if status == "AlreadySignedIn" || status == "OK" || status == "MaybeOk" {
                log::info!(target: "notesage::copilot", "Phase 1: Already signed in (status={})", status);
                return Ok(SignInResponse {
                    user_code: String::new(),
                    verification_uri: String::new(),
                });
            }

            let user_code = copilot_signin::extract_user_code_from_result(&result);
            let verification_uri = copilot_signin::extract_verification_uri(&result);

            if !user_code.is_empty() {
                log::info!(
                    target: "notesage::copilot",
                    "Phase 1 succeeded — userCode={}, verificationUri={}",
                    user_code, verification_uri
                );

                // Emit device code to frontend. Do NOT execute finishDeviceFlow
                // yet — it opens the browser immediately. The frontend will call
                // copilot_lsp_finish_auth when the user clicks "Open GitHub".
                let _ = app.emit(
                    "copilot-auth-device-code",
                    serde_json::json!({
                        "userCode": user_code.clone(),
                        "verificationUri": verification_uri.clone(),
                    }),
                );

                // Stash the embedded command so the frontend can trigger it later
                if let Some(command) = result.get("command") {
                    let cmd_name = command.get("command").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let cmd_args = command.get("arguments").cloned().unwrap_or(Value::Array(vec![]));
                    if !cmd_name.is_empty() {
                        *process.pending_auth_command.lock().await = Some((cmd_name, cmd_args));
                    }
                }

                return Ok(SignInResponse {
                    user_code,
                    verification_uri,
                });
            }

            log::info!(target: "notesage::copilot", "Phase 1: signIn returned no device code, falling to Phase 2");
        }
        Err(e) => {
            log::info!(
                target: "notesage::copilot",
                "Phase 1: signIn RPC failed (non-fatal, falling to Phase 2): {}",
                e
            );
        }
    }

    // --- Phase 2: Protocol A — `signInInitiate` direct method ---
    log::info!(target: "notesage::copilot", "Phase 2: Sending signInInitiate direct method (Protocol A)...");
    match process
        .transport
        .send_request("signInInitiate", Some(serde_json::json!({})))
        .await
    {
        Ok(result) => {
            log::info!(target: "notesage::copilot", "Phase 2 signInInitiate response: {}", result);

            let user_code = copilot_signin::extract_user_code_from_result(&result);
            let verification_uri = copilot_signin::extract_verification_uri(&result);

            if !user_code.is_empty() {
                log::info!(
                    target: "notesage::copilot",
                    "Phase 2 succeeded — userCode={}, verificationUri={}",
                    user_code, verification_uri
                );

                // Emit device code to frontend
                let _ = app.emit(
                    "copilot-auth-device-code",
                    serde_json::json!({
                        "userCode": user_code.clone(),
                        "verificationUri": verification_uri.clone(),
                    }),
                );

                // Fire-and-forget: `signInConfirm` blocks server-side while
                // polling GitHub until the user authenticates or the code expires.
                let confirm_code = user_code.clone();
                let confirm_writer = process.transport.writer.clone();
                let confirm_pending = process.transport.pending.clone();
                tokio::spawn(async move {
                    let id = json_rpc::next_request_id();
                    let msg = json_rpc::JsonRpcRequest::new(
                        id,
                        "signInConfirm",
                        Some(serde_json::json!({ "userCode": confirm_code })),
                    );
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    confirm_pending.lock().await.insert(id, tx);
                    let json = match serde_json::to_string(&msg) {
                        Ok(j) => j,
                        Err(e) => {
                            log::error!(target: "notesage::copilot", "Failed to serialize signInConfirm: {}", e);
                            return;
                        }
                    };
                    let mut writer = confirm_writer.lock().await;
                    if let Err(e) = json_rpc::write_message(&mut *writer, &json).await {
                        log::error!(target: "notesage::copilot", "Failed to send signInConfirm: {}", e);
                        return;
                    }
                    drop(writer);
                    log::info!(target: "notesage::copilot", "signInConfirm sent, waiting for auth completion...");
                    match rx.await {
                        Ok(Ok(val)) => log::info!(target: "notesage::copilot", "signInConfirm completed: {}", val),
                        Ok(Err(e)) => log::error!(target: "notesage::copilot", "signInConfirm failed: {}", e),
                        Err(_) => log::warn!(target: "notesage::copilot", "signInConfirm channel closed"),
                    }
                });

                return Ok(SignInResponse {
                    user_code,
                    verification_uri,
                });
            }

            log::info!(
                target: "notesage::copilot",
                "Phase 2: signInInitiate returned no device code"
            );
        }
        Err(e) => {
            log::info!(target: "notesage::copilot", "Phase 2: signInInitiate direct method failed: {}", e);
        }
    }

    // --- Phase 3: Protocol B — `signInInitiate` as workspace command ---
    log::info!(target: "notesage::copilot", "Phase 3: Sending workspace/executeCommand(signInInitiate)...");
    match process
        .transport
        .send_request(
            "workspace/executeCommand",
            Some(serde_json::json!({
                "command": "github.copilot.signInInitiate",
                "arguments": [],
            })),
        )
        .await
    {
        Ok(result) => {
            log::info!(target: "notesage::copilot", "Phase 3 signInInitiate response: {}", result);

            let user_code = copilot_signin::extract_user_code_from_result(&result);
            let verification_uri = copilot_signin::extract_verification_uri(&result);

            if !user_code.is_empty() {
                log::info!(
                    target: "notesage::copilot",
                    "Phase 3 succeeded — userCode={}, verificationUri={}",
                    user_code, verification_uri
                );

                let _ = app.emit(
                    "copilot-auth-device-code",
                    serde_json::json!({
                        "userCode": user_code.clone(),
                        "verificationUri": verification_uri.clone(),
                    }),
                );

                // Stash the embedded command for frontend-triggered execution
                if let Some(command) = result.get("command") {
                    let cmd_name = command.get("command").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let cmd_args = command.get("arguments").cloned().unwrap_or(Value::Array(vec![]));
                    if !cmd_name.is_empty() {
                        *process.pending_auth_command.lock().await = Some((cmd_name, cmd_args));
                    }
                }

                return Ok(SignInResponse {
                    user_code,
                    verification_uri,
                });
            }

            log::info!(
                target: "notesage::copilot",
                "Phase 3: signInInitiate workspace command returned no device code"
            );
        }
        Err(e) => {
            log::info!(target: "notesage::copilot", "Phase 3: signInInitiate workspace command failed: {}", e);
        }
    }

    // --- Phase 4: Wait for asynchronous device code ---
    log::info!(
        target: "notesage::copilot",
        "All phases returned no device code — waiting for server→client signIn request"
    );

    Ok(SignInResponse {
        user_code: String::new(),
        verification_uri: "https://github.com/login/device".to_string(),
    })
}

/// Execute the stashed finishDeviceFlow command. Called by the frontend when
/// the user clicks "Open GitHub" — this starts the OAuth polling and opens
/// the browser via the LSP's internal `open` call.
#[tauri::command]
pub async fn copilot_lsp_finish_auth(
    state: State<'_, CopilotLspState>,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    let cmd = process.pending_auth_command.lock().await.take();
    if let Some((cmd_name, cmd_args)) = cmd {
        log::info!(
            target: "notesage::copilot",
            "Frontend triggered finishDeviceFlow: {} with args: {}",
            cmd_name, cmd_args
        );

        // Fire-and-forget — this polls GitHub until auth completes
        let writer = process.transport.writer.clone();
        let pending = process.transport.pending.clone();
        tokio::spawn(async move {
            let id = json_rpc::next_request_id();
            let msg = json_rpc::JsonRpcRequest::new(
                id,
                "workspace/executeCommand",
                Some(serde_json::json!({
                    "command": cmd_name,
                    "arguments": cmd_args,
                })),
            );
            let (tx, rx) = tokio::sync::oneshot::channel();
            pending.lock().await.insert(id, tx);
            let json = match serde_json::to_string(&msg) {
                Ok(j) => j,
                Err(e) => {
                    log::error!(target: "notesage::copilot", "Failed to serialize finishDeviceFlow: {}", e);
                    return;
                }
            };
            let mut w = writer.lock().await;
            if let Err(e) = json_rpc::write_message(&mut *w, &json).await {
                log::error!(target: "notesage::copilot", "Failed to send finishDeviceFlow: {}", e);
                return;
            }
            drop(w);
            match rx.await {
                Ok(Ok(val)) => log::info!(target: "notesage::copilot", "finishDeviceFlow completed: {}", val),
                Ok(Err(e)) => log::error!(target: "notesage::copilot", "finishDeviceFlow failed: {}", e),
                Err(_) => log::warn!(target: "notesage::copilot", "finishDeviceFlow channel closed"),
            }
        });
    } else {
        log::info!(target: "notesage::copilot", "No pending auth command to execute");
    }

    Ok(())
}

/// Sign out of GitHub Copilot.
#[tauri::command]
pub async fn copilot_lsp_sign_out(
    state: State<'_, CopilotLspState>,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_request("signOut", Some(serde_json::json!({})))
        .await
        .map_err(|e| format!("signOut failed: {}", e))?;

    // Update local status
    let mut status = process.status.lock().await;
    status.authenticated = false;
    status.message = "Signed out".to_string();

    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — document sync
// ---------------------------------------------------------------------------

/// Notify the LSP that a document was opened.
#[tauri::command]
pub async fn copilot_lsp_did_open(
    state: State<'_, CopilotLspState>,
    uri: String,
    content: String,
    version: u32,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard.as_ref().ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_notification(
            "textDocument/didOpen",
            Some(serde_json::json!({
                "textDocument": {
                    "uri": copilot_protocol::path_to_uri(&uri),
                    "languageId": "markdown",
                    "version": version,
                    "text": content,
                },
            })),
        )
        .await
}

/// Notify the LSP that a document's content changed.
/// Uses full-content replacement (single change covering the entire document).
#[tauri::command]
pub async fn copilot_lsp_did_change(
    state: State<'_, CopilotLspState>,
    uri: String,
    content: String,
    version: u32,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard.as_ref().ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_notification(
            "textDocument/didChange",
            Some(serde_json::json!({
                "textDocument": {
                    "uri": copilot_protocol::path_to_uri(&uri),
                    "version": version,
                },
                "contentChanges": [{
                    "text": content,
                }],
            })),
        )
        .await
}

/// Notify the LSP that a document was closed.
#[tauri::command]
pub async fn copilot_lsp_did_close(
    state: State<'_, CopilotLspState>,
    uri: String,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard.as_ref().ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_notification(
            "textDocument/didClose",
            Some(serde_json::json!({
                "textDocument": {
                    "uri": copilot_protocol::path_to_uri(&uri),
                },
            })),
        )
        .await
}

/// Notify the LSP that a document received focus (custom Copilot method).
#[tauri::command]
pub async fn copilot_lsp_did_focus(
    state: State<'_, CopilotLspState>,
    uri: String,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard.as_ref().ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_notification(
            "textDocument/didFocus",
            Some(serde_json::json!({
                "textDocument": {
                    "uri": copilot_protocol::path_to_uri(&uri),
                },
            })),
        )
        .await
}

// ---------------------------------------------------------------------------
// Tauri commands — completions
// ---------------------------------------------------------------------------

/// Request inline completions at a cursor position.
#[tauri::command]
pub async fn copilot_lsp_request_completion(
    state: State<'_, CopilotLspState>,
    uri: String,
    line: u32,
    character: u32,
    version: u32,
) -> Result<Vec<InlineCompletionItem>, String> {
    let guard = state.process.lock().await;
    let process = guard.as_ref().ok_or("Copilot LSP not running.")?;

    let req_params = serde_json::json!({
        "textDocument": {
            "uri": copilot_protocol::path_to_uri(&uri),
            "version": version,
        },
        "position": {
            "line": line,
            "character": character,
        },
        "context": {
            "triggerKind": 2,
        },
        "formattingOptions": {
            "tabSize": 2,
            "insertSpaces": true,
        },
    });

    let result = process
        .transport
        .send_request("textDocument/inlineCompletion", Some(req_params))
        .await
        .map_err(|e| format!("Completion request failed: {}", e))?;

    // Parse the response: { items: [...] } or null
    let items = result
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let completions: Vec<InlineCompletionItem> = items
        .into_iter()
        .filter_map(|item| {
            let insert_text = item.get("insertText")?.as_str()?.to_string();

            let range = item.get("range").and_then(|r| {
                Some(CompletionRange {
                    start: LspPosition {
                        line: r.get("start")?.get("line")?.as_u64()? as u32,
                        character: r.get("start")?.get("character")?.as_u64()? as u32,
                    },
                    end: LspPosition {
                        line: r.get("end")?.get("line")?.as_u64()? as u32,
                        character: r.get("end")?.get("character")?.as_u64()? as u32,
                    },
                })
            });

            let command = item.get("command").and_then(|c| {
                Some(CompletionCommand {
                    command: c.get("command")?.as_str()?.to_string(),
                    arguments: c
                        .get("arguments")
                        .and_then(|a| a.as_array().cloned()),
                })
            });

            Some(InlineCompletionItem {
                insert_text,
                range,
                command,
            })
        })
        .collect();

    Ok(completions)
}

/// Notify the LSP that a completion was shown to the user.
#[tauri::command]
pub async fn copilot_lsp_did_show_completion(
    state: State<'_, CopilotLspState>,
    item: Value,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard.as_ref().ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_notification(
            "textDocument/didShowCompletion",
            Some(serde_json::json!({ "item": item })),
        )
        .await
}

/// Accept a completion by executing its tracking command.
#[tauri::command]
pub async fn copilot_lsp_accept_completion(
    state: State<'_, CopilotLspState>,
    command: String,
    arguments: Option<Vec<Value>>,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard.as_ref().ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_request(
            "workspace/executeCommand",
            Some(serde_json::json!({
                "command": command,
                "arguments": arguments.unwrap_or_default(),
            })),
        )
        .await
        .map_err(|e| format!("Accept completion failed: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — conversations
// ---------------------------------------------------------------------------

/// Create a new conversation session and send the first message.
/// Returns the conversation ID. Streaming response arrives via $/progress
/// events (copilot-chat-chunk, copilot-chat-thinking, copilot-chat-done).
#[tauri::command]
pub async fn copilot_lsp_conversation_create(
    state: State<'_, CopilotLspState>,
    message: String,
    model: Option<String>,
    tools: Option<Vec<Value>>,
    doc_uri: Option<String>,
    doc_language_id: Option<String>,
) -> Result<Value, String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    let work_done_token = format!("copilot-chat-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis());

    let mut params = serde_json::json!({
        "workDoneToken": work_done_token,
        "turns": [{
            "request": message,
        }],
        "capabilities": {
            "allSkills": true,
        },
        "source": "panel",
    });

    if let Some(model_id) = &model {
        log::info!(target: "notesage::copilot", "conversation/create with model={}", model_id);
        params["model"] = Value::String(model_id.clone());
    } else {
        log::info!(target: "notesage::copilot", "conversation/create with no model (server default)");
    }

    // Attach active document context so the model can see the open file
    if let Some(uri) = &doc_uri {
        let mut doc = serde_json::json!({ "uri": uri });
        if let Some(lang) = &doc_language_id {
            doc["languageId"] = Value::String(lang.clone());
        }
        params["doc"] = doc;
    }

    let result = process
        .transport
        .send_request("conversation/create", Some(params))
        .await
        .map_err(|e| format!("conversation/create failed: {}", e))?;

    let conversation_id = result
        .get("conversationId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if !conversation_id.is_empty() {
        process.active_conversations.lock().await.push(conversation_id.clone());

        // Register tools if provided
        if let Some(tool_defs) = tools {
            if !tool_defs.is_empty() {
                let reg_result = process
                    .transport
                    .send_request(
                        "conversation/registerTools",
                        Some(serde_json::json!({ "tools": tool_defs })),
                    )
                    .await;

                match reg_result {
                    Ok(_) => log::debug!(
                        target: "notesage::copilot",
                        "Registered {} tools for conversation {}",
                        tool_defs.len(), conversation_id
                    ),
                    Err(e) => log::warn!(
                        target: "notesage::copilot",
                        "Tool registration failed (non-fatal): {}", e
                    ),
                }
            }
        }
    }

    Ok(result)
}

/// Send a follow-up message in an existing conversation.
/// Streaming response arrives via $/progress events.
#[tauri::command]
pub async fn copilot_lsp_conversation_turn(
    state: State<'_, CopilotLspState>,
    conversation_id: String,
    message: String,
    model: Option<String>,
    doc_uri: Option<String>,
    doc_language_id: Option<String>,
) -> Result<Value, String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    let work_done_token = format!("copilot-chat-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis());

    let mut params = serde_json::json!({
        "workDoneToken": work_done_token,
        "conversationId": conversation_id,
        "message": message,
        "source": "panel",
    });

    if let Some(model_id) = &model {
        params["model"] = Value::String(model_id.clone());
    }

    // Attach active document context
    if let Some(uri) = &doc_uri {
        let mut doc = serde_json::json!({ "uri": uri });
        if let Some(lang) = &doc_language_id {
            doc["languageId"] = Value::String(lang.clone());
        }
        params["doc"] = doc;
    }

    let result = process
        .transport
        .send_request("conversation/turn", Some(params))
        .await
        .map_err(|e| format!("conversation/turn failed: {}", e))?;

    Ok(result)
}

/// Destroy a conversation session.
#[tauri::command]
pub async fn copilot_lsp_conversation_destroy(
    state: State<'_, CopilotLspState>,
    conversation_id: String,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    process
        .transport
        .send_request(
            "conversation/destroy",
            Some(serde_json::json!({ "conversationId": conversation_id })),
        )
        .await
        .map_err(|e| format!("conversation/destroy failed: {}", e))?;

    // Remove from active conversations
    let mut convs = process.active_conversations.lock().await;
    convs.retain(|id| id != &conversation_id);

    Ok(())
}

/// List available models for Copilot chat.
#[tauri::command]
pub async fn copilot_lsp_conversation_models(
    state: State<'_, CopilotLspState>,
) -> Result<Vec<CopilotModel>, String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    let result = process
        .transport
        .send_request("copilot/models", Some(serde_json::json!({})))
        .await;

    match result {
        Ok(Value::Array(ref models)) => {
            log::info!(
                target: "notesage::copilot",
                "copilot/models returned {} models: {}",
                models.len(),
                serde_json::to_string(&models).unwrap_or_default()
            );
            let parsed = copilot_models::parse_copilot_models(models);
            Ok(parsed)
        }
        Ok(_) => {
            log::warn!(target: "notesage::copilot", "copilot/models returned non-array");
            Ok(copilot_models::hardcoded_fallback_models())
        }
        Err(e) => {
            log::warn!(target: "notesage::copilot", "copilot/models failed: {}, using fallback", e);
            Ok(copilot_models::hardcoded_fallback_models())
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands — server→client response bridges
// ---------------------------------------------------------------------------

/// Send a context response back to a pending conversation/context request.
/// Called by the frontend after collecting editor state.
#[tauri::command]
pub async fn copilot_lsp_context_response(
    state: State<'_, CopilotLspState>,
    request_id: String,
    context: Value,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    let mut pending = process.pending_server_requests.lock().await;
    if let Some(tx) = pending.remove(&request_id) {
        let _ = tx.send(context);
        Ok(())
    } else {
        Err(format!("No pending context request with id {}", request_id))
    }
}

/// Send a tool execution result back to a pending conversation/invokeClientTool request.
/// Called by the frontend after executing the tool.
#[tauri::command]
pub async fn copilot_lsp_tool_result(
    state: State<'_, CopilotLspState>,
    request_id: String,
    result: Value,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    let mut pending = process.pending_server_requests.lock().await;
    if let Some(tx) = pending.remove(&request_id) {
        let _ = tx.send(result);
        Ok(())
    } else {
        Err(format!("No pending tool request with id {}", request_id))
    }
}

/// Send a tool confirmation response back to a pending invokeClientToolConfirmation request.
/// Called by the frontend after user approves/denies.
#[tauri::command]
pub async fn copilot_lsp_tool_confirmation_response(
    state: State<'_, CopilotLspState>,
    request_id: String,
    accepted: bool,
) -> Result<(), String> {
    let guard = state.process.lock().await;
    let process = guard
        .as_ref()
        .ok_or("Copilot LSP not running.")?;

    let mut pending = process.pending_server_requests.lock().await;
    if let Some(tx) = pending.remove(&request_id) {
        let response = serde_json::json!({
            "result": if accepted { "accept" } else { "dismiss" }
        });
        let _ = tx.send(response);
        Ok(())
    } else {
        Err(format!("No pending confirmation request with id {}", request_id))
    }
}
