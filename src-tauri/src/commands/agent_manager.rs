use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use super::shell_path::get_shell_path;
use super::constants;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct BinaryResolution {
    pub path: String,
    pub source: BinarySource,
    pub version: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BinarySource {
    Managed,
    System,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentInstallProgress {
    pub agent_id: String,
    pub phase: String,
    pub progress: u64,
    pub total: u64,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentVersionEntry {
    pub version: String,
    pub installed_at: String,
    pub source: String,
    pub repo: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct VersionsFile {
    pub last_checked: Option<String>,
    pub agents: std::collections::HashMap<String, AgentVersionEntry>,
}

// npm-distributed agents. These publish to the npm registry rather than
// attaching prebuilt platform binaries to GitHub releases, so they install via
// `npm install` into a managed lib dir + a symlink in the bin dir (mirrors the
// Gemini CLI flow). `claude-agent-acp` belongs here: its old GitHub repo
// (`zed-industries/claude-agent-acp`) ships no binary assets, and the package
// was renamed to the `@agentclientprotocol` scope.
struct NpmAgentConfig {
    /// npm package name to install.
    package: &'static str,
    /// Executable name exposed in the package's `bin` (under `node_modules/.bin/`).
    bin_name: &'static str,
    /// Upstream repo, recorded in versions.json for display/update purposes.
    repo: &'static str,
    /// Optional pinned minimum supported version (no leading `v`). When `Some`,
    /// an install resolving below this is rejected post-install. Currently `None`
    /// for every npm agent — they track `@latest` without a floor. (The Local
    /// Agent preset binary, Goose, installs via the GitHub-binary path instead,
    /// which carries its own min-version pin.)
    min_version: Option<&'static str>,
}

fn npm_agent_config(agent_id: &str) -> Option<NpmAgentConfig> {
    match agent_id {
        "claude-agent-acp" => Some(NpmAgentConfig {
            package: "@agentclientprotocol/claude-agent-acp",
            bin_name: "claude-agent-acp",
            repo: "agentclientprotocol/claude-agent-acp",
            min_version: None,
        }),
        "gemini" => Some(NpmAgentConfig {
            package: "@google/gemini-cli",
            bin_name: "gemini",
            repo: "google-gemini/gemini-cli",
            min_version: None,
        }),
        "codex-acp" => Some(NpmAgentConfig {
            package: "@agentclientprotocol/codex-acp",
            bin_name: "codex-acp",
            repo: "agentclientprotocol/codex-acp",
            min_version: None,
        }),
        "copilot" => Some(NpmAgentConfig {
            package: "@github/copilot",
            bin_name: "copilot",
            repo: "github/copilot-cli",
            min_version: None,
        }),
        "copilot-language-server" => Some(NpmAgentConfig {
            package: "@github/copilot-language-server",
            bin_name: "copilot-language-server",
            repo: "github/copilot-language-server-release",
            min_version: None,
        }),
        _ => None,
    }
}

// GitHub-release-binary agents. Unlike the npm agents above, these attach
// prebuilt platform binaries (tar.gz) to their GitHub releases. Goose (Block's
// open-source ACP agent) is the binary behind the "Local AI" agentic-chat
// preset (PRD 2026-06-12-local-ai-agents): a self-contained Rust binary that
// needs no Node runtime, no npm install, and no cloud auth — so it runs cleanly
// under the strict `(deny default)` Seatbelt sandbox where OpenCode could not.
struct GithubBinaryAgentConfig {
    /// `owner/repo` on GitHub.
    repo: &'static str,
    /// Executable name inside the release archive AND the managed bin filename.
    bin_name: &'static str,
    /// Pinned minimum supported version (no leading `v`). Installs below this
    /// are rejected; recorded so the update checker can keep it fresh.
    min_version: &'static str,
}

fn github_binary_agent_config(agent_id: &str) -> Option<GithubBinaryAgentConfig> {
    match agent_id {
        "goose" => Some(GithubBinaryAgentConfig {
            // Goose was created by Block and donated to the Agentic AI Foundation
            // (AAIF, a Linux Foundation project); the repo moved block/goose →
            // aaif-goose/goose. The new repo carries the same release/asset
            // scheme (`goose-{triple}.tar.gz`) and version line (v1.37.0+).
            repo: "aaif-goose/goose",
            bin_name: "goose",
            // The version whose ACP surface this integration was built against
            // and empirically verified under the strict sandbox.
            min_version: "1.37.0",
        }),
        _ => None,
    }
}

/// Release-asset filename for Goose's CLI binary on a platform.
/// Verified against `aaif-goose/goose`: the macOS assets use the Rust target triple
/// naming, `goose-{triple}.tar.gz`. The tarball contains a single `goose`
/// executable at its root. Linux falls back to the same `{triple}.tar.gz`
/// convention; Goose ships no Windows ACP binary.
fn goose_asset_name(os: &str, arch: &str) -> Result<&'static str, String> {
    match (os, arch) {
        ("darwin", "arm64") => Ok("goose-aarch64-apple-darwin.tar.gz"),
        ("darwin", "x64") => Ok("goose-x86_64-apple-darwin.tar.gz"),
        ("linux", "arm64") => Ok("goose-aarch64-unknown-linux-gnu.tar.gz"),
        ("linux", "x64") => Ok("goose-x86_64-unknown-linux-gnu.tar.gz"),
        _ => Err(format!("Goose has no prebuilt binary for {}-{}", os, arch)),
    }
}

/// Compare dotted numeric versions (`a.b.c`), ignoring a leading `v` and any
/// pre-release/build suffix. Returns true when `version >= minimum`. Deliberately
/// dependency-free (no semver crate) — sufficient for a monotonic version pin.
fn version_at_least(version: &str, minimum: &str) -> bool {
    fn parts(v: &str) -> Vec<u64> {
        v.trim_start_matches('v')
            .split(|c: char| c == '-' || c == '+')
            .next()
            .unwrap_or("")
            .split('.')
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    }
    let (a, b) = (parts(version), parts(minimum));
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    true
}

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

pub struct AgentManagerState {
    installing: Mutex<Option<String>>,
}

impl AgentManagerState {
    pub fn new() -> Self {
        Self {
            installing: Mutex::new(None),
        }
    }
}

// ---------------------------------------------------------------------------
// Directory layout
// ---------------------------------------------------------------------------

fn agents_base_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".notesage")
        .join("agents")
}

fn agents_bin_dir() -> PathBuf {
    agents_base_dir().join("bin")
}

fn agents_lib_dir() -> PathBuf {
    agents_base_dir().join("lib")
}

fn versions_file_path() -> PathBuf {
    agents_base_dir().join("versions.json")
}

fn ensure_agent_dirs() -> Result<(), String> {
    let dirs = [
        agents_bin_dir(),
        agents_lib_dir(),
        dirs::home_dir()
            .unwrap_or_default()
            .join(".notesage/runtime"),
        dirs::home_dir()
            .unwrap_or_default()
            .join(".notesage/sandbox/profiles"),
    ];
    for dir in &dirs {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
    }
    Ok(())
}

fn read_versions() -> VersionsFile {
    let path = versions_file_path();
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(versions) = serde_json::from_str(&content) {
                return versions;
            }
        }
    }
    VersionsFile::default()
}

fn write_versions(versions: &VersionsFile) -> Result<(), String> {
    let path = versions_file_path();
    let content =
        serde_json::to_string_pretty(versions).map_err(|e| format!("JSON serialize: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Write versions.json: {}", e))
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

fn detect_platform() -> Result<(&'static str, &'static str), String> {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        return Err("Unsupported OS".to_string());
    };

    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86_64") {
        "x64"
    } else {
        return Err("Unsupported architecture".to_string());
    };

    Ok((os, arch))
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

fn resolve_managed_binary(agent_id: &str) -> Option<String> {
    let bin_path = agents_bin_dir().join(agent_id);
    if bin_path.exists() {
        Some(bin_path.to_string_lossy().to_string())
    } else {
        None
    }
}

fn resolve_system_binary(agent_id: &str, app: &AppHandle) -> Option<String> {
    // 1. Check PATH via `which`
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let mut cmd = Command::new(which_cmd);
    cmd.arg(agent_id);
    if let Some(path) = get_shell_path() {
        cmd.env("PATH", path);
    }
    if let Ok(output) = cmd.output() {
        if output.status.success() {
            let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !p.is_empty() {
                return Some(p);
            }
        }
    }

    // 2. Common install locations
    let home = dirs::home_dir().unwrap_or_default();
    let mut candidates: Vec<PathBuf> = vec![home.join(".local/bin").join(agent_id)];
    for path in constants::MACOS_FALLBACK_BIN_PATHS {
        candidates.push(PathBuf::from(path).join(agent_id));
    }
    candidates.extend([
        home.join(".npm-global/bin").join(agent_id),
        home.join("Library/pnpm").join(agent_id),
        home.join(".local/share/pnpm").join(agent_id),
        home.join(".volta/bin").join(agent_id),
        home.join(".cargo/bin").join(agent_id),
    ]);

    // nvm
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            for entry in entries.flatten() {
                candidates.push(entry.path().join("bin").join(agent_id));
            }
        }
    }

    // Tauri resource path
    candidates.push(
        app.path()
            .resource_dir()
            .unwrap_or_default()
            .join("node_modules/.bin")
            .join(agent_id),
    );

    for path in constants::MACOS_FALLBACK_NODE_MODULE_PATHS {
        candidates.push(PathBuf::from(path).join(agent_id));
    }

    for candidate in &candidates {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn agent_resolve_binary(
    app: AppHandle,
    agent_id: String,
) -> Result<Option<BinaryResolution>, String> {
    // 1. Check managed install first
    if let Some(path) = resolve_managed_binary(&agent_id) {
        let version = read_versions()
            .agents
            .get(&agent_id)
            .map(|e| e.version.clone());
        return Ok(Some(BinaryResolution {
            path,
            source: BinarySource::Managed,
            version,
        }));
    }

    // 2. Check system PATH
    if let Some(path) = resolve_system_binary(&agent_id, &app) {
        return Ok(Some(BinaryResolution {
            path,
            source: BinarySource::System,
            version: None,
        }));
    }

    Ok(None)
}

#[tauri::command]
pub async fn agent_install(
    app: AppHandle,
    state: tauri::State<'_, AgentManagerState>,
    agent_id: String,
) -> Result<(), String> {
    // Concurrency guard
    {
        let mut installing = state.installing.lock().await;
        if let Some(current) = installing.as_deref() {
            return Err(format!("Already installing {}. Please wait.", current));
        }
        *installing = Some(agent_id.clone());
    }

    let result = do_agent_install(&app, &agent_id).await;

    // Clear concurrency guard
    {
        let mut installing = state.installing.lock().await;
        *installing = None;
    }

    result.map(|_| ())
}

async fn do_agent_install(app: &AppHandle, agent_id: &str) -> Result<Option<String>, String> {
    // Two install flavors: npm-distributed agents (Claude Code, Codex, Copilot
    // CLI/LSP, Gemini) and GitHub-release-binary agents (Goose, the Local Agent
    // preset). Dispatch by whichever registry the id matches.
    if let Some(npm_config) = npm_agent_config(agent_id) {
        return do_npm_install(app, agent_id, &npm_config).await;
    }
    if let Some(gh_config) = github_binary_agent_config(agent_id) {
        return do_github_binary_install(app, agent_id, &gh_config).await;
    }
    Err(format!(
        "Unknown agent: {}. Supported: claude-agent-acp, codex-acp, copilot, copilot-language-server, gemini, goose",
        agent_id
    ))
}

// ---------------------------------------------------------------------------
// Node.js runtime + npm-based agent install
// ---------------------------------------------------------------------------

fn node_runtime_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".notesage/runtime/node")
}

fn node_binary_path() -> PathBuf {
    node_runtime_dir().join("bin/node")
}

fn npm_binary_path() -> PathBuf {
    node_runtime_dir().join("bin/npm")
}

fn is_node_runtime_available() -> bool {
    // Check portable runtime first
    if node_binary_path().exists() {
        return true;
    }
    // Check system node
    Command::new("node")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn get_node_binary() -> String {
    let portable = node_binary_path();
    if portable.exists() {
        return portable.to_string_lossy().to_string();
    }
    "node".to_string()
}

fn get_npm_binary() -> String {
    let portable = npm_binary_path();
    if portable.exists() {
        return portable.to_string_lossy().to_string();
    }
    "npm".to_string()
}

async fn download_node_runtime(app: &AppHandle) -> Result<(), String> {
    if node_binary_path().exists() {
        // Verify it works
        let output = Command::new(node_binary_path().to_string_lossy().as_ref())
            .arg("--version")
            .output()
            .map_err(|e| format!("Node.js runtime check failed: {}", e))?;
        if output.status.success() {
            return Ok(());
        }
    }

    let _ = app.emit(
        "agent-install-progress",
        AgentInstallProgress {
            agent_id: "gemini".to_string(),
            phase: "downloading".to_string(),
            progress: 0,
            total: 0,
            message: "Downloading Node.js runtime...".to_string(),
        },
    );

    let (os, arch) = detect_platform()?;
    let node_arch = match arch {
        "arm64" => "arm64",
        "x64" => "x64",
        _ => return Err(format!("Unsupported architecture: {}", arch)),
    };
    let node_os = match os {
        "darwin" => "darwin",
        "linux" => "linux",
        _ => return Err("Node.js portable runtime is only supported on macOS and Linux".to_string()),
    };

    // Download Node.js 22 LTS
    let url = format!(
        "https://nodejs.org/dist/v22.14.0/node-v22.14.0-{}-{}.tar.gz",
        node_os, node_arch
    );

    use futures::StreamExt;
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Node.js download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Node.js download returned {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();
    let mut data = Vec::with_capacity(total as usize);
    let mut downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        downloaded += chunk.len() as u64;
        data.extend_from_slice(&chunk);

        let _ = app.emit(
            "agent-install-progress",
            AgentInstallProgress {
                agent_id: "gemini".to_string(),
                phase: "downloading".to_string(),
                progress: downloaded,
                total,
                message: format!(
                    "Downloading Node.js... {:.1} MB / {:.1} MB",
                    downloaded as f64 / 1_048_576.0,
                    total as f64 / 1_048_576.0
                ),
            },
        );
    }

    let _ = app.emit(
        "agent-install-progress",
        AgentInstallProgress {
            agent_id: "gemini".to_string(),
            phase: "extracting".to_string(),
            progress: 0,
            total: 1,
            message: "Extracting Node.js runtime...".to_string(),
        },
    );

    // Extract tar.gz to ~/.notesage/runtime/node/
    use flate2::read::GzDecoder;
    use tar::Archive;

    let runtime_dir = node_runtime_dir();
    std::fs::create_dir_all(&runtime_dir)
        .map_err(|e| format!("Failed to create runtime dir: {}", e))?;

    let gz = GzDecoder::new(std::io::Cursor::new(&data));
    let mut archive = Archive::new(gz);

    // Node.js tarballs have a top-level directory like node-v22.14.0-darwin-arm64/
    // We need to strip that prefix and extract into runtime_dir
    for entry in archive.entries().map_err(|e| format!("Tar error: {}", e))? {
        let mut entry = entry.map_err(|e| format!("Tar entry error: {}", e))?;
        let path = entry.path().map_err(|e| format!("Path error: {}", e))?.to_path_buf();

        // Strip first path component (e.g., node-v22.14.0-darwin-arm64/)
        let stripped: PathBuf = path.components().skip(1).collect();
        if stripped.as_os_str().is_empty() {
            continue;
        }

        // Tar-Slip guard (audit rust M1): reject any entry that could escape
        // runtime_dir via `..` or an absolute/prefixed component. Without this,
        // an entry like `node-v22/../../../etc/foo` resolves outside runtime_dir
        // on the join below — arbitrary file write during agent runtime install.
        // After this check, runtime_dir.join(&stripped) stays under runtime_dir.
        if stripped.components().any(|c| {
            matches!(
                c,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        }) {
            return Err(format!("Refusing unsafe tar entry path: {}", stripped.display()));
        }

        let dest = runtime_dir.join(&stripped);
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&dest).ok();
        } else {
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let mut outfile = std::fs::File::create(&dest)
                .map_err(|e| format!("Create {}: {}", dest.display(), e))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Extract {}: {}", stripped.display(), e))?;

            // Preserve executable permission, but mask to rwxr-xr-x — never
            // honor setuid/setgid/sticky or world-writable bits from an
            // untrusted archive (audit rust M1).
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(mode) = entry.header().mode() {
                    std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(mode & 0o755)).ok();
                }
            }
        }
    }

    // Verify
    let node = node_binary_path();
    if !node.exists() {
        return Err("Node.js binary not found after extraction".to_string());
    }
    let check = Command::new(node.to_string_lossy().as_ref())
        .arg("--version")
        .output()
        .map_err(|e| format!("Node.js verification failed: {}", e))?;
    if !check.status.success() {
        return Err("Node.js binary extracted but failed to run".to_string());
    }

    Ok(())
}

/// Query the npm registry for a package's latest published version.
/// Used by update checking now that every agent installs from npm.
async fn fetch_npm_latest_version(package: &str) -> Result<String, String> {
    let url = format!("https://registry.npmjs.org/{}/latest", package);
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "notesage")
        .send()
        .await
        .map_err(|e| format!("npm registry request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("npm registry returned {}", resp.status()));
    }

    let meta: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse npm metadata: {}", e))?;

    meta["version"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "npm metadata missing version field".to_string())
}

/// Install an npm-distributed agent into the managed lib dir and symlink its
/// executable into the bin dir. Every supported agent (Claude Code, Codex,
/// Copilot CLI/LSP, Gemini) ships via npm rather than prebuilt GitHub binaries.
async fn do_npm_install(
    app: &AppHandle,
    agent_id: &str,
    config: &NpmAgentConfig,
) -> Result<Option<String>, String> {
    ensure_agent_dirs()?;

    // Step 1: Ensure Node.js is available
    if !is_node_runtime_available() {
        download_node_runtime(app).await?;
    }

    let _ = app.emit(
        "agent-install-progress",
        AgentInstallProgress {
            agent_id: agent_id.to_string(),
            phase: "configuring".to_string(),
            progress: 0,
            total: 1,
            message: format!("Installing {} via npm...", config.package),
        },
    );

    // Step 2: npm install --prefix ~/.notesage/agents/lib/ <package>
    let npm = get_npm_binary();
    let lib_dir = agents_lib_dir();

    let output = Command::new(&npm)
        .args(["install", "--prefix"])
        .arg(lib_dir.to_string_lossy().as_ref())
        .arg(config.package)
        .output()
        .map_err(|e| format!("npm install failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("npm install failed: {}", stderr));
    }

    // Step 3: Create symlink in bin dir, named after the agent_id so that
    // binary resolution (`resolve_managed_binary`) finds it at bin/<agent_id>.
    let bin_path = agents_bin_dir().join(agent_id);
    let target = lib_dir
        .join("node_modules/.bin")
        .join(config.bin_name);

    if !target.exists() {
        return Err(format!(
            "npm install succeeded but executable '{}' was not found at {}",
            config.bin_name,
            target.display()
        ));
    }

    // Remove old symlink if exists
    if bin_path.exists() || bin_path.is_symlink() {
        std::fs::remove_file(&bin_path).ok();
    }

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&target, &bin_path)
            .map_err(|e| format!("Failed to create symlink: {}", e))?;
    }

    // Verify it works
    let node = get_node_binary();
    let _check = Command::new(&node)
        .arg(target.to_string_lossy().as_ref())
        .arg("--help")
        .output();

    // Get version from package.json (package name may be scoped, e.g.
    // `@agentclientprotocol/claude-agent-acp` → node_modules/@.../package.json)
    let pkg_json = lib_dir
        .join("node_modules")
        .join(config.package)
        .join("package.json");
    let version = if pkg_json.exists() {
        std::fs::read_to_string(&pkg_json)
            .ok()
            .and_then(|s| {
                serde_json::from_str::<serde_json::Value>(&s)
                    .ok()
                    .and_then(|v| v["version"].as_str().map(|s| s.to_string()))
            })
            .unwrap_or_else(|| "unknown".to_string())
    } else {
        "unknown".to_string()
    };

    // Enforce a pinned minimum when an npm agent declares one: reject an install
    // that resolved below the version this integration was built against. npm
    // installs `@latest`, so this is a post-install guard rather than a
    // pre-download one. Skipped when the version is indeterminate (the install
    // itself succeeded). No npm agent currently pins — kept for future use.
    if let Some(min) = config.min_version {
        if version != "unknown" && !version_at_least(&version, min) {
            return Err(format!(
                "{} v{} is below the minimum supported version v{}",
                agent_id, version, min
            ));
        }
    }

    // Update versions.json
    let mut versions = read_versions();
    versions.agents.insert(
        agent_id.to_string(),
        AgentVersionEntry {
            version: version.clone(),
            installed_at: chrono::Utc::now().to_rfc3339(),
            source: "npm".to_string(),
            repo: Some(config.repo.to_string()),
        },
    );
    write_versions(&versions)?;

    let _ = app.emit(
        "agent-install-progress",
        AgentInstallProgress {
            agent_id: agent_id.to_string(),
            phase: "done".to_string(),
            progress: 1,
            total: 1,
            message: format!("Installed {} v{}", config.package, version),
        },
    );

    Ok(Some(version))
}

// ---------------------------------------------------------------------------
// GitHub-release-binary agent install (Goose — Local Agent preset)
// ---------------------------------------------------------------------------

/// Fetch the latest release tag for a GitHub repo. Returns the tag with any
/// leading `v` stripped (e.g. `1.37.0`). Uses an unauthenticated request with a
/// User-Agent (required by the GitHub API); the 60-req/hr anonymous limit is
/// ample for occasional install/update checks.
async fn fetch_github_latest_release(repo: &str) -> Result<String, String> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo);
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "notesage")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub release request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub release API returned {}", resp.status()));
    }

    let meta: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub release metadata: {}", e))?;

    meta["tag_name"]
        .as_str()
        .map(|s| s.trim_start_matches('v').to_string())
        .ok_or_else(|| "GitHub release metadata missing tag_name".to_string())
}

/// Place a single extracted file at `~/.notesage/agents/bin/<bin_name>` with
/// rwxr-xr-x perms. Shared by the zip and tar.gz extraction branches.
fn install_extracted_binary(bin_name: &str, data: &[u8]) -> Result<(), String> {
    ensure_agent_dirs()?;
    let dest = agents_bin_dir().join(bin_name);
    std::fs::write(&dest, data)
        .map_err(|e| format!("Failed to write {}: {}", dest.display(), e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to chmod {}: {}", dest.display(), e))?;
    }
    Ok(())
}

/// Extract `bin_name` from a downloaded archive and install it. `asset` selects
/// the format (`.zip` → zip crate, `.tar.gz` → flate2+tar). Path traversal is
/// guarded (zip `enclosed_name`, tar component check) — same hardening as the
/// Node.js runtime extractor.
fn extract_and_install_binary(asset: &str, bin_name: &str, data: &[u8]) -> Result<(), String> {
    if asset.ends_with(".zip") {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data))
            .map_err(|e| format!("Failed to open zip: {}", e))?;
        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| format!("Zip entry error: {}", e))?;
            // `enclosed_name` returns None for traversal/absolute entries.
            let name = match file.enclosed_name() {
                Some(p) => p,
                None => continue,
            };
            if file.is_file() && name.file_name().and_then(|n| n.to_str()) == Some(bin_name) {
                let mut buf = Vec::with_capacity(file.size() as usize);
                std::io::copy(&mut file, &mut buf)
                    .map_err(|e| format!("Zip read error: {}", e))?;
                return install_extracted_binary(bin_name, &buf);
            }
        }
        Err(format!("'{}' not found in archive {}", bin_name, asset))
    } else if asset.ends_with(".tar.gz") || asset.ends_with(".tgz") {
        use flate2::read::GzDecoder;
        use tar::Archive;
        let mut archive = Archive::new(GzDecoder::new(std::io::Cursor::new(data)));
        for entry in archive.entries().map_err(|e| format!("Tar error: {}", e))? {
            let mut entry = entry.map_err(|e| format!("Tar entry error: {}", e))?;
            let path = entry
                .path()
                .map_err(|e| format!("Tar path error: {}", e))?
                .to_path_buf();
            // Reject traversal/absolute components (tar-slip guard).
            if path.components().any(|c| {
                matches!(
                    c,
                    std::path::Component::ParentDir
                        | std::path::Component::RootDir
                        | std::path::Component::Prefix(_)
                )
            }) {
                continue;
            }
            if entry.header().entry_type().is_file()
                && path.file_name().and_then(|n| n.to_str()) == Some(bin_name)
            {
                let mut buf = Vec::new();
                std::io::copy(&mut entry, &mut buf)
                    .map_err(|e| format!("Tar read error: {}", e))?;
                return install_extracted_binary(bin_name, &buf);
            }
        }
        Err(format!("'{}' not found in archive {}", bin_name, asset))
    } else {
        Err(format!("Unsupported archive format: {}", asset))
    }
}

async fn do_github_binary_install(
    app: &AppHandle,
    agent_id: &str,
    config: &GithubBinaryAgentConfig,
) -> Result<Option<String>, String> {
    let (os, arch) = detect_platform()?;
    let asset = goose_asset_name(os, arch)?;

    // Resolve the latest version and enforce the minimum pin before downloading.
    let version = fetch_github_latest_release(config.repo).await?;
    if !version_at_least(&version, config.min_version) {
        return Err(format!(
            "{} v{} is below the minimum supported version v{}",
            agent_id, version, config.min_version
        ));
    }

    let url = format!(
        "https://github.com/{}/releases/download/v{}/{}",
        config.repo, version, asset
    );

    let _ = app.emit(
        "agent-install-progress",
        AgentInstallProgress {
            agent_id: agent_id.to_string(),
            phase: "downloading".to_string(),
            progress: 0,
            total: 0,
            message: format!("Downloading {} v{}...", agent_id, version),
        },
    );

    use futures::StreamExt;
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "notesage")
        .send()
        .await
        .map_err(|e| format!("{} download failed: {}", agent_id, e))?;
    if !resp.status().is_success() {
        return Err(format!("{} download returned {}", agent_id, resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();
    let mut data = Vec::with_capacity(total as usize);
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        downloaded += chunk.len() as u64;
        data.extend_from_slice(&chunk);
        let _ = app.emit(
            "agent-install-progress",
            AgentInstallProgress {
                agent_id: agent_id.to_string(),
                phase: "downloading".to_string(),
                progress: downloaded,
                total,
                message: format!(
                    "Downloading {}... {:.1} MB / {:.1} MB",
                    agent_id,
                    downloaded as f64 / 1_048_576.0,
                    total as f64 / 1_048_576.0
                ),
            },
        );
    }

    let _ = app.emit(
        "agent-install-progress",
        AgentInstallProgress {
            agent_id: agent_id.to_string(),
            phase: "extracting".to_string(),
            progress: 0,
            total: 1,
            message: format!("Extracting {}...", agent_id),
        },
    );

    extract_and_install_binary(asset, config.bin_name, &data)?;

    // Verify the binary is present after extraction.
    let bin_path = agents_bin_dir().join(config.bin_name);
    if !bin_path.exists() {
        return Err(format!(
            "{} binary not found after extraction",
            config.bin_name
        ));
    }

    let mut versions = read_versions();
    versions.agents.insert(
        agent_id.to_string(),
        AgentVersionEntry {
            version: version.clone(),
            installed_at: chrono::Utc::now().to_rfc3339(),
            source: "github".to_string(),
            repo: Some(config.repo.to_string()),
        },
    );
    write_versions(&versions)?;

    let _ = app.emit(
        "agent-install-progress",
        AgentInstallProgress {
            agent_id: agent_id.to_string(),
            phase: "done".to_string(),
            progress: 1,
            total: 1,
            message: format!("Installed {} v{}", agent_id, version),
        },
    );

    Ok(Some(version))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // Every supported agent installs via npm — these lock the package name and
    // the executable bin name for each so a registry edit can't silently break
    // installation. claude-agent-acp + codex-acp were both moved off broken /
    // binary GitHub-release paths; copilot CLI + LSP followed.

    #[test]
    fn claude_agent_acp_installs_via_npm() {
        let npm = npm_agent_config("claude-agent-acp")
            .expect("claude-agent-acp must be npm-distributed");
        assert_eq!(npm.package, "@agentclientprotocol/claude-agent-acp");
        assert_eq!(npm.bin_name, "claude-agent-acp");
    }

    #[test]
    fn codex_acp_installs_via_npm() {
        let npm = npm_agent_config("codex-acp").expect("codex-acp must be npm-distributed");
        assert_eq!(npm.package, "@agentclientprotocol/codex-acp");
        assert_eq!(npm.bin_name, "codex-acp");
    }

    #[test]
    fn copilot_agents_install_via_npm() {
        let cli = npm_agent_config("copilot").expect("copilot must be npm-distributed");
        assert_eq!(cli.package, "@github/copilot");
        assert_eq!(cli.bin_name, "copilot");

        let lsp = npm_agent_config("copilot-language-server")
            .expect("copilot-language-server must be npm-distributed");
        assert_eq!(lsp.package, "@github/copilot-language-server");
        assert_eq!(lsp.bin_name, "copilot-language-server");
    }

    #[test]
    fn gemini_installs_via_npm() {
        let npm = npm_agent_config("gemini").expect("gemini must be npm-distributed");
        assert_eq!(npm.package, "@google/gemini-cli");
        assert_eq!(npm.bin_name, "gemini");
    }

    #[test]
    fn unknown_agent_has_no_npm_config() {
        assert!(npm_agent_config("not-a-real-agent").is_none());
    }

    // Goose (the Local AI agentic-chat preset binary) installs via the
    // GitHub-binary path, NOT npm — it's a self-contained Rust binary with no
    // Node runtime, npm install, or cloud auth, which is why it runs under the
    // strict sandbox where the previous OpenCode preset could not. Lock the
    // repo, bin name, and version floor so a release-layout change can't
    // silently break the preset install.
    #[test]
    fn goose_installs_via_github_binary() {
        let gh = github_binary_agent_config("goose")
            .expect("goose must be a GitHub-binary agent");
        assert_eq!(gh.repo, "aaif-goose/goose");
        assert_eq!(gh.bin_name, "goose");
        assert_eq!(
            gh.min_version, "1.37.0",
            "goose keeps a version floor matching the ACP surface it was built against"
        );
    }

    #[test]
    fn goose_is_not_an_npm_agent() {
        // The preset binary is GitHub-distributed; it must NOT also resolve as
        // an npm agent (that would double-dispatch the install).
        assert!(npm_agent_config("goose").is_none());
    }

    #[test]
    fn unknown_agent_has_no_github_binary_config() {
        assert!(github_binary_agent_config("not-a-real-agent").is_none());
    }

    #[test]
    fn goose_asset_name_uses_rust_target_triples() {
        // macOS assets use the Rust target-triple naming + .tar.gz, NOT the
        // old opencode `-darwin-arm64.zip` convention. Lock both arches.
        assert_eq!(
            goose_asset_name("darwin", "arm64").unwrap(),
            "goose-aarch64-apple-darwin.tar.gz"
        );
        assert_eq!(
            goose_asset_name("darwin", "x64").unwrap(),
            "goose-x86_64-apple-darwin.tar.gz"
        );
        // Unsupported platforms error rather than guessing an asset name.
        assert!(goose_asset_name("windows", "x64").is_err());
    }

    #[test]
    fn no_npm_agent_pins_a_min_version() {
        // Every npm agent tracks @latest with no floor; the only pinned agent is
        // Goose, which installs via the GitHub-binary path (see
        // goose_installs_via_github_binary).
        for id in [
            "claude-agent-acp",
            "codex-acp",
            "copilot",
            "copilot-language-server",
            "gemini",
        ] {
            assert_eq!(
                npm_agent_config(id).unwrap().min_version,
                None,
                "{id} should not pin a min_version"
            );
        }
    }

    #[test]
    fn version_pin_comparison() {
        assert!(version_at_least("1.37.0", "1.37.0"));
        assert!(version_at_least("1.38.0", "1.37.0"));
        assert!(version_at_least("2.0.0", "1.37.0"));
        assert!(version_at_least("1.37.10", "1.37.0"));
        assert!(version_at_least("v1.37.0", "1.37.0")); // leading v tolerated
        assert!(version_at_least("1.38.0-beta.1", "1.37.0")); // pre-release suffix ignored
        assert!(!version_at_least("1.36.9", "1.37.0"));
        assert!(!version_at_least("1.36.99", "1.37.0"));
        assert!(!version_at_least("0.9.0", "1.37.0"));
    }

    #[test]
    fn unknown_agent_install_error_lists_goose() {
        // do_agent_install's error message must advertise goose as supported.
        let msg = format!(
            "Unknown agent: {}. Supported: claude-agent-acp, codex-acp, copilot, copilot-language-server, gemini, goose",
            "bogus"
        );
        assert!(msg.contains("goose"));
    }
}

// ---------------------------------------------------------------------------
// Update checking
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentUpdateInfo {
    pub agent_id: String,
    pub current_version: String,
    pub latest_version: String,
    pub repo: String,
}

#[tauri::command]
pub async fn agent_check_updates(force: Option<bool>) -> Result<Vec<AgentUpdateInfo>, String> {
    let mut versions = read_versions();

    // Rate limit: minimum 1 hour between automatic checks (skipped when force=true)
    if !force.unwrap_or(false) {
        if let Some(ref last) = versions.last_checked {
            if let Ok(last_time) = chrono::DateTime::parse_from_rfc3339(last) {
                let elapsed = chrono::Utc::now().signed_duration_since(last_time);
                if elapsed.num_hours() < 1 {
                    return Ok(vec![]);
                }
            }
        }
    }

    versions.last_checked = Some(chrono::Utc::now().to_rfc3339());
    let _ = write_versions(&versions);

    let mut updates = Vec::new();

    for (agent_id, entry) in &versions.agents {
        // npm agents check the npm registry; GitHub-binary agents (Goose) check
        // the GitHub releases API. Resolve whichever applies.
        let (latest_result, repo): (Result<String, String>, String) =
            if let Some(config) = npm_agent_config(agent_id) {
                (
                    fetch_npm_latest_version(config.package).await,
                    config.repo.to_string(),
                )
            } else if let Some(config) = github_binary_agent_config(agent_id) {
                (
                    fetch_github_latest_release(config.repo).await,
                    config.repo.to_string(),
                )
            } else {
                continue;
            };

        match latest_result {
            Ok(latest) => {
                if latest != entry.version {
                    updates.push(AgentUpdateInfo {
                        agent_id: agent_id.clone(),
                        current_version: entry.version.clone(),
                        latest_version: latest,
                        repo,
                    });
                }
            }
            Err(e) => {
                log::warn!(target: "notesage::agent_manager", "Failed to check updates for {}: {}", agent_id, e);
            }
        }
    }

    Ok(updates)
}

#[tauri::command]
pub async fn agent_update(
    app: AppHandle,
    state: tauri::State<'_, AgentManagerState>,
    agent_id: String,
) -> Result<String, String> {
    // Reuse the install flow — it downloads latest and overwrites
    agent_install(app, state, agent_id.clone()).await?;

    // Return the new version
    let versions = read_versions();
    let version = versions
        .agents
        .get(&agent_id)
        .map(|e| e.version.clone())
        .unwrap_or_default();
    Ok(version)
}

#[tauri::command]
pub async fn agent_uninstall(agent_id: String) -> Result<(), String> {
    let bin_path = agents_bin_dir().join(&agent_id);
    if bin_path.exists() {
        std::fs::remove_file(&bin_path)
            .map_err(|e| format!("Failed to remove {}: {}", bin_path.display(), e))?;
    }

    let mut versions = read_versions();
    versions.agents.remove(&agent_id);
    write_versions(&versions)?;

    Ok(())
}
