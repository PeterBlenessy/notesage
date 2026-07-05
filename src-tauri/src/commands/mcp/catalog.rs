//! Curated, browseable catalog of MCP servers (PRD 2026-06-03).
//!
//! The manifest (`src-tauri/mcp-catalog.json`) is embedded at compile time. Each
//! entry is a template the "Add" flow pre-fills. The `mcp_catalog_list` command
//! (in `mod.rs`) is a thin wrapper over [`load_catalog`].

use serde::{Deserialize, Serialize};

use super::types::McpTransport;

/// A required environment variable / secret a catalog server needs, with a
/// human label and an optional "where to get it" link rendered in the Add form.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpCatalogRequiredEnv {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub secret: bool,
    #[serde(default)]
    pub help_url: Option<String>,
}

/// One curated catalog entry. `command`/`args` are used for `stdio` entries;
/// `url` is used for `http` (remote) entries.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpCatalogItem {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    /// True for entries from a trusted, curated source (e.g. Anthropic's
    /// `modelcontextprotocol/servers` reference repo) — drives an "Official" badge.
    #[serde(default)]
    pub official: bool,
    #[serde(default)]
    pub transport: McpTransport,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub required_env: Vec<McpCatalogRequiredEnv>,
}

/// On-disk catalog manifest shape. Unknown top-level keys (e.g. a `_comment`
/// authoring note) are ignored by serde.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct McpCatalogFile {
    #[serde(default)]
    servers: Vec<McpCatalogItem>,
}

/// Embedded curated catalog, parsed at compile time.
const MCP_CATALOG_JSON: &str = include_str!("../../../mcp-catalog.json");

/// Parse and return the embedded curated MCP server catalog.
pub(crate) fn load_catalog() -> Result<Vec<McpCatalogItem>, String> {
    let file: McpCatalogFile = serde_json::from_str(MCP_CATALOG_JSON)
        .map_err(|e| format!("Failed to parse mcp-catalog.json: {e}"))?;
    Ok(file.servers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_manifest_parses_and_entries_are_well_formed() {
        // The embedded manifest must always be valid JSON in the expected shape.
        let catalog = load_catalog().expect("mcp-catalog.json should parse");

        for item in &catalog {
            assert!(!item.id.is_empty(), "catalog entry needs an id");
            assert!(!item.name.is_empty(), "catalog entry {} needs a name", item.id);
            match item.transport {
                McpTransport::Http => assert!(
                    item.url.is_some(),
                    "http catalog entry {} must have a url",
                    item.id
                ),
                McpTransport::Stdio => assert!(
                    item.command.is_some(),
                    "stdio catalog entry {} must have a command",
                    item.id
                ),
            }
        }
    }

    #[test]
    fn catalog_ships_official_reference_servers() {
        let catalog = load_catalog().expect("catalog parses");
        // The seeded catalog is the official MCP reference set.
        assert_eq!(catalog.len(), 7, "expected the 7 official reference servers");
        for item in &catalog {
            assert!(item.official, "seeded entry {} should be marked official", item.id);
            assert_eq!(item.transport, McpTransport::Stdio);
            assert!(item.command.is_some(), "{} needs a command", item.id);
            assert!(item.homepage.is_some(), "{} should link to its source", item.id);
            assert!(
                item.required_env.is_empty(),
                "{} is expected to need no API key",
                item.id
            );
        }
        assert!(catalog.iter().any(|i| i.id == "filesystem"));
    }

    #[test]
    fn catalog_transport_defaults_to_stdio() {
        // Entries that omit `transport` should parse as stdio.
        let item: McpCatalogItem = serde_json::from_str(
            r#"{ "id": "x", "name": "X", "description": "d", "command": "node" }"#,
        )
        .expect("parse");
        assert_eq!(item.transport, McpTransport::Stdio);
    }
}
