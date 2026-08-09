//! In-memory document store + `htmlpreview://` URI scheme for the HTML viewer's
//! sandboxed iframe paths (allow-scripts / unsafe-preview).
//!
//! ## Why this exists
//!
//! The HTML viewer renders document HTML inside a `sandbox="allow-scripts"`
//! iframe (no `allow-same-origin`). It used to feed that iframe a `blob:` URL on
//! the assumption that a `blob:` document gets its own empty CSP. That assumption
//! is false: a `blob:` document INHERITS the Content-Security-Policy of the
//! context that created it. Once the app gained a hardened CSP (`#444`:
//! `frame-ancestors 'none'` + a nonce-rewritten `style-src` that drops
//! `'unsafe-inline'`), the blob-framed document was refused in production —
//! `frame-ancestors 'none'` blanked the frame and the nonce `style-src` refused
//! the document's own inline `<style>` blocks. The bug only hid in `tauri dev`,
//! where the Vite dev server serves the app document with no CSP header at all,
//! so the blob had nothing to inherit.
//!
//! A response served from a custom URI scheme carries its OWN (empty) policy —
//! we fully own the `http::Response` and deliberately attach no CSP header — so
//! the framed document renders correctly regardless of the app window's CSP. The
//! `sandbox="allow-scripts"` attribute (no `allow-same-origin`) is what keeps the
//! document isolated, not the (now removed) blob indirection.
//!
//! The frontend registers the HTML under a generated id before pointing the
//! iframe at `htmlpreview://localhost/<id>`, and unregisters it on unmount.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::http::{Request, Response};
use tauri::{Manager, Runtime, State, UriSchemeContext};

/// Documents served to the HTML-viewer iframe, keyed by a frontend-generated id.
#[derive(Default)]
pub struct HtmlPreviewState {
    docs: Mutex<HashMap<String, String>>,
}

impl HtmlPreviewState {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Store `content` under `id` so the `htmlpreview://localhost/<id>` handler can
/// serve it. The frontend generates the id (a UUID) and registers BEFORE setting
/// the iframe `src`, so the handler never races a missing entry.
#[tauri::command]
pub fn html_preview_register(
    state: State<'_, HtmlPreviewState>,
    id: String,
    content: String,
) -> Result<(), String> {
    state
        .docs
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, content);
    Ok(())
}

/// Drop a previously registered document. Called from the iframe-effect cleanup.
#[tauri::command]
pub fn html_preview_unregister(state: State<'_, HtmlPreviewState>, id: String) {
    if let Ok(mut docs) = state.docs.lock() {
        docs.remove(&id);
    }
}

/// URI scheme handler for `htmlpreview://localhost/<id>`.
///
/// Serves the registered HTML with `Content-Type: text/html` and NO
/// Content-Security-Policy header — the framed document must render under its own
/// empty policy. Returns 404 for an unknown id (e.g. the cleanup ran first).
pub fn handle_request<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let id = request.uri().path().trim_start_matches('/').to_string();

    let body = ctx
        .app_handle()
        .state::<HtmlPreviewState>()
        .docs
        .lock()
        .ok()
        .and_then(|docs| docs.get(&id).cloned());

    // SVG ids (`<uuid>.svg`) are served as images — the mobile reader
    // registers rendered mermaid diagrams here and points an <img> at them,
    // for the same reason the HTML viewer uses this scheme at all: content
    // needing its own (empty) CSP context. An <img> refuses a payload served
    // as text/html, so the mime must follow the id.
    let mime = if id.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "text/html; charset=utf-8"
    };

    match body {
        Some(html) => Response::builder()
            .status(200)
            .header("Content-Type", mime)
            .header("Cache-Control", "no-store")
            .body(html.into_bytes())
            .unwrap_or_else(|_| Response::builder().status(500).body(Vec::new()).unwrap()),
        None => Response::builder()
            .status(404)
            .body(Vec::new())
            .unwrap(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_then_lookup_roundtrips() {
        let state = HtmlPreviewState::new();
        state
            .docs
            .lock()
            .unwrap()
            .insert("abc".into(), "<h1>hi</h1>".into());
        assert_eq!(
            state.docs.lock().unwrap().get("abc").map(String::as_str),
            Some("<h1>hi</h1>")
        );
    }

    #[test]
    fn unregister_removes_entry() {
        let state = HtmlPreviewState::new();
        state.docs.lock().unwrap().insert("x".into(), "y".into());
        state.docs.lock().unwrap().remove("x");
        assert!(state.docs.lock().unwrap().get("x").is_none());
    }
}
