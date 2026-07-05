//! Serializable IPC types for the ACP command surface.
//!
//! These mirror the shapes the renderer sends/receives. They deliberately live
//! apart from the agent-thread implementation so the wire contract is easy to
//! audit in one place. No behavior — just data + serde derives.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Clone)]
pub struct AgentExitedPayload {
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "exitCode")]
    pub exit_code: Option<i32>,
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
    pub sandbox_enabled: bool,
    pub network_sandbox_enabled: bool,
    pub supports_images: bool,
    /// AgentCapabilities from the initialize response (passed as JSON to frontend)
    pub capabilities: Option<serde_json::Value>,
}

/// Variant-aware auth method descriptor forwarded to the frontend.
///
/// Mirrors ACP's `AuthMethod` enum (see `agent-client-protocol-schema::agent::AuthMethod`)
/// with the `unstable_auth_methods` feature enabled. The `EnvVar` variant carries the
/// list of environment variables the client must collect from the user, plus an optional
/// link to the credentials page.
///
/// Serialized as an externally-tagged discriminated union via `#[serde(tag = "type")]`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthMethodInfo {
    /// Agent handles authentication internally (OAuth, keychain, etc.).
    /// This is the default when ACP doesn't specify a `type`.
    Agent {
        id: String,
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
    /// User supplies env var values; client passes them via environment at spawn time.
    EnvVar {
        id: String,
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        vars: Vec<AuthEnvVar>,
        #[serde(skip_serializing_if = "Option::is_none")]
        link: Option<String>,
    },
}

impl AuthMethodInfo {
    pub fn id(&self) -> &str {
        match self {
            AuthMethodInfo::Agent { id, .. } => id,
            AuthMethodInfo::EnvVar { id, .. } => id,
        }
    }
}

/// Environment variable descriptor for `AuthMethodInfo::EnvVar`.
///
/// Mirrors ACP's `AuthEnvVar`. `secret` defaults to true (password-style input);
/// `optional` defaults to false.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuthEnvVar {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub secret: bool,
    pub optional: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AuthStatus {
    pub authenticated: bool,
    pub method_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentModelInfo {
    pub model_id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionResult {
    pub session_id: String,
    pub current_model: Option<String>,
    pub available_models: Vec<AgentModelInfo>,
    /// Session modes (passed as JSON to frontend)
    pub modes: Option<serde_json::Value>,
    /// Session config options (passed as JSON to frontend)
    pub config_options: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AcpSessionInfo {
    pub session_id: String,
    pub cwd: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AcpListResult {
    pub sessions: Vec<AcpSessionInfo>,
    pub next_cursor: Option<String>,
}

/// One MCP server the frontend wants attached to an ACP session (`session/new` /
/// `session/load`, task #11). The renderer assembles these from `mcp-store`
/// (already filtered by enabled-state, project scope, and the agent's advertised
/// `McpCapabilities`); the backend resolves env secrets from the keychain and
/// converts to the ACP `McpServer` schema. Deliberately a minimal, dedicated IPC
/// type rather than reusing `McpServerConfig` so the renderer never has to send
/// the `source`/`enabled` bookkeeping fields — only what a spawn needs.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AcpMcpServerInput {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub transport: crate::commands::mcp::McpTransport,
    /// Stdio transport: the executable. Empty/ignored for http servers.
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Env values — bare strings are plaintext, `{ "secret": true }` references
    /// resolve from `notesage:mcp:<id>:<KEY>` in the keychain at build time.
    #[serde(default)]
    pub env: HashMap<String, crate::commands::mcp::McpEnvValue>,
    /// Endpoint URL for `http` (remote) servers. `None` for stdio.
    #[serde(default)]
    pub url: Option<String>,
}

/// Outcome of `acp_agent_smoke_test` — a bounded end-to-end verification that the
/// Local Agent chain works (health → spawn → session → prompt → teardown).
/// `stage` names the LAST stage attempted: on success it's `Done`, on failure
/// it's the stage that failed so the UI can point the user at the right fix.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SmokeTestReport {
    pub ok: bool,
    pub stage: SmokeStage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub elapsed_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SmokeStage {
    /// Bundled llama-server `/health` probe.
    Health,
    /// Agent subprocess spawn + ACP `initialize`.
    Spawn,
    /// ACP `session/new`.
    Session,
    /// A single short prompt round-trip.
    Prompt,
    /// All stages passed.
    Done,
}
