use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

// --- Skill-to-Tool glue layer types ---

/// A tool definition extracted from a skill script.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SkillToolEntry {
    /// Tool name: skill__{skill}__{script}
    pub tool_name: String,
    /// Human-readable description for the LLM
    pub description: String,
    /// Parent skill name (for routing back to execute_skill_script)
    pub skill_name: String,
    /// Relative script path within the skill directory (e.g., "scripts/download.mjs")
    pub script_path: String,
    /// JSON Schema for tool parameters
    pub parameters: serde_json::Value,
    /// Mapping metadata: how to convert JSON args back to string[]
    pub arg_mapping: Vec<ArgMapping>,
    /// Whether this tool used an explicit frontmatter schema (vs auto-extracted)
    pub explicit_schema: bool,
}

/// Describes how a single JSON parameter maps to a CLI argument.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ArgMapping {
    /// Parameter name in the JSON Schema
    pub param_name: String,
    /// How this parameter maps to CLI args
    pub mapping_type: ArgMappingType,
    /// Position in the args array (for positional params)
    pub position: Option<usize>,
}

/// The type of CLI argument mapping for a parameter.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", content = "value")]
pub enum ArgMappingType {
    /// Positional argument: value added at position
    Positional,
    /// Flag: --name value
    Flag { flag: String },
    /// Boolean flag: --name (present if true)
    BoolFlag { flag: String },
    /// Spread: array values added as consecutive positional args
    Spread,
}

/// Convert a name to snake_case (lowercase, hyphens → underscores).
pub(super) fn to_snake_case(name: &str) -> String {
    name.to_lowercase().replace('-', "_")
}

/// Parse a Usage comment from the first 10 lines of a script file.
///
/// Looks for patterns like:
///   // Usage: node script.mjs <url> <output_dir> [--force]
///   # Usage: script.sh <name> [--tag "value"]
///
/// Returns (JSON Schema value, Vec<ArgMapping>) or None if no Usage line found.
pub(super) fn parse_usage_comment(
    script_content: &str,
) -> Option<(serde_json::Value, Vec<ArgMapping>)> {
    // Find the Usage: line in the first 10 lines
    let usage_line = script_content
        .lines()
        .take(10)
        .find(|line| {
            let trimmed = line.trim().trim_start_matches("//").trim_start_matches('#').trim();
            trimmed.starts_with("Usage:")
        })?;

    // Extract the part after the command name: "Usage: node script.mjs <url> [--force]" → "<url> [--force]"
    let trimmed = usage_line.trim().trim_start_matches("//").trim_start_matches('#').trim();
    let after_usage = trimmed.strip_prefix("Usage:")?;
    let after_usage = after_usage.trim();

    // Skip the command portion (e.g., "node script.mjs" or "script.sh")
    // Find the first token that starts with < or [ or -- which indicates params start
    let tokens: Vec<&str> = after_usage.split_whitespace().collect();
    let param_start = tokens.iter().position(|t| {
        t.starts_with('<') || t.starts_with('[')
    });

    let param_tokens = match param_start {
        Some(idx) => &tokens[idx..],
        None => return None, // No parameters found
    };

    if param_tokens.is_empty() {
        return None;
    }

    let mut properties = serde_json::Map::new();
    let mut required = Vec::new();
    let mut mappings = Vec::new();
    let mut position: usize = 0;

    let mut i = 0;
    while i < param_tokens.len() {
        let token = param_tokens[i];

        if token.starts_with('<') && token.ends_with('>') {
            // Required positional: <name>
            let name = &token[1..token.len() - 1];
            // Handle variadic: <name...>
            let (clean_name, is_spread) = if name.ends_with("...") {
                (&name[..name.len() - 3], true)
            } else {
                (name, false)
            };
            let snake_name = to_snake_case(clean_name);

            if is_spread {
                properties.insert(
                    snake_name.clone(),
                    serde_json::json!({
                        "type": "array",
                        "items": { "type": "string" },
                        "description": clean_name
                    }),
                );
                required.push(serde_json::Value::String(snake_name.clone()));
                mappings.push(ArgMapping {
                    param_name: snake_name,
                    mapping_type: ArgMappingType::Spread,
                    position: Some(position),
                });
            } else {
                properties.insert(
                    snake_name.clone(),
                    serde_json::json!({ "type": "string", "description": clean_name }),
                );
                required.push(serde_json::Value::String(snake_name.clone()));
                mappings.push(ArgMapping {
                    param_name: snake_name,
                    mapping_type: ArgMappingType::Positional,
                    position: Some(position),
                });
            }
            position += 1;
        } else if token.starts_with('[') {
            // Optional parameter or flag
            // Collect all tokens until we find the closing ]
            let mut combined = token.to_string();
            if !token.ends_with(']') {
                // Multi-token optional: [--flag "value"]
                while i + 1 < param_tokens.len() {
                    i += 1;
                    combined.push(' ');
                    combined.push_str(param_tokens[i]);
                    if param_tokens[i].ends_with(']') {
                        break;
                    }
                }
            }

            let inner = &combined[1..combined.len() - 1]; // strip [ ]

            if inner.starts_with("--") {
                // Flag parameter
                let parts: Vec<&str> = inner.splitn(2, ' ').collect();
                let flag_name = parts[0]; // e.g., "--force"
                let param_name = to_snake_case(&flag_name[2..]); // strip --

                if parts.len() > 1 {
                    // [--flag "value"] → optional string with flag
                    properties.insert(
                        param_name.clone(),
                        serde_json::json!({ "type": "string", "description": param_name }),
                    );
                    mappings.push(ArgMapping {
                        param_name: param_name,
                        mapping_type: ArgMappingType::Flag {
                            flag: flag_name.to_string(),
                        },
                        position: None,
                    });
                } else {
                    // [--flag] → optional boolean
                    properties.insert(
                        param_name.clone(),
                        serde_json::json!({ "type": "boolean", "description": param_name }),
                    );
                    mappings.push(ArgMapping {
                        param_name: param_name,
                        mapping_type: ArgMappingType::BoolFlag {
                            flag: flag_name.to_string(),
                        },
                        position: None,
                    });
                }
            } else {
                // [name] or [name...] → optional positional
                let (clean_name, is_spread) = if inner.ends_with("...") {
                    (&inner[..inner.len() - 3], true)
                } else {
                    (inner, false)
                };
                let snake_name = to_snake_case(clean_name);

                if is_spread {
                    properties.insert(
                        snake_name.clone(),
                        serde_json::json!({
                            "type": "array",
                            "items": { "type": "string" },
                            "description": clean_name
                        }),
                    );
                    mappings.push(ArgMapping {
                        param_name: snake_name,
                        mapping_type: ArgMappingType::Spread,
                        position: Some(position),
                    });
                } else {
                    properties.insert(
                        snake_name.clone(),
                        serde_json::json!({ "type": "string", "description": clean_name }),
                    );
                    mappings.push(ArgMapping {
                        param_name: snake_name,
                        mapping_type: ArgMappingType::Positional,
                        position: Some(position),
                    });
                }
                position += 1;
            }
        }

        i += 1;
    }

    if properties.is_empty() {
        return None;
    }

    let schema = serde_json::json!({
        "type": "object",
        "properties": properties,
        "required": required,
    });

    Some((schema, mappings))
}

/// Build a fallback generic schema for skills with scripts but no parseable interface.
pub(super) fn fallback_generic_schema() -> (serde_json::Value, Vec<ArgMapping>) {
    let schema = serde_json::json!({
        "type": "object",
        "properties": {
            "args": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Arguments for the script"
            }
        },
        "required": ["args"]
    });
    let mapping = vec![ArgMapping {
        param_name: "args".to_string(),
        mapping_type: ArgMappingType::Spread,
        position: Some(0),
    }];
    (schema, mapping)
}

// --- Skill-token parser (Phase 1, task #22) ---
//
// Detect `/skill-name` tokens anywhere in a user message — at start-of-string
// or after any whitespace character. Powers the new Quiet Composer UX where
// a user can type natural sentences like:
//   "summarize this with /web-search and /save-research"
// and the direct-API send path expands every matched skill.
//
// SCOPE / CALL-SITE NOTES:
// - This parser is for the **direct-API** send path only.
// - The **ACP pass-through** path forwards the user's message verbatim to the
//   provider (Claude Code / Codex / Copilot / Gemini), which manages its own
//   subagent and slash-command system. Do NOT call `parse_skill_tokens` from
//   ACP code paths — re-parsing on our side would corrupt the verbatim
//   contract documented in `docs/features/ai-providers.md` ("`@agent-name`
//   pass-through" / agent slash commands).
//
// PATTERN: `(?:^|\s)/[a-z][a-z0-9-]*`
//   - Anchor: start-of-string or any Unicode whitespace (`\s` in `regex` 1.x
//     matches `\p{White_Space}`, which includes U+00A0 non-breaking space).
//   - Slash + first char must be a lowercase letter (avoids `/123` numeric
//     false positives, AI-generated paths, and URL fragments).
//   - Body: lowercase letters, digits, hyphens (matches Notesage skill naming
//     convention `[a-z][a-z0-9-]*`).
//
// KNOWN LIMITATIONS (covered by tests):
//   - URLs like `https://example.com/path` do NOT match — slash is preceded
//     by `m`, not whitespace. Good.
//   - `(/web-search)` does NOT match — leading `(` is not whitespace. This is
//     intentional; users adding parens around a skill is rare and surfacing
//     it as text avoids surprise expansion.
//   - Trailing punctuation (`.`, `,`, `!`, `?`) terminates the token cleanly:
//     `use /web-search.` matches `web-search`.
#[allow(dead_code)] // wired by composer send path in task #23+ — landed early so the tests lock the contract.
static SKILL_TOKEN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:^|\s)/([a-z][a-z0-9-]*)")
        .expect("skill token regex is valid at compile time")
});

/// Parse a user message and return the names of every `/skill-name` token
/// found, in document order. Returns an empty vector if no tokens are found.
///
/// Names are returned without the leading slash. Duplicates are preserved
/// (the order/count reflects the user's input verbatim) — callers that want
/// dedup should do it themselves.
#[allow(dead_code)] // wired by composer send path in task #23+ — landed early so the tests lock the contract.
pub fn parse_skill_tokens(text: &str) -> Vec<String> {
    SKILL_TOKEN_RE
        .captures_iter(text)
        .map(|c| c[1].to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_token_at_start_of_string() {
        assert_eq!(parse_skill_tokens("/web-search now"), vec!["web-search"]);
    }

    #[test]
    fn matches_token_after_whitespace_anywhere() {
        assert_eq!(
            parse_skill_tokens("please run /web-search for me"),
            vec!["web-search"]
        );
    }

    #[test]
    fn matches_multiple_tokens_in_order() {
        assert_eq!(
            parse_skill_tokens("do /web-search and /save-research"),
            vec!["web-search", "save-research"]
        );
    }

    #[test]
    fn does_not_match_inside_url() {
        // The slashes here are preceded by alphanumerics (`s`, `m`), not
        // whitespace — so URLs and paths must not produce false positives.
        assert!(parse_skill_tokens("see https://example.com/path").is_empty());
        assert!(parse_skill_tokens("look at github.com/owner/repo").is_empty());
    }

    #[test]
    fn does_not_match_numeric_only_token() {
        // `/123` must not match — the first char after `/` must be a letter.
        assert!(parse_skill_tokens("see issue /123").is_empty());
        assert!(parse_skill_tokens("/9-skill should not match").is_empty());
    }

    #[test]
    fn matches_hyphenated_name() {
        assert_eq!(
            parse_skill_tokens("/web-search"),
            vec!["web-search"]
        );
        assert_eq!(
            parse_skill_tokens("hello /a-b-c-d world"),
            vec!["a-b-c-d"]
        );
    }

    #[test]
    fn stops_at_trailing_punctuation() {
        assert_eq!(parse_skill_tokens("use /web-search."), vec!["web-search"]);
        assert_eq!(parse_skill_tokens("/web-search!"), vec!["web-search"]);
        assert_eq!(parse_skill_tokens("/web-search, then /save"), vec!["web-search", "save"]);
    }

    #[test]
    fn does_not_match_when_preceded_by_non_whitespace_punctuation() {
        // Documented limitation: leading `(` is not whitespace, so this
        // won't match. If users want skill expansion they shouldn't wrap
        // skills in parens.
        assert!(parse_skill_tokens("(/web-search)").is_empty());
    }

    #[test]
    fn matches_after_unicode_whitespace() {
        // Non-breaking space (U+00A0) is part of `\p{White_Space}`, which
        // `\s` matches in `regex` 1.x. Verifies pasted-from-the-web text
        // doesn't silently fail to expand.
        let nbsp = "\u{00a0}";
        assert_eq!(
            parse_skill_tokens(&format!("text{nbsp}/web-search")),
            vec!["web-search"]
        );
    }

    #[test]
    fn does_not_match_uppercase() {
        // Skill names are lowercase by convention. Uppercase tokens are
        // assumed to be acronyms or mistakes, not skills.
        assert!(parse_skill_tokens("/WebSearch").is_empty());
        assert!(parse_skill_tokens("/Web-Search").is_empty());
    }

    #[test]
    fn empty_string_returns_empty() {
        assert!(parse_skill_tokens("").is_empty());
    }

    #[test]
    fn no_tokens_returns_empty() {
        assert!(parse_skill_tokens("just a normal sentence").is_empty());
    }

    #[test]
    fn matches_token_at_start_after_newline() {
        // `\s` includes `\n`, so a token at the start of a new line counts.
        assert_eq!(
            parse_skill_tokens("first line\n/save-research"),
            vec!["save-research"]
        );
    }

    #[test]
    fn matches_token_after_tab() {
        assert_eq!(
            parse_skill_tokens("\t/web-search"),
            vec!["web-search"]
        );
    }
}
