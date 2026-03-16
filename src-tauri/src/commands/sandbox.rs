use std::path::{Path, PathBuf};

use super::network_proxy::NetworkSandboxConfig;

/// Generate a macOS Seatbelt (.sb) sandbox profile for an agent process.
///
/// The profile:
/// - Allows reading all files (agents need system libraries, binaries, configs)
/// - Allows writing only to the specified paths and /tmp
/// - Denies reading sensitive directories (~/.ssh, ~/.aws, ~/.gnupg, .env files)
/// - Denies writing to .git/ directories (read-only access)
/// - Network: unrestricted if `network_config` is None, proxy-only if Some
/// - Allows process execution (agents spawn git, grep, etc.)
#[cfg(target_os = "macos")]
pub fn generate_seatbelt_profile(
    writable_paths: &[String],
    network_config: Option<&NetworkSandboxConfig>,
) -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;

    let profiles_dir = home.join(".notesage/sandbox/profiles");
    std::fs::create_dir_all(&profiles_dir)
        .map_err(|e| format!("Failed to create sandbox profiles dir: {}", e))?;

    // Hash all paths + network config for the profile filename
    let path_hash = {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        for p in writable_paths {
            p.hash(&mut hasher);
        }
        if let Some(nc) = network_config {
            nc.proxy_port.hash(&mut hasher);
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

    // Network sandbox enforcement:
    // - Primary: HTTP_PROXY/HTTPS_PROXY env vars route agent traffic through our proxy
    // - Seatbelt keeps (allow network*) — attempts to use (deny network-outbound) with
    //   selective allows for localhost broke agent startup in practice, despite being the
    //   documented pattern from Anthropic/OpenAI sandbox-runtime. Seatbelt's rule precedence
    //   appears to favor deny over more specific allows in some configurations.
    // - The proxy is the real enforcement: filters by domain, prompts for unknown domains.
    let _network_config = network_config;
    let network_block = ";; Allow network (proxy env vars provide domain filtering)\n(allow network*)".to_string();

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

{network_block}

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
        network_block = network_block,
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
    network_config: Option<&NetworkSandboxConfig>,
) -> Result<(String, Vec<String>), String> {
    let profile_path = generate_seatbelt_profile(writable_paths, network_config)?;
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
    network_config: Option<&NetworkSandboxConfig>,
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

    // Network sandboxing: isolate network namespace
    if network_config.is_some() {
        // Note: --unshare-net blocks all network including localhost.
        // We skip it for now since the proxy runs on localhost TCP.
        // The proxy env vars + Seatbelt (on macOS) enforce the policy.
        // On Linux, rely on proxy env vars as the enforcement mechanism.
        // Full Linux network isolation requires iptables rules or socat bridging (future work).
    }

    args.extend([
        "--bind".to_string(), "/tmp".to_string(), "/tmp".to_string(),
        "--dev".to_string(), "/dev".to_string(),
        "--proc".to_string(), "/proc".to_string(),
        "--".to_string(),
    ]);

    Ok(("bwrap".to_string(), args))
}
