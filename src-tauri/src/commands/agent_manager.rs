use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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
pub struct AgentInstallDone {
    pub agent_id: String,
    pub success: bool,
    pub version: Option<String>,
    pub error: Option<String>,
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

// GitHub Release API types
#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

// Agent registry — maps agent_id to GitHub repo + naming strategy
struct AgentConfig {
    repo: &'static str,
    naming: AssetNaming,
    archive_ext_mac: &'static str,
    archive_ext_linux: &'static str,
}

enum AssetNaming {
    /// `{name}-{os}-{arch}.{ext}` (claude-agent-acp, copilot)
    Simple { name: &'static str },
    /// `{name}-{version}-{rust-triple}.{ext}` (codex-acp)
    RustTriple { name: &'static str },
    /// `{name}-{os}-{arch}-{version}.{ext}` (copilot-language-server)
    WithVersion { name: &'static str },
}

fn agent_config(agent_id: &str) -> Option<AgentConfig> {
    match agent_id {
        "claude-agent-acp" => Some(AgentConfig {
            repo: "zed-industries/claude-agent-acp",
            naming: AssetNaming::Simple {
                name: "claude-agent-acp",
            },
            archive_ext_mac: "zip",
            archive_ext_linux: "tar.gz",
        }),
        "codex-acp" => Some(AgentConfig {
            repo: "zed-industries/codex-acp",
            naming: AssetNaming::RustTriple { name: "codex-acp" },
            archive_ext_mac: "tar.gz",
            archive_ext_linux: "tar.gz",
        }),
        "copilot" => Some(AgentConfig {
            repo: "github/copilot-cli",
            naming: AssetNaming::Simple { name: "copilot" },
            archive_ext_mac: "tar.gz",
            archive_ext_linux: "tar.gz",
        }),
        "copilot-language-server" => Some(AgentConfig {
            repo: "github/copilot-language-server-release",
            naming: AssetNaming::WithVersion {
                name: "copilot-language-server",
            },
            archive_ext_mac: "zip",
            archive_ext_linux: "zip",
        }),
        _ => None,
    }
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

/// Map (os, arch) to Rust target triple for codex-acp naming
fn rust_triple(os: &str, arch: &str) -> &'static str {
    match (os, arch) {
        ("darwin", "arm64") => "aarch64-apple-darwin",
        ("darwin", "x64") => "x86_64-apple-darwin",
        ("linux", "arm64") => "aarch64-unknown-linux-gnu",
        ("linux", "x64") => "x86_64-unknown-linux-gnu",
        ("windows", "arm64") => "aarch64-pc-windows-msvc",
        ("windows", "x64") => "x86_64-pc-windows-msvc",
        _ => "unknown",
    }
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
// GitHub Release download
// ---------------------------------------------------------------------------

fn build_asset_name(config: &AgentConfig, version: &str, os: &str, arch: &str) -> String {
    let ext = if os == "darwin" || os == "linux" {
        if os == "linux" {
            config.archive_ext_linux
        } else {
            config.archive_ext_mac
        }
    } else {
        "zip"
    };

    match &config.naming {
        AssetNaming::Simple { name } => {
            format!("{}-{}-{}.{}", name, os, arch, ext)
        }
        AssetNaming::RustTriple { name } => {
            let triple = rust_triple(os, arch);
            format!("{}-{}-{}.{}", name, version, triple, ext)
        }
        AssetNaming::WithVersion { name } => {
            format!("{}-{}-{}-{}.{}", name, os, arch, version, ext)
        }
    }
}

async fn fetch_latest_release(repo: &str) -> Result<GitHubRelease, String> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo);
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "notesage")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status()));
    }

    resp.json::<GitHubRelease>()
        .await
        .map_err(|e| format!("Failed to parse GitHub release: {}", e))
}

async fn download_and_extract(
    app: &AppHandle,
    agent_id: &str,
    asset: &GitHubAsset,
    archive_ext: &str,
) -> Result<(), String> {
    use futures::StreamExt;

    // Download with progress
    let client = reqwest::Client::new();
    let resp = client
        .get(&asset.browser_download_url)
        .header("User-Agent", "notesage")
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download returned {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(asset.size);
    let mut stream = resp.bytes_stream();
    let mut data = Vec::with_capacity(total as usize);
    let mut downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {}", e))?;
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
                    "Downloading... {:.1} MB / {:.1} MB",
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
            message: "Extracting...".to_string(),
        },
    );

    // Extract
    let bin_dir = agents_bin_dir();

    if archive_ext == "zip" {
        extract_zip(&data, agent_id, &bin_dir)?;
    } else {
        // tar.gz
        extract_tar_gz(&data, agent_id, &bin_dir)?;
    }

    // Remove quarantine on macOS
    #[cfg(target_os = "macos")]
    {
        let bin_path = bin_dir.join(agent_id);
        let _ = Command::new("xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(&bin_path)
            .output();
    }

    // Set executable permissions on unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let bin_path = bin_dir.join(agent_id);
        if bin_path.exists() {
            let perms = std::fs::Permissions::from_mode(0o755);
            std::fs::set_permissions(&bin_path, perms)
                .map_err(|e| format!("chmod failed: {}", e))?;
        }
    }

    Ok(())
}

fn extract_zip(data: &[u8], agent_id: &str, bin_dir: &Path) -> Result<(), String> {
    let cursor = std::io::Cursor::new(data);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to open zip: {}", e))?;

    // Look for the binary file in the archive
    let mut found = false;
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Zip entry error: {}", e))?;

        let name = file.name().to_string();

        // Find the actual binary — it could be at the root or in a subdirectory
        let is_target = name == agent_id
            || name.ends_with(&format!("/{}", agent_id))
            || name.ends_with(&format!("\\{}", agent_id));

        if is_target && !file.is_dir() {
            let dest = bin_dir.join(agent_id);
            let mut outfile = std::fs::File::create(&dest)
                .map_err(|e| format!("Failed to create {}: {}", dest.display(), e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Extract failed: {}", e))?;
            found = true;
            break;
        }
    }

    if !found {
        // If exact binary name not found, extract the first executable-looking file
        // (some archives have differently named binaries)
        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| format!("Zip entry error: {}", e))?;

            if file.is_dir() {
                continue;
            }

            let name = file.name().to_string();
            // Skip directories and non-binary files
            if name.ends_with('/') || name.contains('.') {
                continue;
            }

            // Extract as the target binary name
            let dest = bin_dir.join(agent_id);
            let mut outfile = std::fs::File::create(&dest)
                .map_err(|e| format!("Failed to create {}: {}", dest.display(), e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Extract failed: {}", e))?;
            found = true;
            break;
        }
    }

    if !found {
        return Err(format!(
            "Binary '{}' not found in archive. Contents: {:?}",
            agent_id,
            (0..archive.len())
                .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
                .collect::<Vec<_>>()
        ));
    }

    Ok(())
}

fn extract_tar_gz(data: &[u8], agent_id: &str, bin_dir: &Path) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let gz = GzDecoder::new(std::io::Cursor::new(data));
    let mut archive = Archive::new(gz);

    let mut found = false;
    for entry in archive
        .entries()
        .map_err(|e| format!("Failed to read tar: {}", e))?
    {
        let mut entry = entry.map_err(|e| format!("Tar entry error: {}", e))?;
        let path = entry
            .path()
            .map_err(|e| format!("Tar path error: {}", e))?
            .to_path_buf();

        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        if file_name == agent_id && !entry.header().entry_type().is_dir() {
            let dest = bin_dir.join(agent_id);
            let mut outfile = std::fs::File::create(&dest)
                .map_err(|e| format!("Failed to create {}: {}", dest.display(), e))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Extract failed: {}", e))?;
            found = true;
            break;
        }
    }

    if !found {
        // Re-read archive to list contents for error
        let gz2 = GzDecoder::new(std::io::Cursor::new(data));
        let mut archive2 = Archive::new(gz2);
        let names: Vec<String> = archive2
            .entries()
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|e| {
                        e.ok()
                            .and_then(|e| e.path().ok().map(|p| p.to_string_lossy().to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Try extracting the first non-directory file
        let gz3 = GzDecoder::new(std::io::Cursor::new(data));
        let mut archive3 = Archive::new(gz3);
        for entry in archive3.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            if entry.header().entry_type().is_dir() {
                continue;
            }
            let path = entry.path().map_err(|e| e.to_string())?.to_path_buf();
            let name = path.to_string_lossy().to_string();
            if name.contains('.') {
                continue; // Skip files with extensions
            }
            let dest = bin_dir.join(agent_id);
            let mut outfile =
                std::fs::File::create(&dest).map_err(|e| format!("Create: {}", e))?;
            std::io::copy(&mut entry, &mut outfile).map_err(|e| format!("Extract: {}", e))?;
            found = true;
            break;
        }

        if !found {
            return Err(format!(
                "Binary '{}' not found in archive. Contents: {:?}",
                agent_id, names
            ));
        }
    }

    Ok(())
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

    // Emit done event
    let _ = app.emit(
        "agent-install-done",
        AgentInstallDone {
            agent_id: agent_id.clone(),
            success: result.is_ok(),
            version: result.as_ref().ok().cloned().unwrap_or(None),
            error: result.as_ref().err().cloned(),
        },
    );

    result.map(|_| ())
}

async fn do_agent_install(app: &AppHandle, agent_id: &str) -> Result<Option<String>, String> {
    // Gemini CLI has a special install flow (requires Node.js)
    if agent_id == "gemini" {
        return do_gemini_install(app).await;
    }

    let config = agent_config(agent_id)
        .ok_or_else(|| format!("Unknown agent: {}. Supported: claude-agent-acp, codex-acp, copilot, copilot-language-server, gemini", agent_id))?;

    ensure_agent_dirs()?;

    let _ = app.emit(
        "agent-install-progress",
        AgentInstallProgress {
            agent_id: agent_id.to_string(),
            phase: "downloading".to_string(),
            progress: 0,
            total: 0,
            message: "Fetching latest release...".to_string(),
        },
    );

    // Fetch latest release
    let release = fetch_latest_release(config.repo).await?;
    let version = release.tag_name.trim_start_matches('v').to_string();

    // Determine asset name
    let (os, arch) = detect_platform()?;
    let asset_name = build_asset_name(&config, &version, os, arch);

    // Find matching asset
    let asset = release
        .assets
        .iter()
        .find(|a| a.name == asset_name)
        .ok_or_else(|| {
            let available: Vec<&str> = release.assets.iter().map(|a| a.name.as_str()).collect();
            format!(
                "Asset '{}' not found in release. Available: {:?}",
                asset_name, available
            )
        })?;

    let archive_ext = if os == "linux" {
        config.archive_ext_linux
    } else {
        config.archive_ext_mac
    };

    // Download and extract
    download_and_extract(app, agent_id, asset, archive_ext).await?;

    // Verify binary exists
    let bin_path = agents_bin_dir().join(agent_id);
    if !bin_path.exists() {
        return Err(format!(
            "Binary not found at {} after extraction",
            bin_path.display()
        ));
    }

    // Update versions.json
    let mut versions = read_versions();
    versions.agents.insert(
        agent_id.to_string(),
        AgentVersionEntry {
            version: version.clone(),
            installed_at: chrono::Utc::now().to_rfc3339(),
            source: "github-release".to_string(),
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
// Node.js runtime + Gemini CLI install
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

            // Preserve executable permission
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(mode) = entry.header().mode() {
                    std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(mode)).ok();
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

async fn do_gemini_install(app: &AppHandle) -> Result<Option<String>, String> {
    ensure_agent_dirs()?;

    // Step 1: Ensure Node.js is available
    if !is_node_runtime_available() {
        download_node_runtime(app).await?;
    }

    let _ = app.emit(
        "agent-install-progress",
        AgentInstallProgress {
            agent_id: "gemini".to_string(),
            phase: "configuring".to_string(),
            progress: 0,
            total: 1,
            message: "Installing Gemini CLI via npm...".to_string(),
        },
    );

    // Step 2: npm install --prefix ~/.notesage/agents/lib/ @google/gemini-cli
    let npm = get_npm_binary();
    let lib_dir = agents_lib_dir();

    let output = Command::new(&npm)
        .args(["install", "--prefix"])
        .arg(lib_dir.to_string_lossy().as_ref())
        .arg("@google/gemini-cli")
        .output()
        .map_err(|e| format!("npm install failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("npm install failed: {}", stderr));
    }

    // Step 3: Create symlink in bin dir
    let bin_path = agents_bin_dir().join("gemini");
    let target = lib_dir.join("node_modules/.bin/gemini");

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

    // Get version from package.json
    let pkg_json = lib_dir.join("node_modules/@google/gemini-cli/package.json");
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

    // Update versions.json
    let mut versions = read_versions();
    versions.agents.insert(
        "gemini".to_string(),
        AgentVersionEntry {
            version: version.clone(),
            installed_at: chrono::Utc::now().to_rfc3339(),
            source: "npm".to_string(),
            repo: Some("google-gemini/gemini-cli".to_string()),
        },
    );
    write_versions(&versions)?;

    let _ = app.emit(
        "agent-install-progress",
        AgentInstallProgress {
            agent_id: "gemini".to_string(),
            phase: "done".to_string(),
            progress: 1,
            total: 1,
            message: format!("Installed Gemini CLI v{}", version),
        },
    );

    Ok(Some(version))
}

#[tauri::command]
pub async fn agent_install_node_runtime(app: AppHandle) -> Result<(), String> {
    download_node_runtime(&app).await
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
pub async fn agent_check_updates(app: AppHandle, force: Option<bool>) -> Result<Vec<AgentUpdateInfo>, String> {
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
        let config = match agent_config(agent_id) {
            Some(c) => c,
            None => continue,
        };

        match fetch_latest_release(config.repo).await {
            Ok(release) => {
                let latest = release.tag_name.trim_start_matches('v').to_string();
                if latest != entry.version {
                    updates.push(AgentUpdateInfo {
                        agent_id: agent_id.clone(),
                        current_version: entry.version.clone(),
                        latest_version: latest,
                        repo: config.repo.to_string(),
                    });
                }
            }
            Err(e) => {
                log::warn!(target: "notesage::agent_manager", "Failed to check updates for {}: {}", agent_id, e);
            }
        }
    }

    // Emit events for each available update
    for update in &updates {
        let _ = app.emit("agent-update-available", update.clone());
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
