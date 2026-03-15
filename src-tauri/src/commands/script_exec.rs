use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::BufRead;
use std::path::Path;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ScriptResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
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
    use std::collections::HashMap;
    use std::fs;

    fn create_temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("Failed to create temp dir")
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
}
