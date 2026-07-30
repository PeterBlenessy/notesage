//! Local Agent preset plumbing — wires the bundled llama-server to an installed
//! Goose binary so "Local AI" can run agentic chat offline (PRD
//! 2026-06-12-local-ai-agents, task #8).
//!
//! Goose (Block's open-source ACP agent) is configured PURELY via environment
//! variables — no config file is written. The env points Goose at the bundled
//! server's OpenAI-compatible endpoint and redirects its XDG state into a
//! Notesage-owned directory tree (sandbox-writable), so the user's own Goose
//! setup is never touched.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use super::local_inference::LocalInferenceState;

/// Base directory for the Goose preset's isolated config/data/state/cache tree.
/// Everything Goose reads/writes for the preset lives under here, so the
/// Seatbelt grant (#9) is a single Notesage-owned subtree (the `.notesage`
/// grant) rather than the user's real `~/.config/goose` etc.
fn local_agent_base_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".notesage")
        .join("agents")
        .join("goose")
}

/// The config key that, when changed, must trigger a Goose respawn (#10):
/// the live llama-server port + active model id. Mirrors `sandboxScopeKey`.
fn config_key(port: u16, model_id: &str) -> String {
    format!("{}:{}", port, model_id)
}

/// Static environment variables (independent of the live port/model). Goose is
/// configured entirely through env vars — no config file:
///
/// - `GOOSE_PROVIDER=openai` + `OPENAI_API_KEY` (a dummy the local server
///   ignores) select the OpenAI-compatible provider.
/// - `GOOSE_DISABLE_KEYRING=1` keeps Goose off the OS keychain (it has no cloud
///   credentials to store and the keychain is denied under the sandbox).
/// - The four XDG dirs are redirected into the Notesage-owned subtree so Goose's
///   entire footprint stays isolated AND inside the Seatbelt write-allow (the
///   `.notesage` grant). Goose honors all four (verified on macOS).
fn static_env() -> HashMap<String, String> {
    let base = local_agent_base_dir();
    let mut env = HashMap::new();

    env.insert("GOOSE_PROVIDER".to_string(), "openai".to_string());
    // Dummy key — the bundled llama-server ignores Authorization, but Goose's
    // OpenAI provider requires the var to be present.
    env.insert("OPENAI_API_KEY".to_string(), "sk-local-dummy".to_string());
    env.insert("GOOSE_DISABLE_KEYRING".to_string(), "1".to_string());

    // XDG isolation — all four under the Notesage-owned base so Goose's state
    // never lands in the user's real ~/.config|.local|.cache and stays inside
    // the sandbox write-allow.
    env.insert(
        "XDG_CONFIG_HOME".to_string(),
        base.join("config").to_string_lossy().to_string(),
    );
    env.insert(
        "XDG_DATA_HOME".to_string(),
        base.join("data").to_string_lossy().to_string(),
    );
    env.insert(
        "XDG_STATE_HOME".to_string(),
        base.join("state").to_string_lossy().to_string(),
    );
    env.insert(
        "XDG_CACHE_HOME".to_string(),
        base.join("cache").to_string_lossy().to_string(),
    );

    env
}

/// Build the full Goose env map for a live (port, model). Combines `static_env`
/// with the two dynamic vars that depend on the running bundled server.
fn build_goose_env(port: u16, model_id: &str) -> HashMap<String, String> {
    let mut env = static_env();
    // Point Goose's OpenAI provider at the bundled server. Goose appends `/v1`
    // itself, so OPENAI_HOST is the bare origin.
    env.insert(
        "OPENAI_HOST".to_string(),
        format!("http://localhost:{}", port),
    );
    env.insert("GOOSE_MODEL".to_string(), model_id.to_string());
    env
}

/// Base directory for the pi preset's isolated config tree. pi's
/// `PI_CODING_AGENT_DIR` layout is FLAT (models.json, settings.json,
/// extensions/ directly under the dir — verified in spike #1), and everything
/// lives inside the `.notesage` Seatbelt write-allow.
fn pi_base_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".notesage")
        .join("agents")
        .join("pi")
}

/// The two Notesage-shipped pi extensions, embedded at compile time from the
/// bridge package and (re)written on every config generation so extension
/// updates ride app updates and a user's own pi install is never touched.
const PI_EXT_PERMISSION_GATE: &str =
    include_str!("../../../bridges/pi-acp/extensions/permission-gate.ts");
const PI_EXT_MCP_TOOLS: &str = include_str!("../../../bridges/pi-acp/extensions/mcp-tools.ts");

/// pi `models.json` content for the live bundled server. Dummy key — pi's
/// custom-provider docs prescribe a placeholder for keyless local servers;
/// the bundled llama-server ignores Authorization (verified: `Bearer dummy`
/// arrives and is ignored, spike #1).
fn pi_models_json(port: u16, model_id: &str, context_window: u32) -> serde_json::Value {
    serde_json::json!({
        "providers": {
            "local": {
                "name": "Notesage Local AI",
                "baseUrl": format!("http://localhost:{}/v1", port),
                "api": "openai-completions",
                "apiKey": "dummy",
                "models": [
                    {
                        "id": model_id,
                        "name": model_id,
                        "contextWindow": context_window,
                        "maxTokens": 4096
                    }
                ]
            }
        }
    })
}

/// pi `settings.json`: default provider/model (belt-and-braces with the
/// bridge's `-- --provider local --model <id>` args) and install telemetry
/// off (PI_OFFLINE=1 already disables all startup network; this pins the
/// setting so a future env regression can't silently re-enable it).
fn pi_settings_json(model_id: &str) -> serde_json::Value {
    serde_json::json!({
        "defaultProvider": "local",
        "defaultModel": model_id,
        "enableInstallTelemetry": false
    })
}

/// Env for the BRIDGE spawn (inherited by pi): offline hard-off for startup
/// network, the isolated flat config dir, and NO_PROXY.
///
/// NO_PROXY is REQUIRED on macOS, not merely defensive (spike #2, verified on
/// macOS 2026-07-30): pi's undici stack DOES honor `HTTP(S)_PROXY` for the
/// localhost llama-server call, so with our per-agent proxy vars injected and
/// no NO_PROXY, the model call routes into the domain-filtering proxy and the
/// turn stalls. `NO_PROXY=localhost,127.0.0.1` makes pi hit the kernel-allowed
/// llama port directly (same posture as Goose). The earlier Linux spike run
/// wrongly concluded pi ignored proxy vars — corrected by the macOS run.
fn build_pi_env() -> HashMap<String, String> {
    let base = pi_base_dir();
    let mut env = HashMap::new();
    env.insert("PI_OFFLINE".to_string(), "1".to_string());
    env.insert(
        "PI_CODING_AGENT_DIR".to_string(),
        base.to_string_lossy().to_string(),
    );
    env.insert("NO_PROXY".to_string(), "localhost,127.0.0.1".to_string());
    env.insert("no_proxy".to_string(), "localhost,127.0.0.1".to_string());
    env
}

/// Args the frontend appends to the bridge spawn (`notesage-pi-acp --pi-bin
/// <pi> -- <these>`): provider/model selection against the live server plus a
/// sessions dir inside the isolated tree. The `--pi-bin` half is resolved
/// frontend-side from the managed install.
fn build_pi_args(model_id: &str) -> Vec<String> {
    vec![
        "--provider".to_string(),
        "local".to_string(),
        "--model".to_string(),
        model_id.to_string(),
        "--session-dir".to_string(),
        pi_base_dir().join("sessions").to_string_lossy().to_string(),
    ]
}

/// Result of generating the Local Agent config.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentConfig {
    /// Which preset engine this config is for (`goose` | `pi`).
    pub agent: String,
    /// Base directory of the preset's isolated tree (Goose: XDG root, no file
    /// written; pi: flat PI_CODING_AGENT_DIR with generated files).
    pub config_path: String,
    /// Env vars the spawn must inject. Secrets are never included (the only
    /// key is a dummy the local server ignores) — path/provider config only.
    pub env: HashMap<String, String>,
    /// Respawn trigger key (`<port>:<model-id>`) — the frontend stores this and
    /// regenerates + respawns when it changes (#10).
    pub config_key: String,
    /// The bundled server port the config points at.
    pub port: u16,
    /// The model id wired in.
    pub model_id: String,
    /// pi only: args for the bridge after `--` (provider/model/session-dir).
    /// Empty for Goose.
    pub pi_args: Vec<String>,
}

/// Generate the Local Agent config for the requested engine from the LIVE
/// bundled server state. `agent` is `None`/`"goose"` (env-only, back-compat)
/// or `"pi"` (writes the flat PI_CODING_AGENT_DIR tree: models.json,
/// settings.json, the two shipped extensions, sessions dir).
#[tauri::command]
pub async fn local_agent_write_config(
    state: State<'_, LocalInferenceState>,
    agent: Option<String>,
) -> Result<LocalAgentConfig, String> {
    let port = state
        .current_port()
        .await
        .ok_or_else(|| "Local AI server is not running — start it before configuring the agent".to_string())?;
    let model_id = state
        .current_model()
        .await
        .ok_or_else(|| "Local AI server has no active model".to_string())?;

    match agent.as_deref().unwrap_or("goose") {
        "goose" => {
            let base = local_agent_base_dir();
            // Create the four XDG dirs so Goose can write into them under the
            // Seatbelt sandbox (the `.notesage` write-allow). No config file.
            for sub in ["config", "data", "state", "cache"] {
                let dir = base.join(sub);
                std::fs::create_dir_all(&dir)
                    .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
            }
            Ok(LocalAgentConfig {
                agent: "goose".to_string(),
                config_path: base.to_string_lossy().to_string(),
                env: build_goose_env(port, &model_id),
                config_key: config_key(port, &model_id),
                port,
                model_id,
                pi_args: Vec::new(),
            })
        }
        "pi" => {
            let context_window = state.current_context().await.unwrap_or(4096);
            let base = pi_base_dir();
            for sub in ["extensions", "sessions"] {
                let dir = base.join(sub);
                std::fs::create_dir_all(&dir)
                    .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
            }
            let write = |name: &str, content: String| -> Result<(), String> {
                let path = base.join(name);
                std::fs::write(&path, content)
                    .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
            };
            write(
                "models.json",
                serde_json::to_string_pretty(&pi_models_json(port, &model_id, context_window))
                    .map_err(|e| e.to_string())?,
            )?;
            write(
                "settings.json",
                serde_json::to_string_pretty(&pi_settings_json(&model_id))
                    .map_err(|e| e.to_string())?,
            )?;
            // (Re)write the shipped extensions every generation — versioned
            // with the app, never user-edited in place.
            write(
                &format!("extensions{}permission-gate.ts", std::path::MAIN_SEPARATOR),
                PI_EXT_PERMISSION_GATE.to_string(),
            )?;
            write(
                &format!("extensions{}mcp-tools.ts", std::path::MAIN_SEPARATOR),
                PI_EXT_MCP_TOOLS.to_string(),
            )?;

            Ok(LocalAgentConfig {
                agent: "pi".to_string(),
                config_path: base.to_string_lossy().to_string(),
                env: build_pi_env(),
                config_key: config_key(port, &model_id),
                port,
                model_id: model_id.clone(),
                pi_args: build_pi_args(&model_id),
            })
        }
        other => Err(format!("Unknown local agent preset: {}", other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_selects_openai_compatible_provider() {
        let env = build_goose_env(8137, "google_gemma-4-E4B-it-Q4_K_M.gguf");
        assert_eq!(env.get("GOOSE_PROVIDER").map(String::as_str), Some("openai"));
        // Dummy key present (Goose requires the var; the local server ignores it).
        assert_eq!(
            env.get("OPENAI_API_KEY").map(String::as_str),
            Some("sk-local-dummy")
        );
    }

    #[test]
    fn env_points_at_live_server_port() {
        let env = build_goose_env(8137, "m");
        assert_eq!(
            env.get("OPENAI_HOST").map(String::as_str),
            Some("http://localhost:8137")
        );
        // A different port flows through.
        let env2 = build_goose_env(8190, "m");
        assert_eq!(
            env2.get("OPENAI_HOST").map(String::as_str),
            Some("http://localhost:8190")
        );
    }

    #[test]
    fn env_maps_active_model() {
        let env = build_goose_env(8090, "qwen2.5-coder-7b");
        assert_eq!(
            env.get("GOOSE_MODEL").map(String::as_str),
            Some("qwen2.5-coder-7b")
        );
    }

    #[test]
    fn env_isolates_all_four_xdg_dirs_into_notesage_subtree() {
        let env = build_goose_env(8090, "m");
        let base = local_agent_base_dir().to_string_lossy().to_string();
        // All four XDG dirs point under the Notesage-owned base, never the
        // user's real ~/.config|.local|.cache — regression lock so Goose's
        // footprint stays isolated and inside the sandbox write-allow.
        for var in ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] {
            let val = env.get(var).unwrap_or_else(|| panic!("{var} must be set"));
            assert!(
                val.starts_with(&base),
                "{var} must be isolated under the goose base; got {val}"
            );
        }
        // Never leak the user's real ~/.config etc.
        assert!(!env["XDG_CONFIG_HOME"].ends_with("/.config"));
    }

    #[test]
    fn env_disables_keyring() {
        // Goose has no cloud credentials and the OS keychain is denied under the
        // sandbox — GOOSE_DISABLE_KEYRING keeps it off the keychain entirely.
        let env = build_goose_env(8090, "m");
        assert_eq!(
            env.get("GOOSE_DISABLE_KEYRING").map(String::as_str),
            Some("1")
        );
    }

    #[test]
    fn config_key_changes_with_port_or_model() {
        assert_eq!(config_key(8090, "m"), "8090:m");
        assert_ne!(config_key(8090, "m"), config_key(8091, "m"));
        assert_ne!(config_key(8090, "m"), config_key(8090, "n"));
    }

    // --- pi preset (PRD 2026-07-29-pi-local-agent-preset, task #16) ---

    #[test]
    fn pi_models_json_targets_live_server_with_dummy_key() {
        let v = pi_models_json(8137, "qwen3-8b", 16384);
        let p = &v["providers"]["local"];
        assert_eq!(p["baseUrl"], "http://localhost:8137/v1");
        assert_eq!(p["api"], "openai-completions");
        assert_eq!(p["apiKey"], "dummy");
        assert_eq!(p["models"][0]["id"], "qwen3-8b");
        assert_eq!(p["models"][0]["contextWindow"], 16384);
        // Port flows through on regeneration.
        assert_eq!(
            pi_models_json(8190, "m", 4096)["providers"]["local"]["baseUrl"],
            "http://localhost:8190/v1"
        );
    }

    #[test]
    fn pi_settings_pin_defaults_and_disable_install_telemetry() {
        let v = pi_settings_json("qwen3-8b");
        assert_eq!(v["defaultProvider"], "local");
        assert_eq!(v["defaultModel"], "qwen3-8b");
        assert_eq!(v["enableInstallTelemetry"], false);
    }

    #[test]
    fn pi_env_is_offline_and_isolated_under_notesage_tree() {
        let env = build_pi_env();
        assert_eq!(env.get("PI_OFFLINE").map(String::as_str), Some("1"));
        let base = pi_base_dir().to_string_lossy().to_string();
        assert_eq!(env.get("PI_CODING_AGENT_DIR"), Some(&base));
        assert!(base.contains(".notesage"), "pi tree must live under .notesage");
        // REQUIRED on macOS (spike #2, verified 2026-07-30): pi honors
        // HTTP(S)_PROXY for the localhost llama call, so NO_PROXY is what keeps
        // the model call off the domain-filtering proxy. Not optional.
        assert_eq!(env.get("NO_PROXY").map(String::as_str), Some("localhost,127.0.0.1"));
        assert_eq!(env.get("no_proxy").map(String::as_str), Some("localhost,127.0.0.1"));
        assert_eq!(env.get("no_proxy").map(String::as_str), Some("localhost,127.0.0.1"));
    }

    #[test]
    fn pi_args_select_provider_model_and_isolated_sessions_dir() {
        let args = build_pi_args("qwen3-8b");
        assert_eq!(&args[0..4], &["--provider", "local", "--model", "qwen3-8b"]);
        assert_eq!(args[4], "--session-dir");
        assert!(args[5].starts_with(&pi_base_dir().to_string_lossy().to_string()));
    }

    #[test]
    fn shipped_pi_extensions_are_embedded_from_the_bridge_package() {
        // Regression lock on the include_str! wiring: a moved/renamed
        // extension file breaks the build, and the embedded bodies must be the
        // real implementations, not stubs.
        assert!(PI_EXT_PERMISSION_GATE.contains("__NOTESAGE_PERMISSION__"));
        assert!(PI_EXT_PERMISSION_GATE.contains("tool_call"));
        assert!(PI_EXT_MCP_TOOLS.contains("NOTESAGE_MCP_SERVERS"));
        assert!(PI_EXT_MCP_TOOLS.contains("tools/call"));
    }
}
