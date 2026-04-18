use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{watch, Mutex};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Sandbox violation event emitted to the frontend.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SandboxViolation {
    pub instance_id: String,
    pub agent_id: String,
    pub pid: u32,
    pub operation: String,
    pub resource: String,
    pub timestamp: String,
    pub count: u32,
}

/// Dedup key for recent violations.
#[derive(Hash, Eq, PartialEq, Clone)]
struct ViolationKey {
    pid: u32,
    operation: String,
    resource: String,
}

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

/// Shared PID registry accessible from both Tauri commands and the monitor task.
type PidRegistry = Arc<Mutex<HashMap<u32, (String, String)>>>;

pub struct SandboxMonitorState {
    /// PID → (instance_id, agent_id) for active sandboxed agents.
    pub(crate) agent_pids: PidRegistry,
    /// Shutdown signal for the log stream reader.
    shutdown_tx: watch::Sender<bool>,
    shutdown_rx: Mutex<watch::Receiver<bool>>,
    /// Whether the monitor is running.
    running: Mutex<bool>,
}

impl SandboxMonitorState {
    pub fn new() -> Self {
        let (tx, rx) = watch::channel(false);
        Self {
            agent_pids: Arc::new(Mutex::new(HashMap::new())),
            shutdown_tx: tx,
            shutdown_rx: Mutex::new(rx),
            running: Mutex::new(false),
        }
    }

    /// Stop the log stream process (called from RunEvent::Exit).
    pub fn stop_sync(&self) {
        let _ = self.shutdown_tx.send(true);
    }

    /// Register a PID and start the monitor if needed. Called from acp.rs on agent spawn.
    #[cfg(target_os = "macos")]
    pub async fn register_and_start(&self, app: &AppHandle, instance_id: String, agent_id: String, pid: u32) {
        self.agent_pids.lock().await.insert(pid, (instance_id, agent_id));

        let mut running = self.running.lock().await;
        if !*running {
            *running = true;
            let pids = Arc::clone(&self.agent_pids);
            let shutdown_rx = self.shutdown_rx.lock().await.clone();
            let app_clone = app.clone();
            tokio::spawn(async move {
                run_log_stream(app_clone, pids, shutdown_rx).await;
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Log stream reader (macOS only)
// ---------------------------------------------------------------------------

/// Start the macOS unified log stream reader. Spawned once on first PID registration.
/// Reads `log stream --predicate ... --style ndjson` and filters for our agent PIDs.
#[cfg(target_os = "macos")]
async fn run_log_stream(
    app: AppHandle,
    agent_pids: PidRegistry,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    use std::time::Instant;

    let child = tokio::process::Command::new("log")
        .args([
            "stream",
            "--predicate",
            "eventMessage CONTAINS \"Sandbox\" AND eventMessage CONTAINS \"deny\"",
            "--style",
            "ndjson",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn();

    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            log::error!(target: "notesage::sandbox_monitor", "Failed to spawn log stream: {}", e);
            return;
        }
    };

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            log::error!(target: "notesage::sandbox_monitor", "No stdout from log stream");
            return;
        }
    };

    log::info!(target: "notesage::sandbox_monitor", "Sandbox violation monitor started");

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    // Dedup: track recent violations to coalesce repeats within 5s
    let mut recent: HashMap<ViolationKey, (Instant, u32)> = HashMap::new();
    // Rate limit: max events per second per agent PID
    let mut rate_counts: HashMap<u32, (Instant, u32)> = HashMap::new();
    const MAX_EVENTS_PER_SEC: u32 = 10;

    loop {
        tokio::select! {
            _ = shutdown_rx.changed() => {
                log::info!(target: "notesage::sandbox_monitor", "Sandbox violation monitor shutting down");
                break;
            }
            line = lines.next_line() => {
                let line = match line {
                    Ok(Some(l)) => l,
                    Ok(None) => {
                        log::warn!(target: "notesage::sandbox_monitor", "Log stream ended unexpectedly");
                        break;
                    }
                    Err(e) => {
                        log::debug!(target: "notesage::sandbox_monitor", "Log stream read error: {}", e);
                        continue;
                    }
                };

                // Parse ndjson line
                let json: serde_json::Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue, // skip non-JSON lines (e.g. log stream header)
                };

                // Extract PID from the log entry
                let pid = match json.get("processIdentifier").and_then(|v| v.as_u64()) {
                    Some(p) => p as u32,
                    None => continue,
                };

                // Check if this PID belongs to one of our agents
                let pids = agent_pids.lock().await;
                let (instance_id, agent_id) = match pids.get(&pid) {
                    Some(ids) => ids.clone(),
                    None => continue,
                };
                drop(pids);

                // Extract violation details from the event message
                let message = json.get("eventMessage")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                let (operation, resource) = parse_violation_message(message);

                // Extract timestamp
                let timestamp = json.get("timestamp")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let now = Instant::now();

                // Dedup: same (pid, operation, resource) within 5s → increment count
                let key = ViolationKey {
                    pid,
                    operation: operation.clone(),
                    resource: resource.clone(),
                };

                if let Some((last_time, count)) = recent.get_mut(&key) {
                    if now.duration_since(*last_time).as_secs() < 5 {
                        *count += 1;
                        continue; // suppress duplicate
                    }
                }

                // Rate limit per PID
                let rate = rate_counts.entry(pid).or_insert((now, 0));
                if now.duration_since(rate.0).as_secs() < 1 {
                    rate.1 += 1;
                    if rate.1 > MAX_EVENTS_PER_SEC {
                        continue;
                    }
                } else {
                    *rate = (now, 1);
                }

                // Emit the previous dedup count, then reset
                let prev_count = recent.get(&key).map(|(_, c)| *c).unwrap_or(0);
                recent.insert(key, (now, 1));

                let violation = SandboxViolation {
                    instance_id,
                    agent_id,
                    pid,
                    operation,
                    resource,
                    timestamp,
                    count: prev_count.max(1),
                };

                log::debug!(target: "notesage::sandbox_monitor",
                    "Violation: {} {} → {} (count: {})",
                    violation.agent_id, violation.operation, violation.resource, violation.count
                );

                let _ = app.emit("sandbox-violation", &violation);

                // Prune old dedup entries
                recent.retain(|_, (t, _)| now.duration_since(*t).as_secs() < 10);
            }
        }
    }

    let _ = child.kill().await;
}

/// Parse a Seatbelt violation log message into (operation, resource).
///
/// Example messages from the macOS unified log:
///   "Sandbox: curl(12345) deny(1) network-outbound remote:*:443"
///   "Sandbox: node(12345) deny(1) file-read-data /Users/x/.ssh/id_rsa"
///   "5 duplicate reports for Sandbox: node(12345) deny(1) network-outbound remote:*:443"
pub fn parse_violation_message(msg: &str) -> (String, String) {
    // Find "deny(N) " and extract what follows
    if let Some(deny_pos) = msg.find("deny(") {
        let after_deny = &msg[deny_pos..];
        if let Some(paren_pos) = after_deny.find(") ") {
            let rest = &after_deny[paren_pos + 2..];
            if let Some(space) = rest.find(' ') {
                let operation = rest[..space].to_string();
                let resource = rest[space + 1..].trim().to_string();
                return (operation, resource);
            } else {
                return (rest.trim().to_string(), String::new());
            }
        }
    }
    ("unknown".to_string(), msg.to_string())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Register an agent PID for sandbox violation monitoring.
/// Lazily starts the log stream monitor on first registration.
#[tauri::command]
pub async fn sandbox_monitor_register_pid(
    app: AppHandle,
    state: State<'_, SandboxMonitorState>,
    instance_id: String,
    agent_id: String,
    pid: u32,
) -> Result<(), String> {
    state.agent_pids.lock().await.insert(pid, (instance_id.clone(), agent_id.clone()));

    log::info!(target: "notesage::sandbox_monitor",
        "Registered PID {} for {} ({})", pid, agent_id, instance_id
    );

    // Start the monitor if not already running
    let mut running = state.running.lock().await;
    if !*running {
        *running = true;

        let pids = Arc::clone(&state.agent_pids);
        let shutdown_rx = state.shutdown_rx.lock().await.clone();
        let app_clone = app.clone();

        #[cfg(target_os = "macos")]
        tokio::spawn(async move {
            run_log_stream(app_clone, pids, shutdown_rx).await;
        });
    }

    Ok(())
}

/// Unregister an agent PID from sandbox violation monitoring.
#[tauri::command]
pub async fn sandbox_monitor_unregister_pid(
    state: State<'_, SandboxMonitorState>,
    pid: u32,
) -> Result<(), String> {
    state.agent_pids.lock().await.remove(&pid);
    log::info!(target: "notesage::sandbox_monitor", "Unregistered PID {}", pid);
    Ok(())
}
