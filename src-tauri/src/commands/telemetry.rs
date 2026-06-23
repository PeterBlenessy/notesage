//! Telemetry consent state + Sentry runtime live-disable.
//!
//! Two telemetry streams ship together (PRD `2026-06-07-telemetry.md`):
//!   - Usage analytics (Aptabase) — gated entirely at the JS `track()` call site.
//!   - Crash/error reporting (Sentry) — gated here: the Sentry client is built
//!     ONCE at startup (so the panic hook installs exactly once) and is bound /
//!     unbound on the global `Hub` at runtime so a consent toggle takes effect
//!     immediately, with no restart and no double panic-hook install.
//!
//! Consent is persisted to a small JSON file in the app config dir
//! (`~/.notesage/telemetry-consent.json`), mirroring the disk-file pattern in
//! `sync.rs`. The frontend owns the build-derived defaults (alpha build → on,
//! stable build → off) and writes the effective values via `telemetry_apply_consent`;
//! Rust defaults both to `false` when the file is absent, because the backend
//! cannot know the release channel on its own.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Persisted telemetry consent. Both default to `false` when the file is absent
/// (see module docs — the frontend writes build-derived effective values on
/// first run).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryConsent {
    pub usage: bool,
    pub crash: bool,
}

impl Default for TelemetryConsent {
    fn default() -> Self {
        Self {
            usage: false,
            crash: false,
        }
    }
}

/// Live handle to the Sentry client, kept alive for the whole process.
///
/// `bind_client(Some(_))` enables egress (and re-arms the panic hook's reporting
/// path); `bind_client(None)` stops egress immediately. The `Arc<sentry::Client>`
/// is retained here so disable→enable can re-bind the SAME client without
/// re-running `sentry::init` (which would install a second panic hook).
static SENTRY_CLIENT: Mutex<Option<std::sync::Arc<sentry::Client>>> = Mutex::new(None);

/// Resolve the consent file path: `~/.notesage/telemetry-consent.json`.
fn consent_file_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    Ok(home.join(".notesage").join("telemetry-consent.json"))
}

/// Read consent from a specific path. Returns `Default` (both `false`) when the
/// file is absent or unreadable — telemetry-off is always the safe fallback.
fn read_consent_from(path: &std::path::Path) -> TelemetryConsent {
    let Ok(content) = std::fs::read_to_string(path) else {
        return TelemetryConsent::default();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

/// Synchronous startup read of persisted consent. Defaults to both `false` when
/// the file is missing. Used by `lib.rs` to decide whether to bind the Sentry
/// client ON at startup. Never errors — a bad/absent file means telemetry off.
pub fn read_consent() -> TelemetryConsent {
    match consent_file_path() {
        Ok(path) => read_consent_from(&path),
        Err(_) => TelemetryConsent::default(),
    }
}

/// Write consent to a specific path, creating the parent dir if needed.
fn write_consent_to(path: &std::path::Path, consent: &TelemetryConsent) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {e}"))?;
        }
    }
    let content = serde_json::to_string_pretty(consent)
        .map_err(|e| format!("Failed to serialize telemetry consent: {e}"))?;
    std::fs::write(path, content)
        .map_err(|e| format!("Failed to write telemetry consent: {e}"))?;
    Ok(())
}

/// Store the process-wide Sentry client handle so runtime toggles can re-bind it.
/// Called once from `lib.rs` after `sentry::init`.
pub fn set_sentry_client(client: std::sync::Arc<sentry::Client>) {
    *SENTRY_CLIENT.lock() = Some(client);
}

/// The stored Sentry client, if one was built (DSN present). Used by `lib.rs` to
/// register `tauri-plugin-sentry` regardless of consent — the plugin must always
/// register (it routes frontend errors through Rust); consent only flips the
/// Hub binding via `set_sentry_enabled`. Reading from the stored client (not the
/// Hub) means a disabled-at-startup client is still available to the plugin.
pub fn sentry_client() -> Option<std::sync::Arc<sentry::Client>> {
    SENTRY_CLIENT.lock().clone()
}

/// Bind or unbind the stored Sentry client on the current Hub.
///
/// `enabled == true`  → `bind_client(Some(client))` — egress resumes.
/// `enabled == false` → `bind_client(None)` — egress stops immediately.
///
/// No-op when no client was ever built (DSN absent → telemetry off, never a
/// crash). The panic hook is installed once by `sentry::init`; this only flips
/// the binding, so it never double-installs.
pub fn set_sentry_enabled(enabled: bool) {
    let guard = SENTRY_CLIENT.lock();
    let Some(client) = guard.as_ref() else {
        return;
    };
    let hub = sentry::Hub::current();
    if enabled {
        hub.bind_client(Some(client.clone()));
    } else {
        hub.bind_client(None);
    }
}

/// Persist consent AND drive the Sentry live-enable/disable so the crash toggle
/// takes effect immediately (locked decision: no "applies on restart" shortcut).
/// Usage analytics needs no backend action — its gate is the JS `track()` helper.
#[tauri::command]
pub async fn telemetry_apply_consent(usage: bool, crash: bool) -> Result<(), String> {
    log::info!(
        target: "notesage::telemetry",
        "Applying telemetry consent: usage={usage} crash={crash}"
    );
    let consent = TelemetryConsent { usage, crash };
    let path = consent_file_path()?;
    write_consent_to(&path, &consent)?;
    set_sentry_enabled(crash);
    Ok(())
}

/// Redact absolute filesystem paths and email addresses from a free-text string.
/// Used on panic/exception messages, which routinely embed `/Users/<name>/…`
/// paths, project/file names, or URLs. Crash events are rare, so compiling the
/// patterns per call is fine. Whole-path tokens are replaced (not just the user
/// segment) so trailing project/file names don't survive.
fn redact_pii(s: &str) -> String {
    let patterns = [
        // Unix absolute paths under a known root (consume the whole token):
        // user homes, temp dirs, and app/library locations.
        r"(?:/Users/|/home/|/root/|/private/|/var/folders/|/var/tmp/|/tmp/|/opt/|/srv/|/Library/)\S*",
        // Windows user paths, e.g. C:\Users\name\...
        r"[A-Za-z]:\\[^\s]*",
        // Relative paths with at least one separator + a file extension,
        // e.g. ./project/note.md or src/lib/x.ts (a bare "note.md" is left
        // alone — too many false positives on ordinary prose).
        r"(?:\./|\.\./)?(?:[\w.-]+/)+[\w.-]+\.\w+",
        // Email addresses.
        r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
    ];
    let mut out = s.to_string();
    for p in patterns {
        if let Ok(re) = regex::Regex::new(p) {
            out = re.replace_all(&out, "<redacted>").into_owned();
        }
    }
    out
}

/// `before_send` scrubber — the single auditable PII strip point for the crash
/// stream. Clears `server_name` (hostname), drops `user` (PII) and `request`
/// (URLs/headers/cookies); removes path-bearing frame fields (`abs_path`,
/// `filename`) from every stacktrace; drops `breadcrumbs`, `modules`, and
/// `transaction` (incidental path carriers); and redacts absolute paths/emails
/// from the top-level `message` and every exception `value`. Stack frame
/// *function/module* names are kept — they make a crash diagnosable and carry
/// no user content. Breadcrumb capture is also disabled at the client
/// (`max_breadcrumbs: 0`); clearing here is defence-in-depth.
///
/// `contexts`, `extra`, and `tags` are cleared wholesale rather than redacted:
/// we never set them deliberately except the React `componentStack` (via
/// `ErrorBoundary`), which a Vite/WebKit build can render with embedded source
/// paths. Dropping them keeps a single, easily-audited strip point — the
/// exception stacktrace's function/module names remain for diagnosis.
pub fn scrub_event(mut event: sentry::protocol::Event<'static>) -> sentry::protocol::Event<'static> {
    // No hostname.
    event.server_name = None;
    // No user identity / IP / email.
    event.user = None;
    // HTTP request data can carry URLs/headers/cookies.
    event.request = None;
    // Breadcrumbs can capture logged file paths; modules/transaction are
    // incidental carriers with no diagnostic value the stack frames lack.
    event.breadcrumbs.values.clear();
    event.modules.clear();
    event.transaction = None;
    // Structured side-channels we don't deliberately populate (and the one we
    // do — React componentStack — can embed source paths). Drop them entirely.
    event.contexts.clear();
    event.extra.clear();
    event.tags.clear();
    event.logentry = None;

    // Free-text fields that can embed paths/URLs/emails.
    if let Some(msg) = event.message.take() {
        event.message = Some(redact_pii(&msg));
    }
    for exception in event.exception.values.iter_mut() {
        // The exception *type* string can be a formatted error carrying a path.
        exception.ty = redact_pii(&exception.ty);
        if let Some(val) = exception.value.take() {
            exception.value = Some(redact_pii(&val));
        }
    }

    let scrub_stacktrace = |st: &mut sentry::protocol::Stacktrace| {
        for frame in st.frames.iter_mut() {
            // These can embed `/Users/<username>/...` and project paths.
            frame.abs_path = None;
            frame.filename = None;
        }
    };

    for exception in event.exception.values.iter_mut() {
        if let Some(st) = exception.stacktrace.as_mut() {
            scrub_stacktrace(st);
        }
    }
    for thread in event.threads.values.iter_mut() {
        if let Some(st) = thread.stacktrace.as_mut() {
            scrub_stacktrace(st);
        }
    }
    if let Some(st) = event.stacktrace.as_mut() {
        scrub_stacktrace(st);
    }

    event
}

#[cfg(test)]
mod tests {
    use super::*;
    use sentry::protocol::{Event, Exception, Frame, Stacktrace, Thread, User};
    use std::borrow::Cow;
    use tempfile::tempdir;

    #[test]
    fn read_consent_defaults_to_false_when_absent() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("telemetry-consent.json");
        let consent = read_consent_from(&path);
        assert!(!consent.usage);
        assert!(!consent.crash);
    }

    #[test]
    fn consent_round_trips_through_disk() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nested").join("telemetry-consent.json");

        let written = TelemetryConsent {
            usage: true,
            crash: false,
        };
        write_consent_to(&path, &written).unwrap();
        assert!(path.exists());

        let read_back = read_consent_from(&path);
        assert_eq!(read_back, written);
    }

    #[test]
    fn consent_both_enabled_round_trips() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("telemetry-consent.json");
        let written = TelemetryConsent {
            usage: true,
            crash: true,
        };
        write_consent_to(&path, &written).unwrap();
        assert_eq!(read_consent_from(&path), written);
    }

    #[test]
    fn corrupt_consent_file_falls_back_to_off() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("telemetry-consent.json");
        std::fs::write(&path, "{ not valid json").unwrap();
        let consent = read_consent_from(&path);
        assert!(!consent.usage);
        assert!(!consent.crash);
    }

    /// Build an event seeded with PII in every field the scrubber touches.
    fn pii_event() -> Event<'static> {
        let frame = Frame {
            function: Some("notesage::commands::write_file".into()),
            abs_path: Some("/Users/alice/Notesage/secret-project/note.md".into()),
            filename: Some("note.md".into()),
            ..Default::default()
        };
        let stacktrace = Stacktrace {
            frames: vec![frame.clone()],
            ..Default::default()
        };

        let mut ev = Event {
            server_name: Some(Cow::Borrowed("alices-macbook.local")),
            user: Some(User {
                email: Some("alice@example.com".into()),
                ip_address: None,
                ..Default::default()
            }),
            message: Some("startup failed at /Users/alice/Notesage/secret-project".into()),
            exception: vec![Exception {
                ty: "Error: ENOENT /Users/alice/Notesage/secret-project/note.md".into(),
                value: Some(
                    "panic reading /Users/alice/Notesage/secret-project/note.md".into(),
                ),
                stacktrace: Some(stacktrace.clone()),
                ..Default::default()
            }]
            .into(),
            threads: vec![Thread {
                stacktrace: Some(stacktrace.clone()),
                ..Default::default()
            }]
            .into(),
            stacktrace: Some(stacktrace),
            ..Default::default()
        };
        // Structured side-channels the scrubber must clear wholesale.
        ev.extra
            .insert("path".to_string(), "/Users/alice/secret/x.md".into());
        ev.tags
            .insert("file".to_string(), "/Users/alice/secret/y.md".to_string());
        ev
    }

    #[test]
    fn redact_pii_strips_paths_and_emails() {
        assert_eq!(
            redact_pii("failed at /Users/alice/Notesage/secret.md now"),
            "failed at <redacted> now"
        );
        assert_eq!(redact_pii("/home/bob/x/y.txt"), "<redacted>");
        // Library / temp / root roots and relative paths.
        assert_eq!(redact_pii("at /Library/Caches/foo.db end"), "at <redacted> end");
        assert_eq!(redact_pii("temp /tmp/notesage-sandbox-7/x.sb"), "temp <redacted>");
        assert!(!redact_pii("failed src/lib/secret.ts here").contains("secret.ts"));
        assert!(!redact_pii("contact bob@example.com please").contains("bob@example.com"));
        assert_eq!(redact_pii("no pii here"), "no pii here");
    }

    #[test]
    fn scrubber_redacts_message_type_and_exception_value() {
        let scrubbed = scrub_event(pii_event());
        assert!(
            !scrubbed.message.unwrap().contains("/Users/alice"),
            "message must be path-redacted"
        );
        let ex = &scrubbed.exception.values[0];
        assert!(!ex.ty.contains("/Users/alice"), "exception type must be path-redacted");
        let val = ex.value.clone().unwrap();
        assert!(!val.contains("/Users/alice"), "exception value must be path-redacted");
    }

    #[test]
    fn scrubber_clears_structured_side_channels() {
        let scrubbed = scrub_event(pii_event());
        assert!(scrubbed.extra.is_empty(), "extra must be cleared");
        assert!(scrubbed.tags.is_empty(), "tags must be cleared");
        assert!(scrubbed.contexts.is_empty(), "contexts must be cleared");
    }

    #[test]
    fn scrubber_clears_server_name_and_user() {
        let scrubbed = scrub_event(pii_event());
        assert!(scrubbed.server_name.is_none(), "server_name must be cleared");
        assert!(scrubbed.user.is_none(), "user (PII) must be cleared");
        assert!(scrubbed.request.is_none(), "request must be cleared");
    }

    #[test]
    fn scrubber_strips_path_bearing_frame_fields() {
        let scrubbed = scrub_event(pii_event());

        let assert_no_paths = |st: &Stacktrace, where_: &str| {
            for frame in &st.frames {
                assert!(
                    frame.abs_path.is_none(),
                    "abs_path must be stripped in {where_}"
                );
                assert!(
                    frame.filename.is_none(),
                    "filename must be stripped in {where_}"
                );
                // Function names are diagnostic, not PII — they survive.
                assert!(frame.function.is_some(), "function name should survive");
            }
        };

        for exc in &scrubbed.exception.values {
            if let Some(st) = &exc.stacktrace {
                assert_no_paths(st, "exception");
            }
        }
        for thread in &scrubbed.threads.values {
            if let Some(st) = &thread.stacktrace {
                assert_no_paths(st, "thread");
            }
        }
        if let Some(st) = &scrubbed.stacktrace {
            assert_no_paths(st, "top-level stacktrace");
        }
    }

    #[test]
    fn scrubbed_event_serializes_without_path_strings() {
        let scrubbed = scrub_event(pii_event());
        let json = serde_json::to_string(&scrubbed).unwrap();
        assert!(
            !json.contains("/Users/alice"),
            "no absolute path may survive serialization: {json}"
        );
        assert!(
            !json.contains("alices-macbook"),
            "no hostname may survive serialization"
        );
        assert!(
            !json.contains("alice@example.com"),
            "no email may survive serialization"
        );
    }
}
