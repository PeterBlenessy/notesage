#[path = "skills_frontmatter.rs"]
mod skills_frontmatter;
#[path = "skills_tool_parser.rs"]
mod skills_tool_parser;

use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use skills_frontmatter::parse_frontmatter;
#[allow(unused_imports)]
pub use skills_tool_parser::{ArgMapping, ArgMappingType, SkillToolEntry};
use skills_tool_parser::{fallback_generic_schema, parse_usage_comment, to_snake_case};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SkillEntry {
    pub name: String,
    pub description: String,
    pub path: String,
    pub source: String,
    pub license: Option<String>,
    pub compatibility: Option<String>,
    pub metadata: Option<HashMap<String, String>>,
    pub allowed_tools: Option<Vec<String>>,
    pub user_invocable: Option<bool>,
    pub disable_model_invocation: Option<bool>,
    pub has_scripts: bool,
    pub has_references: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SkillContent {
    pub name: String,
    pub body: String,
    pub scripts: Vec<String>,
    pub references: Vec<String>,
    pub assets: Vec<String>,
}

/// Parse YAML frontmatter from a markdown file (generic).
/// Returns (yaml_str, body) where body is the content after the closing `---`.
pub fn parse_frontmatter_raw(content: &str) -> (Option<&str>, &str) {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (None, content);
    }

    let after_first = &trimmed[3..];
    if let Some(end_idx) = after_first.find("\n---") {
        let yaml_str = &after_first[..end_idx];
        let body_start = end_idx + 4; // skip \n---
        let body = after_first[body_start..].trim_start_matches('\n');
        (Some(yaml_str), body)
    } else {
        (None, content)
    }
}


/// List relative file paths inside a subdirectory of the given base path.
fn list_subdir_files(base: &Path, subdir: &str) -> Vec<String> {
    let dir = base.join(subdir);
    if !dir.is_dir() {
        return Vec::new();
    }
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name() {
                    files.push(format!("{}/{}", subdir, name.to_string_lossy()));
                }
            }
        }
    }
    files.sort();
    files
}

/// Discover skills from specified base directories.
///
/// Each base directory is scanned one level deep for subdirectories containing a `SKILL.md` file.
/// Only the YAML frontmatter is parsed (progressive disclosure — body loaded on demand).
#[tauri::command]
pub async fn discover_skills(
    base_dirs: Vec<String>,
) -> Result<Vec<SkillEntry>, String> {
    let mut skills = Vec::new();

    for base_dir in &base_dirs {
        let base_path = Path::new(base_dir);
        if !base_path.is_dir() {
            info!("Skill scan: skipping non-existent directory {}", base_dir);
            continue;
        }

        let entries = match fs::read_dir(base_path) {
            Ok(e) => e,
            Err(e) => {
                warn!("Skill scan: cannot read directory {}: {}", base_dir, e);
                continue;
            }
        };

        // Determine source label from the base directory path
        let source = determine_source(base_dir);

        for entry in entries.flatten() {
            let entry_path = entry.path();
            if !entry_path.is_dir() {
                continue;
            }

            let skill_md = entry_path.join("SKILL.md");
            if !skill_md.exists() {
                continue;
            }

            let content = match fs::read_to_string(&skill_md) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let (frontmatter, _body) = parse_frontmatter(&content);

            // Use directory name as fallback for skill name
            let dir_name = entry_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            let fm = frontmatter.unwrap_or_default();
            let name = fm.name.unwrap_or(dir_name);
            let description = fm.description.unwrap_or_default();

            let has_scripts = entry_path.join("scripts").is_dir();
            let has_references = entry_path.join("references").is_dir();

            skills.push(SkillEntry {
                name,
                description,
                path: entry_path.to_string_lossy().to_string(),
                source: source.clone(),
                license: fm.license,
                compatibility: fm.compatibility,
                metadata: fm.metadata,
                allowed_tools: fm.allowed_tools,
                user_invocable: fm.user_invocable,
                disable_model_invocation: fm.disable_model_invocation,
                has_scripts,
                has_references,
            });
        }
    }

    Ok(skills)
}

/// Determine the source label for skills found in a given base directory.
/// Uses path component matching to avoid false positives from substring matches.
fn determine_source(base_dir: &str) -> String {
    use std::path::Path;

    let path = Path::new(base_dir);
    let components: Vec<&str> = path
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();

    // Check for .notesage/skills path — distinguish project vs global
    if components.windows(2).any(|w| w[0] == ".notesage" && w[1] == "skills") {
        if let Some(home) = dirs::home_dir() {
            let global_path = home.join(".notesage").join("skills");
            if base_dir == global_path.to_string_lossy() {
                return "notesage-global".to_string();
            }
        }
        return "notesage-project".to_string();
    }

    // Check for provider-specific skill directories by matching .<provider>/skills components
    let provider_pairs: &[(&str, &str)] = &[
        (".claude", "claude"),
        (".codex", "codex"),
        (".gemini", "gemini"),
        (".agents", "agents"),
    ];
    for (dir_name, label) in provider_pairs {
        if components.windows(2).any(|w| w[0] == *dir_name && w[1] == "skills") {
            return label.to_string();
        }
    }

    "external".to_string()
}

/// Read the full content of a skill (body + file listing).
/// This is the Level 2 progressive disclosure load.
#[tauri::command]
pub async fn read_skill_content(
    skill_path: String,
) -> Result<SkillContent, String> {
    let path = Path::new(&skill_path);
    let skill_md = path.join("SKILL.md");

    if !skill_md.exists() {
        return Err(format!("SKILL.md not found in {}", skill_path));
    }

    let content = fs::read_to_string(&skill_md)
        .map_err(|e| format!("Failed to read SKILL.md: {}", e))?;

    let (frontmatter, body) = parse_frontmatter(&content);
    let fm = frontmatter.unwrap_or_default();
    let name = fm.name.unwrap_or_else(|| {
        path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default()
    });

    let scripts = list_subdir_files(path, "scripts");
    let references = list_subdir_files(path, "references");
    let assets = list_subdir_files(path, "assets");

    Ok(SkillContent {
        name,
        body,
        scripts,
        references,
        assets,
    })
}

// --- Skill-to-Tool extraction pipeline ---

/// Extract tool definitions from discovered skills.
///
/// For each tool-eligible skill (has_scripts=true, disable_model_invocation!=true),
/// the extraction pipeline tries in order:
/// 1. Explicit `tools:` frontmatter field → use as-is
/// 2. Parse Usage: comments from script files → extract schema
/// 3. Fallback to generic { args: string[] }
#[tauri::command]
pub async fn extract_skill_tools(
    skill_entries: Vec<SkillEntry>,
) -> Result<Vec<SkillToolEntry>, String> {
    let mut tools = Vec::new();

    for entry in &skill_entries {
        // Skip non-tool-eligible skills
        if !entry.has_scripts {
            continue;
        }
        if entry.disable_model_invocation == Some(true) {
            continue;
        }

        let skill_path = Path::new(&entry.path);
        let skill_md = skill_path.join("SKILL.md");

        // Read frontmatter to check for explicit tools
        let content = match fs::read_to_string(&skill_md) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let (frontmatter, _body) = parse_frontmatter(&content);
        let fm = frontmatter.unwrap_or_default();

        // Priority 1: Explicit tools in frontmatter
        if let Some(tool_defs) = &fm.tools {
            let skill_snake = to_snake_case(&entry.name);
            let multi_script = tool_defs.len() > 1;

            for tool_def in tool_defs {
                let script_stem = Path::new(&tool_def.script)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let script_snake = to_snake_case(&script_stem);

                let tool_name = if multi_script {
                    format!("skill__{}__{}", skill_snake, script_snake)
                } else {
                    format!("skill__{}", skill_snake)
                };

                tools.push(SkillToolEntry {
                    tool_name,
                    description: tool_def.description.clone(),
                    skill_name: entry.name.clone(),
                    script_path: tool_def.script.clone(),
                    parameters: tool_def.parameters.clone(),
                    arg_mapping: Vec::new(), // Explicit schemas bypass arg mapping
                    explicit_schema: true,
                });
            }
            continue;
        }

        // List script files
        let scripts = list_subdir_files(skill_path, "scripts");
        if scripts.is_empty() {
            continue;
        }

        // Filter to executable scripts (skip package.json, config files, etc.)
        let script_files: Vec<&String> = scripts
            .iter()
            .filter(|s| {
                let ext = Path::new(s).extension().and_then(|e| e.to_str()).unwrap_or("");
                matches!(ext, "sh" | "bash" | "py" | "mjs" | "js" | "ts" | "rb")
            })
            .collect();

        let skill_snake = to_snake_case(&entry.name);
        let multi_script = script_files.len() > 1;

        for script_rel in &script_files {
            let script_full_path = skill_path.join(script_rel);
            let script_content = match fs::read_to_string(&script_full_path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let script_stem = Path::new(script_rel)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let script_snake = to_snake_case(&script_stem);

            let tool_name = if multi_script {
                format!("skill__{}__{}", skill_snake, script_snake)
            } else {
                format!("skill__{}", skill_snake)
            };

            // Priority 2: Parse Usage comment
            let (parameters, arg_mapping, explicit) =
                if let Some((schema, mapping)) = parse_usage_comment(&script_content) {
                    (schema, mapping, false)
                } else {
                    // Priority 3: Fallback generic schema
                    let (schema, mapping) = fallback_generic_schema();
                    (schema, mapping, false)
                };

            // Build description from skill description + script name context
            let description = if multi_script {
                format!("{} ({})", entry.description, script_stem)
            } else {
                entry.description.clone()
            };

            tools.push(SkillToolEntry {
                tool_name,
                description,
                skill_name: entry.name.clone(),
                script_path: script_rel.to_string(),
                parameters,
                arg_mapping,
                explicit_schema: explicit,
            });
        }
    }

    info!(
        "Extracted {} tool definitions from {} skills",
        tools.len(),
        skill_entries.len()
    );

    Ok(tools)
}

/// Bundled file content embedded at compile time.
pub struct BundledFile {
    pub relative_path: &'static str,
    pub content: &'static str,
    pub executable: bool,
}

/// Write a bundled file to disk. In debug builds, skip files that already exist
/// to allow live-editing bundled skills/agents during development.
pub fn write_bundled_file(target: &Path, content: &str, executable: bool) -> Result<(), String> {
    // Always overwrite bundled files to keep them in sync with app version.
    // Bundled skills are embedded at compile time via include_str! — if the app
    // ships a new version of a skill, the deployed copy must be updated.
    fs::write(target, content).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    if executable {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(target, fs::Permissions::from_mode(0o755));
    }

    Ok(())
}

/// Extract bundled skills to ~/.notesage/skills/.
/// Always overwrites to ensure bundled skills stay up-to-date with app version.
/// Lives alongside user-created skills; the hierarchy system handles overrides.
#[tauri::command]
pub async fn extract_bundled_skills() -> Result<String, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let bundled_dir = home.join(".notesage").join("skills");

    // Clean up legacy bundled-skills directory
    let legacy_dir = home.join(".notesage").join("bundled-skills");
    if legacy_dir.is_dir() {
        let _ = fs::remove_dir_all(&legacy_dir);
    }

    let bundled_files: Vec<BundledFile> = vec![
        // create-skill
        BundledFile {
            relative_path: "create-skill/SKILL.md",
            content: include_str!("../../../bundled-skills/create-skill/SKILL.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "create-skill/scripts/scaffold.sh",
            content: include_str!("../../../bundled-skills/create-skill/scripts/scaffold.sh"),
            executable: true,
        },
        BundledFile {
            relative_path: "create-skill/scripts/validate.sh",
            content: include_str!("../../../bundled-skills/create-skill/scripts/validate.sh"),
            executable: true,
        },
        BundledFile {
            relative_path: "create-skill/references/SKILL-SPEC.md",
            content: include_str!("../../../bundled-skills/create-skill/references/SKILL-SPEC.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "create-skill/references/EXAMPLES.md",
            content: include_str!("../../../bundled-skills/create-skill/references/EXAMPLES.md"),
            executable: false,
        },
        // download-webpage
        BundledFile {
            relative_path: "download-webpage/SKILL.md",
            content: include_str!("../../../bundled-skills/download-webpage/SKILL.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "download-webpage/scripts/download.mjs",
            content: include_str!("../../../bundled-skills/download-webpage/scripts/download.mjs"),
            executable: true,
        },
        BundledFile {
            relative_path: "download-webpage/scripts/setup.sh",
            content: include_str!("../../../bundled-skills/download-webpage/scripts/setup.sh"),
            executable: true,
        },
        BundledFile {
            relative_path: "download-webpage/scripts/package.json",
            content: include_str!("../../../bundled-skills/download-webpage/scripts/package.json"),
            executable: false,
        },
        // save-research
        BundledFile {
            relative_path: "save-research/SKILL.md",
            content: include_str!("../../../bundled-skills/save-research/SKILL.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "save-research/scripts/save.mjs",
            content: include_str!("../../../bundled-skills/save-research/scripts/save.mjs"),
            executable: true,
        },
        // search-research
        BundledFile {
            relative_path: "search-research/SKILL.md",
            content: include_str!("../../../bundled-skills/search-research/SKILL.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "search-research/scripts/search.mjs",
            content: include_str!("../../../bundled-skills/search-research/scripts/search.mjs"),
            executable: true,
        },
        // synthesize-sources
        BundledFile {
            relative_path: "synthesize-sources/SKILL.md",
            content: include_str!("../../../bundled-skills/synthesize-sources/SKILL.md"),
            executable: false,
        },
        // insert-citation
        BundledFile {
            relative_path: "insert-citation/SKILL.md",
            content: include_str!("../../../bundled-skills/insert-citation/SKILL.md"),
            executable: false,
        },
        // create-agent
        BundledFile {
            relative_path: "create-agent/SKILL.md",
            content: include_str!("../../../bundled-skills/create-agent/SKILL.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "create-agent/scripts/scaffold.sh",
            content: include_str!("../../../bundled-skills/create-agent/scripts/scaffold.sh"),
            executable: true,
        },
        BundledFile {
            relative_path: "create-agent/references/AGENT-PATTERNS.md",
            content: include_str!("../../../bundled-skills/create-agent/references/AGENT-PATTERNS.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "create-agent/references/EXAMPLES.md",
            content: include_str!("../../../bundled-skills/create-agent/references/EXAMPLES.md"),
            executable: false,
        },
        // insert-chart
        BundledFile {
            relative_path: "insert-chart/SKILL.md",
            content: include_str!("../../../bundled-skills/insert-chart/SKILL.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "insert-chart/references/CHART-SCHEMA.md",
            content: include_str!("../../../bundled-skills/insert-chart/references/CHART-SCHEMA.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "insert-chart/references/EXAMPLES.md",
            content: include_str!("../../../bundled-skills/insert-chart/references/EXAMPLES.md"),
            executable: false,
        },
        // review-document
        BundledFile {
            relative_path: "review-document/SKILL.md",
            content: include_str!("../../../bundled-skills/review-document/SKILL.md"),
            executable: false,
        },
        // insert-drawing
        BundledFile {
            relative_path: "insert-drawing/SKILL.md",
            content: include_str!("../../../bundled-skills/insert-drawing/SKILL.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "insert-drawing/references/EXCALIDRAW-SCHEMA.md",
            content: include_str!("../../../bundled-skills/insert-drawing/references/EXCALIDRAW-SCHEMA.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "insert-drawing/references/EXAMPLES.md",
            content: include_str!("../../../bundled-skills/insert-drawing/references/EXAMPLES.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "insert-drawing/references/examples/flowchart.md",
            content: include_str!("../../../bundled-skills/insert-drawing/references/examples/flowchart.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "insert-drawing/references/examples/architecture.md",
            content: include_str!("../../../bundled-skills/insert-drawing/references/examples/architecture.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "insert-drawing/references/examples/process-flow.md",
            content: include_str!("../../../bundled-skills/insert-drawing/references/examples/process-flow.md"),
            executable: false,
        },
        // insert-diagram
        BundledFile {
            relative_path: "insert-diagram/SKILL.md",
            content: include_str!("../../../bundled-skills/insert-diagram/SKILL.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "insert-diagram/references/MERMAID-SYNTAX.md",
            content: include_str!("../../../bundled-skills/insert-diagram/references/MERMAID-SYNTAX.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "insert-diagram/references/EXAMPLES.md",
            content: include_str!("../../../bundled-skills/insert-diagram/references/EXAMPLES.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "insert-diagram/scripts/render-mermaid.mjs",
            content: include_str!("../../../bundled-skills/insert-diagram/scripts/render-mermaid.mjs"),
            executable: true,
        },
        BundledFile {
            relative_path: "insert-diagram/scripts/package.json",
            content: include_str!("../../../bundled-skills/insert-diagram/scripts/package.json"),
            executable: false,
        },
        // generate-presentation
        BundledFile {
            relative_path: "generate-presentation/SKILL.md",
            content: include_str!("../../../bundled-skills/generate-presentation/SKILL.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "generate-presentation/references/TEMPLATES.md",
            content: include_str!("../../../bundled-skills/generate-presentation/references/TEMPLATES.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "generate-presentation/scripts/generate.mjs",
            content: include_str!("../../../bundled-skills/generate-presentation/scripts/generate.mjs"),
            executable: true,
        },
        BundledFile {
            relative_path: "generate-presentation/scripts/package.json",
            content: include_str!("../../../bundled-skills/generate-presentation/scripts/package.json"),
            executable: false,
        },
    ];

    // Collect current bundled skill directory names
    let mut current_names: Vec<String> = bundled_files
        .iter()
        .filter_map(|f| f.relative_path.split('/').next().map(|s| s.to_string()))
        .collect();
    current_names.sort();
    current_names.dedup();

    // Clean up skills removed from the bundle
    let manifest_path = home.join(".notesage").join(".bundled-skills.json");
    if let Ok(old_json) = fs::read_to_string(&manifest_path) {
        if let Ok(old_names) = serde_json::from_str::<Vec<String>>(&old_json) {
            for old_name in &old_names {
                if !current_names.contains(old_name) {
                    let stale_dir = bundled_dir.join(old_name);
                    if stale_dir.is_dir() {
                        info!("Removing deprecated bundled skill: {}", old_name);
                        let _ = fs::remove_dir_all(&stale_dir);
                    }
                }
            }
        }
    }

    info!("Extracting {} bundled skill files to {}", bundled_files.len(), bundled_dir.display());
    let mut written = 0;
    for file in &bundled_files {
        let target = bundled_dir.join(file.relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory for {}: {}", file.relative_path, e))?;
        }

        write_bundled_file(&target, file.content, file.executable)
            .map_err(|e| format!("Failed to write {}: {}", file.relative_path, e))?;
        written += 1;
    }
    info!("Successfully wrote {}/{} bundled skill files", written, bundled_files.len());

    // Write manifest for future cleanup
    let manifest_json = serde_json::to_string(&current_names)
        .map_err(|e| format!("Failed to serialize skill manifest: {}", e))?;
    fs::write(&manifest_path, manifest_json)
        .map_err(|e| format!("Failed to write skill manifest: {}", e))?;

    Ok(bundled_dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::skills_frontmatter::parse_frontmatter;
    use super::skills_tool_parser::{parse_usage_comment, to_snake_case};
    use std::fs;
    fn create_temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("Failed to create temp dir")
    }

    // --- parse_frontmatter tests ---

    #[test]
    fn parse_frontmatter_full() {
        let content = "---\nname: web-research\ndescription: Downloads web pages\nlicense: MIT\n---\nBody content here.";
        let (fm, body) = parse_frontmatter(content);
        let fm = fm.expect("should parse frontmatter");
        assert_eq!(fm.name.unwrap(), "web-research");
        assert_eq!(fm.description.unwrap(), "Downloads web pages");
        assert_eq!(fm.license.unwrap(), "MIT");
        assert_eq!(body, "Body content here.");
    }

    #[test]
    fn parse_frontmatter_with_hyphenated_keys() {
        let content = "---\nname: test\ndescription: test skill\nuser-invocable: false\ndisable-model-invocation: true\nallowed-tools:\n  - bash\n  - read\n---\nBody";
        let (fm, _body) = parse_frontmatter(content);
        let fm = fm.expect("should parse frontmatter");
        assert_eq!(fm.user_invocable, Some(false));
        assert_eq!(fm.disable_model_invocation, Some(true));
        assert_eq!(fm.allowed_tools, Some(vec!["bash".to_string(), "read".to_string()]));
    }

    #[test]
    fn parse_frontmatter_no_frontmatter() {
        let content = "Just a regular markdown file.";
        let (fm, body) = parse_frontmatter(content);
        assert!(fm.is_none());
        assert_eq!(body, content);
    }

    #[test]
    fn parse_frontmatter_malformed_yaml() {
        let content = "---\n: invalid: yaml: [[\n---\nBody";
        let (fm, body) = parse_frontmatter(content);
        assert!(fm.is_none());
        assert_eq!(body, content);
    }

    #[test]
    fn parse_frontmatter_no_closing_delimiter() {
        let content = "---\nname: test\nNo closing delimiter";
        let (fm, body) = parse_frontmatter(content);
        assert!(fm.is_none());
        assert_eq!(body, content);
    }

    #[test]
    fn parse_frontmatter_multiline_body() {
        let content = "---\nname: test\ndescription: a skill\n---\nLine 1\n\nLine 3";
        let (fm, body) = parse_frontmatter(content);
        assert!(fm.is_some());
        assert_eq!(body, "Line 1\n\nLine 3");
    }

    // --- determine_source tests ---

    #[test]
    fn determine_source_global_skills() {
        // Global skills at the actual home dir
        if let Some(home) = dirs::home_dir() {
            let global_path = home.join(".notesage").join("skills");
            assert_eq!(determine_source(&global_path.to_string_lossy()), "notesage-global");
        }
        // Non-home .notesage/skills paths are project-level
        assert_eq!(determine_source("/some/project/.notesage/skills"), "notesage-project");
    }

    #[test]
    fn determine_source_providers() {
        assert_eq!(determine_source("/Users/me/.claude/skills"), "claude");
        assert_eq!(determine_source("/Users/me/.codex/skills"), "codex");
        assert_eq!(determine_source("/Users/me/.gemini/skills"), "gemini");
        assert_eq!(determine_source("/Users/me/.agents/skills"), "agents");
    }

    #[test]
    fn determine_source_notesage_project() {
        assert_eq!(determine_source("/projects/my-app/.notesage/skills"), "notesage-project");
    }

    #[test]
    fn determine_source_unknown() {
        assert_eq!(determine_source("/some/random/path"), "external");
    }

    // --- discover_skills tests (filesystem) ---

    #[test]
    fn discover_skills_finds_valid_skill() {
        let tmp = create_temp_dir();
        let skill_dir = tmp.path().join("my-skill");
        fs::create_dir(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: my-skill\ndescription: A test skill\n---\nInstructions here.",
        ).unwrap();
        fs::create_dir(skill_dir.join("scripts")).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_skills(vec![tmp.path().to_string_lossy().to_string()]));
        let skills = result.unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "my-skill");
        assert_eq!(skills[0].description, "A test skill");
        assert!(skills[0].has_scripts);
        assert!(!skills[0].has_references);
    }

    #[test]
    fn discover_skills_uses_dir_name_as_fallback() {
        let tmp = create_temp_dir();
        let skill_dir = tmp.path().join("fallback-name");
        fs::create_dir(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "---\ndescription: No name field\n---\n").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_skills(vec![tmp.path().to_string_lossy().to_string()]));
        let skills = result.unwrap();
        assert_eq!(skills[0].name, "fallback-name");
    }

    #[test]
    fn discover_skills_skips_dirs_without_skill_md() {
        let tmp = create_temp_dir();
        fs::create_dir(tmp.path().join("not-a-skill")).unwrap();
        fs::write(tmp.path().join("not-a-skill").join("README.md"), "hi").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_skills(vec![tmp.path().to_string_lossy().to_string()]));
        assert_eq!(result.unwrap().len(), 0);
    }

    #[test]
    fn discover_skills_skips_nonexistent_base_dir() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_skills(vec!["/nonexistent/path/12345".to_string()]));
        assert_eq!(result.unwrap().len(), 0);
    }

    // --- read_skill_content tests ---

    #[test]
    fn read_skill_content_returns_body_and_files() {
        let tmp = create_temp_dir();
        let skill_dir = tmp.path().join("test-skill");
        fs::create_dir(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: test-skill\ndescription: test\n---\nThe body content.\n\nMore body.",
        ).unwrap();
        let scripts_dir = skill_dir.join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(scripts_dir.join("run.sh"), "#!/bin/bash\necho hi").unwrap();
        let refs_dir = skill_dir.join("references");
        fs::create_dir(&refs_dir).unwrap();
        fs::write(refs_dir.join("spec.md"), "# Spec").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(read_skill_content(skill_dir.to_string_lossy().to_string()));
        let content = result.unwrap();
        assert_eq!(content.name, "test-skill");
        assert_eq!(content.body, "The body content.\n\nMore body.");
        assert_eq!(content.scripts, vec!["scripts/run.sh"]);
        assert_eq!(content.references, vec!["references/spec.md"]);
        assert!(content.assets.is_empty());
    }

    #[test]
    fn read_skill_content_errors_when_missing() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(read_skill_content("/nonexistent/skill".to_string()));
        assert!(result.is_err());
    }

    // --- parse_usage_comment tests ---

    #[test]
    fn parse_usage_positional_args() {
        let script = "#!/usr/bin/env node\n// Usage: node script.mjs <url> <output_dir>\n";
        let (schema, mappings) = parse_usage_comment(script).unwrap();
        let props = schema["properties"].as_object().unwrap();
        assert_eq!(props.len(), 2);
        assert!(props.contains_key("url"));
        assert!(props.contains_key("output_dir"));
        let required: Vec<String> = schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        assert_eq!(required, vec!["url", "output_dir"]);
        assert_eq!(mappings.len(), 2);
        assert_eq!(mappings[0].mapping_type, ArgMappingType::Positional);
        assert_eq!(mappings[0].position, Some(0));
        assert_eq!(mappings[1].position, Some(1));
    }

    #[test]
    fn parse_usage_optional_positional() {
        let script = "# Usage: script.sh <name> [description]\n";
        let (schema, mappings) = parse_usage_comment(script).unwrap();
        let props = schema["properties"].as_object().unwrap();
        assert_eq!(props.len(), 2);
        let required: Vec<String> = schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        assert_eq!(required, vec!["name"]); // description is optional
        assert_eq!(mappings.len(), 2);
    }

    #[test]
    fn parse_usage_boolean_flag() {
        let script = "// Usage: node script.mjs <url> <dir> [--force]\n";
        let (schema, mappings) = parse_usage_comment(script).unwrap();
        let props = schema["properties"].as_object().unwrap();
        assert_eq!(props.len(), 3);
        assert_eq!(props["force"]["type"], "boolean");
        let force_mapping = mappings.iter().find(|m| m.param_name == "force").unwrap();
        assert_eq!(
            force_mapping.mapping_type,
            ArgMappingType::BoolFlag { flag: "--force".to_string() }
        );
    }

    #[test]
    fn parse_usage_flag_with_value() {
        let script = "// Usage: node script.mjs <query> [--tag \"tagname\"] [--limit 20]\n";
        let (schema, mappings) = parse_usage_comment(script).unwrap();
        let props = schema["properties"].as_object().unwrap();
        assert_eq!(props.len(), 3);
        assert_eq!(props["tag"]["type"], "string");
        assert_eq!(props["limit"]["type"], "string");
        let tag_mapping = mappings.iter().find(|m| m.param_name == "tag").unwrap();
        assert_eq!(
            tag_mapping.mapping_type,
            ArgMappingType::Flag { flag: "--tag".to_string() }
        );
    }

    #[test]
    fn parse_usage_variadic_spread() {
        let script = "// Usage: node script.mjs <query> <dirs...>\n";
        let (schema, mappings) = parse_usage_comment(script).unwrap();
        let props = schema["properties"].as_object().unwrap();
        assert_eq!(props["dirs"]["type"], "array");
        let dirs_mapping = mappings.iter().find(|m| m.param_name == "dirs").unwrap();
        assert_eq!(dirs_mapping.mapping_type, ArgMappingType::Spread);
    }

    #[test]
    fn parse_usage_no_usage_line() {
        let script = "#!/bin/bash\necho hello\n";
        assert!(parse_usage_comment(script).is_none());
    }

    #[test]
    fn parse_usage_no_params() {
        let script = "// Usage: node script.mjs\n";
        assert!(parse_usage_comment(script).is_none());
    }

    #[test]
    fn parse_usage_bash_comment_style() {
        let script = "#!/usr/bin/env bash\n# Usage: scaffold.sh <skill-name> <target-directory>\n";
        let (schema, mappings) = parse_usage_comment(script).unwrap();
        let props = schema["properties"].as_object().unwrap();
        assert_eq!(props.len(), 2);
        assert!(props.contains_key("skill_name")); // hyphen → underscore
        assert!(props.contains_key("target_directory"));
        assert_eq!(mappings.len(), 2);
    }

    #[test]
    fn parse_usage_real_download_skill() {
        let script = "#!/usr/bin/env node\n// download.mjs — Fetch a web page\n// Usage: node download.mjs <url> <output_dir> [--force]\n";
        let (schema, mappings) = parse_usage_comment(script).unwrap();
        let props = schema["properties"].as_object().unwrap();
        assert_eq!(props.len(), 3);
        assert!(props.contains_key("url"));
        assert!(props.contains_key("output_dir"));
        assert!(props.contains_key("force"));
        assert_eq!(props["force"]["type"], "boolean");
        assert_eq!(mappings.len(), 3);
    }

    #[test]
    fn parse_usage_real_save_research() {
        let script = "#!/usr/bin/env node\n// save.mjs — Save research\n// Usage: node save.mjs <content_or_path> <output_dir> [--title \"...\"] [--tags \"tag1,tag2\"] [--url \"...\"] [--author \"...\"] [--force]\n";
        let (schema, _mappings) = parse_usage_comment(script).unwrap();
        let props = schema["properties"].as_object().unwrap();
        assert_eq!(props.len(), 7);
        assert_eq!(props["content_or_path"]["type"], "string");
        assert_eq!(props["title"]["type"], "string");
        assert_eq!(props["tags"]["type"], "string");
        assert_eq!(props["force"]["type"], "boolean");
    }

    // --- to_snake_case tests ---

    #[test]
    fn snake_case_conversion() {
        assert_eq!(to_snake_case("download-webpage"), "download_webpage");
        assert_eq!(to_snake_case("create-skill"), "create_skill");
        assert_eq!(to_snake_case("MySkill"), "myskill");
        assert_eq!(to_snake_case("already_snake"), "already_snake");
    }

    // --- extract_skill_tools tests ---

    #[test]
    fn extract_tools_skips_no_scripts() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let entries = vec![SkillEntry {
            name: "knowledge-only".into(),
            description: "No scripts".into(),
            path: "/fake/path".into(),
            source: "notesage-global".into(),
            license: None,
            compatibility: None,
            metadata: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: None,
            has_scripts: false,
            has_references: false,
        }];
        let result = rt.block_on(extract_skill_tools(entries)).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn extract_tools_skips_disabled_model_invocation() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let entries = vec![SkillEntry {
            name: "private-skill".into(),
            description: "Disabled".into(),
            path: "/fake/path".into(),
            source: "notesage-global".into(),
            license: None,
            compatibility: None,
            metadata: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: Some(true),
            has_scripts: true,
            has_references: false,
        }];
        let result = rt.block_on(extract_skill_tools(entries)).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn extract_tools_explicit_frontmatter() {
        let tmp = create_temp_dir();
        let skill_dir = tmp.path().join("my-tool");
        fs::create_dir(&skill_dir).unwrap();
        fs::create_dir(skill_dir.join("scripts")).unwrap();
        fs::write(skill_dir.join("scripts/run.sh"), "#!/bin/bash\necho hi").unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: my-tool\ndescription: A tool\ntools:\n  - name: run\n    description: Run the thing\n    script: scripts/run.sh\n    parameters:\n      type: object\n      properties:\n        input:\n          type: string\n          description: The input\n      required:\n        - input\n---\nBody",
        )
        .unwrap();

        let entries = vec![SkillEntry {
            name: "my-tool".into(),
            description: "A tool".into(),
            path: skill_dir.to_string_lossy().into(),
            source: "notesage-global".into(),
            license: None,
            compatibility: None,
            metadata: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: None,
            has_scripts: true,
            has_references: false,
        }];

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(extract_skill_tools(entries)).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].tool_name, "skill__my_tool");
        assert_eq!(result[0].description, "Run the thing");
        assert!(result[0].explicit_schema);
        assert_eq!(result[0].parameters["properties"]["input"]["type"], "string");
    }

    #[test]
    fn extract_tools_usage_comment_parsing() {
        let tmp = create_temp_dir();
        let skill_dir = tmp.path().join("download-webpage");
        fs::create_dir(&skill_dir).unwrap();
        let scripts_dir = skill_dir.join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(
            scripts_dir.join("download.mjs"),
            "#!/usr/bin/env node\n// Usage: node download.mjs <url> <output_dir> [--force]\n",
        )
        .unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: download-webpage\ndescription: Download a web page\n---\nBody",
        )
        .unwrap();

        let entries = vec![SkillEntry {
            name: "download-webpage".into(),
            description: "Download a web page".into(),
            path: skill_dir.to_string_lossy().into(),
            source: "notesage-global".into(),
            license: None,
            compatibility: None,
            metadata: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: None,
            has_scripts: true,
            has_references: false,
        }];

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(extract_skill_tools(entries)).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].tool_name, "skill__download_webpage");
        assert!(!result[0].explicit_schema);
        assert_eq!(result[0].parameters["properties"]["url"]["type"], "string");
        assert_eq!(result[0].parameters["properties"]["force"]["type"], "boolean");
    }

    #[test]
    fn extract_tools_fallback_generic() {
        let tmp = create_temp_dir();
        let skill_dir = tmp.path().join("no-usage");
        fs::create_dir(&skill_dir).unwrap();
        let scripts_dir = skill_dir.join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(scripts_dir.join("run.sh"), "#!/bin/bash\necho hi").unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: no-usage\ndescription: No usage comment\n---\nBody",
        )
        .unwrap();

        let entries = vec![SkillEntry {
            name: "no-usage".into(),
            description: "No usage comment".into(),
            path: skill_dir.to_string_lossy().into(),
            source: "notesage-global".into(),
            license: None,
            compatibility: None,
            metadata: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: None,
            has_scripts: true,
            has_references: false,
        }];

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(extract_skill_tools(entries)).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].tool_name, "skill__no_usage");
        assert_eq!(result[0].parameters["properties"]["args"]["type"], "array");
    }

    #[test]
    fn extract_tools_multi_script_naming() {
        let tmp = create_temp_dir();
        let skill_dir = tmp.path().join("multi-script");
        fs::create_dir(&skill_dir).unwrap();
        let scripts_dir = skill_dir.join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(scripts_dir.join("scaffold.sh"), "#!/bin/bash\n# Usage: scaffold.sh <name>\n").unwrap();
        fs::write(scripts_dir.join("validate.sh"), "#!/bin/bash\n# Usage: validate.sh <path>\n").unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: multi-script\ndescription: Has two scripts\n---\nBody",
        )
        .unwrap();

        let entries = vec![SkillEntry {
            name: "multi-script".into(),
            description: "Has two scripts".into(),
            path: skill_dir.to_string_lossy().into(),
            source: "notesage-global".into(),
            license: None,
            compatibility: None,
            metadata: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: None,
            has_scripts: true,
            has_references: false,
        }];

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(extract_skill_tools(entries)).unwrap();
        assert_eq!(result.len(), 2);
        // Multi-script → skill__{skill}__{script}
        let names: Vec<&str> = result.iter().map(|t| t.tool_name.as_str()).collect();
        assert!(names.contains(&"skill__multi_script__scaffold"));
        assert!(names.contains(&"skill__multi_script__validate"));
    }

    #[test]
    fn extract_tools_skips_non_script_files() {
        let tmp = create_temp_dir();
        let skill_dir = tmp.path().join("with-config");
        fs::create_dir(&skill_dir).unwrap();
        let scripts_dir = skill_dir.join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(scripts_dir.join("run.mjs"), "// Usage: node run.mjs <input>\n").unwrap();
        fs::write(scripts_dir.join("package.json"), "{}").unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: with-config\ndescription: Has config files\n---\nBody",
        )
        .unwrap();

        let entries = vec![SkillEntry {
            name: "with-config".into(),
            description: "Has config files".into(),
            path: skill_dir.to_string_lossy().into(),
            source: "notesage-global".into(),
            license: None,
            compatibility: None,
            metadata: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: None,
            has_scripts: true,
            has_references: false,
        }];

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(extract_skill_tools(entries)).unwrap();
        // Should only produce 1 tool (run.mjs), not package.json
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].tool_name, "skill__with_config");
    }

}
