use std::path::{Path, PathBuf};

use super::network_proxy::NetworkSandboxConfig;

/// Classify the relevant config subpaths for a given agent binary name.
///
/// Each supported ACP agent reads from a small, distinct set of paths under
/// `$HOME`. Task #24 narrows the sandbox profile to only emit the subpaths
/// relevant to the spawning agent so — for example — `claude-agent-acp`
/// can't read `~/.codex` or `~/.gemini` even though those dirs exist on
/// disk. The pre-#24 profile granted every agent writable access to every
/// provider's config dir.
///
/// Returned entries are [`SandboxEntry`] variants:
/// - `Subpath(rel)`: `$HOME/rel` and all descendants (recursive)
/// - `Literal(rel)`: `$HOME/rel` exactly (for sibling state files like
///   `~/.claude.json` and narrow keychain reads)
///
/// Accepts either the raw command name (`"codex-acp"`) or an absolute path
/// (`"/opt/homebrew/bin/copilot"`, `"/Users/peter/.notesage/agents/bin/codex-acp"`).
/// The basename is extracted before matching — callers don't need to normalize.
/// Adding a new agent requires extending this match plus adding a matching
/// Rust unit test.
///
/// POLICY — unknown/custom agent binaries get NOTHING by default. A basename
/// that doesn't match a known agent receives no Bucket C re-allow entries
/// (only the app's own `.notesage`); the deny-by-default `$HOME` read rule
/// and the deny-last sensitive entries apply in full. Users opt in to extra
/// paths via the connection's writable-paths UI, never via this table.
#[cfg(target_os = "macos")]
#[derive(Clone, Debug)]
pub(crate) enum SandboxEntry {
    /// `$HOME`-relative path, allowed as `(subpath ...)` — recursive.
    Subpath(&'static str),
    /// `$HOME`-relative path, allowed as `(literal ...)` — exact match only.
    Literal(&'static str),
}

#[cfg(target_os = "macos")]
pub(crate) fn agent_config_entries(agent_binary: &str) -> Vec<SandboxEntry> {
    // Always include Notesage's own config dir — the app itself writes
    // bundled skills/agents and meta state there, and the agent process
    // may need to reach those regardless of provider.
    let mut entries = vec![SandboxEntry::Subpath(".notesage")];

    // Extract the command basename so callers can pass either the raw name
    // or a resolved absolute path. Seatbelt spawns receive the resolved path
    // (see acp.rs:run_agent_thread) — matching on the full path would miss
    // every arm and silently strip Bucket C, denying ~/.codex, ~/.copilot, etc.
    let cmd = Path::new(agent_binary)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(agent_binary);

    match cmd {
        // Anthropic Claude Code via claude-agent-acp. The agent also reads a
        // sibling FILE ~/.claude.json (project state, ~41KB) at session/new
        // time; missing the file causes its internal `query()` subprocess to
        // die silently. See task #6d research log.
        //
        // Also reads the macOS login keychain via node-keytar at session/prompt
        // time to resolve its OAuth token. Without keychain access, session/new
        // succeeds (file-based ~/.claude.json read works) but session/prompt
        // fails with code -32000 "Authentication required" — observed
        // 2026-04-19. Narrowed to the single keychain FILE so sibling entries
        // stay denied, same shape as the Copilot arm below.
        "claude-agent-acp" => {
            entries.push(SandboxEntry::Subpath(".claude"));
            entries.push(SandboxEntry::Literal(".claude.json"));
            entries.push(SandboxEntry::Literal(".claude.json.backup"));
            entries.push(SandboxEntry::Literal(
                "Library/Keychains/login.keychain-db",
            ));
        }
        // OpenAI Codex via codex-acp.
        "codex-acp" => {
            entries.push(SandboxEntry::Subpath(".codex"));
        }
        // GitHub Copilot CLI (`copilot --acp`) and Copilot Language Server.
        // Copilot reads the macOS login keychain via node-keytar to resolve
        // its OAuth token (service name `copilot-cli`). Narrowed to the
        // single keychain FILE so sibling entries (metadata.keychain-db,
        // per-user keychain subdirs) stay denied.
        "copilot" | "copilot-language-server" => {
            entries.push(SandboxEntry::Subpath(".copilot"));
            entries.push(SandboxEntry::Literal(
                "Library/Keychains/login.keychain-db",
            ));
        }
        // Google Gemini CLI via `gemini --acp`.
        "gemini" => {
            entries.push(SandboxEntry::Subpath(".gemini"));
        }
        // Goose (`goose acp`) — the Local Agent preset binary.
        //
        // The preset redirects Goose's XDG dirs into the Notesage-owned
        // ~/.notesage/agents/goose tree (already covered by the `.notesage`
        // grant above), so in the happy path no extra row is needed. These
        // conventional XDG dirs are a fallback for the case where Goose ignores
        // the XDG redirect on a given platform. Narrowed to Goose's own dirs —
        // do NOT broaden to all of `~/.config`.
        "goose" => {
            entries.push(SandboxEntry::Subpath(".config/goose"));
            entries.push(SandboxEntry::Subpath(".cache/goose"));
            entries.push(SandboxEntry::Subpath(".local/share/goose"));
            entries.push(SandboxEntry::Subpath(".local/state/goose"));
        }
        // Unknown / custom agent binaries get only `.notesage` — defense in
        // depth: no cross-agent config leakage by default.
        _ => {}
    }

    entries
}

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
///
/// `agent_binary` is the raw command name (e.g. `"claude-agent-acp"`,
/// `"codex-acp"`, `"copilot"`, `"gemini"`). It drives the Bucket C
/// (per-agent config) narrowing from task #24 — the profile emits only
/// the subpaths for this specific agent.
#[cfg(target_os = "macos")]
pub fn generate_seatbelt_profile(
    instance_id: &str,
    agent_binary: &str,
    writable_paths: &[String],
    network_config: Option<&NetworkSandboxConfig>,
    kernel_network_deny: bool,
) -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;

    let home_str = home.to_string_lossy();

    // Task #24: agent-specific config re-allow list. Only the paths THIS
    // agent binary needs — not a blanket grant that leaks sibling agent
    // config state.
    let agent_entries = agent_config_entries(agent_binary);
    let agent_read_lines: Vec<String> = agent_entries
        .iter()
        .map(|e| match e {
            SandboxEntry::Subpath(rel) => {
                format!("  (subpath \"{}/{}\")", home_str, rel)
            }
            SandboxEntry::Literal(rel) => {
                format!("  (literal \"{}/{}\")", home_str, rel)
            }
        })
        .collect();
    let agent_config_read_allow = if agent_read_lines.is_empty() {
        String::new()
    } else {
        format!(
            ";; 4. Re-allow Bucket C — per-agent config dirs + adjacent state\n;;    files. Narrowed to the paths THIS agent_binary needs (task #24).\n;;    Sibling agents' config dirs stay denied by rule 2 above.\n(allow file-read*\n{})",
            agent_read_lines.join("\n")
        )
    };
    // Matching write-allow entries. Keychain literal is read-only for
    // Copilot — never grant write access to it.
    let agent_write_lines: Vec<String> = agent_entries
        .iter()
        .map(|e| match e {
            SandboxEntry::Subpath(rel) => {
                format!("  (subpath \"{}/{}\")", home_str, rel)
            }
            SandboxEntry::Literal(rel) => {
                format!("  (literal \"{}/{}\")", home_str, rel)
            }
        })
        .filter(|line| !line.contains("Library/Keychains/"))
        .collect();
    let agent_config_write_allow = if agent_write_lines.is_empty() {
        String::new()
    } else {
        agent_write_lines.join("\n")
    };

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
            // Extra direct-localhost allows (e.g. the bundled llama-server port
            // for the Goose preset). Each is a loopback service the agent
            // reaches without the proxy; ordinary agents have none, so the
            // confinement to {proxy port} is unchanged for them.
            let extra_port_allows: String = nc
                .extra_localhost_ports
                .iter()
                .map(|p| format!("\n(allow network-outbound (remote ip \"localhost:{}\"))", p))
                .collect();
            format!(
                r#";; Network: kernel-enforced deny (deny default blocks all network)
;; Only the proxy port (+ any explicit extra localhost ports) is reachable.
;; DNS is blocked — resolution happens through the proxy outside the sandbox.

;; Allow connecting to the proxy port
(allow network-outbound (remote ip "localhost:{port}")){extra_port_allows}

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

;; --- READ POLICY (kernel-enforced project isolation, task #6d) ---
;;
;; Seatbelt evaluates rules in order; the LAST matching rule wins. The chain
;; below enforces full project isolation: agent can read system paths outside
;; $HOME, language tooling / runtime dirs, its own config, and the selected
;; project. Everything else under $HOME is denied — including sibling projects
;; at neutral paths (~/Code/A vs ~/Code/B), which #6c's TCC-enumeration shape
;; left open.
;;
;; Allow-list rationale (Bucket B: runtime, Bucket C: per-agent config):
;;
;;   Node runtime + package managers — agents are Node processes that read
;;   node_modules from wherever their install path lives. On most dev
;;   machines that's /opt/homebrew (outside $HOME, allowed at level 1) but
;;   some users install via nvm/volta/fnm/asdf (under $HOME).
;;
;;   ~/.npm, ~/.npm-global, ~/.nvm, ~/.volta, ~/.fnm, ~/.asdf
;;   ~/.yarn, ~/.pnpm, ~/.bun, ~/.deno
;;   ~/.cargo, ~/.rustup                (ripgrep etc. if built from source)
;;   ~/.local, ~/.config, ~/.cache      (XDG)
;;   ~/.gitconfig, ~/.ssh/known_hosts?  (git ops — note ~/.ssh is denied below,
;;                                      known_hosts reads handled by git-over-
;;                                      HTTPS, not SSH, so not re-allowed here)
;;
;;   Agent config dirs:
;;   ~/.claude, ~/.codex, ~/.copilot, ~/.gemini, ~/.notesage
;;
;;   macOS native caches and prefs that Node / GUI-adjacent tools hit:
;;   ~/Library/Caches, ~/Library/Application Support, ~/Library/Preferences
;;   (user-data subdirs like Messages/Mail/iCloud are denied by NOT re-allowing
;;   their specific subpaths; the broader Library allow covers only the
;;   general cache/prefs tier. Sensitive subdirs like Application Support/
;;   AddressBook are explicitly denied later.)
;;
;; Why we don't just allow $HOME broadly: sibling-path leak is the primary
;; threat. A deny-by-default rule on $HOME + a curated re-allow list is the
;; only shape that closes it. See #6c task entry for the failed enumeration
;; attempt and the research log explaining why this is the only viable model.

;; 1. Broad allow — covers /usr, /bin, /Library, /System, /opt, /Applications,
;;    /private/var, /tmp. Agents need system libraries; Homebrew node_modules
;;    (the most common install) live at /opt/homebrew/lib/node_modules.
(allow file-read*)

;; 2. Deny every read inside $HOME by default.
(deny file-read* (subpath "{home}"))

;; 3a. Allow stat/readdir on $HOME itself (literal — NOT subpath, so its
;;     children stay denied). Without this, fs.watch/kqueue on any allowed
;;     subpath (like ~/.claude or a writable_path) fails because the parent-
;;     chain traversal hits $HOME and gets EPERM. Verified 2026-04-19 via
;;     claude-agent-acp:stderr logs.
(allow file-read* (literal "{home}"))

;; 3b. Re-allow Bucket B (language tooling / Node runtime) under $HOME.
;;     Bucket C (per-agent config + Copilot keychain literal) is emitted
;;     separately below, driven by the agent_binary identifier (task #24)
;;     so each agent only gets its own config dir.
(allow file-read*
  (subpath "{home}/.npm")
  (subpath "{home}/.npm-global")
  (subpath "{home}/.nvm")
  (subpath "{home}/.volta")
  (subpath "{home}/.fnm")
  (subpath "{home}/.asdf")
  (subpath "{home}/.yarn")
  (subpath "{home}/.pnpm")
  (subpath "{home}/.bun")
  (subpath "{home}/.deno")
  (subpath "{home}/.cargo")
  (subpath "{home}/.rustup")
  (subpath "{home}/.local")
  (subpath "{home}/.config")
  (subpath "{home}/.cache")
  (subpath "{home}/Library/Caches")
  (subpath "{home}/Library/Application Support")
  (subpath "{home}/Library/Preferences")
  (literal "{home}/.gitconfig")
  (literal "{home}/.gitignore_global"))

{agent_config_read_allow}

;; 5. Re-allow the selected project(s) — writable_paths. Critical: this is
;;    the ONLY content under $HOME that's project-specific; everything else
;;    above is agent/runtime infrastructure.
{writable_read_allow}

;; 6. Re-allow ancestors of each writable path as a literal (the dir itself,
;;    not its children). Lets fs.watch's parent-chain check and workspace-
;;    marker discovery work when a project is nested deep. Children of the
;;    ancestor (sibling projects) remain denied because `(literal)` does not
;;    cover descendants — only the exact path matches.
{ancestor_literal_allow}

;; Allow writing to specified directories, temp, device nodes, and the
;; agent's OWN config dirs (narrowed by agent_binary — task #24). Keychain
;; is read-only; filtered out of the write-allow list in Rust.
(allow file-write*
{writable_block}
  (subpath "/tmp")
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (subpath "{home}/.config")
{agent_config_write_allow}
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
        agent_config_read_allow = agent_config_read_allow,
        agent_config_write_allow = agent_config_write_allow,
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
///
/// `agent_binary` drives per-agent config subpath narrowing (task #24).
/// Pass the raw command name, not the resolved absolute path.
#[cfg(target_os = "macos")]
pub fn sandboxed_command(
    instance_id: &str,
    agent_binary: &str,
    writable_paths: &[String],
    network_config: Option<&NetworkSandboxConfig>,
    kernel_network_deny: bool,
) -> Result<(String, Vec<String>), String> {
    let profile_path = generate_seatbelt_profile(instance_id, agent_binary, writable_paths, network_config, kernel_network_deny)?;
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
/// System installs (the user's own KNOWN agent CLIs) are not sandboxed by default.
///
/// NOTE: this default only applies when the connection carries no explicit
/// `sandboxEnabled` value. `custom_acp` connections (arbitrary user-supplied
/// binaries at absolute paths) are registered with an explicit `true` by
/// `registerCustomAcpConnection` — relying on this source-based default for
/// them would leave arbitrary third-party binaries unsandboxed (locked by the
/// registration test in `useAcpLifecycle.custom-agent.test.ts`).
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
    _agent_binary: &str, // Per-agent narrowing not yet implemented on Linux
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
                extra_localhost_ports: Vec::new(),
            }
        }

        fn make_network_config_with_extra(port: u16, extra: Vec<u16>) -> NetworkSandboxConfig {
            NetworkSandboxConfig {
                proxy_addr: format!("127.0.0.1:{}", port),
                proxy_port: port,
                extra_localhost_ports: extra,
            }
        }

        /// Count of `(allow network-outbound (remote ip "localhost:N"))` lines.
        fn localhost_allow_count(content: &str) -> usize {
            content
                .matches(r#"(allow network-outbound (remote ip "localhost:"#)
                .count()
        }

        // Task #9 regression lock: the Local Agent preset profile must allow
        // EXACTLY {proxy port, llama-server port} on localhost — no more.
        #[test]
        fn preset_profile_allows_exactly_proxy_and_llama_ports() {
            let id = "test-preset-ports";
            let nc = make_network_config_with_extra(12345, vec![8137]);
            let result =
                generate_seatbelt_profile(id, "goose", &[], Some(&nc), true);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            assert!(
                content.contains(r#"(allow network-outbound (remote ip "localhost:12345"))"#),
                "preset profile must allow the proxy port:\n{}",
                content
            );
            assert!(
                content.contains(r#"(allow network-outbound (remote ip "localhost:8137"))"#),
                "preset profile must allow the llama-server port:\n{}",
                content
            );
            assert_eq!(
                localhost_allow_count(&content),
                2,
                "preset profile must allow EXACTLY 2 localhost ports (proxy + llama), got:\n{}",
                content
            );
        }

        // An ordinary agent (no extra ports) stays confined to the proxy port only.
        #[test]
        fn ordinary_agent_allows_only_proxy_port() {
            let id = "test-ordinary-ports";
            let nc = make_network_config(12345);
            let result =
                generate_seatbelt_profile(id, "claude-agent-acp", &[], Some(&nc), true);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            assert_eq!(
                localhost_allow_count(&content),
                1,
                "ordinary agent must allow EXACTLY the proxy port on localhost, got:\n{}",
                content
            );
        }

        // Goose's Bucket C row: its own config/cache/data/state dirs re-allowed,
        // sibling agent dirs still denied.
        #[test]
        fn goose_bucket_c_grants_own_dirs_only() {
            let id = "test-goose-bucket-c";
            let result = generate_seatbelt_profile(id, "goose", &[], None, false);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            // Goose's own conventional XDG dirs are the only Bucket C grants.
            for own in [".config/goose", ".cache/goose", ".local/share/goose", ".local/state/goose"] {
                assert!(
                    content.contains(&home_subpath_needle(own)),
                    "Goose profile must re-allow ~/{} — got:\n{}",
                    own,
                    content
                );
            }
            // Sibling agent config dirs stay denied.
            for sibling in [".claude", ".codex", ".gemini", ".copilot"] {
                assert!(
                    !content.contains(&home_subpath_needle(sibling)),
                    "Goose profile must NOT re-allow sibling {} — got:\n{}",
                    sibling,
                    content
                );
            }
        }

        #[test]
        fn profile_contains_deny_default() {
            let id = "test-deny-default";
            let result = generate_seatbelt_profile(id, "claude-agent-acp", &[], None, false);
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
            let result = generate_seatbelt_profile(id, "claude-agent-acp", &paths, None, false);
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
        fn read_policy_denies_home_by_default() {
            // Task #6d: the profile must deny all reads inside $HOME by
            // default. This is the rule that closes the sibling-path leak
            // (~/Code/A vs ~/Code/B) that #6c's enumeration shape left open.
            // Without this rule, ANY path in $HOME not explicitly denied was
            // broadly readable — an agent scoped to Project A could still
            // `cat` files in every other user directory outside the curated
            // deny list.
            let id = "test-home-deny";
            let result = generate_seatbelt_profile(id, "claude-agent-acp", &[], None, false);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            let home = dirs::home_dir().unwrap();
            let expected = format!("(deny file-read* (subpath \"{}\"))", home.display());
            assert!(
                content.contains(&expected),
                "Profile must deny reads inside $HOME by default; expected `{}` in:\n{}",
                expected, content,
            );
        }

        #[test]
        fn read_policy_reallows_runtime_and_agent_configs() {
            // After the deny-by-default on $HOME, the profile MUST re-allow
            // everything an ACP Node agent needs at init: language tooling
            // (~/.npm, ~/.nvm, ~/.yarn, ~/.volta, ~/.cargo, ~/.local, …),
            // XDG dirs (~/.config, ~/.cache), macOS native caches and prefs
            // (~/Library/Caches, ~/Library/Preferences, ~/Library/Application
            // Support), and each supported agent's config dir. Missing any
            // of these will deadlock agent init — the failure mode we saw
            // on 2026-04-19 when deny-by-default was tried without a
            // complete allow list.
            let id = "test-runtime-reallow";
            let result = generate_seatbelt_profile(id, "claude-agent-acp", &[], None, false);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            let home = dirs::home_dir().unwrap();
            let home_str = home.to_string_lossy();
            for dir in [
                // Bucket B — language tooling
                ".npm", ".npm-global", ".nvm", ".volta", ".fnm", ".asdf",
                ".yarn", ".pnpm", ".bun", ".deno", ".cargo", ".rustup",
                // XDG
                ".local", ".config", ".cache",
                // macOS native caches / prefs
                "Library/Caches", "Library/Application Support", "Library/Preferences",
                // Bucket C — this profile is for claude-agent-acp, so only
                // ~/.claude (plus the app's own ~/.notesage) is re-allowed.
                // Sibling agent dirs (.codex/.copilot/.gemini) are asserted
                // absent by `profile_does_not_leak_sibling_agent_configs`
                // below (task #24).
                ".claude", ".notesage",
            ] {
                let needle = format!("(subpath \"{}/{}\")", home_str, dir);
                assert!(
                    content.contains(&needle),
                    "Profile must re-allow reads in {}; expected `{}` in:\n{}",
                    dir, needle, content,
                );
            }
        }

        #[test]
        fn read_policy_narrows_keychain_to_login_db_only() {
            // Task #6d + #24: GitHub Copilot CLI reads
            // `~/Library/Keychains/login.keychain-db` to resolve its OAuth
            // token from the macOS Keychain (service name `copilot-cli`).
            // The FILE is encrypted at rest — reading it alone exposes
            // ciphertext; decryption still requires securityd + TCC.
            //
            // Two invariants:
            // 1. Copilot profile MUST allow the single keychain file by
            //    (literal), NOT the whole Keychains/ subpath.
            // 2. Non-Copilot agents MUST NOT get the keychain literal at
            //    all — they have no reason to touch node-keytar state.
            let id = "test-keychain-narrow";
            let result = generate_seatbelt_profile(id, "copilot", &[], None, false);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            let home = dirs::home_dir().unwrap();
            let home_str = home.to_string_lossy();
            let expected_literal = format!(
                "(literal \"{}/Library/Keychains/login.keychain-db\")",
                home_str
            );
            assert!(
                content.contains(&expected_literal),
                "Copilot profile must allow login.keychain-db by literal; expected `{}` in:\n{}",
                expected_literal, content,
            );

            let forbidden_subpath = format!("(subpath \"{}/Library/Keychains\")", home_str);
            assert!(
                !content.contains(&forbidden_subpath),
                "Profile must NOT allow the whole Keychains/ dir via subpath — use the narrow literal instead. Found: `{}`",
                forbidden_subpath,
            );
        }

        #[test]
        fn read_policy_keeps_broad_allow_for_system_paths() {
            // The broad `(allow file-read*)` rule must remain the FIRST read
            // rule — it covers everything outside $HOME (system libs, Homebrew,
            // /Applications, /usr, /private). The $HOME deny that follows
            // narrows the scope without blocking system access.
            let id = "test-broad-allow";
            let result = generate_seatbelt_profile(id, "claude-agent-acp", &[], None, false);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);

            assert!(
                content.contains("(allow file-read*)"),
                "Profile must keep broad `(allow file-read*)`; without it /usr, /opt/homebrew, /Applications become unreadable. Profile:\n{}",
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
            let result = generate_seatbelt_profile(id, "claude-agent-acp", &[project.to_string()], None, false);
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
            let result = generate_seatbelt_profile(id, "claude-agent-acp", &[], None, false);
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
            let result = generate_seatbelt_profile(id, "claude-agent-acp", &[], Some(&nc), true);
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
            let result = generate_seatbelt_profile(id, "claude-agent-acp", &[], Some(&nc), false);
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
            let result = generate_seatbelt_profile(id, "claude-agent-acp", &[], None, true);
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
            let result = generate_seatbelt_profile(id, "claude-agent-acp", &[], None, false);
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
            let result = generate_seatbelt_profile(id, "claude-agent-acp", &[], None, false);
            let path = result.expect("should generate profile");

            assert!(path.exists(), "Profile file must exist after generation");
            cleanup_profile(id);
            assert!(!path.exists(), "Profile file must be gone after cleanup");
        }

        #[test]
        fn sandboxed_command_returns_sandbox_exec() {
            let id = "test-cmd";
            let (program, args) = sandboxed_command(id, "claude-agent-acp", &[], None, false)
                .expect("sandboxed_command should succeed");
            cleanup_profile(id);

            assert_eq!(program, "sandbox-exec", "Program must be sandbox-exec");
            assert!(
                args.contains(&"-f".to_string()),
                "Args must contain -f flag"
            );
        }

        // ---------------------------------------------------------------------
        // Task #24 — per-agent writable config subpath
        //
        // The pre-#24 profile granted every agent writable access to every
        // supported agent's config dir (~/.claude, ~/.codex, ~/.copilot,
        // ~/.gemini). A claude-agent-acp instance could therefore read (and
        // write to) ~/.codex/ — leaking another provider's state. These tests
        // lock in the narrowing: each profile only emits the config
        // directories + adjacent state files for its own agent_binary.
        // ---------------------------------------------------------------------

        /// Helper: generate profile, read it, clean up, return contents.
        fn profile_contents(id: &str, agent_binary: &str) -> String {
            let result = generate_seatbelt_profile(id, agent_binary, &[], None, false);
            let path = result.expect("should generate profile");
            let content = std::fs::read_to_string(&path).unwrap();
            cleanup_profile(id);
            content
        }

        /// Helper: build a `(subpath "$HOME/<rel>")` needle.
        fn home_subpath_needle(rel: &str) -> String {
            let home = dirs::home_dir().unwrap();
            format!("(subpath \"{}/{}\")", home.to_string_lossy(), rel)
        }

        /// Helper: build a `(literal "$HOME/<rel>")` needle.
        fn home_literal_needle(rel: &str) -> String {
            let home = dirs::home_dir().unwrap();
            format!("(literal \"{}/{}\")", home.to_string_lossy(), rel)
        }

        #[test]
        fn claude_profile_does_not_leak_sibling_agent_configs() {
            let content = profile_contents("task24-claude", "claude-agent-acp");

            // Own config present (subpath for the dir + literal for the
            // sibling state file).
            assert!(
                content.contains(&home_subpath_needle(".claude")),
                "Claude profile must re-allow ~/.claude — got:\n{}",
                content,
            );
            assert!(
                content.contains(&home_literal_needle(".claude.json")),
                "Claude profile must re-allow ~/.claude.json literal — got:\n{}",
                content,
            );

            // Sibling agent dirs MUST be absent.
            for sibling in [".codex", ".copilot", ".gemini"] {
                assert!(
                    !content.contains(&home_subpath_needle(sibling)),
                    "Claude profile must NOT contain ~{}— leak of sibling agent config:\n{}",
                    sibling, content,
                );
            }

            // Keychain literal IS present — Claude's SDK reads OAuth tokens
            // via node-keytar at session/prompt time (same shape as Copilot).
            // Narrowed to the single login.keychain-db file so metadata /
            // per-user keychains stay denied.
            assert!(
                content.contains("Library/Keychains/login.keychain-db"),
                "Claude profile must allow login.keychain-db literal — required for session/prompt OAuth:\n{}",
                content,
            );
        }

        #[test]
        fn codex_profile_does_not_leak_sibling_agent_configs() {
            let content = profile_contents("task24-codex", "codex-acp");

            assert!(
                content.contains(&home_subpath_needle(".codex")),
                "Codex profile must re-allow ~/.codex — got:\n{}",
                content,
            );

            for sibling in [".claude", ".copilot", ".gemini"] {
                assert!(
                    !content.contains(&home_subpath_needle(sibling)),
                    "Codex profile must NOT contain ~{} — leak of sibling agent config:\n{}",
                    sibling, content,
                );
            }
            assert!(
                !content.contains(".claude.json"),
                "Codex profile must NOT contain .claude.json literal:\n{}",
                content,
            );
            assert!(
                !content.contains("Library/Keychains/login.keychain-db"),
                "Codex profile must NOT allow login.keychain-db — Copilot-specific:\n{}",
                content,
            );
        }

        #[test]
        fn copilot_profile_does_not_leak_sibling_agent_configs() {
            let content = profile_contents("task24-copilot", "copilot");

            assert!(
                content.contains(&home_subpath_needle(".copilot")),
                "Copilot profile must re-allow ~/.copilot — got:\n{}",
                content,
            );
            // Copilot-specific: narrow keychain literal IS allowed.
            assert!(
                content.contains("Library/Keychains/login.keychain-db"),
                "Copilot profile must allow login.keychain-db (node-keytar OAuth):\n{}",
                content,
            );

            for sibling in [".claude", ".codex", ".gemini"] {
                assert!(
                    !content.contains(&home_subpath_needle(sibling)),
                    "Copilot profile must NOT contain ~{} — leak of sibling agent config:\n{}",
                    sibling, content,
                );
            }
            assert!(
                !content.contains(".claude.json"),
                "Copilot profile must NOT contain .claude.json literal:\n{}",
                content,
            );
        }

        #[test]
        fn copilot_lsp_binary_also_gets_copilot_config() {
            // Both `copilot` (CLI) and `copilot-language-server` (LSP) map
            // to the same Copilot config narrowing.
            let content = profile_contents("task24-copilot-lsp", "copilot-language-server");
            assert!(
                content.contains(&home_subpath_needle(".copilot")),
                "copilot-language-server must re-allow ~/.copilot:\n{}",
                content,
            );
            assert!(
                content.contains("Library/Keychains/login.keychain-db"),
                "copilot-language-server must allow login.keychain-db:\n{}",
                content,
            );
        }

        #[test]
        fn gemini_profile_does_not_leak_sibling_agent_configs() {
            let content = profile_contents("task24-gemini", "gemini");

            assert!(
                content.contains(&home_subpath_needle(".gemini")),
                "Gemini profile must re-allow ~/.gemini — got:\n{}",
                content,
            );

            for sibling in [".claude", ".codex", ".copilot"] {
                assert!(
                    !content.contains(&home_subpath_needle(sibling)),
                    "Gemini profile must NOT contain ~{} — leak of sibling agent config:\n{}",
                    sibling, content,
                );
            }
            assert!(
                !content.contains(".claude.json"),
                "Gemini profile must NOT contain .claude.json literal:\n{}",
                content,
            );
            assert!(
                !content.contains("Library/Keychains/login.keychain-db"),
                "Gemini profile must NOT allow login.keychain-db — Copilot-specific:\n{}",
                content,
            );
        }

        #[test]
        fn unknown_agent_binary_gets_only_notesage_config() {
            // Defensive default: if an unknown/custom agent binary is
            // spawned under the sandbox, we don't leak any provider's
            // config dir. Only Notesage's own ~/.notesage remains so the
            // app itself can read bundled skills/meta.
            let content = profile_contents("task24-unknown", "some-random-agent");

            assert!(
                content.contains(&home_subpath_needle(".notesage")),
                "Unknown-agent profile must still re-allow ~/.notesage:\n{}",
                content,
            );
            for sibling in [".claude", ".codex", ".copilot", ".gemini"] {
                assert!(
                    !content.contains(&home_subpath_needle(sibling)),
                    "Unknown-agent profile must NOT contain ~{} — defense in depth:\n{}",
                    sibling, content,
                );
            }
            assert!(
                !content.contains(".claude.json"),
                "Unknown-agent profile must NOT contain .claude.json literal:\n{}",
                content,
            );
            assert!(
                !content.contains("Library/Keychains/login.keychain-db"),
                "Unknown-agent profile must NOT allow login.keychain-db:\n{}",
                content,
            );
        }

        // ---------------------------------------------------------------------
        // Local-AI-agents task #3 — conservative defaults for unknown/custom
        // agent binaries.
        //
        // Custom ACP agents (any binary the user registers) must start
        // maximally confined: no Bucket C re-allow entries, deny-by-default
        // $HOME reads, and the deny-last sensitive entries intact. The `_`
        // arm in `agent_config_entries` grants nothing — these tests lock
        // that in so a future Bucket C edit can't accidentally widen the
        // unknown-basename profile.
        // ---------------------------------------------------------------------

        #[test]
        fn unknown_basenames_get_no_bucket_c_entries() {
            // Bare names AND absolute paths (basename extraction must not
            // accidentally match a known agent for custom binaries).
            for (id, binary) in [
                ("task3-goose-custom", "goose-custom"),
                ("task3-my-agent", "my-agent"),
                ("task3-abs-custom", "/Users/peter/.notesage/agents/bin/my-agent"),
            ] {
                let content = profile_contents(id, binary);

                for bucket_c in [".claude", ".codex", ".copilot", ".gemini"] {
                    assert!(
                        !content.contains(&home_subpath_needle(bucket_c)),
                        "Unknown binary {binary} must NOT get ~{bucket_c} — Bucket C is opt-in via writable-paths UI:\n{content}",
                    );
                }
                assert!(
                    !content.contains(".claude.json"),
                    "Unknown binary {binary} must NOT get the .claude.json literal:\n{content}",
                );
                assert!(
                    !content.contains("Library/Keychains/login.keychain-db"),
                    "Unknown binary {binary} must NOT get the keychain literal:\n{content}",
                );
            }
        }

        #[test]
        fn known_basenames_keep_bucket_c_grants() {
            // One assertion per known agent — a future refactor of the
            // Bucket C table can't silently drop a grant without failing here.
            for (id, binary, expected) in [
                ("task3-keep-claude", "claude-agent-acp", ".claude"),
                ("task3-keep-codex", "codex-acp", ".codex"),
                ("task3-keep-copilot", "copilot", ".copilot"),
                ("task3-keep-copilot-lsp", "copilot-language-server", ".copilot"),
                ("task3-keep-gemini", "gemini", ".gemini"),
            ] {
                let content = profile_contents(id, binary);
                assert!(
                    content.contains(&home_subpath_needle(expected)),
                    "{binary} profile must keep its ~{expected} Bucket C grant:\n{content}",
                );
            }
        }

        #[test]
        fn unknown_basename_profile_keeps_home_deny_and_deny_last() {
            // Maximal confinement: the unknown-basename profile must keep the
            // deny-by-default $HOME read rule AND the explicit deny-last
            // sensitive entries — Bucket C narrowing must not perturb either.
            let content = profile_contents("task3-unknown-denies", "my-agent");

            let home = dirs::home_dir().unwrap();
            let home_deny = format!("(deny file-read* (subpath \"{}\"))", home.display());
            assert!(
                content.contains(&home_deny),
                "Unknown-agent profile must deny $HOME reads by default; expected `{}` in:\n{}",
                home_deny, content,
            );

            for sensitive in [".ssh", ".aws", ".gnupg"] {
                let needle = home_subpath_needle(sensitive);
                assert!(
                    content.contains(&needle),
                    "Unknown-agent profile must keep the ~{} deny-last entry; expected `{}` in:\n{}",
                    sensitive, needle, content,
                );
            }
            assert!(
                content.contains(r#"(regex #"\.env$")"#),
                "Unknown-agent profile must keep the .env deny regex:\n{}",
                content,
            );
            assert!(
                content.contains(r#"(regex #"\.env\..*$")"#),
                "Unknown-agent profile must keep the .env.* deny regex:\n{}",
                content,
            );
        }

        #[test]
        fn writable_block_narrowed_to_own_agent() {
            // Task #24 also narrows the file-write* block — a Claude profile
            // must NOT permit writes to ~/.codex, ~/.copilot, ~/.gemini.
            // Writes to the agent's OWN config dir remain allowed so it can
            // update its own state.
            let content = profile_contents("task24-write-claude", "claude-agent-acp");

            // The file-write* block is the one that appears AFTER the
            // `(allow file-write*` opening. A simple substring check on
            // the sibling path is sufficient — if any section contains it,
            // the profile leaks write access.
            for sibling in [".codex", ".copilot", ".gemini"] {
                assert!(
                    !content.contains(&home_subpath_needle(sibling)),
                    "Claude profile must NOT grant any access (read or write) to ~{}:\n{}",
                    sibling, content,
                );
            }
        }

        #[test]
        fn agent_config_entries_claude() {
            // Direct coverage of the mapping helper — locks in the exact
            // entry shape so future regressions surface here, not only in
            // the full-profile integration tests.
            let entries = agent_config_entries("claude-agent-acp");
            let has_claude_subpath = entries.iter().any(|e| matches!(e, SandboxEntry::Subpath(".claude")));
            let has_claude_json = entries.iter().any(|e| matches!(e, SandboxEntry::Literal(".claude.json")));
            let has_claude_json_backup = entries.iter().any(|e| matches!(e, SandboxEntry::Literal(".claude.json.backup")));
            let has_notesage = entries.iter().any(|e| matches!(e, SandboxEntry::Subpath(".notesage")));
            assert!(has_claude_subpath, "Missing .claude subpath entry");
            assert!(has_claude_json, "Missing .claude.json literal entry");
            assert!(has_claude_json_backup, "Missing .claude.json.backup literal entry");
            assert!(has_notesage, "Missing .notesage subpath entry");
            // No cross-agent contamination
            for rel in [".codex", ".copilot", ".gemini"] {
                assert!(
                    !entries.iter().any(|e| matches!(e, SandboxEntry::Subpath(r) if *r == rel)),
                    "claude mapping must not include {rel}"
                );
            }
        }

        #[test]
        fn agent_config_entries_copilot_includes_keychain() {
            let entries = agent_config_entries("copilot");
            let has_keychain = entries.iter().any(|e| matches!(
                e,
                SandboxEntry::Literal("Library/Keychains/login.keychain-db")
            ));
            assert!(
                has_keychain,
                "Copilot mapping must include login.keychain-db literal (node-keytar OAuth)"
            );
        }

        #[test]
        fn agent_config_entries_codex_gemini_exclude_keychain() {
            // Codex and Gemini don't use the macOS keychain — their OAuth
            // state lives in ~/.codex and ~/.gemini respectively. Claude
            // and Copilot both use node-keytar and need login.keychain-db
            // (covered by dedicated tests below).
            for binary in ["codex-acp", "gemini", "random-agent"] {
                let entries = agent_config_entries(binary);
                let has_keychain = entries.iter().any(|e| matches!(
                    e,
                    SandboxEntry::Literal("Library/Keychains/login.keychain-db")
                ));
                assert!(
                    !has_keychain,
                    "{binary} mapping must NOT include login.keychain-db"
                );
            }
        }

        #[test]
        fn agent_config_entries_claude_includes_keychain() {
            // Regression lock: Claude Code's SDK reads OAuth tokens from the
            // macOS keychain via node-keytar at session/prompt time. Without
            // it, session/new succeeds but session/prompt returns -32000
            // "Authentication required" — observed 2026-04-19.
            let entries = agent_config_entries("claude-agent-acp");
            let has_keychain = entries.iter().any(|e| matches!(
                e,
                SandboxEntry::Literal("Library/Keychains/login.keychain-db")
            ));
            assert!(
                has_keychain,
                "Claude mapping must include login.keychain-db literal (node-keytar OAuth token)"
            );
        }

        // Regression lock: acp.rs passes the RESOLVED absolute path to
        // sandboxed_command, not the raw command name. Before the basename
        // extraction in agent_config_entries, every absolute-path caller
        // fell into the `_` arm, silently stripping Bucket C and denying
        // ~/.codex, ~/.copilot, etc. — reproduced 2026-04-19 in user testing:
        // all three of Claude/Codex/Copilot failed at session/new because
        // config reads returned EPERM. Gemini worked because its OAuth
        // cache lives outside ~/.gemini.
        #[test]
        fn agent_config_entries_resolves_absolute_paths() {
            let cases = [
                ("/opt/homebrew/bin/claude-agent-acp", ".claude"),
                ("/Users/peter/.notesage/agents/bin/codex-acp", ".codex"),
                ("/opt/homebrew/bin/copilot", ".copilot"),
                ("/opt/homebrew/bin/gemini", ".gemini"),
            ];
            for (full_path, expected_subpath) in cases {
                let entries = agent_config_entries(full_path);
                let has_expected = entries.iter().any(|e|
                    matches!(e, SandboxEntry::Subpath(r) if *r == expected_subpath)
                );
                assert!(
                    has_expected,
                    "Absolute path {full_path} must resolve to {expected_subpath} (basename extraction); got {entries:?}"
                );
            }
        }

        // Task #17 (PRD 2026-07-29-pi-local-agent-preset) regression lock:
        // the pi preset's processes get NO Bucket C $HOME grants — the whole
        // footprint (PI_CODING_AGENT_DIR, sessions, extensions) lives under
        // the `.notesage` write-allow, so any future "helpful" grant for the
        // `pi` or `notesage-acp-pi` basenames would silently widen the
        // maximal-confinement guarantee. The network side is covered by the
        // existing exact-{proxy, llama} port lock, which is agent-agnostic.
        #[test]
        fn pi_preset_binaries_get_no_bucket_c_home_grants() {
            for binary in [
                "pi",
                "notesage-acp-pi",
                "/Users/peter/.notesage/agents/bin/pi",
                "/Users/peter/.notesage/agents/bin/notesage-acp-pi",
            ] {
                let entries = agent_config_entries(binary);
                assert!(
                    entries.is_empty(),
                    "{binary} must have ZERO Bucket C entries (maximal confinement); got {entries:?}"
                );
            }
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
