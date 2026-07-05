//! MCP wire/config data types and env-secret resolution.
//!
//! Pure serde types shared across the MCP command surface, transport, state,
//! and config-parsing modules. No transport or I/O logic lives here.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    /// Stdio transport: the executable. Empty/ignored for http servers.
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, McpEnvValue>,
    pub source: McpConfigSource,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Transport discriminant. Defaults to stdio so existing configs (which
    /// omit the field) keep working unchanged.
    #[serde(default)]
    pub transport: McpTransport,
    /// Endpoint URL for `http` (remote) servers. `None` for stdio.
    #[serde(default)]
    pub url: Option<String>,
}

fn default_true() -> bool {
    true
}

/// A value for an MCP server env var as stored in `mcp.json`. A bare JSON
/// string is an inline plaintext value; the object `{ "secret": true }` is a
/// reference to a value kept in the OS keychain under
/// `notesage:mcp:<server_id>:<KEY>`. Secret values are never written to disk
/// and never sent to the frontend — they are resolved only at spawn time.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum McpEnvValue {
    Plain(String),
    Secret(McpSecretRef),
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct McpSecretRef {
    pub secret: bool,
}

/// Resolve env references into a concrete process environment. Plain values
/// pass through; secret references are looked up via `resolver` (keyed by the
/// `mcp:<server_id>:<KEY>` connection id). Missing secrets are dropped. Pure so
/// it can be unit-tested with a mock resolver.
fn resolve_env_with<F>(
    server_id: &str,
    env: &HashMap<String, McpEnvValue>,
    mut resolver: F,
) -> HashMap<String, String>
where
    F: FnMut(&str) -> Option<String>,
{
    let mut out = HashMap::new();
    for (key, val) in env {
        match val {
            McpEnvValue::Plain(s) => {
                out.insert(key.clone(), s.clone());
            }
            McpEnvValue::Secret(r) if r.secret => {
                if let Some(v) = resolver(&format!("mcp:{}:{}", server_id, key)) {
                    out.insert(key.clone(), v);
                }
            }
            McpEnvValue::Secret(_) => {}
        }
    }
    out
}

/// Resolve env references against the real OS keychain.
///
/// `pub(crate)` so the ACP MCP pass-through (`acp.rs`, task #11) can resolve the
/// same `mcp:<server_id>:<KEY>` keychain secrets when assembling `mcp_servers`
/// for a `session/new` request — secrets are resolved here, never in the renderer.
pub(crate) fn resolve_env(
    server_id: &str,
    env: &HashMap<String, McpEnvValue>,
) -> HashMap<String, String> {
    resolve_env_with(server_id, env, |conn_id| {
        crate::commands::credentials::get_credential_internal(conn_id)
            .ok()
            .flatten()
    })
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
    pub env: HashMap<String, McpEnvValue>,
    pub source: McpConfigSource,
    pub enabled: bool,
    pub status: McpServerStatus,
    pub error: Option<String>,
    pub tools: Vec<McpToolInfo>,
    pub transport: McpTransport,
    pub url: Option<String>,
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

/// Result of a dry-run validation (`mcp_validate_server`). Reports whether a
/// candidate config could start, complete the MCP handshake, and list its
/// tools — without ever registering the server. On failure, `error_kind` is a
/// stable machine-readable cause the frontend maps to actionable copy.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpValidationResult {
    pub ok: bool,
    #[serde(default)]
    pub tools: Vec<McpToolInfo>,
    /// The server's `serverInfo` block from the `initialize` response, if any.
    pub server_info: Option<Value>,
    pub error: Option<String>,
    /// One of: "binary_not_found", "spawn_failed", "init_failed", "timeout".
    pub error_kind: Option<String>,
    /// Last lines of the process stderr, surfaced for debugging.
    pub stderr_tail: Option<String>,
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

/// Transport a server/catalog entry uses. Mirrored on the frontend as a string
/// union.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum McpTransport {
    #[default]
    Stdio,
    Http,
}

/// Config file entry (matches Claude Desktop format).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpConfigEntry {
    /// Required for stdio entries; absent for http entries.
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, McpEnvValue>,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub transport: McpTransport,
    #[serde(default)]
    pub url: Option<String>,
}

/// Config file format.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpConfigFile {
    #[serde(rename = "mcpServers", default)]
    pub mcp_servers: HashMap<String, McpConfigEntry>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_server_config_serialization_round_trip() {
        let mut env = HashMap::new();
        env.insert("TOKEN".to_string(), McpEnvValue::Plain("abc123".to_string()));

        let original = McpServerConfig {
            id: "global:roundtrip".to_string(),
            name: "roundtrip".to_string(),
            command: "node".to_string(),
            args: vec!["index.js".to_string(), "--port".to_string(), "3000".to_string()],
            env,
            source: McpConfigSource::NotesageGlobal,
            enabled: true,
            transport: McpTransport::Stdio,
            url: None,
        };

        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: McpServerConfig = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(deserialized.id, original.id);
        assert_eq!(deserialized.name, original.name);
        assert_eq!(deserialized.command, original.command);
        assert_eq!(deserialized.args, original.args);
        assert_eq!(deserialized.env, original.env);
        assert_eq!(deserialized.source, original.source);
        assert_eq!(deserialized.enabled, original.enabled);
    }

    #[test]
    fn mcp_env_value_deserializes_plain_and_secret() {
        let plain: McpEnvValue = serde_json::from_str("\"hello\"").expect("plain");
        assert_eq!(plain, McpEnvValue::Plain("hello".to_string()));

        let secret: McpEnvValue = serde_json::from_str(r#"{"secret":true}"#).expect("secret");
        assert_eq!(secret, McpEnvValue::Secret(McpSecretRef { secret: true }));
    }

    #[test]
    fn mcp_env_value_round_trips() {
        let plain = McpEnvValue::Plain("v".to_string());
        assert_eq!(serde_json::to_string(&plain).unwrap(), "\"v\"");
        let secret = McpEnvValue::Secret(McpSecretRef { secret: true });
        assert_eq!(serde_json::to_string(&secret).unwrap(), r#"{"secret":true}"#);
    }

    #[test]
    fn resolve_env_passes_plain_and_resolves_secrets() {
        let mut env = HashMap::new();
        env.insert("PLAIN".to_string(), McpEnvValue::Plain("p".to_string()));
        env.insert("API_KEY".to_string(), McpEnvValue::Secret(McpSecretRef { secret: true }));

        let resolved = resolve_env_with("global:srv", &env, |conn_id| {
            // The keychain is keyed by `mcp:<server_id>:<KEY>`.
            assert_eq!(conn_id, "mcp:global:srv:API_KEY");
            Some("resolved-secret".to_string())
        });

        assert_eq!(resolved.get("PLAIN").map(String::as_str), Some("p"));
        assert_eq!(resolved.get("API_KEY").map(String::as_str), Some("resolved-secret"));
    }

    #[test]
    fn resolve_env_drops_missing_secrets() {
        let mut env = HashMap::new();
        env.insert("GONE".to_string(), McpEnvValue::Secret(McpSecretRef { secret: true }));
        let resolved = resolve_env_with("id", &env, |_| None);
        assert!(resolved.is_empty(), "a missing secret must not appear in the process env");
    }

    #[test]
    fn config_entry_with_secret_env_parses() {
        // A persisted mcp.json entry mixing a plaintext and a secret-ref env var.
        let json = r#"{ "command": "node", "env": { "PORT": "8080", "TOKEN": { "secret": true } } }"#;
        let entry: McpConfigEntry = serde_json::from_str(json).expect("parse");
        assert_eq!(entry.env.get("PORT").unwrap(), &McpEnvValue::Plain("8080".to_string()));
        assert_eq!(
            entry.env.get("TOKEN").unwrap(),
            &McpEnvValue::Secret(McpSecretRef { secret: true })
        );
    }
}
