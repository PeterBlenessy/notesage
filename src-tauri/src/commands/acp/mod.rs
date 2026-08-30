//! ACP (Agent Client Protocol) command surface.
//!
//! This module is the thin Tauri command layer: each `#[tauri::command]` below
//! looks up the target agent in `AcpState`, forwards an `AgentCmd` over the
//! agent's command channel, and awaits the reply. The heavy lifting — spawning
//! the subprocess, the ACP handshake, and the per-message command loop — lives
//! in the sibling implementation modules:
//!
//! - [`types`]        — serializable IPC types (the wire contract)
//! - [`state`]        — `AcpState`, `AgentHandle`, the `AgentCmd` protocol, orphan PID files
//! - [`helpers`]      — MCP-server construction, model-info + session-result assembly
//! - [`agent_thread`] — `run_agent_thread`: subprocess spawn, `initialize`, the command loop
//!
//! The command functions are defined directly in this module (not re-exported
//! from a submodule) so `commands::acp::<name>` — the path `generate_handler!`
//! resolves via `commands/mod.rs`'s `pub use acp::*` — is unchanged by the split.

mod agent_thread;
mod helpers;
mod state;
mod types;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Listener, Manager, State};
use tokio::sync::{mpsc, oneshot};

use crate::commands::acp_binary::{resolve_absolute_binary, resolve_agent_binary};

use agent_thread::run_agent_thread;
use helpers::build_acp_mcp_servers;
use state::{AgentCmd, AgentHandle};

// Public API re-exports. `commands/mod.rs` does `pub use acp::*`, so these become
// `commands::acp::*` for the rest of the crate (and the frontend wire types).
pub use state::{kill_orphaned_acp_agents, AcpState};
// Glob re-export of the full wire-type surface — every one of these was
// historically a `pub` item defined in `acp.rs` and reachable at
// `commands::acp::<Type>` (and `commands::*` via `commands/mod.rs`'s
// `pub use acp::*`). A glob keeps that surface intact without tripping the
// `unused_imports` lint on the types only consumed via their `types::` path.
pub use types::*;

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Spawn an ACP agent subprocess, initialize the connection, and return an instance ID.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn acp_agent_spawn(
    app: AppHandle,
    state: State<'_, AcpState>,
    network_proxy_state: State<'_, crate::commands::network_proxy::NetworkProxyState>,
    agent_binary: String,
    agent_args: Option<Vec<String>>,
    role: AgentRole,
    working_directory: String,
    env_vars: Option<HashMap<String, String>>,
    sandbox_enabled: Option<bool>,
    sandbox_paths: Option<Vec<String>>,
    network_sandbox_enabled: Option<bool>,
    network_allowed_domains: Option<Vec<String>>,
    kernel_network_deny: Option<bool>,
    connection_id: Option<String>,
    env_var_keys: Option<Vec<String>>,
    extra_localhost_ports: Option<Vec<u16>>,
) -> Result<SpawnResult, String> {
    let mut env = env_vars.unwrap_or_default();
    // Resolve env-var secrets from the OS keychain (`notesage:<conn_id>:env:<KEY>`).
    // Keychain values are authoritative and override any value passed over IPC —
    // same precedence as `resolve_api_key` in ai.rs. The IPC `env_vars` map stays
    // as the same-session fallback for values not yet written to the keychain.
    if let Some(conn_id) = connection_id.as_deref() {
        for key in env_var_keys.unwrap_or_default() {
            match crate::commands::credentials::get_credential_internal(&format!("{conn_id}:env:{key}")) {
                Ok(Some(value)) => {
                    env.insert(key, value);
                }
                Ok(None) => {
                    log::debug!(target: "notesage::acp",
                        "No keychain entry for env var {key} on connection {conn_id} — using IPC fallback if present");
                }
                Err(e) => {
                    log::warn!(target: "notesage::acp",
                        "Failed to resolve env var {key} from keychain for connection {conn_id}: {e}");
                }
            }
        }
    }
    let args = agent_args.unwrap_or_default();

    // Resolve the actual binary path. Absolute paths (custom agents) go through
    // `resolve_absolute_binary` directly so its precise validation errors
    // ("not found at <path>" / "not executable") reach the frontend instead of
    // collapsing into the generic not-found message; agent names keep the
    // PATH/Homebrew/npm/bundled lookup.
    let resolved_binary = if std::path::Path::new(&agent_binary).is_absolute() {
        resolve_absolute_binary(&agent_binary)?
    } else {
        resolve_agent_binary(&agent_binary, &app)
            .ok_or_else(|| format!("Agent binary '{}' not found", agent_binary))?
    };

    // Determine sandbox policy: explicit override, or default based on binary source
    let sandbox = sandbox_enabled
        .unwrap_or_else(|| crate::commands::sandbox::should_sandbox_by_default(&resolved_binary));

    // Writable paths: explicit list, or fall back to [working_directory]
    let writable_paths = sandbox_paths
        .unwrap_or_else(|| vec![working_directory.clone()]);

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

    // Save a copy of allowed domains for AgentHandle before they're consumed
    let saved_network_domains = network_allowed_domains.clone();

    // Start network proxy if network sandboxing is enabled (requires filesystem sandbox)
    let network_config = if sandbox && network_sandbox_enabled.unwrap_or(false) {
        let domains = network_allowed_domains
            .unwrap_or_else(|| crate::commands::network_proxy::default_allowed_domains(&agent_binary));

        match network_proxy_state
            .start_proxy(&instance_id, &agent_binary, domains, app.clone())
            .await
        {
            Ok(mut config) => {
                // Direct-localhost allows (e.g. the bundled llama-server port
                // for the Goose preset) — reachable without the proxy under
                // kernel network deny. Empty for ordinary agents.
                if let Some(ports) = extra_localhost_ports.clone() {
                    config.extra_localhost_ports = ports;
                }
                // Inject proxy env vars into the agent's environment
                let proxy_url = format!("http://{}", config.proxy_addr);
                env.insert("HTTP_PROXY".to_string(), proxy_url.clone());
                env.insert("HTTPS_PROXY".to_string(), proxy_url.clone());
                env.insert("http_proxy".to_string(), format!("http://{}", config.proxy_addr));
                env.insert("https_proxy".to_string(), format!("http://{}", config.proxy_addr));
                env.insert("NO_PROXY".to_string(), "localhost,127.0.0.1".to_string());
                env.insert("no_proxy".to_string(), "localhost,127.0.0.1".to_string());
                log::info!(target: "notesage::acp",
                    "Network proxy started for {} at {}",
                    agent_binary, config.proxy_addr
                );
                Some(config)
            }
            Err(e) => {
                log::warn!(target: "notesage::acp",
                    "Failed to start network proxy for {}: {} — spawning without network sandbox",
                    agent_binary, e
                );
                None
            }
        }
    } else {
        None
    };

    let has_network_sandbox = network_config.is_some();
    let knd = kernel_network_deny.unwrap_or(false);

    let (init_tx, init_rx) = oneshot::channel();
    let (cmd_tx, cmd_rx) = mpsc::channel(32);

    // Shared PID cell — thread writes after spawn, AgentHandle reads for SIGKILL
    let child_pid = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
    let child_pid_thread = std::sync::Arc::clone(&child_pid);

    let binary = resolved_binary;
    let cwd = working_directory.clone();
    let iid = instance_id.clone();
    let spawn_args = args.clone();
    let spawn_env = env.clone();
    let spawn_writable = writable_paths.clone();

    let thread_handle = std::thread::Builder::new()
        .name(format!("acp-{}", &binary))
        .spawn(move || {
            run_agent_thread(app, iid, binary, spawn_args, cwd, spawn_env, sandbox, spawn_writable, network_config, knd, cmd_rx, init_tx, child_pid_thread);
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
        agent_binary: agent_binary.clone(),
        working_directory: working_directory.clone(),
        child_pid,
        cmd_tx,
        thread_handle: Some(thread_handle),
        agent_args: args,
        env_vars: env,
        sandbox_enabled: sandbox,
        sandbox_writable_paths: writable_paths,
        network_sandbox_enabled: has_network_sandbox,
        network_allowed_domains: if has_network_sandbox {
            saved_network_domains
        } else {
            None
        },
        kernel_network_deny: knd,
        extra_localhost_ports: extra_localhost_ports.unwrap_or_default(),
        supports_images: init_info.supports_images,
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
        sandbox_enabled: sandbox,
        network_sandbox_enabled: has_network_sandbox,
        supports_images: init_info.supports_images,
        capabilities: init_info.capabilities,
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
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    }; // lock released here

    let (reply_tx, reply_rx) = oneshot::channel();

    cmd_tx
        .send(AgentCmd::Authenticate {
            method_id,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to authenticate".to_string())?
}

/// Check if an ACP agent instance is still registered (lightweight map lookup).
#[tauri::command]
pub async fn acp_agent_exists(
    state: State<'_, AcpState>,
    instance_id: String,
) -> Result<bool, String> {
    Ok(state.agents.lock().await.contains_key(&instance_id))
}

/// Check whether the agent's background thread is still running.
/// Returns `false` if the agent is unknown or its thread has exited.
#[tauri::command]
pub async fn acp_is_agent_alive(
    state: State<'_, AcpState>,
    instance_id: String,
) -> Result<bool, String> {
    let agents = state.agents.lock().await;
    match agents.get(&instance_id) {
        Some(handle) => Ok(handle
            .thread_handle
            .as_ref()
            .map_or(false, |th| !th.is_finished())),
        None => Ok(false),
    }
}

/// Stop an ACP agent subprocess and clean up resources.
#[tauri::command]
pub async fn acp_agent_stop(
    state: State<'_, AcpState>,
    instance_id: String,
) -> Result<(), String> {
    // Remove the handle and DROP the map lock before any `.await`, so concurrent
    // ACP commands aren't blocked for the whole stop round-trip (which can be as
    // long as an in-flight prompt). Holding `agents` across the send/reply/join
    // below would serialize every other command behind this one.
    let mut handle = {
        let mut agents = state.agents.lock().await;
        agents
            .remove(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?
    };

    let thread_handle = handle.thread_handle.take();

    // Best-effort graceful stop. On any failure we still join the OS thread
    // below so we never leak a zombie (dropping `handle` releases `cmd_tx`, and
    // `kill_on_drop` tears down the child).
    let (reply_tx, reply_rx) = oneshot::channel();
    let result = match handle.cmd_tx.send(AgentCmd::Stop { reply: reply_tx }).await {
        Ok(()) => reply_rx
            .await
            .map_err(|_| "Agent thread did not respond to stop".to_string())
            .and_then(|r| r),
        Err(_) => Err("Agent thread is no longer running".to_string()),
    };

    // Drop the handle (releases cmd_tx → the command loop ends), then join the
    // OS thread on a blocking-safe task so we don't park the async executor.
    drop(handle);
    if let Some(th) = thread_handle {
        let _ = tokio::task::spawn_blocking(move || th.join()).await;
    }

    result
}

/// Kill a hung agent, respawn with the same config, re-authenticate, and load the session.
/// Returns a new `SpawnResult` with a fresh `instance_id`.
#[tauri::command]
pub async fn acp_agent_reconnect(
    app: AppHandle,
    state: State<'_, AcpState>,
    network_proxy_state: State<'_, crate::commands::network_proxy::NetworkProxyState>,
    instance_id: String,
    session_id: String,
) -> Result<SpawnResult, String> {
    // 1. Remove the old agent from the map and extract its spawn config
    let old_handle = {
        let mut agents = state.agents.lock().await;
        agents.remove(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?
    };

    // 2. SIGKILL the old subprocess directly via PID
    let pid = old_handle.child_pid.load(std::sync::atomic::Ordering::Relaxed);
    if pid != 0 {
        unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL); }
        log::info!(target: "notesage::acp", "Reconnect: sent SIGKILL to old agent PID {}", pid);
    }

    // 3. Drop the command channel and join the thread with 500ms timeout
    drop(old_handle.cmd_tx);
    if let Some(th) = old_handle.thread_handle {
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let join_thread = std::thread::spawn(move || {
            let _ = th.join();
            let _ = done_tx.send(());
        });
        match done_rx.recv_timeout(std::time::Duration::from_millis(500)) {
            Ok(_) => { let _ = join_thread.join(); }
            Err(_) => {
                log::warn!(target: "notesage::acp", "Reconnect: old agent thread did not exit within 500ms, abandoning");
            }
        }
    }

    // 4. Spawn a fresh agent with the same config
    let working_dir = old_handle.working_directory.clone();
    let result = acp_agent_spawn(
        app,
        state.clone(),
        network_proxy_state,
        old_handle.agent_binary,
        Some(old_handle.agent_args),
        AgentRole::Interactive,
        working_dir.clone(),
        Some(old_handle.env_vars),
        Some(old_handle.sandbox_enabled),
        Some(old_handle.sandbox_writable_paths),
        Some(old_handle.network_sandbox_enabled),
        old_handle.network_allowed_domains,
        Some(old_handle.kernel_network_deny),
        // env_vars above already carries the keychain-resolved values from the
        // original spawn — no connection_id/env_var_keys re-resolution needed.
        None,
        None,
        // Preserve the same direct-localhost confinement (llama-server port) on reconnect.
        Some(old_handle.extra_localhost_ports),
    ).await?;

    // 5. Re-authenticate (best-effort, same as initial spawn)
    if let Err(auth_err) = acp_agent_authenticate(
        state.clone(),
        result.instance_id.clone(),
        None,
    ).await {
        let msg = auth_err.to_string();
        if !msg.to_lowercase().contains("not implemented") {
            log::warn!(target: "notesage::acp", "Reconnect: auth failed: {}", msg);
            return Err(format!("Reconnect auth failed: {}", msg));
        }
    }

    // 6. Load the existing session.
    // MCP re-attachment on crash-recovery reconnect is a follow-up: reconnect
    // doesn't carry the renderer's current MCP set, so we reload with none here.
    // The normal restore path (`restoreOrCreateAcpSession`) re-sends the current
    // servers; reconnect is the rarer crash-recovery edge (#11 known follow-up).
    let _session = acp_session_load(
        state,
        result.instance_id.clone(),
        session_id,
        working_dir,
        None,
    ).await
    .map_err(|e| format!("Reconnect session/load failed: {}", e))?;

    log::info!(target: "notesage::acp", "Reconnect succeeded: old={} new={}", instance_id, result.instance_id);

    Ok(result)
}

// ---------------------------------------------------------------------------
// Smoke test (task #12) — bounded end-to-end verification of the Local Agent
// chain: bundled server health → agent spawn → session/new → one short prompt
// → teardown. Used by the setup flow (#16) to gate "ready" and by routing (#13)
// to decide whether to fall back to direct local chat.
// ---------------------------------------------------------------------------

/// Per-stage timeout budgets. The prompt budget is generous because the FIRST
/// prompt on a cold llama-server pays the model-load cost before any token.
const SMOKE_HEALTH_TIMEOUT_SECS: u64 = 5;
const SMOKE_SPAWN_TIMEOUT_SECS: u64 = 45;
const SMOKE_SESSION_TIMEOUT_SECS: u64 = 30;
const SMOKE_PROMPT_TIMEOUT_SECS: u64 = 180;

/// A trivial prompt that should elicit a one-token reply on any working model.
const SMOKE_PROMPT: &str = "Reply with the single word: ok";

/// Prompt for the permission stage — asks for a WRITE, which the gate must
/// intercept. Deliberately concrete and small: a vague instruction gives a
/// small local model too much room to answer in prose instead of acting.
const SMOKE_PERMISSION_PROMPT: &str =
    "Create a file called notesage-permission-probe.txt containing the word ok.";
/// Ceiling for the permission probe. Shorter than the main prompt: the model
/// is already loaded by the time this runs.
const SMOKE_PERMISSION_TIMEOUT_SECS: u64 = 90;

/// Prompt for the resource-link stage (#815). Deliberately the least
/// ambiguous instruction that can be given: one attached file, one token,
/// "reply with only". The probe's whole difficulty is telling "the agent never
/// received the file" from "the model chose to answer differently", so the
/// instruction is written to leave a capable agent no other reasonable move.
const SMOKE_RESOURCE_LINK_PROMPT: &str =
    "The attached file contains a single token on one line. \
     Reply with only that token, exactly as written, and nothing else.";
/// Ceiling for the resource-link probe. Same reasoning as the permission
/// probe: the model is already loaded by the time this runs.
const SMOKE_RESOURCE_LINK_TIMEOUT_SECS: u64 = 90;

/// Probe the bundled llama-server `/health`. `Ok(())` only when a port is bound
/// AND the endpoint returns success within the budget; otherwise a stage error.
async fn smoke_check_local_health(
    local_state: &crate::commands::local_inference::LocalInferenceState,
) -> Result<(), String> {
    let port = local_state
        .current_port()
        .await
        .ok_or_else(|| "Local AI server is not running".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(SMOKE_HEALTH_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
    let url = format!("http://127.0.0.1:{}/health", port);
    let healthy = client
        .get(&url)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);
    if healthy {
        Ok(())
    } else {
        Err(format!("Local AI server on port {port} is not responding to /health"))
    }
}

/// Bounded end-to-end smoke test of the Local Agent chain. Always tears the
/// probe agent down before returning (success or failure). Never panics — every
/// stage maps to a `SmokeTestReport` with the failing stage + error string.
///
/// When `require_local_server` is true (the Local Agent preset case) the bundled
/// llama-server must be healthy first; otherwise the health stage is skipped so
/// the same command can verify any ACP agent.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn acp_agent_smoke_test(
    app: AppHandle,
    state: State<'_, AcpState>,
    network_proxy_state: State<'_, crate::commands::network_proxy::NetworkProxyState>,
    local_state: State<'_, crate::commands::local_inference::LocalInferenceState>,
    agent_binary: String,
    agent_args: Option<Vec<String>>,
    working_directory: String,
    env_vars: Option<HashMap<String, String>>,
    connection_id: Option<String>,
    env_var_keys: Option<Vec<String>>,
    sandbox_enabled: Option<bool>,
    sandbox_paths: Option<Vec<String>>,
    network_sandbox_enabled: Option<bool>,
    network_allowed_domains: Option<Vec<String>>,
    kernel_network_deny: Option<bool>,
    extra_localhost_ports: Option<Vec<u16>>,
    require_local_server: Option<bool>,
    // Run the permission stage. Only the pi preset needs it: its permission
    // gate is a TypeScript extension we ship into pi's config dir, loaded by
    // whatever pi is installed and type-checked against nothing.
    verify_permission_gate: Option<bool>,
    // Run the resource-link stage (#815). Off by default; the frontend turns it
    // on for `custom_acp`, where the spec's "all agents MUST support resource
    // links" is an unenforced promise from an arbitrary third-party binary.
    verify_resource_links: Option<bool>,
) -> Result<SmokeTestReport, String> {
    // Cloned up front: `app` is moved into the network-proxy start below, and
    // the permission probe needs a handle of its own to listen on.
    let app_for_probe = app.clone();
    let started = std::time::Instant::now();
    let elapsed = |s: &std::time::Instant| s.elapsed().as_millis() as u64;
    let fail = |stage: SmokeStage, err: String, s: &std::time::Instant| SmokeTestReport {
        ok: false,
        stage,
        error: Some(err),
        elapsed_ms: elapsed(s),
    };

    // Stage 1 — bundled server health (preset only).
    if require_local_server.unwrap_or(false) {
        if let Err(e) = smoke_check_local_health(&local_state).await {
            return Ok(fail(SmokeStage::Health, e, &started));
        }
    }

    // Stage 2 — spawn + initialize.
    let spawn = tokio::time::timeout(
        std::time::Duration::from_secs(SMOKE_SPAWN_TIMEOUT_SECS),
        acp_agent_spawn(
            app,
            state.clone(),
            network_proxy_state,
            agent_binary,
            agent_args,
            AgentRole::Interactive,
            working_directory.clone(),
            env_vars,
            sandbox_enabled,
            sandbox_paths,
            network_sandbox_enabled,
            network_allowed_domains,
            kernel_network_deny,
            connection_id,
            env_var_keys,
            extra_localhost_ports,
        ),
    )
    .await;
    let instance_id = match spawn {
        Ok(Ok(result)) => result.instance_id,
        Ok(Err(e)) => return Ok(fail(SmokeStage::Spawn, e, &started)),
        Err(_) => {
            return Ok(fail(
                SmokeStage::Spawn,
                format!("Agent spawn timed out after {SMOKE_SPAWN_TIMEOUT_SECS}s"),
                &started,
            ))
        }
    };

    // From here on, always stop the probe agent before returning. `stop_then`
    // does the best-effort teardown then hands back the report. (A closure that
    // captures `State` can't be used here — the async return-type lifetime won't
    // outlive the borrow — so the teardown is inlined at each exit instead.)

    // Best-effort authenticate (mirror spawn; most local agents have no auth).
    if let Err(auth_err) = acp_agent_authenticate(state.clone(), instance_id.clone(), None).await {
        let msg = auth_err.to_lowercase();
        if !msg.contains("not implemented") && !msg.contains("no authentication methods") {
            let _ = acp_agent_stop(state.clone(), instance_id).await;
            return Ok(fail(SmokeStage::Spawn, format!("Authentication failed: {auth_err}"), &started));
        }
    }

    // Stage 3 — session/new.
    let session = tokio::time::timeout(
        std::time::Duration::from_secs(SMOKE_SESSION_TIMEOUT_SECS),
        acp_session_new(state.clone(), instance_id.clone(), working_directory.clone(), None),
    )
    .await;
    let session_id = match session {
        Ok(Ok(s)) => s.session_id,
        Ok(Err(e)) => {
            let _ = acp_agent_stop(state.clone(), instance_id).await;
            return Ok(fail(SmokeStage::Session, e, &started));
        }
        Err(_) => {
            let _ = acp_agent_stop(state.clone(), instance_id).await;
            return Ok(fail(
                SmokeStage::Session,
                format!("session/new timed out after {SMOKE_SESSION_TIMEOUT_SECS}s"),
                &started,
            ));
        }
    };

    // Stage 4 — one short prompt (pays cold model-load cost on first call).
    let prompt = tokio::time::timeout(
        std::time::Duration::from_secs(SMOKE_PROMPT_TIMEOUT_SECS),
        acp_session_prompt(
            state.clone(),
            instance_id.clone(),
            session_id.clone(),
            SMOKE_PROMPT.to_string(),
            None,
            None,
        ),
    )
    .await;
    let prompt_failure = match prompt {
        // Any returned stop reason means the ACP round trip works, which is all
        // this stage claims to prove — a small local model can legitimately hit
        // `max_tokens` even on the smoke prompt, and failing setup for that would
        // be wrong. Still logged: a `refusal` here is worth seeing in the log.
        Ok(Ok(stop_reason)) => {
            if stop_reason != "end_turn" {
                log::warn!(
                    target: "notesage::acp",
                    "Smoke-test prompt ended with stop_reason={} (round trip OK, not failing setup)",
                    stop_reason,
                );
            }
            None
        }
        Ok(Err(e)) => Some(fail(SmokeStage::Prompt, e, &started)),
        Err(_) => Some(fail(
            SmokeStage::Prompt,
            format!("prompt timed out after {SMOKE_PROMPT_TIMEOUT_SECS}s (model may still be loading)"),
            &started,
        )),
    };

    // Stage 5 — the permission gate still gates (pi preset only).
    //
    // Provoke a NON-read-only tool call and watch two streams: does a
    // permission request arrive, and does a tool call run? Three outcomes,
    // and only one of them is a failure:
    //
    //   tool call ran, no permission request  ->  FAIL. The gate is not
    //       gating: pi is writing without asking. Unambiguous.
    //   permission request arrived            ->  PASS.
    //   no tool call attempted at all         ->  INCONCLUSIVE. The model
    //       declined to act, which small local models do. Warn, do not fail.
    //
    // That third case is why this is not simply "assert a request arrives".
    // A check that randomly blocks setup on a healthy agent gets ignored, and
    // an ignored check protects nobody — so it stays quiet where it cannot
    // tell, and is loud only where it can.
    let permission_failure = if verify_permission_gate.unwrap_or(false)
        && prompt_failure.is_none()
    {
        run_permission_probe(&app_for_probe, &state, &instance_id, &session_id, &started, &fail).await
    } else {
        None
    };

    // Stage 6 — the agent actually reads an attached file (#815).
    //
    // Only when the earlier stages passed: an agent that could not answer the
    // trivial prompt tells us nothing about resource links, and running this
    // anyway would report the wrong failure.
    let resource_link_failure = if verify_resource_links.unwrap_or(false)
        && prompt_failure.is_none()
        && permission_failure.is_none()
    {
        run_resource_link_probe(&app_for_probe, &state, &instance_id, &session_id, &started, &fail)
            .await
    } else {
        None
    };

    // Single teardown for every path.
    let _ = acp_agent_stop(state.clone(), instance_id).await;

    if let Some(report) = permission_failure {
        return Ok(report);
    }
    if let Some(report) = resource_link_failure {
        return Ok(report);
    }

    Ok(prompt_failure.unwrap_or(SmokeTestReport {
        ok: true,
        stage: SmokeStage::Done,
        error: None,
        elapsed_ms: elapsed(&started),
    }))
}



/// What the permission probe observed.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PermissionVerdict {
    /// A tool ran with no permission request in front of it.
    GateMissing(&'static str),
    /// A permission request arrived — the gate is doing its job.
    Gated,
    /// The model never attempted a tool call, so the gate was never exercised.
    Inconclusive,
}

/// Decide the probe's outcome from the two things it watched.
///
/// The whole design is in this function, so it is separate and tested.
///
/// Only ONE combination is a failure: a tool call that ran with no permission
/// request. "No tool call at all" is deliberately NOT a failure — small local
/// models routinely answer in prose instead of acting, and a check that
/// randomly blocks setup on a healthy agent gets ignored. An ignored check
/// protects nobody, so this stays quiet where it cannot tell and is loud only
/// where it can.
pub(crate) fn permission_verdict(acted: bool, asked: bool) -> PermissionVerdict {
    match (acted, asked) {
        (true, false) => PermissionVerdict::GateMissing(
            "the agent ran a tool without asking permission — the gate is not loading. \
             pi runs writes unprompted in this state; do not use this agent until the \
             bridge is rebuilt against the installed pi.",
        ),
        (_, true) => PermissionVerdict::Gated,
        (false, false) => PermissionVerdict::Inconclusive,
    }
}

/// What the resource-link probe observed (#815).
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ResourceLinkVerdict {
    /// The token came back — the agent genuinely read the attached file.
    Honoured,
    /// The agent answered, at length, without the token. The file was attached
    /// and the instruction left no other reasonable move, so the most likely
    /// reading is that the resource link never reached the model.
    Ignored(&'static str),
    /// Nothing to judge: the agent produced no text at all (timeout, refusal,
    /// a model still loading).
    Inconclusive,
}

/// Decide the probe's outcome from the two things it watched.
///
/// The whole design is in this function, so it is separate and tested.
///
/// Mirrors `permission_verdict`'s philosophy deliberately: be loud only where
/// the evidence is unambiguous, and silent where it is not. An agent that said
/// nothing proves nothing — small local models time out and refuse — so that
/// is `Inconclusive` rather than a failure. A check that randomly blocks
/// registration on a healthy agent gets ignored, and an ignored check protects
/// nobody.
///
/// The one case this DOES call a failure is an agent that answered
/// substantively and never produced a token that was sitting in a file it was
/// handed, having been asked for nothing else.
pub(crate) fn resource_link_verdict(answered: bool, echoed: bool) -> ResourceLinkVerdict {
    match (answered, echoed) {
        (_, true) => ResourceLinkVerdict::Honoured,
        (true, false) => ResourceLinkVerdict::Ignored(
            "the agent answered without reading the file it was given. Attachments are \
             sent as ACP resource links, which the spec makes mandatory but this agent \
             appears not to honour — files attached in the command bar will not reach \
             it, and it will answer as though it had read them.",
        ),
        (false, false) => ResourceLinkVerdict::Inconclusive,
    }
}

/// Attach a file with an unguessable token and see whether it comes back.
///
/// Returns `Some(report)` only for the unambiguous failure — a substantive
/// answer with no token in it. Everything else, including the agent saying
/// nothing at all, returns `None`.
///
/// Listens on the same Tauri events the frontend uses, for the same reason the
/// permission probe does: it observes exactly what the UI would, with no new
/// plumbing and no risk of passing through a path the real app never takes.
async fn run_resource_link_probe(
    app: &AppHandle,
    state: &State<'_, AcpState>,
    instance_id: &str,
    session_id: &str,
    started: &std::time::Instant,
    fail: &impl Fn(SmokeStage, String, &std::time::Instant) -> SmokeTestReport,
) -> Option<SmokeTestReport> {
    // Unguessable, so a model cannot produce it by luck or by pattern — the
    // whole probe rests on the token being impossible to know without reading
    // the file. Derived from the clock rather than a fixed literal for the
    // same reason.
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let token = format!("NSPROBE-{nonce:x}");

    // A real file on disk, because a resource link is a POINTER — the agent
    // has to go and read it, which is precisely the behaviour under test.
    let path = std::env::temp_dir().join(format!("notesage-resource-probe-{nonce:x}.txt"));
    if std::fs::write(&path, format!("{token}\n")).is_err() {
        // Cannot set the probe up; that is not the agent's fault.
        return None;
    }
    let path_string = path.to_string_lossy().into_owned();

    let answer = Arc::new(std::sync::Mutex::new(String::new()));
    let sink = answer.clone();
    let probe_instance = instance_id.to_string();
    let update_listener = app.listen("acp-session-update", move |event| {
        let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) else {
            return;
        };
        if payload.get("instanceId").and_then(|v| v.as_str()) != Some(probe_instance.as_str()) {
            return;
        }
        // Accumulate every text the agent emits, thinking included: an agent
        // that read the file often quotes the token while reasoning, and
        // counting that as a miss would be a false failure.
        let Some(update) = payload.get("update") else { return };
        if let Some(text) = update
            .get("content")
            .and_then(|c| c.get("text"))
            .and_then(|t| t.as_str())
        {
            if let Ok(mut acc) = sink.lock() {
                acc.push_str(text);
            }
        }
    });

    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(SMOKE_RESOURCE_LINK_TIMEOUT_SECS),
        acp_session_prompt(
            state.clone(),
            instance_id.to_string(),
            session_id.to_string(),
            SMOKE_RESOURCE_LINK_PROMPT.to_string(),
            None,
            Some(vec![path_string]),
        ),
    )
    .await;

    app.unlisten(update_listener);
    let _ = std::fs::remove_file(&path);

    let text = answer.lock().map(|a| a.clone()).unwrap_or_default();
    let answered = !text.trim().is_empty();
    let echoed = text.contains(&token);

    match resource_link_verdict(answered, echoed) {
        ResourceLinkVerdict::Honoured => None,
        ResourceLinkVerdict::Ignored(msg) => {
            Some(fail(SmokeStage::ResourceLink, msg.to_string(), started))
        }
        ResourceLinkVerdict::Inconclusive => {
            log::warn!(
                target: "notesage::acp",
                "Resource-link probe inconclusive: the agent produced no text, so the \
                 attachment path was not exercised"
            );
            None
        }
    }
}

/// Provoke a write and observe whether the permission gate intercepts it.
///
/// Returns `Some(report)` only for the one unambiguous failure: a tool call
/// that ran with no permission request in front of it. Everything else —
/// including the model simply not attempting a write — returns `None`.
///
/// Listens on the same Tauri events the frontend uses rather than reaching
/// into the client, so it observes exactly what the UI would: no new plumbing,
/// and no risk of the probe passing through a path the real app does not take.
async fn run_permission_probe(
    app: &AppHandle,
    state: &State<'_, AcpState>,
    instance_id: &str,
    session_id: &str,
    started: &std::time::Instant,
    fail: &impl Fn(SmokeStage, String, &std::time::Instant) -> SmokeTestReport,
) -> Option<SmokeTestReport> {
    use std::sync::atomic::{AtomicBool, Ordering};

    let saw_permission = Arc::new(AtomicBool::new(false));
    let saw_tool_call = Arc::new(AtomicBool::new(false));

    // Auto-DENY every request this probe provokes. The probe must leave nothing
    // behind — the point is to observe the gate, not to write a file — and no
    // UI is listening for a probe agent, so an unanswered request would simply
    // hang until the timeout.
    let perm_flag = saw_permission.clone();
    let perm_app = app.clone();
    let perm_instance = instance_id.to_string();
    let perm_listener = app.listen("acp-permission-request", move |event| {
        let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) else {
            return;
        };
        if payload.get("instanceId").and_then(|v| v.as_str()) != Some(perm_instance.as_str()) {
            return;
        }
        perm_flag.store(true, Ordering::SeqCst);
        let Some(request_id) = payload.get("requestId").and_then(|v| v.as_str()) else {
            return;
        };
        // Answer through the SAME command the UI uses, rather than reaching
        // into the waiter map — the probe should exercise the real path, and
        // the map lives behind the agent handle anyway.
        //
        // Deny (no option id): the probe exists to observe the gate, not to
        // write a file, and it must leave nothing behind. Spawned because the
        // listener is sync and the respond path is async; the state is re-fetched
        // from the app handle since `State` cannot cross into a 'static closure.
        let app_for_reply = perm_app.clone();
        let instance = perm_instance.clone();
        let rid = request_id.to_string();
        tauri::async_runtime::spawn(async move {
            let state = app_for_reply.state::<AcpState>();
            let _ = acp_permission_respond(state, instance, rid, None).await;
        });
    });

    let tool_flag = saw_tool_call.clone();
    let tool_instance = instance_id.to_string();
    let update_listener = app.listen("acp-session-update", move |event| {
        let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) else {
            return;
        };
        if payload.get("instanceId").and_then(|v| v.as_str()) != Some(tool_instance.as_str()) {
            return;
        }
        // `sessionUpdate` names the variant; a tool call is what we care about.
        let kind = payload
            .get("update")
            .and_then(|u| u.get("sessionUpdate"))
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        if kind == "tool_call" {
            tool_flag.store(true, Ordering::SeqCst);
        }
    });

    let verdict = {
        {
            let _ = tokio::time::timeout(
                std::time::Duration::from_secs(SMOKE_PERMISSION_TIMEOUT_SECS),
                acp_session_prompt(
                    state.clone(),
                    instance_id.to_string(),
                    session_id.to_string(),
                    SMOKE_PERMISSION_PROMPT.to_string(),
                    None,
                    None,
                ),
            )
            .await;

            let asked = saw_permission.load(Ordering::SeqCst);
            let acted = saw_tool_call.load(Ordering::SeqCst);
            match permission_verdict(acted, asked) {
                PermissionVerdict::GateMissing(msg) => {
                    Some(fail(SmokeStage::Permission, msg.to_string(), started))
                }
                PermissionVerdict::Gated => None,
                PermissionVerdict::Inconclusive => {
                    log::warn!(
                        target: "notesage::acp",
                        "Permission probe inconclusive: the model attempted no tool call, so the gate was not exercised"
                    );
                    None
                }
            }
        }
    };

    app.unlisten(perm_listener);
    app.unlisten(update_listener);
    verdict
}

/// Create a new ACP session.
#[tauri::command]
pub async fn acp_session_new(
    state: State<'_, AcpState>,
    instance_id: String,
    working_directory: String,
    // Enabled, scope-matching, capability-gated MCP servers from the renderer
    // (task #11). `None` keeps the legacy no-MCP behavior for callers that don't
    // pass it. Built here (keychain secrets resolved) before the agent thread.
    mcp_servers: Option<Vec<AcpMcpServerInput>>,
) -> Result<SessionResult, String> {
    let mcp_servers = build_acp_mcp_servers(mcp_servers.unwrap_or_default()).await;

    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    }; // lock released here

    let (reply_tx, reply_rx) = oneshot::channel();

    cmd_tx
        .send(AgentCmd::NewSession {
            working_directory,
            mcp_servers,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    let result = reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to new_session".to_string())??;

    Ok(result)
}

/// Load an existing ACP session.
#[tauri::command]
pub async fn acp_session_load(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    working_directory: String,
    // MCP servers for the reloaded session (task #11). ACP treats this as the
    // complete list for the loaded session, so the renderer re-sends the current
    // set. `None` keeps the legacy no-MCP behavior.
    mcp_servers: Option<Vec<AcpMcpServerInput>>,
) -> Result<SessionResult, String> {
    let mcp_servers = build_acp_mcp_servers(mcp_servers.unwrap_or_default()).await;

    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    }; // lock released here

    let (reply_tx, reply_rx) = oneshot::channel();

    cmd_tx
        .send(AgentCmd::LoadSession {
            session_id,
            working_directory,
            mcp_servers,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    let result = reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to load_session".to_string())??;

    Ok(result)
}

/// Send a prompt to an ACP session. Blocks until the agent completes the turn.
/// Session updates are emitted as `acp-session-update` Tauri events.
/// Permission requests are emitted as `acp-permission-request` events.
///
/// Message identity is agent-assigned: `agent_message_chunk` updates carry an
/// optional `messageId` (`ContentChunk.message_id`) grouping the chunks of one
/// message — there is no client-supplied message id in ACP 0.14.
///
/// Returns the turn's ACP stop reason as a snake_case string (`end_turn`,
/// `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`, or `unknown`).
/// Anything other than `end_turn` means the agent stopped before finishing its
/// work; callers MUST surface that, otherwise an agent that exhausted its token
/// or turn budget mid-task is indistinguishable from one that completed.
#[tauri::command]
pub async fn acp_session_prompt(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    content: String,
    images: Option<Vec<crate::commands::ai::ImageData>>,
    // Absolute paths attached in the command bar. Sent as ACP resource links
    // rather than named in the system prompt — see `handle_prompt`.
    attached_file_paths: Option<Vec<String>>,
) -> Result<String, String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    }; // lock released here

    let (reply_tx, reply_rx) = oneshot::channel();

    cmd_tx
        .send(AgentCmd::Prompt {
            session_id,
            content,
            images,
            attached_file_paths: attached_file_paths.unwrap_or_default(),
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    // 30-minute timeout — prompts can take very long for research tasks with many
    // tool calls, web fetches, and file reads. The frontend has a 60s unresponsive
    // timer (reset by each ACP event) for actual hangs; this backend timeout is
    // only a hard ceiling to prevent truly abandoned prompts from leaking forever.
    tokio::time::timeout(std::time::Duration::from_secs(1800), reply_rx)
        .await
        .map_err(|_| "Prompt timed out after 30 minutes — the agent may be hung or crashed".to_string())?
        .map_err(|_| "Agent thread did not respond to prompt (channel dropped — agent likely crashed)".to_string())?
}

/// Check whether the agent supports image content in prompts.
#[tauri::command]
pub async fn acp_supports_images(
    state: State<'_, AcpState>,
    instance_id: String,
) -> Result<bool, String> {
    let agents = state.agents.lock().await;
    let handle = agents
        .get(&instance_id)
        .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
    Ok(handle.supports_images)
}

/// Cancel the current prompt in an ACP session.
#[tauri::command]
pub async fn acp_session_cancel(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
) -> Result<(), String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    }; // lock released here

    let (reply_tx, reply_rx) = oneshot::channel();

    cmd_tx
        .send(AgentCmd::Cancel {
            session_id,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to cancel".to_string())?
}

/// Set the session mode for an ACP agent.
#[tauri::command]
pub async fn acp_session_set_mode(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    mode_id: String,
) -> Result<(), String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    cmd_tx
        .send(AgentCmd::SetMode {
            session_id,
            mode_id,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to set_mode".to_string())?
}

/// Set a session config option for an ACP agent.
#[tauri::command]
pub async fn acp_session_set_config_option(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    option_id: String,
    value_id: String,
) -> Result<(), String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    cmd_tx
        .send(AgentCmd::SetConfigOption {
            session_id,
            option_id,
            value_id,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to set_config_option".to_string())?
}

/// Close an ACP session. Best-effort — agents may not support this.
/// Capability-gated on `session_capabilities.close` from the frontend.
#[tauri::command]
pub async fn acp_session_close(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
) -> Result<(), String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    cmd_tx
        .send(AgentCmd::CloseSession { session_id, reply: reply_tx })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to close_session".to_string())?
}

/// List the agent's sessions, optionally filtered by `cwd` and paginated via `cursor`.
/// Capability-gated on `session_capabilities.list` from the frontend.
#[tauri::command]
pub async fn acp_session_list(
    state: State<'_, AcpState>,
    instance_id: String,
    cwd: Option<String>,
    cursor: Option<String>,
) -> Result<AcpListResult, String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    cmd_tx
        .send(AgentCmd::ListSessions { cwd, cursor, reply: reply_tx })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to list_sessions".to_string())?
}

/// Resume an existing ACP session. Lightweight alternative to `session/load` when the
/// agent still has the session in memory. Capability-gated on `session_capabilities.resume`.
#[tauri::command]
pub async fn acp_session_resume(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    working_directory: String,
) -> Result<SessionResult, String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    cmd_tx
        .send(AgentCmd::ResumeSession {
            session_id,
            working_directory,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    let result = reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to resume_session".to_string())??;

    Ok(result)
}

/// Fork an existing ACP session, returning a new session ID that inherits the agent's state.
/// Capability-gated on `session_capabilities.fork` from the frontend.
#[tauri::command]
pub async fn acp_session_fork(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    working_directory: String,
) -> Result<SessionResult, String> {
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    cmd_tx
        .send(AgentCmd::ForkSession {
            session_id,
            working_directory,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    let result = reply_rx
        .await
        .map_err(|_| "Agent thread did not respond to fork_session".to_string())??;

    Ok(result)
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
    let cmd_tx = {
        let agents = state.agents.lock().await;
        let handle = agents
            .get(&instance_id)
            .ok_or_else(|| format!("No agent found with instance_id: {}", instance_id))?;
        handle.cmd_tx.clone()
    }; // lock released here

    cmd_tx
        .send(AgentCmd::PermissionRespond {
            request_id,
            option_id,
        })
        .await
        .map_err(|_| "Agent thread is no longer running".to_string())?;

    Ok(())
}
