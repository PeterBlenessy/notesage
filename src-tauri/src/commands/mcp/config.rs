//! MCP config-file parsing & import backing helpers.
//!
//! Reads `mcp.json` (Notesage / Cursor), Claude Desktop's wrapped config, and
//! VS Code's `settings.json` `mcp.servers` block into `McpServerConfig`s. The
//! `mcp_discover_configs` / `mcp_import_configs` / `mcp_check_import_sources`
//! commands (in `mod.rs`) are thin wrappers over these.

use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

use super::types::{McpConfigEntry, McpConfigFile, McpConfigSource, McpServerConfig};

pub(crate) fn source_prefix(source: &McpConfigSource) -> &'static str {
    match source {
        McpConfigSource::NotesageGlobal => "global",
        McpConfigSource::NotesageProject => "project",
        McpConfigSource::ClaudeDesktop => "claude",
        McpConfigSource::Cursor => "cursor",
        McpConfigSource::VsCode => "vscode",
    }
}

pub(crate) fn map_config_entries(
    entries: HashMap<String, McpConfigEntry>,
    source: McpConfigSource,
) -> Vec<McpServerConfig> {
    entries
        .into_iter()
        .map(|(name, entry)| {
            // All discovered MCP servers default to disabled for security,
            // regardless of source. A sandboxed agent can write its own entry
            // into ~/.notesage/mcp.json (the one $HOME dir it is always allowed
            // to write), and MCP servers are spawned UNSANDBOXED — so an
            // enabled-by-default global/external entry would be a kernel-sandbox
            // escape. Requiring an explicit user toggle (persisted as an
            // enabledOverride in mcp-store) before the first spawn closes that
            // path. The frontend merge in mcp-store applies the user's override
            // on top of this default, so previously user-enabled servers are
            // preserved while never-toggled ones stay off.
            let McpConfigEntry {
                command,
                args,
                env,
                disabled: _,
                transport,
                url,
            } = entry;
            McpServerConfig {
                id: format!("{}:{}", source_prefix(&source), name),
                name,
                command,
                args,
                env,
                source: source.clone(),
                enabled: false,
                transport,
                url,
            }
        })
        .collect()
}

pub(crate) fn parse_config_file(
    path: &PathBuf,
    source: McpConfigSource,
) -> Result<Vec<McpServerConfig>, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let config: McpConfigFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;

    Ok(map_config_entries(config.mcp_servers, source))
}

/// Parse Claude Desktop config which wraps mcpServers inside a larger config
pub(crate) fn parse_claude_desktop_config(path: &PathBuf) -> Result<Vec<McpServerConfig>, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let full_config: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;

    let mcp_servers = full_config
        .get("mcpServers")
        .cloned()
        .unwrap_or(Value::Object(serde_json::Map::new()));

    let servers: HashMap<String, McpConfigEntry> = serde_json::from_value(mcp_servers)
        .map_err(|e| format!("Failed to parse mcpServers: {}", e))?;

    Ok(map_config_entries(servers, McpConfigSource::ClaudeDesktop))
}

pub(crate) fn vscode_settings_path(home: &std::path::Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        home.join("Library")
            .join("Application Support")
            .join("Code")
            .join("User")
            .join("settings.json")
    } else if cfg!(target_os = "windows") {
        home.join("AppData")
            .join("Roaming")
            .join("Code")
            .join("User")
            .join("settings.json")
    } else {
        home.join(".config")
            .join("Code")
            .join("User")
            .join("settings.json")
    }
}

/// Parse VS Code settings which have mcp servers under a different key structure
pub(crate) fn parse_vscode_config(path: &PathBuf) -> Result<Vec<McpServerConfig>, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let settings: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;

    // VS Code stores MCP servers under "mcp.servers" or "mcp" > "servers"
    let servers_val = settings
        .get("mcp")
        .and_then(|v| v.get("servers"))
        .or_else(|| settings.get("mcp.servers"))
        .cloned()
        .unwrap_or(Value::Object(serde_json::Map::new()));

    let servers: HashMap<String, McpConfigEntry> = serde_json::from_value(servers_val)
        .map_err(|e| format!("Failed to parse mcp.servers: {}", e))?;

    Ok(map_config_entries(servers, McpConfigSource::VsCode))
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::McpEnvValue;
    use std::io::Write;

    #[test]
    fn source_prefix_covers_all_variants() {
        assert_eq!(source_prefix(&McpConfigSource::NotesageGlobal), "global");
        assert_eq!(source_prefix(&McpConfigSource::NotesageProject), "project");
        assert_eq!(source_prefix(&McpConfigSource::ClaudeDesktop), "claude");
        assert_eq!(source_prefix(&McpConfigSource::Cursor), "cursor");
        assert_eq!(source_prefix(&McpConfigSource::VsCode), "vscode");
    }

    #[test]
    fn map_config_entries_basic() {
        let mut entries = HashMap::new();
        entries.insert(
            "my-server".to_string(),
            McpConfigEntry {
                command: "node".to_string(),
                args: vec!["server.js".to_string()],
                env: HashMap::new(),
                disabled: false,
                transport: super::super::types::McpTransport::Stdio,
                url: None,
            },
        );

        let result = map_config_entries(entries, McpConfigSource::NotesageGlobal);
        assert_eq!(result.len(), 1);

        let cfg = &result[0];
        assert_eq!(cfg.id, "global:my-server");
        assert_eq!(cfg.name, "my-server");
        assert_eq!(cfg.command, "node");
        assert_eq!(cfg.args, vec!["server.js"]);
        // All discovered servers default to disabled for security, regardless of
        // source — the user re-enables via a persisted override (see map closure).
        assert!(!cfg.enabled);
        assert_eq!(cfg.source, McpConfigSource::NotesageGlobal);
    }

    #[test]
    fn map_config_entries_respects_disabled_flag() {
        let mut entries = HashMap::new();
        entries.insert(
            "disabled-server".to_string(),
            McpConfigEntry {
                command: "npx".to_string(),
                args: vec![],
                env: HashMap::new(),
                disabled: true,
                transport: super::super::types::McpTransport::Stdio,
                url: None,
            },
        );

        let result = map_config_entries(entries, McpConfigSource::NotesageGlobal);
        assert_eq!(result.len(), 1);
        assert!(!result[0].enabled);
    }

    #[test]
    fn map_config_entries_project_source_defaults_to_disabled() {
        let mut entries = HashMap::new();
        entries.insert(
            "project-server".to_string(),
            McpConfigEntry {
                command: "python".to_string(),
                args: vec!["mcp.py".to_string()],
                env: HashMap::new(),
                disabled: false, // explicitly not disabled, but project overrides
                transport: super::super::types::McpTransport::Stdio,
                url: None,
            },
        );

        let result = map_config_entries(entries, McpConfigSource::NotesageProject);
        assert_eq!(result.len(), 1);
        assert!(!result[0].enabled, "Project-scoped servers should default to disabled for security");
        assert_eq!(result[0].id, "project:project-server");
    }

    #[test]
    fn map_config_entries_preserves_env_vars() {
        let mut env = HashMap::new();
        env.insert("API_KEY".to_string(), McpEnvValue::Plain("secret".to_string()));
        env.insert("DEBUG".to_string(), McpEnvValue::Plain("true".to_string()));

        let mut entries = HashMap::new();
        entries.insert(
            "env-server".to_string(),
            McpConfigEntry {
                command: "node".to_string(),
                args: vec![],
                env,
                disabled: false,
                transport: super::super::types::McpTransport::Stdio,
                url: None,
            },
        );

        let result = map_config_entries(entries, McpConfigSource::Cursor);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].env.get("API_KEY").unwrap(), &McpEnvValue::Plain("secret".to_string()));
        assert_eq!(result[0].env.get("DEBUG").unwrap(), &McpEnvValue::Plain("true".to_string()));
        assert_eq!(result[0].id, "cursor:env-server");
    }

    #[test]
    fn parse_config_file_with_valid_json() {
        let mut tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let json = r#"{
            "mcpServers": {
                "alpha": { "command": "node", "args": ["a.js"] },
                "beta":  { "command": "python", "args": ["-m", "mcp"], "disabled": true }
            }
        }"#;
        write!(tmp, "{}", json).unwrap();

        let result = parse_config_file(&tmp.path().to_path_buf(), McpConfigSource::NotesageGlobal)
            .expect("should parse valid JSON");

        assert_eq!(result.len(), 2);

        let alpha = result.iter().find(|c| c.name == "alpha").unwrap();
        assert_eq!(alpha.id, "global:alpha");
        assert_eq!(alpha.command, "node");
        assert_eq!(alpha.args, vec!["a.js"]);
        // Disabled by default for all sources (security hardening) even though
        // the entry does not set `disabled`.
        assert!(!alpha.enabled);

        let beta = result.iter().find(|c| c.name == "beta").unwrap();
        assert!(!beta.enabled, "beta has disabled: true");
    }

    #[test]
    fn parse_config_file_with_invalid_json() {
        let mut tmp = tempfile::NamedTempFile::new().expect("create temp file");
        write!(tmp, "{{not valid json").unwrap();

        let result = parse_config_file(&tmp.path().to_path_buf(), McpConfigSource::NotesageGlobal);
        assert!(result.is_err());
    }

    #[test]
    fn parse_config_file_with_missing_file() {
        let path = PathBuf::from("/tmp/notesage-test-nonexistent-mcp-config.json");
        let result = parse_config_file(&path, McpConfigSource::NotesageGlobal);
        assert!(result.is_err());
    }

    #[test]
    fn parse_claude_desktop_config_valid() {
        let mut tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let json = r#"{
            "mcpServers": {
                "test": { "command": "node", "args": ["server.js"] }
            }
        }"#;
        write!(tmp, "{}", json).unwrap();

        let result = parse_claude_desktop_config(&tmp.path().to_path_buf())
            .expect("should parse Claude Desktop config");

        assert_eq!(result.len(), 1);
        let server = &result[0];
        assert_eq!(server.name, "test");
        assert_eq!(server.command, "node");
        assert_eq!(server.args, vec!["server.js"]);
        assert_eq!(server.source, McpConfigSource::ClaudeDesktop);
        assert_eq!(server.id, "claude:test");
        // Disabled by default for all sources (security hardening); user re-enables.
        assert!(!server.enabled);
    }

    #[test]
    fn parse_vscode_config_valid() {
        let mut tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let json = r#"{
            "mcp": {
                "servers": {
                    "test": { "command": "npx", "args": ["-y", "@mcp/server"] }
                }
            }
        }"#;
        write!(tmp, "{}", json).unwrap();

        let result = parse_vscode_config(&tmp.path().to_path_buf())
            .expect("should parse VS Code config");

        assert_eq!(result.len(), 1);
        let server = &result[0];
        assert_eq!(server.name, "test");
        assert_eq!(server.command, "npx");
        assert_eq!(server.args, vec!["-y", "@mcp/server"]);
        assert_eq!(server.source, McpConfigSource::VsCode);
        assert_eq!(server.id, "vscode:test");
        // Disabled by default for all sources (security hardening); user re-enables.
        assert!(!server.enabled);
    }
}
