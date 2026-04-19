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

    // Build writable subpath entries (used by both file-write and file-read allow blocks)
    let writable_entries: Vec<String> = writable_paths
        .iter()
        .map(|p| format!("  (subpath \"{}\")", p))
        .collect();
    let writable_block = if writable_entries.is_empty() {
        String::new()
    } else {
        writable_entries.join("\n")
    };
    // The full file-read re-allow block for the selected project(s). Skipped
    // entirely when no writable_paths are configured (e.g. inline-action callers
    // that pass an empty list), so we don't emit an invalid `(allow file-read*\n)`.
    let writable_read_allow = if writable_entries.is_empty() {
        String::new()
    } else {
        format!("(allow file-read*\n{})", writable_entries.join("\n"))
    };

    // Ancestor literal-allow entries (task #6c).
    //
    // When a writable path is INSIDE a denied subpath (e.g. an iCloud project
    // under `~/Library/Mobile Documents`), the deny rule blocks reads on every
    // ancestor directory — including directories the agent needs to `stat` or
    // `fs.watch`. Node's fs.watch on a file inside the project traverses the
    // parent chain to register the watcher; if any ancestor is unreadable, the
    // watch syscall returns EPERM.
    //
    // `(literal "PATH")` matches the exact path only, NOT its descendants. So
    // allowing a literal ancestor lets the agent stat/readdir that directory
    // (filenames visible) without exposing sibling contents (which fall under
    // the original deny subpath).
    //
    // Stop walking at `$HOME`: paths outside $HOME are broadly readable
    // (covered by the top-level `(allow file-read*)` rule).
    let ancestor_literal_allow = {
        let home_path = home.clone();
        let mut ancestors: std::collections::BTreeSet<std::path::PathBuf> =
            std::collections::BTreeSet::new();
        for path in writable_paths {
            let p = std::path::Path::new(path);
            for ancestor in p.ancestors().skip(1) {
                let s = ancestor.to_string_lossy();
                // Stop at or above $HOME — everything outside is already allowed.
                if s.len() <= home_path.to_string_lossy().len() {
                    break;
                }
                ancestors.insert(ancestor.to_path_buf());
            }
        }
        if ancestors.is_empty() {
            String::new()
        } else {
            let entries: Vec<String> = ancestors
                .iter()
                .map(|p| format!("  (literal \"{}\")", p.display()))
                .collect();
            format!(
                ";; Ancestor directories of writable_paths — literal allow lets the\n;; agent stat/readdir each parent so `fs.watch` and workspace-marker\n;; traversal work, without re-exposing sibling contents.\n(allow file-read*\n{})",
                entries.join("\n")
            )
        }
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

;; --- READ POLICY (kernel-enforced project isolation, task #6c) ---
;;
;; Seatbelt evaluates rules in order; the LAST matching rule wins. The chain
;; below: broad allow → deny known user-data areas (Documents, Desktop, Downloads,
;; Movies, Music, Pictures, iCloud Mobile Documents — Apple's TCC boundary) →
;; re-allow the selected project (which may be inside iCloud) → deny sensitive
;; dotfiles last.
;;
;; Why this shape (not deny-everything-in-$HOME):
;;   A blanket `(deny file-read* (subpath "$HOME"))` proved too strict: the
;;   ACP agent subprocess reads many unpredictable paths under $HOME during
;;   init (node_modules, dotfiles, OS caches the agent's runtime happens to
;;   stat, etc.). Missing even one path deadlocks init with an opaque
;;   "server shut down unexpectedly". The enumeration approach below matches
;;   macOS's own TCC model — Documents, Desktop, Downloads, iCloud are user
;;   data; everything else is treated as tooling/system.
;;
;; Limitation of this shape:
;;   Two projects at sibling paths NOT in the deny list (e.g. `~/Code/A` and
;;   `~/Code/B`, or `~/Development/A` and `~/Development/B`) are both readable
;;   when either is selected. The user's original reproducible leak (through
;;   iCloud Mobile Documents) IS closed. A future task could add
;;   user-configurable deny paths, or shift to an allow-list model once we
;;   understand each agent's exact read footprint.

;; 1. Broad allow — covers /usr, /bin, /Library, /System, /opt, /Applications,
;;    and most of $HOME (dotfiles, tooling caches, ~/Library app support).
(allow file-read*)

;; 2. Deny user-data areas under $HOME (Apple TCC boundary + iCloud).
(deny file-read*
  (subpath "{home}/Documents")
  (subpath "{home}/Desktop")
  (subpath "{home}/Downloads")
  (subpath "{home}/Movies")
  (subpath "{home}/Music")
  (subpath "{home}/Pictures")
  (subpath "{home}/Public")
  (subpath "{home}/Library/Mobile Documents")
  (subpath "{home}/Library/Messages")
  (subpath "{home}/Library/Mail")
  (subpath "{home}/Library/Calendars")
  (subpath "{home}/Library/Contacts")
  (subpath "{home}/Library/Application Support/AddressBook"))

;; 3. Re-allow the selected project(s) — crucial when a project lives inside
;;    a denied area (e.g. an iCloud project under Mobile Documents, or a
;;    project in ~/Documents).
{writable_read_allow}

;; 4. Re-allow ancestors of each writable path as a literal (the dir itself,
;;    not its children) so parent-chain operations like fs.watch and
;;    workspace-marker discovery work even when the project is inside a
;;    denied area. Children of the ancestor (i.e. sibling projects) remain
;;    denied because `(literal)` does not cover descendants.
{ancestor_literal_allow}

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

;; DENY reading sensitive directories (non-configurable; comes last so it
;; overrides every prior allow).
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
        writable_read_allow = writable_read_allow,
        ancestor_literal_allow = ancestor_literal_allow,
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

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // macOS-only tests (Seatbelt profile generation)
    // -------------------------------------------------------------------------

    #[cfg(target_os = "macos")]
    mod macos {
        use super::*;
        use crate::commands::network_proxy::NetworkSandboxConfig;

        fn make_network_config(port: u16) -> NetworkSandboxConfig {
            NetworkSandboxConfig {
                proxy_addr: format!("127.0.0.1:{}", port),
                proxy_port: port,
            }
        }

        #[test]
        fn profile_contains_deny_default() {
            let id = "test-deny-default";
            let result = generate_seatbelt_profile(id, &[], None, false);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            assert!(
                content.contains("(deny default)"),
                "Profile must contain (deny default)"
            );
        }

        #[test]
        fn writable_paths_correctly_allowed() {
            let id = "test-writable-paths";
            let paths = vec![
                "/tmp/mydir".to_string(),
                "/home/test".to_string(),
            ];
            let result = generate_seatbelt_profile(id, &paths, None, false);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            assert!(
                content.contains(r#"(subpath "/tmp/mydir")"#),
                "Profile must allow /tmp/mydir"
            );
            assert!(
                content.contains(r#"(subpath "/home/test")"#),
                "Profile must allow /home/test"
            );
        }

        #[test]
        fn read_policy_denies_user_data_areas() {
            // Task #6c: the profile must deny reads in known user-data areas
            // under $HOME — Apple's TCC boundary plus iCloud Mobile Documents
            // (the user's reproducible leak path on 2026-04-19). Each entry
            // below was identified as user-private content that an agent
            // scoped to one project should never reach.
            let id = "test-userdata-deny";
            let result = generate_seatbelt_profile(id, &[], None, false);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            let home = dirs::home_dir().unwrap();
            let home_str = home.to_string_lossy();
            for dir in [
                "Documents",
                "Desktop",
                "Downloads",
                "Movies",
                "Music",
                "Pictures",
                "Public",
                "Library/Mobile Documents",
                "Library/Messages",
                "Library/Mail",
                "Library/Calendars",
                "Library/Contacts",
            ] {
                let needle = format!("(subpath \"{}/{}\")", home_str, dir);
                assert!(
                    content.contains(&needle),
                    "Profile must deny reads in {}; expected line containing `{}` in:\n{}",
                    dir, needle, content,
                );
            }
        }

        #[test]
        fn read_policy_keeps_broad_allow_for_tooling() {
            // The broad `(allow file-read*)` rule must remain the first read
            // rule — agents need to read system libs, language tooling, their
            // own config, OS caches, etc. The deny block above narrows it to
            // user-data areas only. Removing the broad allow would deadlock
            // agent init (the failure observed on 2026-04-19 when an
            // alternative deny-everything-in-$HOME profile was tried).
            let id = "test-broad-allow";
            let result = generate_seatbelt_profile(id, &[], None, false);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            assert!(
                content.contains("(allow file-read*)"),
                "Profile must keep the broad `(allow file-read*)` rule; without it agents can't init. Profile:\n{}",
                content,
            );
        }

        #[test]
        fn writable_paths_appear_in_both_read_and_write_allows() {
            // Same path list must be allowed for BOTH file-read and file-write.
            // Closing only writes (the pre-#6c behaviour) leaves the read leak
            // open — agent can read every file but only write to the project.
            let id = "test-writable-read-allow";
            let project = "/tmp/notesage-test-project";
            let result = generate_seatbelt_profile(id, &[project.to_string()], None, false);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            // Two `(subpath "$project")` occurrences expected: one in the
            // file-read re-allow, one in the file-write allow.
            let count = content.matches(&format!(r#"(subpath "{}")"#, project)).count();
            assert!(
                count >= 2,
                "Project path must appear in both read and write allow blocks (found {} occurrences)",
                count,
            );
        }

        #[test]
        fn sensitive_directories_denied() {
            let id = "test-sensitive-deny";
            let result = generate_seatbelt_profile(id, &[], None, false);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            assert!(content.contains(".ssh"), "Profile must deny .ssh");
            assert!(content.contains(".aws"), "Profile must deny .aws");
            assert!(content.contains(".gnupg"), "Profile must deny .gnupg");
            assert!(
                content.contains(".config/gcloud"),
                "Profile must deny .config/gcloud"
            );
            assert!(
                content.contains(r#"(regex #"\.env$")"#),
                "Profile must deny .env files"
            );
            assert!(
                content.contains(r#"(regex #"\.env\..*$")"#),
                "Profile must deny .env.* files"
            );
        }

        #[test]
        fn network_proxy_only_when_kernel_deny_true() {
            let id = "test-proxy-only";
            let nc = make_network_config(8080);
            let result = generate_seatbelt_profile(id, &[], Some(&nc), true);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            assert!(
                content.contains(r#"(allow network-outbound (remote ip "localhost:8080"))"#),
                "Profile must allow proxy port outbound"
            );
            assert!(
                !content.contains("(allow network*)"),
                "Profile must NOT contain allow-all network when kernel deny is true with proxy"
            );
        }

        #[test]
        fn network_allow_all_when_kernel_deny_false() {
            let id = "test-allow-all-net";
            let nc = make_network_config(9999);
            let result = generate_seatbelt_profile(id, &[], Some(&nc), false);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            assert!(
                content.contains("(allow network*)"),
                "Profile must allow all network when kernel_network_deny is false"
            );
        }

        #[test]
        fn network_allow_all_fallback_no_proxy() {
            let id = "test-no-proxy-fallback";
            let result = generate_seatbelt_profile(id, &[], None, true);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            assert!(
                content.contains("(allow network*)"),
                "Profile must fallback to allow-all when kernel deny is true but no proxy configured"
            );
        }

        #[test]
        fn profile_path_in_temp_dir_with_correct_name() {
            let id = "test-path-pattern";
            let result = generate_seatbelt_profile(id, &[], None, false);
            let path = result.expect("should generate profile");
            cleanup_profile(id);

            let expected_name = format!("notesage-sandbox-{}.sb", id);
            assert!(
                path.file_name().unwrap().to_string_lossy() == expected_name,
                "Profile filename must be notesage-sandbox-{{}}.sb, got {:?}",
                path.file_name()
            );
            assert!(
                path.starts_with(std::env::temp_dir()),
                "Profile must be inside temp dir, got {:?}",
                path
            );
        }

        #[test]
        fn cleanup_profile_removes_file() {
            let id = "test-cleanup";
            let result = generate_seatbelt_profile(id, &[], None, false);
            let path = result.expect("should generate profile");

            assert!(path.exists(), "Profile file must exist after generation");
            cleanup_profile(id);
            assert!(!path.exists(), "Profile file must be gone after cleanup");
        }

        #[test]
        fn sandboxed_command_returns_sandbox_exec() {
            let id = "test-cmd";
            let (program, args) = sandboxed_command(id, &[], None, false)
                .expect("sandboxed_command should succeed");
            cleanup_profile(id);

            assert_eq!(program, "sandbox-exec", "Program must be sandbox-exec");
            assert!(
                args.contains(&"-f".to_string()),
                "Args must contain -f flag"
            );
        }
    }

    // -------------------------------------------------------------------------
    // Cross-platform tests
    // -------------------------------------------------------------------------

    #[test]
    fn should_sandbox_managed_install() {
        let home = dirs::home_dir().unwrap_or_default();
        let managed = home.join(".notesage/agents/bin/claude-agent");
        assert!(
            should_sandbox_by_default(&managed.to_string_lossy()),
            "Managed install path should be sandboxed by default"
        );
    }

    #[test]
    fn should_not_sandbox_system_install() {
        assert!(
            !should_sandbox_by_default("/usr/local/bin/agent"),
            "System install path should NOT be sandboxed by default"
        );
    }
}
