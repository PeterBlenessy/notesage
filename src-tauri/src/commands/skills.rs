use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::BufRead;
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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ScriptResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
}

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

/// Parse YAML frontmatter from a markdown file (generic).
/// Returns (yaml_str, body) where body is the content after the closing `---`.
fn parse_frontmatter_raw(content: &str) -> (Option<&str>, &str) {
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
        Some(yaml) => match serde_yaml::from_str::<SkillFrontmatter>(yaml) {
            Ok(fm) => (Some(fm), body.to_string()),
            Err(_) => (None, content.to_string()),
        },
        None => (None, content.to_string()),
    }
}

/// Parse YAML frontmatter from an agent .md file.
fn parse_agent_frontmatter(content: &str) -> (Option<AgentFrontmatter>, String) {
    let (yaml_str, body) = parse_frontmatter_raw(content);
    match yaml_str {
        Some(yaml) => match serde_yaml::from_str::<AgentFrontmatter>(yaml) {
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

/// Execute a script from a skill's scripts/ directory.
///
/// Security: the script path must resolve to within the skill directory (path traversal protection).
/// Interpreter is resolved from shebang line or file extension.
/// Process is killed if it exceeds the timeout.
#[tauri::command]
pub async fn execute_skill_script(
    skill_path: String,
    script: String,
    args: Vec<String>,
    working_dir: Option<String>,
    env: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<ScriptResult, String> {
    let skill_dir = Path::new(&skill_path)
        .canonicalize()
        .map_err(|e| format!("Invalid skill path: {}", e))?;

    let script_path = skill_dir.join(&script)
        .canonicalize()
        .map_err(|e| format!("Invalid script path '{}': {}", script, e))?;

    // Path traversal protection: script must be within the skill directory
    if !script_path.starts_with(&skill_dir) {
        return Err("Script path escapes the skill directory".to_string());
    }

    if !script_path.is_file() {
        return Err(format!("Script not found: {}", script));
    }

    // Resolve interpreter
    let (program, mut cmd_args) = resolve_interpreter(&script_path)?;

    // Add the script arguments
    cmd_args.extend(args);

    // Determine working directory
    let work_dir = match working_dir {
        Some(ref dir) => Path::new(dir).to_path_buf(),
        None => dirs::home_dir().unwrap_or_else(|| Path::new("/").to_path_buf()),
    };

    // Clamp timeout: default 30s, max 300s
    let timeout = std::time::Duration::from_millis(
        timeout_ms.unwrap_or(30_000).min(300_000)
    );

    let mut command = tokio::process::Command::new(&program);
    command
        .args(&cmd_args)
        .current_dir(&work_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // Add extra environment variables
    if let Some(extra_env) = env {
        for (k, v) in extra_env {
            command.env(k, v);
        }
    }

    let mut child = command
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to spawn '{}': {}", program, e))?;

    // Read stdout/stderr via separate tasks, wait for exit with timeout
    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();

    let stdout_task = tokio::spawn(async move {
        if let Some(out) = stdout_handle {
            let mut buf = Vec::new();
            use tokio::io::AsyncReadExt;
            let mut reader = out;
            let _ = reader.read_to_end(&mut buf).await;
            String::from_utf8_lossy(&buf).to_string()
        } else {
            String::new()
        }
    });

    let stderr_task = tokio::spawn(async move {
        if let Some(err) = stderr_handle {
            let mut buf = Vec::new();
            use tokio::io::AsyncReadExt;
            let mut reader = err;
            let _ = reader.read_to_end(&mut buf).await;
            String::from_utf8_lossy(&buf).to_string()
        } else {
            String::new()
        }
    });

    match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => {
            let stdout = stdout_task.await.unwrap_or_default();
            let stderr = stderr_task.await.unwrap_or_default();
            Ok(ScriptResult {
                stdout,
                stderr,
                exit_code: status.code().unwrap_or(-1),
                timed_out: false,
            })
        }
        Ok(Err(e)) => Err(format!("Script execution failed: {}", e)),
        Err(_) => {
            // Timeout — kill_on_drop will SIGKILL when child is dropped
            let _ = child.kill().await;
            Ok(ScriptResult {
                stdout: String::new(),
                stderr: format!("Script timed out after {}ms", timeout.as_millis()),
                exit_code: -1,
                timed_out: true,
            })
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

/// Bundled skill file content embedded at compile time.
struct BundledFile {
    relative_path: &'static str,
    content: &'static str,
    executable: bool,
}

/// Write a bundled file to disk. In debug builds, skip files that already exist
/// to allow live-editing bundled skills/agents during development.
fn write_bundled_file(target: &Path, content: &str, executable: bool) -> Result<(), String> {
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
            continue;
        }

        let entries = match fs::read_dir(base_path) {
            Ok(e) => e,
            Err(_) => continue,
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

/// Extract bundled agents to ~/.notesage/agents/.
/// Always overwrites to ensure bundled agents stay up-to-date with app version.
/// Lives alongside user-created agents; the hierarchy system handles overrides.
#[tauri::command]
pub async fn extract_bundled_agents() -> Result<String, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let bundled_dir = home.join(".notesage").join("agents");

    // Clean up legacy bundled-agents directory
    let legacy_dir = home.join(".notesage").join("bundled-agents");
    if legacy_dir.is_dir() {
        let _ = fs::remove_dir_all(&legacy_dir);
    }

    let bundled_files: Vec<BundledFile> = vec![
        BundledFile {
            relative_path: "general-assistant.md",
            content: include_str!("../../../bundled-agents/general-assistant.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "creative-writer.md",
            content: include_str!("../../../bundled-agents/creative-writer.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "technical-editor.md",
            content: include_str!("../../../bundled-agents/technical-editor.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "fact-checker.md",
            content: include_str!("../../../bundled-agents/fact-checker.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "academic-writer.md",
            content: include_str!("../../../bundled-agents/academic-writer.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "copywriter.md",
            content: include_str!("../../../bundled-agents/copywriter.md"),
            executable: false,
        },
        BundledFile {
            relative_path: "proofreader.md",
            content: include_str!("../../../bundled-agents/proofreader.md"),
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

    // Extract bundled agent instructions to ~/.notesage/agents.md
    // Always overwrite to keep in sync with app version (same as bundled agents/skills)
    let agents_md = home.join(".notesage").join("agents.md");
    fs::write(
        &agents_md,
        include_str!("../../../bundled-agents/agents.md"),
    )
    .map_err(|e| format!("Failed to write agents.md: {}", e))?;

    // Clean up legacy bundled-agents.md
    let legacy_instructions = home.join(".notesage").join("bundled-agents.md");
    if legacy_instructions.is_file() {
        let _ = fs::remove_file(&legacy_instructions);
    }

    Ok(bundled_dir.to_string_lossy().to_string())
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

/// Resolve the interpreter for a script.
/// Checks shebang line first, then falls back to file extension.
/// Returns (program, args) where args includes the script path.
fn resolve_interpreter(script_path: &Path) -> Result<(String, Vec<String>), String> {
    let script_str = script_path.to_string_lossy().to_string();

    // Try reading shebang line
    if let Ok(file) = fs::File::open(script_path) {
        let mut reader = std::io::BufReader::new(file);
        let mut first_line = String::new();
        if reader.read_line(&mut first_line).is_ok() && first_line.starts_with("#!") {
            let shebang = first_line[2..].trim();
            // Handle "#!/usr/bin/env python3" style
            if shebang.starts_with("/usr/bin/env ") {
                let interpreter = shebang["/usr/bin/env ".len()..].trim();
                let parts: Vec<&str> = interpreter.splitn(2, ' ').collect();
                let prog = parts[0].to_string();
                let mut args: Vec<String> = if parts.len() > 1 {
                    vec![parts[1].to_string()]
                } else {
                    vec![]
                };
                args.push(script_str);
                return Ok((prog, args));
            }
            // Handle "#!/bin/bash" style
            let parts: Vec<&str> = shebang.splitn(2, ' ').collect();
            let prog = parts[0].to_string();
            let mut args: Vec<String> = if parts.len() > 1 {
                vec![parts[1].to_string()]
            } else {
                vec![]
            };
            args.push(script_str);
            return Ok((prog, args));
        }
    }

    // Fall back to extension-based resolution
    let ext = script_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "sh" => Ok(("bash".to_string(), vec![script_str])),
        "py" => Ok(("python3".to_string(), vec![script_str])),
        "js" => Ok(("node".to_string(), vec![script_str])),
        "ts" => Ok(("npx".to_string(), vec!["tsx".to_string(), script_str])),
        "" => {
            // No extension — try direct execution
            Ok((script_str, vec![]))
        }
        other => Err(format!(
            "Unknown script extension '.{}'. Supported: .sh (bash), .py (python3), .js (node), .ts (npx tsx)",
            other
        )),
    }
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

    // --- execute_skill_script tests ---

    #[test]
    fn execute_script_runs_bash() {
        let tmp = create_temp_dir();
        let scripts_dir = tmp.path().join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(scripts_dir.join("hello.sh"), "#!/bin/bash\necho \"hello world\"").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(execute_skill_script(
            tmp.path().to_string_lossy().to_string(),
            "scripts/hello.sh".to_string(),
            vec![],
            Some(tmp.path().to_string_lossy().to_string()),
            None,
            None,
        ));
        let res = result.unwrap();
        assert_eq!(res.stdout.trim(), "hello world");
        assert_eq!(res.exit_code, 0);
        assert!(!res.timed_out);
    }

    #[test]
    fn execute_script_captures_args() {
        let tmp = create_temp_dir();
        let scripts_dir = tmp.path().join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(scripts_dir.join("echo_args.sh"), "#!/bin/bash\necho \"$1 $2\"").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(execute_skill_script(
            tmp.path().to_string_lossy().to_string(),
            "scripts/echo_args.sh".to_string(),
            vec!["foo".to_string(), "bar".to_string()],
            Some(tmp.path().to_string_lossy().to_string()),
            None,
            None,
        ));
        let res = result.unwrap();
        assert_eq!(res.stdout.trim(), "foo bar");
    }

    #[test]
    fn execute_script_captures_stderr() {
        let tmp = create_temp_dir();
        let scripts_dir = tmp.path().join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(scripts_dir.join("err.sh"), "#!/bin/bash\necho \"oops\" >&2\nexit 1").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(execute_skill_script(
            tmp.path().to_string_lossy().to_string(),
            "scripts/err.sh".to_string(),
            vec![],
            Some(tmp.path().to_string_lossy().to_string()),
            None,
            None,
        ));
        let res = result.unwrap();
        assert_eq!(res.stderr.trim(), "oops");
        assert_eq!(res.exit_code, 1);
    }

    #[test]
    fn execute_script_rejects_path_traversal() {
        let tmp = create_temp_dir();
        let scripts_dir = tmp.path().join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(scripts_dir.join("ok.sh"), "echo ok").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(execute_skill_script(
            tmp.path().to_string_lossy().to_string(),
            "../../../etc/passwd".to_string(),
            vec![],
            None,
            None,
            None,
        ));
        assert!(result.is_err());
    }

    #[test]
    fn execute_script_timeout() {
        let tmp = create_temp_dir();
        let scripts_dir = tmp.path().join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(scripts_dir.join("slow.sh"), "#!/bin/bash\nsleep 60").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(execute_skill_script(
            tmp.path().to_string_lossy().to_string(),
            "scripts/slow.sh".to_string(),
            vec![],
            Some(tmp.path().to_string_lossy().to_string()),
            None,
            Some(500), // 500ms timeout
        ));
        let res = result.unwrap();
        assert!(res.timed_out);
        assert_eq!(res.exit_code, -1);
    }

    #[test]
    fn execute_script_with_env_vars() {
        let tmp = create_temp_dir();
        let scripts_dir = tmp.path().join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(scripts_dir.join("env.sh"), "#!/bin/bash\necho $MY_VAR").unwrap();

        let mut env = HashMap::new();
        env.insert("MY_VAR".to_string(), "custom_value".to_string());

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(execute_skill_script(
            tmp.path().to_string_lossy().to_string(),
            "scripts/env.sh".to_string(),
            vec![],
            Some(tmp.path().to_string_lossy().to_string()),
            Some(env),
            None,
        ));
        let res = result.unwrap();
        assert_eq!(res.stdout.trim(), "custom_value");
    }

    // --- resolve_interpreter tests ---

    #[test]
    fn resolve_interpreter_by_extension() {
        let tmp = create_temp_dir();

        let sh = tmp.path().join("test.sh");
        fs::write(&sh, "echo hi").unwrap();
        let (prog, args) = resolve_interpreter(&sh).unwrap();
        assert_eq!(prog, "bash");
        assert_eq!(args.len(), 1);

        let py = tmp.path().join("test.py");
        fs::write(&py, "print('hi')").unwrap();
        let (prog, _) = resolve_interpreter(&py).unwrap();
        assert_eq!(prog, "python3");

        let js = tmp.path().join("test.js");
        fs::write(&js, "console.log('hi')").unwrap();
        let (prog, _) = resolve_interpreter(&js).unwrap();
        assert_eq!(prog, "node");

        let ts = tmp.path().join("test.ts");
        fs::write(&ts, "console.log('hi')").unwrap();
        let (prog, args) = resolve_interpreter(&ts).unwrap();
        assert_eq!(prog, "npx");
        assert_eq!(args[0], "tsx");
    }

    #[test]
    fn resolve_interpreter_by_shebang() {
        let tmp = create_temp_dir();
        let script = tmp.path().join("run");
        fs::write(&script, "#!/usr/bin/env python3\nprint('hi')").unwrap();
        let (prog, args) = resolve_interpreter(&script).unwrap();
        assert_eq!(prog, "python3");
        assert!(args.last().unwrap().contains("run"));
    }

    #[test]
    fn resolve_interpreter_shebang_direct_path() {
        let tmp = create_temp_dir();
        let script = tmp.path().join("run");
        fs::write(&script, "#!/bin/bash\necho hi").unwrap();
        let (prog, args) = resolve_interpreter(&script).unwrap();
        assert_eq!(prog, "/bin/bash");
        assert!(args.last().unwrap().contains("run"));
    }

    #[test]
    fn resolve_interpreter_unknown_extension() {
        let tmp = create_temp_dir();
        let script = tmp.path().join("test.rb");
        fs::write(&script, "puts 'hi'").unwrap();
        let result = resolve_interpreter(&script);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains(".rb"));
    }

    #[test]
    fn resolve_interpreter_no_extension_direct_exec() {
        let tmp = create_temp_dir();
        let script = tmp.path().join("myscript");
        fs::write(&script, "no shebang, no extension").unwrap();
        let (prog, args) = resolve_interpreter(&script).unwrap();
        assert!(prog.contains("myscript"));
        assert!(args.is_empty());
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
}
