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
struct TextPromptArgs<'a> {
    title: &'a str,
    placeholder: &'a str,
    confirm_label: &'a str,
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

    /// Rename a file within its directory (single-segment new name, deduped
    /// on collision). Returns the relative path actually produced.
    pub fn rename_file(&self, rel: &str, new_name: &str) -> Result<String> {
        self.call::<_, PathResponse>("renameFile", RenameArgs { rel_path: rel, new_name })
            .map(|r| r.rel_path)
    }

    /// Present a native single-line text prompt (UIAlertController). Returns
    /// `None` when the user cancels.
    pub fn text_prompt(
        &self,
        title: &str,
        placeholder: &str,
        confirm_label: &str,
    ) -> Result<Option<String>> {
        self.call::<_, TextPromptResponse>(
            "textPrompt",
            TextPromptArgs { title, placeholder, confirm_label },
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
    pub fn rename_file(&self, _rel: &str, _new_name: &str) -> Result<String> {
        Err(Error::Unavailable)
    }
    pub fn text_prompt(&self, _t: &str, _p: &str, _c: &str) -> Result<Option<String>> {
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
    pub fn share_file(&self, _rel: &str) -> Result<()> {
        Err(Error::Unavailable)
    }
    pub fn ensure_downloaded(&self, _rel: &str) -> Result<DownloadState> {
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
