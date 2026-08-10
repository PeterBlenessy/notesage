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

#[cfg(test)]
mod tests {
    use super::*;

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
