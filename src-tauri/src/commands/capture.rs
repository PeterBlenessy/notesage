//! Capture-note construction for the iOS share-capture flow (PRD
//! `docs/prds/2026-06-28-ios-mobile-app.md`, task #7).
//!
//! This module is **pure and platform-agnostic** — it turns a shared link into
//! the markdown body + filename of a `type: capture` note. The actual write
//! (resolving the iCloud-granted folder, coordinating the write) lives in the
//! iOS command layer (`ios_library.rs`); keeping the formatting here makes it
//! unit-testable on every platform and reusable by the share extension's own
//! write path.
//!
//! Captures are link-only by design: the body is the URL (plus any shared
//! selection text). Desktop workflows (`download-webpage`, `save-research`)
//! recognize `type: capture` and enrich the note later.

// The note builder is consumed only by the iOS command path
// (`ios_library::ios_impl`, gated on `target_os = "ios"`); on desktop builds it
// is reachable only from tests, so silence the dead-code lint there.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

/// Input for a single share-capture.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureInput {
    /// The shared URL (required).
    pub url: String,
    /// Optional shared title (e.g. the page `<title>` or the share-sheet subject).
    #[serde(default)]
    pub title: Option<String>,
    /// Optional shared selection text.
    #[serde(default)]
    pub selection_text: Option<String>,
    /// Tags for the note's frontmatter. Defaults to `["inbox"]` when empty.
    #[serde(default)]
    pub tags: Vec<String>,
}

/// The rendered capture note: a relative path under the library root and the
/// file contents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureNote {
    /// Relative path under the granted library folder, e.g.
    /// `Inbox/2026-06-28-101400-x-com.md`.
    pub rel_path: String,
    /// Full markdown file contents (frontmatter + body).
    pub contents: String,
}

/// Folder (relative to the library root) where captures land.
pub const INBOX_DIR: &str = "Inbox";

/// Build a capture note from `input`.
///
/// `now_rfc3339` is the `date_saved` value (e.g. `2026-06-28T10:14:00Z`) and
/// `file_stamp` is the filename time component (`YYYY-MM-DD-HHmmss`). Both are
/// injected so the function stays deterministic and unit-testable; the command
/// layer computes them from the system clock.
pub fn build_capture_note(input: &CaptureInput, now_rfc3339: &str, file_stamp: &str) -> CaptureNote {
    let slug = slug_for(input);
    let rel_path = format!("{INBOX_DIR}/{file_stamp}-{slug}.md");

    let tags = if input.tags.is_empty() {
        vec!["inbox".to_string()]
    } else {
        input.tags.clone()
    };

    let mut fm = String::new();
    fm.push_str("---\n");
    fm.push_str("type: capture\n");
    fm.push_str(&format!("source_url: {}\n", yaml_quote(&input.url)));
    if let Some(title) = input.title.as_ref().filter(|t| !t.trim().is_empty()) {
        fm.push_str(&format!("title: {}\n", yaml_quote(title)));
    }
    fm.push_str(&format!("date_saved: {}\n", yaml_quote(now_rfc3339)));
    fm.push_str("tags:\n");
    for tag in &tags {
        fm.push_str(&format!("  - {}\n", yaml_quote(tag)));
    }
    fm.push_str("---\n\n");

    // Body: the link, then any shared selection text.
    let mut body = String::new();
    body.push_str(input.url.trim());
    body.push('\n');
    if let Some(sel) = input.selection_text.as_ref().filter(|s| !s.trim().is_empty()) {
        body.push('\n');
        body.push_str(sel.trim());
        body.push('\n');
    }

    CaptureNote {
        rel_path,
        contents: format!("{fm}{body}"),
    }
}

/// Derive a filesystem-safe slug from the title (preferred) or the URL host.
fn slug_for(input: &CaptureInput) -> String {
    if let Some(title) = input.title.as_ref().filter(|t| !t.trim().is_empty()) {
        let s = slugify(title);
        if !s.is_empty() {
            return s;
        }
    }
    let host = url_host(&input.url);
    let s = slugify(&host);
    if s.is_empty() {
        "capture".to_string()
    } else {
        s
    }
}

/// Lowercase, replace any run of non-alphanumeric characters with a single `-`,
/// trim leading/trailing `-`, and cap length at 50 characters.
fn slugify(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_dash = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.len() > 50 {
        out.truncate(50);
        while out.ends_with('-') {
            out.pop();
        }
    }
    out
}

/// Extract the host portion of a URL without pulling in a URL-parsing crate.
/// `https://x.com/user/status/1` → `x.com`. Falls back to the whole string.
fn url_host(url: &str) -> String {
    let after_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let host = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(after_scheme);
    // Drop userinfo and port.
    let host = host.rsplit_once('@').map(|(_, h)| h).unwrap_or(host);
    let host = host.split_once(':').map(|(h, _)| h).unwrap_or(host);
    host.to_string()
}

/// Quote a scalar for YAML using double quotes, escaping `\` and `"`. Always
/// quoting is the conservative choice — it keeps URLs with `:` and `#` and
/// titles with `:` from breaking the block.
fn yaml_quote(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(url: &str, title: Option<&str>) -> CaptureInput {
        CaptureInput {
            url: url.to_string(),
            title: title.map(|t| t.to_string()),
            selection_text: None,
            tags: vec![],
        }
    }

    #[test]
    fn builds_filename_from_title_slug() {
        let note = build_capture_note(
            &input("https://example.com/post", Some("Hello, World! A Post")),
            "2026-06-28T10:14:00Z",
            "2026-06-28-101400",
        );
        assert_eq!(note.rel_path, "Inbox/2026-06-28-101400-hello-world-a-post.md");
    }

    #[test]
    fn falls_back_to_host_slug_when_no_title() {
        let note = build_capture_note(
            &input("https://x.com/user/status/123", None),
            "2026-06-28T10:14:00Z",
            "2026-06-28-101400",
        );
        assert_eq!(note.rel_path, "Inbox/2026-06-28-101400-x-com.md");
    }

    #[test]
    fn host_slug_strips_port_and_userinfo() {
        assert_eq!(url_host("https://user@host.example.com:8443/p"), "host.example.com");
        assert_eq!(url_host("not a url"), "not a url");
    }

    #[test]
    fn defaults_tags_to_inbox() {
        let note = build_capture_note(
            &input("https://example.com", None),
            "2026-06-28T10:14:00Z",
            "2026-06-28-101400",
        );
        assert!(note.contents.contains("tags:\n  - \"inbox\"\n"));
    }

    #[test]
    fn honors_explicit_tags() {
        let mut i = input("https://example.com", None);
        i.tags = vec!["read-later".to_string(), "x".to_string()];
        let note = build_capture_note(&i, "t", "s");
        assert!(note.contents.contains("  - \"read-later\"\n"));
        assert!(note.contents.contains("  - \"x\"\n"));
        assert!(!note.contents.contains("inbox"));
    }

    #[test]
    fn frontmatter_has_type_and_source_url() {
        let note = build_capture_note(
            &input("https://example.com/a", Some("T")),
            "2026-06-28T10:14:00Z",
            "2026-06-28-101400",
        );
        assert!(note.contents.starts_with("---\ntype: capture\n"));
        assert!(note.contents.contains("source_url: \"https://example.com/a\"\n"));
        assert!(note.contents.contains("title: \"T\"\n"));
        assert!(note.contents.contains("date_saved: \"2026-06-28T10:14:00Z\"\n"));
    }

    #[test]
    fn body_contains_url_then_selection() {
        let mut i = input("https://example.com/a", None);
        i.selection_text = Some("a quoted passage".to_string());
        let note = build_capture_note(&i, "t", "s");
        let body = note.contents.split("---\n\n").nth(1).unwrap();
        assert_eq!(body, "https://example.com/a\n\na quoted passage\n");
    }

    #[test]
    fn omits_blank_title_and_selection() {
        let mut i = input("https://example.com/a", Some("   "));
        i.selection_text = Some("  ".to_string());
        let note = build_capture_note(&i, "t", "s");
        assert!(!note.contents.contains("title:"));
        let body = note.contents.split("---\n\n").nth(1).unwrap();
        assert_eq!(body, "https://example.com/a\n");
    }

    #[test]
    fn yaml_quote_escapes_quotes_and_backslashes() {
        assert_eq!(yaml_quote("a\"b\\c"), "\"a\\\"b\\\\c\"");
    }

    #[test]
    fn slug_is_capped_and_trimmed() {
        let long = "x".repeat(80);
        let s = slugify(&long);
        assert_eq!(s.len(), 50);
        assert_eq!(slugify("  !!! hi --- there !!!  "), "hi-there");
        assert_eq!(slugify("!!!"), "");
    }
}
