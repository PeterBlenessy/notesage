//! Markdown HTML preview for the large-file instant-load pipeline.
//!
//! See `docs/prds/2026-05-03-large-file-instant-load.md` (Phase 1, Layer 1).
//! Reads a markdown file, strips YAML frontmatter using the same rules as
//! `src/lib/frontmatter.ts:parseFrontmatter`, and runs the existing comrak
//! pipeline (`crate::export::markdown_to_html`) to return an HTML body
//! fragment. The frontend renders this fragment inside a `.ProseMirror`
//! wrapper so the preview is visually indistinguishable from the eventual
//! Tiptap render.

use std::fs;

use crate::export::markdown_to_html::markdown_to_html;

/// Strip a YAML frontmatter block (`---\n…---\n`) from the start of a raw
/// markdown string. Mirrors the behaviour of `parseFrontmatter` on the JS
/// side: must start at position 0, supports both LF and CRLF line endings,
/// allows the trailing `---` to be the final line of the file (no newline),
/// and only treats the leading block as frontmatter — `---` lines later in
/// the document are body content.
///
/// Known divergence from `parseFrontmatter`: when the YAML body between the
/// delimiters is syntactically invalid, the JS parser returns the raw input
/// unchanged (no strip). This implementation doesn't validate YAML — it just
/// slices past the closing delimiter. The result is that a file with broken
/// YAML renders without that broken YAML in the preview, while the live
/// editor would show it. Because malformed frontmatter is rare (Notesage
/// always writes well-formed YAML) and the visual gap exists only for an
/// edge case, accepting the divergence keeps us off a YAML parser dependency
/// for Phase 1. See PRD § "Fidelity gaps to manage".
pub fn strip_frontmatter(raw: &str) -> &str {
    let bytes = raw.as_bytes();

    // Opening delimiter must be at position 0 and end with a newline.
    let opening_end = if bytes.starts_with(b"---\n") {
        4
    } else if bytes.starts_with(b"---\r\n") {
        5
    } else {
        return raw;
    };

    // Walk from `opening_end` looking for a `---` at the start of a line that
    // is followed by `\n`, `\r\n`, or end-of-string.
    let mut pos = opening_end;
    while pos < raw.len() {
        if raw[pos..].starts_with("---") {
            let after = pos + 3;
            let closing_end = if after >= raw.len() {
                Some(after)
            } else if raw[after..].starts_with('\n') {
                Some(after + 1)
            } else if raw[after..].starts_with("\r\n") {
                Some(after + 2)
            } else {
                None
            };

            if let Some(end) = closing_end {
                // Strip one leading newline from the body, mirroring the JS
                // parser ("---\n{yaml}\n---\n\n{content}" pattern collapses to
                // "{content}").
                let body = &raw[end..];
                if let Some(stripped) = body.strip_prefix("\r\n") {
                    return stripped;
                }
                if let Some(stripped) = body.strip_prefix('\n') {
                    return stripped;
                }
                return body;
            }
        }

        // Advance to the next line.
        match raw[pos..].find('\n') {
            Some(rel) => pos += rel + 1,
            None => break,
        }
    }

    // No closing delimiter found — treat the whole input as body content,
    // matching `parseFrontmatter`'s fallback behaviour.
    raw
}

/// Render a markdown file to an HTML body fragment for the instant-load
/// preview surface. Reads the file from disk, strips YAML frontmatter, then
/// runs comrak via `markdown_to_html`.
///
/// `embedded_svgs` is intentionally `None` for Phase 1: drawings (`excalidraw`)
/// and charts (`chart`) render as syntax-highlighted code blocks during the
/// brief preview window and are replaced by their real node-views once the
/// editor hydrates. Resolving sidecar SVGs synchronously here would add I/O
/// latency to the <300ms first-paint budget for negligible visual gain in a
/// window that is by design <5 seconds. See PRD § "Fidelity gaps to manage".
#[tauri::command]
pub async fn render_markdown_preview(
    path: String,
    project_root: Option<String>,
    theme: String,
) -> Result<String, String> {
    // The blocking file read and the CPU-bound comrak render both belong on
    // the blocking pool — running them inline stalled the async runtime for
    // the duration of a large-file render (audit batch 3 fix #8).
    tokio::task::spawn_blocking(move || {
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read file {}: {}", path, e))?;
        let body = strip_frontmatter(&raw);
        Ok(markdown_to_html(
            body,
            &theme,
            project_root.as_deref(),
            None,
        ))
    })
    .await
    .map_err(|e| format!("Markdown preview task failed: {}", e))?
}

/// Render markdown **content** (rather than a file path) to an HTML body
/// fragment.
///
/// Sibling of [`render_markdown_preview`] for callers that already hold the
/// text and cannot hand over a path the main process can open — notably iOS,
/// where every read goes through a security-scoped bookmark resolved in the
/// native layer, so `fs::read_to_string` on the raw path would fail.
///
/// Sharing `markdown_to_html` is the point: the mobile reader renders a note
/// through exactly the same comrak pipeline as the desktop, so callouts,
/// tables, task lists and syntax highlighting look the same on both, and there
/// is one renderer to keep correct rather than two.
///
/// Safe to inject as HTML: comrak runs without `unsafe_`, so raw HTML in the
/// source (including `<script>`) is stripped rather than passed through.
#[tauri::command]
pub async fn render_markdown_fragment(markdown: String, theme: String) -> Result<String, String> {
    // CPU-bound render — same blocking-pool treatment as the path variant.
    tokio::task::spawn_blocking(move || {
        let body = strip_frontmatter(&markdown);
        Ok(markdown_to_html(body, &theme, None, None))
    })
    .await
    .map_err(|e| format!("Markdown render task failed: {}", e))?
}

/// Give back the doctype an already-saved article lost to #805, or `None` when
/// there is nothing to repair.
///
/// Lives in the APP crate rather than in `notesage-capture` beside the builder
/// whose output it repairs. Two reasons, and the second is the deciding one:
/// the Share Extension never repairs anything (this is a reader concern, and
/// the extension only writes), and `notesage-capture` is deliberately not
/// linked into desktop builds — it carries a Readability stack, and "desktop
/// builds link nothing new". Putting fifteen bytes of string handling there
/// would have meant either that whole stack on desktop or a repair that only
/// worked on one platform. It needs no dependencies, so it belongs here where
/// both readers can reach it.
///
/// Files written before that fix are still on disk in quirks mode, and the
/// image sweep will not touch them again — it returns early once no remote
/// image is left. They are repaired when opened instead.
///
/// **Only the doctype is restored, and that is not an oversight.** The same bug
/// also dropped `<head>`/`<body>`, but those tags are OPTIONAL in HTML5: every
/// parser reconstructs them, and their absence changes nothing about how the
/// page renders. The doctype is the one byte sequence that selects standards
/// mode over quirks. So the repair is a prepend, not a reparse — it cannot
/// reorder, re-escape or drop any of the user's content, which matters because
/// a reparse is precisely what damaged these files.
///
/// The signature is deliberately narrow: the content must open with `<html`.
/// That is exactly what #805 produced, and it means a genuine fragment, a
/// non-capture HTML file, or an already-correct document is left alone.
/// Returning `None` rather than an unchanged copy lets callers skip the write
/// entirely — an unchanged mtime keeps iCloud from syncing a no-op edit, the
/// same reasoning `ios_inline_article_images` already applies.
pub fn repair_missing_doctype(html: &str) -> Option<String> {
    let trimmed = html.trim_start_matches('\u{feff}').trim_start();
    let head: String = trimmed.chars().take(16).collect::<String>().to_ascii_lowercase();
    if head.starts_with("<!doctype") {
        return None;
    }
    // The tag has to END after `<html` — a bare `<html>` or one carrying
    // attributes (`<html lang="en">`). Matching the prefix alone also matched
    // `<htmlfoo>`, an unrelated element whose file we would then have rewritten.
    let rest = head.strip_prefix("<html")?;
    if !rest.is_empty() && !rest.starts_with('>') && !rest.starts_with(char::is_whitespace) {
        return None;
    }
    Some(format!("<!doctype html>\n{html}"))
}

/// The page a saved article was clipped from (#829).
///
/// Pure. The caller fetches — on iOS the WebView does it, exactly as the Share
/// Extension fetches rather than adding a network path to Rust.
///
/// iOS-only, like its sibling below and for the same reason.
#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn article_source_url(content: String) -> Result<Option<String>, String> {
    Ok(notesage_capture::article_source_url(&content))
}

/// Add the masthead to an article saved before captures kept one (#829).
///
/// Pure, and returns `None` for "change nothing" — not ours, already repaired,
/// or the refetched page no longer yields an article. The saved BODY is never
/// replaced: a refetch can legitimately come back worse (a bot-block, a
/// paywall, or a page whose article only existed in the share sheet's rendered
/// DOM), so the worst case here is that nothing happens.
///
/// **iOS-only, and unavoidably so** — unlike `repair_html_doctype`, which was
/// moved into this crate precisely because it needed no dependencies. This one
/// calls `extract_article`, so it needs the whole Readability stack that
/// `notesage-capture` carries and that desktop builds deliberately do not
/// link. Offering it on desktop means linking that stack there; the doctype
/// repair set the precedent that a fifteen-byte prepend does not justify it,
/// and this is a genuinely different case worth deciding on its own.
#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn splice_article_header(
    saved: String,
    page_html: String,
    source_url: String,
) -> Result<Option<String>, String> {
    Ok(notesage_capture::splice_article_header(&saved, &page_html, &source_url))
}

/// Repair a saved article that lost its `<!doctype html>` to #805, returning
/// the corrected document — or `None` when there is nothing to repair.
///
/// PURE: this reads and writes nothing. Each caller owns the write and keeps
/// the path it already has — `ios_write_file` (one of the three allowlisted
/// note-editing writes) on iOS, the tab's ordinary save on desktop, which
/// already marks the self-write so the watcher does not report the repair as an
/// external change. Doing the I/O here would have meant new filesystem surface
/// on two platforms for a fifteen-byte prepend.
///
/// Registered on BOTH platforms. The damage was only ever produced on iOS (the
/// image sweep that caused #805 is iOS-only) and the library is iCloud-synced,
/// so repairing on the phone would fix most files for the desktop too — but
/// "most" leaves an article that is only ever opened on desktop broken
/// forever, and these documents are meant to be portable. Repair happens
/// wherever one is opened.
#[tauri::command]
pub async fn repair_html_doctype(content: String) -> Result<Option<String>, String> {
    Ok(repair_missing_doctype(&content))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact shape #805 left on disk: `<html>` with no doctype, because
    /// `Document::fragment` re-serialization dropped it.
    #[test]
    fn repairs_the_document_shape_805_actually_produced() {
        let damaged = "<html><meta charset=\"utf-8\"><title>T</title>\
<p>Body</p><hr><p class=\"source\">Clipped from <a href=\"x\">x</a></p></html>\n";
        let repaired = repair_missing_doctype(damaged).expect("this is the damaged shape");
        assert!(repaired.starts_with("<!doctype html>\n<html>"));
        assert!(
            repaired.ends_with(damaged),
            "repair must PREPEND only — the user's content is not reparsed, \
             reordered or re-escaped"
        );
    }

    /// Idempotent: opening a repaired file again must not write it again, or
    /// every open churns the mtime and re-syncs the file.
    #[test]
    fn a_healthy_document_is_left_alone() {
        for healthy in [
            "<!doctype html>\n<html><body><p>Fine</p></body></html>",
            "<!DOCTYPE HTML>\n<html><body><p>Fine</p></body></html>",
            "\u{feff}<!doctype html>\n<html></html>",
        ] {
            assert!(
                repair_missing_doctype(healthy).is_none(),
                "already standards-mode, must not be rewritten: {healthy:?}"
            );
        }
    }

    /// The signature is narrow on purpose. A fragment, a note, or any file that
    /// does not open with `<html` is somebody else's file — prepending a
    /// doctype to it would be a rewrite we were never asked for.
    #[test]
    fn only_documents_that_open_with_html_are_touched() {
        for untouched in [
            "<p>Just a fragment</p>",
            "<div><html-ish></div>",
            "---\ntitle: a note\n---\n\n# Markdown",
            "",
            "   ",
            "<htmlfoo>not an html element</htmlfoo>",
        ] {
            assert!(
                repair_missing_doctype(untouched).is_none(),
                "must not rewrite a file that is not a doctype-less HTML document: {untouched:?}"
            );
        }
    }

    /// Leading whitespace and a BOM are still that document, and both occur in
    /// files written by other tools.
    #[test]
    fn repair_sees_past_a_bom_and_leading_whitespace() {
        for damaged in [
            "\n  <html><body>x</body></html>",
            "\u{feff}<html><body>x</body></html>",
            // Attributes on the root element are the common shape for a
            // doctype-less document written by some other tool.
            "<html lang=\"en\"><body>x</body></html>",
        ] {
            let repaired =
                repair_missing_doctype(damaged).unwrap_or_else(|| panic!("should repair {damaged:?}"));
            assert!(repaired.starts_with("<!doctype html>"));
            assert!(repaired.ends_with(damaged), "content preserved byte for byte");
        }
    }

    /// Repairing twice changes nothing the second time — the property the
    /// on-open call site depends on to converge.
    #[test]
    fn repair_converges_after_one_pass() {
        let damaged = "<html><body>x</body></html>";
        let once = repair_missing_doctype(damaged).expect("first pass repairs");
        assert!(repair_missing_doctype(&once).is_none(), "second pass must be a no-op");
    }

    #[tokio::test]
    async fn render_fragment_strips_frontmatter_and_renders_markdown() {
        let html = render_markdown_fragment(
            "---\ntitle: T\n---\n\n# Hello\n\n- one\n- two\n".into(),
            "light".into(),
        )
        .await
        .unwrap();
        assert!(html.contains("Hello"), "heading should render: {html}");
        assert!(html.contains("<li>"), "list should render: {html}");
        assert!(!html.contains("title: T"), "frontmatter must not leak: {html}");
    }

    #[tokio::test]
    async fn render_fragment_strips_raw_html_so_the_output_is_injection_safe() {
        // The mobile reader injects this fragment as HTML. comrak runs without
        // `unsafe_`, so a note containing a script tag cannot execute — this
        // pins that, because the day it changes the reader becomes an XSS sink.
        let html = render_markdown_fragment(
            "# Title\n\n<script>alert('x')</script>\n\n<img src=x onerror=alert(1)>\n".into(),
            "light".into(),
        )
        .await
        .unwrap();
        assert!(!html.contains("<script"), "script tag survived: {html}");
        assert!(!html.contains("onerror"), "event handler survived: {html}");
    }

    #[test]
    fn strip_frontmatter_no_frontmatter_returns_input() {
        let input = "# Hello\n\nworld";
        assert_eq!(strip_frontmatter(input), input);
    }

    #[test]
    fn strip_frontmatter_basic_lf() {
        let input = "---\ntitle: Test\nid: abc\n---\n\n# Hello\n";
        assert_eq!(strip_frontmatter(input), "# Hello\n");
    }

    #[test]
    fn strip_frontmatter_basic_crlf() {
        let input = "---\r\ntitle: Test\r\n---\r\n\r\n# Hello\r\n";
        assert_eq!(strip_frontmatter(input), "# Hello\r\n");
    }

    #[test]
    fn strip_frontmatter_no_blank_line_after_close() {
        // No blank line between closing --- and body.
        let input = "---\ntitle: Test\n---\n# Hello\n";
        assert_eq!(strip_frontmatter(input), "# Hello\n");
    }

    #[test]
    fn strip_frontmatter_closing_at_eof_no_newline() {
        // File ends with closing delimiter and no trailing newline.
        let input = "---\ntitle: Test\n---";
        assert_eq!(strip_frontmatter(input), "");
    }

    #[test]
    fn strip_frontmatter_horizontal_rule_in_body_preserved() {
        // A `---` line later in the body must NOT be treated as frontmatter
        // close. The leading block is recognised on its own.
        let input = "---\ntitle: Test\n---\n\nIntro\n\n---\n\nMore\n";
        assert_eq!(strip_frontmatter(input), "Intro\n\n---\n\nMore\n");
    }

    #[test]
    fn strip_frontmatter_no_leading_delimiter() {
        let input = "Some text\n---\nmid block\n---\nrest\n";
        assert_eq!(strip_frontmatter(input), input);
    }

    #[test]
    fn strip_frontmatter_unclosed_block_returns_input() {
        // Open delimiter without a matching close — JS parser falls back to
        // "no frontmatter, full string is content".
        let input = "---\ntitle: Test\nbody never closes\n";
        assert_eq!(strip_frontmatter(input), input);
    }

    #[test]
    fn strip_frontmatter_empty_body() {
        let input = "---\ntitle: T\n---\n";
        assert_eq!(strip_frontmatter(input), "");
    }

    #[test]
    fn strip_frontmatter_indented_dashes_are_not_close() {
        // `---` not at the start of a line is body content.
        let input = "---\ntitle: T\n  ---\n---\nbody\n";
        assert_eq!(strip_frontmatter(input), "body\n");
    }
}
