//! iOS-only Tauri plugin backing the mobile reader's library access.
//!
//! **Why a plugin crate rather than app-level Swift.** Tauri resolves a Swift
//! `@_cdecl` entry point only for code it knows about through `.ios_path()` in
//! build.rs. Adding `.swift` files to the generated Xcode target by hand
//! compiles them, but the Rust half links independently and fails with an
//! undefined `init_plugin_*` that never mentions Swift. This is the supported
//! shape, and it removes every manual Xcode step.
//!
//! Write surface (#586): deliberately three methods — overwrite a text file,
//! create a text file, create a folder — all confined to the granted library
//! root by the caller's sanitizer. No delete, no rename, no binary writes.
//! Link/article capture stays in the Share Extension's own process; this
//! surface exists solely for in-app note creation and editing.
//!
//! Path safety lives in the caller (`ios_library::sanitize_rel_path`), which
//! rejects absolute paths and `..` before anything reaches Swift.

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_notesage_ios);

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    PluginInvoke(String),
    #[error("the iOS library bridge is not available on this platform")]
    Unavailable,
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// Mirrors `FileEntry` in the app crate. Redeclared rather than shared to keep
/// this crate dependency-free of the app — the wire shape is what matters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    #[serde(default)]
    pub children: Option<Vec<FileEntry>>,
    #[serde(default)]
    pub hidden: bool,
    /// Files-app-style row metadata (mobile listings only; absent on desktop).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified: Option<f64>,
    /// Visible children, for DIRECTORIES only — counted natively in the same
    /// pass so a folder row can show a count without an IPC call per row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub child_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryGrant {
    pub display_name: String,
    pub granted: bool,
}

// Response envelopes — these mirror the dictionaries NotesageIosPlugin.swift
// passes to `invoke.resolve(...)`.
#[derive(Deserialize)]
struct EntriesResponse {
    entries: Vec<FileEntry>,
}
#[derive(Deserialize)]
struct TextResponse {
    text: String,
}
#[derive(Deserialize)]
struct Base64Response {
    base64: String,
}
#[derive(Deserialize)]
struct StateResponse {
    state: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SizeResponse {
    size_bytes: u64,
}
/// Whether WebKit's find bar actually opened — false when no report is on
/// screen, which the caller uses to fall back to the web search island.
#[derive(Deserialize)]
struct PresentedResponse {
    presented: bool,
}

/// Whether a message reached the agent inside the presented report.
#[derive(Deserialize)]
struct DeliveredResponse {
    delivered: bool,
}

/// Where the speech player currently is. Public because it crosses back to
/// the app crate as a command return — the frontend restores its progress bar
/// and resume position from it after a reload.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechState {
    /// Paragraph index currently being spoken.
    pub index: u32,
    /// Total paragraphs in the article as the native side split it.
    pub total: u32,
    pub playing: bool,
}

/// Notification and background-refresh state as the native side reports it.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationStatus {
    /// "notDetermined" | "denied" | "authorized"
    pub authorization: String,
    /// "available" | "denied" | "restricted"
    pub background_refresh: String,
    pub badge: bool,
    pub new_items: bool,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
struct UnreadCount {
    count: u32,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
struct LaunchRoute {
    route: Option<String>,
}

/// What `speech_start` decided: the language it will read the article in, so
/// the frontend's voice picker knows which voices to list.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechStarted {
    pub language: Option<String>,
}

/// One installed voice, as the picker shows it.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechVoice {
    pub id: String,
    pub name: String,
    /// BCP-47, e.g. "en-US".
    pub language: String,
    /// "premium" | "enhanced" | "default".
    pub quality: String,
}

#[derive(serde::Deserialize)]
struct SpeechVoicesResponse {
    voices: Vec<SpeechVoice>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RelPathArgs<'a> {
    rel_path: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WriteFileArgs<'a> {
    rel_path: &'a str,
    text: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathResponse {
    rel_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenameArgs<'a> {
    rel_path: &'a str,
    new_name: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveArgs<'a> {
    rel_path: &'a str,
    /// Destination DIRECTORY relative to the library root; `""` is the root.
    dest_dir: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailArgs<'a> {
    rel_path: &'a str,
    max_pixel: f64,
}

/// Images to fetch for `inline_images`, plus the budgets that bound the job.
///
/// The URLs come from `notesage_capture::article_image_urls`, so they arrive
/// in document order — which the native side preserves, because a partial
/// result should keep the lead image rather than an arbitrary subset.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InlineImagesArgs<'a> {
    urls: &'a [String],
    max_pixel: u32,
    jpeg_quality: f64,
}

/// url -> `data:` URI for the images that fit inside every budget. Images
/// that did not are simply absent, and keep their remote URL in the document.
#[derive(Deserialize)]
struct InlineImagesResponse {
    images: Vec<InlinedImage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InlinedImage {
    url: String,
    data_uri: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextPromptArgs<'a> {
    title: &'a str,
    placeholder: &'a str,
    confirm_label: &'a str,
    /// Localized by the frontend, which owns the translation table (#705) —
    /// this static plugin library carries no strings bundle of its own.
    cancel_label: Option<&'a str>,
    value: Option<&'a str>,
    select_stem: bool,
}

/// One row of the native action sheet (#680).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContextMenuItem {
    pub id: String,
    pub title: String,
    /// Rendered in red and sunk below the plain rows, per iOS convention.
    #[serde(default)]
    pub destructive: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuArgs {
    #[serde(default)]
    pub title: Option<String>,
    pub items: Vec<ContextMenuItem>,
    /// Long-press point in webview coordinates — anchors the iPad popover.
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    /// Localized by the frontend (#705); `None` falls back to English.
    #[serde(default)]
    pub cancel_label: Option<String>,
}

/// `id` is absent when the user cancelled the sheet.
#[derive(Deserialize, Default)]
struct ContextMenuResult {
    #[serde(default)]
    id: Option<String>,
}

/// `text` is absent when the user cancelled the prompt.
#[derive(Deserialize, Default)]
struct TextPromptResponse {
    #[serde(default)]
    text: Option<String>,
}

/// iCloud download state for a file that may be a not-yet-downloaded placeholder.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadState {
    Ready,
    Downloading,
    Failed,
}

/// Holds the Swift plugin handle on iOS. Off-iOS it holds an `AppHandle`
/// rather than `PhantomData<R>` — same shape Tauri's own plugins use, and it
/// keeps the type `Send + Sync` (which managed state requires) without adding
/// bounds to every caller.
pub struct NotesageIos<R: Runtime>(
    #[cfg(target_os = "ios")] tauri::plugin::PluginHandle<R>,
    #[cfg(not(target_os = "ios"))] tauri::AppHandle<R>,
);

#[cfg(target_os = "ios")]
impl<R: Runtime> NotesageIos<R> {
    fn call<A: Serialize, T: serde::de::DeserializeOwned>(&self, m: &str, args: A) -> Result<T> {
        self.0
            .run_mobile_plugin::<T>(m, args)
            .map_err(|e| Error::PluginInvoke(e.to_string()))
    }

    pub fn pick_library_folder(&self) -> Result<LibraryGrant> {
        self.call("pickLibraryFolder", ())
    }

    pub fn get_library_grant(&self) -> Result<LibraryGrant> {
        // Never fatal: "no grant yet" is the first-run state, and an error here
        // would block onboarding rather than show it.
        Ok(self.call("getLibraryGrant", ()).unwrap_or(LibraryGrant {
            display_name: String::new(),
            granted: false,
        }))
    }

    pub fn clear_library_grant(&self) -> Result<()> {
        self.call("clearLibraryGrant", ())
    }

    pub fn list_directory(&self, rel: &str) -> Result<Vec<FileEntry>> {
        self.call::<_, EntriesResponse>("listDirectory", RelPathArgs { rel_path: rel })
            .map(|r| r.entries)
    }

    pub fn read_file(&self, rel: &str) -> Result<String> {
        self.call::<_, TextResponse>("readFile", RelPathArgs { rel_path: rel })
            .map(|r| r.text)
    }

    /// Returns the file's contents as a base64 string. Deliberately NOT
    /// `Vec<u8>`: bytes crossing the Swift→Rust→JS JSON hops as a number
    /// array cost ~4 bytes of JSON per payload byte and freeze the WebView
    /// main thread parsing it. The frontend decodes base64 natively.
    pub fn read_binary(&self, rel: &str) -> Result<String> {
        self.call::<_, Base64Response>("readBinary", RelPathArgs { rel_path: rel })
            .map(|r| r.base64)
    }

    /// Overwrite (or create) a UTF-8 file — the editor's save path. Atomic
    /// coordinated `.forReplacing` write on the Swift side.
    pub fn write_file(&self, rel: &str, text: &str) -> Result<()> {
        self.call("writeFile", WriteFileArgs { rel_path: rel, text })
    }

    /// Create a new UTF-8 file; the name is deduped (`note.md` → `note-1.md`)
    /// rather than overwritten. Returns the relative path actually created.
    pub fn create_file(&self, rel: &str, text: &str) -> Result<String> {
        self.call::<_, PathResponse>("createFile", WriteFileArgs { rel_path: rel, text })
            .map(|r| r.rel_path)
    }

    /// Create a new folder; the name is deduped. Returns the relative path
    /// actually created.
    pub fn create_directory(&self, rel: &str) -> Result<String> {
        self.call::<_, PathResponse>("createDirectory", RelPathArgs { rel_path: rel })
            .map(|r| r.rel_path)
    }

    /// System-generated thumbnail PNG (QLThumbnailGenerator) as base64 —
    /// PDFs, images, videos, office docs, rendered off the webview thread.
    pub fn thumbnail_file(&self, rel: &str, max_pixel: f64) -> Result<String> {
        self.call::<_, Base64Response>("thumbnailFile", ThumbnailArgs { rel_path: rel, max_pixel })
            .map(|r| r.base64)
    }

    /// Fetch, downsample and base64-encode article images natively.
    ///
    /// Returns only the images that fit inside the native side's budgets;
    /// anything skipped keeps its remote URL when the document is rewritten,
    /// so a partial result is still a working article.
    ///
    /// The bytes stop here — they go straight into the rewritten HTML on the
    /// Rust side and never reach the WebView, which is the property that keeps
    /// a sweep from janking the UI.
    pub fn inline_images(
        &self,
        urls: &[String],
        max_pixel: u32,
        jpeg_quality: f64,
    ) -> Result<Vec<(String, String)>> {
        self.call::<_, InlineImagesResponse>(
            "inlineImages",
            InlineImagesArgs { urls, max_pixel, jpeg_quality },
        )
        .map(|r| r.images.into_iter().map(|i| (i.url, i.data_uri)).collect())
    }

    /// Present the system QuickLook preview over a temp copy of a library
    /// file (native video/audio playback, DOCX/PPTX/EPUB rendering, …).
    pub fn quick_look(&self, rel: &str) -> Result<()> {
        self.call("quickLook", RelPathArgs { rel_path: rel })
    }

    /// Delete a FILE (never a directory) — coordinated `.forDeleting`.
    pub fn delete_file(&self, rel: &str) -> Result<()> {
        self.call("deleteFile", RelPathArgs { rel_path: rel })
    }

    /// Rename a file within its directory (single-segment new name, deduped
    /// on collision). Returns the relative path actually produced.
    pub fn rename_file(&self, rel: &str, new_name: &str) -> Result<String> {
        self.call::<_, PathResponse>("renameFile", RenameArgs { rel_path: rel, new_name })
            .map(|r| r.rel_path)
    }

    /// Move a FILE into another directory under the library root (#754).
    /// Files only; the destination must already exist. Deduped on collision.
    /// Returns the relative path actually produced.
    pub fn move_file(&self, rel: &str, dest_dir: &str) -> Result<String> {
        self.call::<_, PathResponse>("moveFile", MoveArgs { rel_path: rel, dest_dir })
            .map(|r| r.rel_path)
    }

    /// Create a directory at an exact relative path if absent (no dedupe).
    pub fn ensure_directory(&self, rel: &str) -> Result<()> {
        self.call("ensureDirectory", RelPathArgs { rel_path: rel })
    }

    /// Present the long-press preview + action menu. `spec` is the JSON
    /// `EntryMenuSpec` shape EntryContextMenu.swift decodes.
    pub fn entry_menu(&self, spec: serde_json::Value) -> Result<Option<String>> {
        self.call::<_, ContextMenuResult>("entryMenu", spec).map(|r| r.id)
    }

    /// Present a native action sheet for a long-pressed item. Returns the
    /// chosen item id, or `None` when the user cancels.
    pub fn context_menu(&self, payload: ContextMenuArgs) -> Result<Option<String>> {
        self.call::<_, ContextMenuResult>("contextMenu", payload).map(|r| r.id)
    }

    /// Tell the native layer the webview has painted, so it can drop the
    /// launch cover held over it (#675).
    pub fn content_ready(&self) -> Result<()> {
        self.call("contentReady", ())
    }

    /// Present a native single-line text prompt (UIAlertController). Returns
    /// `None` when the user cancels.
    pub fn text_prompt(
        &self,
        title: &str,
        placeholder: &str,
        confirm_label: &str,
        cancel_label: Option<&str>,
        value: Option<&str>,
        select_stem: bool,
    ) -> Result<Option<String>> {
        self.call::<_, TextPromptResponse>(
            "textPrompt",
            TextPromptArgs { title, placeholder, confirm_label, cancel_label, value, select_stem },
        )
        .map(|r| r.text)
    }

    /// Declare the native chrome overlay (real Liquid Glass buttons hosted
    /// over the webview). `spec` is the JSON `{ topLeft?, topRight? }` shape
    /// ChromeOverlay.swift decodes; taps come back as `notesage:chrome`
    /// CustomEvents in the page.
    pub fn set_chrome(&self, spec: serde_json::Value) -> Result<()> {
        self.call("setChrome", spec)
    }

    /// Show an exported HTML report in its own bridge-less WKWebView, instead
    /// of the sandboxed `htmlpreview://` iframe (#606, ADR 0010).
    pub fn present_report(&self, html: &str, inset_top: f64, inset_bottom: f64) -> Result<()> {
        self.call(
            "presentReport",
            serde_json::json!({
                "html": html,
                "insetTop": inset_top,
                "insetBottom": inset_bottom,
            }),
        )
    }

    /// Start (or restart) reading an article aloud (#833).
    ///
    /// `start_index` is a PARAGRAPH index, not a character offset — that is
    /// what makes a resume position survive the app being killed. The native
    /// side clamps it, so a stored position from a since-edited article is
    /// safe to pass verbatim.
    pub fn speech_start(
        &self, text: &str, title: &str, start_index: u32, rate: f32,
        voice_by_language: &std::collections::HashMap<String, String>,
        artwork_base64: Option<&str>,
    ) -> Result<SpeechStarted> {
        self.call(
            "speechStart",
            serde_json::json!({
                "text": text,
                "title": title,
                "startIndex": start_index,
                "rate": rate,
                "voiceByLanguage": voice_by_language,
                "artworkBase64": artwork_base64,
            }),
        )
    }

    /// Installed voices for a language subtag ("en"), best first.
    pub fn speech_voices(&self, language: &str) -> Result<Vec<SpeechVoice>> {
        let r: SpeechVoicesResponse =
            self.call("speechVoices", serde_json::json!({ "language": language }))?;
        Ok(r.voices)
    }

    /// Switch voice mid-article; the current paragraph is re-spoken.
    pub fn speech_set_voice(&self, voice_id: &str) -> Result<()> {
        self.call("speechSetVoice", serde_json::json!({ "voiceId": voice_id }))
    }

    pub fn speech_pause(&self) -> Result<()> {
        self.call("speechPause", ())
    }

    pub fn speech_resume(&self) -> Result<()> {
        self.call("speechResume", ())
    }

    pub fn speech_stop(&self) -> Result<()> {
        self.call("speechStop", ())
    }

    pub fn speech_skip(&self, delta: i32) -> Result<()> {
        self.call("speechSkip", serde_json::json!({ "delta": delta }))
    }

    pub fn speech_set_rate(&self, rate: f32) -> Result<()> {
        self.call("speechSetRate", serde_json::json!({ "rate": rate }))
    }

    pub fn speech_state(&self) -> Result<SpeechState> {
        self.call("speechState", ())
    }

    pub fn notification_status(&self) -> Result<NotificationStatus> {
        self.call("notificationStatus", ())
    }

    pub fn notification_request(&self) -> Result<NotificationStatus> {
        self.call("notificationRequest", ())
    }

    pub fn notification_set_prefs(
        &self,
        badge: Option<bool>,
        new_items: Option<bool>,
        templates: Option<&std::collections::HashMap<String, String>>,
    ) -> Result<NotificationStatus> {
        self.call(
            "notificationSetPrefs",
            serde_json::json!({ "badge": badge, "newItems": new_items, "templates": templates }),
        )
    }

    pub fn inbox_unread_count(&self) -> Result<u32> {
        self.call::<_, UnreadCount>("inboxUnreadCount", ()).map(|c| c.count)
    }

    pub fn consume_launch_route(&self) -> Result<Option<String>> {
        self.call::<_, LaunchRoute>("consumeLaunchRoute", ()).map(|r| r.route)
    }

    pub fn open_settings(&self) -> Result<()> {
        self.call("openSettings", ())
    }

    pub fn dismiss_report(&self) -> Result<()> {
        self.call("dismissReport", ())
    }

    /// Open WebKit's find bar over the presented report. `false` means no
    /// report is on screen — fall back to the web search island.
    /// Hand a JSON message to the read-aloud agent inside the presented
    /// report (#833 highlight). `false` when no report is on screen.
    pub fn post_to_report(&self, message: &str) -> Result<bool> {
        let r: DeliveredResponse =
            self.call("postToReport", serde_json::json!({ "message": message }))?;
        Ok(r.delivered)
    }

    pub fn find_in_report(&self) -> Result<bool> {
        let r: PresentedResponse = self.call("findInReport", ())?;
        Ok(r.presented)
    }

    /// Present the iOS share sheet for a library file (copied to temp first —
    /// share targets can't read through the security-scoped grant).
    pub fn share_file(&self, rel: &str) -> Result<()> {
        self.call("shareFile", RelPathArgs { rel_path: rel })
    }

    pub fn ensure_downloaded(&self, rel: &str) -> Result<DownloadState> {
        let r: StateResponse = self.call("ensureDownloaded", RelPathArgs { rel_path: rel })?;
        Ok(match r.state.as_str() {
            "ready" => DownloadState::Ready,
            "downloading" => DownloadState::Downloading,
            // Unknown → failure, never silently "ready": a caller that believes
            // a placeholder is local will read an empty file.
            _ => DownloadState::Failed,
        })
    }

    /// Return the file's on-disk size in bytes without reading its content —
    /// a cheap metadata probe (issue #616: a full read of a multi-hundred-MB
    /// text file blocked the WebView's main thread).
    pub fn stat_file(&self, rel: &str) -> Result<u64> {
        self.call::<_, SizeResponse>("statFile", RelPathArgs { rel_path: rel })
            .map(|r| r.size_bytes)
    }
}

#[cfg(not(target_os = "ios"))]
impl<R: Runtime> NotesageIos<R> {
    pub fn pick_library_folder(&self) -> Result<LibraryGrant> {
        Err(Error::Unavailable)
    }
    pub fn get_library_grant(&self) -> Result<LibraryGrant> {
        Ok(LibraryGrant { display_name: String::new(), granted: false })
    }
    pub fn clear_library_grant(&self) -> Result<()> {
        Ok(())
    }
    pub fn list_directory(&self, _rel: &str) -> Result<Vec<FileEntry>> {
        Err(Error::Unavailable)
    }
    pub fn read_file(&self, _rel: &str) -> Result<String> {
        Err(Error::Unavailable)
    }
    pub fn read_binary(&self, _rel: &str) -> Result<String> {
        Err(Error::Unavailable)
    }
    pub fn write_file(&self, _rel: &str, _text: &str) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn thumbnail_file(&self, _rel: &str, _max_pixel: f64) -> Result<String> {
        Err(Error::Unavailable)
    }
    pub fn inline_images(
        &self,
        _urls: &[String],
        _max_pixel: u32,
        _jpeg_quality: f64,
    ) -> Result<Vec<(String, String)>> {
        Err(Error::Unavailable)
    }
    pub fn quick_look(&self, _rel: &str) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn delete_file(&self, _rel: &str) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn rename_file(&self, _rel: &str, _new_name: &str) -> Result<String> {
        Err(Error::Unavailable)
    }
    pub fn move_file(&self, _rel: &str, _dest_dir: &str) -> Result<String> {
        Err(Error::Unavailable)
    }
    pub fn content_ready(&self) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn context_menu(&self, _p: ContextMenuArgs) -> Result<Option<String>> {
        Err(Error::Unavailable)
    }
    pub fn ensure_directory(&self, _rel: &str) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn entry_menu(&self, _spec: serde_json::Value) -> Result<Option<String>> {
        Err(Error::Unavailable)
    }
    pub fn text_prompt(
        &self,
        _t: &str,
        _p: &str,
        _c: &str,
        _v: Option<&str>,
        _s: bool,
    ) -> Result<Option<String>> {
        Err(Error::Unavailable)
    }
    pub fn create_file(&self, _rel: &str, _text: &str) -> Result<String> {
        Err(Error::Unavailable)
    }
    pub fn create_directory(&self, _rel: &str) -> Result<String> {
        Err(Error::Unavailable)
    }
    pub fn set_chrome(&self, _spec: serde_json::Value) -> Result<()> {
        Err(Error::Unavailable)
    }
    /// `Unavailable` is load-bearing, not a placeholder: it is the signal the
    /// reader falls back to the `htmlpreview://` iframe on. Desktop dev and the
    /// vitest suite take that path, which is what keeps ADR 0010's fallback a
    /// real code path rather than a claim.
    pub fn present_report(&self, _html: &str, _top: f64, _bottom: f64) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn speech_start(
        &self, _text: &str, _title: &str, _start: u32, _rate: f32,
        _voices: &std::collections::HashMap<String, String>, _artwork: Option<&str>,
    ) -> Result<SpeechStarted> {
        Err(Error::Unavailable)
    }
    pub fn speech_voices(&self, _language: &str) -> Result<Vec<SpeechVoice>> {
        Err(Error::Unavailable)
    }
    pub fn speech_set_voice(&self, _voice_id: &str) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn speech_pause(&self) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn speech_resume(&self) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn speech_stop(&self) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn speech_skip(&self, _delta: i32) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn speech_set_rate(&self, _rate: f32) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn speech_state(&self) -> Result<SpeechState> {
        Err(Error::Unavailable)
    }
    pub fn notification_status(&self) -> Result<NotificationStatus> {
        Err(Error::Unavailable)
    }
    pub fn notification_request(&self) -> Result<NotificationStatus> {
        Err(Error::Unavailable)
    }
    pub fn notification_set_prefs(
        &self,
        _badge: Option<bool>,
        _new_items: Option<bool>,
        _templates: Option<&std::collections::HashMap<String, String>>,
    ) -> Result<NotificationStatus> {
        Err(Error::Unavailable)
    }
    pub fn inbox_unread_count(&self) -> Result<u32> {
        Err(Error::Unavailable)
    }
    pub fn consume_launch_route(&self) -> Result<Option<String>> {
        Err(Error::Unavailable)
    }
    pub fn open_settings(&self) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn dismiss_report(&self) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn find_in_report(&self) -> Result<bool> {
        Err(Error::Unavailable)
    }
    pub fn post_to_report(&self, _message: &str) -> Result<bool> {
        Err(Error::Unavailable)
    }
    pub fn share_file(&self, _rel: &str) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn ensure_downloaded(&self, _rel: &str) -> Result<DownloadState> {
        Err(Error::Unavailable)
    }
    pub fn stat_file(&self, _rel: &str) -> Result<u64> {
        Err(Error::Unavailable)
    }
}

/// Extension trait so the app crate can reach the bridge from an `AppHandle`.
pub trait NotesageIosExt<R: Runtime> {
    fn notesage_ios(&self) -> &NotesageIos<R>;
}

impl<R: Runtime, T: Manager<R>> NotesageIosExt<R> for T {
    fn notesage_ios(&self) -> &NotesageIos<R> {
        self.state::<NotesageIos<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("notesage-ios")
        .setup(|app, _api| {
            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_notesage_ios)?;
                app.manage(NotesageIos(handle));
            }
            #[cfg(not(target_os = "ios"))]
            {
                app.manage(NotesageIos(app.clone()));
            }
            Ok(())
        })
        .build()
}
