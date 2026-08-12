//! Capture-note construction for the iOS share flow (PRD
//! `docs/prds/2026-06-28-ios-mobile-app.md`).
//!
//! **One implementation, two callers.** The Share Extension is a separate iOS
//! process that writes the note itself — it cannot go through the app's Tauri
//! IPC. Rather than reimplement the note format in Swift (where it would drift
//! from this one silently, and be untested), the extension links this crate as
//! a static library and calls it over the C ABI in [`ffi`].
//!
//! Pure and dependency-free: it turns a shared link into the markdown body +
//! filename of a `type: capture` note. Resolving the iCloud-granted folder and
//! performing the coordinated write stay native, because only the Swift side
//! holds the security-scoped bookmark.
//!
//! Captures are link-only by design: the body is the URL (plus any shared
//! selection text). Desktop workflows (`download-webpage`, `save-research`)
//! recognize `type: capture` and enrich the note later.

pub mod ffi;

/// Input for a single share-capture.
#[derive(Debug, Clone, Default)]
pub struct CaptureInput {
    /// The shared URL (required).
    pub url: String,
    /// Optional shared title (e.g. the page `<title>` or the share-sheet subject).
    pub title: Option<String>,
    /// Optional shared selection text.
    pub selection_text: Option<String>,
    /// Tags for the note's frontmatter. Defaults to `["inbox"]` when empty.
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
/// `now_rfc3339` is the `date_saved` value (e.g. `2026-06-28T10:14:00Z`).
/// It is injected so the function stays deterministic and unit-testable; the
/// command layer computes it from the system clock.
///
/// The filename is the note's TITLE, readable — `The Quiet Rise of Local AI
/// Models.md`, matching how the editor names notes from their heading. The
/// date is deliberately NOT part of it: `date_saved` is already in the
/// frontmatter and drives sorting/grouping, so a timestamp in the name is
/// noise (Peter, 2026-08-12). Same-title captures are deduped by the caller
/// (`name-1.md`), never overwritten.
pub fn build_capture_note(input: &CaptureInput, now_rfc3339: &str) -> CaptureNote {
    let rel_path = format!("{INBOX_DIR}/{}.md", file_name_for(input));

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

/// Derive the note's filename stem from the title (preferred) or the URL
/// host. Readable, not slugified: spaces and capitals are valid in a
/// filename and make a shared note look like a hand-written one.
pub fn file_name_for(input: &CaptureInput) -> String {
    if let Some(title) = input.title.as_ref().filter(|t| !t.trim().is_empty()) {
        let s = sanitize_file_stem(title);
        if !s.is_empty() {
            return s;
        }
    }
    let s = sanitize_file_stem(&url_host(&input.url));
    if s.is_empty() {
        "Capture".to_string()
    } else {
        s
    }
}

/// Make a title safe as a single filename component: strip path separators
/// and characters that break Finder/iCloud round-trips, collapse whitespace,
/// drop leading dots (a hidden file would vanish from the browser), and cap
/// at 60 characters on a word boundary where possible.
pub fn sanitize_file_stem(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_space = false;
    for ch in input.chars() {
        let mapped = match ch {
            '/' | '\\' | ':' => Some('-'),
            // Control characters and the characters Finder/Windows reject.
            c if c.is_control() => None,
            '*' | '?' | '"' | '<' | '>' | '|' => None,
            c if c.is_whitespace() => Some(' '),
            c => Some(c),
        };
        match mapped {
            Some(' ') => {
                if !prev_space && !out.is_empty() {
                    out.push(' ');
                    prev_space = true;
                }
            }
            Some(c) => {
                out.push(c);
                prev_space = false;
            }
            None => {}
        }
    }
    let mut out = out.trim().trim_start_matches('.').trim().to_string();
    if out.chars().count() > 60 {
        let truncated: String = out.chars().take(60).collect();
        out = match truncated.rsplit_once(' ') {
            Some((head, _)) if head.chars().count() >= 30 => head.to_string(),
            _ => truncated,
        };
    }
    out.trim_end_matches(['-', ' ', '.']).to_string()
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

/// Compute the `date_saved` (RFC3339, UTC, seconds precision) and the filename
/// time stamp (`YYYY-MM-DD-HHmmss`, UTC) from the system clock. Kept dependency
/// -free (no `chrono`/`time` crate) via a small civil-time conversion.
/// A readable article extracted from a captured web page.
#[derive(Debug, Clone, PartialEq)]
pub struct Article {
    pub title: Option<String>,
    pub markdown: String,
}

/// Readable extraction + HTML→Markdown for rich web capture (#584), with
/// ad/tracker image filtering (#610).
///
/// Returns `None` when the page does not yield a genuine article — nav-heavy
/// portals, login walls, near-empty bodies — so the caller can fall back to
/// the link-only capture note. The bar: at least `MIN_ARTICLE_CHARS` of
/// extracted markdown, which filters boilerplate-only extractions without
/// rejecting short-but-real posts.
pub fn extract_article(html: &str, url: &str) -> Option<Article> {
    const MIN_ARTICLE_CHARS: usize = 400;

    let mut readability = dom_smoothie::Readability::new(html, Some(url), None).ok()?;
    let product = readability.parse().ok()?;
    let filtered_content = strip_ad_and_tracker_images(&product.content);
    let markdown = htmd::convert(&filtered_content).ok()?;
    let markdown = markdown.trim();
    if markdown.chars().count() < MIN_ARTICLE_CHARS {
        return None;
    }
    let title = {
        let t = product.title.trim();
        if t.is_empty() { None } else { Some(t.to_string()) }
    };
    Some(Article { title, markdown: markdown.to_string() })
}

/// Ad/tracker domains observed in real captures. Matched as a substring of
/// the image `src` (covers both the bare host and CDN/ad-server subdomains
/// like `securepubads.g.doubleclick.net`).
const AD_TRACKER_DOMAINS: &[&str] = &[
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "google-analytics.com",
    "googletagmanager.com",
    "adservice.google.com",
    "adnxs.com",
    "amazon-adsystem.com",
    "scorecardresearch.com",
    "quantserve.com",
    "taboola.com",
    "outbrain.com",
    "criteo.com",
    "moatads.com",
    "adsafeprotected.com",
    "chartbeat.com",
    "pubmatic.com",
    "rubiconproject.com",
    "casalemedia.com",
    "bidswitch.net",
    "adform.net",
    "facebook.com/tr",
];

/// Below this pixel size in either dimension, an `<img>` is a tracking pixel
/// or layout spacer rather than genuine content — real photos and figures
/// are never captured with `width`/`height` this small.
const TRACKING_PIXEL_MAX_DIMENSION: u32 = 5;

/// Strip ad/tracker `<img>` elements from readability-extracted HTML,
/// **before** the HTML→Markdown conversion — markdown drops the
/// `width`/`height`/full-`src`-host signal these heuristics need, so the
/// filter has to run on the DOM, not the rendered text.
fn strip_ad_and_tracker_images(html: &str) -> String {
    let doc = dom_query::Document::fragment(html);
    let ad_images: Vec<_> = doc
        .select("img")
        .iter()
        .filter(|node| is_ad_or_tracker_image(node))
        .collect();
    for node in ad_images {
        node.remove();
    }
    doc.html().to_string()
}

fn is_ad_or_tracker_image(node: &dom_query::Selection) -> bool {
    let src = node.attr("src").unwrap_or_default();
    if src.is_empty() {
        return false;
    }
    let src_lower = src.to_ascii_lowercase();
    if AD_TRACKER_DOMAINS.iter().any(|domain| src_lower.contains(domain)) {
        return true;
    }
    let width = node.attr("width").and_then(|w| w.parse::<u32>().ok());
    let height = node.attr("height").and_then(|h| h.parse::<u32>().ok());
    width.is_some_and(|w| w <= TRACKING_PIXEL_MAX_DIMENSION)
        || height.is_some_and(|h| h <= TRACKING_PIXEL_MAX_DIMENSION)
}

/// Body-bearing capture note (format v2): identical frontmatter to the
/// link-only builder plus `capture_format: markdown`, with the extracted
/// article as the body after the source-link line. The link-only builder
/// remains the universal fallback — a capture must never fail outright.
pub fn build_article_note(
    input: &CaptureInput,
    article: &Article,
    now_rfc3339: &str,
) -> CaptureNote {
    let effective_title = input.title.clone().or_else(|| article.title.clone());
    let base = build_capture_note(
        &CaptureInput { title: effective_title, ..input.clone() },
        now_rfc3339,
    );
    let mut contents = base.contents;
    // Frontmatter is the first `---` block; add the format marker just
    // before its closing fence so consumers can route on it.
    if let Some(close) = contents[3..].find("\n---") {
        contents.insert_str(3 + close, "\ncapture_format: markdown");
    }
    contents.push('\n');
    contents.push_str(&article.markdown);
    contents.push('\n');
    CaptureNote { contents, ..base }
}

pub fn timestamps() -> (String, String) {
    // The second element (the `YYYY-MM-DD-HHmmss` filename stamp) is no
    // longer used in filenames (#653 follow-up: captures are named after
    // their title). Kept so the shape stays testable and any future
    // consumer has it.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0) as i64;
    let (y, mo, d, h, mi, s) = civil_from_unix(secs);
    (
        format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z"),
        format!("{y:04}-{mo:02}-{d:02}-{h:02}{mi:02}{s:02}"),
    )
}

/// Convert a Unix timestamp (seconds, UTC) to civil (Y, M, D, h, m, s).
/// Uses Howard Hinnant's `civil_from_days` algorithm — no external crates.
fn civil_from_unix(unix_secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = unix_secs.div_euclid(86_400);
    let secs_of_day = unix_secs.rem_euclid(86_400);
    let h = (secs_of_day / 3600) as u32;
    let mi = ((secs_of_day % 3600) / 60) as u32;
    let s = (secs_of_day % 60) as u32;

    // days since 1970-01-01 → civil date
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = if m <= 2 { y + 1 } else { y };
    (year, m, d, h, mi, s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_from_unix_known_values() {
        // 2026-06-28T10:14:00Z = 1782641640
        assert_eq!(civil_from_unix(1_782_641_640), (2026, 6, 28, 10, 14, 0));
        // epoch
        assert_eq!(civil_from_unix(0), (1970, 1, 1, 0, 0, 0));
    }

    #[test]
    fn timestamps_are_shaped_for_frontmatter_and_filenames() {
        let (rfc3339, stamp) = timestamps();
        assert_eq!(rfc3339.len(), 20, "expected YYYY-MM-DDTHH:MM:SSZ, got {rfc3339}");
        assert!(rfc3339.ends_with('Z'), "{rfc3339}");
        assert_eq!(stamp.len(), 17, "expected YYYY-MM-DD-HHMMSS, got {stamp}");
    }

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
        );
        assert_eq!(note.rel_path, "Inbox/Hello, World! A Post.md");
    }

    #[test]
    fn falls_back_to_host_when_no_title() {
        let note = build_capture_note(
            &input("https://x.com/user/status/123", None),
            "2026-06-28T10:14:00Z",
        );
        assert_eq!(note.rel_path, "Inbox/x.com.md");
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
        );
        assert!(note.contents.contains("tags:\n  - \"inbox\"\n"));
    }

    #[test]
    fn honors_explicit_tags() {
        let mut i = input("https://example.com", None);
        i.tags = vec!["read-later".to_string(), "x".to_string()];
        let note = build_capture_note(&i, "t");
        assert!(note.contents.contains("  - \"read-later\"\n"));
        assert!(note.contents.contains("  - \"x\"\n"));
        assert!(!note.contents.contains("inbox"));
    }

    #[test]
    fn frontmatter_has_type_and_source_url() {
        let note = build_capture_note(
            &input("https://example.com/a", Some("T")),
            "2026-06-28T10:14:00Z",
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
        let note = build_capture_note(&i, "t");
        let body = note.contents.split("---\n\n").nth(1).unwrap();
        assert_eq!(body, "https://example.com/a\n\na quoted passage\n");
    }

    #[test]
    fn omits_blank_title_and_selection() {
        let mut i = input("https://example.com/a", Some("   "));
        i.selection_text = Some("  ".to_string());
        let note = build_capture_note(&i, "t");
        assert!(!note.contents.contains("title:"));
        let body = note.contents.split("---\n\n").nth(1).unwrap();
        assert_eq!(body, "https://example.com/a\n");
    }

    #[test]
    fn yaml_quote_escapes_quotes_and_backslashes() {
        assert_eq!(yaml_quote("a\"b\\c"), "\"a\\\"b\\\\c\"");
    }

    #[test]
    fn file_stem_is_readable_safe_and_capped() {
        // Readable: spaces and capitals survive — a shared note should look
        // like a hand-written one (#653 follow-up).
        assert_eq!(
            sanitize_file_stem("The Quiet Rise of Local AI Models"),
            "The Quiet Rise of Local AI Models"
        );
        // Path separators and Finder-hostile characters are replaced/dropped.
        assert_eq!(sanitize_file_stem("Q3/Q4: plan?"), "Q3-Q4- plan");
        // Whitespace collapses; a leading dot (hidden file!) is stripped.
        assert_eq!(sanitize_file_stem("  .hidden   name  "), "hidden   name".replace("   ", " "));
        // Capped at 60 chars, preferring a word boundary.
        let long = "word ".repeat(30);
        let capped = sanitize_file_stem(&long);
        assert!(capped.chars().count() <= 60, "{capped}");
        assert!(!capped.ends_with(' '));
        // A title with nothing usable yields an empty stem, so file_name_for
        // falls back to the host (and ultimately "Capture").
        assert_eq!(sanitize_file_stem("///"), "");
    }

    // ---- rich web capture (#584) ------------------------------------------

    fn article_html() -> String {
        let paragraphs: String = (0..12)
            .map(|i| format!("<p>Paragraph {i}: the quick brown fox jumps over the lazy dog, again and again, providing ample readable content for the extractor to work with.</p>"))
            .collect();
        format!(
            "<html><head><title>A Real Article</title></head><body>\
             <nav><a href=\"/\">Home</a><a href=\"/about\">About</a></nav>\
             <article><h1>A Real Article</h1>{paragraphs}</article>\
             <footer>© footer</footer></body></html>"
        )
    }

    #[test]
    fn extracts_a_real_article_to_markdown() {
        let article = extract_article(&article_html(), "https://example.com/post").expect("article");
        assert!(article.markdown.contains("Paragraph 3"));
        assert!(!article.markdown.contains("About"), "nav chrome must not survive extraction");
        assert_eq!(article.title.as_deref(), Some("A Real Article"));
    }

    #[test]
    fn rejects_nav_heavy_and_tiny_pages() {
        let portal = "<html><body><nav><ul><li><a href=\"/a\">A</a></li><li><a href=\"/b\">B</a></li></ul></nav><p>Login</p></body></html>";
        assert!(extract_article(portal, "https://example.com/").is_none());
        assert!(extract_article("<html><body><p>hi</p></body></html>", "https://example.com/").is_none());
        assert!(extract_article("not html at all", "https://example.com/").is_none());
    }

    #[test]
    fn article_note_carries_format_marker_and_body() {
        let input = CaptureInput {
            url: "https://example.com/post".into(),
            title: None,
            selection_text: None,
            tags: vec![],
        };
        let article = extract_article(&article_html(), "https://example.com/post").unwrap();
        let note = build_article_note(&input, &article, "2026-08-10T10:00:00+02:00");
        // Frontmatter: format marker INSIDE the fence, title from the article.
        let fm_end = note.contents[3..].find("\n---").unwrap() + 3;
        let frontmatter = &note.contents[..fm_end];
        assert!(frontmatter.contains("capture_format: markdown"), "{frontmatter}");
        assert!(frontmatter.contains("A Real Article"));
        // Body: the article markdown follows.
        assert!(note.contents[fm_end..].contains("Paragraph 3"));
        // Same naming scheme as the link-only note: titled, undated.
        assert_eq!(note.rel_path, "Inbox/A Real Article.md");
    }

    #[test]
    fn explicit_share_title_beats_extracted_title() {
        let input = CaptureInput {
            url: "https://example.com/post".into(),
            title: Some("User Chosen".into()),
            selection_text: None,
            tags: vec![],
        };
        let article = extract_article(&article_html(), "https://example.com/post").unwrap();
        let note = build_article_note(&input, &article, "2026-08-10T10:00:00+02:00");
        assert!(note.contents.contains("User Chosen"));
    }

    // ---- ad/tracker image filtering (#610) ---------------------------------

    /// A representative article body — 12 real paragraphs plus nav/footer
    /// chrome (mirrors `article_html()`) — with `images` inserted right
    /// after the heading, so each fixture below reads like an actual capture.
    fn article_html_with_images(images: &str) -> String {
        let paragraphs: String = (0..12)
            .map(|i| format!("<p>Paragraph {i}: the quick brown fox jumps over the lazy dog, again and again, providing ample readable content for the extractor to work with.</p>"))
            .collect();
        format!(
            "<html><head><title>A Real Article</title></head><body>\
             <nav><a href=\"/\">Home</a><a href=\"/about\">About</a></nav>\
             <article><h1>A Real Article</h1>{images}{paragraphs}</article>\
             <footer>© footer</footer></body></html>"
        )
    }

    #[test]
    fn keeps_genuine_content_figures() {
        let images = r#"<figure><img src="https://cdn.example.com/photos/skyline.jpg" width="800" height="450" alt="City skyline"></figure>"#;
        let article =
            extract_article(&article_html_with_images(images), "https://example.com/post").expect("article");
        assert!(article.markdown.contains("skyline.jpg"), "{}", article.markdown);
    }

    #[test]
    fn strips_known_ad_domain_images() {
        let images = concat!(
            r#"<img src="https://securepubads.g.doubleclick.net/gampad/ad?id=1" width="300" height="250" alt="ad">"#,
            r#"<figure><img src="https://cdn.example.com/photos/skyline.jpg" width="800" height="450" alt="City skyline"></figure>"#,
        );
        let article =
            extract_article(&article_html_with_images(images), "https://example.com/post").expect("article");
        assert!(!article.markdown.contains("doubleclick"), "{}", article.markdown);
        assert!(article.markdown.contains("skyline.jpg"), "{}", article.markdown);
    }

    #[test]
    fn strips_tracking_pixel_sized_images() {
        let images = concat!(
            r#"<img src="https://cdn.example.com/beacon.gif" width="1" height="1" alt="">"#,
            r#"<figure><img src="https://cdn.example.com/photos/skyline.jpg" width="800" height="450" alt="City skyline"></figure>"#,
        );
        let article =
            extract_article(&article_html_with_images(images), "https://example.com/post").expect("article");
        assert!(!article.markdown.contains("beacon.gif"), "{}", article.markdown);
        assert!(article.markdown.contains("skyline.jpg"), "{}", article.markdown);
    }

    #[test]
    fn image_free_article_extracts_cleanly() {
        let article =
            extract_article(&article_html_with_images(""), "https://example.com/post").expect("article");
        assert!(article.markdown.contains("Paragraph 3"));
        assert!(!article.markdown.contains("<img"));
    }
}
