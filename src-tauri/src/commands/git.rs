use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Serialize, Deserialize, Clone)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

/// Run a git command in the given directory, returning stdout on success.
fn git(dir: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(stderr)
    }
}

#[tauri::command]
pub async fn git_check_available() -> Result<bool, String> {
    match Command::new("git").arg("--version").output() {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn git_is_repo(path: String) -> Result<bool, String> {
    match git(&path, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn git_init(path: String) -> Result<(), String> {
    git(&path, &["init"])?;
    Ok(())
}

#[tauri::command]
pub async fn git_get_config(key: String) -> Result<Option<String>, String> {
    let output = Command::new("git")
        .args(["config", "--global", &key])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if output.status.success() {
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if value.is_empty() {
            Ok(None)
        } else {
            Ok(Some(value))
        }
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn git_set_config(key: String, value: String) -> Result<(), String> {
    let output = Command::new("git")
        .args(["config", "--global", &key, &value])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(stderr)
    }
}

#[tauri::command]
pub async fn git_status(path: String) -> Result<Vec<GitFileStatus>, String> {
    let repo_root = git(&path, &["rev-parse", "--show-toplevel"])?;

    // Use -z for NUL-terminated entries — paths are output verbatim, never C-quoted.
    // This avoids encoding/quoting issues that corrupt path parsing.
    let output = Command::new("git")
        .current_dir(&path)
        .args(["status", "--porcelain=v1", "-z"])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(stderr);
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = raw.split('\0').filter(|s| !s.is_empty()).collect();
    let mut results: Vec<GitFileStatus> = Vec::new();
    let mut i = 0;

    while i < parts.len() {
        let entry = parts[i];

        if entry.len() < 4 {
            i += 1;
            continue;
        }

        let bytes = entry.as_bytes();
        let index_status = bytes[0];
        let wt_status = bytes[1];
        // Format: "XY PATH" — bytes[2] is space, path starts at byte 3
        let rel_path = &entry[3..];

        // For renames/copies with -z, the next NUL-part is the destination path.
        let rel_path = if index_status == b'R' || index_status == b'C' {
            if i + 1 < parts.len() {
                i += 1;
                parts[i]
            } else {
                rel_path
            }
        } else {
            rel_path
        };

        let abs_path = Path::new(&repo_root)
            .join(rel_path)
            .to_string_lossy()
            .to_string();

        // Staged (index) changes
        match index_status {
            b'A' => results.push(GitFileStatus {
                path: abs_path.clone(),
                status: "added".to_string(),
                staged: true,
            }),
            b'M' | b'T' => results.push(GitFileStatus {
                path: abs_path.clone(),
                status: "modified".to_string(),
                staged: true,
            }),
            b'D' => results.push(GitFileStatus {
                path: abs_path.clone(),
                status: "deleted".to_string(),
                staged: true,
            }),
            b'R' => results.push(GitFileStatus {
                path: abs_path.clone(),
                status: "renamed".to_string(),
                staged: true,
            }),
            _ => {}
        }

        // Working tree (unstaged) changes
        match wt_status {
            b'M' | b'T' => results.push(GitFileStatus {
                path: abs_path.clone(),
                status: "modified".to_string(),
                staged: false,
            }),
            b'D' => results.push(GitFileStatus {
                path: abs_path.clone(),
                status: "deleted".to_string(),
                staged: false,
            }),
            _ => {}
        }

        // Untracked
        if index_status == b'?' && wt_status == b'?' {
            results.push(GitFileStatus {
                path: abs_path.clone(),
                status: "untracked".to_string(),
                staged: false,
            });
        }

        // Conflicted
        if (index_status == b'U' || wt_status == b'U')
            || (index_status == b'A' && wt_status == b'A')
            || (index_status == b'D' && wt_status == b'D')
        {
            results.push(GitFileStatus {
                path: abs_path,
                status: "conflicted".to_string(),
                staged: false,
            });
        }

        i += 1;
    }

    Ok(results)
}

#[tauri::command]
pub async fn git_branch_current(path: String) -> Result<String, String> {
    match git(&path, &["branch", "--show-current"]) {
        Ok(branch) if !branch.is_empty() => Ok(branch),
        Ok(_) => match git(&path, &["rev-parse", "--short", "HEAD"]) {
            Ok(hash) => Ok(format!("HEAD ({})", hash)),
            Err(_) => Ok("main".to_string()),
        },
        Err(_) => Ok("main".to_string()),
    }
}

#[tauri::command]
pub async fn git_branch_list(path: String) -> Result<Vec<String>, String> {
    let output = git(&path, &["branch", "--list", "--format=%(refname:short)"])?;
    let mut names: Vec<String> = output
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
pub async fn git_branch_switch(path: String, branch: String) -> Result<(), String> {
    git(&path, &["switch", &branch])?;
    Ok(())
}

#[tauri::command]
pub async fn git_stage(path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let mut args = vec!["add", "--"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);
    git(&path, &args)?;
    Ok(())
}

#[tauri::command]
pub async fn git_unstage(path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let mut args = vec!["reset", "HEAD", "--"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);
    git(&path, &args)?;
    Ok(())
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<String, String> {
    let name_check = Command::new("git")
        .current_dir(&path)
        .args(["config", "user.name"])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    let email_check = Command::new("git")
        .current_dir(&path)
        .args(["config", "user.email"])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    let has_name = name_check.status.success()
        && !String::from_utf8_lossy(&name_check.stdout).trim().is_empty();
    let has_email = email_check.status.success()
        && !String::from_utf8_lossy(&email_check.stdout).trim().is_empty();

    if !has_name || !has_email {
        return Err("GIT_CONFIG_MISSING".to_string());
    }

    git(&path, &["commit", "-m", &message])?;

    let hash = git(&path, &["rev-parse", "--short", "HEAD"])?;
    Ok(hash)
}
