//! Resolve the user's login shell PATH for subprocess spawning.
//!
//! macOS GUI apps launched from Finder/Dock inherit a minimal PATH
//! (`/usr/bin:/bin:/usr/sbin:/sbin`) that does not include user-installed
//! directories like `/opt/homebrew/bin`, `~/.local/bin`, nvm paths, etc.
//!
//! This module provides a cached login-shell PATH that can be injected
//! into child processes so they (and their `which` lookups) see the
//! same binaries the user has in their terminal.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// Cached result of the login-shell PATH resolution, as far as it was known
/// when the first caller stopped waiting (`None`: failed, or not ready yet).
static SHELL_PATH: OnceLock<Option<String>> = OnceLock::new();

/// The PATH from a shell that answered only after the first caller had given
/// up waiting. Later callers pick it up from here.
static LATE_SHELL_PATH: OnceLock<String> = OnceLock::new();

/// How long a caller waits for the shell. Every subprocess spawn in the app
/// (ACP agents, MCP servers, Copilot, llama-server) goes through
/// `get_shell_path`, mostly from async workers, and concurrent callers queue
/// on the `OnceLock` — so a stuck rc file (an update prompt, a network-mounted
/// home, a slow nvm/conda init) used to hang every spawn in the app.
const CALLER_WAIT: Duration = Duration::from_secs(5);

/// How long the shell itself may keep running before it is killed. Longer than
/// `CALLER_WAIT` so a shell that is merely slow still delivers its PATH (to
/// `LATE_SHELL_PATH`) for the spawns that come after.
const SHELL_HARD_LIMIT: Duration = Duration::from_secs(60);

/// Get the user's login shell PATH by running `$SHELL -il -c 'echo $PATH'`.
/// The result is cached after the first call. Returns `None` if resolution
/// fails or has not finished within `CALLER_WAIT` (callers then fall back to
/// the process's inherited PATH).
pub fn get_shell_path() -> Option<&'static str> {
    let in_time = SHELL_PATH.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        resolve_login_shell_path(&shell, "echo $PATH", CALLER_WAIT, SHELL_HARD_LIMIT, |path| {
            let _ = LATE_SHELL_PATH.set(path);
        })
    });
    in_time
        .as_deref()
        .or_else(|| LATE_SHELL_PATH.get().map(String::as_str))
}

/// Run `<shell> -il -c <command>` and return its trimmed stdout, waiting at
/// most `caller_wait`.
///
/// The shell runs on its own thread and is killed after `hard_limit`. If it
/// produces a PATH at all, `on_resolved` is called with it — also when the
/// caller has already stopped waiting, which is how a slow shell's answer
/// still reaches later callers.
fn resolve_login_shell_path(
    shell: &str,
    command: &str,
    caller_wait: Duration,
    hard_limit: Duration,
    on_resolved: impl FnOnce(String) + Send + 'static,
) -> Option<String> {
    let mut child = Command::new(shell)
        .args(["-il", "-c", command])
        // An interactive shell must not be able to wait on our stdin.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;

    // Reader thread: `read_to_end` only returns when every holder of the pipe
    // has closed it, which a process backgrounded by an rc file can delay
    // indefinitely — so it must not be the thread that enforces the limit.
    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = out_tx.send(buf);
    });

    let (result_tx, result_rx) = mpsc::channel::<Option<String>>();
    std::thread::spawn(move || {
        let deadline = Instant::now() + hard_limit;
        let output = out_rx.recv_timeout(hard_limit).ok();
        // The shell may have closed stdout and still be running.
        let mut succeeded = false;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    succeeded = status.success();
                    break;
                }
                Ok(None) if Instant::now() < deadline && output.is_some() => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
            }
        }
        let path = output
            .filter(|_| succeeded)
            .map(|bytes| String::from_utf8_lossy(&bytes).trim().to_string())
            .filter(|path| !path.is_empty());
        if let Some(path) = path.clone() {
            on_resolved(path);
        }
        let _ = result_tx.send(path);
    });

    match result_rx.recv_timeout(caller_wait) {
        Ok(path) => path,
        Err(_) => {
            log::warn!(
                target: "notesage::shell_path",
                "Login shell '{}' did not report PATH within {:?}; using the inherited PATH for now",
                shell,
                caller_wait
            );
            None
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    const GENEROUS: Duration = Duration::from_secs(20);

    #[test]
    fn returns_what_the_shell_prints() {
        let path = resolve_login_shell_path("/bin/sh", "echo /fake/bin:/usr/bin", GENEROUS, GENEROUS, |_| {});
        // `ends_with`: a profile on the test machine may print something first.
        assert!(path.as_deref().is_some_and(|p| p.ends_with("/fake/bin:/usr/bin")), "{path:?}");
    }

    #[test]
    fn a_stuck_shell_does_not_block_the_caller() {
        // The rc-file-waiting-forever case. `.output()` with no timeout sat
        // here for the full 30s (and, in the app, for ever).
        let started = Instant::now();
        let path = resolve_login_shell_path(
            "/bin/sh",
            "sleep 30; echo /never",
            Duration::from_millis(200),
            Duration::from_millis(400),
            |_| panic!("a killed shell has no PATH to report"),
        );
        assert_eq!(path, None);
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "the caller waited {:?} for a stuck shell",
            started.elapsed()
        );
    }

    #[test]
    fn a_slow_shell_still_delivers_its_path_to_later_callers() {
        let (late_tx, late_rx) = mpsc::channel();
        let path = resolve_login_shell_path(
            "/bin/sh",
            "sleep 1; echo /late/bin",
            Duration::from_millis(100),
            GENEROUS,
            move |path| {
                let _ = late_tx.send(path);
            },
        );
        assert_eq!(path, None, "the first caller falls back to the inherited PATH");
        let late = late_rx.recv_timeout(GENEROUS).expect("the slow shell's PATH arrives");
        assert!(late.ends_with("/late/bin"), "{late}");
    }

    #[test]
    fn a_failing_or_missing_shell_yields_none() {
        assert_eq!(
            resolve_login_shell_path("/bin/sh", "exit 3", GENEROUS, GENEROUS, |_| {}),
            None
        );
        assert_eq!(
            resolve_login_shell_path("/nonexistent/shell", "echo x", GENEROUS, GENEROUS, |_| {}),
            None
        );
    }
}
