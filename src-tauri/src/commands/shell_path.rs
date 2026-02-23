//! Resolve the user's login shell PATH for subprocess spawning.
//!
//! macOS GUI apps launched from Finder/Dock inherit a minimal PATH
//! (`/usr/bin:/bin:/usr/sbin:/sbin`) that does not include user-installed
//! directories like `/opt/homebrew/bin`, `~/.local/bin`, nvm paths, etc.
//!
//! This module provides a cached login-shell PATH that can be injected
//! into child processes so they (and their `which` lookups) see the
//! same binaries the user has in their terminal.

use std::process::Command;
use std::sync::OnceLock;

/// Cached result of the login-shell PATH resolution.
static SHELL_PATH: OnceLock<Option<String>> = OnceLock::new();

/// Get the user's login shell PATH by running `$SHELL -l -c 'echo $PATH'`.
/// The result is cached after the first call. Returns `None` if resolution
/// fails (falls back to the process's inherited PATH).
pub fn get_shell_path() -> Option<&'static str> {
    SHELL_PATH
        .get_or_init(|| {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
            let output = Command::new(&shell)
                .args(["-l", "-c", "echo $PATH"])
                .output()
                .ok()?;

            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if path.is_empty() {
                    None
                } else {
                    Some(path)
                }
            } else {
                None
            }
        })
        .as_deref()
}
