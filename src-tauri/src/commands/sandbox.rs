use std::path::{Path, PathBuf};

/// Generate a macOS Seatbelt (.sb) sandbox profile for an agent process.
///
/// The profile:
/// - Allows reading all files (agents need system libraries, binaries, configs)
/// - Allows writing only to the project directory and /tmp
/// - Denies reading sensitive directories (~/.ssh, ~/.aws, ~/.gnupg, .env files)
/// - Denies writing to .git/ directories (read-only access)
/// - Allows all network access (Phase 2 adds proxy-based filtering)
/// - Allows process execution (agents spawn git, grep, etc.)
#[cfg(target_os = "macos")]
pub fn generate_seatbelt_profile(working_directory: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;

    let profiles_dir = home.join(".notesage/sandbox/profiles");
    std::fs::create_dir_all(&profiles_dir)
        .map_err(|e| format!("Failed to create sandbox profiles dir: {}", e))?;

    // Use a hash of the working directory for the profile filename
    // so each project gets its own profile
    let dir_hash = {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        working_directory.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    };
    let profile_path = profiles_dir.join(format!("agent-{}.sb", &dir_hash[..8]));

    let home_str = home.to_string_lossy();

    // Escape paths for Seatbelt regex (backslash special chars)
    let profile = format!(
        r#"(version 1)
(deny default)

;; Allow reading system files (agents need binaries, libraries, configs)
(allow file-read*)

;; Allow writing to project directory and temp
(allow file-write*
  (subpath "{working_dir}")
  (subpath "/tmp")
  (subpath "/private/tmp")
  (subpath "/private/var/folders"))

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
        working_dir = working_directory,
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
    working_directory: &str,
) -> Result<(String, Vec<String>), String> {
    let profile_path = generate_seatbelt_profile(working_directory)?;
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

/// Linux sandbox support via bubblewrap (future — placeholder for now)
#[cfg(target_os = "linux")]
pub fn sandboxed_command(
    working_directory: &str,
) -> Result<(String, Vec<String>), String> {
    // Check if bwrap is available
    let bwrap = std::process::Command::new("which")
        .arg("bwrap")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    if bwrap.is_none() {
        return Err("bubblewrap (bwrap) not found — install it for sandbox support".to_string());
    }

    Ok((
        "bwrap".to_string(),
        vec![
            "--ro-bind".to_string(), "/usr".to_string(), "/usr".to_string(),
            "--ro-bind".to_string(), "/lib".to_string(), "/lib".to_string(),
            "--ro-bind".to_string(), "/lib64".to_string(), "/lib64".to_string(),
            "--ro-bind".to_string(), "/bin".to_string(), "/bin".to_string(),
            "--ro-bind".to_string(), "/etc/resolv.conf".to_string(), "/etc/resolv.conf".to_string(),
            "--bind".to_string(), working_directory.to_string(), working_directory.to_string(),
            "--bind".to_string(), "/tmp".to_string(), "/tmp".to_string(),
            "--dev".to_string(), "/dev".to_string(),
            "--proc".to_string(), "/proc".to_string(),
            "--".to_string(),
        ],
    ))
}
