use serde::Deserialize;
use std::collections::HashMap;

use super::parse_frontmatter_raw;

// --- SKILL.md frontmatter ---

/// Explicit tool definition in SKILL.md frontmatter.
#[derive(Deserialize, Debug, Clone)]
pub(super) struct ToolFrontmatter {
    #[allow(dead_code)]
    pub(super) name: String,
    pub(super) description: String,
    pub(super) script: String,
    pub(super) parameters: serde_json::Value,
}

/// YAML frontmatter shape for SKILL.md files
#[derive(Deserialize, Debug, Default)]
pub(super) struct SkillFrontmatter {
    pub(super) name: Option<String>,
    pub(super) description: Option<String>,
    pub(super) license: Option<String>,
    pub(super) compatibility: Option<String>,
    pub(super) metadata: Option<HashMap<String, String>>,
    #[serde(rename = "allowed-tools")]
    pub(super) allowed_tools: Option<Vec<String>>,
    #[serde(rename = "user-invocable")]
    pub(super) user_invocable: Option<bool>,
    #[serde(rename = "disable-model-invocation")]
    pub(super) disable_model_invocation: Option<bool>,
    /// Optional explicit tool definitions for the glue layer
    pub(super) tools: Option<Vec<ToolFrontmatter>>,
}

/// Parse YAML frontmatter from a SKILL.md file.
/// Returns (frontmatter, body) where body is the content after the closing `---`.
pub(super) fn parse_frontmatter(content: &str) -> (Option<SkillFrontmatter>, String) {
    let (yaml_str, body) = parse_frontmatter_raw(content);
    match yaml_str {
        Some(yaml) => match serde_norway::from_str::<SkillFrontmatter>(yaml) {
            Ok(fm) => (Some(fm), body.to_string()),
            Err(_) => (None, content.to_string()),
        },
        None => (None, content.to_string()),
    }
}
