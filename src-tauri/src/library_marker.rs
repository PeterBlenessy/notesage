//! The library marker — `<library root>/.notesage/library.json` — that makes
//! a synced library self-describing (PRD
//! `docs/prds/2026-09-05-icloud-container-library.md`, Decision 3; task #4).
//!
//! Written by whichever device creates the root (the phone in Phase 1),
//! extended by the Mac's migration. This is the Mac's READ path: Phase 2's
//! root-resolution rule (`get_library_container_path` /
//! `read_library_marker` in `sync.rs`) follows `migrated_from` so a second
//! Mac switches roots after a migration performed elsewhere.
//!
//! Mirrors `src/lib/library-marker.ts`. The two serializers must agree
//! byte-for-byte on a canonical example — `tests/fixtures/library-marker.json`
//! is written by the TS side and round-tripped here — so a marker written by
//! either platform diffs cleanly in iCloud. Field ORDER is the contract:
//! `serde_json::to_string_pretty` emits struct fields in declaration order,
//! which is the order the TS serializer builds.

use serde::{Deserialize, Serialize};
use std::path::Path;

pub const LIBRARY_MARKER_REL_PATH: &str = ".notesage/library.json";

/// The only source a migration can come from today.
pub const LEGACY_CLOUD_DOCS_LIBRARY: &str = "com~apple~CloudDocs/Notesage";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMarker {
    pub version: u8,
    pub kind: String,
    pub created_by: String,
    /// ISO 8601.
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub migrated_from: Option<String>,
    /// ISO 8601.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub migrated_at: Option<String>,
    /// Device name, informational.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub migrated_by: Option<String>,
}

impl LibraryMarker {
    /// The same acceptance rule as `parseLibraryMarker` in TS: a version-1
    /// container marker from a known creator, whose migration (if any) came
    /// from the one source this reader can follow. Unknown JSON fields are
    /// ignored by serde already.
    fn is_valid(&self) -> bool {
        self.version == 1
            && self.kind == "container"
            && matches!(self.created_by.as_str(), "ios" | "macos")
            && !self.created_at.is_empty()
            && self
                .migrated_from
                .as_deref()
                .is_none_or(|from| from == LEGACY_CLOUD_DOCS_LIBRARY)
    }
}

/// Parse marker text. `None` for anything that is not a valid marker — the
/// caller treats it as "no marker", never as an error.
pub fn parse_marker(text: &str) -> Option<LibraryMarker> {
    let marker: LibraryMarker = serde_json::from_str(text).ok()?;
    marker.is_valid().then_some(marker)
}

/// Canonical serialization — two-space indent, fixed key order, trailing
/// newline — identical to `serializeLibraryMarker` in TS.
pub fn serialize_marker(marker: &LibraryMarker) -> String {
    let mut text = serde_json::to_string_pretty(marker).expect("marker serializes");
    text.push('\n');
    text
}

/// Read `<root>/.notesage/library.json`. `None` when the file is absent,
/// unreadable, or not a valid marker. An undownloaded iCloud placeholder
/// (`.notesage/.library.json.icloud`) counts as absent here: the Mac's
/// resolution rule is re-run on every launch, and iCloud materialises the
/// file on its own.
pub fn read_marker(root: &Path) -> Option<LibraryMarker> {
    let text = std::fs::read_to_string(root.join(LIBRARY_MARKER_REL_PATH)).ok()?;
    parse_marker(&text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture() -> String {
        // The repo-root fixture the TS serializer writes (`tests/fixtures/`),
        // one level above the crate.
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/library-marker.json");
        std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
    }

    #[test]
    fn round_trips_the_shared_fixture_byte_for_byte() {
        let text = fixture();
        let marker = parse_marker(&text).expect("fixture is a valid marker");
        assert_eq!(marker.created_by, "ios");
        assert_eq!(marker.migrated_from.as_deref(), Some(LEGACY_CLOUD_DOCS_LIBRARY));
        assert_eq!(marker.migrated_by.as_deref(), Some("Peter's MacBook Pro"));
        // Byte-for-byte: the TS side wrote this file, and the Mac must write
        // the same bytes for the same marker or iCloud sees a spurious change.
        assert_eq!(serialize_marker(&marker), text);
    }

    #[test]
    fn a_fresh_marker_serializes_without_the_migration_keys() {
        let marker = LibraryMarker {
            version: 1,
            kind: "container".into(),
            created_by: "ios".into(),
            created_at: "2026-09-05T08:15:00Z".into(),
            migrated_from: None,
            migrated_at: None,
            migrated_by: None,
        };
        assert_eq!(
            serialize_marker(&marker),
            "{\n  \"version\": 1,\n  \"kind\": \"container\",\n  \"createdBy\": \"ios\",\n  \"createdAt\": \"2026-09-05T08:15:00Z\"\n}\n"
        );
        assert_eq!(parse_marker(&serialize_marker(&marker)), Some(marker));
    }

    #[test]
    fn rejects_what_the_ts_parser_rejects() {
        assert!(parse_marker("nope").is_none());
        assert!(parse_marker("[]").is_none());
        assert!(parse_marker(r#"{"version":2,"kind":"container","createdBy":"ios","createdAt":"x"}"#).is_none());
        assert!(parse_marker(r#"{"version":1,"kind":"folder","createdBy":"ios","createdAt":"x"}"#).is_none());
        assert!(parse_marker(r#"{"version":1,"kind":"container","createdBy":"android","createdAt":"x"}"#).is_none());
        assert!(parse_marker(r#"{"version":1,"kind":"container","createdBy":"ios","createdAt":""}"#).is_none());
        assert!(parse_marker(r#"{"version":1,"kind":"container"}"#).is_none());
        assert!(parse_marker(
            r#"{"version":1,"kind":"container","createdBy":"ios","createdAt":"x","migratedFrom":"Dropbox/Notesage"}"#
        )
        .is_none());
    }

    #[test]
    fn tolerates_unknown_fields() {
        let marker = parse_marker(
            r#"{"version":1,"kind":"container","createdBy":"macos","createdAt":"x","futureKey":{"nested":true}}"#,
        )
        .expect("unknown fields are ignored");
        assert_eq!(marker.created_by, "macos");
    }

    #[test]
    fn read_marker_is_none_for_a_missing_or_invalid_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(read_marker(dir.path()).is_none());
        let notesage = dir.path().join(".notesage");
        std::fs::create_dir_all(&notesage).unwrap();
        std::fs::write(notesage.join("library.json"), "not json").unwrap();
        assert!(read_marker(dir.path()).is_none());
        std::fs::write(notesage.join("library.json"), fixture()).unwrap();
        assert!(read_marker(dir.path()).is_some());
    }
}
