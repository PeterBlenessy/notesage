/// Embedded CSS for standalone HTML documents.
/// Returns CSS for the specified theme ("light" or "dark").
pub fn html_css(theme: &str) -> &'static str {
    match theme {
        "dark" => DARK_CSS,
        _ => LIGHT_CSS,
    }
}

const LIGHT_CSS: &str = r##"
:root {
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted-bg: #f2f2f2;
  --muted-fg: #737373;
  --border: #e5e5e5;
  --code-bg: #f5f5f5;
  --link-color: #1a1a1a;
  --callout-note-border: #5B7B9E;
  --callout-note-bg: #F0F4F8;
  --callout-tip-border: #4A9E6B;
  --callout-tip-bg: #F0F8F3;
  --callout-warning-border: #B8860B;
  --callout-warning-bg: #FDF8F0;
  --callout-important-border: #C0392B;
  --callout-important-bg: #FDF0F0;
}

* { box-sizing: border-box; }

body {
  font-family: "Inter", "SF Pro Display", "SF Pro Text", system-ui, -apple-system, sans-serif;
  font-size: 16px;
  line-height: 1.7;
  color: var(--fg);
  background: var(--bg);
  margin: 0;
  padding: 0;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.notesage-document {
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 24px;
}

/* Typography */
h1, h2, h3, h4, h5, h6 {
  color: var(--fg);
  font-weight: 600;
  line-height: 1.3;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}
h1 { font-size: 2em; margin-top: 0; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1.1em; }
h5 { font-size: 1em; }
h6 { font-size: 0.9em; color: var(--muted-fg); }

p { margin: 0 0 1em; }

a {
  color: var(--link-color);
  text-decoration: underline;
  text-decoration-color: var(--border);
  text-underline-offset: 2px;
}
a:hover { text-decoration-color: var(--fg); }

/* Lists */
ul, ol { margin: 0 0 1em; padding-left: 1.5em; }
li { margin-bottom: 0.25em; }
li > ul, li > ol { margin-bottom: 0; }

/* Task lists — comrak outputs <li><p><input type="checkbox"> text</p></li> */
li.task-item {
  list-style: none;
  margin-left: -1.2em;
}
.checkbox {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--border);
  border-radius: 3px;
  vertical-align: middle;
  margin-right: 6px;
  position: relative;
}
.checkbox.checked {
  background: var(--fg);
  border-color: var(--fg);
}
.checkbox.checked::after {
  content: "\2713";
  color: var(--bg);
  font-size: 12px;
  position: absolute;
  top: -1px;
  left: 2px;
}

/* Blockquotes */
blockquote {
  border-left: 3px solid var(--border);
  margin: 0 0 1em;
  padding: 0.5em 1em;
  color: var(--muted-fg);
}
blockquote p:last-child { margin-bottom: 0; }

/* Code */
code {
  font-family: "JetBrains Mono", "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 0.875em;
  background: var(--code-bg);
  padding: 2px 6px;
  border-radius: 4px;
}
pre {
  margin: 0 0 1em;
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 0.875em;
  line-height: 1.5;
}
pre code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
}

/* Tables */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 1em;
  font-size: 0.9em;
}
thead th {
  text-align: left;
  font-weight: 600;
  padding: 8px 12px;
  border-bottom: 2px solid var(--border);
  background: var(--muted-bg);
}
tbody td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
tbody tr:hover { background: var(--muted-bg); }
tfoot td {
  padding: 8px 12px;
  font-weight: 600;
  font-size: 0.9em;
  color: var(--muted-fg);
  background: var(--muted-bg);
  border-top: 2px solid var(--border);
}

/* Horizontal rule */
hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 2em 0;
}

/* Images */
img {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 1em 0;
}

/* Strikethrough */
del { color: var(--muted-fg); }

/* Footnotes */
.footnotes {
  margin-top: 2em;
  padding-top: 1em;
  border-top: 1px solid var(--border);
  font-size: 0.85em;
  color: var(--muted-fg);
}

/* Callout overrides (inline styles are primary, these are fallback) */
.callout { margin: 16px 0; }
.callout-content p:last-child { margin-bottom: 0; }

/* Link preview cards */
.link-preview { display: block; }

/* Drawing placeholders */
.drawing-placeholder {
  padding: 24px;
  text-align: center;
  color: var(--muted-fg);
  border: 1px dashed var(--border);
  border-radius: 8px;
  margin: 16px 0;
}

/* Print-safe defaults — ensure embedded media scales within page bounds */
img, svg, .chart-block, .drawing-block, .mermaid-svg-container {
  max-width: 100%;
  height: auto;
}

/* Print styles */
@media print {
  body { font-size: 12pt; }
  .notesage-document { max-width: none; padding: 0; }
  a { color: inherit; text-decoration: none; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 0.8em; color: #666; }
  pre { white-space: pre-wrap; word-break: break-all; }

  /* Prevent breaking inside content blocks */
  pre, table, .chart-block, .drawing-block, .mermaid-block,
  .mermaid-svg-container, blockquote, .callout, figure {
    break-inside: avoid;
  }

  /* Don't strand headings at page bottom */
  h1, h2, h3, h4, h5, h6 {
    page-break-after: avoid;
    break-after: avoid;
  }

  /* Orphan/widow control */
  p {
    orphans: 3;
    widows: 3;
  }
}
"##;

const DARK_CSS: &str = r##"
:root {
  --bg: #262626;
  --fg: #fafafa;
  --muted-bg: #3d3d3d;
  --muted-fg: #a3a3a3;
  --border: #404040;
  --code-bg: #2d2d2d;
  --link-color: #fafafa;
  --callout-note-border: #7BA3C7;
  --callout-note-bg: #2A3542;
  --callout-tip-border: #6BC78E;
  --callout-tip-bg: #2A3F32;
  --callout-warning-border: #D4A017;
  --callout-warning-bg: #3F3520;
  --callout-important-border: #E05B4F;
  --callout-important-bg: #3F2A2A;
}

* { box-sizing: border-box; }

body {
  font-family: "Inter", "SF Pro Display", "SF Pro Text", system-ui, -apple-system, sans-serif;
  font-size: 16px;
  line-height: 1.7;
  color: var(--fg);
  background: var(--bg);
  margin: 0;
  padding: 0;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.notesage-document {
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 24px;
}

h1, h2, h3, h4, h5, h6 {
  color: var(--fg);
  font-weight: 600;
  line-height: 1.3;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}
h1 { font-size: 2em; margin-top: 0; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1.1em; }
h5 { font-size: 1em; }
h6 { font-size: 0.9em; color: var(--muted-fg); }

p { margin: 0 0 1em; }

a {
  color: var(--link-color);
  text-decoration: underline;
  text-decoration-color: var(--border);
  text-underline-offset: 2px;
}
a:hover { text-decoration-color: var(--fg); }

ul, ol { margin: 0 0 1em; padding-left: 1.5em; }
li { margin-bottom: 0.25em; }
li > ul, li > ol { margin-bottom: 0; }

li:has(input[type="checkbox"]) { list-style: none; margin-left: -1.2em; }
input[type="checkbox"] {
  -webkit-appearance: none;
  appearance: none;
  display: inline-block !important;
  width: 16px;
  height: 16px;
  min-width: 16px;
  min-height: 16px;
  border: 1.5px solid var(--border);
  border-radius: 3px;
  vertical-align: middle;
  margin: 0 6px 0 0;
  padding: 0;
  cursor: default;
}
input[type="checkbox"]:checked {
  background: var(--fg);
  border-color: var(--fg);
}
input[type="checkbox"]:checked::after {
  content: "\2713";
  color: var(--bg);
  font-size: 12px;
  position: absolute;
  top: -1px;
  left: 2px;
}

blockquote {
  border-left: 3px solid var(--border);
  margin: 0 0 1em;
  padding: 0.5em 1em;
  color: var(--muted-fg);
}
blockquote p:last-child { margin-bottom: 0; }

code {
  font-family: "JetBrains Mono", "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 0.875em;
  background: var(--code-bg);
  padding: 2px 6px;
  border-radius: 4px;
}
pre {
  margin: 0 0 1em;
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 0.875em;
  line-height: 1.5;
}
pre code { background: none; padding: 0; border-radius: 0; font-size: inherit; }

table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 1em;
  font-size: 0.9em;
}
thead th {
  text-align: left;
  font-weight: 600;
  padding: 8px 12px;
  border-bottom: 2px solid var(--border);
  background: var(--muted-bg);
}
tbody td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
tbody tr:hover { background: var(--muted-bg); }
tfoot td {
  padding: 8px 12px;
  font-weight: 600;
  font-size: 0.9em;
  color: var(--muted-fg);
  background: var(--muted-bg);
  border-top: 2px solid var(--border);
}

hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }

img { max-width: 100%; height: auto; border-radius: 8px; margin: 1em 0; }

del { color: var(--muted-fg); }

.footnotes {
  margin-top: 2em;
  padding-top: 1em;
  border-top: 1px solid var(--border);
  font-size: 0.85em;
  color: var(--muted-fg);
}

.callout { margin: 16px 0; }
.callout-content p:last-child { margin-bottom: 0; }
.link-preview { display: block; }
.drawing-placeholder {
  padding: 24px;
  text-align: center;
  color: var(--muted-fg);
  border: 1px dashed var(--border);
  border-radius: 8px;
  margin: 16px 0;
}

/* Print-safe defaults — ensure embedded media scales within page bounds */
img, svg, .chart-block, .drawing-block, .mermaid-svg-container {
  max-width: 100%;
  height: auto;
}

@media print {
  body { font-size: 12pt; background: white; color: black; }
  .notesage-document { max-width: none; padding: 0; }
  a { color: inherit; text-decoration: none; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 0.8em; color: #666; }
  pre { white-space: pre-wrap; word-break: break-all; }

  /* Prevent breaking inside content blocks */
  pre, table, .chart-block, .drawing-block, .mermaid-block,
  .mermaid-svg-container, blockquote, .callout, figure {
    break-inside: avoid;
  }

  /* Don't strand headings at page bottom */
  h1, h2, h3, h4, h5, h6 {
    page-break-after: avoid;
    break-after: avoid;
  }

  /* Orphan/widow control */
  p {
    orphans: 3;
    widows: 3;
  }
}
"##;

/// Build a complete HTML document from body content and CSS.
///
/// `header_footer_html` contains optional visible header/footer elements
/// to display in screen mode. The header is placed before the article,
/// the footer after it. Pass an empty string if no header/footer.
pub fn wrap_html_document(body: &str, title: &str, theme: &str, css: &str, header_footer_html: &str) -> String {
    let data_theme = match theme {
        "dark" => "dark",
        _ => "light",
    };

    // Split header/footer HTML into header (before article) and footer (after article)
    let (header_html, footer_html) = split_header_footer_html(header_footer_html);

    format!(
        r#"<!DOCTYPE html>
<html lang="en" data-theme="{}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="Notesage">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
  <title>{}</title>
  <style>{}</style>
</head>
<body>
{}  <article class="notesage-document">
{}
  </article>
{}
</body>
</html>"#,
        data_theme,
        html_escape_title(title),
        css,
        header_html,
        body,
        footer_html,
    )
}

/// Split combined header/footer HTML into separate parts.
/// Header elements have class "notesage-page-header", footer elements have "notesage-page-footer".
fn split_header_footer_html(html: &str) -> (String, String) {
    let mut header = String::new();
    let mut footer = String::new();

    for line in html.lines() {
        if line.contains("notesage-page-header") {
            header.push_str("  ");
            header.push_str(line);
            header.push('\n');
        } else if line.contains("notesage-page-footer") {
            footer.push_str("  ");
            footer.push_str(line);
            footer.push('\n');
        }
    }

    (header, footer)
}

/// Escape HTML special characters in the document title.
fn html_escape_title(title: &str) -> String {
    title
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
