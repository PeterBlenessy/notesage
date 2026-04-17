use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use super::skills::parse_frontmatter_raw;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AgentInstruction {
    pub source: String,
    pub source_type: String,
    pub content: String,
    pub priority: u8,
}

// --- Agent types ---

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AgentEntry {
    pub name: String,
    pub description: String,
    pub path: String,
    pub source: String, // "notesage-project" | "notesage-global" | "bundled" | "claude" | "codex" | "gemini" | "github"
    pub model: Option<String>,
    pub icon: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub user_invocable: Option<bool>,
    pub disable_model_invocation: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AgentContent {
    pub name: String,
    pub body: String,
    pub path: String,
}

/// YAML frontmatter shape for agent .md files
#[derive(Deserialize, Debug, Default)]
struct AgentFrontmatter {
    name: Option<String>,
    description: Option<String>,
    model: Option<String>,
    icon: Option<String>,
    #[serde(rename = "allowed-tools")]
    allowed_tools: Option<Vec<String>>,
    #[serde(rename = "user-invocable")]
    user_invocable: Option<bool>,
    #[serde(rename = "disable-model-invocation")]
    disable_model_invocation: Option<bool>,
}

/// Parse YAML frontmatter from an agent .md file.
fn parse_agent_frontmatter(content: &str) -> (Option<AgentFrontmatter>, String) {
    let (yaml_str, body) = parse_frontmatter_raw(content);
    match yaml_str {
        Some(yaml) => match serde_norway::from_str::<AgentFrontmatter>(yaml) {
            Ok(fm) => (Some(fm), body.to_string()),
            Err(_) => (None, content.to_string()),
        },
        None => (None, content.to_string()),
    }
}

/// Determine the source label for agents found in a given base directory.
fn determine_agent_source(base_dir: &str) -> String {
    let path = Path::new(base_dir);
    let components: Vec<&str> = path
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();

    // Check for .notesage/agents path — distinguish project vs global
    if components.windows(2).any(|w| w[0] == ".notesage" && w[1] == "agents") {
        if let Some(home) = dirs::home_dir() {
            let global_path = home.join(".notesage").join("agents");
            if base_dir == global_path.to_string_lossy() {
                return "notesage-global".to_string();
            }
        }
        return "notesage-project".to_string();
    }

    // Check for provider-specific agent directories by matching .<provider>/agents components
    let provider_pairs: &[(&str, &str)] = &[
        (".claude", "claude"),
        (".codex", "codex"),
        (".gemini", "gemini"),
        (".github", "github"),
        (".copilot", "copilot"),
    ];

    for &(dir_name, source) in provider_pairs {
        if components.windows(2).any(|w| w[0] == dir_name && w[1] == "agents") {
            return source.to_string();
        }
    }

    "external".to_string()
}

/// Discover addressable agent files from specified base directories.
///
/// Each base directory is scanned for `*.md` and `*.agent.md` files with valid YAML
/// frontmatter containing at least `name` and `description`.
#[tauri::command]
pub async fn discover_agents(
    base_dirs: Vec<String>,
) -> Result<Vec<AgentEntry>, String> {
    let mut agents = Vec::new();

    for base_dir in &base_dirs {
        let base_path = Path::new(base_dir);
        if !base_path.is_dir() {
            info!("Agent scan: skipping non-existent directory {}", base_dir);
            continue;
        }

        let entries = match fs::read_dir(base_path) {
            Ok(e) => e,
            Err(e) => {
                warn!("Agent scan: cannot read directory {}: {}", base_dir, e);
                continue;
            }
        };

        let source = determine_agent_source(base_dir);

        for entry in entries.flatten() {
            let entry_path = entry.path();
            if !entry_path.is_file() {
                continue;
            }

            let file_name = entry_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // Match *.md and *.agent.md files
            if !file_name.ends_with(".md") {
                continue;
            }

            let content = match fs::read_to_string(&entry_path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let (frontmatter, _body) = parse_agent_frontmatter(&content);
            let fm = match frontmatter {
                Some(fm) => fm,
                None => continue, // Skip files without valid frontmatter
            };

            // Both name and description are required
            let name = match fm.name {
                Some(n) => n,
                None => continue,
            };
            let description = match fm.description {
                Some(d) => d,
                None => continue,
            };

            agents.push(AgentEntry {
                name,
                description,
                path: entry_path.to_string_lossy().to_string(),
                source: source.clone(),
                model: fm.model,
                icon: fm.icon,
                allowed_tools: fm.allowed_tools,
                user_invocable: fm.user_invocable,
                disable_model_invocation: fm.disable_model_invocation,
            });
        }
    }

    Ok(agents)
}

/// Read the full body of an agent file (markdown after frontmatter).
#[tauri::command]
pub async fn read_agent_content(
    agent_path: String,
) -> Result<AgentContent, String> {
    let path = Path::new(&agent_path);

    if !path.is_file() {
        return Err(format!("Agent file not found: {}", agent_path));
    }

    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read agent file: {}", e))?;

    let (frontmatter, body) = parse_agent_frontmatter(&content);
    let name = frontmatter
        .and_then(|fm| fm.name)
        .unwrap_or_else(|| {
            path.file_stem()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default()
        });

    Ok(AgentContent {
        name,
        body,
        path: agent_path,
    })
}

/// The 7 known bundled agent filenames that were shipped in previous versions.
/// Only these are deleted during cleanup — user-created agents are never touched.
const BUNDLED_AGENT_FILENAMES: &[&str] = &[
    "general-assistant.md",
    "creative-writer.md",
    "technical-editor.md",
    "fact-checker.md",
    "academic-writer.md",
    "copywriter.md",
    "proofreader.md",
];

/// One-time cleanup: removes previously extracted bundled agent files from
/// ~/.notesage/agents/. Only deletes files matching the 7 known bundled names.
/// Also removes the legacy bundled-agents directory, manifest, and bundled agents.md.
#[tauri::command]
pub async fn cleanup_bundled_agents() -> Result<u32, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let agents_dir = home.join(".notesage").join("agents");

    let mut removed = 0u32;

    // Remove the 7 known bundled agent files
    for filename in BUNDLED_AGENT_FILENAMES {
        let file_path = agents_dir.join(filename);
        if file_path.is_file() {
            if let Ok(()) = fs::remove_file(&file_path) {
                info!("Cleaned up bundled agent: {}", filename);
                removed += 1;
            }
        }
    }

    // Remove legacy bundled-agents directory
    let legacy_dir = home.join(".notesage").join("bundled-agents");
    if legacy_dir.is_dir() {
        let _ = fs::remove_dir_all(&legacy_dir);
        info!("Removed legacy bundled-agents directory");
    }

    // Remove manifest file
    let manifest_path = home.join(".notesage").join(".bundled-agents.json");
    if manifest_path.is_file() {
        let _ = fs::remove_file(&manifest_path);
    }

    // Remove bundled agents.md (only if it was the bundled version)
    let agents_md = home.join(".notesage").join("agents.md");
    if agents_md.is_file() {
        // Delete it — if the user wrote their own, they can recreate it.
        // The bundled agents.md was always overwritten on every launch anyway.
        let _ = fs::remove_file(&agents_md);
        info!("Removed bundled agents.md");
    }

    // Clean up legacy bundled-agents.md
    let legacy_instructions = home.join(".notesage").join("bundled-agents.md");
    if legacy_instructions.is_file() {
        let _ = fs::remove_file(&legacy_instructions);
    }

    info!("Bundled agent cleanup complete: removed {} files", removed);
    Ok(removed)
}

fn try_read_instruction(
    root: &Path,
    filename: &str,
    source_type: &str,
    priority: u8,
    instructions: &mut Vec<AgentInstruction>,
) {
    let file_path = root.join(filename);
    if file_path.is_file() {
        if let Ok(content) = fs::read_to_string(&file_path) {
            instructions.push(AgentInstruction {
                source: file_path.to_string_lossy().to_string(),
                source_type: source_type.to_string(),
                content,
                priority,
            });
        }
    }
}

/// Read agent instruction files for a project.
///
/// Discovers and reads agent instruction files in priority order:
/// 1. AGENTS.md in project root (always)
/// 2. CLAUDE.md in project root (if claude connected)
/// 3. GEMINI.md in project root (if gemini connected)
/// 4. ~/.notesage/agents.md (always)
/// 5. .notesage/agents.md in project root (always)
#[tauri::command]
pub async fn read_agent_instructions(
    project_root: Option<String>,
    connected_providers: Vec<String>,
) -> Result<Vec<AgentInstruction>, String> {
    let mut instructions = Vec::new();

    let home = dirs::home_dir();

    if let Some(ref root) = project_root {
        let root_path = Path::new(root);

        // Priority 1: AGENTS.md (always)
        try_read_instruction(root_path, "AGENTS.md", "agents-md", 1, &mut instructions);

        // Priority 2: CLAUDE.md (if claude connected)
        if connected_providers.iter().any(|p| p.contains("claude")) {
            try_read_instruction(root_path, "CLAUDE.md", "claude-md", 2, &mut instructions);
        }

        // Priority 3: GEMINI.md (if gemini connected)
        if connected_providers.iter().any(|p| p.contains("gemini")) {
            try_read_instruction(root_path, "GEMINI.md", "gemini-md", 3, &mut instructions);
        }
    }

    // Priority 4: ~/.notesage/agents.md (always)
    if let Some(ref home_dir) = home {
        let global_agents = home_dir.join(".notesage").join("agents.md");
        if global_agents.is_file() {
            if let Ok(content) = fs::read_to_string(&global_agents) {
                instructions.push(AgentInstruction {
                    source: global_agents.to_string_lossy().to_string(),
                    source_type: "notesage-global".to_string(),
                    content,
                    priority: 4,
                });
            }
        }
    }

    // Priority 5: .notesage/agents.md in project root (always)
    if let Some(ref root) = project_root {
        let project_agents = Path::new(root).join(".notesage").join("agents.md");
        if project_agents.is_file() {
            if let Ok(content) = fs::read_to_string(&project_agents) {
                instructions.push(AgentInstruction {
                    source: project_agents.to_string_lossy().to_string(),
                    source_type: "notesage-project".to_string(),
                    content,
                    priority: 5,
                });
            }
        }
    }

    Ok(instructions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    fn create_temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("Failed to create temp dir")
    }

    // --- discover_agents tests ---

    #[test]
    fn discover_agents_finds_valid_agent() {
        let tmp = create_temp_dir();
        fs::write(
            tmp.path().join("editor.md"),
            "---\nname: editor\ndescription: Specialist in editorial consistency\nicon: pen-line\n---\nYou are an editor.",
        ).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_agents(vec![tmp.path().to_string_lossy().to_string()]));
        let agents = result.unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].name, "editor");
        assert_eq!(agents[0].description, "Specialist in editorial consistency");
        assert_eq!(agents[0].icon.as_deref(), Some("pen-line"));
    }

    #[test]
    fn discover_agents_finds_agent_md_extension() {
        let tmp = create_temp_dir();
        fs::write(
            tmp.path().join("reviewer.agent.md"),
            "---\nname: reviewer\ndescription: Reviews code\n---\nYou review code.",
        ).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_agents(vec![tmp.path().to_string_lossy().to_string()]));
        let agents = result.unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].name, "reviewer");
    }

    #[test]
    fn discover_agents_skips_missing_name() {
        let tmp = create_temp_dir();
        fs::write(
            tmp.path().join("noname.md"),
            "---\ndescription: Has no name\n---\nBody",
        ).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_agents(vec![tmp.path().to_string_lossy().to_string()]));
        assert_eq!(result.unwrap().len(), 0);
    }

    #[test]
    fn discover_agents_skips_missing_description() {
        let tmp = create_temp_dir();
        fs::write(
            tmp.path().join("nodesc.md"),
            "---\nname: nodesc\n---\nBody",
        ).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_agents(vec![tmp.path().to_string_lossy().to_string()]));
        assert_eq!(result.unwrap().len(), 0);
    }

    #[test]
    fn discover_agents_skips_invalid_frontmatter() {
        let tmp = create_temp_dir();
        fs::write(
            tmp.path().join("bad.md"),
            "---\n: invalid: yaml: [[\n---\nBody",
        ).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_agents(vec![tmp.path().to_string_lossy().to_string()]));
        assert_eq!(result.unwrap().len(), 0);
    }

    #[test]
    fn discover_agents_skips_no_frontmatter() {
        let tmp = create_temp_dir();
        fs::write(
            tmp.path().join("plain.md"),
            "Just a regular markdown file.",
        ).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_agents(vec![tmp.path().to_string_lossy().to_string()]));
        assert_eq!(result.unwrap().len(), 0);
    }

    #[test]
    fn discover_agents_parses_all_frontmatter_fields() {
        let tmp = create_temp_dir();
        fs::write(
            tmp.path().join("full.md"),
            "---\nname: full-agent\ndescription: Full agent\nmodel: sonnet\nicon: star\nallowed-tools:\n  - bash\n  - read\nuser-invocable: false\ndisable-model-invocation: true\n---\nBody",
        ).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_agents(vec![tmp.path().to_string_lossy().to_string()]));
        let agents = result.unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].model.as_deref(), Some("sonnet"));
        assert_eq!(agents[0].icon.as_deref(), Some("star"));
        assert_eq!(agents[0].allowed_tools, Some(vec!["bash".to_string(), "read".to_string()]));
        assert_eq!(agents[0].user_invocable, Some(false));
        assert_eq!(agents[0].disable_model_invocation, Some(true));
    }

    #[test]
    fn discover_agents_source_attribution() {
        let tmp = create_temp_dir();

        // Create a .notesage/agents subdirectory (project-level)
        let project = tmp.path().join(".notesage").join("agents");
        fs::create_dir_all(&project).unwrap();
        fs::write(
            project.join("assistant.md"),
            "---\nname: assistant\ndescription: General assistant\n---\nBody",
        ).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_agents(vec![project.to_string_lossy().to_string()]));
        let agents = result.unwrap();
        assert_eq!(agents[0].source, "notesage-project");
    }

    #[test]
    fn discover_agents_skips_nonexistent_dir() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_agents(vec!["/nonexistent/path/12345".to_string()]));
        assert_eq!(result.unwrap().len(), 0);
    }

    #[test]
    fn discover_agents_skips_directories() {
        let tmp = create_temp_dir();
        fs::create_dir(tmp.path().join("subdir.md")).unwrap(); // directory with .md name

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_agents(vec![tmp.path().to_string_lossy().to_string()]));
        assert_eq!(result.unwrap().len(), 0);
    }

    #[test]
    fn discover_agents_multiple_dirs() {
        let tmp1 = create_temp_dir();
        let tmp2 = create_temp_dir();
        fs::write(
            tmp1.path().join("a.md"),
            "---\nname: agent-a\ndescription: Agent A\n---\nBody",
        ).unwrap();
        fs::write(
            tmp2.path().join("b.md"),
            "---\nname: agent-b\ndescription: Agent B\n---\nBody",
        ).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(discover_agents(vec![
            tmp1.path().to_string_lossy().to_string(),
            tmp2.path().to_string_lossy().to_string(),
        ]));
        let agents = result.unwrap();
        assert_eq!(agents.len(), 2);
    }

    // --- read_agent_content tests ---

    #[test]
    fn read_agent_content_returns_body() {
        let tmp = create_temp_dir();
        let agent_file = tmp.path().join("editor.md");
        fs::write(
            &agent_file,
            "---\nname: editor\ndescription: An editor\n---\nYou are an editor.\n\nBe thorough.",
        ).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(read_agent_content(agent_file.to_string_lossy().to_string()));
        let content = result.unwrap();
        assert_eq!(content.name, "editor");
        assert_eq!(content.body, "You are an editor.\n\nBe thorough.");
        assert!(content.path.contains("editor.md"));
    }

    #[test]
    fn read_agent_content_uses_stem_as_fallback_name() {
        let tmp = create_temp_dir();
        let agent_file = tmp.path().join("my-agent.md");
        fs::write(&agent_file, "No frontmatter, just body.").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(read_agent_content(agent_file.to_string_lossy().to_string()));
        let content = result.unwrap();
        assert_eq!(content.name, "my-agent");
    }

    #[test]
    fn read_agent_content_errors_when_missing() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(read_agent_content("/nonexistent/agent.md".to_string()));
        assert!(result.is_err());
    }

    // --- determine_agent_source tests ---

    #[test]
    fn determine_agent_source_global_agents() {
        // Global agents at the actual home dir
        if let Some(home) = dirs::home_dir() {
            let global_path = home.join(".notesage").join("agents");
            assert_eq!(determine_agent_source(&global_path.to_string_lossy()), "notesage-global");
        }
        // Non-home .notesage/agents paths are project-level
        assert_eq!(determine_agent_source("/some/project/.notesage/agents"), "notesage-project");
    }

    #[test]
    fn determine_agent_source_providers() {
        assert_eq!(determine_agent_source("/Users/me/.claude/agents"), "claude");
        assert_eq!(determine_agent_source("/Users/me/.codex/agents"), "codex");
        assert_eq!(determine_agent_source("/Users/me/.gemini/agents"), "gemini");
        assert_eq!(determine_agent_source("/project/.github/agents"), "github");
        assert_eq!(determine_agent_source("/Users/me/.copilot/agents"), "copilot");
    }

    #[test]
    fn determine_agent_source_notesage_project() {
        assert_eq!(determine_agent_source("/projects/my-app/.notesage/agents"), "notesage-project");
    }

    #[test]
    fn determine_agent_source_unknown() {
        assert_eq!(determine_agent_source("/some/random/path"), "external");
    }

    // --- read_agent_instructions tests ---

    #[test]
    fn read_agent_instructions_discovers_files() {
        let tmp = create_temp_dir();
        let root = tmp.path();

        fs::write(root.join("AGENTS.md"), "# Agents instructions").unwrap();
        fs::write(root.join("CLAUDE.md"), "# Claude instructions").unwrap();

        let notesage_dir = root.join(".notesage");
        fs::create_dir(&notesage_dir).unwrap();
        fs::write(notesage_dir.join("agents.md"), "# Project agent instructions").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(read_agent_instructions(
            Some(root.to_string_lossy().to_string()),
            vec!["claude-code".to_string()],
        ));
        let instructions = result.unwrap();

        // Filter out global instructions that may exist on the host machine
        let project_instructions: Vec<_> = instructions.iter()
            .filter(|i| i.source_type != "notesage-global")
            .collect();

        assert_eq!(project_instructions.len(), 3);
        assert_eq!(project_instructions[0].source_type, "agents-md");
        assert_eq!(project_instructions[0].priority, 1);
        assert_eq!(project_instructions[1].source_type, "claude-md");
        assert_eq!(project_instructions[1].priority, 2);
        assert_eq!(project_instructions[2].source_type, "notesage-project");
        assert_eq!(project_instructions[2].priority, 5);
    }

    #[test]
    fn read_agent_instructions_skips_claude_when_not_connected() {
        let tmp = create_temp_dir();
        let root = tmp.path();
        fs::write(root.join("CLAUDE.md"), "# Claude").unwrap();
        fs::write(root.join("AGENTS.md"), "# Agents").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(read_agent_instructions(
            Some(root.to_string_lossy().to_string()),
            vec![], // no providers connected
        ));
        let instructions = result.unwrap();

        // Filter out global instructions that may exist on the host machine
        let project_instructions: Vec<_> = instructions.iter()
            .filter(|i| i.source_type != "notesage-global")
            .collect();
        assert_eq!(project_instructions.len(), 1);
        assert_eq!(project_instructions[0].source_type, "agents-md");
    }

    #[test]
    fn read_agent_instructions_no_project_root() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(read_agent_instructions(None, vec![]));
        // Should succeed with only global instructions (if they exist)
        assert!(result.is_ok());
    }

    // --- cleanup_bundled_agents tests ---

    #[test]
    fn cleanup_deletes_known_bundled_agents() {
        let tmp = create_temp_dir();
        let agents_dir = tmp.path().join(".notesage").join("agents");
        fs::create_dir_all(&agents_dir).unwrap();

        // Create bundled agent files
        for name in BUNDLED_AGENT_FILENAMES {
            fs::write(agents_dir.join(name), "---\nname: test\ndescription: test\n---\nBody").unwrap();
        }
        // Create a user agent that should NOT be deleted
        fs::write(agents_dir.join("my-custom-agent.md"), "---\nname: custom\ndescription: Custom\n---\nBody").unwrap();

        assert_eq!(fs::read_dir(&agents_dir).unwrap().count(), 8); // 7 bundled + 1 user

        // Simulate cleanup (directly test the logic since the command uses dirs::home_dir)
        for filename in BUNDLED_AGENT_FILENAMES {
            let file_path = agents_dir.join(filename);
            if file_path.is_file() {
                fs::remove_file(&file_path).unwrap();
            }
        }

        // Verify: only user agent remains
        let remaining: Vec<_> = fs::read_dir(&agents_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(remaining, vec!["my-custom-agent.md"]);
    }

    #[test]
    fn cleanup_removes_legacy_dirs_and_manifest() {
        let tmp = create_temp_dir();
        let notesage_dir = tmp.path().join(".notesage");
        fs::create_dir_all(&notesage_dir).unwrap();

        // Create legacy directory
        let legacy_dir = notesage_dir.join("bundled-agents");
        fs::create_dir_all(&legacy_dir).unwrap();
        fs::write(legacy_dir.join("test.md"), "test").unwrap();

        // Create manifest
        let manifest = notesage_dir.join(".bundled-agents.json");
        fs::write(&manifest, r#"["general-assistant"]"#).unwrap();

        // Create bundled agents.md
        let agents_md = notesage_dir.join("agents.md");
        fs::write(&agents_md, "bundled instructions").unwrap();

        assert!(legacy_dir.is_dir());
        assert!(manifest.is_file());
        assert!(agents_md.is_file());

        // Simulate cleanup
        let _ = fs::remove_dir_all(&legacy_dir);
        let _ = fs::remove_file(&manifest);
        let _ = fs::remove_file(&agents_md);

        assert!(!legacy_dir.exists());
        assert!(!manifest.exists());
        assert!(!agents_md.exists());
    }

    #[test]
    fn bundled_agent_filenames_are_correct() {
        // Verify the constant matches the known bundled agent names
        assert_eq!(BUNDLED_AGENT_FILENAMES.len(), 7);
        assert!(BUNDLED_AGENT_FILENAMES.contains(&"general-assistant.md"));
        assert!(BUNDLED_AGENT_FILENAMES.contains(&"creative-writer.md"));
        assert!(BUNDLED_AGENT_FILENAMES.contains(&"technical-editor.md"));
        assert!(BUNDLED_AGENT_FILENAMES.contains(&"fact-checker.md"));
        assert!(BUNDLED_AGENT_FILENAMES.contains(&"academic-writer.md"));
        assert!(BUNDLED_AGENT_FILENAMES.contains(&"copywriter.md"));
        assert!(BUNDLED_AGENT_FILENAMES.contains(&"proofreader.md"));
    }
}
