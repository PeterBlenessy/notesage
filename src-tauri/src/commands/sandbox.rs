use std::path::{Path, PathBuf};

/// Generate a macOS Seatbelt (.sb) sandbox profile for an agent process.
///
/// The profile:
/// - Allows reading all files (agents need system libraries, binaries, configs)
/// - Allows writing only to the specified paths and /tmp
/// - Denies reading sensitive directories (~/.ssh, ~/.aws, ~/.gnupg, .env files)
/// - Denies writing to .git/ directories (read-only access)
/// - Allows all network access (Phase 2 adds proxy-based filtering)
/// - Allows process execution (agents spawn git, grep, etc.)
#[cfg(target_os = "macos")]
pub fn generate_seatbelt_profile(writable_paths: &[String]) -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;

    let profiles_dir = home.join(".notesage/sandbox/profiles");
    std::fs::create_dir_all(&profiles_dir)
        .map_err(|e| format!("Failed to create sandbox profiles dir: {}", e))?;

    // Hash all paths together for the profile filename
    let path_hash = {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        for p in writable_paths {
            p.hash(&mut hasher);
        }
        format!("{:x}", hasher.finish())
    };
    let profile_path = profiles_dir.join(format!("agent-{}.sb", &path_hash[..8]));

    let home_str = home.to_string_lossy();

    // Build writable subpath entries
    let writable_entries: Vec<String> = writable_paths
        .iter()
        .map(|p| format!("  (subpath \"{}\")", p))
        .collect();
    let writable_block = if writable_entries.is_empty() {
        String::new()
    } else {
        writable_entries.join("\n")
    };

    let profile = format!(
        r#"(version 1)
(deny default)

;; Allow reading system files (agents need binaries, libraries, configs)
(allow file-read*)

;; Allow writing to specified directories, temp, and agent config dirs
(allow file-write*
{writable_block}
  (subpath "/tmp")
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (subpath "{home}/.gemini")
  (subpath "{home}/.claude")
  (subpath "{home}/.codex")
  (subpath "{home}/.copilot")
  (subpath "{home}/.notesage")
  (subpath "{home}/.config"))

;; DENY reading sensitive directories (non-configurable)
(deny file-read*
  (subpath "{home}/.ssh")
  (subpath "{home}/.aws")
  (subpath "{home}/.gnupg")
  (subpath "{home}/.config/gcloud")
  (regex #"\.env$")
  (regex #"\.env\..*$"))

;; Protect .git internals from writes (read-only access)
(deny file-write*
  (regex #".*\/\.git($|\/.*)"))

;; Allow network (Phase 1 — unrestricted; Phase 2 adds proxy filtering)
(allow network*)

;; Allow process execution (agents spawn git, grep, etc.)
(allow process-exec*)
(allow process-fork)

;; Allow standard IPC and system info
(allow sysctl-read)
(allow mach-lookup)
(allow signal)
(allow ipc-posix-shm*)
"#,
        writable_block = writable_block,
        home = home_str,
    );

    std::fs::write(&profile_path, &profile)
        .map_err(|e| format!("Failed to write sandbox profile: {}", e))?;

    Ok(profile_path)
}

/// Build the command and args for a sandboxed agent spawn on macOS.
/// Returns (program, prefix_args) that should be prepended to the actual agent command.
#[cfg(target_os = "macos")]
pub fn sandboxed_command(
    writable_paths: &[String],
) -> Result<(String, Vec<String>), String> {
    let profile_path = generate_seatbelt_profile(writable_paths)?;
    Ok((
        "sandbox-exec".to_string(),
        vec![
            "-f".to_string(),
            profile_path.to_string_lossy().to_string(),
        ],
    ))
}

/// Determine if sandbox should be enabled by default based on binary source.
/// Managed installs (downloaded by Notesage) are sandboxed by default.
/// System installs (user's own) are not sandboxed by default.
pub fn should_sandbox_by_default(binary_path: &str) -> bool {
    let managed_dir = dirs::home_dir()
        .unwrap_or_default()
        .join(".notesage/agents/bin");
    Path::new(binary_path).starts_with(&managed_dir)
}

/// Linux sandbox support via bubblewrap
#[cfg(target_os = "linux")]
pub fn sandboxed_command(
    writable_paths: &[String],
) -> Result<(String, Vec<String>), String> {
    let bwrap = std::process::Command::new("which")
        .arg("bwrap")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    if bwrap.is_none() {
        return Err("bubblewrap (bwrap) not found — install it for sandbox support".to_string());
    }

    let mut args = vec![
        "--ro-bind".to_string(), "/usr".to_string(), "/usr".to_string(),
        "--ro-bind".to_string(), "/lib".to_string(), "/lib".to_string(),
        "--ro-bind".to_string(), "/lib64".to_string(), "/lib64".to_string(),
        "--ro-bind".to_string(), "/bin".to_string(), "/bin".to_string(),
        "--ro-bind".to_string(), "/etc/resolv.conf".to_string(), "/etc/resolv.conf".to_string(),
    ];
    for path in writable_paths {
        args.extend(["--bind".to_string(), path.clone(), path.clone()]);
    }
    args.extend([
        "--bind".to_string(), "/tmp".to_string(), "/tmp".to_string(),
        "--dev".to_string(), "/dev".to_string(),
        "--proc".to_string(), "/proc".to_string(),
        "--".to_string(),
    ]);

    Ok(("bwrap".to_string(), args))
}
