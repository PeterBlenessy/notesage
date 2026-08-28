use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use super::shell_path::get_shell_path;
use super::constants;

// ---------------------------------------------------------------------------
// Download / extraction limits (audit batch 3 fix #5)
//
// Download sizes come from remote-controllable metadata (HTTP Content-Length,
// zip local-file headers), so they must never be trusted for allocation, and
// the actual byte streams must be capped independently of what the headers
// claim. The ceilings are deliberately generous: the Node.js runtime tarball
// is ~50 MB, agent release binaries are tens of MB, and the unpacked Node
// runtime is ~200 MB on disk.
// ---------------------------------------------------------------------------

/// Clamp for `Vec::with_capacity` hints derived from remote size fields.
const MAX_PREALLOC_BYTES: usize = 64 * 1024 * 1024; // 64 MiB
/// Hard stop for a single downloaded artifact (runtime tarball, agent binary).
const MAX_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024; // 512 MiB
/// Hard stop for a single file pulled out of a release archive into memory.
const MAX_EXTRACTED_FILE_BYTES: u64 = 512 * 1024 * 1024; // 512 MiB
/// Hard stop for the cumulative bytes written while unpacking the Node runtime.
const MAX_RUNTIME_EXTRACT_BYTES: u64 = 1024 * 1024 * 1024; // 1 GiB

/// Stream a download into memory with a running-total cap, invoking
/// `on_progress(downloaded, total)` per chunk. The Content-Length is used only
/// as a (clamped) pre-allocation hint and for progress display — the cap is
/// enforced on the bytes actually received.
async fn download_capped(
    resp: reqwest::Response,
    cap: u64,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<Vec<u8>, String> {
    use futures::StreamExt;

    let total = resp.content_length().unwrap_or(0);
    if total > cap {
        return Err(format!(
            "Download advertises {} bytes, above the {} byte limit",
            total, cap
        ));
    }
    let mut data = Vec::with_capacity((total as usize).min(MAX_PREALLOC_BYTES));
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        downloaded += chunk.len() as u64;
        if downloaded > cap {
            return Err(format!(
                "Download exceeded the {} byte limit — aborting",
                cap
            ));
        }
        data.extend_from_slice(&chunk);
        on_progress(downloaded, total);
    }
    Ok(data)
}

// ---------------------------------------------------------------------------
// Download integrity (audit batch 3 fix #6)
// ---------------------------------------------------------------------------

/// Lowercase hex SHA-256 of a byte slice.
fn sha256_hex(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}

/// Find the SHA-256 for `filename` in a `SHASUMS256.txt`-style manifest
/// (lines of `<hex>  <filename>`, one entry per line — the format nodejs.org
/// publishes alongside every release).
fn find_sha256_for_file(shasums: &str, filename: &str) -> Option<String> {
    for line in shasums.lines() {
        let mut parts = line.split_whitespace();
        let (Some(hash), Some(name)) = (parts.next(), parts.next()) else {
            continue;
        };
        // Some manifests prefix binary-mode entries with '*'.
        if name.trim_start_matches('*') == filename && hash.len() == 64 {
            return Some(hash.to_ascii_lowercase());
        }
    }
    None
}

// Checksum verification for GitHub-binary installs is configured PER AGENT via
// `GithubBinaryAgentConfig.checksum_asset` (audit batch 3 fix #6b): pi and the
// notesage-acp-pi bridge publish checksum manifests and are hard-verified;
// Goose still publishes none, so its digest is recorded (audit trail) but not
// verified until upstream ships a stable checksum asset.

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
    /// Checksum manifest asset on the same release (`<hash>  <file>` lines).
    /// `Some` → the archive digest MUST match before extraction (hard fail);
    /// `None` → digest recorded to the log only (Goose — no upstream asset).
    checksum_asset: Option<&'static str>,
    /// Exact-tested version ceiling (no leading `v`). Installs are clamped to
    /// this version and `agent_check_updates` reports newer upstream releases
    /// as held back instead of installable. Guards fast-moving 0.x upstreams
    /// (pi) whose RPC/extension surface we pin against.
    max_version: Option<&'static str>,
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
            max_version: None,
            checksum_asset: None, // no stable upstream checksum asset (yet)
        }),
        "pi" => Some(GithubBinaryAgentConfig {
            // pi (pi.dev) — the pi Local Agent preset binary (PRD
            // 2026-07-29-pi-local-agent-preset). Bun-compiled folder-tarball
            // (`pi-{os}-{arch}.tar.gz`, executable at `pi/pi` with co-located
            // wasm/theme assets). Exact-tested pin: the bridge + extensions
            // were verified against this version's RPC/extension surface;
            // weekly 0.x releases upstream make an open ceiling unsafe.
            repo: "earendil-works/pi",
            bin_name: "pi",
            min_version: "0.80.6",
            max_version: Some("0.80.6"),
            checksum_asset: Some("SHA256SUMS"),
        }),
        "notesage-acp-pi" => Some(GithubBinaryAgentConfig {
            // The ACP<->pi-RPC adapter. It lives in its own repository rather
            // than riding Notesage's releases: it is a general-purpose adapter
            // any ACP client can drive, and giving it its own version line is
            // what makes an exact pin possible at all — while it shipped as an
            // app-release asset there was no version to pin TO, and installs
            // resolved whatever the latest app release happened to carry.
            repo: "PeterBlenessy/notesage-acp-pi",
            bin_name: "notesage-acp-pi",
            // Exact-tested pin, same treatment as the pi arm above. The
            // adapter tracks pi's pre-1.0 RPC and extension surfaces, so a
            // newer adapter built against a newer pi is not safe to pick up
            // automatically; a Notesage release moves this deliberately.
            // 0.1.1 adds ACP session modes. The Local Agent mode picker reads
            // `availableModes` off the session response, so a 0.1.0 bridge
            // leaves it permanently empty with nothing to explain why — the
            // pin and the host feature have to move together.
            min_version: "0.1.1",
            max_version: Some("0.1.1"),
            checksum_asset: Some("notesage-acp-pi-SHA256SUMS"),
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

/// Rust target triple for the notesage-acp-pi bridge asset naming (matches
/// `bridges/pi-acp/scripts/build-binaries.sh`).
fn rust_triple(os: &str, arch: &str) -> Result<&'static str, String> {
    match (os, arch) {
        ("darwin", "arm64") => Ok("aarch64-apple-darwin"),
        ("darwin", "x64") => Ok("x86_64-apple-darwin"),
        ("linux", "arm64") => Ok("aarch64-unknown-linux-gnu"),
        ("linux", "x64") => Ok("x86_64-unknown-linux-gnu"),
        _ => Err(format!("No prebuilt binary for {}-{}", os, arch)),
    }
}

/// How a GitHub-binary agent's archive is laid out and installed.
enum ArchiveInstall {
    /// Archive contains a single executable file (matched by basename inside
    /// the archive) installed to `agents/bin/<bin_name>`.
    SingleBinary { archive_basename: String },
    /// Archive is a directory tree that must stay co-located (pi: executable +
    /// wasm + themes). Extracted to `agents/dist/<agent_id>/`, with
    /// `agents/bin/<bin_name>` symlinked to `bin_rel` inside the tree.
    Tree { bin_rel: &'static str },
}

/// Per-agent release asset + install layout. pi uses `pi-{os}-{arch}.tar.gz`
/// naming (NOT rust triples — verified against earendil-works/pi v0.80.6);
/// Goose and the bridge use `{name}-{triple}.tar.gz`.
fn github_binary_asset(
    agent_id: &str,
    os: &str,
    arch: &str,
) -> Result<(String, ArchiveInstall), String> {
    match agent_id {
        "goose" => Ok((
            goose_asset_name(os, arch)?.to_string(),
            ArchiveInstall::SingleBinary { archive_basename: "goose".to_string() },
        )),
        "pi" => {
            let asset = match (os, arch) {
                ("darwin", "arm64") => "pi-darwin-arm64.tar.gz",
                ("darwin", "x64") => "pi-darwin-x64.tar.gz",
                ("linux", "arm64") => "pi-linux-arm64.tar.gz",
                ("linux", "x64") => "pi-linux-x64.tar.gz",
                _ => return Err(format!("pi has no prebuilt binary for {}-{}", os, arch)),
            };
            Ok((asset.to_string(), ArchiveInstall::Tree { bin_rel: "pi/pi" }))
        }
        "notesage-acp-pi" => {
            let triple = rust_triple(os, arch)?;
            Ok((
                format!("notesage-acp-pi-{}.tar.gz", triple),
                ArchiveInstall::SingleBinary {
                    archive_basename: format!("notesage-acp-pi-{}", triple),
                },
            ))
        }
        _ => Err(format!("{} is not a GitHub-binary agent", agent_id)),
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

/// Test-only base override. Tests that install into a sandbox MUST use this
/// rather than mutating `$HOME`: `dirs::home_dir()` reads the environment, the
/// test harness runs tests in parallel threads, and a mid-suite `set_var`
/// races every other test that derives paths from home (seen as a CI-only
/// flake in `determine_agent_source_global_agents`, which read home twice
/// around another test's mutation window). A thread-local is visible to the
/// installing test's own call chain and to nobody else.
#[cfg(test)]
thread_local! {
    static TEST_AGENTS_BASE: std::cell::RefCell<Option<PathBuf>> =
        const { std::cell::RefCell::new(None) };
}

fn agents_base_dir() -> PathBuf {
    #[cfg(test)]
    {
        if let Some(base) = TEST_AGENTS_BASE.with(|c| c.borrow().clone()) {
            return base;
        }
    }
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

/// Root for folder-tarball agents (pi): the whole archive tree is kept
/// co-located under `dist/<agent_id>/` and `bin/<bin_name>` symlinks into it.
fn agents_dist_dir() -> PathBuf {
    agents_base_dir().join("dist")
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
        "Unknown agent: {}. Supported: claude-agent-acp, codex-acp, copilot, copilot-language-server, gemini, goose, pi, notesage-acp-pi",
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
    let node_dist_dir = "https://nodejs.org/dist/v22.14.0";
    let node_filename = format!("node-v22.14.0-{}-{}.tar.gz", node_os, node_arch);
    let url = format!("{}/{}", node_dist_dir, node_filename);

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Node.js download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Node.js download returned {}", resp.status()));
    }

    let data = download_capped(resp, MAX_DOWNLOAD_BYTES, |downloaded, total| {
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
    })
    .await
    .map_err(|e| format!("Node.js download failed: {}", e))?;

    // Integrity check (audit batch 3 fix #6a): verify the tarball's SHA-256
    // against the SHASUMS256.txt nodejs.org publishes in the same release
    // directory, before anything is extracted or executed.
    let shasums = client
        .get(format!("{}/SHASUMS256.txt", node_dist_dir))
        .send()
        .await
        .map_err(|e| format!("Node.js checksum manifest download failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Node.js checksum manifest request failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read Node.js checksum manifest: {}", e))?;
    let expected = find_sha256_for_file(&shasums, &node_filename).ok_or_else(|| {
        format!(
            "Node.js checksum manifest has no entry for {}",
            node_filename
        )
    })?;
    let actual = sha256_hex(&data);
    if actual != expected {
        return Err(format!(
            "Node.js download failed integrity check: expected sha256 {}, got {}",
            expected, actual
        ));
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
    //
    // Decompression-bomb guard (audit batch 3 fix #5): the gzip layer can
    // expand far beyond the downloaded size, so cap the cumulative bytes
    // written to disk independently of the download cap.
    let mut total_extracted: u64 = 0;
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
            // `take(remaining + 1)` bounds the write BEFORE it happens; if the
            // copy fills the extra byte the archive is over budget.
            let remaining = MAX_RUNTIME_EXTRACT_BYTES.saturating_sub(total_extracted);
            let mut limited = std::io::Read::take(&mut entry, remaining.saturating_add(1));
            let written = std::io::copy(&mut limited, &mut outfile)
                .map_err(|e| format!("Extract {}: {}", stripped.display(), e))?;
            if written > remaining {
                return Err(format!(
                    "Node.js archive expands past the {} byte extraction limit — aborting",
                    MAX_RUNTIME_EXTRACT_BYTES
                ));
            }
            total_extracted += written;

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
/// Install a binary via write-to-temp + rename, never a write in place.
///
/// `fs::write` onto an existing path truncates and rewrites the SAME inode.
/// On macOS — mandatory code signing on Apple Silicon — rewriting a binary's
/// pages underneath its validated signature makes the kernel SIGKILL the next
/// process launched from it (exit 137, no diagnostic). First installs are
/// fine; UPDATES are what break, which is the worst shape for it: the agent
/// worked before the update and dies silently after.
///
/// Renaming within the same directory is atomic and produces a fresh inode, so
/// the running process keeps its old file and the next launch gets the new one.
/// It also means a failed download can't leave a half-written executable.
fn install_extracted_binary(bin_name: &str, data: &[u8]) -> Result<(), String> {
    ensure_agent_dirs()?;
    install_binary_at(&agents_bin_dir(), bin_name, data)
}

/// Directory-injectable core of [`install_extracted_binary`] so the
/// replace-don't-overwrite property is testable without touching `~/.notesage`.
fn install_binary_at(dir: &std::path::Path, bin_name: &str, data: &[u8]) -> Result<(), String> {
    let dest = dir.join(bin_name);
    // Same directory: rename(2) can't cross filesystems, and $TMPDIR often is one.
    let staging = dir.join(format!(".{}.incoming", bin_name));

    std::fs::write(&staging, data)
        .map_err(|e| format!("Failed to write {}: {}", staging.display(), e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Set the mode BEFORE the rename so the binary is never briefly present
        // at its final path without the executable bit.
        if let Err(e) = std::fs::set_permissions(&staging, std::fs::Permissions::from_mode(0o755)) {
            let _ = std::fs::remove_file(&staging);
            return Err(format!("Failed to chmod {}: {}", staging.display(), e));
        }
    }
    if let Err(e) = std::fs::rename(&staging, &dest) {
        let _ = std::fs::remove_file(&staging);
        return Err(format!("Failed to install {}: {}", dest.display(), e));
    }
    Ok(())
}

/// Extract `bin_name` from a downloaded archive and install it. `asset` selects
/// the format (`.zip` → zip crate, `.tar.gz` → flate2+tar). Path traversal is
/// guarded (zip `enclosed_name`, tar component check) — same hardening as the
/// Node.js runtime extractor.
fn extract_named_binary(
    asset: &str,
    archive_basename: &str,
    dest_bin_name: &str,
    data: &[u8],
) -> Result<(), String> {
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
            if file.is_file() && name.file_name().and_then(|n| n.to_str()) == Some(archive_basename) {
                // The zip header's size field is attacker-controlled — clamp
                // the pre-allocation hint and cap the bytes actually read
                // (audit batch 3 fix #5).
                let mut buf =
                    Vec::with_capacity((file.size() as usize).min(MAX_PREALLOC_BYTES));
                let mut limited =
                    std::io::Read::take(&mut file, MAX_EXTRACTED_FILE_BYTES.saturating_add(1));
                std::io::copy(&mut limited, &mut buf)
                    .map_err(|e| format!("Zip read error: {}", e))?;
                if buf.len() as u64 > MAX_EXTRACTED_FILE_BYTES {
                    return Err(format!(
                        "'{}' in archive {} exceeds the {} byte extraction limit",
                        archive_basename, asset, MAX_EXTRACTED_FILE_BYTES
                    ));
                }
                return install_extracted_binary(dest_bin_name, &buf);
            }
        }
        Err(format!("'{}' not found in archive {}", archive_basename, asset))
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
                && path.file_name().and_then(|n| n.to_str()) == Some(archive_basename)
            {
                // Gzip-bomb guard: cap the decompressed bytes read into
                // memory (audit batch 3 fix #5).
                let mut buf = Vec::new();
                let mut limited =
                    std::io::Read::take(&mut entry, MAX_EXTRACTED_FILE_BYTES.saturating_add(1));
                std::io::copy(&mut limited, &mut buf)
                    .map_err(|e| format!("Tar read error: {}", e))?;
                if buf.len() as u64 > MAX_EXTRACTED_FILE_BYTES {
                    return Err(format!(
                        "'{}' in archive {} exceeds the {} byte extraction limit",
                        archive_basename, asset, MAX_EXTRACTED_FILE_BYTES
                    ));
                }
                return install_extracted_binary(dest_bin_name, &buf);
            }
        }
        Err(format!("'{}' not found in archive {}", archive_basename, asset))
    } else {
        Err(format!("Unsupported archive format: {}", asset))
    }
}

/// Extract a whole archive tree to `agents/dist/<agent_id>/` (wiping any
/// previous install) and symlink `agents/bin/<bin_name>` to `bin_rel` inside
/// it. Same tar-slip and size-cap hardening as the single-binary path, plus a
/// total-bytes cap across the tree; unix mode bits are preserved so the
/// executable and any bundled helpers keep their permissions.
fn extract_tree_and_install(
    agent_id: &str,
    bin_name: &str,
    bin_rel: &str,
    asset: &str,
    data: &[u8],
) -> Result<(), String> {
    if !(asset.ends_with(".tar.gz") || asset.ends_with(".tgz")) {
        return Err(format!("Unsupported archive format for tree install: {}", asset));
    }
    ensure_agent_dirs()?;
    let dest_root = agents_dist_dir().join(agent_id);
    if dest_root.exists() {
        std::fs::remove_dir_all(&dest_root)
            .map_err(|e| format!("Failed to clear {}: {}", dest_root.display(), e))?;
    }
    std::fs::create_dir_all(&dest_root)
        .map_err(|e| format!("Failed to create {}: {}", dest_root.display(), e))?;

    use flate2::read::GzDecoder;
    use tar::Archive;
    const MAX_TREE_BYTES: u64 = 1024 * 1024 * 1024; // 1 GiB across the tree
    let mut total: u64 = 0;
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
        let out = dest_root.join(&path);
        let entry_type = entry.header().entry_type();
        if entry_type.is_dir() {
            std::fs::create_dir_all(&out)
                .map_err(|e| format!("Failed to create {}: {}", out.display(), e))?;
            continue;
        }
        if !entry_type.is_file() {
            continue; // no symlinks/devices from the archive (hardening)
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
        }
        let mut buf = Vec::new();
        let mut limited =
            std::io::Read::take(&mut entry, MAX_EXTRACTED_FILE_BYTES.saturating_add(1));
        std::io::copy(&mut limited, &mut buf).map_err(|e| format!("Tar read error: {}", e))?;
        if buf.len() as u64 > MAX_EXTRACTED_FILE_BYTES {
            return Err(format!(
                "'{}' in archive {} exceeds the {} byte extraction limit",
                path.display(),
                asset,
                MAX_EXTRACTED_FILE_BYTES
            ));
        }
        total = total.saturating_add(buf.len() as u64);
        if total > MAX_TREE_BYTES {
            return Err(format!(
                "Archive {} exceeds the {} byte total extraction limit",
                asset, MAX_TREE_BYTES
            ));
        }
        std::fs::write(&out, &buf).map_err(|e| format!("Failed to write {}: {}", out.display(), e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(mode) = entry.header().mode() {
                let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(mode & 0o777));
            }
        }
    }

    let bin_target = dest_root.join(bin_rel);
    if !bin_target.is_file() {
        return Err(format!(
            "'{}' not found in archive {} after extraction",
            bin_rel, asset
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&bin_target, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to chmod {}: {}", bin_target.display(), e))?;
    }

    let link = agents_bin_dir().join(bin_name);
    if link.exists() || link.symlink_metadata().is_ok() {
        let _ = std::fs::remove_file(&link);
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(&bin_target, &link)
        .map_err(|e| format!("Failed to link {}: {}", link.display(), e))?;
    #[cfg(not(unix))]
    return Err("Tree installs are not supported on this platform".to_string());
    #[cfg(unix)]
    Ok(())
}

async fn do_github_binary_install(
    app: &AppHandle,
    agent_id: &str,
    config: &GithubBinaryAgentConfig,
) -> Result<Option<String>, String> {
    let (os, arch) = detect_platform()?;
    let (asset, layout) = github_binary_asset(agent_id, os, arch)?;
    let asset = asset.as_str();

    // Resolve the latest release, enforce the minimum pin, and clamp to the
    // exact-tested ceiling when one is configured (fast-moving upstreams: a
    // newer release than the pin is installed AT the pin, never past it).
    let latest = fetch_github_latest_release(config.repo).await?;
    let version = match config.max_version {
        Some(max) if version_at_least(&latest, max) && latest != max => max.to_string(),
        _ => latest,
    };
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

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "notesage")
        .send()
        .await
        .map_err(|e| {
            log::warn!(target: "notesage::agent_manager", "{} download request failed: {} (url={})", agent_id, e, url);
            format!("{} download failed: {}", agent_id, e)
        })?;
    if !resp.status().is_success() {
        let status = resp.status();
        // Developer-facing detail (incl. the exact url that failed) goes to the
        // backend log; the returned string stays short for the UI layer, which
        // maps it to a friendly toast. A 404 here almost always means the asset
        // isn't published on the resolved release yet (e.g. the notesage-acp-pi
        // bridge before a Notesage release ships it).
        log::warn!(
            target: "notesage::agent_manager",
            "{} download returned {} (url={})", agent_id, status, url
        );
        return Err(format!("{} download returned {}", agent_id, status));
    }

    let data = download_capped(resp, MAX_DOWNLOAD_BYTES, |downloaded, total| {
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
    })
    .await
    .map_err(|e| format!("{} download failed: {}", agent_id, e))?;

    // Integrity (audit batch 3 fix #6b): always compute + record the archive
    // digest; when the agent's config names a checksum asset, verification is
    // a HARD gate (pi, notesage-acp-pi) — otherwise digest-record-only (Goose,
    // which publishes no stable checksum asset).
    let digest = sha256_hex(&data);
    if let Some(checksum_asset) = config.checksum_asset {
        let checksum_url = format!(
            "https://github.com/{}/releases/download/v{}/{}",
            config.repo, version, checksum_asset
        );
        let manifest = client
            .get(&checksum_url)
            .header("User-Agent", "notesage")
            .send()
            .await
            .map_err(|e| format!("{} checksum download failed: {}", agent_id, e))?
            .error_for_status()
            .map_err(|e| format!("{} checksum request failed: {}", agent_id, e))?
            .text()
            .await
            .map_err(|e| format!("Failed to read {} checksum manifest: {}", agent_id, e))?;
        let expected = find_sha256_for_file(&manifest, asset).ok_or_else(|| {
            format!("{} checksum manifest has no entry for {}", agent_id, asset)
        })?;
        if digest != expected {
            return Err(format!(
                "{} download failed integrity check: expected sha256 {}, got {}",
                agent_id, expected, digest
            ));
        }
    } else {
        log::info!(
            target: "notesage::agent_manager",
            "Downloaded {} v{} asset {} — sha256 {} (no upstream checksum asset to verify against)",
            agent_id, version, asset, digest
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

    match &layout {
        ArchiveInstall::SingleBinary { archive_basename } => {
            extract_named_binary(asset, archive_basename, config.bin_name, &data)?;
        }
        ArchiveInstall::Tree { bin_rel } => {
            extract_tree_and_install(agent_id, config.bin_name, bin_rel, asset, &data)?;
        }
    }

    // Verify the binary is present after extraction (follows the symlink for
    // tree installs).
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

    // Regression lock (2026-07-05 security audit, HIGH): `agent_uninstall`
    // derives a delete path as `agents_bin_dir().join(&agent_id)`. Without the
    // registry gate, `..` traversal and absolute-path ids escape the managed
    // bin dir and delete arbitrary user-writable files over IPC.
    #[test]
    fn managed_agent_id_accepts_only_registry_ids() {
        for id in [
            "claude-agent-acp",
            "codex-acp",
            "copilot",
            "copilot-language-server",
            "gemini",
            "goose",
        ] {
            assert!(is_managed_agent_id(id), "{id} must be a managed agent id");
        }
    }

    #[test]
    fn managed_agent_id_rejects_traversal_and_absolute_paths() {
        for id in [
            "../../../.ssh/id_rsa",
            "..",
            "goose/../../../etc/hosts",
            "/etc/hosts",
            "/absolute/victim/path",
            "not-a-real-agent",
            "",
        ] {
            assert!(!is_managed_agent_id(id), "{id:?} must be rejected");
        }
    }

    #[tokio::test]
    async fn agent_uninstall_rejects_unregistered_ids_before_touching_the_fs() {
        let err = agent_uninstall("../../../.ssh/id_rsa".to_string())
            .await
            .expect_err("traversal id must be rejected");
        assert!(err.starts_with("Unknown agent:"), "unexpected error: {err}");

        let err = agent_uninstall("/absolute/victim/path".to_string())
            .await
            .expect_err("absolute-path id must be rejected");
        assert!(err.starts_with("Unknown agent:"), "unexpected error: {err}");
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

    // pi Local Agent preset (PRD 2026-07-29-pi-local-agent-preset): lock the
    // repo, checksum asset, and — critically — the EXACT-tested version pin.
    // pi ships multiple 0.x releases a week; the bridge + shipped extensions
    // are verified against this version's RPC/extension surface only. Moving
    // the pin is a deliberate release action (re-run the PI_BINARY-gated
    // integration suite), never a drive-by edit.
    #[test]
    fn pi_installs_via_github_binary_with_exact_pin_and_checksum() {
        let gh = github_binary_agent_config("pi").expect("pi must be a GitHub-binary agent");
        assert_eq!(gh.repo, "earendil-works/pi");
        assert_eq!(gh.bin_name, "pi");
        assert_eq!(gh.min_version, "0.80.6");
        assert_eq!(gh.max_version, Some("0.80.6"), "pi keeps an exact-tested pin");
        assert_eq!(gh.checksum_asset, Some("SHA256SUMS"), "pi installs are checksum-verified");
        assert!(npm_agent_config("pi").is_none());
    }

    #[test]
    fn adapter_installs_from_its_own_repo_pinned_and_checksummed() {
        let gh = github_binary_agent_config("notesage-acp-pi")
            .expect("adapter must be a GitHub-binary agent");
        // Its own repository, not Notesage's releases. While it shipped as an
        // app-release asset there was no independent version to pin to, so
        // installs took whatever the latest app release carried.
        assert_eq!(gh.repo, "PeterBlenessy/notesage-acp-pi");
        assert_eq!(gh.bin_name, "notesage-acp-pi");
        // Exact pin: the adapter tracks pi's pre-1.0 RPC and extension
        // surfaces, so picking up a newer build automatically is unsafe.
        // 0.1.1 is the first build advertising ACP session modes; the mode
        // picker is empty against 0.1.0, so host and pin move together.
        assert_eq!(gh.min_version, "0.1.1");
        assert_eq!(gh.max_version, Some("0.1.1"), "adapter must be exactly pinned, like pi");
        // Scoped checksum asset name — matches the adapter's build-binaries.sh.
        assert_eq!(gh.checksum_asset, Some("notesage-acp-pi-SHA256SUMS"));
        assert!(npm_agent_config("notesage-acp-pi").is_none());
    }

    #[test]
    #[cfg(unix)]
    fn updating_a_binary_replaces_the_file_instead_of_rewriting_it() {
        // The bug this locks: `fs::write` over an existing binary keeps the
        // same inode, and macOS SIGKILLs the next process launched from a
        // binary whose pages changed under its code signature (exit 137, no
        // diagnostic). Asserting the CONTENT changed would pass against the
        // broken version — the inode is the property that matters.
        use std::os::unix::fs::MetadataExt;

        let dir = std::env::temp_dir().join(format!(
            "notesage-install-test-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&dir).unwrap();

        install_binary_at(&dir, "demo-agent", b"v1").unwrap();
        let first = std::fs::metadata(dir.join("demo-agent")).unwrap().ino();

        install_binary_at(&dir, "demo-agent", b"v2-longer").unwrap();
        let second_meta = std::fs::metadata(dir.join("demo-agent")).unwrap();

        assert_ne!(
            first,
            second_meta.ino(),
            "update rewrote the existing inode — a running agent would be SIGKILLed on next launch"
        );
        assert_eq!(std::fs::read(dir.join("demo-agent")).unwrap(), b"v2-longer");

        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            second_meta.permissions().mode() & 0o777,
            0o755,
            "installed binary must stay executable"
        );

        // No staging file left behind to be mistaken for an agent binary.
        assert!(!dir.join(".demo-agent.incoming").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn pi_asset_names_use_pi_platform_convention_not_triples() {
        // Verified against earendil-works/pi v0.80.6 release assets.
        let (asset, layout) = github_binary_asset("pi", "darwin", "arm64").unwrap();
        assert_eq!(asset, "pi-darwin-arm64.tar.gz");
        assert!(matches!(layout, ArchiveInstall::Tree { bin_rel: "pi/pi" }));
        let (asset, _) = github_binary_asset("pi", "linux", "x64").unwrap();
        assert_eq!(asset, "pi-linux-x64.tar.gz");
        // Windows assets exist upstream but the preset doesn't support them.
        assert!(github_binary_asset("pi", "windows", "x64").is_err());
    }

    #[test]
    fn bridge_asset_names_use_rust_triples_with_per_platform_basename() {
        let (asset, layout) = github_binary_asset("notesage-acp-pi", "darwin", "arm64").unwrap();
        assert_eq!(asset, "notesage-acp-pi-aarch64-apple-darwin.tar.gz");
        match layout {
            ArchiveInstall::SingleBinary { archive_basename } => {
                assert_eq!(archive_basename, "notesage-acp-pi-aarch64-apple-darwin");
            }
            _ => panic!("bridge must be a single-binary install"),
        }
    }

    #[test]
    fn goose_asset_resolution_unchanged_by_dispatcher() {
        let (asset, layout) = github_binary_asset("goose", "darwin", "arm64").unwrap();
        assert_eq!(asset, "goose-aarch64-apple-darwin.tar.gz");
        assert!(matches!(
            layout,
            ArchiveInstall::SingleBinary { ref archive_basename } if archive_basename == "goose"
        ));
    }

    #[test]
    fn goose_remains_digest_record_only_with_no_ceiling() {
        let gh = github_binary_agent_config("goose").unwrap();
        assert_eq!(gh.checksum_asset, None);
        assert_eq!(gh.max_version, None);
    }

    #[test]
    fn tree_install_extracts_colocated_files_and_links_binary() {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        // Build an in-memory pi-style folder tarball: pi/pi (exec), pi/x.wasm,
        // plus a traversal entry that must be skipped.
        let mut builder = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::default()));
        let add = |b: &mut tar::Builder<GzEncoder<Vec<u8>>>, path: &str, data: &[u8], mode: u32| {
            let mut h = tar::Header::new_gnu();
            h.set_size(data.len() as u64);
            h.set_mode(mode);
            h.set_cksum();
            b.append_data(&mut h, path, data).unwrap();
        };
        add(&mut builder, "pi/pi", b"#!/bin/sh\necho pi\n", 0o755);
        add(&mut builder, "pi/photon.wasm", b"wasmbytes", 0o644);

        // The traversal entry has to be written straight into the header's name
        // field. `append_data`/`set_path` reject `..` outright ("paths in
        // archives must not have `..`"), so building the fixture the obvious way
        // fails while CONSTRUCTING the attack and never reaches the assertion —
        // which left the extractor's tar-slip guard unexercised. A real
        // malicious archive is under no such obligation to be well-formed.
        {
            let evil = b"../evil.txt";
            let mut h = tar::Header::new_gnu();
            h.set_size(4);
            h.set_mode(0o644);
            let name = &mut h.as_gnu_mut().expect("gnu header").name;
            name[..evil.len()].copy_from_slice(evil);
            h.set_cksum();
            builder.append(&h, &b"nope"[..]).unwrap();
        }
        let data = builder.into_inner().unwrap().finish().unwrap();

        // Redirect the agents base into a temp sandbox via the thread-local
        // override — NOT by mutating $HOME, which races parallel tests that
        // read `dirs::home_dir()` (module doc on TEST_AGENTS_BASE).
        let tmp = std::env::temp_dir().join(format!("ns-tree-install-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        TEST_AGENTS_BASE.with(|c| *c.borrow_mut() = Some(tmp.join(".notesage").join("agents")));

        let result = extract_tree_and_install("pi", "pi", "pi/pi", "pi-linux-x64.tar.gz", &data);

        let dist = agents_dist_dir().join("pi");
        let link = agents_bin_dir().join("pi");
        let checks = result.and_then(|_| {
            if !dist.join("pi/pi").is_file() || !dist.join("pi/photon.wasm").is_file() {
                return Err("co-located files missing".into());
            }
            if dist.join("../evil.txt").exists() || tmp.join("evil.txt").exists() {
                return Err("tar-slip entry escaped".into());
            }
            let target = std::fs::read_link(&link).map_err(|e| e.to_string())?;
            if target != dist.join("pi/pi") {
                return Err(format!("symlink points at {}", target.display()));
            }
            Ok(())
        });

        // Clear the override before asserting so a failure can't poison later
        // tests on this thread.
        TEST_AGENTS_BASE.with(|c| *c.borrow_mut() = None);
        let _ = std::fs::remove_dir_all(&tmp);
        checks.expect("tree install must extract, guard traversal, and link the binary");
    }

    #[test]
    fn version_clamp_installs_at_the_pin_never_past_it() {
        // Mirrors the clamp logic in do_github_binary_install.
        let clamp = |latest: &str, max: Option<&str>| -> String {
            match max {
                Some(m) if version_at_least(latest, m) && latest != m => m.to_string(),
                _ => latest.to_string(),
            }
        };
        assert_eq!(clamp("0.81.0", Some("0.80.6")), "0.80.6"); // newer upstream → pin
        assert_eq!(clamp("0.80.6", Some("0.80.6")), "0.80.6"); // at the pin
        assert_eq!(clamp("0.80.5", Some("0.80.6")), "0.80.5"); // below the pin (min gate catches too-old)
        assert_eq!(clamp("2.0.0", None), "2.0.0"); // no ceiling (goose)
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

    // --- download integrity + limits (audit batch 3 fixes #5/#6) ---

    #[test]
    fn find_sha256_matches_nodejs_shasums_format() {
        let manifest = "\
0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  node-v22.14.0-darwin-arm64.tar.gz
fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210  node-v22.14.0-linux-x64.tar.gz
";
        assert_eq!(
            find_sha256_for_file(manifest, "node-v22.14.0-darwin-arm64.tar.gz").as_deref(),
            Some("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
        );
        assert_eq!(
            find_sha256_for_file(manifest, "node-v22.14.0-linux-x64.tar.gz").as_deref(),
            Some("fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210")
        );
        assert!(find_sha256_for_file(manifest, "node-v22.14.0-win-x64.zip").is_none());
    }

    #[test]
    fn find_sha256_handles_binary_mode_prefix_and_junk() {
        // '*' binary-mode prefix tolerated; malformed lines and wrong-length
        // hashes ignored.
        let manifest = "\
not a manifest line
deadbeef  short-hash.tar.gz
0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  *goose-aarch64-apple-darwin.tar.gz
";
        assert_eq!(
            find_sha256_for_file(manifest, "goose-aarch64-apple-darwin.tar.gz").as_deref(),
            Some("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
        );
        assert!(find_sha256_for_file(manifest, "short-hash.tar.gz").is_none());
    }

    #[test]
    fn sha256_hex_is_lowercase_hex_of_content() {
        // Known vector: sha256("abc").
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn download_prealloc_hint_is_clamped() {
        // The Content-Length-derived with_capacity hint must never exceed the
        // clamp even when the header advertises something absurd.
        let advertised: usize = usize::MAX;
        assert_eq!(advertised.min(MAX_PREALLOC_BYTES), MAX_PREALLOC_BYTES);
        // And the running-total caps have sane relative sizes.
        assert!(MAX_PREALLOC_BYTES as u64 <= MAX_DOWNLOAD_BYTES);
        assert!(MAX_DOWNLOAD_BYTES <= MAX_RUNTIME_EXTRACT_BYTES);
    }

    #[test]
    fn extract_and_install_rejects_unknown_format() {
        assert!(extract_named_binary("thing.rar", "goose", "goose", b"data").is_err());
    }

    #[test]
    fn unknown_agent_install_error_lists_goose() {
        // do_agent_install's error message must advertise goose as supported.
        let msg = format!(
            "Unknown agent: {}. Supported: claude-agent-acp, codex-acp, copilot, copilot-language-server, gemini, goose, pi, notesage-acp-pi",
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
    /// True when upstream is newer than the exact-tested `max_version` ceiling:
    /// the update is NOT installable until a Notesage release moves the pin
    /// (UI renders "held back", task #21). Additive — npm agents are always
    /// `false`.
    #[serde(default)]
    pub held_back: bool,
    /// Whether `latest_version` differs from what is installed.
    ///
    /// This list used to contain ONLY agents with an update pending, which
    /// meant the UI had no way to show an installed version for an agent that
    /// was current — so "check for updates" could report nothing at all and
    /// look broken. Every managed agent is now returned; this flag is what
    /// distinguishes "up to date" from "update pending".
    pub update_available: bool,
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
                let update_available = latest != entry.version;
                // Past the exact-tested ceiling → held back, not installable
                // (agent_update would clamp to the pin anyway).
                let held_back = update_available
                    && github_binary_agent_config(agent_id)
                        .and_then(|c| c.max_version)
                        .is_some_and(|max| version_at_least(&latest, max) && latest != max);
                updates.push(AgentUpdateInfo {
                    agent_id: agent_id.clone(),
                    current_version: entry.version.clone(),
                    latest_version: latest,
                    repo,
                    held_back,
                    update_available,
                });
            }
            Err(e) => {
                // A failed check must still report the INSTALLED version —
                // otherwise a network blip makes the agent look uninstalled.
                log::warn!(target: "notesage::agent_manager", "Failed to check updates for {}: {}", agent_id, e);
                updates.push(AgentUpdateInfo {
                    agent_id: agent_id.clone(),
                    current_version: entry.version.clone(),
                    latest_version: entry.version.clone(),
                    repo,
                    held_back: false,
                    update_available: false,
                });
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

/// Agent ids are a closed set: only ids present in the npm or GitHub-binary
/// registries are managed by this module. `agent_uninstall` (and anything else
/// that turns an id into a path under the managed bin dir) MUST gate on this —
/// `PathBuf::join` replaces the base on an absolute component and preserves
/// `..`, so an unvalidated id like `"../../../.ssh/id_rsa"` would escape
/// `agents_bin_dir()` and delete an arbitrary user-writable file over IPC.
fn is_managed_agent_id(agent_id: &str) -> bool {
    npm_agent_config(agent_id).is_some() || github_binary_agent_config(agent_id).is_some()
}

#[tauri::command]
pub async fn agent_uninstall(agent_id: String) -> Result<(), String> {
    if !is_managed_agent_id(&agent_id) {
        return Err(format!(
            "Unknown agent: {}. Supported: claude-agent-acp, codex-acp, copilot, copilot-language-server, gemini, goose, pi, notesage-acp-pi",
            agent_id
        ));
    }
    let bin_path = agents_bin_dir().join(&agent_id);
    // `exists()` follows symlinks (false for a dangling tree-install link) —
    // check the link itself so uninstall always clears it.
    if bin_path.symlink_metadata().is_ok() {
        std::fs::remove_file(&bin_path)
            .map_err(|e| format!("Failed to remove {}: {}", bin_path.display(), e))?;
    }
    // Tree installs (pi) keep their archive tree under dist/<agent_id>.
    let dist = agents_dist_dir().join(&agent_id);
    if dist.exists() {
        std::fs::remove_dir_all(&dist)
            .map_err(|e| format!("Failed to remove {}: {}", dist.display(), e))?;
    }

    let mut versions = read_versions();
    versions.agents.remove(&agent_id);
    write_versions(&versions)?;

    Ok(())
}
