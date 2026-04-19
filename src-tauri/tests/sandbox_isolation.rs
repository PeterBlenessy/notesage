//! Kernel-level sandbox verification harness.
//!
//! This crate's frontend-level tests assert the *shape* of calls we make into
//! Rust (e.g. "`acp_agent_spawn` received these writable paths"). That proves
//! wiring, not enforcement. The kernel may still let the agent write wherever
//! it wants if the Seatbelt profile is wrong.
//!
//! This harness drives the **same** [`sandbox::generate_seatbelt_profile`]
//! code path that [`acp_agent_spawn`] uses in production and then runs
//! arbitrary bash commands under that profile. A successful write outside
//! the configured scope is a real leak; a Seatbelt denial (EPERM) is real
//! enforcement.
//!
//! ## Running
//!
//! ```bash
//! cd src-tauri && cargo test --test sandbox_isolation -- --ignored
//! ```
//!
//! macOS only — the entire file is compiled out on other platforms. CI is
//! Linux, so this harness is intentionally local-only (`#[ignore]`). See
//! `tests/README.md` for the red-team TDD recipe new attack tests follow.
//!
//! ## Authoring attack tests
//!
//! Each Track 1 leak gets at least one test here that follows the four-step
//! red-team TDD loop in the tasks file: red → flip → green → regression
//! lock. Helpers below are the only primitives needed:
//!
//! * [`spawn_test_acp_agent_with_sandbox`] — builds the profile with the
//!   exact `writable_paths` vector the production caller would pass.
//! * [`run_bash`] — runs `/bin/bash -c <cmd>` under `sandbox-exec -f <profile>`
//!   and returns a [`BashResult`] carrying exit status, stdout, stderr, and
//!   the child PID (needed for [`observe_sandbox_denials`]).
//! * [`observe_sandbox_denials`] — tails `log show` for Seatbelt deny entries
//!   tagged with the bash child's PID.
//!
//! A write that succeeds is a leak. A write that fails *and* leaves the
//! target nonexistent *and* surfaces a `deny file-write` entry in the log is
//! kernel-enforced isolation.

#![cfg(target_os = "macos")]

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri_app_lib::{sandbox, sandbox_monitor};

// ---------------------------------------------------------------------------
// TestAgent: a scoped Seatbelt profile with cleanup on drop
// ---------------------------------------------------------------------------

/// Handle to a generated Seatbelt profile. Drop cleans up the temp profile
/// file so repeated test runs don't accumulate `/tmp/notesage-sandbox-*.sb`.
pub struct TestAgent {
    pub instance_id: String,
    pub writable_paths: Vec<String>,
    pub profile_path: PathBuf,
    /// PIDs of bash processes launched via `run_bash`. Used by
    /// `observe_sandbox_denials` to filter log entries to this agent.
    pub child_pids: Mutex<Vec<u32>>,
    /// Unix timestamp (seconds) captured at spawn. `log show --last` window
    /// is measured from this moment so observed denials belong to this run.
    pub spawned_at: u64,
}

impl Drop for TestAgent {
    fn drop(&mut self) {
        sandbox::cleanup_profile(&self.instance_id);
    }
}

/// Generate a Seatbelt profile for a test agent via the production path.
///
/// `writable_paths` are passed verbatim to
/// [`sandbox::generate_seatbelt_profile`] — this is the knob an attack test
/// exercises to simulate the production scope (narrow after Track 1, wide
/// today). Network config is `None`: the filesystem invariants this harness
/// is built for are independent of the network sandbox layer.
pub fn spawn_test_acp_agent_with_sandbox(writable_paths: &[&str]) -> TestAgent {
    let instance_id = format!("notesage-test-{}", uuid::Uuid::new_v4());
    let writable: Vec<String> = writable_paths.iter().map(|p| (*p).to_string()).collect();
    let profile_path = sandbox::generate_seatbelt_profile(&instance_id, &writable, None, false)
        .expect("failed to generate Seatbelt profile");
    let spawned_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    TestAgent {
        instance_id,
        writable_paths: writable,
        profile_path,
        child_pids: Mutex::new(Vec::new()),
        spawned_at,
    }
}

// ---------------------------------------------------------------------------
// run_bash: execute a shell command under the agent's sandbox profile
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct BashResult {
    pub pid: u32,
    pub status_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl BashResult {
    pub fn is_success(&self) -> bool {
        self.status_code == Some(0)
    }

    /// Heuristic: Seatbelt file-write denials surface as EPERM
    /// ("Operation not permitted" / "Permission denied") in bash's stderr.
    /// Network denials surface as connection failures. This check is the
    /// primary signal attack tests assert on; it's cheap and synchronous.
    pub fn looks_sandbox_denied(&self) -> bool {
        let s = &self.stderr;
        s.contains("Operation not permitted")
            || s.contains("Permission denied")
            || s.contains("sandbox-exec:")
    }
}

#[derive(Debug)]
pub enum RunError {
    /// `sandbox-exec` failed to spawn (missing binary, bad profile, etc.).
    /// Distinct from a normal non-zero exit.
    Spawn(io::Error),
}

/// Run `/bin/bash -c <command>` wrapped in `sandbox-exec -f <profile>`.
///
/// The child PID is recorded on `agent.child_pids` so
/// [`observe_sandbox_denials`] can scope log queries to this run. Stdout and
/// stderr are captured. The caller decides whether a given exit code is a
/// denial vs a legitimate failure — see [`BashResult::looks_sandbox_denied`].
pub fn run_bash(agent: &TestAgent, command: &str) -> Result<BashResult, RunError> {
    let child = Command::new("sandbox-exec")
        .arg("-f")
        .arg(&agent.profile_path)
        .arg("/bin/bash")
        .arg("-c")
        .arg(command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(RunError::Spawn)?;

    let pid = child.id();
    if let Ok(mut pids) = agent.child_pids.lock() {
        pids.push(pid);
    }

    let output = child.wait_with_output().map_err(RunError::Spawn)?;
    Ok(BashResult {
        pid,
        status_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

// ---------------------------------------------------------------------------
// observe_sandbox_denials: retrospective log show query
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct DenialEntry {
    pub pid: u32,
    pub operation: String,
    pub resource: String,
    pub timestamp: String,
    pub raw_message: String,
}

/// Query the macOS unified log for Seatbelt denials attributable to this
/// agent's bash children. Uses `log show --last <N>s` retrospectively —
/// simpler than streaming and adequate for synchronous tests.
///
/// This complements `BashResult::looks_sandbox_denied`: stderr tells you
/// *something* was denied; the log entry tells you *which operation* and
/// *which resource*. Use when a test needs to distinguish
/// `file-write-create /outside-scope/evil.txt` from an unrelated failure.
///
/// Returns an empty vec if `log show` isn't usable on this machine — never
/// panics. Tests that require log evidence should assert `!entries.is_empty()`
/// themselves.
pub fn observe_sandbox_denials(agent: &TestAgent) -> Vec<DenialEntry> {
    let pids: Vec<u32> = match agent.child_pids.lock() {
        Ok(g) => g.clone(),
        Err(_) => return Vec::new(),
    };
    if pids.is_empty() {
        return Vec::new();
    }

    // Window: from spawn time to now, bounded to 5 minutes. `log show` takes
    // a relative `--last` argument (e.g. `60s`).
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(agent.spawned_at);
    let window_secs = now.saturating_sub(agent.spawned_at).saturating_add(2);
    let window_arg = format!("{}s", window_secs.min(300).max(1));

    let output = Command::new("log")
        .args([
            "show",
            "--last",
            &window_arg,
            "--predicate",
            "eventMessage CONTAINS \"Sandbox\" AND eventMessage CONTAINS \"deny\"",
            "--style",
            "ndjson",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();

    let stdout = match output {
        Ok(o) if o.status.success() => o.stdout,
        _ => return Vec::new(),
    };

    let body = String::from_utf8_lossy(&stdout);
    let mut entries = Vec::new();
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('{') {
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let pid = value
            .get("processIdentifier")
            .and_then(|v| v.as_u64())
            .map(|p| p as u32);
        let pid = match pid {
            Some(p) if pids.contains(&p) => p,
            _ => continue,
        };
        let message = value
            .get("eventMessage")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let (operation, resource) = sandbox_monitor::parse_violation_message(&message);
        let timestamp = value
            .get("timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        entries.push(DenialEntry {
            pid,
            operation,
            resource,
            timestamp,
            raw_message: message,
        });
    }
    entries
}

// ---------------------------------------------------------------------------
// Test scratch directory
// ---------------------------------------------------------------------------

/// Create a scratch directory under $HOME that is *outside* every
/// default-writable Seatbelt subpath (not `/tmp`, not `~/.notesage`, not
/// `~/.config`, etc.). Caller-controlled writable paths go under here so the
/// sandbox profile alone determines whether writes succeed.
///
/// `under_user_data: true` puts the scratch root under `~/Documents` — one of
/// the deny-listed user-data areas in the read-isolation profile (#6c). Use
/// this when the test asserts read denial, so paths lie inside the deny
/// boundary. Use `false` (default) for write-isolation tests where the
/// neutral `~/notesage-sandbox-tests/` path is what we want.
///
/// Cleaned up by the returned guard's Drop.
struct ScratchRoot {
    path: PathBuf,
}

impl ScratchRoot {
    fn new() -> Self {
        Self::new_at(false)
    }

    fn new_under_user_data() -> Self {
        Self::new_at(true)
    }

    fn new_at(under_user_data: bool) -> Self {
        let home = dirs::home_dir().expect("HOME must be set for sandbox tests");
        let nonce = uuid::Uuid::new_v4();
        let parent = if under_user_data {
            home.join("Documents/notesage-sandbox-tests")
        } else {
            home.join("notesage-sandbox-tests")
        };
        let path = parent.join(nonce.to_string());
        fs::create_dir_all(&path).expect("create scratch root");
        ScratchRoot { path }
    }

    fn subdir(&self, name: &str) -> PathBuf {
        let p = self.path.join(name);
        fs::create_dir_all(&p).expect("create scratch subdir");
        p
    }
}

impl Drop for ScratchRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
        // Try to prune the empty parent. Ignore errors — concurrent tests
        // may share it.
        if let Some(parent) = self.path.parent() {
            let _ = fs::remove_dir(parent);
        }
    }
}

// ---------------------------------------------------------------------------
// Sentinel test — proves the harness is wired correctly end-to-end.
//
// Setup: agent given `writable_paths = [tmpdir_A]`. Attempt
// `echo test > tmpdir_B/evil.txt`. Assert Seatbelt denies AND the file was
// not created.
//
// This test passes today because the profile generator correctly denies
// writes outside the configured scope. It is the regression lock for leak #1
// at the sandbox-primitive layer: if the profile generator ever starts
// leaking writes to paths outside `writable_paths`, this fails.
//
// A separate integration test in task #4 covers the *production* behavior
// (frontend unconditionally passes every workspace path instead of the
// selected subset). That test is authored in the red-team TDD style — it
// will initially assert the current (insecure) shape, flip to deny-expected
// after the fix lands, and stay in the suite forever.
// ---------------------------------------------------------------------------

#[test]
#[ignore = "requires macOS Seatbelt; run with `cargo test -- --ignored sandbox`"]
fn sandbox_sentinel_denies_writes_outside_writable_paths() {
    let scratch = ScratchRoot::new();
    let project_a = scratch.subdir("project-a");
    let project_b = scratch.subdir("project-b");

    let agent = spawn_test_acp_agent_with_sandbox(&[&project_a.to_string_lossy()]);

    // Sanity: writes inside the configured scope succeed.
    let inside = project_a.join("ok.txt");
    let result = run_bash(
        &agent,
        &format!("echo inside > {}", shell_escape(&inside)),
    )
    .expect("bash should spawn");
    assert!(
        result.is_success(),
        "write inside writable_paths must succeed, got status={:?} stderr={}",
        result.status_code,
        result.stderr,
    );
    assert!(inside.exists(), "in-scope file must exist after write");

    // The invariant. Writing outside scope must be kernel-denied.
    let evil = project_b.join("evil.txt");
    let result = run_bash(
        &agent,
        &format!("echo pwnd > {}", shell_escape(&evil)),
    )
    .expect("bash should spawn");

    assert!(
        !result.is_success(),
        "write to out-of-scope path must fail; bash succeeded with status={:?}, leak reproduced",
        result.status_code,
    );
    assert!(
        result.looks_sandbox_denied(),
        "stderr must indicate a sandbox denial (EPERM). stderr={}",
        result.stderr,
    );
    assert!(
        !evil.exists(),
        "denied write must not have created the file at {}",
        evil.display(),
    );

    // Supplementary: the unified log should carry a matching deny entry for
    // this bash PID. This is best-effort — some sandboxed CI-ish environments
    // disable the log stream, so we don't fail the test on an empty vec, but
    // we DO fail if entries exist and none mention file-write.
    let denials = observe_sandbox_denials(&agent);
    if !denials.is_empty() {
        assert!(
            denials.iter().any(|d| d.operation.contains("file-write")),
            "unified log produced sandbox deny entries but none were file-write: {:?}",
            denials,
        );
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Minimal shell quoting for absolute paths produced by tempdir/scratch. The
/// scratch root path is a uuid-under-HOME, so it contains only safe
/// characters — single-quoting is sufficient and removes any ambiguity.
fn shell_escape(p: &Path) -> String {
    format!("'{}'", p.display())
}

// ---------------------------------------------------------------------------
// Leak #6c — kernel-level read denial for out-of-scope paths
//
// The leak: the Seatbelt profile uses `(allow file-read*)`, so the kernel
// imposes no read restriction. With Project A as the only writable path, the
// agent could still read every other file in the user's home (other projects,
// iCloud Drive, ~/Documents, etc.). Frontend filters can't catch this for
// agents that handle reads internally (Claude Code uses fs.readFile inside
// its own subprocess — no ACP `tool_call` event ever reaches the client).
//
// Manual repro on 2026-04-19:
//   Project selected: ~/Library/Mobile Documents/.../Private Notes
//   Asked Claude Code: "read ~/Library/Mobile Documents/.../AI adoption/foo.md"
//   Result: file content returned. No permission prompt, no error.
//
// Invariant (post-fix):
//   With writable_paths = [project_a], the agent CANNOT read a file at
//   project_b (a sibling user-data path under $HOME) — `cat` returns EACCES.
//
// System paths (/usr, /bin, /Library outside Mobile Documents, etc.) MUST
// stay readable, otherwise agents can't find their dependencies.
// ---------------------------------------------------------------------------

#[test]
#[ignore = "requires macOS Seatbelt; run with `cargo test -- --ignored sandbox`"]
fn leak_6c_kernel_denies_reads_outside_writable_paths() {
    // Scratch under ~/Documents — one of the deny-listed user-data areas in
    // the #6c read-isolation profile. Project-A is in writable_paths
    // (re-allowed); project-B is denied because it sits in the same denied
    // area but was not selected.
    let scratch = ScratchRoot::new_under_user_data();
    let project_a = scratch.subdir("project-a");
    let project_b = scratch.subdir("project-b");

    // Seed a file in project_b that the agent should NOT be able to read.
    let target = project_b.join("secrets.txt");
    fs::write(&target, "do-not-read-me").expect("seed out-of-scope file");

    // Sanity: also seed a file in project_a — the in-scope read must succeed.
    let allowed = project_a.join("ok.txt");
    fs::write(&allowed, "in-scope content").expect("seed in-scope file");

    let agent = spawn_test_acp_agent_with_sandbox(&[&project_a.to_string_lossy()]);

    // In-scope read MUST succeed.
    let result = run_bash(&agent, &format!("cat {}", shell_escape(&allowed)))
        .expect("bash should spawn");
    assert!(
        result.is_success(),
        "in-scope read must succeed, got status={:?} stderr={}",
        result.status_code,
        result.stderr,
    );
    assert!(
        result.stdout.contains("in-scope content"),
        "stdout should contain the file content; got {:?}",
        result.stdout,
    );

    // The invariant. Out-of-scope read MUST be kernel-denied.
    let result = run_bash(&agent, &format!("cat {}", shell_escape(&target)))
        .expect("bash should spawn");
    assert!(
        !result.is_success(),
        "out-of-scope read must fail; cat succeeded with status={:?}, stdout={:?}, leak reproduced",
        result.status_code,
        result.stdout,
    );
    assert!(
        result.looks_sandbox_denied(),
        "stderr must indicate a sandbox denial (EACCES). stderr={}",
        result.stderr,
    );
    assert!(
        !result.stdout.contains("do-not-read-me"),
        "denied read must NOT have returned the file content; stdout={:?}",
        result.stdout,
    );

    // System paths MUST stay readable — agents need binaries and libraries.
    // /usr/bin/true exists on every macOS install.
    let result = run_bash(&agent, "cat /usr/bin/true > /dev/null && echo ok")
        .expect("bash should spawn");
    assert!(
        result.is_success(),
        "system path read must still work for agents to find dependencies; stderr={}",
        result.stderr,
    );
    assert!(
        result.stdout.trim() == "ok",
        "system read should print 'ok'; got {:?}",
        result.stdout,
    );
}
