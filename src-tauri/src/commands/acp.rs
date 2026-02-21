use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentAvailability {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Check whether an ACP agent binary is installed on the system.
/// Uses `which` (Unix) or `where` (Windows) to locate the executable,
/// then tries `<binary> --version` to get a version string.
#[tauri::command]
pub async fn acp_agent_check_availability(agent_id: String) -> Result<AgentAvailability, String> {
    // Locate the binary
    let which_cmd = if cfg!(target_os = "windows") { "where" } else { "which" };

    let path = match Command::new(which_cmd).arg(&agent_id).output() {
        Ok(output) if output.status.success() => {
            let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if p.is_empty() { None } else { Some(p) }
        }
        _ => None,
    };

    if path.is_none() {
        return Ok(AgentAvailability {
            installed: false,
            path: None,
            version: None,
        });
    }

    // Try to get version string
    let version = match Command::new(&agent_id).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let v = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if v.is_empty() { None } else { Some(v) }
        }
        _ => None,
    };

    Ok(AgentAvailability {
        installed: true,
        path,
        version,
    })
}
