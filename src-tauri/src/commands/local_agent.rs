//! Local Agent preset plumbing — wires the bundled llama-server to an installed
//! OpenCode binary so "Local AI" can run agentic chat offline (PRD
//! 2026-06-12-local-ai-agents, task #8).
//!
//! This module generates the OpenCode provider config that points OpenCode at
//! the bundled server's OpenAI-compatible endpoint, written to a Notesage-owned
//! directory tree so the user's own OpenCode setup is never touched.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use super::local_inference::LocalInferenceState;
use super::model_management::find_model_entry;

/// Provider id used inside the generated OpenCode config. Stable so the
/// top-level `model` reference (`<provider>/<model-id>`) resolves.
const PROVIDER_ID: &str = "notesage-local";

/// Base directory for the OpenCode preset's isolated config/data/cache tree.
/// Everything OpenCode reads/writes for the preset lives under here, so the
/// Seatbelt grant (#9) is a single Notesage-owned subtree rather than the
/// user's real `~/.config/opencode` etc.
fn local_agent_base_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".notesage")
        .join("agents")
        .join("opencode")
}

fn config_dir() -> PathBuf {
    // OpenCode (XDG) reads global config from `$XDG_CONFIG_HOME/opencode/`.
    local_agent_base_dir().join("config")
}

/// Absolute path to the generated `opencode.json`.
fn config_file_path() -> PathBuf {
    config_dir().join("opencode").join("opencode.json")
}

/// Build the OpenCode provider config as JSON. Pure + deterministic so the same
/// (port, model) inputs always serialize identically — the basis of the
/// idempotent-regeneration guarantee.
///
/// Shape (OpenCode custom OpenAI-compatible provider): a `provider.<id>` entry
/// using the `@ai-sdk/openai-compatible` npm provider with a `baseURL`, plus a
/// `models` map and a top-level default `model` of `<provider>/<model-id>`.
pub fn build_opencode_config(port: u16, model_id: &str, model_name: &str) -> serde_json::Value {
    serde_json::json!({
        "$schema": "https://opencode.ai/config.json",
        "provider": {
            PROVIDER_ID: {
                "npm": "@ai-sdk/openai-compatible",
                "name": "Notesage Local",
                "options": {
                    // The bundled server exposes an OpenAI-compatible API at /v1.
                    "baseURL": format!("http://localhost:{}/v1", port)
                },
                "models": {
                    model_id: { "name": model_name }
                }
            }
        },
        "model": format!("{}/{}", PROVIDER_ID, model_id)
    })
}

/// The config key that, when changed, must trigger an OpenCode respawn (#10):
/// the live llama-server port + active model id. Mirrors `sandboxScopeKey`.
fn config_key(port: u16, model_id: &str) -> String {
    format!("{}:{}", port, model_id)
}

/// Environment variables that point OpenCode at the isolated config tree.
///
/// VERIFY ON MACOS: which of these OpenCode actually honors must be confirmed
/// against the pinned binary via sandbox violation monitoring (PRD risk note).
/// We set all three XDG dirs (redirecting OpenCode's entire config/data/cache
/// footprint into the Notesage-owned subtree) AND `OPENCODE_CONFIG` (explicit
/// file path) as belt-and-suspenders. If macOS OpenCode uses native
/// `~/Library/Application Support/opencode` instead of XDG, the #9 Bucket C
/// grant must cover that path and this map updated accordingly.
fn isolation_env() -> HashMap<String, String> {
    let base = local_agent_base_dir();
    let mut env = HashMap::new();
    env.insert(
        "XDG_CONFIG_HOME".to_string(),
        config_dir().to_string_lossy().to_string(),
    );
    env.insert(
        "XDG_DATA_HOME".to_string(),
        base.join("data").to_string_lossy().to_string(),
    );
    env.insert(
        "XDG_CACHE_HOME".to_string(),
        base.join("cache").to_string_lossy().to_string(),
    );
    env.insert(
        "OPENCODE_CONFIG".to_string(),
        config_file_path().to_string_lossy().to_string(),
    );
    env
}

/// Result of generating the Local Agent config.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentConfig {
    /// Absolute path to the written `opencode.json`.
    pub config_path: String,
    /// Env vars the spawn must inject to isolate OpenCode's config (see
    /// `isolation_env`). Secrets are never included — this is path config only.
    pub env: HashMap<String, String>,
    /// Respawn trigger key (`<port>:<model-id>`) — the frontend stores this and
    /// regenerates + respawns when it changes (#10).
    pub config_key: String,
    /// The bundled server port the config points at.
    pub port: u16,
    /// The model id wired into the config.
    pub model_id: String,
}

/// Generate (or regenerate) the OpenCode provider config from the LIVE bundled
/// server state and write it to the Notesage-owned config path. Idempotent: an
/// unchanged (port, model) rewrites byte-identical content.
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

    // Friendly model name from the catalog; fall back to the id.
    let model_name = find_model_entry(state.models_dir(), &model_id)
        .map(|e| e.name)
        .unwrap_or_else(|| model_id.clone());

    let config = build_opencode_config(port, &model_id, &model_name);
    let serialized = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize OpenCode config: {}", e))?;

    let path = config_file_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir {}: {}", parent.display(), e))?;
    }
    // Idempotent write: skip the write when content is unchanged so repeated
    // regeneration doesn't churn mtimes (and so a concurrent reader never sees
    // a truncated file mid-rewrite for an unchanged config).
    let unchanged = std::fs::read_to_string(&path)
        .map(|existing| existing == serialized)
        .unwrap_or(false);
    if !unchanged {
        std::fs::write(&path, &serialized)
            .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    }

    Ok(LocalAgentConfig {
        config_path: path.to_string_lossy().to_string(),
        env: isolation_env(),
        config_key: config_key(port, &model_id),
        port,
        model_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_substitutes_live_port_into_base_url() {
        let cfg = build_opencode_config(8137, "qwen2.5-coder-7b", "Qwen2.5 Coder 7B");
        let base_url = cfg["provider"][PROVIDER_ID]["options"]["baseURL"]
            .as_str()
            .unwrap();
        assert_eq!(base_url, "http://localhost:8137/v1");
    }

    #[test]
    fn config_maps_active_model() {
        let cfg = build_opencode_config(8090, "llama-3.1-8b", "Llama 3.1 8B");
        // Model entry present under the provider, keyed by id, with display name.
        assert_eq!(
            cfg["provider"][PROVIDER_ID]["models"]["llama-3.1-8b"]["name"]
                .as_str()
                .unwrap(),
            "Llama 3.1 8B"
        );
        // Top-level default model is "<provider>/<model-id>".
        assert_eq!(
            cfg["model"].as_str().unwrap(),
            "notesage-local/llama-3.1-8b"
        );
        // Uses the OpenAI-compatible AI SDK provider.
        assert_eq!(
            cfg["provider"][PROVIDER_ID]["npm"].as_str().unwrap(),
            "@ai-sdk/openai-compatible"
        );
    }

    #[test]
    fn config_generation_is_idempotent() {
        let a = build_opencode_config(8090, "m", "M");
        let b = build_opencode_config(8090, "m", "M");
        assert_eq!(
            serde_json::to_string_pretty(&a).unwrap(),
            serde_json::to_string_pretty(&b).unwrap(),
            "same inputs must serialize identically"
        );
    }

    #[test]
    fn config_key_changes_with_port_or_model() {
        assert_eq!(config_key(8090, "m"), "8090:m");
        assert_ne!(config_key(8090, "m"), config_key(8091, "m"));
        assert_ne!(config_key(8090, "m"), config_key(8090, "n"));
    }

    #[test]
    fn isolation_env_redirects_xdg_into_notesage_subtree() {
        let env = isolation_env();
        // All XDG dirs point under the Notesage-owned base, never the user's home config.
        let base = local_agent_base_dir().to_string_lossy().to_string();
        assert!(env["XDG_CONFIG_HOME"].starts_with(&base));
        assert!(env["XDG_DATA_HOME"].starts_with(&base));
        assert!(env["XDG_CACHE_HOME"].starts_with(&base));
        assert!(env.contains_key("OPENCODE_CONFIG"));
        // Never leak the user's real ~/.config/opencode.
        assert!(!env["XDG_CONFIG_HOME"].ends_with("/.config"));
    }
}
