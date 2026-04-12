use serde::{Deserialize, Serialize};

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
