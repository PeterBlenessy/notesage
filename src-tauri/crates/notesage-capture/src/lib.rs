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

/// What a library list row shows for a saved article (#836): the pieces the
/// capture header already carries, read back out of it.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardMeta {
    pub title: Option<String>,
    /// The standfirst — the excerpt under the title.
    pub excerpt: Option<String>,
    /// Estimated reading time, from the "N min read" the header carries.
    pub minutes: Option<u32>,
    /// The publisher's name or host, as the byline shows it.
    pub site: Option<String>,
    /// The page the article was clipped from — what "Open original" opens.
    /// Always present: a document without a source footer is not a capture
    /// and yields no `CardMeta` at all.
    pub source_url: Option<String>,
}

/// Read a list row's fields back out of a capture's own header (#836).
///
/// This parses markup the crate itself wrote (`build_article_header`), so the
/// shapes are known: `<title>`, `<p class="standfirst">` and a
/// `<p class="byline">` whose parts are ` · `-joined — "By X · N min read ·
/// site". Returns `None` for a document that is not one of ours, which is the
/// caller's cue to show the plain file row.
pub fn article_card_meta(html: &str) -> Option<CardMeta> {
    let source_url = article_source_url(html)?;
    let title = tag_text(html, "<title>", "</title>");
    // The byline is emitted UNCONDITIONALLY by `build_article_header` (the
    // "N min read" part is always there), so it is a reliable boundary for the
    // header. The standfirst is only emitted when the page had one, and a body
    // can carry its own `<p class="standfirst">` (The Guardian literally does),
    // so it is searched only BEFORE the byline — never in the body.
    let byline_at = html.find("<p class=\"byline\">");
    let excerpt = byline_at.and_then(|at| tag_text(&html[..at], "<p class=\"standfirst\">", "</p>"));
    let byline = tag_text(html, "<p class=\"byline\">", "</p>");
    let mut minutes = None;
    let mut site = None;
    if let Some(byline) = byline.as_deref() {
        // Builder order is fixed: [By X]? · [date]? · "N min read" · [site]?
        // The site is the part AFTER the minutes, by position — not "the last
        // part that is not something else", which mislabels a date as the site
        // when the site is missing.
        let parts: Vec<&str> = byline.split(" · ").map(str::trim).collect();
        if let Some(i) = parts.iter().position(|p| p.ends_with(" min read")) {
            minutes = parts[i].trim_end_matches(" min read").trim().parse::<u32>().ok();
            site = parts.get(i + 1).filter(|s| !s.is_empty()).map(|s| s.to_string());
        }
    }
    Some(CardMeta { title, excerpt, minutes, site, source_url: Some(source_url) })
}

/// Text between the first `open` and the following `close`, entities decoded.
fn tag_text(html: &str, open: &str, close: &str) -> Option<String> {
    let start = html.find(open)? + open.len();
    let end = html[start..].find(close)? + start;
    let text = decode_entities(html[start..end].trim());
    (!text.is_empty()).then_some(text)
}

/// The document BEHIND an Office web-viewer URL, or `None` for anything else.
///
/// `view.officeapps.live.com/op/view.aspx?src=<url>` (and `embed.aspx`) is not a
/// document; it is a JavaScript viewer that fetches the file named in `src` and
/// renders it client-side. Both capture paths see only its loading shell —
/// "Vi hämtar din fil…" plus a spinner was saved as an article, with the
/// spinner as its thumbnail (#868). The page names the real document in its
/// own URL, so the capture should take that and store it as a file, exactly as
/// a shared PDF lands.
///
/// Only `http(s)` targets are returned: the viewer would refuse anything else
/// too, and a `javascript:` or `file:` value must never reach a download.
pub fn viewer_document_url(url: &str) -> Option<String> {
    let (scheme_host, rest) = url.trim().split_once("://")?;
    if !scheme_host.eq_ignore_ascii_case("https") && !scheme_host.eq_ignore_ascii_case("http") {
        return None;
    }
    let (host, path_and_query) = rest.split_once('/').unwrap_or((rest, ""));
    let host = host.trim_start_matches("www.").to_lowercase();
    if host != "view.officeapps.live.com" {
        return None;
    }
    let (path, query) = path_and_query.split_once('?')?;
    let path = path.to_lowercase();
    if path != "op/view.aspx" && path != "op/embed.aspx" {
        return None;
    }
    let src = query
        .split('&')
        .find_map(|pair| pair.strip_prefix("src="))
        .map(percent_decode)?;
    let lower = src.to_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://")).then_some(src)
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

/// A `<meta>` value by `property`/`name`, e.g. `og:image`.
///
/// Hoisted out of `extract_meta_title` so the metadata CARD (#839) reads the
/// same tags through the same scanner — two parsers for one page would drift.
pub(crate) fn meta_content(html: &str, property: &str) -> Option<String> {
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


pub fn extract_meta_title(html: &str) -> Option<String> {

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
/// Name for a shared document whose provider carries no name of its own.
///
/// A PDF handed over as in-memory data — Safari's viewer, an in-app browser —
/// has no `suggestedName`, and the temp file `loadFileRepresentation` writes
/// is called after the TYPE ("PDF-dokument.pdf"), which is what such a share
/// was stored as once the activation rule let it through (#843). The share
/// sheet itself names the item from the URL; this does the same, preferring
/// a real title when the host supplied one, and the host name when the URL
/// has no path to name from.
///
/// `extension` is the type's preferred extension without the dot; a stem
/// that already ends in it is used as is.
pub fn document_fallback_name(url: Option<&str>, title: Option<&str>, extension: &str) -> String {
    let ext = extension.trim().trim_start_matches('.');
    let with_ext = |stem: String| -> String {
        if ext.is_empty() || stem.to_lowercase().ends_with(&format!(".{}", ext.to_lowercase())) {
            stem
        } else {
            format!("{stem}.{ext}")
        }
    };
    if let Some(title) = title {
        let stem = sanitize_file_stem(title);
        if !stem.is_empty() {
            return with_ext(stem);
        }
    }
    if let Some(url) = url {
        let path = url.split(['?', '#']).next().unwrap_or("");
        let after_scheme = path.split_once("://").map_or(path, |(_, rest)| rest);
        let trimmed = after_scheme.trim_end_matches('/');
        if trimmed.contains('/') {
            let last = trimmed.rsplit('/').next().unwrap_or("");
            let stem = sanitize_file_stem(&percent_decode(last));
            if !stem.is_empty() {
                return with_ext(stem);
            }
        }
        let host = sanitize_file_stem(&url_host(url));
        if !host.is_empty() {
            return with_ext(host);
        }
    }
    with_ext("Shared document".to_string())
}

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
    /// Author line, when the page declares one.
    ///
    /// These four fields exist because readability picks ONE winning content
    /// node — the article body — and a blog's hero image, author and date
    /// almost always live in the page HEADER, outside it. So a capture kept
    /// the prose and silently dropped the masthead: no lead image, no byline,
    /// and a gallery thumbnail showing whichever inline screenshot happened to
    /// come first. The metadata was there the whole time; nothing read it.
    pub byline: Option<String>,
    /// Publication date as the page declares it (usually ISO-8601).
    pub published_time: Option<String>,
    /// The page's own lead image (`og:image`), which is what a reader expects
    /// to see at the top and what the gallery card should show.
    pub hero_image: Option<String>,
    /// Publication name, for the source line.
    pub site_name: Option<String>,
    /// The page's own one-line summary (`og:description`).
    ///
    /// Rendered as a standfirst ONLY when it is not simply the opening of the
    /// body — readability falls back to the first sentence when a page
    /// declares no description, and repeating that immediately above itself
    /// looks like a bug rather than a subtitle.
    pub subtitle: Option<String>,
}

impl Article {
    /// An article with no header metadata — the shape every caller used before
    /// the header existed. Keeps the enrichment paths and tests readable.
    pub fn new(title: Option<String>, markdown: String, html: String) -> Self {
        Self {
            title,
            markdown,
            html,
            byline: None,
            published_time: None,
            hero_image: None,
            site_name: None,
            subtitle: None,
        }
    }
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
    // Flatten BEFORE the ad filter: the filter judges an `<img>` by its src
    // and dimensions, and a picture's img is often a placeholder until the
    // best source has been promoted onto it. Judging it first would mean
    // judging the wrong URL.
    let flattened = flatten_picture_sources(&product.content);
    let filtered_content = strip_ad_and_tracker_images(&flattened);
    // dom_smoothie returns the article wrapped in its own `<html>` element.
    // Fine as an intermediate for markdown conversion, but nesting an `<html>`
    // inside our template's `<body>` is invalid markup — unwrap it.
    let filtered_content = unwrap_readability_shell(&filtered_content);
    let markdown = htmd::convert(&filtered_content).ok()?;
    let markdown = markdown.trim();
    if markdown.chars().count() < MIN_ARTICLE_CHARS {
        return None;
    }
    // A page that does not call itself an article, whose "article" is legal
    // boilerplate, is a hub page and has nothing to capture (#807).
    if !declares_itself_an_article(html) && is_boilerplate_body(markdown) {
        return None;
    }
    // Readability's title is usually right, but it comes up empty on app
    // shells and video pages — fall back to the page's own metadata.
    let title = meaningful_title(Some(product.title.as_str()))
        .or_else(|| extract_meta_title(html));
    Some(Article {
        title,
        markdown: markdown.to_string(),
        html: filtered_content,
        byline: non_empty(product.byline),
        published_time: non_empty(product.published_time),
        // Absolutised against the source: `og:image` is often a root-relative
        // path, and a relative src in a file opened from disk resolves to
        // nothing.
        hero_image: non_empty(product.image).map(|src| absolutise(&src, url)),
        site_name: non_empty(product.site_name),
        subtitle: non_empty(product.excerpt).filter(|x| !opens_the_body(x, markdown)),
    })
}

/// Does the page say, in machine-readable metadata, that it IS an article?
///
/// Open Graph `og:type` and schema.org JSON-LD are what Google, Facebook and
/// every reader mode consume, so this asks the publisher rather than guessing.
/// A UBS "insights" hub declares `og:type: website` with JSON-LD of
/// `BreadcrumbList`/`VideoObject`; the article pages that captured correctly
/// declare `og:type: article` with `NewsArticle` or `BlogPosting` (#807).
///
/// Used only to SUPPRESS the boilerplate check below — never to require the
/// declaration. Plenty of hand-rolled sites publish real articles with no
/// metadata at all, and rejecting those would be a worse bug than the one
/// this fixes.
fn declares_itself_an_article(html: &str) -> bool {
    let doc = dom_query::Document::from(html);

    // `og:type: article`, and the `article:*` properties that accompany it.
    for sel in ["meta[property='og:type']", "meta[name='og:type']"] {
        for node in doc.select(sel).iter() {
            if node.attr("content").unwrap_or_default().to_lowercase().contains("article") {
                return true;
            }
        }
    }
    if doc.select("meta[property='article:published_time']").iter().next().is_some() {
        return true;
    }

    // schema.org types, as quoted JSON tokens so `VideoObject` and a
    // breadcrumb naming the word "article" in prose cannot match.
    const ARTICLE_TYPES: &[&str] = &[
        "\"Article\"",
        "\"NewsArticle\"",
        "\"BlogPosting\"",
        "\"ScholarlyArticle\"",
        "\"TechArticle\"",
        "\"ReportageNewsArticle\"",
    ];
    for node in doc.select("script[type='application/ld+json']").iter() {
        let text = node.text();
        if ARTICLE_TYPES.iter().any(|t| text.contains(t)) {
            return true;
        }
    }
    false
}

/// Legal / administrative boilerplate phrases, matched case-insensitively.
///
/// Deliberately phrases rather than a length: the UBS capture that prompted
/// #807 was 629 characters, comfortably over `MIN_ARTICLE_CHARS`, so no
/// defensible character bar would have caught it without also rejecting
/// genuinely short posts.
const BOILERPLATE_MARKERS: &[&str] = &[
    "all rights reserved",
    "legal information",
    "strictly prohibited",
    "terms of use",
    "terms and conditions",
    "privacy policy",
    "cookie policy",
    "may not be available for residents",
    "unauthorized use",
    "without prior written permission",
];

/// Is `text` boilerplate ITSELF, rather than prose that merely ends with a
/// footer?
///
/// Two conditions, and the second is the one that matters (code review).
///
/// **Count.** Two distinct phrases, not one: a real article often ends with a
/// single "© 2026 Foo. All rights reserved." line that readability swept in.
///
/// **Position.** Counting alone was not safe. "Privacy policy", "terms of use"
/// and "all rights reserved" are the footer of most of the web, so an ordinary
/// article whose extraction kept a footer nav trips two or three markers
/// easily — and it does so worst for hand-rolled sites, which are also the
/// least likely to publish the `og:type` metadata that would suppress this
/// check. The gate would have been sharpest against exactly the pages it was
/// written to protect.
///
/// So position decides: a body that IS boilerplate opens with it (the UBS
/// capture began "Legal Information …"), while a real article carries it at
/// the end. The first marker must fall in the first half for the body to be
/// judged boilerplate. No length threshold — a short genuine post is still an
/// article, which was the whole objection to leaning on character counts.
fn is_boilerplate_body(text: &str) -> bool {
    let lower = text.to_lowercase();
    let hits: Vec<usize> = BOILERPLATE_MARKERS.iter().filter_map(|m| lower.find(m)).collect();
    if hits.len() < 2 {
        return false;
    }
    let first = hits.iter().copied().min().unwrap_or(0);
    // Guard against a zero-length body making this a division by zero.
    !lower.is_empty() && first * 2 < lower.len()
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
svg{max-width:100%;height:auto}\
svg:not([width]):not([height]){width:1.25em;height:1.25em;vertical-align:-.15em}\
figure{margin:1.5rem 0}figcaption{font-size:.875rem;color:#666;text-align:center}\
.standfirst{font-size:1.1875rem;line-height:1.5;color:#444;margin:0 0 1rem}\
.byline{font-size:.875rem;color:#666;margin:0 0 1.75rem}\
.endnote{font-size:.875rem;color:#666;text-align:center;margin:0 0 .5rem;line-height:1.5}\
.kind{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:#888;margin:0 0 .5rem}\
.note{font-size:.9375rem;color:#666;margin:1.5rem 0 0}\
.source{font-size:.875rem;text-align:center;margin:0}\
img.hero{margin:0 0 1.75rem;width:100%}\
blockquote{margin:1.5rem 0;padding-left:1rem;border-left:3px solid #ddd;color:#444}\
pre{overflow-x:auto;padding:1rem;background:#f5f5f5;border-radius:6px}\
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9375em}\
a{color:#3d6b9e}hr{border:0;border-top:1px solid #e5e5e5;margin:2.5rem 0}\
@media(prefers-color-scheme:dark){\
body{color:#e8e8e8;background:#1a1a1a}\
blockquote{border-left-color:#444;color:#bbb}\
.standfirst{color:#bbb}.byline{color:#999}.kind{color:#888}.note{color:#999}\
pre{background:#252525}figcaption{color:#999}a{color:#8fb3d9}\
.endnote{color:#999}}\
</style>";

/// The masthead: standfirst, byline, hero — and the attribution that closes
/// the article.
///
/// Extracted so the REPAIR path (`splice_article_header`) renders byte-identical
/// markup to a fresh capture. Two copies of this would drift, and the drift
/// would only show up in articles saved before a given release — the hardest
/// kind to notice.
///
/// `body_html` is what the hero is checked against: readability sometimes DOES
/// include the hero, and showing it twice is worse than not at all.
fn build_article_header(
    article: &Article,
    source_url: &str,
    body_html: &str,
) -> (String, String) {
    let subtitle = article
        .subtitle
        .as_deref()
        .map(|t| format!("<p class=\"standfirst\">{}</p>", escape_html_text(t)))
        .unwrap_or_default();

    // One muted line, in the order a reader scans it. Parts may be missing, so
    // the separators are JOINED rather than templated — a page with only a
    // date must not render " ·  · ".
    let mut meta: Vec<String> = Vec::new();
    if let Some(by) = article.byline.as_deref() {
        meta.push(format!("By {}", escape_html_text(by)));
    }
    if let Some(when) = article.published_time.as_deref() {
        meta.push(escape_html_text(&friendly_date(when)));
    }
    meta.push(format!("{} min read", reading_minutes(&article.markdown)));
    if let Some(site) = article.site_name.clone().or_else(|| host_of(source_url)) {
        meta.push(escape_html_text(&site));
    }
    let byline = format!("<p class=\"byline\">{}</p>", meta.join(" · "));

    // Two independent reasons to omit the hero, and the second is the one that
    // survives contact with real pages.
    //
    // URL identity catches the easy case. It is NOT enough: the same picture
    // routinely reaches us under two different URLs — an X post's syndication
    // cover and the status page's `og:image` are different variants of one
    // image — and by repair time the body's copy has been INLINED to a `data:`
    // URI that carries no URL at all. Both produced the same picture twice,
    // once above the other.
    //
    // So position decides as well: an article that already OPENS with a
    // picture has its lead, whatever that picture's URL happens to be. An
    // image deep in the text is illustration, not a lead, so it does not
    // suppress anything.
    let hero = article
        .hero_image
        .as_deref()
        .filter(|src| !body_html.contains(*src) && !leads_with_an_image(body_html))
        .map(|src| format!("<img class=\"hero\" src=\"{}\" alt=\"\">", escape_html_text(src)))
        .unwrap_or_default();

    // Repeated under the article, above the source link — the shape Instapaper
    // ends on. Reaching the bottom of a saved page and finding only a bare URL
    // reads as a clipping; the attribution is what makes it read as an article
    // that came from somewhere.
    let endnote = if meta.is_empty() {
        String::new()
    } else {
        format!("<p class=\"endnote\">{}</p>", meta.join(" · "))
    };

    (format!("{subtitle}{byline}{hero}"), endnote)
}

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
    let (header, endnote) = build_article_header(article, source_url, &article.html);

    format!(
        "<!doctype html>\n<html><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<title>{doc_title}</title>{ARTICLE_HTML_STYLE}</head><body>\
{heading}{header}{body}\
<hr>{endnote}<p class=\"source\">Clipped from <a href=\"{src}\">{src}</a></p>\
</body></html>\n",
        body = article.html,
        src = escape_html_text(source_url),
    )
}

/// Is `candidate` just the start of the body?
///
/// Readability falls back to the first sentence when a page declares no
/// description, so a standfirst would repeat the paragraph directly beneath
/// it. Compared on the first 60 characters, normalised, because the excerpt is
/// usually a truncation of that sentence rather than an exact copy.
fn opens_the_body(candidate: &str, markdown: &str) -> bool {
    let norm = |s: &str| -> String {
        s.chars().filter(|c| c.is_alphanumeric()).take(60).collect::<String>().to_lowercase()
    };
    let head = norm(candidate);
    !head.is_empty() && norm(markdown).starts_with(&head)
}

/// `Some` only for a value with visible content.
fn non_empty(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Resolve `src` against the page it came from.
///
/// `og:image` is very often root-relative (`/blog/x/hero.jpg`). A relative src
/// in a document opened from disk — Safari, Quick Look, the reader — resolves
/// against nothing and shows a broken image, so the hero has to be absolute
/// before it is written into the file.
fn absolutise(src: &str, page_url: &str) -> String {
    let t = src.trim();
    if t.starts_with("http://") || t.starts_with("https://") || t.starts_with("data:") {
        return t.to_string();
    }
    // Origin = scheme + host, i.e. everything before the third '/'.
    let origin: String = match t.starts_with('/') {
        true => page_url
            .match_indices('/')
            .nth(2)
            .map(|(i, _)| page_url[..i].to_string())
            .unwrap_or_else(|| page_url.trim_end_matches('/').to_string()),
        // A genuinely relative path resolves against the page's directory.
        false => page_url.rsplit_once('/').map(|(dir, _)| dir.to_string()).unwrap_or_default(),
    };
    format!("{}/{}", origin.trim_end_matches('/'), t.trim_start_matches('/'))
}

/// "Aug 30, 2026" from an ISO-8601 date, or the input unchanged when it is not
/// one. Hand-rolled rather than pulling in a date crate: this file links into
/// the Share Extension, where every dependency is weighed.
fn friendly_date(raw: &str) -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let head: String = raw.chars().take(10).collect();
    let parts: Vec<&str> = head.split('-').collect();
    if parts.len() != 3 {
        return raw.to_string();
    }
    match (parts[0].parse::<i32>(), parts[1].parse::<usize>(), parts[2].parse::<u32>()) {
        (Ok(y), Ok(m), Ok(d)) if (1..=12).contains(&m) => format!("{} {}, {}", MONTHS[m - 1], d, y),
        _ => raw.to_string(),
    }
}

/// Reading time at 200 words per minute, the convention every reader uses.
fn reading_minutes(markdown: &str) -> usize {
    (markdown.split_whitespace().count() / 200).max(1)
}

/// The `example.com` of a URL, for the source line.
fn host_of(url: &str) -> Option<String> {
    let after_scheme = url.split("://").nth(1)?;
    let host = after_scheme.split('/').next()?;
    let host = host.trim_start_matches("www.");
    (!host.is_empty()).then(|| host.to_string())
}

/// The page a saved article was clipped from, read back out of the file.
///
/// The footer is the only place the source survives — captures carry no
/// frontmatter — and it is what makes a repair possible at all: without it
/// there is nothing to go back to.
pub fn article_source_url(saved: &str) -> Option<String> {
    let marker = "class=\"source\">Clipped from <a href=\"";
    let start = saved.find(marker)? + marker.len();
    let rest = &saved[start..];
    let end = rest.find('"')?;
    let url = rest[..end].replace("&amp;", "&");
    (url.starts_with("http://") || url.starts_with("https://")).then_some(url)
}

/// Add the masthead to an article that was saved before captures kept one
/// (#829), leaving its body untouched.
///
/// Returns `None` — meaning "change nothing" — in every ambiguous case:
///
/// * not one of our captures (no source footer),
/// * already has a header, so a second one would duplicate it,
/// * the refetched page no longer yields an article, which is what a
///   bot-block, a paywall or a deleted page looks like.
///
/// **The saved body is never replaced.** That is the whole design. A refetch
/// can legitimately come back worse — `openclaw.ai` extracts fine, but
/// `ubs.com` answers a server-side fetch with Akamai *Access Denied* (#807),
/// and articles captured from the share sheet's RENDERED DOM cannot be
/// reproduced by a fetch at all. Splicing only the header means the worst case
/// is "nothing changed", never "a good article was overwritten with a worse
/// one" — which is the failure this area keeps producing.
///
/// The stylesheet IS replaced, because a document saved before the header
/// existed has no rules for `.standfirst` / `.byline` / `.hero` / `.endnote`
/// and would render the new markup unstyled.
pub fn splice_article_header(saved: &str, page_html: &str, source_url: &str) -> Option<String> {
    if !saved.contains("class=\"source\">Clipped from") {
        return None; // Not ours — do not touch somebody else's file.
    }
    if saved.contains("class=\"byline\"") {
        return None; // Already has a masthead.
    }
    let article = extract_article(page_html, source_url)?;

    // Suppress the hero when the article ALREADY LEADS WITH AN IMAGE.
    //
    // `build_article_header`'s own guard compares the hero's URL against the
    // body, which is right for a fresh capture and wrong here: by repair time
    // the original image has usually been INLINED as a `data:` URI, so
    // comparing it with a remote `og:image` URL never matches and a second
    // copy is spliced above the first. X captures hit this every time — their
    // cover is inlined at the top of the body — and the result was the same
    // picture twice, which is what Peter saw.
    //
    // Position, not identity, is what can be judged here: the bytes no longer
    // carry the URL they came from, so "does this article already open with a
    // picture?" is the answerable question, and it is also the one that
    // matters. A text-only article still gains its hero.
    // `build_article_header` judges the hero against this document, by URL and
    // by position — the saved body's copy is usually an inlined `data:` URI by
    // now, so position is what catches it.
    let (header, endnote) = build_article_header(&article, source_url, saved);
    if header.is_empty() && endnote.is_empty() {
        return None;
    }

    // After the title when there is one, so the masthead reads in the right
    // order; otherwise at the top of the body.
    let mut out = match saved.find("</h1>") {
        Some(i) => {
            let at = i + "</h1>".len();
            format!("{}{header}{}", &saved[..at], &saved[at..])
        }
        None => match saved.find("<body>") {
            Some(i) => {
                let at = i + "<body>".len();
                format!("{}{header}{}", &saved[..at], &saved[at..])
            }
            None => return None,
        },
    };

    // The attribution goes above the source line, matching a fresh capture.
    if let Some(i) = out.find("<p class=\"source\">") {
        out = format!("{}{endnote}{}", &out[..i], &out[i..]);
    }

    // Bring the stylesheet up to date, or the spliced markup renders unstyled.
    if let (Some(a), Some(b)) = (out.find("<style>"), out.find("</style>")) {
        out = format!("{}{}{}", &out[..a], ARTICLE_HTML_STYLE, &out[b + "</style>".len()..]);
    }
    Some(out)
}

/// What a page tells the world about itself, when it will not give us an
/// article (#839).
#[derive(Debug, Clone, PartialEq)]
pub struct PageCard {
    pub title: String,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
}

/// Read a page's own preview metadata.
///
/// The rung between "an article" and "a bare link". A page with no extractable
/// article — a topic hub, a video index, a gated page — still usually declares
/// a title, a summary and a lead image, and those are exactly what the share
/// sheet shows before the user taps Save. Saving a bare URL while holding all
/// three is a worse outcome than the user can see we were capable of.
///
/// No network of its own. The caller already has HTML — fetched, or rendered by
/// `PageRenderer` when a fetch was blocked, which is how `ubs.com` (Akamai
/// answers a server-side fetch with 509 bytes) still reaches us with its `og:`
/// tags intact.
///
/// `None` when the page declares no title at all: that is the genuine last
/// resort, and it belongs to the link note.
pub fn extract_page_card(html: &str, url: &str) -> Option<PageCard> {
    let title = meta_content(html, "og:title")
        .or_else(|| meta_content(html, "twitter:title"))
        .or_else(|| extract_meta_title(html))
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())?;

    Some(PageCard {
        description: meta_content(html, "og:description")
            .or_else(|| meta_content(html, "twitter:description"))
            .or_else(|| meta_content(html, "description"))
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty()),
        image: meta_content(html, "og:image")
            .or_else(|| meta_content(html, "twitter:image"))
            .map(|src| absolutise(&src, url))
            .filter(|src| is_remote_http_url(src)),
        site_name: meta_content(html, "og:site_name")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| host_of(url)),
        title,
    })
}

/// A saved LINK with its preview — not an article, and it must not pretend to
/// be one (#839).
///
/// The honesty matters as much as the picture. #807 was a capture that looked
/// like the article and was not; a card that rendered like an article would
/// repeat that mistake with better art. So it says what it is, and points at
/// the original.
///
/// Written in the format the user PICKED. They chose "Article (HTML)"; handing
/// back a `.md` because extraction happened to decline would be the app
/// second-guessing them.
pub fn build_card_html_document(card: &PageCard, source_url: &str) -> String {
    let image = card
        .image
        .as_deref()
        .map(|src| format!("<img class=\"hero\" src=\"{}\" alt=\"\">", escape_html_text(src)))
        .unwrap_or_default();
    let description = card
        .description
        .as_deref()
        .map(|d| format!("<p class=\"standfirst\">{}</p>", escape_html_text(d)))
        .unwrap_or_default();
    let site = card
        .site_name
        .clone()
        .or_else(|| host_of(source_url))
        .map(|s| escape_html_text(&s))
        .unwrap_or_default();

    format!(
        "<!doctype html>\n<html><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<title>{title}</title>{ARTICLE_HTML_STYLE}</head><body>\
<p class=\"kind\">Saved link</p>\
<h1>{title}</h1>{description}<p class=\"byline\">{site}</p>{image}\
<p class=\"note\">This page had no article we could save, so this is its \
preview. Open the original to read it.</p>\
<hr><p class=\"source\">Clipped from <a href=\"{src}\">{src}</a></p>\
</body></html>\n",
        title = escape_html_text(&card.title),
        src = escape_html_text(source_url),
    )
}

/// Does this saved article already open with a picture?
///
/// Looks only at the START of the body — an image deep inside the text is
/// illustration, not a lead, and an article like that should still gain its
/// hero. The window is generous enough to clear a title and a paragraph of
/// prose, and small enough that a mid-article figure does not count.
fn leads_with_an_image(html: &str) -> bool {
    let body = html.split_once("<body>").map(|(_, b)| b).unwrap_or(html);
    let Some(img) = body.find("<img") else { return false };
    // Before the first paragraph ENDS. Not a byte window: an inlined image is
    // hundreds of kilobytes of base64, so any fixed distance is meaningless
    // once the sweep has run. "Comes before the prose" is the real question and
    // it reads the same whether the image is a URL or a data URI.
    match body.find("</p>") {
        Some(para) => img < para,
        None => true,
    }
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
    fn document_fallback_name_prefers_title_then_url_then_host() {
        // The UBS report (#843): no title, an opaque last segment, a query.
        assert_eq!(
            document_fallback_name(
                Some("https://secure.ubs.com/public/api/v2/investment-content/documents/kFcVnC0GHB_ZVnO5mxL0dg?apikey=abc"),
                None,
                "pdf"
            ),
            "kFcVnC0GHB_ZVnO5mxL0dg.pdf"
        );
        assert_eq!(
            document_fallback_name(Some("https://example.com/files/Report%202025.pdf"), None, "pdf"),
            "Report 2025.pdf"
        );
        assert_eq!(
            document_fallback_name(Some("https://e.com/x/report.PDF"), None, "pdf"),
            "report.PDF"
        );
        assert_eq!(
            document_fallback_name(Some("https://example.com/a"), Some("Artificial intelligence"), "pdf"),
            "Artificial intelligence.pdf"
        );
        assert_eq!(
            document_fallback_name(Some("https://example.com/"), None, "pdf"),
            "example.com.pdf"
        );
        assert_eq!(document_fallback_name(Some("https://example.com"), Some("  "), "pdf"), "example.com.pdf");
        assert_eq!(document_fallback_name(None, None, "pdf"), "Shared document.pdf");
        assert_eq!(document_fallback_name(None, None, ""), "Shared document");
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
    }

    #[test]
    fn article_card_meta_reads_the_header_back() {
        let html = r#"<!doctype html><html><head><title>Fences, not Sandboxes</title></head>
<body><header><h1>Fences, not Sandboxes</h1><p class="standfirst">Why the walls we build for agents matter.</p>
<p class="byline">By Steve Yegge · 7 min read · steve-yegge.medium.com</p></header>
<p>Body.</p><footer><p class="source">Clipped from <a href="https://steve-yegge.medium.com/x">https://steve-yegge.medium.com/x</a></p></footer></body></html>"#;
        let meta = article_card_meta(html).expect("a capture");
        assert_eq!(meta.title.as_deref(), Some("Fences, not Sandboxes"));
        assert_eq!(meta.excerpt.as_deref(), Some("Why the walls we build for agents matter."));
        assert_eq!(meta.minutes, Some(7));
        assert_eq!(meta.site.as_deref(), Some("steve-yegge.medium.com"));
        // The desktop Inbox's "Open original" — the footer's URL, decoded.
        assert_eq!(meta.source_url.as_deref(), Some("https://steve-yegge.medium.com/x"));
    }

    #[test]
    fn article_card_meta_tolerates_a_header_without_byline_or_standfirst() {
        let html = r#"<html><head><title>T &amp; U</title></head><body><p class="byline">3 min read · x.com</p>
<footer><p class="source">Clipped from <a href="https://x.com/a/status/1">https://x.com/a/status/1</a></p></footer></body></html>"#;
        let meta = article_card_meta(html).unwrap();
        assert_eq!(meta.title.as_deref(), Some("T & U"));
        assert_eq!(meta.excerpt, None);
        assert_eq!(meta.minutes, Some(3));
        assert_eq!(meta.site.as_deref(), Some("x.com"));
    }

    #[test]
    fn article_card_meta_never_takes_a_standfirst_from_the_body() {
        // No standfirst in the header, but the body (a Guardian-style page)
        // carries its own `<p class="standfirst">`. That must not become the
        // row's excerpt.
        let html = r#"<html><head><title>T</title></head><body>
<p class="byline">By A · 5 min read · theguardian.com</p>
<article><p class="standfirst">Body deck, not ours.</p><p>Text.</p></article>
<footer><p class="source">Clipped from <a href="https://theguardian.com/x">https://theguardian.com/x</a></p></footer></body></html>"#;
        let meta = article_card_meta(html).unwrap();
        assert_eq!(meta.excerpt, None);
        assert_eq!(meta.site.as_deref(), Some("theguardian.com"));
    }

    #[test]
    fn article_card_meta_does_not_mistake_a_date_for_the_site() {
        // Date present, site absent: the old "last other part" rule would have
        // labelled the date as the site.
        let html = r#"<html><head><title>T</title></head><body>
<p class="byline">By A · 12 March 2026 · 6 min read</p>
<footer><p class="source">Clipped from <a href="https://example.com/x">https://example.com/x</a></p></footer></body></html>"#;
        let meta = article_card_meta(html).unwrap();
        assert_eq!(meta.minutes, Some(6));
        assert_eq!(meta.site, None);
        // And with both present, the site is the part after the minutes.
        let html2 = html.replace("6 min read</p>", "6 min read · example.com</p>");
        assert_eq!(article_card_meta(&html2).unwrap().site.as_deref(), Some("example.com"));
    }

    #[test]
    fn article_card_meta_is_none_for_a_document_that_is_not_ours() {
        assert!(article_card_meta("<html><head><title>Report</title></head><body>hi</body></html>").is_none());
    }

    #[test]
    fn viewer_document_url_unwraps_the_office_viewer() {
        // Peter's report (#868): the viewer's loading shell was saved as an
        // article. The real .pptx is named in `src`.
        let u = "https://view.officeapps.live.com/op/view.aspx?src=https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/FY27ExternalKPIs.pptx";
        assert_eq!(
            viewer_document_url(u).as_deref(),
            Some("https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/FY27ExternalKPIs.pptx")
        );
        // Percent-encoded src, embed.aspx, mixed case, extra params.
        assert_eq!(
            viewer_document_url("https://VIEW.officeapps.live.com/op/Embed.aspx?wdAr=1.77&src=https%3A%2F%2Fexample.com%2Fdeck%20one.pptx").as_deref(),
            Some("https://example.com/deck one.pptx")
        );
    }

    #[test]
    fn viewer_document_url_is_none_for_everything_else() {
        assert!(viewer_document_url("https://example.com/op/view.aspx?src=https://x.com/a.pdf").is_none());
        assert!(viewer_document_url("https://view.officeapps.live.com/op/other.aspx?src=https://x.com/a.pdf").is_none());
        assert!(viewer_document_url("https://view.officeapps.live.com/op/view.aspx").is_none());
        assert!(viewer_document_url("https://view.officeapps.live.com/op/view.aspx?other=1").is_none());
        // A non-http target must never reach a download.
        assert!(viewer_document_url("https://view.officeapps.live.com/op/view.aspx?src=javascript:alert(1)").is_none());
        assert!(viewer_document_url("https://view.officeapps.live.com/op/view.aspx?src=file:///etc/passwd").is_none());
        assert!(viewer_document_url("ftp://view.officeapps.live.com/op/view.aspx?src=https://x.com/a").is_none());
        assert!(viewer_document_url("https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/FY27ExternalKPIs.pptx").is_none());
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

// ============================================================================
// Inlining images so a saved article is actually saved
// ============================================================================
//
// A captured article keeps its images as remote `https://` URLs, which means
// the file is not the article — it is a recipe for fetching it, good only
// while the network is up and the CDN still serves those exact paths. See
// `docs/prds/2026-08-21-self-contained-articles.md`.
//
// The two functions below are the pure half of the fix, deliberately split
// from the fetching. Swift owns the network and the downsampling (ImageIO can
// shrink a 4000px photo without ever fully decoding it, which no Rust image
// crate matches on iOS); this crate owns *which* images and *what the
// rewritten document looks like* — the parts worth testing without a network
// or a device.

/// Remote image URLs in an article, in document order, deduplicated.
///
/// Document order is not incidental: readability puts the lead image first,
/// so a partial inline — the network died, a budget ran out — keeps the
/// images that matter most, including the one a thumbnail will show.
///
/// Skips `data:` URIs (already inline, fetching them would be absurd) and
/// relative paths (nothing to fetch them *from* — a captured article's URLs
/// were absolutised by the extractor, so a relative src here is malformed
/// rather than resolvable).
pub fn article_image_urls(html: &str) -> Vec<String> {
    let doc = dom_query::Document::fragment(html);
    let mut seen = std::collections::HashSet::new();
    let mut urls = Vec::new();
    for node in doc.select("img").iter() {
        let src = node.attr("src").unwrap_or_default().to_string();
        if !is_remote_http_url(&src) {
            continue;
        }
        // Dedup so a logo repeated in header and footer is fetched once and
        // stored once, rather than paying for it per occurrence.
        if seen.insert(src.clone()) {
            urls.push(src);
        }
    }
    urls
}

fn is_remote_http_url(src: &str) -> bool {
    let lower = src.trim().to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// Rewrite `<img src>` from a url→data-URI map.
///
/// Unmapped images keep their remote URL rather than being dropped. That is
/// the whole degradation story: an image that was too large, timed out, or
/// 404'd leaves the document exactly as it is today, so every partial result
/// is still a working article and a later sweep can finish the job.
///
/// `srcset` is REMOVED on any image we inlined. Leaving it would let the
/// browser prefer a remote candidate over the inlined `src` and quietly
/// reintroduce the network dependency this exists to remove — the document
/// would look self-contained and not be.
///
/// Parsed as a DOCUMENT, not a fragment (#805). `Document::fragment` sets
/// html5ever's `drop_doctype`, so re-serializing a captured article through it
/// returned the same markup minus its `<!doctype html>` and its `<head>`/
/// `<body>` tags — and a doctype-less file renders in QUIRKS mode, which
/// changes layout and makes WebKit's text-size adjustment more eager. The
/// input here is always a whole `.html` file read off disk, so document mode
/// is also the honest description of it.
pub fn inline_article_images(html: &str, map: &[(String, String)]) -> String {
    if map.is_empty() {
        return html.to_string();
    }
    let lookup: std::collections::HashMap<&str, &str> =
        map.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();

    let doc = dom_query::Document::from(html);
    for node in doc.select("img").iter() {
        let src = node.attr("src").unwrap_or_default().to_string();
        if let Some(data_uri) = lookup.get(src.as_str()) {
            node.set_attr("src", data_uri);
            node.remove_attr("srcset");
        }
    }
    doc.html().to_string()
}

/// Label prefix for the reference definitions this module writes. Namespaced
/// so it cannot collide with a label the user (or the source article) already
/// uses — `[img1]` is plausible in someone's own notes; `[ns-img-1]` is not.
const MD_IMAGE_LABEL_PREFIX: &str = "ns-img-";

/// Remote `http(s)` image URLs in a markdown document, in document order,
/// deduplicated.
///
/// The markdown counterpart of `article_image_urls`. Deliberately NOT a
/// markdown parse: `notesage-capture` links into the Share Extension, where
/// every dependency costs memory against a hard cap, and pulling a full
/// CommonMark parser in to find `![](…)` would be the most expensive way to
/// answer the question. The scan understands exactly three things — image
/// syntax, fenced code, and inline code — which is the whole surface where an
/// image URL can hide in our own captures.
pub fn markdown_image_urls(md: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut urls = Vec::new();
    for (_, url) in scan_markdown_images(md) {
        if is_remote_http_url(&url) && seen.insert(url.clone()) {
            urls.push(url);
        }
    }
    urls
}

/// Rewrite inline image URLs to reference-style links whose definitions carry
/// the data URIs, collected at the end of the document.
///
/// Why reference-style rather than inlining the data URI where the image sits
/// (which is what the HTML path does): a 300 KB base64 blob dropped in the
/// middle of a paragraph destroys the thing markdown is for. Someone who chose
/// "Article (Markdown)" over "Article (HTML)" chose a file they can open in any
/// editor and read. So the body keeps `![alt][ns-img-1]` and the payload is
/// quarantined in a block at the bottom, past everything worth reading.
///
/// The file stays a single portable artifact — no sidecar folder that move,
/// rename and delete would each have to carry, on two platforms, forever
/// (issue #755).
///
/// Images absent from `map` keep their remote URL: a partially-swept article
/// is a working article, and the next sweep picks up the rest.
pub fn inline_markdown_images(md: &str, map: &[(String, String)]) -> String {
    if map.is_empty() {
        return md.to_string();
    }
    let lookup: std::collections::HashMap<&str, &str> =
        map.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();

    // Assign labels in document order, so the definition block reads in the
    // same order as the article — and so a diff between two sweeps of the same
    // document is stable rather than reshuffled.
    let mut labels: Vec<(String, String)> = Vec::new(); // (url, label)
    let mut assigned = std::collections::HashMap::new();
    for (_, url) in scan_markdown_images(md) {
        if !lookup.contains_key(url.as_str()) || assigned.contains_key(&url) {
            continue;
        }
        let label = format!("{}{}", MD_IMAGE_LABEL_PREFIX, labels.len() + 1);
        assigned.insert(url.clone(), label.clone());
        labels.push((url, label));
    }
    if labels.is_empty() {
        return md.to_string();
    }

    // Rewrite by exact span rather than by pattern. `scan_markdown_images`
    // hands back the byte range of the `(url)` destination it found, so we
    // replace only spans the scanner itself identified as an image
    // destination — never an incidental occurrence of the same URL in prose.
    let mut out = String::with_capacity(md.len());
    let mut cursor = 0usize;
    for (span, url) in scan_markdown_images(md) {
        let Some(label) = assigned.get(&url) else { continue };
        out.push_str(&md[cursor..span.start]);
        out.push_str(&format!("[{label}]"));
        cursor = span.end;
    }
    out.push_str(&md[cursor..]);

    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push('\n');
    for (url, label) in &labels {
        let data_uri = lookup[url.as_str()];
        out.push_str(&format!("[{label}]: {data_uri}\n"));
    }
    out
}

/// Byte range of each image destination — the `(…)` including its
/// parentheses — paired with the URL inside it.
///
/// Skips fenced code blocks and inline code, where `![x](http://y)` is text
/// about markdown rather than markdown. Reference-style images (`![x][label]`)
/// are skipped too: the only ones that exist in our captures are the ones this
/// module wrote, and theirs are already data URIs.
fn scan_markdown_images(md: &str) -> Vec<(std::ops::Range<usize>, String)> {
    let bytes = md.as_bytes();
    let mut found = Vec::new();
    let mut i = 0usize;
    let mut in_fence = false;

    while i < bytes.len() {
        // Fenced code: toggle on a line starting with ``` or ~~~.
        if i == 0 || bytes[i - 1] == b'\n' {
            let rest = &md[i..];
            if rest.starts_with("```") || rest.starts_with("~~~") {
                in_fence = !in_fence;
                i += match md[i..].find('\n') {
                    Some(nl) => nl + 1,
                    None => break,
                };
                continue;
            }
        }
        if in_fence {
            i += 1;
            continue;
        }
        // Inline code: skip to the closing backtick run of equal length.
        if bytes[i] == b'`' {
            let tick_len = bytes[i..].iter().take_while(|&&b| b == b'`').count();
            let close = md[i + tick_len..].find(&"`".repeat(tick_len));
            i = match close {
                Some(rel) => i + tick_len + rel + tick_len,
                None => i + tick_len,
            };
            continue;
        }
        // Image: `![` … `](` … `)`. An escaped `\![` is not an image.
        if bytes[i] == b'!' && i + 1 < bytes.len() && bytes[i + 1] == b'[' && (i == 0 || bytes[i - 1] != b'\\') {
            if let Some(close_rel) = md[i + 2..].find("](") {
                let dest_start = i + 2 + close_rel + 1; // at '('
                if let Some(end_rel) = md[dest_start..].find(')') {
                    let dest_end = dest_start + end_rel + 1; // past ')'
                    let inner = md[dest_start + 1..dest_end - 1].trim();
                    // `![alt](url "title")` — the destination is up to the
                    // first whitespace; a title would otherwise be swallowed
                    // into the URL and never match the fetch map.
                    let url = inner.split_whitespace().next().unwrap_or("").to_string();
                    if !url.is_empty() {
                        found.push((dest_start..dest_end, url));
                    }
                    i = dest_end;
                    continue;
                }
            }
        }
        i += 1;
    }
    found
}

#[cfg(test)]
mod markdown_inline_image_tests {
    use super::*;

    fn map(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect()
    }

    #[test]
    fn collects_remote_images_in_document_order() {
        let md = "![one](https://a.example/1.jpg)\n\ntext\n\n![two](https://b.example/2.jpg)";
        assert_eq!(
            markdown_image_urls(md),
            vec!["https://a.example/1.jpg", "https://b.example/2.jpg"],
        );
    }

    #[test]
    fn deduplicates_a_repeated_image() {
        let md = "![l](https://a.example/logo.png)\n![l](https://a.example/logo.png)";
        assert_eq!(markdown_image_urls(md).len(), 1);
    }

    #[test]
    fn skips_relative_and_already_inlined_images() {
        let md = "![a](./local.png)\n![b](data:image/png;base64,iVBORw0KGgo=)";
        assert!(markdown_image_urls(md).is_empty());
    }

    #[test]
    fn ignores_images_inside_fenced_code() {
        // A tutorial about markdown must not have its example fetched.
        let md = "```\n![x](https://a.example/1.jpg)\n```\n\n![real](https://b.example/2.jpg)";
        assert_eq!(markdown_image_urls(md), vec!["https://b.example/2.jpg"]);
    }

    #[test]
    fn ignores_images_inside_inline_code() {
        let md = "Use `![x](https://a.example/1.jpg)` like so.";
        assert!(markdown_image_urls(md).is_empty());
    }

    #[test]
    fn strips_a_title_from_the_destination() {
        let md = r#"![a](https://a.example/1.jpg "A title")"#;
        assert_eq!(markdown_image_urls(md), vec!["https://a.example/1.jpg"]);
    }

    #[test]
    fn rewrites_to_reference_style_and_appends_definitions() {
        let md = "# T\n\nProse.\n\n![Bread](https://a.example/1.jpg)\n\nMore.\n";
        let out = inline_markdown_images(&md, &map(&[("https://a.example/1.jpg", "data:image/jpeg;base64,AAAA")]));

        // The body stays readable — that is the entire point of the format.
        assert!(out.contains("![Bread][ns-img-1]"), "body not reference-style: {out}");
        assert!(!out.contains("data:image/jpeg;base64,AAAA\n\nMore."), "payload landed mid-body");
        // …and the payload sits at the end.
        assert!(out.trim_end().ends_with("[ns-img-1]: data:image/jpeg;base64,AAAA"), "definition missing: {out}");
        // Prose is untouched.
        assert!(out.contains("Prose.") && out.contains("More."));
    }

    #[test]
    fn leaves_unmapped_images_remote() {
        // A partially-swept article is a working article; the next sweep
        // finishes the job.
        let md = "![a](https://a.example/1.jpg)\n![b](https://b.example/2.jpg)";
        let out = inline_markdown_images(md, &map(&[("https://a.example/1.jpg", "data:image/jpeg;base64,AAAA")]));
        assert!(out.contains("![a][ns-img-1]"));
        assert!(out.contains("![b](https://b.example/2.jpg)"), "unmapped image was disturbed: {out}");
    }

    #[test]
    fn is_idempotent() {
        // The sweep can revisit a document; a second pass must not re-wrap an
        // already-converted image or duplicate its definition.
        let md = "![a](https://a.example/1.jpg)\n";
        let m = map(&[("https://a.example/1.jpg", "data:image/jpeg;base64,AAAA")]);
        let once = inline_markdown_images(md, &m);
        let twice = inline_markdown_images(&once, &m);
        assert_eq!(once, twice);
        assert_eq!(once.matches("ns-img-1]:").count(), 1);
        // And the converted document offers nothing further to fetch.
        assert!(markdown_image_urls(&once).is_empty());
    }

    #[test]
    fn numbers_labels_in_document_order() {
        let md = "![a](https://a.example/1.jpg)\n![b](https://b.example/2.jpg)";
        let out = inline_markdown_images(
            md,
            &map(&[
                // Deliberately reversed: order must come from the DOCUMENT,
                // not from the fetch map, or a sweep would reshuffle labels.
                ("https://b.example/2.jpg", "data:image/jpeg;base64,BBBB"),
                ("https://a.example/1.jpg", "data:image/jpeg;base64,AAAA"),
            ]),
        );
        assert!(out.contains("![a][ns-img-1]"), "{out}");
        assert!(out.contains("![b][ns-img-2]"), "{out}");
    }

    #[test]
    fn does_not_touch_a_url_that_also_appears_as_prose() {
        // The same URL as a plain link must survive: only spans the scanner
        // identified as an image destination are rewritten.
        let md = "See <https://a.example/1.jpg> and ![a](https://a.example/1.jpg)";
        let out = inline_markdown_images(md, &map(&[("https://a.example/1.jpg", "data:image/jpeg;base64,AAAA")]));
        assert!(out.contains("<https://a.example/1.jpg>"), "prose link was rewritten: {out}");
        assert!(out.contains("![a][ns-img-1]"), "{out}");
    }

    #[test]
    fn empty_map_is_a_no_op() {
        let md = "![a](https://a.example/1.jpg)\n";
        assert_eq!(inline_markdown_images(md, &[]), md);
    }
}

#[cfg(test)]
mod inline_image_tests {
    use super::*;

    #[test]
    fn collects_remote_images_in_document_order() {
        let html = r#"<p><img src="https://a.example/1.jpg"></p>
                      <p><img src="https://b.example/2.jpg"></p>"#;
        assert_eq!(
            article_image_urls(html),
            vec!["https://a.example/1.jpg", "https://b.example/2.jpg"],
        );
    }

    #[test]
    fn deduplicates_a_repeated_image() {
        // A masthead logo appearing twice should cost one fetch, not two.
        let html = r#"<img src="https://a.example/logo.png">
                      <img src="https://a.example/logo.png">"#;
        assert_eq!(article_image_urls(html).len(), 1);
    }

    #[test]
    fn skips_images_that_are_already_inline() {
        let html = r#"<img src="data:image/png;base64,iVBORw0KGgo=">"#;
        assert!(article_image_urls(html).is_empty());
    }

    #[test]
    fn skips_relative_paths() {
        // The extractor absolutises real URLs, so a relative src is malformed
        // rather than resolvable — there is no base to resolve it against here.
        let html = r#"<img src="/local/photo.jpg"><img src="photo.jpg">"#;
        assert!(article_image_urls(html).is_empty());
    }

    #[test]
    fn rewrites_only_mapped_images() {
        let html = r#"<img src="https://a.example/1.jpg"><img src="https://b.example/2.jpg">"#;
        let map = vec![(
            "https://a.example/1.jpg".to_string(),
            "data:image/jpeg;base64,AAAA".to_string(),
        )];
        let out = inline_article_images(html, &map);

        assert!(out.contains("data:image/jpeg;base64,AAAA"));
        // The unmapped one survives untouched — a partial article is a
        // working article, and a later sweep can finish it.
        assert!(out.contains("https://b.example/2.jpg"));
    }

    #[test]
    fn drops_srcset_on_an_inlined_image() {
        // Otherwise the browser may prefer a remote srcset candidate over the
        // inlined src, and the document would LOOK self-contained while still
        // hitting the network.
        let html = r#"<img src="https://a.example/1.jpg" srcset="https://a.example/1-2x.jpg 2x">"#;
        let map = vec![(
            "https://a.example/1.jpg".to_string(),
            "data:image/jpeg;base64,AAAA".to_string(),
        )];
        let out = inline_article_images(html, &map);

        assert!(!out.contains("srcset"), "srcset survived: {out}");
        assert!(!out.contains("1-2x.jpg"), "remote candidate survived: {out}");
    }

    #[test]
    fn an_empty_map_is_a_no_op() {
        let html = r#"<p>text</p><img src="https://a.example/1.jpg">"#;
        assert_eq!(inline_article_images(html, &[]), html);
    }

    #[test]
    fn a_fully_inlined_document_has_nothing_left_to_fetch() {
        // The round trip that matters: extract, inline everything, and the
        // document should report no remaining remote images.
        let html = r#"<img src="https://a.example/1.jpg"><img src="https://b.example/2.jpg">"#;
        let map: Vec<(String, String)> = article_image_urls(html)
            .into_iter()
            .map(|u| (u, "data:image/jpeg;base64,AAAA".to_string()))
            .collect();

        let out = inline_article_images(html, &map);
        assert!(article_image_urls(&out).is_empty(), "still remote: {out}");
    }
}

/// The image a saved article should be RECOGNISED by (its lead image).
///
/// Peter, on build 6's gallery: "I am really not recognizing the docs in the
/// inbox compared to the share preview. That is what stuck in my mind and what
/// I'm looking for in the gallery, but see the small version of the full page."
///
/// That is the whole specification. A page rendered into a square is a
/// miniature of a layout — accurate and useless, because nobody remembers a
/// layout. What sticks is the photo from the share sheet. Since the sweep
/// embeds that photo into the document, the recognisable thumbnail is already
/// sitting inside the file; it just has to be found.
///
/// Returns the first inline image's decoded bytes. Only `data:` URIs qualify:
/// a remote `src` would mean a network fetch to draw a thumbnail, which is
/// what the offline work exists to avoid — those fall back to the system
/// generator instead.
pub fn article_lead_image(html: &str) -> Option<Vec<u8>> {
    use base64::Engine as _;
    // A STRING SCAN, not a DOM parse.
    //
    // Once images are inlined the document is mostly base64 — an article with
    // five photos is well over a megabyte — and this runs per gallery card.
    // Parsing that into a DOM to read one attribute costs a full parse and a
    // second copy of the document in memory, per card, for an answer the first
    // few hundred bytes usually contain.
    //
    // The patterns are unambiguous enough to scan for: the inliners are the
    // only things that write these.
    //
    // THREE forms, because captures are saved in two languages and the
    // markdown inliner uses reference style:
    //
    //   src="data:…"                 HTML  (inline_article_images)
    //   ](data:…)                    markdown, inline
    //   [label]: data:…              markdown, reference definition
    //                                      (inline_markdown_images)
    //
    // Only the first existed until 2026-08-23, which is why a markdown capture
    // — every X post, every video note — showed a thumbnail of its own rendered
    // text: the image was embedded in the file and simply not looked for.
    //
    // Scanned in ONE pass taking the earliest match, so "lead image" stays the
    // first image in DOCUMENT order. That is well-defined for reference style
    // too: `inline_markdown_images` numbers labels in document order, so the
    // first definition belongs to the first image.
    const NEEDLES: &[(&str, &[char])] = &[
        ("src=\"data:", &['"']),
        ("](data:", &[')']),
        ("]: data:", &['\n', '\r']),
    ];

    let mut best: Option<(usize, Vec<u8>)> = None;
    for (needle, terminators) in NEEDLES {
        let mut from = 0usize;
        while let Some(rel) = html[from..].find(needle) {
            let start = from + rel + needle.len();
            let end_rel = html[start..]
                .find(|c: char| terminators.contains(&c))
                .unwrap_or(html.len() - start);
            let uri = html[start..start + end_rel].trim();
            from = start + end_rel.max(1);

            // `<mime>;base64,<payload>` — base64 is the only form the inliners
            // produce, so anything else is someone else's markup.
            let Some((meta, payload)) = uri.split_once(',') else { continue };
            if !meta.contains("base64") {
                continue;
            }
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(payload.trim()) {
                if !bytes.is_empty() {
                    let at = start;
                    if best.as_ref().is_none_or(|(prev, _)| at < *prev) {
                        best = Some((at, bytes));
                    }
                    // Later matches for THIS needle can only be further along,
                    // so stop and let the other needles compete.
                    break;
                }
            }
        }
    }
    best.map(|(_, bytes)| bytes)
}

#[cfg(test)]
mod lead_image_tests {
    use super::*;
    use base64::Engine as _;

    fn data_uri(bytes: &[u8]) -> String {
        format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    }

    #[test]
    fn returns_the_first_inline_image() {
        let html = format!(
            r#"<p>text</p><img src="{}"><img src="{}">"#,
            data_uri(b"FIRST"),
            data_uri(b"SECOND")
        );
        assert_eq!(article_lead_image(&html).as_deref(), Some(&b"FIRST"[..]));
    }

    #[test]
    fn skips_remote_images_entirely() {
        // Fetching to draw a thumbnail would defeat the offline work this
        // whole feature exists for.
        let html = r#"<img src="https://cdn.example/photo.jpg">"#;
        assert!(article_lead_image(html).is_none());
    }

    #[test]
    fn skips_a_remote_image_to_reach_an_inline_one() {
        // A capture can be partially swept — some images embedded, some still
        // linked. The recognisable one is whichever actually made it inside.
        let html = format!(
            r#"<img src="https://cdn.example/a.jpg"><img src="{}">"#,
            data_uri(b"INLINE")
        );
        assert_eq!(article_lead_image(&html).as_deref(), Some(&b"INLINE"[..]));
    }

    #[test]
    fn ignores_a_non_base64_data_uri() {
        let html = r#"<img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">"#;
        assert!(article_lead_image(html).is_none());
    }

    #[test]
    fn an_article_with_no_images_has_no_lead() {
        assert!(article_lead_image("<p>just words</p>").is_none());
    }

    #[test]
    fn an_empty_payload_does_not_count_as_an_image() {
        // Decodes fine, draws nothing — a blank card reads as broken.
        let html = r#"<img src="data:image/jpeg;base64,">"#;
        assert!(article_lead_image(html).is_none());
    }
}

/// Pick the highest-resolution candidate from a `srcset` attribute.
///
/// Candidates are `url descriptor` pairs: `photo-800.jpg 800w` (width) or
/// `photo@2x.jpg 2x` (density). We want the largest, because the saved article
/// is read on whatever screen the user has later, not the one that rendered
/// the page — and we are storing ONE image, not a set.
fn best_srcset_candidate(srcset: &str) -> Option<String> {
    let mut best: Option<(f64, String)> = None;
    for raw in srcset.split(',') {
        let mut parts = raw.split_whitespace();
        let Some(url) = parts.next() else { continue };
        if url.is_empty() {
            continue;
        }
        // A bare candidate with no descriptor is "1x" by definition.
        let score = match parts.next() {
            Some(d) if d.ends_with('w') => d.trim_end_matches('w').parse::<f64>().unwrap_or(0.0),
            Some(d) if d.ends_with('x') => {
                // Density and width are not comparable, but they never appear
                // in the same srcset. Scale so a 2x sorts above a 1x without
                // ever outranking a real pixel width.
                d.trim_end_matches('x').parse::<f64>().unwrap_or(1.0)
            }
            _ => 1.0,
        };
        if best.as_ref().is_none_or(|(s, _)| score > *s) {
            best = Some((score, url.to_string()));
        }
    }
    best.map(|(_, url)| url)
}

/// Collapse `<picture>` down to its `<img>`, keeping the best available URL.
///
/// Browsers prefer `<source srcset>` over `<img src>`, and nothing else in
/// this pipeline looks at `<source>` — not the extractor, not
/// `article_image_urls`, not `inline_article_images`. Left alone, a
/// `<picture>`-based image on any of the many sites that use one would be
/// rendered from a REMOTE source we never inlined: the article looks perfect
/// online and loses its images offline, which is the exact failure this whole
/// feature exists to remove, hidden behind markup we did not inspect.
///
/// Flattening also UPGRADES the fetch path. There, `img src` is often a
/// placeholder while the real resolutions live in the sources — so promoting
/// the best candidate onto `src` is not merely tidying, it is the difference
/// between a 40px thumbnail and the actual photo.
pub fn flatten_picture_sources(html: &str) -> String {
    let doc = dom_query::Document::fragment(html);

    for picture in doc.select("picture").iter() {
        // Best candidate across every source in this picture.
        let mut best: Option<String> = None;
        for source in picture.select("source").iter() {
            let srcset = source.attr("srcset").unwrap_or_default().to_string();
            if let Some(url) = best_srcset_candidate(&srcset) {
                best = Some(url);
            }
        }

        for img in picture.select("img").iter() {
            let current = img.attr("src").unwrap_or_default().to_string();
            // Never overwrite an already-inlined image: the sweep may have run
            // and a data: URI is strictly better than any remote candidate.
            if current.starts_with("data:") {
                continue;
            }
            if let Some(url) = best.as_deref() {
                img.set_attr("src", url);
            }
        }

        // Gone, not merely emptied — a `<source>` with no srcset is still a
        // `<source>`, and leaving them invites the same bug back.
        for source in picture.select("source").iter() {
            source.remove();
        }
    }

    doc.html().to_string()
}

#[cfg(test)]
mod picture_tests {
    use super::*;

    #[test]
    fn picks_the_widest_candidate() {
        let set = "a-400.jpg 400w, a-1200.jpg 1200w, a-800.jpg 800w";
        assert_eq!(best_srcset_candidate(set).as_deref(), Some("a-1200.jpg"));
    }

    #[test]
    fn picks_the_densest_when_descriptors_are_x() {
        assert_eq!(
            best_srcset_candidate("a.jpg 1x, a@3x.jpg 3x, a@2x.jpg 2x").as_deref(),
            Some("a@3x.jpg")
        );
    }

    #[test]
    fn a_bare_candidate_counts_as_1x() {
        assert_eq!(best_srcset_candidate("only.jpg").as_deref(), Some("only.jpg"));
    }

    #[test]
    fn promotes_the_best_source_onto_the_img_and_removes_sources() {
        let html = r#"<picture><source srcset="big-1600.jpg 1600w, small-320.jpg 320w">
                      <img src="placeholder-40.jpg"></picture>"#;
        let out = flatten_picture_sources(html);

        assert!(out.contains("big-1600.jpg"), "did not promote: {out}");
        assert!(!out.contains("<source"), "source survived: {out}");
        // The placeholder is exactly what made the saved article look wrong.
        assert!(!out.contains("placeholder-40.jpg"), "placeholder kept: {out}");
    }

    #[test]
    fn never_downgrades_an_already_inlined_image() {
        // The sweep may have run first. A data: URI beats any remote candidate,
        // and replacing it would silently un-do the offline work.
        let html = r#"<picture><source srcset="remote.jpg 2000w">
                      <img src="data:image/jpeg;base64,AAAA"></picture>"#;
        let out = flatten_picture_sources(html);

        assert!(out.contains("data:image/jpeg;base64,AAAA"), "clobbered: {out}");
        assert!(!out.contains("remote.jpg"), "source survived: {out}");
    }

    #[test]
    fn a_plain_img_is_untouched() {
        let html = r#"<p>x</p><img src="photo.jpg">"#;
        assert!(flatten_picture_sources(html).contains("photo.jpg"));
    }

    #[test]
    fn flattened_pictures_become_visible_to_the_inliner() {
        // The point of the whole function: before flattening, the image is
        // invisible to `article_image_urls` and so never gets embedded.
        let html = r#"<picture><source srcset="real-1600.jpg 1600w"><img src="ph.jpg"></picture>"#;
        assert_eq!(article_image_urls(html), Vec::<String>::new());

        let flat = flatten_picture_sources(html);
        // Relative URLs are not fetchable, but the promotion is what matters:
        // the img now carries the real candidate rather than the placeholder.
        assert!(flat.contains("real-1600.jpg"));
    }
}

// ============================================================================
// X (Twitter) posts
// ============================================================================
//
// A shared x.com link saves as a bare link note today, and nothing better is
// reachable: a plain fetch of a status page returns no usable content, and
// `PageRenderer` meets a login wall.
//
// One unauthenticated endpoint does answer — the one X's own embed widget
// uses. It returns the post text, the author, the date, and for X ARTICLES
// (their long-form format) a title, a ~200-character preview and a cover
// image.
//
// **It does not return an article's body — but we do not need it to.**
//
// I first concluded the body was unreachable, from a fetch that 404'd. That
// fetch was of a DELETED post, and I generalised from it. Retested against a
// live one: `x.com/<user>/status/<id>` server-renders the COMPLETE article
// into its HTML, logged out, for any ordinary user-agent — and our existing
// extractor already reads it. Peter's example yields 7,481 characters over 42
// paragraphs, ending on the article's real conclusion.
//
// (The `/article/<id>` URL forms do 404. Only the status URL carries it.)
//
// So this endpoint is not the capture path. It is the METADATA path, and it
// earns its place by fixing the one thing extraction gets wrong: readability
// titles these "rvaniaaa (@rvaniaaaa) on X", because that is the page's
// `<title>`. The real title, author and cover live here.
//
// The note builder below is the FALLBACK, for posts with no article to
// extract. It must never displace a successful extraction — trading 7,481
// characters for a 197-character preview would be a straight regression.

/// The embed-data endpoint for an X status URL, or `None` when the URL is not
/// one. Mirrors `oembed_url`'s shape for video providers.
/// A binary document a URL served directly, rather than a page to extract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkedDocument {
    /// Extension WITHOUT the dot, for naming the stored file.
    pub extension: &'static str,
    /// Coarse kind, for the format picker's label ("PDF", "Image", …).
    pub kind: &'static str,
}

/// Classify a `Content-Type` as a document worth storing verbatim.
///
/// A URL does not always lead to a page. Sharing a link to a PDF — a bank
/// statement, a research note, a conference deck — used to take the article
/// path, where `fetch` rejected the response for not being `text/html`, the
/// chain fell through to the link note, and the user got a `.md` file
/// containing only the URL. Silently, and after the sheet had promised an
/// `.html` file.
///
/// So: if the bytes ARE the document, store the document. `write_document`
/// already exists on both platforms for shared files; this is the same
/// destination reached from a link instead of a file drop.
///
/// Returns `None` for `text/html` and anything unrecognised, which keeps the
/// article path exactly as it was for ordinary pages.
pub fn linked_document_for_content_type(content_type: &str) -> Option<LinkedDocument> {
    // `application/pdf;charset=UTF-8` — parameters after `;` are not the type.
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();

    let doc = |extension, kind| Some(LinkedDocument { extension, kind });
    match mime.as_str() {
        "application/pdf" | "application/x-pdf" => doc("pdf", "PDF"),
        "application/epub+zip" => doc("epub", "EPUB"),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => {
            doc("pptx", "Presentation")
        }
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
            doc("docx", "Document")
        }
        "application/vnd.oasis.opendocument.text" => doc("odt", "Document"),
        "application/vnd.oasis.opendocument.presentation" => doc("odp", "Presentation"),
        "application/rtf" | "text/rtf" => doc("rtf", "Document"),
        "image/jpeg" => doc("jpg", "Image"),
        "image/png" => doc("png", "Image"),
        "image/gif" => doc("gif", "Image"),
        "image/webp" => doc("webp", "Image"),
        "image/heic" | "image/heif" => doc("heic", "Image"),
        "image/svg+xml" => doc("svg", "Image"),
        "image/tiff" => doc("tiff", "Image"),
        "video/mp4" => doc("mp4", "Video"),
        "video/quicktime" => doc("mov", "Video"),
        "video/webm" => doc("webm", "Video"),
        // Audio is stored like any other document here. Turning a shared
        // recording into a transcribed recording BUNDLE is a separate concern
        // (the recordings work) — this only gets the bytes onto disk under a
        // real name, which is the prerequisite either way.
        "audio/mpeg" | "audio/mp3" => doc("mp3", "Audio"),
        "audio/mp4" | "audio/x-m4a" => doc("m4a", "Audio"),
        "audio/wav" | "audio/x-wav" | "audio/wave" => doc("wav", "Audio"),
        "audio/aac" => doc("aac", "Audio"),
        "audio/ogg" | "audio/opus" => doc("ogg", "Audio"),
        "audio/flac" | "audio/x-flac" => doc("flac", "Audio"),
        _ => None,
    }
}

/// The filename a server suggested via `Content-Disposition`.
///
/// Worth honouring: the URL's own last path segment is frequently an opaque id
/// (`kFcVnC0GHB_ZVnO5mxL0dg`) or nothing at all, while the header carries the
/// real title. Handles both `filename="…"` and RFC 5987 `filename*=UTF-8''…`,
/// preferring the latter because it is the one that survives non-ASCII.
///
/// Returns the BASENAME only — a server-supplied path is never allowed to
/// steer where the file lands.
pub fn filename_from_content_disposition(header: &str) -> Option<String> {
    let extended = header
        .split(';')
        .map(str::trim)
        .find(|p| p.to_ascii_lowercase().starts_with("filename*="))
        .and_then(|p| p.splitn(2, '=').nth(1))
        .and_then(|v| {
            // `UTF-8''name.pdf` — charset and language, then the value.
            let encoded = v.rsplit("''").next()?;
            Some(percent_decode(encoded))
        });

    let plain = || {
        header
            .split(';')
            .map(str::trim)
            .find(|p| p.to_ascii_lowercase().starts_with("filename="))
            .and_then(|p| p.splitn(2, '=').nth(1))
            .map(|v| v.trim().trim_matches('"').to_string())
    };

    let raw = extended.or_else(plain)?;
    // Basename only, and never a traversal segment.
    let base = raw.rsplit(['/', '\\']).next().unwrap_or_default().trim();
    if base.is_empty() || base == "." || base == ".." {
        return None;
    }
    Some(base.to_string())
}

/// Minimal percent-decoding for `Content-Disposition` values.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(b) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn x_syndication_url(url: &str) -> Option<String> {
    let after_scheme = url.split("://").nth(1)?;
    let host = after_scheme.split('/').next()?.trim_start_matches("www.").to_lowercase();
    if !matches!(host.as_str(), "x.com" | "twitter.com" | "mobile.x.com" | "mobile.twitter.com") {
        return None;
    }
    // `/<handle>/status/<id>` — also `/i/web/status/<id>`. The id is the only
    // part that matters, and it is the segment after "status".
    let path = after_scheme.split_once('/').map(|(_, rest)| rest)?;
    let mut segments = path.split(['/', '?', '#']).filter(|s| !s.is_empty());
    let id = loop {
        match segments.next() {
            Some("status" | "statuses") => break segments.next()?,
            Some(_) => continue,
            None => return None,
        }
    };
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(format!(
        "https://cdn.syndication.twimg.com/tweet-result?id={id}&lang=en&token=a"
    ))
}

/// What the embed endpoint tells us about a post.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct XPost {
    pub text: String,
    pub author_name: Option<String>,
    pub author_handle: Option<String>,
    pub created_at: Option<String>,
    /// Present only for X Articles (long-form).
    pub article_title: Option<String>,
    /// A ~200-character teaser. NOT the body — the body is login-gated.
    pub article_preview: Option<String>,
    pub cover_image_url: Option<String>,
}

pub fn parse_x_post(json: &str) -> XPost {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else {
        return XPost::default();
    };
    let s = |val: Option<&serde_json::Value>| {
        val.and_then(|v| v.as_str()).map(str::to_string).filter(|t| !t.trim().is_empty())
    };

    let article = v.get("article");
    XPost {
        // A long-form post's `text` is just the t.co link to itself, which is
        // noise in a note that already carries the source link.
        text: s(v.get("text")).unwrap_or_default(),
        author_name: s(v.pointer("/user/name")),
        author_handle: s(v.pointer("/user/screen_name")),
        created_at: s(v.get("created_at")),
        article_title: article.and_then(|a| s(a.get("title"))),
        article_preview: article.and_then(|a| s(a.get("preview_text"))),
        cover_image_url: article
            .and_then(|a| s(a.pointer("/cover_media/media_info/original_img_url"))),
    }
}

/// Is this post's text nothing but a link to itself?
fn is_self_link_only(text: &str) -> bool {
    let t = text.trim();
    !t.is_empty() && t.split_whitespace().count() == 1 && t.starts_with("https://t.co/")
}

/// A note for an X post.
///
/// For an Article the body is a title, the cover image, the preview, and an
/// explicit line saying the rest is on X — because it is, and a note that
/// quietly ends mid-sentence reads as data loss rather than a summary.
pub fn build_x_note(input: &CaptureInput, post: &XPost, now_rfc3339: &str) -> CaptureNote {
    let title = meaningful_title(input.title.as_deref())
        .or_else(|| post.article_title.clone())
        .or_else(|| {
            // A plain post has no title, so make one from its opening words —
            // enough to recognise in a listing, not a whole sentence.
            let words: Vec<&str> = post.text.split_whitespace().take(8).collect();
            (!words.is_empty()).then(|| words.join(" "))
        });

    let base = build_capture_note(
        &CaptureInput { title: title.clone(), ..input.clone() },
        now_rfc3339,
    );

    let mut fm = String::from("capture_format: x-post");
    if let Some(name) = post.author_name.as_deref() {
        fm.push_str(&format!("\nauthor: {}", yaml_quote(name)));
    }
    if let Some(handle) = post.author_handle.as_deref() {
        fm.push_str(&format!("\nauthor_handle: {}", yaml_quote(&format!("@{handle}"))));
    }
    if let Some(date) = post.created_at.as_deref() {
        fm.push_str(&format!("\nposted_at: {}", yaml_quote(date)));
    }
    if post.article_title.is_some() {
        // Marks a note whose body is deliberately partial, so a future sweep
        // can find these again if a fuller route ever exists.
        fm.push_str("\nx_article: true");
    }

    let mut body = String::new();
    if let Some(cover) = post.cover_image_url.as_deref() {
        body.push_str(&format!("![]({cover})\n\n"));
    }
    if let Some(preview) = post.article_preview.as_deref() {
        body.push_str(preview.trim());
        body.push_str("\n\n*This is the opening of an X Article. The full text is on X.*\n");
    } else if !is_self_link_only(&post.text) {
        body.push_str(post.text.trim());
        body.push('\n');
    }

    let mut contents = base.contents;
    if let Some(close) = contents[3..].find("\n---") {
        contents.insert_str(3 + close, &format!("\n{fm}"));
    }
    // Replace the link-only body (everything after the frontmatter fence),
    // keeping the source link the base note already wrote above it.
    let split = contents.find("---\n\n").map(|i| i + 5).unwrap_or(0);
    CaptureNote {
        rel_path: base.rel_path,
        contents: format!("{}{body}", &contents[..split]),
    }
}

/// Is this title X's own page chrome rather than the post's subject?
///
/// Readability names an X article after the page `<title>`, which is always
/// `<display name> (@<handle>) on X` — so every X capture lands in the Inbox
/// named after its author instead of its subject, and two articles by the same
/// person collide into `Name-1.md`. The syndication endpoint knows the real
/// title; this decides when to prefer it.
///
/// Deliberately narrow. A post genuinely titled "Notes on X" must survive, so
/// the handle-in-parens shape has to be present — matching a bare " on X"
/// suffix would eat real titles.
pub fn is_x_chrome_title(title: &str) -> bool {
    let t = title.trim();
    let lower = t.to_lowercase();
    // `Name (@handle) on X` / `… on Twitter`, the two shapes X has shipped.
    if t.contains("(@") && (lower.ends_with(") on x") || lower.ends_with(") on twitter")) {
        return true;
    }
    // `@handle on X`, seen from some share sheets.
    t.starts_with('@') && (lower.ends_with(" on x") || lower.ends_with(" on twitter"))
}

/// Fold what the syndication endpoint knows into an extraction.
///
/// Two corrections, both invisible to the extractor because the information is
/// simply not in the page it parsed:
///
/// 1. **Title.** See [`is_x_chrome_title`].
/// 2. **Lead image.** An X Article's cover is rendered by the client, not
///    served in the markup, so extraction never sees it. Without this the
///    gallery card shows a thumbnail of the article's own rendered text —
///    which is exactly what a reader does NOT recognise the piece by, and the
///    defect that sent us here.
///
/// The cover is *prepended*, because `article_lead_image` takes the first
/// image in document order and the share preview's photo is the one the user
/// expects to see on the card. Skipped when the cover already appears in the
/// body, so an article that does carry its cover is not given two.
///
/// This never touches the extracted BODY text. The module note above is
/// load-bearing: syndication carries a ~200-character teaser, and letting it
/// displace a 7,000-character extraction would be a straight regression.
pub fn enrich_x_article(article: &mut Article, post: &XPost) {
    if let Some(real) = post.article_title.as_deref() {
        let replaceable = article
            .title
            .as_deref()
            .map(|t| t.trim().is_empty() || is_x_chrome_title(t))
            .unwrap_or(true);
        if replaceable {
            article.title = Some(real.to_string());
        }
    }

    if let Some(cover) = post.cover_image_url.as_deref() {
        if !article.html.contains(cover) && !article.markdown.contains(cover) {
            article.html = format!(
                "<img src=\"{}\" alt=\"\">{}",
                escape_html_text(cover),
                article.html
            );
            article.markdown = format!("![]({cover})\n\n{}", article.markdown);
        }
    }
}

/// An X capture note: the full extracted article, plus the post metadata that
/// only syndication knows (author, handle, posted-at).
///
/// Same body as [`build_article_note`] — this adds frontmatter, it does not
/// take anything away. The `.html` format gets the same enrichment through
/// [`enrich_x_article`] but no frontmatter, because it writes a document
/// rather than a note.
pub fn build_x_article_note(
    input: &CaptureInput,
    article: &Article,
    post: &XPost,
    now_rfc3339: &str,
) -> CaptureNote {
    // A chrome title from the share sheet must not beat the real one either —
    // `build_article_note` prefers `input.title` whenever it is not URL-like,
    // and "Peter (@peter) on X" clears that bar.
    let cleaned = CaptureInput {
        title: input
            .title
            .as_deref()
            .filter(|t| !is_x_chrome_title(t))
            .map(str::to_string),
        ..input.clone()
    };
    let base = build_article_note(&cleaned, article, now_rfc3339);

    let mut fm = String::new();
    if let Some(name) = post.author_name.as_deref() {
        fm.push_str(&format!("\nauthor: {}", yaml_quote(name)));
    }
    if let Some(handle) = post.author_handle.as_deref() {
        fm.push_str(&format!("\nauthor_handle: {}", yaml_quote(&format!("@{handle}"))));
    }
    if let Some(date) = post.created_at.as_deref() {
        fm.push_str(&format!("\nposted_at: {}", yaml_quote(date)));
    }
    if fm.is_empty() {
        return base;
    }

    let mut contents = base.contents;
    if let Some(close) = contents[3..].find("\n---") {
        contents.insert_str(3 + close, &fm);
    }
    CaptureNote { contents, ..base }
}

#[cfg(test)]
mod x_post_tests {
    use super::*;

    fn input(url: &str) -> CaptureInput {
        CaptureInput {
            url: url.to_string(),
            title: None,
            selection_text: None,
            tags: vec![],
        }
    }

    #[test]
    fn recognises_status_urls_on_both_hosts() {
        for url in [
            "https://x.com/jack/status/20",
            "https://twitter.com/jack/status/20",
            "https://mobile.twitter.com/jack/status/20",
            "https://x.com/i/web/status/20",
        ] {
            let out = x_syndication_url(url);
            assert!(out.is_some(), "not recognised: {url}");
            assert!(out.unwrap().contains("id=20"), "wrong id for {url}");
        }
    }

    #[test]
    fn strips_the_tracking_query_x_appends_to_shared_links() {
        // The share sheet always appends ?s=46&t=... — if that leaked into the
        // id the endpoint would 404 on every single shared post.
        let url = "https://x.com/rvaniaaaa/status/2090512486738845784?s=46&t=CeSJ900";
        let out = x_syndication_url(url).expect("recognised");
        assert!(out.contains("id=2090512486738845784"), "{out}");
        assert!(!out.contains("s=46"), "query leaked: {out}");
    }

    #[test]
    fn ignores_non_status_x_urls_and_other_hosts() {
        for url in [
            "https://x.com/jack",
            "https://x.com/i/article/123",
            "https://example.com/status/20",
            "https://x.com/jack/status/notanumber",
        ] {
            assert!(x_syndication_url(url).is_none(), "wrongly matched: {url}");
        }
    }

    #[test]
    fn parses_a_plain_post() {
        let json = r#"{"text":"just setting up my twttr",
                       "created_at":"2006-03-21T20:50:14.000Z",
                       "user":{"name":"jack","screen_name":"jack"}}"#;
        let p = parse_x_post(json);
        assert_eq!(p.text, "just setting up my twttr");
        assert_eq!(p.author_handle.as_deref(), Some("jack"));
        assert!(p.article_title.is_none());
    }

    #[test]
    fn parses_an_article_including_its_cover() {
        let json = r#"{"text":"https://t.co/abc","user":{"name":"R","screen_name":"rv"},
          "article":{"title":"The Second Brain Is Not a Storage System.",
                     "preview_text":"Most people who build a second brain",
                     "cover_media":{"media_info":{"original_img_url":"https://pbs.twimg.com/media/x.jpg"}}}}"#;
        let p = parse_x_post(json);
        assert_eq!(p.article_title.as_deref(), Some("The Second Brain Is Not a Storage System."));
        assert_eq!(p.cover_image_url.as_deref(), Some("https://pbs.twimg.com/media/x.jpg"));
    }

    #[test]
    fn malformed_json_yields_an_empty_post_rather_than_panicking() {
        // The endpoint is unofficial; it can return anything at any time, and
        // a share must never fail because of it.
        assert_eq!(parse_x_post("<html>404</html>"), XPost::default());
        assert_eq!(parse_x_post(""), XPost::default());
    }

    #[test]
    fn an_article_note_says_the_body_is_elsewhere() {
        // The preview ends mid-sentence. Without this line the note reads as
        // truncated data rather than a deliberate teaser.
        let p = XPost {
            article_title: Some("A Title".into()),
            article_preview: Some("Most people who build a second brain".into()),
            ..Default::default()
        };
        let note = build_x_note(&input("https://x.com/a/status/1"), &p, "2026-08-22T10:00:00Z");
        assert!(note.contents.contains("full text is on X"), "{}", note.contents);
        assert!(note.contents.contains("x_article: true"));
    }

    #[test]
    fn an_article_note_drops_the_self_link_body() {
        // A long-form post's `text` is just a t.co link to itself, which the
        // note's own source line already carries.
        let p = XPost {
            text: "https://t.co/wBLzP25PUm".into(),
            article_title: Some("A Title".into()),
            article_preview: Some("Opening words".into()),
            ..Default::default()
        };
        let note = build_x_note(&input("https://x.com/a/status/1"), &p, "2026-08-22T10:00:00Z");
        assert!(!note.contents.contains("t.co/wBLzP25PUm"), "{}", note.contents);
    }

    #[test]
    fn a_plain_post_is_titled_from_its_opening_words() {
        let p = XPost { text: "one two three four five six seven eight nine ten".into(), ..Default::default() };
        let note = build_x_note(&input("https://x.com/a/status/1"), &p, "2026-08-22T10:00:00Z");
        // The TITLE is capped; the body still carries the whole post, so the
        // cap has to be asserted on the title line rather than the document.
        let title_line = note
            .contents
            .lines()
            .find(|l| l.starts_with("title:"))
            .expect("a title");
        assert!(title_line.contains("one two three four five six seven eight"));
        assert!(!title_line.contains("nine"), "title not capped: {title_line}");
        assert!(note.contents.contains("nine ten"), "body lost the full text");
    }
}

#[cfg(test)]
mod x_enrichment_tests {
    use super::*;

    fn article(title: Option<&str>, body: &str) -> Article {
        Article::new(
            title.map(str::to_string),
            body.to_string(),
            format!("<p>{body}</p>"),
        )
    }

    fn post() -> XPost {
        XPost {
            text: String::new(),
            author_name: Some("Rania".into()),
            author_handle: Some("rvaniaaaa".into()),
            created_at: Some("2026-08-20T09:00:00Z".into()),
            article_title: Some("The real subject of the piece".into()),
            article_preview: Some("A teaser".into()),
            cover_image_url: Some("https://pbs.twimg.com/cover.jpg".into()),
        }
    }

    #[test]
    fn page_chrome_titles_are_recognised() {
        for t in [
            "Rania (@rvaniaaaa) on X",
            "rania (@rvaniaaaa) on Twitter",
            "@rvaniaaaa on X",
        ] {
            assert!(is_x_chrome_title(t), "should be chrome: {t}");
        }
    }

    #[test]
    fn a_real_title_that_merely_mentions_x_survives() {
        // The whole risk of the chrome check is eating a genuine title. The
        // handle-in-parens shape is what makes it safe to act on.
        for t in [
            "Notes on X",
            "A field guide to X",
            "What Elon did on Twitter",
            "On X: a reckoning",
        ] {
            assert!(!is_x_chrome_title(t), "wrongly flagged as chrome: {t}");
        }
    }

    #[test]
    fn the_syndication_title_replaces_page_chrome() {
        let mut a = article(Some("Rania (@rvaniaaaa) on X"), "body");
        enrich_x_article(&mut a, &post());
        assert_eq!(a.title.as_deref(), Some("The real subject of the piece"));
    }

    #[test]
    fn a_genuine_extracted_title_is_left_alone() {
        let mut a = article(Some("What the extractor found"), "body");
        enrich_x_article(&mut a, &post());
        assert_eq!(a.title.as_deref(), Some("What the extractor found"));
    }

    #[test]
    fn the_cover_becomes_the_first_image_so_it_becomes_the_thumbnail() {
        let mut a = article(Some("T"), "body");
        enrich_x_article(&mut a, &post());
        assert!(a.markdown.starts_with("![](https://pbs.twimg.com/cover.jpg)"), "{}", a.markdown);
        assert!(a.html.starts_with("<img src=\"https://pbs.twimg.com/cover.jpg\""), "{}", a.html);
    }

    #[test]
    fn a_cover_already_in_the_body_is_not_added_twice() {
        let mut a = article(Some("T"), "![](https://pbs.twimg.com/cover.jpg)\n\nbody");
        enrich_x_article(&mut a, &post());
        assert_eq!(a.markdown.matches("cover.jpg").count(), 1, "{}", a.markdown);
    }

    #[test]
    fn enrichment_never_replaces_the_extracted_body() {
        // The load-bearing invariant from the module note: syndication's
        // 200-character teaser must never displace a real extraction.
        let long = "x".repeat(7_000);
        let mut a = article(Some("T"), &long);
        enrich_x_article(&mut a, &post());
        assert!(a.markdown.contains(&long), "extraction was displaced");
        assert!(!a.markdown.contains("A teaser"), "teaser leaked into the body");
    }

    #[test]
    fn the_note_carries_author_handle_and_date() {
        let mut a = article(Some("Rania (@rvaniaaaa) on X"), "body text");
        enrich_x_article(&mut a, &post());
        let note = build_x_article_note(
            &CaptureInput {
                url: "https://x.com/rvaniaaaa/status/1".into(),
                title: None,
                selection_text: None,
                tags: vec![],
            },
            &a,
            &post(),
            "2026-08-24T10:00:00Z",
        );
        assert!(note.contents.contains("author: \"Rania\""), "{}", note.contents);
        assert!(note.contents.contains("author_handle: \"@rvaniaaaa\""), "{}", note.contents);
        assert!(note.contents.contains("posted_at:"), "{}", note.contents);
        assert!(note.contents.contains("capture_format: markdown"), "{}", note.contents);
        assert!(note.contents.contains("body text"), "body lost: {}", note.contents);
    }

    #[test]
    fn a_chrome_title_from_the_share_sheet_does_not_beat_the_real_one() {
        // `build_article_note` prefers `input.title` over the extracted one
        // whenever it is not URL-like — and "Rania (@rvaniaaaa) on X" clears
        // that bar, so without the filter the file is named after the author.
        let mut a = article(None, "body");
        enrich_x_article(&mut a, &post());
        let note = build_x_article_note(
            &CaptureInput {
                url: "https://x.com/rvaniaaaa/status/1".into(),
                title: Some("Rania (@rvaniaaaa) on X".into()),
                selection_text: None,
                tags: vec![],
            },
            &a,
            &post(),
            "2026-08-24T10:00:00Z",
        );
        assert_eq!(note.rel_path, "Inbox/The real subject of the piece.md");
    }

    #[test]
    fn a_post_with_no_syndication_data_changes_nothing() {
        let mut a = article(Some("Extracted"), "body");
        let before = a.clone();
        enrich_x_article(&mut a, &XPost::default());
        assert_eq!(a, before);
    }
}

#[cfg(test)]
mod linked_document_tests {
    use super::*;

    #[test]
    fn the_reported_case_is_recognised_as_a_pdf() {
        // Peter shared a UBS link that serves `application/pdf;charset=UTF-8`.
        // It took the article path, `fetch` rejected it for not being HTML, the
        // chain fell through to the link note, and he got a `.md` file holding
        // only the URL — after the sheet had promised `.html`.
        let doc = linked_document_for_content_type("application/pdf;charset=UTF-8").unwrap();
        assert_eq!(doc.extension, "pdf");
        assert_eq!(doc.kind, "PDF");
    }

    #[test]
    fn parameters_and_casing_do_not_defeat_the_match() {
        // Real headers carry charset, whitespace and inconsistent case.
        for header in [
            "application/pdf",
            "Application/PDF",
            "  application/pdf ; charset=utf-8 ",
        ] {
            assert!(
                linked_document_for_content_type(header).is_some(),
                "{header:?} should classify as a document"
            );
        }
    }

    #[test]
    fn covers_the_formats_notesage_already_stores() {
        // The same set the share extensions accept as FILE drops — a link to
        // one should reach the same place as the file itself.
        for (ct, ext) in [
            ("application/epub+zip", "epub"),
            (
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "pptx",
            ),
            (
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "docx",
            ),
            ("image/jpeg", "jpg"),
            ("image/png", "png"),
            ("video/mp4", "mp4"),
            ("video/quicktime", "mov"),
            ("audio/mpeg", "mp3"),
            ("audio/wav", "wav"),
        ] {
            let doc = linked_document_for_content_type(ct)
                .unwrap_or_else(|| panic!("{ct} should be storable"));
            assert_eq!(doc.extension, ext, "wrong extension for {ct}");
        }
    }

    #[test]
    fn html_is_not_a_document_so_the_article_path_is_untouched() {
        // The whole point: ordinary pages must keep extracting as articles.
        for ct in ["text/html", "text/html; charset=utf-8", "application/xhtml+xml"] {
            assert!(
                linked_document_for_content_type(ct).is_none(),
                "{ct:?} must NOT divert to the document path"
            );
        }
        assert!(linked_document_for_content_type("").is_none());
        assert!(linked_document_for_content_type("application/json").is_none());
    }

    #[test]
    fn the_servers_filename_wins_over_an_opaque_url() {
        // The reported URL's last segment is `kFcVnC0GHB_ZVnO5mxL0dg`; the
        // header carries the real title, percent-encoded with spaces.
        let name = filename_from_content_disposition(
            "attachment; filename*=UTF-8''AI%20presentation_genAI_conference_2025_to_export.pdf",
        )
        .unwrap();
        assert_eq!(name, "AI presentation_genAI_conference_2025_to_export.pdf");
    }

    #[test]
    fn plain_filename_is_accepted_and_the_extended_form_preferred() {
        assert_eq!(
            filename_from_content_disposition(r#"attachment; filename="report.pdf""#).unwrap(),
            "report.pdf"
        );
        // Both present: the RFC 5987 form is the one that survives non-ASCII.
        let both = r#"attachment; filename="fallback.pdf"; filename*=UTF-8''r%C3%A4kning.pdf"#;
        assert_eq!(filename_from_content_disposition(both).unwrap(), "räkning.pdf");
    }

    #[test]
    fn a_server_supplied_path_cannot_steer_where_the_file_lands() {
        // The header is attacker-controlled for any URL the user opens.
        assert_eq!(
            filename_from_content_disposition(r#"attachment; filename="../../etc/passwd""#).unwrap(),
            "passwd"
        );
        assert_eq!(
            filename_from_content_disposition(r#"attachment; filename="/tmp/evil.pdf""#).unwrap(),
            "evil.pdf"
        );
        assert!(filename_from_content_disposition(r#"attachment; filename="..""#).is_none());
        assert!(filename_from_content_disposition("attachment").is_none());
    }
    /// An inline `<svg>` carrying only a `viewBox` — no width or height — has
    /// no intrinsic size, so it expands to fill its container. In an article
    /// body that means a site logo rendering full-screen, which is what a real
    /// capture did: 18 of the 44 inline SVGs in one saved page were unsized.
    ///
    /// `img` was constrained from the start and `svg` was simply never
    /// considered, because the extractor's output was assumed to carry images
    /// as `<img>`. Modern sites inline their icons instead.
    #[test]
    fn article_html_style_constrains_unsized_inline_svg() {
        let style = ARTICLE_HTML_STYLE;
        assert!(
            style.contains("svg{max-width:100%"),
            "inline SVG must be width-capped like img, or a wide graphic overflows the measure"
        );
        assert!(
            style.contains("svg:not([width]):not([height])"),
            "a viewBox-only SVG has no intrinsic size and fills its container — it needs an \
             explicit fallback size, which max-width alone does not give it"
        );
    }

    /// The REAL body the UBS capture saved, verbatim from the file on disk
    /// (#807). 629 characters of legalese that cleared `MIN_ARTICLE_CHARS`
    /// with room to spare.
    const UBS_DISCLAIMER: &str = "Legal Information The products, services, information \
and/or materials contained within these web pages may not be available for residents of \
certain jurisdictions. Please consult the sales restrictions relating to the products or \
services in question for further information. Copying, editing, modifying, distributing, \
sharing, linking or any other use (whether for commercial purposes or otherwise) of this \
material, other than personal viewing, without UBS's prior written permission is strictly \
prohibited. CIO research disclaimer © UBS 1998 - 2026. All rights reserved.";

    /// A hub page: link-heavy, short blurbs, and the only substantial prose is
    /// the legal footer. This is the shape both UBS "insights" URLs actually
    /// have — measured in a browser: 92 paragraphs / 89 links on one, 24 / 49
    /// on the other, and on both the longest prose block is a fraud warning.
    fn hub_page(og_type: &str, extra_head: &str) -> String {
        let links: String = (1..40)
            .map(|i| format!("<li><a href=\"/x{i}\">Insight number {i}</a></li>"))
            .collect();
        format!(
            "<html><head><meta property=\"og:type\" content=\"{og_type}\">{extra_head}\
</head><body><h1>Transformational Innovation Opportunities</h1>\
<nav><ul>{links}</ul></nav>\
<p>Watch this video from our Chief Investment Officer.</p>\
<footer><p>{UBS_DISCLAIMER}</p></footer></body></html>"
        )
    }

    #[test]
    fn a_hub_page_whose_only_prose_is_a_disclaimer_is_not_an_article() {
        // The exact failure: the capture succeeded, the title was right, and
        // the body was the page footer. Failing visibly (None -> link note) is
        // the point; a confident wrong answer is worse than an honest miss.
        let page = hub_page("website", "");
        assert!(
            extract_article(&page, "https://www.ubs.com/global/en/insights.html").is_none(),
            "a page that does not call itself an article, whose body is legal \
             boilerplate, must not be captured as an article"
        );
    }

    #[test]
    fn the_disclaimer_alone_clears_the_character_floor() {
        // Why a character bar could never have been the fix, and why #807 is
        // not solved by raising MIN_ARTICLE_CHARS.
        assert!(
            UBS_DISCLAIMER.chars().count() > 400,
            "if this ever drops below the floor the guard above is untested"
        );
    }

    #[test]
    fn a_page_that_declares_itself_an_article_is_still_captured() {
        // The suppression arm. Same boilerplate-bearing body, but the page
        // says it is an article — trust the publisher over our heuristic.
        let page = hub_page("article", "");
        assert!(
            extract_article(&page, "https://example.com/post").is_some(),
            "og:type=article must suppress the boilerplate check"
        );
    }

    #[test]
    fn json_ld_article_types_also_declare_an_article() {
        for ld_type in ["NewsArticle", "BlogPosting", "Article"] {
            let head = format!(
                "<script type=\"application/ld+json\">{{\"@type\":\"{ld_type}\"}}</script>"
            );
            let page = hub_page("website", &head);
            assert!(
                extract_article(&page, "https://example.com/post").is_some(),
                "schema.org {ld_type} must count as a self-declared article"
            );
        }
    }

    #[test]
    fn a_video_hub_is_not_rescued_by_its_json_ld() {
        // The UBS pages DO carry JSON-LD — BreadcrumbList, ListItem,
        // VideoObject. None of them is an Article, and matching on the bare
        // word would have let this through.
        let head = "<script type=\"application/ld+json\">{\"@type\":\"VideoObject\",\"name\":\"An article about innovation\"}</script>";
        let page = hub_page("website", head);
        assert!(
            extract_article(&page, "https://www.ubs.com/x.html").is_none(),
            "VideoObject and a breadcrumb naming the word article must not count \
             as a self-declared article"
        );
    }

    #[test]
    fn one_copyright_line_does_not_condemn_a_real_article() {
        // The false positive that matters. Readability routinely sweeps a
        // single footer line into a genuine article, and plenty of hand-rolled
        // sites publish no metadata at all — so ONE marker must never reject.
        let body: String = (1..12)
            .map(|i| format!("<p>Paragraph {i} of a real article with genuine prose in it, \
long enough to matter to the extractor and to a reader.</p>"))
            .collect();
        // The line goes INSIDE the article body, not in a `<footer>` —
        // readability strips footers, so a fixture that puts it there never
        // reaches the marker check and the test passes for the wrong reason.
        // (It did, on first writing: lowering the threshold to 1 left it green.)
        let page = format!(
            "<html><head><title>A Real Post</title></head><body><article>{body}\
<p>© 2026 Some Blog. All rights reserved.</p></article></body></html>"
        );
        let extracted = extract_article(&page, "https://example.com/post");
        assert!(
            extracted
                .as_ref()
                .is_some_and(|a| a.markdown.to_lowercase().contains("all rights reserved")),
            "precondition: the marker must survive extraction, or this test is \
             not exercising the boilerplate threshold at all"
        );
        assert!(
            extracted.is_some(),
            "a real article with no metadata and a single copyright line must \
             still be captured — this is the regression the two-marker \
             threshold exists to avoid"
        );
    }

    /// The false positive the FIRST version of this gate would have shipped.
    ///
    /// "Privacy Policy", "Terms of Use" and "All rights reserved" are the
    /// footer of most of the web. Counting markers alone rejected any ordinary
    /// article whose extraction kept a footer nav — and worst for hand-rolled
    /// sites, which are also the least likely to publish the `og:type`
    /// metadata that suppresses the check. The gate was sharpest against
    /// exactly the pages it exists to protect. Caught in code review.
    #[test]
    fn a_real_article_that_kept_its_footer_nav_is_still_an_article() {
        let body: String = (1..14)
            .map(|i| format!("<p>Paragraph {i} carries the actual substance of this piece, \
with enough genuine prose to read like the article it is.</p>"))
            .collect();
        // Three markers, all of them AFTER the article — the ordinary shape.
        let page = format!(
            "<html><head><title>A Real Post</title></head><body><article>{body}\
<p>Privacy Policy | Terms of Use | Cookie Policy</p>\
<p>© 2026 Some Site. All rights reserved.</p></article></body></html>"
        );
        let extracted = extract_article(&page, "https://example.com/post");
        assert!(
            extracted
                .as_ref()
                .is_some_and(|a| a.markdown.to_lowercase().contains("privacy policy")),
            "precondition: the footer must survive extraction, or this is not \
             exercising the boilerplate gate at all"
        );
        assert!(
            extracted.is_some(),
            "a real article whose extraction kept a footer nav must still be \
             captured — position, not marker count, is what separates a body \
             that IS boilerplate from one that merely ends with it"
        );
    }

    #[test]
    fn boilerplate_at_the_top_is_what_condemns_a_body() {
        // The two halves of the rule, stated directly.
        let footer = "Real prose goes here and carries the piece. ".repeat(20)
            + "Privacy Policy Terms of Use All rights reserved.";
        assert!(!is_boilerplate_body(&footer), "trailing footer is not a boilerplate body");

        let leading = "Legal Information Privacy Policy Terms of Use All rights reserved. "
            .to_string()
            + &"Real prose goes here and carries the piece. ".repeat(2);
        assert!(is_boilerplate_body(&leading), "a body that OPENS with legalese is boilerplate");

        assert!(!is_boilerplate_body(""), "empty body must not divide by zero or match");
        assert!(
            !is_boilerplate_body("All rights reserved."),
            "one marker is never enough — a lone copyright line is normal"
        );
    }

    /// The shape of a blog post whose masthead lives OUTSIDE the article body:
    /// hero image, author and date in a `<header>`, prose in a separate
    /// content div. Readability picks the content div and discards the rest,
    /// which is exactly how captures lost their hero and byline.
    fn blog_with_header(extra_head: &str) -> String {
        let body: String = (1..14)
            .map(|i| format!("<p>Paragraph {i} carries the substance of the piece, with \
enough genuine prose that the extractor treats this div as the article.</p>"))
            .collect();
        format!(
            "<html><head><meta property=\"og:type\" content=\"article\">\
<meta property=\"og:image\" content=\"/img/hero.jpg\">{extra_head}</head><body>\
<header><h1>A Real Post</h1>\
<img class=\"article-header-image\" src=\"/img/hero.jpg\" alt=\"\">\
<span class=\"author\">Hannes Rudolph</span></header>\
<div data-article-content>{body}<img src=\"/img/inline.jpg\" alt=\"\"></div>\
</body></html>"
        )
    }

    #[test]
    fn a_captured_article_keeps_the_masthead_readability_discards() {
        // Reported on openclaw.ai: the capture kept the prose and dropped the
        // hero, the standfirst and the byline — everything that makes a page
        // look like the article rather than a wall of text.
        let page = blog_with_header(
            "<meta property=\"og:description\" content=\"How a small push grew into something larger.\">\
<meta property=\"article:published_time\" content=\"2026-08-30T09:00:00Z\">",
        );
        let article =
            extract_article(&page, "https://example.com/blog/post").expect("fixture must extract");
        let doc = build_article_html_document(&article, article.title.as_deref(), "https://example.com/blog/post");

        assert!(
            doc.contains("class=\"hero\"") && doc.contains("/img/hero.jpg"),
            "the hero image must survive — it lives in the page header, outside \
             the node readability picks:\n{doc}"
        );
        assert!(
            doc.contains("How a small push grew into something larger."),
            "the standfirst must be rendered:\n{doc}"
        );
        assert!(doc.contains("Aug 30, 2026"), "the date must be readable, not ISO:\n{doc}");
        assert!(doc.contains("min read"), "reading time belongs on the byline line");
    }

    #[test]
    fn the_hero_is_the_first_image_so_the_gallery_card_shows_it() {
        // The thumbnail bug was a SYMPTOM: with the hero dropped, the first
        // surviving image was an inline screenshot, and that is what the
        // gallery card rendered. Document order is what the sweep inlines
        // first, and `article_lead_image` reads the first inlined image.
        let page = blog_with_header("");
        let article = extract_article(&page, "https://example.com/blog/post").unwrap();
        let doc = build_article_html_document(&article, None, "https://example.com/blog/post");

        let first = article_image_urls(&doc).first().cloned().unwrap_or_default();
        assert!(
            first.ends_with("/img/hero.jpg"),
            "the hero must come first, or the card shows an inline screenshot: {first}"
        );
    }

    #[test]
    fn a_root_relative_hero_is_made_absolute() {
        // `og:image` is usually root-relative. A relative src in a document
        // opened from disk — Safari, Quick Look, the reader — resolves against
        // nothing and shows a broken image.
        let page = blog_with_header("");
        let article = extract_article(&page, "https://example.com/blog/post").unwrap();
        assert_eq!(
            article.hero_image.as_deref(),
            Some("https://example.com/img/hero.jpg")
        );
    }

    #[test]
    fn the_standfirst_is_dropped_when_it_merely_repeats_the_body() {
        // Readability falls back to the first sentence when a page declares no
        // description. Rendering that directly above the paragraph it was
        // taken from reads as a bug, not a subtitle.
        let page = blog_with_header("");
        let article = extract_article(&page, "https://example.com/blog/post").unwrap();
        let doc = build_article_html_document(&article, None, "https://example.com/blog/post");
        let standfirsts = doc.matches("class=\"standfirst\"").count();
        assert_eq!(
            standfirsts, 0,
            "no description was declared, so the excerpt is the body's own opening \
             and must not be shown twice:\n{doc}"
        );
    }

    #[test]
    fn the_byline_never_renders_empty_separators() {
        // Every part is optional. Joining rather than templating is what keeps
        // a page with no author or date from rendering " ·  · ".
        let bare = Article::new(Some("T".into()), "Some words here.".into(), "<p>x</p>".into());
        let doc = build_article_html_document(&bare, None, "https://example.com/a");
        assert!(!doc.contains("·  ·") && !doc.contains(">·"), "empty separators:\n{doc}");
        // The parts that ARE derivable still show.
        assert!(doc.contains("min read") && doc.contains("example.com"));
    }

    #[test]
    fn the_article_ends_with_its_attribution_above_the_source_link() {
        // Reaching the bottom of a saved page and finding only a bare URL reads
        // as a clipping. The attribution is what makes it read as an article
        // that came from somewhere — the shape Instapaper ends on.
        let mut article = Article::new(
            Some("T".into()),
            "Some words in the body.".into(),
            "<p>Some words in the body.</p>".into(),
        );
        article.byline = Some("Hannes Rudolph".into());
        article.published_time = Some("2026-08-30T09:00:00Z".into());
        let doc = build_article_html_document(&article, None, "https://example.com/a");

        let endnote = doc.find("class=\"endnote\"").expect("attribution must close the article");
        let source = doc.find("class=\"source\"").expect("source link must remain");
        assert!(endnote < source, "the attribution belongs ABOVE the link:\n{doc}");
        assert!(doc[endnote..].contains("Hannes Rudolph"));
        assert!(doc.contains("Clipped from"), "the link itself stays — only its presentation changed");
    }

    #[test]
    fn a_page_with_no_attribution_shows_no_empty_endnote() {
        // `meta` always has at least reading time, so this guards the branch
        // rather than a live case — but an empty <p> at the foot of every
        // article is exactly the kind of thing that ships unnoticed.
        let doc = build_article_html_document(
            &Article::new(None, String::new(), "<p>x</p>".into()),
            None,
            "https://example.com/a",
        );
        assert!(!doc.contains("<p class=\"endnote\"></p>"), "empty endnote:\n{doc}");
    }

    /// A capture as it was saved BEFORE the header existed: title, body,
    /// source footer, and the stylesheet of the day.
    fn legacy_capture() -> String {
        "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>A Real Post</title>\
<style>body{margin:0}</style></head><body><h1>A Real Post</h1>\
<p>The body the user already has, which must survive untouched.</p>\
<hr><p class=\"source\">Clipped from <a href=\"https://example.com/blog/post\">\
https://example.com/blog/post</a></p></body></html>\n"
            .to_string()
    }

    #[test]
    fn a_legacy_capture_gains_its_masthead_without_losing_its_body() {
        let page = blog_with_header(
            "<meta property=\"og:description\" content=\"A one-line summary.\">\
<meta property=\"article:published_time\" content=\"2026-08-30T09:00:00Z\">",
        );
        let saved = legacy_capture();
        let out = splice_article_header(&saved, &page, "https://example.com/blog/post")
            .expect("a legacy capture must be repairable");

        assert!(out.contains("class=\"standfirst\"") && out.contains("A one-line summary."));
        assert!(out.contains("class=\"byline\"") && out.contains("Aug 30, 2026"));
        assert!(out.contains("class=\"hero\"") && out.contains("/img/hero.jpg"));
        // THE POINT: the user's body is untouched.
        assert!(
            out.contains("The body the user already has, which must survive untouched."),
            "the saved body must never be replaced:\n{out}"
        );
        // And the stylesheet is upgraded, or the new markup renders unstyled.
        assert!(out.contains(".standfirst{"), "the stylesheet must be brought up to date");
    }

    #[test]
    fn the_masthead_lands_after_the_title_and_the_attribution_above_the_link() {
        let page = blog_with_header("");
        let out = splice_article_header(&legacy_capture(), &page, "https://example.com/blog/post")
            .unwrap();
        let h1 = out.find("</h1>").unwrap();
        let byline = out.find("class=\"byline\"").unwrap();
        let endnote = out.find("class=\"endnote\"").unwrap();
        let source = out.find("class=\"source\"").unwrap();
        assert!(h1 < byline && byline < endnote && endnote < source, "wrong order:\n{out}");
    }

    #[test]
    fn a_page_that_no_longer_yields_an_article_changes_nothing() {
        // What a bot-block, a paywall or a deleted page looks like. Returning
        // the document unchanged is the entire safety property: the worst case
        // must be "nothing happened", never "a good article was overwritten".
        let blocked = "<html><body><h1>Access Denied</h1><p>You don't have permission.</p></body></html>";
        assert!(
            splice_article_header(&legacy_capture(), blocked, "https://example.com/blog/post")
                .is_none(),
            "a refetch that yields no article must leave the file alone"
        );
    }

    #[test]
    fn an_article_that_already_has_a_masthead_is_left_alone() {
        // Otherwise "Update from source" would stack a second byline each time.
        let page = blog_with_header("");
        let once = splice_article_header(&legacy_capture(), &page, "https://example.com/blog/post")
            .unwrap();
        assert!(
            splice_article_header(&once, &page, "https://example.com/blog/post").is_none(),
            "repairing twice must be a no-op"
        );
    }

    #[test]
    fn a_file_we_did_not_write_is_never_touched() {
        let stranger = "<!doctype html><html><body><h1>Someone else's page</h1></body></html>";
        let page = blog_with_header("");
        assert!(
            splice_article_header(stranger, &page, "https://example.com/blog/post").is_none(),
            "no source footer means it is not our capture"
        );
    }

    #[test]
    fn the_source_url_is_readable_back_out_of_a_saved_capture() {
        // Without this there is nothing to refetch FROM — captures carry no
        // frontmatter, so the footer is the only record of where they came from.
        assert_eq!(
            article_source_url(&legacy_capture()).as_deref(),
            Some("https://example.com/blog/post")
        );
        assert_eq!(article_source_url("<html><body>nothing</body></html>"), None);
        // Ampersands are escaped in the footer and must come back usable.
        let with_query = legacy_capture().replace(
            "https://example.com/blog/post\">",
            "https://example.com/p?a=1&amp;b=2\">",
        );
        assert_eq!(
            article_source_url(&with_query).as_deref(),
            Some("https://example.com/p?a=1&b=2")
        );
    }

    /// The shape that motivated the card: a hub page with no article but a
    /// full set of `og:` tags — exactly what the share sheet previews.
    fn hub_with_og() -> String {
        "<html><head><meta property=\"og:title\" content=\"Transformational Innovation\">\
<meta property=\"og:description\" content=\"Three opportunities the CIO is watching.\">\
<meta property=\"og:image\" content=\"/img/cover.jpg\">\
<meta property=\"og:site_name\" content=\"UBS\"></head>\
<body><nav><a href=\"/a\">One</a></nav></body></html>"
            .to_string()
    }

    #[test]
    fn a_page_with_no_article_still_saves_its_preview() {
        let card = extract_page_card(&hub_with_og(), "https://www.ubs.com/x/y.html")
            .expect("a page that declares a title must yield a card");
        assert_eq!(card.title, "Transformational Innovation");
        assert_eq!(card.description.as_deref(), Some("Three opportunities the CIO is watching."));
        // Absolutised, or the image is broken in a file opened from disk.
        assert_eq!(card.image.as_deref(), Some("https://www.ubs.com/img/cover.jpg"));
        assert_eq!(card.site_name.as_deref(), Some("UBS"));
    }

    #[test]
    fn the_card_says_it_is_a_saved_link_rather_than_posing_as_an_article() {
        // #807 was a capture that LOOKED like the article and was not. A card
        // that rendered like an article would repeat that with better art.
        let card = extract_page_card(&hub_with_og(), "https://www.ubs.com/x/y.html").unwrap();
        let doc = build_card_html_document(&card, "https://www.ubs.com/x/y.html");
        assert!(doc.starts_with("<!doctype html>"), "cards are standards-mode too");
        assert!(doc.contains("Saved link"), "the card must say what it is:\n{doc}");
        assert!(doc.contains("no article we could save"), "and why:\n{doc}");
        assert!(doc.contains("Clipped from"), "the source link stays");
        assert!(doc.contains("cover.jpg"), "the image is the whole point");
    }

    #[test]
    fn a_page_with_no_title_at_all_is_left_to_the_link_note() {
        // The genuine last resort. A card with nothing to show would be worse
        // than the bare link it replaced.
        assert!(extract_page_card("<html><body><p>nothing</p></body></html>", "https://e.com/x")
            .is_none());
    }

    #[test]
    fn a_card_survives_a_page_that_declares_only_a_title() {
        let only_title = "<html><head><title>Just A Title</title></head><body></body></html>";
        let card = extract_page_card(only_title, "https://e.com/x").expect("title is enough");
        assert_eq!(card.title, "Just A Title");
        assert!(card.image.is_none() && card.description.is_none());
        let doc = build_card_html_document(&card, "https://e.com/x");
        // No empty <img> or standfirst left behind.
        assert!(!doc.contains("<img class=\"hero\" src=\"\""), "empty hero:\n{doc}");
        assert!(!doc.contains("class=\"standfirst\"></p>"), "empty standfirst:\n{doc}");
        assert!(doc.contains("e.com"), "the site still shows, derived from the URL");
    }

    #[test]
    fn repairing_an_article_that_already_leads_with_an_image_adds_no_second_one() {
        // X captures inline their cover at the top of the body, so by repair
        // time it is a `data:` URI. The header builder's own guard compares the
        // hero's REMOTE url against the body and never matches — which spliced
        // the same picture in twice, above the one already there.
        let saved = "<!doctype html>\n<html><head><title>T</title><style>x</style></head>\
<body><h1>T</h1><img src=\"data:image/jpeg;base64,AAAA\" alt=\"\">\
<p>The post body.</p>\
<hr><p class=\"source\">Clipped from <a href=\"https://example.com/blog/post\">\
https://example.com/blog/post</a></p></body></html>";
        let page = blog_with_header("");
        let out = splice_article_header(saved, &page, "https://example.com/blog/post")
            .expect("the masthead is still missing, so it must repair");

        assert_eq!(out.matches("<img").count(), 1, "the picture must not appear twice:\n{out}");
        // The rest of the masthead still lands.
        assert!(out.contains("class=\"byline\""), "byline still added:\n{out}");
    }

    #[test]
    fn a_text_only_article_still_gains_its_hero() {
        // The other half of the rule: suppressing on POSITION must not cost a
        // hero to an article that has no lead image at all.
        let page = blog_with_header("");
        let out = splice_article_header(&legacy_capture(), &page, "https://example.com/blog/post")
            .unwrap();
        assert!(out.contains("class=\"hero\""), "a text-only article keeps its hero:\n{out}");
    }

    #[test]
    fn an_image_deep_in_the_text_is_illustration_not_a_lead() {
        // An article whose only picture sits far below the fold still deserves
        // a hero — that image is illustration, not a masthead.
        let filler = "<p>Paragraph of the body carrying real prose.</p>".repeat(60);
        let saved = format!(
            "<!doctype html>\n<html><head><title>T</title><style>x</style></head>\
<body><h1>T</h1>{filler}<img src=\"data:image/jpeg;base64,AAAA\" alt=\"\">\
<hr><p class=\"source\">Clipped from <a href=\"https://example.com/blog/post\">\
https://example.com/blog/post</a></p></body></html>"
        );
        let page = blog_with_header("");
        let out = splice_article_header(&saved, &page, "https://example.com/blog/post").unwrap();
        assert!(out.contains("class=\"hero\""), "a late image must not suppress the hero");
    }

    #[test]
    fn a_fresh_x_capture_does_not_get_its_cover_twice() {
        // The reported case, on the CAPTURE path rather than the repair path.
        // An X post's cover reaches the body from syndication while the hero
        // comes from the status page's `og:image` — two URLs for one picture,
        // so comparing them never matches. Verified against a real saved file:
        // two inlined copies of the same image.
        let mut article = Article::new(
            Some("DAN KOE (@thedankoe) on X".into()),
            "The body of the post.".into(),
            "<img src=\"https://pbs.twimg.com/media/COVER?format=jpg&name=large\" alt=\"\">\
<p>The body of the post.</p>".into(),
        );
        // Same picture, different URL — exactly what defeated identity.
        article.hero_image = Some("https://pbs.twimg.com/media/COVER?format=jpg&name=900x900".into());

        let doc = build_article_html_document(&article, None, "https://x.com/thedankoe/status/1");
        assert_eq!(
            doc.matches("<img").count(),
            1,
            "the cover must appear once — the article already opens with it:\n{doc}"
        );
    }

    /// The document must parse in standards mode. Without the doctype the
    /// renderer falls back to quirks mode, which changes layout and makes iOS
    /// text autosizing more eager (#805).
    #[test]
    fn article_html_document_starts_with_a_doctype() {
        let article = Article::new(Some("T".into()), "Body".into(), "<p>Body</p>".into());
        let doc = build_article_html_document(&article, None, "https://example.com/a");
        assert!(
            doc.starts_with("<!doctype html>"),
            "document must open with the doctype, got: {:?}",
            &doc[..doc.len().min(40)]
        );
    }

}

