//! Process identity verification + termination helpers shared by every code
//! path that signals a PID it did not just spawn (orphan cleanup from PID
//! files at startup, health-check teardown).
//!
//! Rationale (audit batch 3, fixes #3/#4/#9): a PID read from a stale
//! `.pid` file may have been reused by an unrelated process after a crash or
//! reboot — signalling it blindly can kill an innocent bystander. Before
//! sending a signal to a recovered PID, verify the process's command line
//! still looks like the process we recorded. We inspect `ps -o command=`
//! (full argv) rather than `comm=` because npm-distributed agents run under a
//! `node` interpreter (comm would be `node`, not the agent name) and Linux
//! truncates `comm` to 15 bytes; the argv reliably contains the binary path
//! we recorded at spawn time.

use std::time::Duration;

/// Full command line (`ps -o command=`) for a PID, or `None` when the process
/// does not exist or `ps` fails. Works on macOS and Linux; on other platforms
/// returns `None` (callers then skip the kill — fail safe).
pub fn process_cmdline(pid: u32) -> Option<String> {
    let output = std::process::Command::new("ps")
        .args(["-o", "command=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let cmdline = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if cmdline.is_empty() {
        None
    } else {
        Some(cmdline)
    }
}

/// Pure decision: should we signal a recovered PID, given the `ps` output for
/// it and the identity we recorded when the process was spawned?
///
/// Deny by default: no `ps` output (process gone, `ps` unavailable, or any
/// error) means "do not kill". Only a command line that contains the expected
/// needle verifies identity — a reused PID belonging to an unrelated process
/// will not match the recorded binary path/name.
pub fn should_signal_pid(ps_cmdline: Option<&str>, expected_needle: &str) -> bool {
    if expected_needle.trim().is_empty() {
        return false;
    }
    match ps_cmdline {
        Some(cmdline) => cmdline.contains(expected_needle),
        None => false,
    }
}

/// True when a process with this PID currently exists (signal 0 probe).
pub fn process_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// SIGTERM → short bounded wait → SIGKILL if still alive.
///
/// This is the escalation `LocalInferenceState::stop_sync` always implemented,
/// extracted so health-check teardown paths get the same guarantee (audit
/// batch 3 fix #4). Blocking (sleeps up to ~500ms in 100ms steps); returns as
/// soon as the process is observed dead, so the common case pays one poll.
pub fn terminate_with_escalation(pid: u32) {
    let _ = std::process::Command::new("kill")
        .args(["-15", &pid.to_string()])
        .output();
    for _ in 0..5 {
        std::thread::sleep(Duration::from_millis(100));
        if !process_alive(pid) {
            return;
        }
    }
    let _ = std::process::Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_signal_requires_ps_output() {
        // No ps output (process gone / ps failed) → never signal.
        assert!(!should_signal_pid(None, "llama-server"));
    }

    #[test]
    fn should_signal_matches_binary_in_cmdline() {
        // llama-server started by us: argv[0] is the resolved binary path.
        assert!(should_signal_pid(
            Some("/Users/x/.notesage/binaries/llama-server --model foo.gguf --port 8090"),
            "llama-server"
        ));
        // npm-distributed ACP agent runs under node; the recorded binary path
        // appears in the argv even though comm would just be `node`.
        assert!(should_signal_pid(
            Some("node /Users/x/.notesage/agents/bin/claude-agent-acp"),
            "/Users/x/.notesage/agents/bin/claude-agent-acp"
        ));
    }

    #[test]
    fn should_signal_rejects_unrelated_process() {
        // PID reuse: same PID now belongs to something else entirely.
        assert!(!should_signal_pid(Some("/usr/bin/vim notes.md"), "llama-server"));
        assert!(!should_signal_pid(
            Some("/Applications/Ollama.app/Contents/MacOS/ollama serve"),
            "/Users/x/.notesage/agents/bin/codex-acp"
        ));
    }

    #[test]
    fn should_signal_rejects_empty_inputs() {
        assert!(!should_signal_pid(Some(""), "llama-server"));
        assert!(!should_signal_pid(Some("/usr/bin/anything"), ""));
        assert!(!should_signal_pid(Some("/usr/bin/anything"), "   "));
    }
}
