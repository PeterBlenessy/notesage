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

/// Result of generating the Local Agent config.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentConfig {
    /// Base directory of the Goose preset's isolated XDG tree. No config file is
    /// written for Goose — kept for API compatibility with the frontend type.
    pub config_path: String,
    /// Env vars the spawn must inject to point Goose at the bundled server and
    /// isolate its config tree. Secrets are never included (the only key is a
    /// dummy the local server ignores) — this is path/provider config only.
    pub env: HashMap<String, String>,
    /// Respawn trigger key (`<port>:<model-id>`) — the frontend stores this and
    /// regenerates + respawns when it changes (#10).
    pub config_key: String,
    /// The bundled server port the env points at.
    pub port: u16,
    /// The model id wired into the env (`GOOSE_MODEL`).
    pub model_id: String,
}

/// Generate the Goose env from the LIVE bundled server state. No file is
/// written — Goose is configured purely via the returned `env` map. The XDG
/// base dirs ARE created so Goose can write into them under the sandbox.
#[tauri::command]
pub async fn local_agent_write_config(
    state: State<'_, LocalInferenceState>,
) -> Result<LocalAgentConfig, String> {
    let port = state
        .current_port()
        .await
        .ok_or_else(|| "Local AI server is not running — start it before configuring the agent".to_string())?;
    let model_id = state
        .current_model()
        .await
        .ok_or_else(|| "Local AI server has no active model".to_string())?;

    let base = local_agent_base_dir();
    // Create the four XDG dirs so Goose can write into them under the Seatbelt
    // sandbox (they fall under the `.notesage` write-allow). No config file.
    for sub in ["config", "data", "state", "cache"] {
        let dir = base.join(sub);
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
    }

    Ok(LocalAgentConfig {
        config_path: base.to_string_lossy().to_string(),
        env: build_goose_env(port, &model_id),
        config_key: config_key(port, &model_id),
        port,
        model_id,
    })
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
}
