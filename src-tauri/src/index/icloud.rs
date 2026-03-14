use std::path::Path;

/// Exclude a database file (and its WAL/SHM companions) from iCloud backup.
/// No-op on non-macOS platforms.
#[cfg(target_os = "macos")]
pub fn exclude_from_icloud(path: &Path) {
    for suffix in &["", "-wal", "-shm"] {
        let p = format!("{}{}", path.display(), suffix);
        let _ = std::process::Command::new("xattr")
            .args([
                "-w",
                "com.apple.metadata:com_apple_backup_excludeItem",
                "com.apple.asbd:com.apple.backup",
                &p,
            ])
            .output();
    }
}

#[cfg(not(target_os = "macos"))]
pub fn exclude_from_icloud(_path: &Path) {
    // No-op on non-macOS platforms
}
