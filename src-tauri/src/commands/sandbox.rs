use std::path::{Path, PathBuf};

use super::network_proxy::NetworkSandboxConfig;

/// Generate a macOS Seatbelt (.sb) sandbox profile for an agent process.
///
/// The profile is written to a temp file tied to the agent's instance ID.
/// It is ephemeral — deleted when the agent exits (see `cleanup_profile`).
///
/// The profile:
/// - Allows reading all files (agents need system libraries, binaries, configs)
/// - Allows writing only to the specified paths, /tmp, and /dev device nodes
/// - Denies reading sensitive directories (~/.ssh, ~/.aws, ~/.gnupg, .env files)
/// - Denies writing to .git/ directories (read-only access)
/// - Network: when `kernel_network_deny` is true and a proxy is configured,
///   (deny default) blocks all network and only the proxy port is allowed.
///   When false, (allow network*) permits all network (proxy env vars are the only enforcement).
/// - Allows process execution (agents spawn git, grep, etc.)
#[cfg(target_os = "macos")]
pub fn generate_seatbelt_profile(
    instance_id: &str,
    writable_paths: &[String],
    network_config: Option<&NetworkSandboxConfig>,
    kernel_network_deny: bool,
) -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;

    let home_str = home.to_string_lossy();

    // Write to temp dir — profile lives only as long as the agent process.
    let profile_path = std::env::temp_dir().join(format!("notesage-sandbox-{}.sb", instance_id));

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

    // Network block: kernel-enforced deny or legacy allow-all.
    //
    // When kernel_network_deny is true and a proxy is configured:
    //   (deny default) at the top already blocks all network. We add targeted allows
    //   for the proxy port only. This is the Anthropic sandbox-runtime pattern —
    //   NO explicit (deny network*) rule, which would create precedence conflicts.
    //   DNS is intentionally blocked; resolution happens through the proxy.
    //
    // When kernel_network_deny is false or no proxy configured:
    //   (allow network*) permits all network. Proxy env vars are the only enforcement.
    let network_block = if kernel_network_deny {
        if let Some(nc) = network_config {
            format!(
                r#";; Network: kernel-enforced deny (deny default blocks all network)
;; Only the proxy port on localhost is reachable from within the sandbox.
;; DNS is blocked — resolution happens through the proxy outside the sandbox.

;; Allow connecting to the proxy port
(allow network-outbound (remote ip "localhost:{port}"))

;; Allow localhost bind + inbound for agent subprocess IPC
;; Uses "*:*" for IPv6 dual-stack compat (::ffff:127.0.0.1 vs 127.0.0.1)
(allow network-bind (local ip "*:*"))
(allow network-inbound (local ip "*:*"))

;; Unix domain sockets for system IPC (mDNSResponder, etc.)
(allow system-socket (socket-domain AF_UNIX))
(allow network-outbound (remote unix-socket (subpath "/var/run")))
(allow network-outbound (remote unix-socket (subpath "/private/var/run")))
(allow network-bind (local unix-socket (subpath "/tmp")))
(allow network-bind (local unix-socket (subpath "/private/tmp")))

;; Go TLS cert verification (needed by Go-based agents like Codex)
(allow mach-lookup (global-name "com.apple.trustd.agent"))

;; Kernel event socket (safe, non-network)
(allow system-socket (require-all (socket-domain AF_SYSTEM) (socket-protocol 2)))"#,
                port = nc.proxy_port
            )
        } else {
            // kernel_network_deny is true but no proxy configured — fall back to allow-all
            // (can't enforce deny without a proxy to route through)
            ";; Network: no proxy configured, allowing all network\n(allow network*)".to_string()
        }
    } else {
        ";; Network: legacy mode (proxy env vars provide domain filtering)\n(allow network*)".to_string()
    };

    let profile = format!(
        r#"(version 1)
(deny default)

;; Allow reading system files (agents need binaries, libraries, configs)
(allow file-read*)

;; Allow writing to specified directories, temp, device nodes, and agent config dirs
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
  (subpath "{home}/.config")
  (literal "/dev/null")
  (literal "/dev/tty")
  (literal "/dev/zero")
  (literal "/dev/random")
  (literal "/dev/urandom"))

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

    log::info!(target: "notesage::sandbox",
        "Generated Seatbelt profile for {} at {} (kernel_deny={})",
        instance_id, profile_path.display(), kernel_network_deny
    );

    Ok(profile_path)
}

/// Build the command and args for a sandboxed agent spawn on macOS.
/// Returns (program, prefix_args) that should be prepended to the actual agent command.
#[cfg(target_os = "macos")]
pub fn sandboxed_command(
    instance_id: &str,
    writable_paths: &[String],
    network_config: Option<&NetworkSandboxConfig>,
    kernel_network_deny: bool,
) -> Result<(String, Vec<String>), String> {
    let profile_path = generate_seatbelt_profile(instance_id, writable_paths, network_config, kernel_network_deny)?;
    Ok((
        "sandbox-exec".to_string(),
        vec![
            "-f".to_string(),
            profile_path.to_string_lossy().to_string(),
        ],
    ))
}

/// Delete a sandbox profile temp file after the agent exits.
pub fn cleanup_profile(instance_id: &str) {
    let profile_path = std::env::temp_dir().join(format!("notesage-sandbox-{}.sb", instance_id));
    if profile_path.exists() {
        if let Err(e) = std::fs::remove_file(&profile_path) {
            log::warn!(target: "notesage::sandbox", "Failed to clean up profile {}: {}", profile_path.display(), e);
        }
    }
}

/// Remove the legacy ~/.notesage/sandbox/profiles/ directory (one-time startup cleanup).
/// Profiles are now written to temp files and cleaned up on agent exit.
pub fn cleanup_legacy_profiles() {
    if let Some(home) = dirs::home_dir() {
        let legacy_dir = home.join(".notesage/sandbox/profiles");
        if legacy_dir.is_dir() {
            match std::fs::remove_dir_all(&legacy_dir) {
                Ok(()) => log::info!(target: "notesage::sandbox", "Removed legacy profiles dir: {}", legacy_dir.display()),
                Err(e) => log::warn!(target: "notesage::sandbox", "Failed to remove legacy profiles dir: {}", e),
            }
            // Also remove the parent sandbox/ dir (may contain .DS_Store)
            let sandbox_dir = home.join(".notesage/sandbox");
            let _ = std::fs::remove_dir_all(&sandbox_dir);
        }
    }
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
    _instance_id: &str,
    writable_paths: &[String],
    network_config: Option<&NetworkSandboxConfig>,
    _kernel_network_deny: bool, // Not implemented on Linux — ignored
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
