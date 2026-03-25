use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Manager};

use super::constants;
use super::shell_path::get_shell_path;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentAvailability {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub authenticated: Option<bool>,
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

/// Resolve the path to an ACP agent binary.
/// Checks: 1) system PATH via `which`, 2) common install locations
/// (Homebrew, npm global, pnpm, nvm, ~/.local/bin), 3) bundled node_modules/.bin/.
///
/// macOS GUI apps (launched from Finder/Dock) inherit a minimal PATH that does
/// not include user-installed directories, so we must check common locations
/// explicitly as fallback.
pub fn resolve_agent_binary(agent_id: &str, app: &AppHandle) -> Option<String> {
    // 0. Check managed install directory (~/.notesage/agents/bin/)
    let managed_bin = dirs::home_dir()
        .unwrap_or_default()
        .join(".notesage/agents/bin")
        .join(agent_id);
    if managed_bin.exists() {
        return Some(managed_bin.to_string_lossy().to_string());
    }

    // 1. Check PATH via `which` — use login shell PATH if available
    //    (macOS GUI apps have a minimal inherited PATH)
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

    // 2. Check common install locations (needed for production macOS GUI apps)
    let home = dirs::home_dir().unwrap_or_default();
    let mut candidates: Vec<PathBuf> = vec![
        // ~/.local/bin (Claude Code, pipx, etc.)
        home.join(".local/bin").join(agent_id),
    ];
    // macOS Homebrew paths
    for path in constants::MACOS_FALLBACK_BIN_PATHS {
        candidates.push(PathBuf::from(path).join(agent_id));
    }
    candidates.extend([
        // npm global (default prefix)
        home.join(".npm-global/bin").join(agent_id),
        // pnpm global (macOS)
        home.join("Library/pnpm").join(agent_id),
        // pnpm global (Linux)
        home.join(".local/share/pnpm").join(agent_id),
        // Volta
        home.join(".volta/bin").join(agent_id),
        // Cargo
        home.join(".cargo/bin").join(agent_id),
    ]);

    // nvm: scan for node versions
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            for entry in entries.flatten() {
                candidates.push(entry.path().join("bin").join(agent_id));
            }
        }
    }

    // 3. Tauri resource path (for future sidecar bundling)
    candidates.push(
        app.path()
            .resource_dir()
            .unwrap_or_default()
            .join("node_modules/.bin")
            .join(agent_id),
    );

    // 4. npm global prefix paths (covers non-standard npm configurations)
    //    `npm root -g` typically resolves to <prefix>/lib/node_modules
    //    and binaries are linked in <prefix>/bin — already covered above,
    //    but some setups put bins directly in the node_modules/.bin.
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

/// Resolve a CLI binary by name, checking common install locations.
/// Used by `check_agent_auth` to find the underlying CLI that manages auth
/// (e.g., `claude`, `codex`, `copilot`) which may differ from the ACP adapter binary.
fn resolve_cli_binary(name: &str) -> Option<String> {
    // Try PATH via `which` — use login shell PATH if available
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let mut cmd = Command::new(which_cmd);
    cmd.arg(name);
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

    // Fallback: check common install locations (macOS GUI apps have minimal PATH)
    let home = dirs::home_dir().unwrap_or_default();
    let mut candidates: Vec<PathBuf> = vec![
        home.join(".local/bin").join(name),
    ];
    for path in constants::MACOS_FALLBACK_BIN_PATHS {
        candidates.push(PathBuf::from(path).join(name));
    }
    candidates.extend([
        home.join(".npm-global/bin").join(name),
        home.join("Library/pnpm").join(name),
        home.join(".local/share/pnpm").join(name),
        home.join(".volta/bin").join(name),
        home.join(".cargo/bin").join(name),
    ]);

    for candidate in &candidates {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    None
}

/// Check the auth status of the underlying CLI tool for an ACP agent.
/// For claude-agent-acp, checks `claude auth status` since the adapter
/// uses Claude Code's stored credentials internally.
pub fn check_agent_auth(agent_id: &str) -> Option<bool> {
    // Map agent adapter binary → underlying CLI that manages auth
    match agent_id {
        "claude-agent-acp" => {
            let cli = resolve_cli_binary("claude")?;
            match Command::new(&cli).args(["auth", "status"]).output() {
                Ok(output) if output.status.success() => {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    Some(stdout.contains("\"loggedIn\": true") || stdout.contains("\"loggedIn\":true"))
                }
                _ => None,
            }
        }
        "codex-acp" | "codex" => {
            let cli = resolve_cli_binary("codex")?;
            match Command::new(&cli).args(["auth", "status"]).output() {
                Ok(output) if output.status.success() => {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    Some(stdout.contains("\"loggedIn\": true") || stdout.contains("\"loggedIn\":true")
                        || stdout.contains("authenticated"))
                }
                _ => None,
            }
        }
        "copilot" => {
            let cli = resolve_cli_binary("copilot")?;
            match Command::new(&cli).args(["auth", "status"]).output() {
                Ok(output) if output.status.success() => {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    Some(stdout.contains("Logged in") || stdout.contains("authenticated")
                        || stdout.contains("\"loggedIn\": true") || stdout.contains("\"loggedIn\":true"))
                }
                _ => None,
            }
        }
        "gemini" => {
            // Check GEMINI_API_KEY env var first
            if std::env::var("GEMINI_API_KEY").map(|v| !v.is_empty()).unwrap_or(false) {
                return Some(true);
            }

            let home = dirs::home_dir().unwrap_or_default();

            // Gemini CLI stores the selected auth type in ~/.gemini/settings.json
            // at the path: security.auth.selectedType
            // Valid values: "login_with_google", "use_gemini", "use_vertex_ai", "gateway"
            let settings = home.join(".gemini/settings.json");
            if settings.exists() {
                if let Ok(content) = std::fs::read_to_string(&settings) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        let selected_type = json
                            .get("security")
                            .and_then(|s| s.get("auth"))
                            .and_then(|a| a.get("selectedType"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if !selected_type.is_empty() {
                            // For OAuth ("login_with_google"), also verify cached credentials exist
                            if selected_type == "login_with_google" {
                                // Check for cached OAuth credentials file in ~/.gemini/
                                let creds_exist = home.join(".gemini/google_oauth_credentials.json").exists()
                                    || home.join(".gemini/oauth_credentials.json").exists()
                                    || home.join(".gemini/credentials.json").exists();
                                return Some(creds_exist);
                            }
                            // For API key or Vertex AI, selectedType being set means configured
                            return Some(true);
                        }
                    }
                }
            }

            // No settings file or no selectedType → not authenticated
            Some(false)
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Check whether an ACP agent binary is installed on the system.
#[tauri::command]
pub async fn acp_agent_check_availability(
    app: AppHandle,
    agent_id: String,
) -> Result<AgentAvailability, String> {
    let path = resolve_agent_binary(&agent_id, &app);

    if path.is_none() {
        return Ok(AgentAvailability {
            installed: false,
            path: None,
            version: None,
            authenticated: None,
        });
    }

    let binary = path.as_deref().unwrap();
    let version = match Command::new(binary).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let v = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();
            if v.is_empty() {
                None
            } else {
                Some(v)
            }
        }
        _ => None,
    };

    let authenticated = check_agent_auth(&agent_id);

    Ok(AgentAvailability {
        installed: true,
        path,
        version,
        authenticated,
    })
}
