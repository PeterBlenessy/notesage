use serde::Serialize;
use std::net::TcpListener;
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct BinaryStatus {
    pub available: bool,
    pub location: String,  // "bundled", "managed", "system", "not_found"
    pub path: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct DiagnosticFile {
    pub name: String,
    pub size_bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct LocalAIDiagnostics {
    pub binary_available: bool,
    pub binary_location: String,
    pub binary_path: Option<String>,
    pub models_dir: String,
    pub models_dir_exists: bool,
    pub models_on_disk: Vec<DiagnosticFile>,
    pub stale_files: Vec<DiagnosticFile>,
}

// ---------------------------------------------------------------------------
// Port resolution
// ---------------------------------------------------------------------------

/// Find an available TCP port starting from `start`.
pub fn find_available_port(start: u16) -> Option<u16> {
    for port in start..start + 100 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

/// Get the Tauri sidecar binary name (with target triple suffix for prod builds).
fn sidecar_binary_name() -> String {
    let triple = format!("{}-{}", std::env::consts::ARCH, match std::env::consts::OS {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-gnu",
        "windows" => "pc-windows-msvc",
        _ => "unknown",
    });
    format!("llama-server-{}", triple)
}

/// Resolve the llama-server binary path.
/// Checks: 1) next to the app executable (bundled sidecar), 2) dev source dir, 3) PATH
pub fn resolve_llama_server_binary() -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()));

    if let Some(ref dir) = exe_dir {
        // 1. Bundled sidecar — next to the app executable
        if let Some(path) = resolve_bundled_sidecar(dir) {
            return Ok(path);
        }

        // 2. Dev mode fallback — source binaries directory (survives cargo clean)
        if let Some(path) = resolve_dev_binary(dir) {
            return Ok(path);
        }
    }

    // 3. System PATH
    if let Some(path) = resolve_system_path() {
        return Ok(path);
    }

    log::warn!(target: "notesage::local_ai", "llama-server binary not found at any resolution path");
    Err(
        "llama-server binary not found. It should be bundled with the app or available in PATH."
            .to_string(),
    )
}

/// Check for bundled sidecar next to the executable directory.
fn resolve_bundled_sidecar(exe_dir: &std::path::Path) -> Option<PathBuf> {
    let candidates = [sidecar_binary_name(), "llama-server".to_string()];
    for name in &candidates {
        let binary = exe_dir.join(name);
        let exists = binary.exists();
        log::debug!(target: "notesage::local_ai", "Binary check: {} exists={}", binary.display(), exists);
        if exists {
            let is_dev = exe_dir.to_string_lossy().contains("/target/");
            if !is_dev || exe_dir.join("lib").exists() {
                log::info!(target: "notesage::local_ai", "Resolved binary: {} ({})", binary.display(), if is_dev { "dev" } else { "bundled" });
                return Some(binary);
            }
            log::debug!(target: "notesage::local_ai", "Skipping {} — dev mode and lib/ not found", binary.display());
        }
    }
    None
}

/// Check dev source binaries directory (survives cargo clean).
fn resolve_dev_binary(exe_dir: &std::path::Path) -> Option<PathBuf> {
    let triple = format!("{}-{}", std::env::consts::ARCH, match std::env::consts::OS {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-gnu",
        _ => "",
    });
    // Walk up from target/debug/ to src-tauri/binaries/
    let src_tauri = exe_dir.parent()?.parent()?;
    let dev_binary = src_tauri.join("binaries").join(format!("llama-server-{}", triple));
    let exists = dev_binary.exists();
    log::debug!(target: "notesage::local_ai", "Dev fallback check: {} exists={}", dev_binary.display(), exists);
    if exists {
        log::info!(target: "notesage::local_ai", "Resolved binary: {} (dev fallback)", dev_binary.display());
        return Some(dev_binary);
    }
    None
}

/// Check system PATH via `which`.
fn resolve_system_path() -> Option<PathBuf> {
    let output = std::process::Command::new("which")
        .arg("llama-server")
        .output()
        .ok()?;
    if output.status.success() {
        let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path_str.is_empty() {
            log::info!(target: "notesage::local_ai", "Resolved binary: {} (system PATH)", path_str);
            return Some(PathBuf::from(path_str));
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Binary availability check
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn check_llama_server_available() -> Result<BinaryStatus, String> {
    // Check for stale ~/.notesage/bin/ leftovers from legacy download feature
    if let Some(home) = dirs::home_dir() {
        let stale_bin_dir = home.join(".notesage").join("bin");
        if stale_bin_dir.exists() {
            let stale_size = dir_total_size(&stale_bin_dir);
            log::warn!(
                target: "notesage::local_ai",
                "Stale ~/.notesage/bin/ directory found ({} bytes) — this is a leftover from a previous version and can be safely deleted",
                stale_size
            );
        }
    }

    // Use the same resolution logic as start_local_server
    match resolve_llama_server_binary() {
        Ok(path) => {
            let location = if path.to_string_lossy().contains("/target/") || path.to_string_lossy().contains("/binaries/") {
                "dev"
            } else if path.to_string_lossy().contains("/usr/") || path.to_string_lossy().contains("/bin/") {
                "system"
            } else {
                "bundled"
            };
            Ok(BinaryStatus {
                available: true,
                location: location.to_string(),
                path: Some(path.to_string_lossy().to_string()),
            })
        }
        Err(_) => Ok(BinaryStatus {
            available: false,
            location: "not_found".to_string(),
            path: None,
        }),
    }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/// Calculate total size of a directory recursively.
pub fn dir_total_size(dir: &std::path::Path) -> u64 {
    let mut total: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total += meta.len();
                } else if meta.is_dir() {
                    total += dir_total_size(&entry.path());
                }
            }
        }
    }
    total
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/// Collect Local AI diagnostic info for the diagnostics export.
pub fn collect_local_ai_diagnostics() -> LocalAIDiagnostics {
    let binary = resolve_llama_server_binary();
    let (binary_available, binary_location, binary_path) = match &binary {
        Ok(path) => {
            let loc = if path.to_string_lossy().contains("/target/") || path.to_string_lossy().contains("/binaries/") {
                "dev"
            } else if path.to_string_lossy().contains("/usr/") || path.to_string_lossy().contains("/bin/") {
                "system"
            } else {
                "bundled"
            };
            (true, loc.to_string(), Some(path.to_string_lossy().to_string()))
        }
        Err(_) => (false, "not_found".to_string(), None),
    };

    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let models_dir = home.join(".notesage").join("models").join("llm");
    let bin_dir = home.join(".notesage").join("bin");

    // Scan for model files on disk
    let models_on_disk = if models_dir.exists() {
        std::fs::read_dir(&models_dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter_map(|e| {
                        let meta = e.metadata().ok()?;
                        if meta.is_file() {
                            Some(DiagnosticFile {
                                name: e.file_name().to_string_lossy().to_string(),
                                size_bytes: meta.len(),
                            })
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        vec![]
    };

    // Detect stale files
    let mut stale_files: Vec<DiagnosticFile> = vec![];

    // Stale ~/.notesage/bin/ leftovers
    if bin_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&bin_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    stale_files.push(DiagnosticFile {
                        name: format!("~/.notesage/bin/{}", entry.file_name().to_string_lossy()),
                        size_bytes: if meta.is_dir() { dir_total_size(&entry.path()) } else { meta.len() },
                    });
                }
            }
        }
    }

    // Stale .tmp / .part files in models dir
    if models_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&models_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".tmp") || name.ends_with(".part") {
                    if let Ok(meta) = entry.metadata() {
                        stale_files.push(DiagnosticFile {
                            name: format!("~/.notesage/models/llm/{}", name),
                            size_bytes: meta.len(),
                        });
                    }
                }
            }
        }
    }

    LocalAIDiagnostics {
        binary_available,
        binary_location,
        binary_path,
        models_dir: models_dir.to_string_lossy().to_string(),
        models_dir_exists: models_dir.exists(),
        models_on_disk,
        stale_files,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_resolve_bundled_sidecar_prod() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();

        // Create a binary with the sidecar name (simulating prod)
        let binary_name = sidecar_binary_name();
        fs::write(dir.join(&binary_name), b"fake binary").unwrap();

        let result = resolve_bundled_sidecar(dir);
        assert!(result.is_some(), "Should find bundled sidecar in prod-like dir");
        assert!(result.unwrap().ends_with(&binary_name));
    }

    #[test]
    fn test_resolve_bundled_sidecar_dev_with_lib() {
        // Dev mode: dir contains /target/, but lib/ exists → should resolve
        let tmp = tempfile::tempdir().unwrap();
        let target_dir = tmp.path().join("some").join("target").join("debug");
        fs::create_dir_all(&target_dir).unwrap();
        fs::write(target_dir.join("llama-server"), b"fake binary").unwrap();
        fs::create_dir_all(target_dir.join("lib")).unwrap();

        let result = resolve_bundled_sidecar(&target_dir);
        assert!(result.is_some(), "Should find binary in dev mode when lib/ exists");
    }

    #[test]
    fn test_resolve_bundled_sidecar_dev_without_lib() {
        // Dev mode: dir contains /target/, no lib/ → should skip
        let tmp = tempfile::tempdir().unwrap();
        let target_dir = tmp.path().join("some").join("target").join("debug");
        fs::create_dir_all(&target_dir).unwrap();
        fs::write(target_dir.join("llama-server"), b"fake binary").unwrap();

        let result = resolve_bundled_sidecar(&target_dir);
        assert!(result.is_none(), "Should skip dev binary when lib/ is missing");
    }

    #[test]
    fn test_resolve_bundled_sidecar_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let result = resolve_bundled_sidecar(tmp.path());
        assert!(result.is_none(), "Should return None when no binary exists");
    }

    #[test]
    fn test_resolve_dev_binary() {
        let tmp = tempfile::tempdir().unwrap();
        // Simulate: exe at src-tauri/target/debug/notesage
        let target_dir = tmp.path().join("target").join("debug");
        fs::create_dir_all(&target_dir).unwrap();

        let triple = format!("{}-{}", std::env::consts::ARCH, match std::env::consts::OS {
            "macos" => "apple-darwin",
            "linux" => "unknown-linux-gnu",
            _ => "",
        });
        let binaries_dir = tmp.path().join("binaries");
        fs::create_dir_all(&binaries_dir).unwrap();
        fs::write(binaries_dir.join(format!("llama-server-{}", triple)), b"fake binary").unwrap();

        let result = resolve_dev_binary(&target_dir);
        assert!(result.is_some(), "Should find dev binary in binaries/ relative to src-tauri");
    }

    #[test]
    fn test_resolve_dev_binary_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let target_dir = tmp.path().join("target").join("debug");
        fs::create_dir_all(&target_dir).unwrap();

        let result = resolve_dev_binary(&target_dir);
        assert!(result.is_none(), "Should return None when dev binary doesn't exist");
    }

    #[test]
    fn test_dir_total_size() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), b"hello").unwrap(); // 5 bytes
        fs::write(tmp.path().join("b.txt"), b"world!").unwrap(); // 6 bytes
        let sub = tmp.path().join("sub");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("c.txt"), b"test").unwrap(); // 4 bytes

        assert_eq!(dir_total_size(tmp.path()), 15);
    }
}
