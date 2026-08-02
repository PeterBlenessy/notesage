//! iOS-only Tauri plugin backing the mobile reader's library access.
//!
//! **Why a plugin crate rather than app-level Swift.** Tauri resolves a Swift
//! `@_cdecl` entry point only for code it knows about via `.ios_path()` in
//! build.rs. Adding `.swift` files to the generated Xcode target by hand
//! compiles them, but the Rust half still links first and fails with an
//! undefined `init_plugin_*` that never mentions Swift. This shape is the
//! supported one, and it also removes every manual Xcode step.
//!
//! Currently a deliberate spike: one `ping` method, proving the full
//! React → Rust → Swift → back round-trip links and runs before the real
//! library-access surface is ported onto it.

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
    #[error("the iOS plugin is not available on this platform")]
    Unavailable,
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingRequest {
    pub value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResponse {
    pub value: String,
}

/// Handle to the Swift plugin, stored as managed state at setup.
/// Holds the Swift plugin handle on iOS. Off-iOS it holds an `AppHandle`
/// rather than `PhantomData<R>` — same shape Tauri's own plugins use, and it
/// keeps the type `Send + Sync` (which managed state requires) without adding
/// bounds to every caller.
pub struct NotesageIos<R: Runtime>(
    #[cfg(target_os = "ios")] tauri::plugin::PluginHandle<R>,
    #[cfg(not(target_os = "ios"))] tauri::AppHandle<R>,
);

impl<R: Runtime> NotesageIos<R> {
    pub fn ping(&self, value: impl Into<String>) -> Result<String> {
        #[cfg(target_os = "ios")]
        {
            self.0
                .run_mobile_plugin::<PingResponse>("ping", PingRequest { value: value.into() })
                .map(|r| r.value)
                .map_err(|e| Error::PluginInvoke(e.to_string()))
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = value.into();
            Err(Error::Unavailable)
        }
    }
}

/// Round-trip probe: React → Rust → Swift → back. Exists to prove the bridge,
/// not as a feature — the real surface replaces it once this is verified.
#[tauri::command]
async fn ping<R: Runtime>(app: tauri::AppHandle<R>, value: String) -> Result<String> {
    // `.inner()` — State derefs to &T, and the method lives on NotesageIos.
    app.state::<NotesageIos<R>>().inner().ping(value)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("notesage-ios")
        .invoke_handler(tauri::generate_handler![ping])
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
