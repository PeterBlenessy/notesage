//! iOS library access + share-capture Tauri commands (PRD
//! `docs/prds/2026-06-28-ios-mobile-app.md`, tasks #5/#6/#8).
//!
//! The Notesage library lives at a fixed location (`iCloud Drive/Notesage`),
//! but iOS sandboxing forbids opening a hardcoded path inside the generic
//! iCloud Drive (`com~apple~CloudDocs`). Apple's only supported route is a
//! user-granted, security-scoped folder access via the document picker; the
//! grant is persisted as a security-scoped bookmark in an App Group container
//! so the share extension can use it too. See `src-tauri/ios/README.md`.
//!
//! These commands are registered on every platform so the frontend surface is
//! uniform and the desktop build keeps compiling. The real work is iOS-only:
//! on non-iOS targets every command returns an error; on iOS it delegates to
//! [`ios_impl`], which the native wiring step (`tauri ios init` on a Mac, plus
//! the Swift sources under `src-tauri/ios/`) fills in. All read paths are
//! resolved **relative to the granted library root**; absolute paths and `..`
//! traversal are rejected.

use crate::commands::file::FileEntry;
use serde::{Deserialize, Serialize};

pub use crate::commands::capture::CaptureInput;

/// State of the iCloud library grant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryGrant {
    /// User-facing folder name (e.g. `Notesage`). Empty when not granted.
    pub display_name: String,
    /// Whether a usable (non-stale) bookmark is currently resolved.
    pub granted: bool,
}

/// iCloud download state for a file that may be a not-yet-downloaded placeholder.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadState {
    Ready,
    Downloading,
    Failed,
}

// ---------------------------------------------------------------------------
// Path safety (shared by all platforms — guards the iOS impl against traversal)
// ---------------------------------------------------------------------------

/// Reject absolute paths and any `..` component so a relative library path can
/// never escape the granted root. Returns the normalized relative path.
pub fn sanitize_rel_path(rel_path: &str) -> Result<String, String> {
    let trimmed = rel_path.trim_start_matches('/');
    if rel_path.starts_with('/') {
        return Err("Path must be relative to the library root".into());
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in trimmed.split('/') {
        match part {
            "" | "." => continue,
            ".." => return Err("Path traversal is not allowed".into()),
            other => parts.push(other),
        }
    }
    Ok(parts.join("/"))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Present the iOS folder picker (pre-pointed at `iCloud Drive/Notesage`) and
/// persist a security-scoped bookmark for the chosen folder.
#[tauri::command]
pub async fn ios_pick_library_folder() -> Result<LibraryGrant, String> {
    #[cfg(target_os = "ios")]
    {
        ios_impl::pick_library_folder().await
    }
    #[cfg(not(target_os = "ios"))]
    {
        Err("ios_pick_library_folder is only available on iOS".into())
    }
}

/// Return the current grant (resolving the persisted bookmark), or `granted:
/// false` when none exists / the bookmark is stale.
#[tauri::command]
pub async fn ios_get_library_grant() -> Result<LibraryGrant, String> {
    #[cfg(target_os = "ios")]
    {
        ios_impl::get_library_grant().await
    }
    #[cfg(not(target_os = "ios"))]
    {
        Ok(LibraryGrant {
            display_name: String::new(),
            granted: false,
        })
    }
}

/// Forget the persisted bookmark (used when the user re-grants or signs out).
#[tauri::command]
pub async fn ios_clear_library_grant() -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        ios_impl::clear_library_grant().await
    }
    #[cfg(not(target_os = "ios"))]
    {
        Ok(())
    }
}

/// List a directory relative to the granted library root.
#[tauri::command]
pub async fn ios_list_directory(rel_path: String) -> Result<Vec<FileEntry>, String> {
    let rel = sanitize_rel_path(&rel_path)?;
    #[cfg(target_os = "ios")]
    {
        ios_impl::list_directory(&rel).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = rel;
        Err("ios_list_directory is only available on iOS".into())
    }
}

/// Read a UTF-8 file relative to the granted library root.
#[tauri::command]
pub async fn ios_read_file(rel_path: String) -> Result<String, String> {
    let rel = sanitize_rel_path(&rel_path)?;
    #[cfg(target_os = "ios")]
    {
        ios_impl::read_file(&rel).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = rel;
        Err("ios_read_file is only available on iOS".into())
    }
}

/// Read a binary file (PDF/EPUB/DOCX/image) relative to the granted library root.
#[tauri::command]
pub async fn ios_read_binary(rel_path: String) -> Result<Vec<u8>, String> {
    let rel = sanitize_rel_path(&rel_path)?;
    #[cfg(target_os = "ios")]
    {
        ios_impl::read_binary(&rel).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = rel;
        Err("ios_read_binary is only available on iOS".into())
    }
}

/// Ensure an iCloud item is downloaded; returns its current download state.
#[tauri::command]
pub async fn ios_ensure_downloaded(rel_path: String) -> Result<DownloadState, String> {
    let rel = sanitize_rel_path(&rel_path)?;
    #[cfg(target_os = "ios")]
    {
        ios_impl::ensure_downloaded(&rel).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = rel;
        Err("ios_ensure_downloaded is only available on iOS".into())
    }
}

/// Write a link-only capture note into `Inbox/` under the granted library root.
/// Returns the relative path written. Never overwrites an existing note.
#[tauri::command]
pub async fn ios_write_capture(input: CaptureInput) -> Result<String, String> {
    #[cfg(target_os = "ios")]
    {
        ios_impl::write_capture(input).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = input;
        Err("ios_write_capture is only available on iOS".into())
    }
}

// ---------------------------------------------------------------------------
// iOS-only implementation seam
// ---------------------------------------------------------------------------
//
// Wired up during `tauri ios init` on a Mac. Each function returns a clear
// "not yet wired" error so the iOS app COMPILES and RUNS as a scaffold before
// the Swift bridge (security-scoped bookmark + NSFileCoordinator, see
// `src-tauri/ios/`) is integrated. Replace the bodies with calls into the
// Tauri mobile plugin that bridges to the Swift sources.

#[cfg(target_os = "ios")]
mod ios_impl {
    use super::*;
    use crate::commands::capture::build_capture_note;

    const NOT_WIRED: &str =
        "iOS native bridge not yet wired — see src-tauri/ios/README.md (run `tauri ios init` and integrate the Swift sources)";

    pub async fn pick_library_folder() -> Result<LibraryGrant, String> {
        Err(NOT_WIRED.into())
    }

    pub async fn get_library_grant() -> Result<LibraryGrant, String> {
        Ok(LibraryGrant {
            display_name: String::new(),
            granted: false,
        })
    }

    pub async fn clear_library_grant() -> Result<(), String> {
        Err(NOT_WIRED.into())
    }

    pub async fn list_directory(_rel: &str) -> Result<Vec<FileEntry>, String> {
        Err(NOT_WIRED.into())
    }

    pub async fn read_file(_rel: &str) -> Result<String, String> {
        Err(NOT_WIRED.into())
    }

    pub async fn read_binary(_rel: &str) -> Result<Vec<u8>, String> {
        Err(NOT_WIRED.into())
    }

    pub async fn ensure_downloaded(_rel: &str) -> Result<DownloadState, String> {
        Err(NOT_WIRED.into())
    }

    /// Once the bridge resolves the granted root + provides a coordinated
    /// writer, this builds the note via the shared (tested) formatter and
    /// writes it. The formatting is already exercised by `capture.rs` tests;
    /// only the folder resolution + coordinated write remain native work.
    pub async fn write_capture(input: CaptureInput) -> Result<String, String> {
        // The pure note content is ready to write the moment the bridge hands
        // back the granted root. Kept here (rather than discarded) so wiring is
        // a one-line "resolve root + coordinated-write `note.contents`".
        let (now_rfc3339, file_stamp) = super::timestamps();
        let _note = build_capture_note(&input, &now_rfc3339, &file_stamp);
        Err(NOT_WIRED.into())
    }
}

/// Compute the `date_saved` (RFC3339, UTC, seconds precision) and the filename
/// time stamp (`YYYY-MM-DD-HHmmss`, UTC) from the system clock. Kept dependency
/// -free (no `chrono`/`time` crate) via a small civil-time conversion.
#[allow(dead_code)]
fn timestamps() -> (String, String) {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0) as i64;
    let (y, mo, d, h, mi, s) = civil_from_unix(secs);
    (
        format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z"),
        format!("{y:04}-{mo:02}-{d:02}-{h:02}{mi:02}{s:02}"),
    )
}

/// Convert a Unix timestamp (seconds, UTC) to civil (Y, M, D, h, m, s).
/// Uses Howard Hinnant's `civil_from_days` algorithm — no external crates.
#[allow(dead_code)]
fn civil_from_unix(unix_secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = unix_secs.div_euclid(86_400);
    let secs_of_day = unix_secs.rem_euclid(86_400);
    let h = (secs_of_day / 3600) as u32;
    let mi = ((secs_of_day % 3600) / 60) as u32;
    let s = (secs_of_day % 60) as u32;

    // days since 1970-01-01 → civil date
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = if m <= 2 { y + 1 } else { y };
    (year, m, d, h, mi, s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_dot_segments() {
        assert_eq!(sanitize_rel_path("a/./b").unwrap(), "a/b");
        assert_eq!(sanitize_rel_path("a//b/").unwrap(), "a/b");
        assert_eq!(sanitize_rel_path("").unwrap(), "");
    }

    #[test]
    fn sanitize_rejects_absolute_and_traversal() {
        assert!(sanitize_rel_path("/etc/passwd").is_err());
        assert!(sanitize_rel_path("../secret").is_err());
        assert!(sanitize_rel_path("a/../../b").is_err());
    }

    #[test]
    fn civil_from_unix_known_values() {
        // 2026-06-28T10:14:00Z = 1782641640
        assert_eq!(civil_from_unix(1_782_641_640), (2026, 6, 28, 10, 14, 0));
        // epoch
        assert_eq!(civil_from_unix(0), (1970, 1, 1, 0, 0, 0));
    }
}
