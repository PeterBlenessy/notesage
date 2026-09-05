use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use super::ios_library::DownloadState;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettings {
    pub version: u32,
    pub icloud_enabled: bool,
    pub sync_quick_notes: bool,
    pub synced_projects: Vec<String>,
}

impl Default for SyncSettings {
    fn default() -> Self {
        Self {
            version: 1,
            icloud_enabled: false,
            sync_quick_notes: true,
            synced_projects: Vec::new(),
        }
    }
}

/// Detect iCloud Drive path on macOS.
/// Returns Some(path) if ~/Library/Mobile Documents/com~apple~CloudDocs/ exists.
/// Returns None on non-macOS platforms or if iCloud is not configured.
#[tauri::command]
pub async fn get_icloud_path() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir()
            .ok_or_else(|| "Could not determine home directory".to_string())?;
        let icloud_root = home
            .join("Library")
            .join("Mobile Documents")
            .join("com~apple~CloudDocs");

        if icloud_root.exists() {
            Ok(Some(icloud_root.to_string_lossy().to_string()))
        } else {
            Ok(None)
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(None)
    }
}

/// The name iCloud Drive gives an evicted file's placeholder: `<dir>/.<name>.icloud`
/// beside the missing `<dir>/<name>`. `None` when the path has no file name.
pub fn icloud_placeholder_path(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_str()?;
    Some(path.with_file_name(format!(".{name}.icloud")))
}

/// Pure classification behind `icloud_ensure_downloaded`, so the state table
/// is testable without a live iCloud container: the file itself on disk is
/// `Ready`; only a placeholder means a download can be asked for; neither
/// means there is nothing to download from.
pub fn classify_icloud_item(file_exists: bool, placeholder_exists: bool) -> DownloadState {
    if file_exists {
        DownloadState::Ready
    } else if placeholder_exists {
        DownloadState::Downloading
    } else {
        DownloadState::Failed
    }
}

/// Make sure an iCloud Drive file is materialized on disk.
///
/// The recordings scanner (PRD `2026-09-05-ios-recordings`) meets evicted
/// audio: iCloud keeps `.audio.m4a.icloud` and no `audio.m4a`, and a
/// `file_size` on the real name fails. This asks iCloud to download the
/// item and reports `downloading`; the scanner then waits for the watcher
/// event the arriving file produces rather than polling. `ready` when the
/// file is already there, `failed` when there is no placeholder to download
/// from or the download request itself is refused.
///
/// macOS drives `NSFileManager.startDownloadingUbiquitousItem(at:)`; on any
/// other platform there is no iCloud, so the answer is `ready` when the
/// file exists and `failed` otherwise.
#[tauri::command]
pub async fn icloud_ensure_downloaded(path: String) -> Result<DownloadState, String> {
    let item = PathBuf::from(&path);
    let placeholder_exists = icloud_placeholder_path(&item)
        .map(|p| p.exists())
        .unwrap_or(false);
    let state = classify_icloud_item(item.exists(), placeholder_exists);
    if state != DownloadState::Downloading {
        return Ok(state);
    }

    #[cfg(target_os = "macos")]
    {
        // The download request goes through Foundation; keep it off the IPC thread.
        let outcome = tokio::task::spawn_blocking(move || start_ubiquitous_download(&item))
            .await
            .map_err(|e| format!("iCloud download task failed: {e}"))?;
        Ok(match outcome {
            Ok(()) => DownloadState::Downloading,
            Err(err) => {
                log::warn!("icloud_ensure_downloaded({path}): {err}");
                DownloadState::Failed
            }
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        // A placeholder without iCloud to download it from is not going to fill in.
        Ok(DownloadState::Failed)
    }
}

#[cfg(target_os = "macos")]
fn start_ubiquitous_download(item: &Path) -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let path = NSString::from_str(&item.to_string_lossy());
    let url = NSURL::fileURLWithPath(&path);
    NSFileManager::defaultManager()
        .startDownloadingUbiquitousItemAtURL_error(&url)
        .map_err(|e| e.localizedDescription().to_string())
}

/// Read sync settings from {notesage_path}/.notesage/sync-settings.json.
/// Returns None if the file doesn't exist (first launch).
#[tauri::command]
pub async fn read_sync_settings(notesage_path: String) -> Result<Option<SyncSettings>, String> {
    let settings_path = Path::new(&notesage_path)
        .join(".notesage")
        .join("sync-settings.json");

    if !settings_path.exists() {
        return Ok(None);
    }

    let content = tokio::fs::read_to_string(&settings_path)
        .await
        .map_err(|e| format!("Failed to read sync settings: {e}"))?;

    let settings: SyncSettings = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse sync settings: {e}"))?;

    Ok(Some(settings))
}

/// Write sync settings to {notesage_path}/.notesage/sync-settings.json.
#[tauri::command]
pub async fn write_sync_settings(
    notesage_path: String,
    settings: SyncSettings,
) -> Result<(), String> {
    let meta_dir = Path::new(&notesage_path).join(".notesage");
    if !meta_dir.exists() {
        tokio::fs::create_dir_all(&meta_dir)
            .await
            .map_err(|e| format!("Failed to create .notesage directory: {e}"))?;
    }

    let settings_path = meta_dir.join("sync-settings.json");
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize sync settings: {e}"))?;

    tokio::fs::write(&settings_path, content)
        .await
        .map_err(|e| format!("Failed to write sync settings: {e}"))?;

    Ok(())
}

/// Move a project folder to the iCloud Notesage directory.
/// Uses atomic rename on the same volume, falls back to copy+verify+delete cross-volume.
#[tauri::command]
pub async fn migrate_to_icloud(
    project_path: String,
    icloud_notesage_path: String,
) -> Result<String, String> {
    let source = Path::new(&project_path);
    if !source.exists() {
        return Err(format!("Source project not found: {project_path}"));
    }
    if !source.is_dir() {
        return Err(format!("Source is not a directory: {project_path}"));
    }

    let project_name = source
        .file_name()
        .ok_or_else(|| "Could not determine project name".to_string())?
        .to_string_lossy()
        .to_string();

    let icloud_dir = Path::new(&icloud_notesage_path);
    // Create iCloud Notesage folder if it doesn't exist
    if !icloud_dir.exists() {
        tokio::fs::create_dir_all(icloud_dir)
            .await
            .map_err(|e| format!("Failed to create iCloud Notesage directory: {e}"))?;
    }

    let dest = icloud_dir.join(&project_name);
    if dest.exists() {
        return Err(format!(
            "A folder named '{}' already exists in iCloud Notesage",
            project_name
        ));
    }

    migrate_directory(source, &dest).await
}

/// Move a project folder from iCloud back to the local Notesage directory.
/// Uses atomic rename on the same volume, falls back to copy+verify+delete cross-volume.
#[tauri::command]
pub async fn migrate_from_icloud(
    project_path: String,
    local_notesage_path: String,
) -> Result<String, String> {
    let source = Path::new(&project_path);
    if !source.exists() {
        return Err(format!("Source project not found: {project_path}"));
    }
    if !source.is_dir() {
        return Err(format!("Source is not a directory: {project_path}"));
    }

    let project_name = source
        .file_name()
        .ok_or_else(|| "Could not determine project name".to_string())?
        .to_string_lossy()
        .to_string();

    let local_dir = Path::new(&local_notesage_path);
    if !local_dir.exists() {
        return Err(format!(
            "Local Notesage directory not found: {local_notesage_path}"
        ));
    }

    let dest = local_dir.join(&project_name);
    if dest.exists() {
        return Err(format!(
            "A folder named '{}' already exists in local Notesage",
            project_name
        ));
    }

    migrate_directory(source, &dest).await
}

/// Move loose files (Quick Notes) between Notesage directories.
/// Moves all non-directory entries from `from_path` to `to_path`, skipping `.notesage` and
/// any directories (which are project folders). Returns the number of files moved.
#[tauri::command]
pub async fn migrate_quick_notes(
    from_path: String,
    to_path: String,
) -> Result<u32, String> {
    let from = Path::new(&from_path);
    let to = Path::new(&to_path);

    if !from.exists() {
        return Err(format!("Source directory not found: {from_path}"));
    }
    if !to.exists() {
        tokio::fs::create_dir_all(to)
            .await
            .map_err(|e| format!("Failed to create destination directory: {e}"))?;
    }

    let entries = std::fs::read_dir(from)
        .map_err(|e| format!("Failed to read source directory: {e}"))?;

    let mut moved = 0u32;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
        let file_type = entry.file_type().map_err(|e| format!("Failed to get file type: {e}"))?;

        // Skip directories (projects) and .notesage metadata
        if file_type.is_dir() {
            continue;
        }

        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == ".notesage" || name_str.starts_with('.') {
            continue;
        }

        let dest = to.join(&name);
        if dest.exists() {
            // Skip files that already exist at destination to avoid data loss
            continue;
        }

        let source = entry.path();
        // Try rename first, fall back to copy+delete
        match std::fs::rename(&source, &dest) {
            Ok(()) => {
                moved += 1;
            }
            Err(_) => {
                // Cross-volume: copy then delete
                std::fs::copy(&source, &dest)
                    .map_err(|e| format!("Failed to copy {}: {e}", name_str))?;
                std::fs::remove_file(&source)
                    .map_err(|e| format!("Copied but failed to remove source {}: {e}", name_str))?;
                moved += 1;
            }
        }
    }

    Ok(moved)
}

/// Core migration logic: try atomic rename, fall back to copy+verify+delete.
async fn migrate_directory(source: &Path, dest: &Path) -> Result<String, String> {
    let dest_str = dest.to_string_lossy().to_string();

    // Try atomic rename first (works on same APFS volume)
    match std::fs::rename(source, dest) {
        Ok(()) => return Ok(dest_str),
        Err(e) => {
            // EXDEV = cross-device link, need copy fallback
            #[cfg(unix)]
            let is_cross_device = e.raw_os_error() == Some(libc::EXDEV);
            #[cfg(not(unix))]
            let is_cross_device = true; // Always use copy on non-unix

            if !is_cross_device {
                return Err(format!("Failed to move project: {e}"));
            }
        }
    }

    // Cross-volume fallback: copy → verify → delete
    let source_owned = source.to_path_buf();
    let dest_owned = dest.to_path_buf();

    tokio::task::spawn_blocking(move || {
        // Copy recursively
        let mut options = fs_extra::dir::CopyOptions::new();
        options.copy_inside = true;
        options.content_only = false;

        fs_extra::dir::copy(&source_owned, dest_owned.parent().unwrap(), &options)
            .map_err(|e| format!("Failed to copy project: {e}"))?;

        // Verify: compare file counts
        let source_count = count_files(&source_owned)
            .map_err(|e| format!("Failed to count source files: {e}"))?;
        let dest_count = count_files(&dest_owned)
            .map_err(|e| format!("Failed to count destination files: {e}"))?;

        if source_count != dest_count {
            // Clean up failed copy
            let _ = std::fs::remove_dir_all(&dest_owned);
            return Err(format!(
                "Verification failed: source has {source_count} files but copy has {dest_count}"
            ));
        }

        // Delete source only after successful verification
        std::fs::remove_dir_all(&source_owned)
            .map_err(|e| format!("Copy succeeded but failed to remove source: {e}"))?;

        Ok(dest_owned.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("Migration task failed: {e}"))?
}

/// Count all files (not directories) recursively in a directory.
fn count_files(path: &Path) -> Result<usize, std::io::Error> {
    let mut count = 0;
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            count += count_files(&entry.path())?;
        } else {
            count += 1;
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_path_is_dot_name_dot_icloud_beside_the_item() {
        let p = icloud_placeholder_path(Path::new("/lib/Recordings/Recording 2026-09-05 14-02-11/audio.m4a"));
        assert_eq!(
            p,
            Some(PathBuf::from("/lib/Recordings/Recording 2026-09-05 14-02-11/.audio.m4a.icloud"))
        );
        assert_eq!(icloud_placeholder_path(Path::new("/")), None);
    }

    #[test]
    fn classification_prefers_the_real_file_over_a_placeholder() {
        assert_eq!(classify_icloud_item(true, true), DownloadState::Ready);
        assert_eq!(classify_icloud_item(true, false), DownloadState::Ready);
        assert_eq!(classify_icloud_item(false, true), DownloadState::Downloading);
        assert_eq!(classify_icloud_item(false, false), DownloadState::Failed);
    }

    #[tokio::test]
    async fn ensure_downloaded_is_ready_for_a_file_on_disk_and_failed_with_nothing_to_download() {
        let dir = tempfile::TempDir::new().unwrap();
        let audio = dir.path().join("audio.m4a");
        std::fs::write(&audio, b"aac").unwrap();
        let s = audio.to_string_lossy().to_string();
        assert_eq!(icloud_ensure_downloaded(s).await.unwrap(), DownloadState::Ready);

        let missing = dir.path().join("missing.m4a").to_string_lossy().to_string();
        assert_eq!(icloud_ensure_downloaded(missing).await.unwrap(), DownloadState::Failed);
    }

    #[tokio::test]
    async fn ensure_downloaded_sees_a_placeholder_and_never_reports_ready_for_it() {
        // A placeholder outside any iCloud container: macOS refuses the
        // download request (→ failed); elsewhere there is no iCloud (→ failed).
        // Either way it must not claim the audio is ready to read.
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join(".audio.m4a.icloud"), b"plist").unwrap();
        let path = dir.path().join("audio.m4a").to_string_lossy().to_string();
        let state = icloud_ensure_downloaded(path).await.unwrap();
        assert_ne!(state, DownloadState::Ready);
    }
}
