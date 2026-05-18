//! Alpha-channel update check via runtime-URL `UpdaterBuilder`.
//!
//! Tauri 2.10's `tauri-plugin-updater` `check()` JS API has no `url` field —
//! the only way to drive the updater against a non-config endpoint is the
//! Rust-side `UpdaterBuilder::endpoints(vec![url])`. This module exposes that
//! capability via a single Tauri command so the frontend can:
//!
//!   1. Call `invoke('alpha_check', { url: ALPHA_UPDATE_ENDPOINT })`
//!   2. Receive `Option<UpdateMetadata>` with `rid` referencing an Update
//!      stored in Tauri's `resources_table`
//!   3. Wrap it on the JS side: `new Update(metadata)`
//!   4. Call `.downloadAndInstall(...)` — that hits plugin-updater's stock
//!      `download` + `install` IPC handlers, which look up our rid and run
//!      the full signature-verified install + restart pipeline
//!
//! This is the supported, plugin-internal pattern (`check()` does exactly the
//! same thing minus the URL override). The pubkey from `tauri.conf.json` is
//! still used to verify signatures regardless of which endpoint produced the
//! manifest.

use serde::Serialize;
use tauri::{ResourceId, Runtime, Webview, Manager};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlphaUpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[tauri::command]
pub async fn alpha_check<R: Runtime>(
    webview: Webview<R>,
    url: String,
) -> Result<Option<AlphaUpdateMetadata>, String> {
    let parsed_url = Url::parse(&url).map_err(|e| format!("invalid alpha endpoint URL: {}", e))?;

    let updater = webview
        .updater_builder()
        .endpoints(vec![parsed_url])
        .map_err(|e| format!("updater endpoints config: {}", e))?
        // Default version comparator is fine — alpha → alpha is monotonically
        // ascending (alpha.3 → alpha.4 → ...). The leave-alpha downgrade path
        // is handled by the STABLE channel (which passes allowDowngrades via
        // the normal `check()` call), not this one.
        .build()
        .map_err(|e| format!("updater build: {}", e))?;

    match updater
        .check()
        .await
        .map_err(|e| format!("alpha update check failed: {}", e))?
    {
        Some(update) => {
            let formatted_date = if let Some(date) = update.date {
                date.format(&time::format_description::well_known::Rfc3339)
                    .ok()
            } else {
                None
            };
            let metadata = AlphaUpdateMetadata {
                current_version: update.current_version.clone(),
                version: update.version.clone(),
                date: formatted_date,
                body: update.body.clone(),
                raw_json: update.raw_json.clone(),
                // Insert the Update into Tauri's resource table. The returned
                // rid is what the JS-side `new Update(metadata)` constructor
                // stores; subsequent `update.downloadAndInstall(...)` calls
                // route back to the plugin's `download` / `install` IPC
                // handlers, which resolve the rid in this same resources_table.
                rid: webview.resources_table().add(update),
            };
            Ok(Some(metadata))
        }
        None => Ok(None),
    }
}
