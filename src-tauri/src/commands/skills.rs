use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

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

/// YAML frontmatter shape for SKILL.md files
#[derive(Deserialize, Debug, Default)]
struct SkillFrontmatter {
    name: Option<String>,
    description: Option<String>,
    license: Option<String>,
    compatibility: Option<String>,
    metadata: Option<HashMap<String, String>>,
    #[serde(rename = "allowed-tools")]
    allowed_tools: Option<Vec<String>>,
    #[serde(rename = "user-invocable")]
    user_invocable: Option<bool>,
    #[serde(rename = "disable-model-invocation")]
    disable_model_invocation: Option<bool>,
}

/// Parse YAML frontmatter from a SKILL.md file.
/// Returns (frontmatter, body) where body is the content after the closing `---`.
fn parse_frontmatter(content: &str) -> (Option<SkillFrontmatter>, String) {
    let (yaml_str, body) = parse_frontmatter_raw(content);
    match yaml_str {
        Some(yaml) => match serde_yml::from_str::<SkillFrontmatter>(yaml) {
            Ok(fm) => (Some(fm), body.to_string()),
            Err(_) => (None, content.to_string()),
        },
        None => (None, content.to_string()),
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
            continue;
        }

        let entries = match fs::read_dir(base_path) {
            Ok(e) => e,
            Err(_) => continue,
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

/// Bundled file content embedded at compile time.
pub struct BundledFile {
    pub relative_path: &'static str,
    pub content: &'static str,
    pub executable: bool,
}

/// Write a bundled file to disk. In debug builds, skip files that already exist
/// to allow live-editing bundled skills/agents during development.
pub fn write_bundled_file(target: &Path, content: &str, executable: bool) -> Result<(), String> {
    #[cfg(debug_assertions)]
    if target.exists() {
        return Ok(());
    }

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
    ];

    for file in &bundled_files {
        let target = bundled_dir.join(file.relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory for {}: {}", file.relative_path, e))?;
        }

        write_bundled_file(&target, file.content, file.executable)
            .map_err(|e| format!("Failed to write {}: {}", file.relative_path, e))?;
    }

    Ok(bundled_dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
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

}
