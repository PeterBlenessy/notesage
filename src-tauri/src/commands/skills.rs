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
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (None, content.to_string());
    }

    // Find the closing ---
    let after_first = &trimmed[3..];
    if let Some(end_idx) = after_first.find("\n---") {
        let yaml_str = &after_first[..end_idx];
        let body_start = end_idx + 4; // skip \n---
        let body = after_first[body_start..].trim_start_matches('\n').to_string();

        match serde_yaml::from_str::<SkillFrontmatter>(yaml_str) {
            Ok(fm) => (Some(fm), body),
            Err(_) => (None, content.to_string()),
        }
    } else {
        (None, content.to_string())
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
fn determine_source(base_dir: &str) -> String {
    if base_dir.contains("bundled-skills") || base_dir.contains("bundled_skills") {
        "bundled".to_string()
    } else if base_dir.contains(".notesage/skills") {
        // Distinguish project vs global by checking if it's under home directory directly
        if base_dir.contains("/.notesage/skills") && !base_dir.starts_with('.') {
            // Could be either — check if it's the global one (under home dir)
            if let Some(home) = dirs::home_dir() {
                let global_path = home.join(".notesage").join("skills");
                if base_dir == global_path.to_string_lossy() {
                    return "notesage-global".to_string();
                }
            }
            "notesage-project".to_string()
        } else {
            "notesage-project".to_string()
        }
    } else if base_dir.contains("/.claude/skills") {
        "claude".to_string()
    } else if base_dir.contains("/.codex/skills") {
        "codex".to_string()
    } else if base_dir.contains("/.gemini/skills") {
        "gemini".to_string()
    } else if base_dir.contains("/.agents/skills") {
        "agents".to_string()
    } else {
        "external".to_string()
    }
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
