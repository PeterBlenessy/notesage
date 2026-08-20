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
    if let Some(title) = meaningful_title(input.title.as_deref()) {
        fm.push_str(&format!("title: {}\n", yaml_quote(&title)));
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

/// A video page's public metadata, from the provider's own oEmbed endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VideoMeta {
    pub title: Option<String>,
    pub author: Option<String>,
    pub author_url: Option<String>,
    pub provider: Option<String>,
    pub thumbnail_url: Option<String>,
}

/// The provider's **official, documented, public** oEmbed endpoint for `url`,
/// or `None` if we don't recognise the host as a video page.
///
/// oEmbed is deliberately the whole extraction story here. Downloading the
/// video itself would mean reimplementing stream extraction and signature
/// deciphering — which breaks whenever the provider changes its player, and
/// which App Store review treats as unauthorized access to third-party
/// content (guideline 5.2.3). A capture note wants the *readable* part of a
/// video anyway: what it is, who made it, and a link back.
pub fn oembed_url(url: &str) -> Option<String> {
    let host = url
        .split("://")
        .nth(1)?
        .split('/')
        .next()?
        .trim_start_matches("www.")
        .to_lowercase();
    let encoded = percent_encode_url(url);
    match host.as_str() {
        "youtube.com" | "m.youtube.com" | "youtu.be" | "music.youtube.com" => {
            Some(format!("https://www.youtube.com/oembed?url={encoded}&format=json"))
        }
        "vimeo.com" | "player.vimeo.com" => {
            Some(format!("https://vimeo.com/api/oembed.json?url={encoded}"))
        }
        _ => None,
    }
}

/// Minimal percent-encoding for embedding a URL in a query string.
fn percent_encode_url(url: &str) -> String {
    let mut out = String::with_capacity(url.len() + 16);
    for byte in url.trim().bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Parse the handful of oEmbed fields a capture note uses. Hand-rolled rather
/// than pulling serde_json into the Share Extension's static library: the
/// shape is five flat string fields, and everything is optional so a provider
/// that omits one degrades instead of failing the capture.
pub fn parse_oembed(json: &str) -> VideoMeta {
    fn field(json: &str, key: &str) -> Option<String> {
        let needle = format!("\"{key}\"");
        let at = json.find(&needle)? + needle.len();
        let rest = json[at..].trim_start();
        let rest = rest.strip_prefix(':')?.trim_start();
        let rest = rest.strip_prefix('"')?;
        // Walk to the closing quote, honouring backslash escapes.
        let mut value = String::new();
        let mut chars = rest.chars();
        while let Some(c) = chars.next() {
            match c {
                '"' => {
                    let value = decode_json_escapes(&value);
                    return if value.is_empty() { None } else { Some(value) };
                }
                '\\' => match chars.next() {
                    Some(escaped) => {
                        value.push('\\');
                        value.push(escaped);
                    }
                    None => break,
                },
                _ => value.push(c),
            }
        }
        None
    }

    VideoMeta {
        title: field(json, "title").filter(|t| !is_url_like(t)),
        author: field(json, "author_name"),
        author_url: field(json, "author_url"),
        provider: field(json, "provider_name"),
        thumbnail_url: field(json, "thumbnail_url"),
    }
}

fn decode_json_escapes(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                match u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                    Some(decoded) => out.push(decoded),
                    None => out.push_str(&format!("\\u{hex}")),
                }
            }
            Some(other) => out.push(other),
            None => break,
        }
    }
    out.trim().to_string()
}

/// Video capture note (`capture_format: video`).
///
/// The body leads with a labelled link to the source and shows the poster as
/// a PLAIN image. This is the fix for the note that looked like a video and
/// wasn't (#682): the page's own composite poster carries a drawn-on play
/// button, so embedding it produced a control that could never work. The
/// provider's oEmbed thumbnail is the clean frame, and the link is the thing
/// that actually plays it.
pub fn build_video_note(input: &CaptureInput, meta: &VideoMeta, now_rfc3339: &str) -> CaptureNote {
    let title = meaningful_title(input.title.as_deref()).or_else(|| meta.title.clone());
    let base = build_capture_note(
        &CaptureInput { title: title.clone(), ..input.clone() },
        now_rfc3339,
    );

    let mut fm = String::new();
    fm.push_str("capture_format: video");
    if let Some(author) = meta.author.as_ref().filter(|a| !a.trim().is_empty()) {
        fm.push_str(&format!("\nauthor: {}", yaml_quote(author)));
    }
    if let Some(provider) = meta.provider.as_ref().filter(|p| !p.trim().is_empty()) {
        fm.push_str(&format!("\nprovider: {}", yaml_quote(provider)));
    }
    let mut contents = base.contents;
    if let Some(close) = contents[3..].find("\n---") {
        contents.insert_str(3 + close, &format!("\n{fm}"));
    }

    let provider = meta.provider.clone().unwrap_or_else(|| "source".to_string());
    let mut body = String::new();
    body.push_str(&format!("[Watch on {provider}]({})\n", input.url.trim()));
    if let Some(author) = meta.author.as_ref().filter(|a| !a.trim().is_empty()) {
        match meta.author_url.as_ref().filter(|u| !u.trim().is_empty()) {
            Some(author_url) => body.push_str(&format!("\nBy [{author}]({author_url})\n")),
            None => body.push_str(&format!("\nBy {author}\n")),
        }
    }
    if let Some(thumb) = meta.thumbnail_url.as_ref().filter(|t| !t.trim().is_empty()) {
        let alt = title.as_deref().unwrap_or("Video");
        body.push_str(&format!("\n![{}]({})\n", alt.replace(']', ")"), thumb));
    }
    if let Some(sel) = input.selection_text.as_ref().filter(|s| !s.trim().is_empty()) {
        body.push_str(&format!("\n{}\n", sel.trim()));
    }

    // Replace the link-only body (everything after the frontmatter fence).
    let split = contents.find("---\n\n").map(|i| i + 5).unwrap_or(0);
    CaptureNote {
        rel_path: base.rel_path,
        contents: format!("{}{body}", &contents[..split]),
    }
}

/// Is this "title" really just the URL?
///
/// A share sheet's title is whatever the source app put in
/// `attributedContentText`, and several major apps (YouTube among them) put
/// the URL there. Taken at face value it wins over every better source and
/// the note ends up named `https---youtube.com-watchv=…` (Peter, 2026-08-13).
/// Treat it as no title at all so the real one — the article's, or the page's
/// `og:title` — is used instead.
pub fn is_url_like(candidate: &str) -> bool {
    let t = candidate.trim();
    if t.is_empty() {
        return false;
    }
    if t.starts_with("http://") || t.starts_with("https://") || t.starts_with("www.") {
        return true;
    }
    // Bare `host/path` with no spaces, e.g. `youtu.be/3zk1WjrxCSw`.
    !t.contains(char::is_whitespace) && t.contains('/') && t.split('/').next().is_some_and(|host| {
        host.contains('.') && !host.ends_with('.')
    })
}

/// The shared title, unless it is empty or merely the URL again.
pub fn meaningful_title(title: Option<&str>) -> Option<String> {
    title
        .map(str::trim)
        .filter(|t| !t.is_empty() && !is_url_like(t))
        .map(str::to_string)
}

/// Pull a human title out of a page: `og:title`, then `twitter:title`, then
/// `<title>`. The fallback for pages whose sharer gave us nothing usable and
/// whose body readability cannot parse (video pages, app shells).
pub fn extract_meta_title(html: &str) -> Option<String> {
    fn meta_content(html: &str, property: &str) -> Option<String> {
        // Deliberately a scan rather than a DOM parse: this runs inside the
        // Share Extension's tight memory budget, and the shapes below cover
        // what real pages emit.
        let lower = html.to_lowercase();
        let mut from = 0usize;
        while let Some(start) = lower[from..].find("<meta").map(|i| i + from) {
            let end = lower[start..].find('>').map(|i| i + start)?;
            let tag = &html[start..end];
            let tag_lower = &lower[start..end];
            let names = [
                format!("property=\"{property}\""),
                format!("name=\"{property}\""),
                format!("property='{property}'"),
                format!("name='{property}'"),
            ];
            if names.iter().any(|n| tag_lower.contains(n.as_str())) {
                if let Some(value) = attribute_value(tag, tag_lower, "content") {
                    let value = decode_entities(value.trim());
                    if !value.is_empty() {
                        return Some(value);
                    }
                }
            }
            from = end;
        }
        None
    }

    fn attribute_value<'a>(tag: &'a str, tag_lower: &str, attr: &str) -> Option<&'a str> {
        let at = tag_lower.find(&format!("{attr}="))? + attr.len() + 1;
        let rest = &tag[at..];
        let quote = rest.chars().next()?;
        if quote != '"' && quote != '\'' {
            return None;
        }
        let close = rest[1..].find(quote)? + 1;
        Some(&rest[1..close])
    }

    for property in ["og:title", "twitter:title"] {
        if let Some(title) = meta_content(html, property).filter(|t| !is_url_like(t)) {
            return Some(title);
        }
    }
    let lower = html.to_lowercase();
    let start = lower.find("<title")?;
    let open_end = lower[start..].find('>')? + start + 1;
    let close = lower[open_end..].find("</title>")? + open_end;
    let title = decode_entities(html[open_end..close].trim());
    if title.is_empty() || is_url_like(&title) { None } else { Some(title) }
}

/// The handful of entities that actually show up in page titles.
fn decode_entities(raw: &str) -> String {
    raw.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .trim()
        .to_string()
}

/// Derive the note's filename stem from the title (preferred) or the URL
/// host. Readable, not slugified: spaces and capitals are valid in a
/// filename and make a shared note look like a hand-written one.
pub fn file_name_for(input: &CaptureInput) -> String {
    if let Some(title) = meaningful_title(input.title.as_deref()) {
        let s = sanitize_file_stem(&title);
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
    /// The readable article as HTML, ad/tracker images already filtered.
    ///
    /// This is the intermediate the markdown conversion consumes, kept rather
    /// than discarded so the "Article only" HTML capture (#612) renders from
    /// the SAME extraction. A second extraction would drift from this one and
    /// would have to re-apply #610's image filtering independently.
    pub html: String,
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
    // dom_smoothie returns the article wrapped in its own `<html>` element.
    // Fine as an intermediate for markdown conversion, but nesting an `<html>`
    // inside our template's `<body>` is invalid markup — unwrap it.
    let filtered_content = unwrap_readability_shell(&filtered_content);
    let markdown = htmd::convert(&filtered_content).ok()?;
    let markdown = markdown.trim();
    if markdown.chars().count() < MIN_ARTICLE_CHARS {
        return None;
    }
    // Readability's title is usually right, but it comes up empty on app
    // shells and video pages — fall back to the page's own metadata.
    let title = meaningful_title(Some(product.title.as_str()))
        .or_else(|| extract_meta_title(html));
    Some(Article { title, markdown: markdown.to_string(), html: filtered_content })
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



/// Strip dom_smoothie's `<html>` wrapper from extracted content.
///
/// The extractor returns `<html><div id="readability-page-1">…</div></html>`.
/// That is harmless on the way to markdown, but the "Article only" template
/// embeds this HTML inside its own `<body>`, and a nested `<html>` element is
/// invalid — browsers recover from it, but the document stops being one we can
/// claim is well-formed.
fn unwrap_readability_shell(html: &str) -> String {
    let trimmed = html.trim();
    let inner = trimmed
        .strip_prefix("<html>")
        .and_then(|rest| rest.strip_suffix("</html>"))
        .unwrap_or(trimmed);
    inner.trim().to_string()
}

/// Reader-view styling for the "Article only" capture (#612).
///
/// Embedded, not linked: a capture note is opened later, possibly offline, and
/// must not reach back out to the site it was clipped from. Deliberately not
/// the desktop's `render_html` export templates — those style Notesage's own
/// documents; this styles someone else's article.
const ARTICLE_HTML_STYLE: &str = "\
<style>\
:root{color-scheme:light dark}\
body{margin:0 auto;padding:2.5rem 1.25rem;max-width:38rem;\
font:1.0625rem/1.7 -apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;\
color:#1a1a1a;background:#fff;overflow-wrap:break-word}\
h1,h2,h3{line-height:1.25;margin:2rem 0 .75rem}\
h1{font-size:1.75rem;margin-top:0}\
p,li{margin:0 0 1rem}\
img{max-width:100%;height:auto;border-radius:6px;display:block;margin:1.5rem auto}\
figure{margin:1.5rem 0}figcaption{font-size:.875rem;color:#666;text-align:center}\
blockquote{margin:1.5rem 0;padding-left:1rem;border-left:3px solid #ddd;color:#444}\
pre{overflow-x:auto;padding:1rem;background:#f5f5f5;border-radius:6px}\
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9375em}\
a{color:#0a58ca}hr{border:0;border-top:1px solid #e5e5e5;margin:2rem 0}\
@media(prefers-color-scheme:dark){\
body{color:#e8e8e8;background:#1a1a1a}\
blockquote{border-left-color:#444;color:#bbb}\
pre{background:#252525}figcaption{color:#999}a{color:#6ea8fe}}\
</style>";

/// "Article only" capture (#612): the extracted article as a standalone,
/// self-contained HTML document — no site nav, ads or chrome.
///
/// Returns a complete `.html` DOCUMENT rather than a frontmatter capture note,
/// matching the sibling "Page (HTML)" format which also writes `.html`. A
/// YAML-frontmatter `.md` file whose body is a `<style>` block and raw markup
/// renders as neither one thing nor the other; the point of this format is
/// that it opens as a readable page.
///
/// The link-only note remains the universal fallback, so a share never fails.
pub fn build_article_html_document(article: &Article, title: Option<&str>, source_url: &str) -> String {
    let heading = title
        .or(article.title.as_deref())
        .map(|t| format!("<h1>{}</h1>", escape_html_text(t)))
        .unwrap_or_default();
    let doc_title = title
        .or(article.title.as_deref())
        .map(escape_html_text)
        .unwrap_or_else(|| "Article".to_string());
    format!(
        "<!doctype html>\n<html><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<title>{doc_title}</title>{ARTICLE_HTML_STYLE}</head><body>\
{heading}{body}\
<hr><p class=\"source\">Clipped from <a href=\"{src}\">{src}</a></p>\
</body></html>\n",
        body = article.html,
        src = escape_html_text(source_url),
    )
}

/// Minimal text escaping for the title we inject into the template. The
/// article body is already HTML from the extractor and is not re-escaped.
fn escape_html_text(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
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
    let effective_title = meaningful_title(input.title.as_deref()).or_else(|| article.title.clone());
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


    // ---- JS-rendered pages: the rendered-DOM tier (#611) ------------------
    //
    // The Swift side runs the chain (raw HTML -> rendered DOM -> link note);
    // these cover the premise it rests on — that extraction DECLINES on an SPA
    // shell and SUCCEEDS on the same page's settled DOM. Without both halves
    // holding, the render tier is either useless or never reached.

    /// What a network fetch returns for a JS-rendered page: an empty shell.
    fn spa_shell_html() -> &'static str {
        "<html><head><title>News</title></head><body>\
         <div id=\"root\"></div>\
         <script src=\"/bundle.js\"></script></body></html>"
    }

    /// The same page after the DOM has settled — the article now exists.
    fn spa_settled_html() -> String {
        let body = "<p>The article body that only appears once the bundle has \
run and painted, which is the entire reason a raw-HTML fetch cannot capture \
this page and a rendered DOM can. It carries on for long enough to clear the \
extractor's minimum length, as a real article would.</p>";
        format!(
            "<html><head><title>News</title></head><body><div id=\"root\">\
             <article><h1>Real Headline</h1>{body}{body}</article></div></body></html>"
        )
    }

    #[test]
    fn spa_shell_yields_no_article_so_the_render_tier_is_reached() {
        // If this ever returned Some, the rendered-DOM attempt would never run
        // and JS pages would silently keep capturing as empty shells.
        assert!(
            extract_article(spa_shell_html(), "https://news.example.com/story").is_none(),
            "an empty SPA shell must not pass as an article"
        );
    }

    #[test]
    fn settled_dom_yields_the_article_the_raw_fetch_missed() {
        let article = extract_article(&spa_settled_html(), "https://news.example.com/story")
            .expect("the settled DOM must yield an article");
        assert!(article.markdown.contains("only appears once the bundle has run"));
        // Both formats are fed from this same extraction.
        assert!(!article.html.is_empty());
    }

    #[test]
    fn a_render_that_returns_nothing_leaves_the_link_note_as_the_floor() {
        // The timeout path hands back whatever the DOM held — possibly still
        // the shell. Extraction declines again, and the caller falls through
        // to the link note rather than failing the share.
        assert!(extract_article("", "https://news.example.com/story").is_none());
        assert!(extract_article(spa_shell_html(), "https://news.example.com/story").is_none());
    }

    #[test]
    fn a_server_rendered_page_never_needs_the_render_tier() {
        // No regression for the ordinary case: extraction succeeds on the
        // fetched HTML, so no webview is ever constructed.
        let html = article_page_with_image();
        assert!(
            extract_article(&html, "https://example.com/post").is_some(),
            "server-rendered pages must still extract from raw HTML"
        );
    }

    // ---- Article-only HTML capture (#612) --------------------------------
    //
    // The extracted article wrapped in a self-contained readable template,
    // rather than the full page with its nav, ads and chrome. Reuses the SAME
    // extraction as the markdown format (#584/#610) — the readable HTML is
    // what `extract_article` already produces on its way to markdown, and was
    // simply being discarded.

    /// A page whose article carries a genuine content image.
    fn article_page_with_image() -> String {
        let body = "<p>Ett stycke som är långt nog att räknas som en artikel. \
Readability needs a real body before it will call this an article, so this \
paragraph is padded out with enough prose to clear the minimum character \
bar that filters navigation-only pages out of the capture pipeline. It keeps \
going for a while so the extractor has something substantial to work with, \
which is exactly what a real article would provide.</p>";
        format!(
            "<html><head><title>Real Article</title></head><body>\
             <nav>Home About Subscribe</nav>\
             <article><h1>Real Article</h1>{body}\
             <img src=\"https://example.com/photo.jpg\" alt=\"A photo\">\
             {body}</article>\
             <footer>Cookie notice</footer></body></html>"
        )
    }

    #[test]
    fn article_html_note_wraps_the_article_in_a_self_contained_document() {
        let html = article_page_with_image();
        let article = extract_article(&html, "https://example.com/post").expect("article");
        let doc = build_article_html_document(&article, Some("Real Article"), "https://example.com/post");

        // A real document, openable on its own.
        assert!(doc.starts_with("<!doctype html>"), "must be a standalone document");
        // Self-contained: styling travels with it, no external fetch.
        assert!(doc.contains("<style"), "template must embed its CSS");
        assert!(!doc.contains("<link"), "must not fetch a remote stylesheet when opened");
        // Provenance is preserved even without frontmatter.
        assert!(doc.contains("https://example.com/post"), "source link missing");
        assert!(doc.contains("Real Article"));
    }

    #[test]
    fn article_html_note_drops_site_chrome() {
        let html = article_page_with_image();
        let article = extract_article(&html, "https://example.com/post").expect("article");
        let doc = build_article_html_document(&article, None, "https://example.com/post");
        // The whole point of "article only": nav and footer are gone.
        assert!(!doc.contains("Subscribe"), "nav survived the clip");
        assert!(!doc.contains("Cookie notice"), "footer survived the clip");
    }

    #[test]
    fn article_html_note_keeps_genuine_images_and_drops_ad_images() {
        let body = "<p>A body long enough to clear the article bar, repeated so \
the extractor treats this as real prose rather than boilerplate, because the \
minimum character count exists precisely to reject nav-only pages.</p>";
        let html = format!(
            "<html><body><article><h1>T</h1>{body}\
             <img src=\"https://cdn.example.com/real-photo.jpg\">\
             <img src=\"https://doubleclick.net/pixel.gif\">\
             {body}</article></body></html>"
        );
        let article = extract_article(&html, "https://example.com/p").expect("article");
        let doc = build_article_html_document(&article, None, "https://example.com/p");
        assert!(doc.contains("real-photo.jpg"), "genuine image was dropped");
        assert!(
            !doc.contains("doubleclick"),
            "tracker image survived into the clipped article (#610)"
        );
    }

    #[test]
    fn article_html_note_handles_an_image_free_article() {
        let body = "<p>Plain prose with no images at all, long enough to be \
treated as a genuine article by the extractor rather than discarded as \
boilerplate, which is what the minimum length check is there to do. It runs \
on for several sentences so the extracted markdown comfortably clears the \
four-hundred-character bar that separates a real post from a navigation \
stub, since falling under it would make this a test of the threshold rather \
than of the template.</p>";
        let html = format!(
            "<html><body><article><h1>T</h1>{body}{body}{body}</article></body></html>"
        );
        let article = extract_article(&html, "https://example.com/p").expect("article");
        let doc = build_article_html_document(&article, None, "https://example.com/p");
        assert!(!doc.contains("<img"), "invented an image");
        assert!(doc.contains("<style"), "still a styled document");
    }


    #[test]
    fn article_html_document_is_not_nested_inside_a_second_html_element() {
        // The extractor wraps its output in `<html>`; embedding that inside
        // our template's `<body>` would nest one `<html>` in another. Browsers
        // recover, but the document stops being well-formed — and this format
        // exists to be opened directly.
        let html = article_page_with_image();
        let article = extract_article(&html, "https://example.com/post").expect("article");
        let doc = build_article_html_document(&article, Some("T"), "https://example.com/post");
        assert_eq!(doc.matches("<html").count(), 1, "more than one <html> element");
    }

    #[test]
    fn extraction_exposes_the_readable_html_alongside_the_markdown() {
        // The markdown format and the HTML format must come from ONE
        // extraction — two would drift, and the ad-filtering in #610 would
        // then have to be applied twice.
        let html = article_page_with_image();
        let article = extract_article(&html, "https://example.com/post").expect("article");
        assert!(!article.markdown.is_empty());
        assert!(!article.html.is_empty(), "readable HTML must be retained");
        assert!(!article.html.contains("Subscribe"), "nav leaked into the readable HTML");
    }

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

#[cfg(test)]
mod title_tests {
    use super::*;

    fn input(url: &str, title: Option<&str>) -> CaptureInput {
        CaptureInput {
            url: url.to_string(),
            title: title.map(str::to_string),
            selection_text: None,
            tags: vec![],
        }
    }

    #[test]
    fn a_url_shared_as_the_title_is_not_used_as_one() {
        // YouTube's share sheet puts the URL in attributedContentText; taken
        // literally it produced `https---youtube.com-watchv=…md`.
        assert!(is_url_like("https://youtu.be/3zk1WjrxCSw?is=VPJk"));
        assert!(is_url_like("www.youtube.com/watch?v=x"));
        assert!(is_url_like("youtu.be/3zk1WjrxCSw"));
        assert!(!is_url_like("A zseni, aki mindent hagyott"));
        // A title that merely mentions a domain is still a title.
        assert!(!is_url_like("What happened at example.com today"));
    }

    #[test]
    fn the_filename_falls_back_to_the_url_stem_rather_than_the_whole_url() {
        let name = file_name_for(&input(
            "https://youtu.be/3zk1WjrxCSw",
            Some("https://youtu.be/3zk1WjrxCSw"),
        ));
        assert!(!name.starts_with("https"), "{name}");
    }

    #[test]
    fn frontmatter_omits_a_url_masquerading_as_a_title() {
        let note = build_capture_note(
            &input("https://youtu.be/abc", Some("https://youtu.be/abc")),
            "2026-08-13T10:00:00Z",
        );
        assert!(!note.contents.contains("title: \"https://youtu.be/abc\""));
    }

    #[test]
    fn meta_title_prefers_og_then_twitter_then_title_tag() {
        let html = r#"<html><head><title>YouTube</title>
            <meta property="og:title" content="A zseni, aki mindent hagyott">
            </head><body></body></html>"#;
        assert_eq!(
            extract_meta_title(html).as_deref(),
            Some("A zseni, aki mindent hagyott")
        );

        let no_og = r#"<html><head><meta name='twitter:title' content='Second choice'>
            <title>Third choice</title></head></html>"#;
        assert_eq!(extract_meta_title(no_og).as_deref(), Some("Second choice"));

        let bare = "<html><head><title>Third choice</title></head></html>";
        assert_eq!(extract_meta_title(bare).as_deref(), Some("Third choice"));
    }

    #[test]
    fn meta_title_decodes_the_entities_real_pages_carry() {
        let html = r#"<head><meta property="og:title" content="Tom &amp; Jerry&#39;s &quot;best&quot;"></head>"#;
        assert_eq!(
            extract_meta_title(html).as_deref(),
            Some("Tom & Jerry's \"best\"")
        );
    }

    #[test]
    fn meta_title_declines_a_page_that_only_repeats_its_url() {
        let html = r#"<head><meta property="og:title" content="https://example.com/x"><title>https://example.com/x</title></head>"#;
        assert_eq!(extract_meta_title(html), None);
    }

    #[test]
    fn meta_title_survives_a_page_with_no_title_at_all() {
        assert_eq!(extract_meta_title("<html><body>hi</body></html>"), None);
        assert_eq!(extract_meta_title(""), None);
    }
}

#[cfg(test)]
mod video_tests {
    use super::*;

    fn input(url: &str, title: Option<&str>) -> CaptureInput {
        CaptureInput {
            url: url.to_string(),
            title: title.map(str::to_string),
            selection_text: None,
            tags: vec![],
        }
    }

    const YT_OEMBED: &str = r#"{"title":"A zseni, aki mindent hagyott",
        "author_name":"Csendes Kronikak","author_url":"https://www.youtube.com/@csendes",
        "provider_name":"YouTube","thumbnail_url":"https://i.ytimg.com/vi/3zk1WjrxCSw/hqdefault.jpg"}"#;

    #[test]
    fn recognises_the_video_hosts_we_support_and_no_others() {
        assert!(oembed_url("https://youtu.be/3zk1WjrxCSw").is_some());
        assert!(oembed_url("https://www.youtube.com/watch?v=x").is_some());
        assert!(oembed_url("https://m.youtube.com/watch?v=x").is_some());
        assert!(oembed_url("https://vimeo.com/12345").is_some());
        assert!(oembed_url("https://example.com/an-article").is_none());
        // A host that merely mentions youtube is not YouTube.
        assert!(oembed_url("https://notyoutube.com/watch?v=x").is_none());
    }

    #[test]
    fn the_shared_url_is_percent_encoded_into_the_endpoint() {
        let endpoint = oembed_url("https://youtu.be/abc?is=A_b-c").unwrap();
        assert!(endpoint.contains("url=https%3A%2F%2Fyoutu.be%2Fabc%3Fis%3DA_b-c"), "{endpoint}");
        assert!(endpoint.starts_with("https://www.youtube.com/oembed"));
    }

    #[test]
    fn parses_the_fields_a_note_uses() {
        let meta = parse_oembed(YT_OEMBED);
        assert_eq!(meta.title.as_deref(), Some("A zseni, aki mindent hagyott"));
        assert_eq!(meta.author.as_deref(), Some("Csendes Kronikak"));
        assert_eq!(meta.provider.as_deref(), Some("YouTube"));
        assert!(meta.thumbnail_url.unwrap().starts_with("https://i.ytimg.com/"));
    }

    #[test]
    fn parses_escapes_without_a_json_dependency() {
        let meta = parse_oembed(r#"{"title":"Quote \" and \u00e9 and newline \n end"}"#);
        let title = meta.title.unwrap();
        assert!(title.contains('"'), "{title}");
        assert!(title.contains('é'), "{title}");
    }

    #[test]
    fn a_missing_or_broken_payload_degrades_instead_of_failing() {
        assert_eq!(parse_oembed("not json at all"), VideoMeta::default());
        assert_eq!(parse_oembed(""), VideoMeta::default());
        // Present but empty values are treated as absent.
        assert_eq!(parse_oembed(r#"{"title":"","author_name":""}"#), VideoMeta::default());
    }

    #[test]
    fn the_note_leads_with_a_working_link_and_a_plain_poster() {
        let note = build_video_note(
            &input("https://youtu.be/3zk1WjrxCSw", Some("https://youtu.be/3zk1WjrxCSw")),
            &parse_oembed(YT_OEMBED),
            "2026-08-13T10:00:00Z",
        );
        // Named from the oEmbed title, not the URL the share sheet handed us.
        assert_eq!(note.rel_path, "Inbox/A zseni, aki mindent hagyott.md");
        assert!(note.contents.contains("capture_format: video"));
        assert!(note.contents.contains("author: \"Csendes Kronikak\""));
        assert!(note.contents.contains("[Watch on YouTube](https://youtu.be/3zk1WjrxCSw)"));
        assert!(note.contents.contains("![A zseni, aki mindent hagyott](https://i.ytimg.com/"));
        // The poster is a plain image — never a link that pretends to play.
        assert!(!note.contents.contains("[!["));
    }

    #[test]
    fn a_provider_that_returns_nothing_still_produces_a_usable_note() {
        let note = build_video_note(
            &input("https://youtu.be/abc", None),
            &VideoMeta::default(),
            "2026-08-13T10:00:00Z",
        );
        assert!(note.contents.contains("[Watch on source](https://youtu.be/abc)"));
        assert!(note.contents.contains("type: capture"));
        assert!(!note.contents.contains("!["));
    }

    #[test]
    fn a_title_the_user_actually_shared_beats_the_providers() {
        let note = build_video_note(
            &input("https://youtu.be/abc", Some("My own title")),
            &parse_oembed(YT_OEMBED),
            "2026-08-13T10:00:00Z",
        );
        assert_eq!(note.rel_path, "Inbox/My own title.md");
    }
}
