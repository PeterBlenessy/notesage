//! Visible-text extraction for saved HTML pages.
//!
//! A captured page is mostly markup, inline CSS/JS and base64 images. Putting
//! that into full-text search makes the index huge and the results noisy, so
//! HTML is indexed by the text a reader would see, up to a cap.
//!
//! This is a deliberately small, conservative stripper, not an HTML parser:
//! it never fails, and when the markup is malformed it prefers dropping text
//! to indexing markup.

/// Upper bound on the characters of visible text indexed per HTML file.
/// Roughly 30,000 words: far more than an article, far less than a page with
/// megabytes of inlined assets.
pub(crate) const MAX_HTML_TEXT_CHARS: usize = 200_000;

/// True for the extensions indexed through [`visible_text`].
pub(crate) fn is_html_path(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .map(|e| {
            let e = e.to_string_lossy().to_lowercase();
            e == "html" || e == "htm"
        })
        .unwrap_or(false)
}

/// Elements whose content is never visible text.
const RAW_TEXT_ELEMENTS: &[&str] = &["script", "style", "noscript", "template"];

/// Elements that do not break a word (`H<sub>2</sub>O`, `<b>w</b>ord`). Every
/// other tag separates the text on either side of it.
const INLINE_ELEMENTS: &[&str] = &[
    "a", "abbr", "b", "bdi", "bdo", "cite", "code", "del", "dfn", "em", "font", "i", "ins",
    "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u",
    "var", "wbr",
];

/// Extract the visible text of an HTML document: tags, comments, and the
/// contents of `<script>`/`<style>`/`<noscript>`/`<template>` are dropped,
/// common entities decoded, `data:` URIs removed and whitespace collapsed to
/// single spaces. At most `max_chars` characters are returned, cut at a word
/// boundary.
pub(crate) fn visible_text(html: &str, max_chars: usize) -> String {
    let mut out = Collector {
        text: String::new(),
        chars: 0,
        word: String::new(),
        max: max_chars,
        full: false,
    };
    let bytes = html.as_bytes();
    // `i` is always on a char boundary: it only advances past whole chars,
    // or to just after an ASCII delimiter found by `find`.
    let mut i = 0;

    while i < bytes.len() && !out.full {
        match bytes[i] {
            b'<' => {
                let rest = &html[i..];
                if rest.starts_with("<!--") {
                    i = match rest.find("-->") {
                        Some(p) => i + p + 3,
                        None => bytes.len(),
                    };
                    out.break_word();
                    continue;
                }
                match tag_at(rest) {
                    // Not a tag ("a < b"): literal text.
                    None => {
                        out.push('<');
                        i += 1;
                    }
                    Some(tag) => {
                        i += tag.len;
                        if !tag.closing && contains_name(RAW_TEXT_ELEMENTS, tag.name) {
                            i = skip_past_close(html, i, tag.name);
                        }
                        if !contains_name(INLINE_ELEMENTS, tag.name) {
                            out.break_word();
                        }
                    }
                }
            }
            b'&' => {
                let (ch, len) = decode_entity(&html[i..]);
                out.push_char(ch);
                i += len;
            }
            _ => {
                // Safe: `i` is on a char boundary and in range.
                let ch = html[i..].chars().next().unwrap_or(' ');
                out.push_char(ch);
                i += ch.len_utf8();
            }
        }
    }
    out.finish()
}

struct Collector {
    text: String,
    chars: usize,
    word: String,
    max: usize,
    full: bool,
}

impl Collector {
    fn push(&mut self, ch: char) {
        self.word.push(ch);
    }

    fn push_char(&mut self, ch: char) {
        if ch.is_whitespace() || ch == '\u{a0}' {
            self.break_word();
        } else {
            self.word.push(ch);
        }
    }

    fn break_word(&mut self) {
        if self.word.is_empty() {
            return;
        }
        let word = std::mem::take(&mut self.word);
        if is_data_uri(&word) {
            return;
        }
        let word_chars = word.chars().count();
        let separator = usize::from(!self.text.is_empty());
        if self.chars + separator + word_chars > self.max {
            self.full = true;
            return;
        }
        if separator == 1 {
            self.text.push(' ');
        }
        self.text.push_str(&word);
        self.chars += separator + word_chars;
    }

    fn finish(mut self) -> String {
        if !self.full {
            self.break_word();
        }
        self.text
    }
}

/// A `data:` URI that ended up in text (`url(data:image/png;base64,...)`).
fn is_data_uri(word: &str) -> bool {
    word.len() > 32 && word.to_ascii_lowercase().contains("data:")
}

fn contains_name(set: &[&str], name: &str) -> bool {
    set.iter().any(|n| n.eq_ignore_ascii_case(name))
}

struct Tag<'a> {
    /// Element name as written (compare case-insensitively); `"!"` for
    /// declarations and processing instructions.
    name: &'a str,
    closing: bool,
    /// Bytes from `<` through the closing `>`.
    len: usize,
}

/// Parse the tag starting at `rest[0] == '<'`, or `None` when this `<` does
/// not start a tag.
fn tag_at(rest: &str) -> Option<Tag<'_>> {
    let bytes = rest.as_bytes();
    let mut pos = 1;
    let closing = bytes.get(pos) == Some(&b'/');
    if closing {
        pos += 1;
    }
    let name = match bytes.get(pos) {
        Some(b'!') | Some(b'?') if !closing => "!",
        Some(c) if c.is_ascii_alphabetic() => {
            let start = pos;
            while bytes.get(pos).is_some_and(|c| c.is_ascii_alphanumeric()) {
                pos += 1;
            }
            &rest[start..pos]
        }
        _ => return None,
    };
    Some(Tag {
        name,
        closing,
        len: tag_end(rest, pos),
    })
}

/// Index just past the `>` that closes the tag, honouring quoted attribute
/// values (which may contain `>`). An unterminated quote falls back to the
/// first `>`; an unterminated tag swallows the rest of the document.
fn tag_end(rest: &str, from: usize) -> usize {
    let bytes = rest.as_bytes();
    let mut pos = from;
    while pos < bytes.len() {
        match bytes[pos] {
            b'>' => return pos + 1,
            quote @ (b'"' | b'\'') => match bytes[pos + 1..].iter().position(|b| *b == quote) {
                Some(close) => pos += close + 2,
                None => break,
            },
            _ => pos += 1,
        }
    }
    match rest[from..].find('>') {
        Some(p) => from + p + 1,
        None => rest.len(),
    }
}

/// Index just past the `</name ...>` that closes a raw-text element opened
/// before `from`, or the end of the document when it is never closed.
fn skip_past_close(html: &str, from: usize, name: &str) -> usize {
    let mut search = from;
    while let Some(p) = html[search..].find("</") {
        let name_start = search + p + 2;
        let name_end = name_start + name.len();
        let matches = html
            .get(name_start..name_end)
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(name))
            && !html
                .as_bytes()
                .get(name_end)
                .is_some_and(|c| c.is_ascii_alphanumeric());
        if matches {
            return match html[name_end..].find('>') {
                Some(close) => name_end + close + 1,
                None => html.len(),
            };
        }
        search = name_start;
    }
    html.len()
}

/// Decode the entity at `rest[0] == '&'`. Returns the character and the bytes
/// consumed; an unknown or malformed entity yields a literal `&`.
fn decode_entity(rest: &str) -> (char, usize) {
    let window = &rest.as_bytes()[..rest.len().min(12)];
    let Some(end) = window.iter().position(|b| *b == b';') else {
        return ('&', 1);
    };
    let name = &rest[1..end];
    let decoded = if let Some(num) = name.strip_prefix('#') {
        let code = match num.strip_prefix(['x', 'X']) {
            Some(hex) => u32::from_str_radix(hex, 16).ok(),
            None => num.parse::<u32>().ok(),
        };
        code.and_then(char::from_u32)
    } else {
        match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            "ndash" => Some('\u{2013}'),
            "mdash" => Some('\u{2014}'),
            "hellip" => Some('\u{2026}'),
            "lsquo" => Some('\u{2018}'),
            "rsquo" => Some('\u{2019}'),
            "ldquo" => Some('\u{201c}'),
            "rdquo" => Some('\u{201d}'),
            "copy" => Some('\u{a9}'),
            _ => None,
        }
    };
    match decoded {
        Some(ch) => (ch, end + 1),
        None => ('&', 1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"<!DOCTYPE html>
<html><head>
<title>Saved &amp; Sound</title>
<style>body { font-family: "Helvetica"; background: url(data:image/png;base64,AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH); }</style>
<script type="text/javascript">var secretToken = "<p>not visible</p>"; if (a < b) { track(); }</script>
</head>
<body class="article" data-note="a > b">
<!-- hidden editorial comment -->
<h1>Quiet&nbsp;Mornings</h1>
<p>The <b>caf</b>é opens at&#32;seven &mdash; H<sub>2</sub>O is free.</p>
<img alt="Chart" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk">
<noscript><p>enable javascript please</p></noscript>
<p>5 &lt; 7 and a < b</p>
<SCRIPT>window.late = 1</SCRIPT>
<p>Closing words.</p>
</body></html>"#;

    #[test]
    fn keeps_visible_text_only() {
        let text = visible_text(FIXTURE, MAX_HTML_TEXT_CHARS);
        assert_eq!(
            text,
            "Saved & Sound Quiet Mornings The café opens at seven \u{2014} H2O is free. \
             5 < 7 and a < b Closing words."
        );
    }

    #[test]
    fn drops_markup_scripts_styles_comments_and_data_uris() {
        let text = visible_text(FIXTURE, MAX_HTML_TEXT_CHARS);
        for forbidden in [
            "secretToken",
            "not visible",
            "font-family",
            "base64",
            "iVBORw0KGgo",
            "editorial",
            "javascript",
            "window.late",
            "class=",
            "DOCTYPE",
            "<",
        ] {
            // The fixture has literal "<" in prose, so only check markup-ish ones.
            if forbidden == "<" {
                assert!(!text.contains("<p"), "tag leaked: {}", text);
                continue;
            }
            assert!(!text.contains(forbidden), "{:?} leaked into: {}", forbidden, text);
        }
    }

    #[test]
    fn respects_the_cap_at_a_word_boundary() {
        let html = format!("<p>{}</p>", "alpha beta gamma delta ".repeat(1000));
        let text = visible_text(&html, 50);
        assert!(text.chars().count() <= 50, "{} chars", text.chars().count());
        assert_eq!(text, "alpha beta gamma delta alpha beta gamma delta");
        // And the cap is in characters, not bytes.
        let text = visible_text("<p>åäö åäö åäö</p>", 7);
        assert_eq!(text, "åäö åäö");
    }

    #[test]
    fn a_data_uri_in_text_is_dropped() {
        let html = "<pre>before data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA after</pre>";
        assert_eq!(visible_text(html, 1000), "before after");
    }

    #[test]
    fn malformed_markup_never_indexes_markup() {
        // Unterminated tag: the rest is dropped, not indexed.
        assert_eq!(visible_text("ok <div class=\"x", 1000), "ok");
        // Unterminated script: its body is dropped.
        assert_eq!(visible_text("ok <script>var a = 1;", 1000), "ok");
        // Unterminated comment.
        assert_eq!(visible_text("ok <!-- never closed", 1000), "ok");
        // Unknown entity stays literal.
        assert_eq!(visible_text("R&D &bogus; x", 1000), "R&D &bogus; x");
        assert_eq!(visible_text("", 1000), "");
    }

    #[test]
    fn html_paths_are_detected_by_extension() {
        assert!(is_html_path("/a/Page.html"));
        assert!(is_html_path("/a/Page.HTM"));
        assert!(!is_html_path("/a/page.md"));
        assert!(!is_html_path("/a/html"));
    }
}
