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

/// On-disk size of a library file, in bytes — a cheap metadata probe that
/// lets a caller decide whether a file is safe to read/render BEFORE paying
/// for the read. See `ios_stat_file` (issue #616).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub size_bytes: u64,
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

/// Validate a SINGLE filename segment (for rename): non-empty, no `/`, no
/// path dots, no leading dot (hidden files are invisible to the mobile
/// browser — a rename into one would look like deletion).
pub fn sanitize_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("File name is empty".into());
    }
    if trimmed.contains('/') || trimmed == "." || trimmed == ".." {
        return Err("File name must be a single path segment".into());
    }
    if trimmed.starts_with('.') {
        return Err("File name cannot start with a dot".into());
    }
    Ok(trimmed.to_string())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Present the iOS folder picker (pre-pointed at `iCloud Drive/Notesage`) and
/// persist a security-scoped bookmark for the chosen folder.
#[tauri::command]
pub async fn ios_pick_library_folder(app: tauri::AppHandle) -> Result<LibraryGrant, String> {
    #[cfg(target_os = "ios")]
    {
        ios_impl::pick_library_folder(&app).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = &app;
        Err("ios_pick_library_folder is only available on iOS".into())
    }
}

/// Return the current grant (resolving the persisted bookmark), or `granted:
/// false` when none exists / the bookmark is stale.
#[tauri::command]
pub async fn ios_get_library_grant(app: tauri::AppHandle) -> Result<LibraryGrant, String> {
    #[cfg(target_os = "ios")]
    {
        ios_impl::get_library_grant(&app).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = &app;
        Ok(LibraryGrant {
            display_name: String::new(),
            granted: false,
        })
    }
}

/// Forget the persisted bookmark (used when the user re-grants or signs out).
#[tauri::command]
pub async fn ios_clear_library_grant(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        ios_impl::clear_library_grant(&app).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = &app;
        Ok(())
    }
}

/// List a directory relative to the granted library root. Carries the native
/// layer's Files-app row metadata (`modified`) through to the frontend (#588).
#[tauri::command]
pub async fn ios_list_directory(app: tauri::AppHandle, rel_path: String) -> Result<Vec<FileEntry>, String> {
    let rel = sanitize_rel_path(&rel_path)?;
    #[cfg(target_os = "ios")]
    {
        ios_impl::list_directory(&app, &rel).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = &app;
        let _ = rel;
        Err("ios_list_directory is only available on iOS".into())
    }
}

/// Read a UTF-8 file relative to the granted library root.
#[tauri::command]
pub async fn ios_read_file(app: tauri::AppHandle, rel_path: String) -> Result<String, String> {
    let rel = sanitize_rel_path(&rel_path)?;
    #[cfg(target_os = "ios")]
    {
        ios_impl::read_file(&app, &rel).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = &app;
        let _ = rel;
        Err("ios_read_file is only available on iOS".into())
    }
}

/// Read a binary file (PDF/EPUB/DOCX/image) relative to the granted library
/// root. Returns a RAW IPC response (`tauri::ipc::Response`), not JSON: a
/// `Vec<u8>` serializes as a JSON number array, and even base64-in-JSON makes
/// the WebView's main thread parse a payload-sized JSON string — for a large
/// PDF that froze the loading spinner for seconds. The Swift→Rust hop stays
/// base64 (the mobile plugin bridge is JSON-only), but that decode happens on
/// a Rust worker thread; the WebView receives bytes with zero JSON work.
#[tauri::command]
pub async fn ios_read_binary(
    app: tauri::AppHandle,
    rel_path: String,
) -> Result<tauri::ipc::Response, String> {
    let rel = sanitize_rel_path(&rel_path)?;
    #[cfg(target_os = "ios")]
    {
        use base64::Engine as _;
        let b64 = ios_impl::read_binary(&app, &rel).await?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("invalid base64 from native layer: {e}"))?;
        Ok(tauri::ipc::Response::new(bytes))
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = &app;
        let _ = rel;
        Err("ios_read_binary is only available on iOS".into())
    }
}

/// Overwrite (or create) a UTF-8 file relative to the granted library root —
/// the mobile editor's save path (#586). Atomic coordinated write natively.
#[tauri::command]
pub async fn ios_write_file(
    app: tauri::AppHandle,
    rel_path: String,
    content: String,
) -> Result<(), String> {
    let rel = sanitize_rel_path(&rel_path)?;
    if rel.is_empty() {
        return Err("Cannot write the library root".into());
    }
    #[cfg(target_os = "ios")]
    {
        ios_impl::write_file(&app, &rel, &content).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (&app, rel, content);
        Err("ios_write_file is only available on iOS".into())
    }
}

/// Create a new UTF-8 file relative to the granted library root (#586). The
/// name is deduped natively (`note.md` → `note-1.md`) rather than
/// overwritten; returns the relative path actually created.
#[tauri::command]
pub async fn ios_create_file(
    app: tauri::AppHandle,
    rel_path: String,
    content: String,
) -> Result<String, String> {
    let rel = sanitize_rel_path(&rel_path)?;
    if rel.is_empty() {
        return Err("File name is empty".into());
    }
    #[cfg(target_os = "ios")]
    {
        ios_impl::create_file(&app, &rel, &content).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (&app, rel, content);
        Err("ios_create_file is only available on iOS".into())
    }
}

/// Create a new folder relative to the granted library root (#586). The name
/// is deduped natively; returns the relative path actually created.
#[tauri::command]
pub async fn ios_create_directory(
    app: tauri::AppHandle,
    rel_path: String,
) -> Result<String, String> {
    let rel = sanitize_rel_path(&rel_path)?;
    if rel.is_empty() {
        return Err("Folder name is empty".into());
    }
    #[cfg(target_os = "ios")]
    {
        ios_impl::create_directory(&app, &rel).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (&app, rel);
        Err("ios_create_directory is only available on iOS".into())
    }
}

/// System-generated thumbnail (QLThumbnailGenerator) for gallery cards —
/// PDFs, images, videos and office docs rendered by the OS, off the
/// webview thread. Returns RAW PNG bytes (same rationale as
/// `ios_read_binary`: no JSON work on the WebView main thread).
#[tauri::command]
pub async fn ios_thumbnail(
    app: tauri::AppHandle,
    rel_path: String,
    max_pixel: f64,
) -> Result<tauri::ipc::Response, String> {
    let rel = sanitize_rel_path(&rel_path)?;
    if rel.is_empty() {
        return Err("Cannot thumbnail the library root".into());
    }
    #[cfg(target_os = "ios")]
    {
        use base64::Engine as _;
        let b64 = ios_impl::thumbnail(&app, &rel, max_pixel).await?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("invalid base64 from native layer: {e}"))?;
        Ok(tauri::ipc::Response::new(bytes))
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (&app, rel, max_pixel);
        Err("ios_thumbnail is only available on iOS".into())
    }
}

/// Present the system QuickLook preview for a library file — native
/// video/audio playback and document rendering for formats the web reader
/// does not handle. Reads a temp copy; writes nothing to the library.
#[tauri::command]
pub async fn ios_quick_look(app: tauri::AppHandle, rel_path: String) -> Result<(), String> {
    let rel = sanitize_rel_path(&rel_path)?;
    if rel.is_empty() {
        return Err("Cannot preview the library root".into());
    }
    #[cfg(target_os = "ios")]
    {
        ios_impl::quick_look(&app, &rel).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (&app, rel);
        Err("ios_quick_look is only available on iOS".into())
    }
}

/// Delete a FILE relative to the granted library root (#618 swipe-delete).
/// Directories are refused natively; iCloud's "Recently Deleted" (30-day
/// recovery) is the safety net for the no-confirm swipe gesture.
#[tauri::command]
pub async fn ios_delete_file(app: tauri::AppHandle, rel_path: String) -> Result<(), String> {
    let rel = sanitize_rel_path(&rel_path)?;
    if rel.is_empty() {
        return Err("Cannot delete the library root".into());
    }
    #[cfg(target_os = "ios")]
    {
        ios_impl::delete_file(&app, &rel).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (&app, rel);
        Err("ios_delete_file is only available on iOS".into())
    }
}

/// Rename a file WITHIN its directory (#586 — the title-becomes-filename
/// primitive, not a general move). `new_name` is a single validated path
/// segment; the native side dedupes on collision and returns the relative
/// path actually produced.
#[tauri::command]
pub async fn ios_rename_file(
    app: tauri::AppHandle,
    rel_path: String,
    new_name: String,
) -> Result<String, String> {
    let rel = sanitize_rel_path(&rel_path)?;
    if rel.is_empty() {
        return Err("Cannot rename the library root".into());
    }
    let name = sanitize_file_name(&new_name)?;
    #[cfg(target_os = "ios")]
    {
        ios_impl::rename_file(&app, &rel, &name).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (&app, rel, name);
        Err("ios_rename_file is only available on iOS".into())
    }
}

/// Create a directory at an exact relative path if it does not exist yet —
/// unlike `ios_create_directory`, which dedupes and would turn a second call
/// into `.notesage-1`. Used before writing the shared pins file (#680).
#[tauri::command]
pub async fn ios_ensure_directory(app: tauri::AppHandle, rel_path: String) -> Result<(), String> {
    let rel = sanitize_rel_path(&rel_path)?;
    if rel.is_empty() {
        return Err("Refusing to operate on the library root".into());
    }
    #[cfg(target_os = "ios")]
    {
        ios_impl::ensure_directory(&app, &rel).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (&app, &rel);
        Err("ios_ensure_directory is only available on iOS".into())
    }
}

/// Present the long-press preview + action menu (#680) and return the chosen
/// item id (`None` = dismissed). Pure UI — the caller performs the action.
#[tauri::command]
pub async fn ios_entry_menu(
    app: tauri::AppHandle,
    spec: serde_json::Value,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "ios")]
    {
        ios_impl::entry_menu(&app, spec).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (&app, spec);
        Err("ios_entry_menu is only available on iOS".into())
    }
}

/// One row of the native action sheet. Declared HERE rather than reused from
/// the plugin crate because that crate is an iOS-only dependency, while this
/// command's signature has to compile on every target.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContextMenuItemInput {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub destructive: bool,
}

/// Present a native action sheet for a long-pressed library item (#680) and
/// return the chosen item id (`None` = cancelled). Pure UI; the caller
/// performs whatever the choice means through the existing commands.
#[tauri::command]
pub async fn ios_context_menu(
    app: tauri::AppHandle,
    title: Option<String>,
    items: Vec<ContextMenuItemInput>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "ios")]
    {
        ios_impl::context_menu(&app, title, items, x, y).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (&app, title, items, x, y);
        Err("ios_context_menu is only available on iOS".into())
    }
}

/// Signal that the webview has painted its first frame, so the native
/// launch cover can fade out (#675). Pure UI; no filesystem, no arguments.
#[tauri::command]
pub async fn ios_content_ready(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        ios_impl::content_ready(&app).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = &app;
        Err("ios_content_ready is only available on iOS".into())
    }
}

/// Present a native single-line text prompt (UIAlertController with a text
/// field) — the create flow's name entry (#586). `Ok(None)` = cancelled.
/// Pure UI: takes no path and touches no filesystem.
#[tauri::command]
pub async fn ios_text_prompt(
    app: tauri::AppHandle,
    title: String,
    placeholder: String,
    confirm_label: String,
    value: Option<String>,
    select_stem: Option<bool>,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "ios")]
    {
        ios_impl::text_prompt(
            &app,
            &title,
            &placeholder,
            &confirm_label,
            value.as_deref(),
            select_stem.unwrap_or(false),
        )
        .await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (&app, title, placeholder, confirm_label, value, select_stem);
        Err("ios_text_prompt is only available on iOS".into())
    }
}

/// Declare the native chrome overlay (Liquid Glass buttons over the
/// webview). Config is a `{ topLeft?: {id, icon}, topRight?: {id, icon} }`
/// JSON value; icons are SF Symbol names. Taps arrive in the page as
/// `notesage:chrome` CustomEvents.
#[tauri::command]
pub async fn ios_set_chrome(app: tauri::AppHandle, spec: serde_json::Value) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        ios_impl::set_chrome(&app, spec).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (&app, spec);
        Err("ios_set_chrome is only available on iOS".into())
    }
}

/// Present the iOS share sheet for a library file. The native layer copies
/// the file to temp first (share targets can't read through the
/// security-scoped grant) and presents a `UIActivityViewController`.
#[tauri::command]
pub async fn ios_share_file(app: tauri::AppHandle, rel_path: String) -> Result<(), String> {
    let rel = sanitize_rel_path(&rel_path)?;
    #[cfg(target_os = "ios")]
    {
        ios_impl::share_file(&app, &rel).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = &app;
        let _ = rel;
        Err("ios_share_file is only available on iOS".into())
    }
}

/// Ensure an iCloud item is downloaded; returns its current download state.
#[tauri::command]
pub async fn ios_ensure_downloaded(app: tauri::AppHandle, rel_path: String) -> Result<DownloadState, String> {
    let rel = sanitize_rel_path(&rel_path)?;
    #[cfg(target_os = "ios")]
    {
        ios_impl::ensure_downloaded(&app, &rel).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = &app;
        let _ = rel;
        Err("ios_ensure_downloaded is only available on iOS".into())
    }
}

/// Return the on-disk size of a library file, in bytes, without reading its
/// content. The mobile reader calls this before `ios_read_file` for
/// text/markdown/html so it can decline an oversized file instead of
/// attempting a read that would freeze the WebView (issue #616).
#[tauri::command]
pub async fn ios_stat_file(app: tauri::AppHandle, rel_path: String) -> Result<FileStat, String> {
    let rel = sanitize_rel_path(&rel_path)?;
    #[cfg(target_os = "ios")]
    {
        ios_impl::stat_file(&app, &rel).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = &app;
        let _ = rel;
        Err("ios_stat_file is only available on iOS".into())
    }
}

// ---------------------------------------------------------------------------
// iOS-only implementation seam
// ---------------------------------------------------------------------------
//
// Backed by the `tauri-plugin-notesage-ios` crate, whose Swift Package Tauri
// wires into the generated Xcode project via `.ios_path()` in its build.rs.
// That is what makes the `@_cdecl` entry point resolve at link time — the
// earlier arrangement (loose .swift added to the target by hand) compiled the
// Swift but left the Rust link with an undefined `init_plugin_*`.

#[cfg(target_os = "ios")]
mod ios_impl {
    use super::{DownloadState, FileEntry, FileStat, LibraryGrant};
    use tauri::AppHandle;
    use tauri_plugin_notesage_ios::NotesageIosExt;

    /// Map the plugin's richer types onto this module's, which are what the
    /// frontend already consumes.
    fn grant(g: tauri_plugin_notesage_ios::LibraryGrant) -> LibraryGrant {
        LibraryGrant { display_name: g.display_name, granted: g.granted }
    }

    pub async fn pick_library_folder(app: &AppHandle) -> Result<LibraryGrant, String> {
        app.notesage_ios().pick_library_folder().map(grant).map_err(|e| e.to_string())
    }

    pub async fn get_library_grant(app: &AppHandle) -> Result<LibraryGrant, String> {
        app.notesage_ios().get_library_grant().map(grant).map_err(|e| e.to_string())
    }

    pub async fn clear_library_grant(app: &AppHandle) -> Result<(), String> {
        app.notesage_ios().clear_library_grant().map_err(|e| e.to_string())
    }

    fn entries(v: Vec<tauri_plugin_notesage_ios::FileEntry>) -> Vec<FileEntry> {
        v.into_iter()
            .map(|e| FileEntry {
                name: e.name,
                path: e.path,
                is_directory: e.is_directory,
                children: None,
                hidden: e.hidden,
                modified: e.modified,
                child_count: e.child_count,
            })
            .collect()
    }

    pub async fn list_directory(app: &AppHandle, rel: &str) -> Result<Vec<FileEntry>, String> {
        app.notesage_ios().list_directory(rel).map(entries).map_err(|e| e.to_string())
    }

    pub async fn read_file(app: &AppHandle, rel: &str) -> Result<String, String> {
        app.notesage_ios().read_file(rel).map_err(|e| e.to_string())
    }

    pub async fn read_binary(app: &AppHandle, rel: &str) -> Result<String, String> {
        app.notesage_ios().read_binary(rel).map_err(|e| e.to_string())
    }

    pub async fn write_file(app: &AppHandle, rel: &str, content: &str) -> Result<(), String> {
        app.notesage_ios().write_file(rel, content).map_err(|e| e.to_string())
    }

    pub async fn create_file(app: &AppHandle, rel: &str, content: &str) -> Result<String, String> {
        app.notesage_ios().create_file(rel, content).map_err(|e| e.to_string())
    }

    pub async fn create_directory(app: &AppHandle, rel: &str) -> Result<String, String> {
        app.notesage_ios().create_directory(rel).map_err(|e| e.to_string())
    }

    pub async fn thumbnail(app: &AppHandle, rel: &str, max_pixel: f64) -> Result<String, String> {
        app.notesage_ios().thumbnail_file(rel, max_pixel).map_err(|e| e.to_string())
    }

    pub async fn quick_look(app: &AppHandle, rel: &str) -> Result<(), String> {
        app.notesage_ios().quick_look(rel).map_err(|e| e.to_string())
    }

    pub async fn delete_file(app: &AppHandle, rel: &str) -> Result<(), String> {
        app.notesage_ios().delete_file(rel).map_err(|e| e.to_string())
    }

    pub async fn rename_file(app: &AppHandle, rel: &str, new_name: &str) -> Result<String, String> {
        app.notesage_ios().rename_file(rel, new_name).map_err(|e| e.to_string())
    }

    pub async fn ensure_directory(app: &AppHandle, rel: &str) -> Result<(), String> {
        app.notesage_ios().ensure_directory(rel).map_err(|e| e.to_string())
    }

    pub async fn entry_menu(
        app: &AppHandle,
        spec: serde_json::Value,
    ) -> Result<Option<String>, String> {
        app.notesage_ios().entry_menu(spec).map_err(|e| e.to_string())
    }

    pub async fn context_menu(
        app: &AppHandle,
        title: Option<String>,
        items: Vec<super::ContextMenuItemInput>,
        x: Option<f64>,
        y: Option<f64>,
    ) -> Result<Option<String>, String> {
        let items = items
            .into_iter()
            .map(|item| tauri_plugin_notesage_ios::ContextMenuItem {
                id: item.id,
                title: item.title,
                destructive: item.destructive,
            })
            .collect();
        app.notesage_ios()
            .context_menu(tauri_plugin_notesage_ios::ContextMenuArgs { title, items, x, y })
            .map_err(|e| e.to_string())
    }

    pub async fn content_ready(app: &AppHandle) -> Result<(), String> {
        app.notesage_ios().content_ready().map_err(|e| e.to_string())
    }

    pub async fn text_prompt(
        app: &AppHandle,
        title: &str,
        placeholder: &str,
        confirm_label: &str,
        value: Option<&str>,
        select_stem: bool,
    ) -> Result<Option<String>, String> {
        app.notesage_ios()
            .text_prompt(title, placeholder, confirm_label, value, select_stem)
            .map_err(|e| e.to_string())
    }

    pub async fn set_chrome(app: &AppHandle, spec: serde_json::Value) -> Result<(), String> {
        app.notesage_ios().set_chrome(spec).map_err(|e| e.to_string())
    }

    pub async fn share_file(app: &AppHandle, rel: &str) -> Result<(), String> {
        app.notesage_ios().share_file(rel).map_err(|e| e.to_string())
    }

    pub async fn ensure_downloaded(app: &AppHandle, rel: &str) -> Result<DownloadState, String> {
        app.notesage_ios()
            .ensure_downloaded(rel)
            .map(|s| match s {
                tauri_plugin_notesage_ios::DownloadState::Ready => DownloadState::Ready,
                tauri_plugin_notesage_ios::DownloadState::Downloading => DownloadState::Downloading,
                tauri_plugin_notesage_ios::DownloadState::Failed => DownloadState::Failed,
            })
            .map_err(|e| e.to_string())
    }

    pub async fn stat_file(app: &AppHandle, rel: &str) -> Result<FileStat, String> {
        app.notesage_ios()
            .stat_file(rel)
            .map(|size_bytes| FileStat { size_bytes })
            .map_err(|e| e.to_string())
    }
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
    fn every_read_command_path_goes_through_the_sanitizer() {
        // The guard only holds if it is actually on every path. This asserts
        // the source shape rather than behaviour because the commands
        // themselves are `#[cfg(target_os = "ios")]` seams that error off-iOS,
        // so a missing call could not otherwise be caught on a desktop build.
        let src = include_str!("ios_library.rs");
        for cmd in [
            "ios_list_directory",
            "ios_read_file",
            "ios_read_binary",
            "ios_share_file",
            "ios_ensure_downloaded",
            "ios_write_file",
            "ios_create_file",
            "ios_create_directory",
            "ios_rename_file",
            "ios_delete_file",
            "ios_stat_file",
        ] {
            let body_start = src
                .find(&format!("pub async fn {cmd}("))
                .unwrap_or_else(|| panic!("{cmd} not found"));
            let body = &src[body_start..body_start + 400];
            assert!(
                body.contains("sanitize_rel_path"),
                "{cmd} does not sanitize its path — it can escape the granted library root"
            );
        }
    }

    #[test]
    fn write_commands_refuse_the_empty_root_path() {
        // `sanitize_rel_path("")` is Ok("") — correct for reads (list the
        // root) but a write aimed at "" would target the library root itself.
        // Same source-shape idiom as the sanitizer test above, for the same
        // reason: the command bodies are iOS-only seams.
        let src = include_str!("ios_library.rs");
        for cmd in ["ios_write_file", "ios_create_file", "ios_create_directory", "ios_rename_file", "ios_delete_file"] {
            let body_start = src
                .find(&format!("pub async fn {cmd}("))
                .unwrap_or_else(|| panic!("{cmd} not found"));
            let body = &src[body_start..body_start + 500];
            assert!(
                body.contains("rel.is_empty()"),
                "{cmd} does not guard against the empty (library-root) path"
            );
        }
    }

    #[test]
    fn file_name_validator_rejects_traversal_and_hidden_names() {
        assert!(sanitize_file_name("").is_err());
        assert!(sanitize_file_name("   ").is_err());
        assert!(sanitize_file_name("a/b").is_err());
        assert!(sanitize_file_name("..").is_err());
        assert!(sanitize_file_name(".").is_err());
        assert!(sanitize_file_name(".hidden.md").is_err());
        assert_eq!(sanitize_file_name("  Note.md  ").unwrap(), "Note.md");
        assert_eq!(sanitize_file_name("Meeting notes.md").unwrap(), "Meeting notes.md");
    }

    #[test]
    fn webcontent_process_crash_recovery_is_installed_on_the_webview() {
        // #587: iOS kills the WebContent process under memory pressure; with
        // no `webViewWebContentProcessDidTerminate` handler the app stays a
        // permanently blank screen that Apple's crash reporting never sees.
        // Same source-shape idiom as the sanitizer tests — no XCTest harness
        // exists in this repo (#590).
        let swift_src = include_str!(
            "../../crates/tauri-plugin-notesage-ios/ios/Sources/NotesageIosPlugin.swift"
        );
        assert!(
            swift_src.contains("webViewWebContentProcessDidTerminate"),
            "the content-process terminate handler is gone — a WebContent \
             kill leaves a permanently blank app"
        );
        assert!(
            swift_src.contains("ContentProcessRecovery.install(on: webView)"),
            "ContentProcessRecovery exists but is never installed on the webview"
        );
    }

    #[test]
    fn share_extension_ui_strings_are_localized() {
        // #653: every user-facing string in the Share Extension must go
        // through NSLocalizedString (the `L(...)` helper) and have a Swedish
        // translation — a hardcoded literal ships an English word into a
        // Swedish share sheet. Source-shape assertion for the same reason as
        // the sanitizer tests: no XCTest harness exists in this repo (#590).
        let swift = include_str!("../../ios/ShareViewController.swift");
        for key in [
            "share.save",
            "share.format",
            "share.savesToInbox",
            "share.nothingToSave",
            "share.oneFile",
        ] {
            assert!(
                swift.contains(&format!("L(\"{key}\"")),
                "{key} is not used in ShareViewController — a UI string may have been hardcoded"
            );
        }
        let en = include_str!("../../ios/ShareResources/en.lproj/Localizable.strings");
        let sv = include_str!("../../ios/ShareResources/sv.lproj/Localizable.strings");
        let keys_of = |table: &str| -> Vec<String> {
            table
                .lines()
                .filter_map(|line| line.trim().strip_prefix('"'))
                .filter_map(|rest| rest.split('"').next().map(str::to_string))
                .collect()
        };
        let (en_keys, sv_keys) = (keys_of(en), keys_of(sv));
        assert!(!en_keys.is_empty(), "the English strings table failed to parse");
        for key in &en_keys {
            assert!(
                sv_keys.contains(key),
                "{key} has no Swedish translation — it would silently ship in English"
            );
        }
    }

    #[test]
    fn ensure_downloaded_swift_wires_up_the_failed_download_state() {
        // `LibraryAccess.ensureDownloaded` (Swift) can only ever return
        // `.ready`/`.downloading` or throw unless it explicitly reads the
        // iCloud download-error resource key — `DownloadState::Failed` is a
        // real wire value (see the match arms in ios_impl::ensure_downloaded
        // above and tauri_plugin_notesage_ios::DownloadState) that was never
        // actually produced. No XCTest harness exists anywhere in this repo
        // (confirmed by search, issue #590), so this locks the fix at the
        // source level — the same idiom
        // `every_read_command_path_goes_through_the_sanitizer` above already
        // uses for this file's own off-platform (iOS-only) code paths.
        let swift_src = include_str!(
            "../../crates/tauri-plugin-notesage-ios/ios/Sources/LibraryAccess.swift"
        );
        let body_start = swift_src
            .find("static func ensureDownloaded(")
            .expect("ensureDownloaded not found in LibraryAccess.swift");
        let body = &swift_src[body_start..(body_start + 1200).min(swift_src.len())];
        assert!(
            body.contains("ubiquitousItemDownloadingErrorKey") && body.contains(".failed"),
            "ensureDownloaded does not read the iCloud download-error resource key — \
             DownloadState::Failed can never be produced"
        );
    }

    #[test]
    fn stat_file_swift_reads_the_file_size_key() {
        // Locks the fix for issue #616 at the source level (same idiom as
        // `ensure_downloaded_swift_wires_up_the_failed_download_state` — no
        // XCTest harness exists in this repo). If `statFile` stopped reading
        // `.fileSizeKey`, the mobile reader's size guard would silently see
        // `nil`/an error on every call and fail open on every file,
        // regressing straight back to the hang this issue reports.
        let swift_src = include_str!(
            "../../crates/tauri-plugin-notesage-ios/ios/Sources/LibraryAccess.swift"
        );
        let body_start = swift_src
            .find("static func statFile(")
            .expect("statFile not found in LibraryAccess.swift");
        let body = &swift_src[body_start..(body_start + 600).min(swift_src.len())];
        assert!(
            body.contains(".fileSizeKey") && body.contains("fileSize"),
            "statFile does not read the file size resource key"
        );
    }

    #[test]
    fn stat_file_plugin_dispatch_is_wired_up() {
        // Pins the Swift plugin's method name to what the Rust bridge calls
        // (`NotesageIos::stat_file` invokes `"statFile"`) and the response key
        // (`sizeBytes`, decoded by `SizeResponse` in the plugin crate) — a
        // rename on either side would fail silently at runtime with no
        // XCTest harness to catch it.
        let plugin_src = include_str!(
            "../../crates/tauri-plugin-notesage-ios/ios/Sources/NotesageIosPlugin.swift"
        );
        let body_start = plugin_src
            .find("func statFile(")
            .expect("statFile dispatcher not found in NotesageIosPlugin.swift");
        let body = &plugin_src[body_start..(body_start + 300).min(plugin_src.len())];
        assert!(
            body.contains("LibraryAccess.statFile") && body.contains("\"sizeBytes\""),
            "statFile dispatcher does not call LibraryAccess.statFile or resolve a sizeBytes key"
        );
    }
}
