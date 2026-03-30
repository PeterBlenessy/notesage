# PRD: HTML Preview & Export

|  |  |
| --- | --- |
| **Date** | 2026-03-30 |
| **Status** | Complete |
| **Priority** | Medium |
| **Impact** | Users can preview documents as standalone HTML pages and export for web sharing |
| **Research** | [document-format-enhancements](../research/2026-03-30-document-format-enhancements.md) |
| **Tasks** | [html-preview-tasks](../tasks/2026-03-30-html-preview-tasks.md) |

## Problem

Notesage can export to PDF (via Typst) but has no HTML output path. Users who want to share documents on the web, paste formatted content into emails, or preview how their markdown will look as a rendered page have no option within the app. They must copy markdown to an external tool, losing Notesage-specific features like callout blocks, sparklines, link preview cards, and drawing embeds.

HTML is the most portable document format — every browser can open it, every email client can paste it, every CMS can import it. A standalone HTML export with embedded styles (no external dependencies) gives users a universal sharing format that preserves the full visual fidelity of their documents.

## Goals

1. **HTML preview** — Live preview of the current document as rendered HTML in a sandboxed iframe, with theme-matched styling
2. **HTML export** — Save as a self-contained `.html` file via native save dialog
3. **Copy HTML to clipboard** — One-click copy of styled HTML for pasting into emails, websites, and rich text editors
4. **Full feature parity** — All Notesage-specific markdown extensions render correctly: callout blocks, dynamic table footers, sparklines (as inline SVG), drawing blocks, link preview cards, text colors, highlights
5. **Context menu integration** — Right-click `.md` file in sidebar for "Preview as HTML" and "Export as HTML"

## Non-Goals

- WYSIWYG HTML editing (this is a one-way render from markdown)
- Custom HTML templates or template selection (unlike PDF export, HTML uses a single clean template — custom templates are a future enhancement)
- Server-side rendering or static site generation
- CSS customization UI (the output uses the current theme; advanced users can edit the exported file)
- Partial document export (always exports the full document)
- JavaScript in exported HTML (output is pure HTML + CSS — no scripts, no interactivity)

## User Stories

- As a writer, I want to preview my document as HTML so I can see how it will look on the web before sharing
- As a user, I want to export my notes as a standalone `.html` file so I can share them with anyone who has a browser
- As a user, I want to copy formatted HTML to my clipboard so I can paste it into Gmail, Notion, or a CMS without losing formatting
- As a user, I want callout blocks, tables with summaries, and sparkline charts to render correctly in HTML output
- As a user, I want the HTML preview to match my current theme (light/dark) so I can see an accurate representation
- As a user, I want to right-click a markdown file in the sidebar and export it as HTML without opening it first

## Technical Approach

### Backend: Tauri Command

A new Tauri command in `src-tauri/src/commands/export.rs` converts markdown to a complete HTML document:

```rust
#[tauri::command]
pub async fn render_html(
    markdown: String,
    title: String,
    theme: String,           // "light" | "dark"
    include_styles: bool,    // true for standalone, false for clipboard (inline styles only)
    project_root: Option<String>,
) -> Result<String, String>
```

**Pipeline:**

1. Strip YAML frontmatter (same logic as `markdown_to_typst`)
2. Pre-process Notesage extensions before comrak parsing:
   - Extract `> [!type]` callout blocks → placeholder divs
   - Extract `> [!link](url)` link preview blocks → placeholder cards
   - Extract `{{spark:...}}` patterns → placeholder spans
   - Extract `<!-- type:number,summary:sum -->` table metadata → store for post-processing
   - Rewrite `.excalidraw` image references → `.svg` paths (same as PDF export)
3. Parse markdown with comrak (GFM extensions: tables, task lists, strikethrough, autolinks, footnotes)
4. Enable comrak's `syntect` code highlighting for syntax-highlighted code blocks with inline styles
5. Post-process the HTML output:
   - Replace callout placeholders with styled `<div>` elements (icon + colored border + background)
   - Replace link preview placeholders with styled `<a>` cards (title, description, favicon, image)
   - Replace sparkline placeholders with inline `<svg>` elements (polyline chart)
   - Compute table aggregation footers and append `<tfoot>` rows
   - Strip table metadata comments from rendered header cells
   - Apply text color and highlight spans
6. Wrap in full HTML document with embedded `<style>` block

**Why comrak (not ProseMirror serialization):**

- comrak is already a Cargo dependency (v0.50.0) with `syntect` for syntax highlighting
- The same library is used for the document index parser and the PDF export pipeline
- Server-side rendering avoids shipping a headless browser or DOM library
- Consistent output regardless of editor state (works on files that aren't currently open)
- The PDF export already solves the same custom-extension rendering problem (callouts, sparklines, link previews, drawings, table metadata) in `markdown_to_typst.rs` — the HTML renderer follows the same pattern

### Frontend: HTML Preview Viewer

A new viewer component `HtmlViewer.tsx` in `src/components/editor/viewers/`, following the same pattern as `PdfViewer.tsx` and `EpubViewer.tsx`:

- Renders HTML in a sandboxed `<iframe>` with `sandbox="allow-same-origin"` (no scripts, no forms, no popups)
- Iframe uses `srcdoc` attribute to inject the rendered HTML directly (no file:// URL needed)
- Theme-reactive: re-renders when the user toggles light/dark mode
- Find in document (Cmd+F) via the shared `dom-search.ts` utility operating on the iframe's content document

**Preview toolbar** (anchored above the iframe, same position as the PDF viewer toolbar):

- "Export HTML" button → native save dialog (`.html` extension)
- "Copy HTML" button → copies styled HTML to clipboard for pasting into rich text contexts
- Theme indicator showing which theme the preview uses

### Preview Mode Toggle

Add "Preview as HTML" to the existing view mode system:

- Source mode toggle already exists (WYSIWYG ↔ Source)
- Add a third mode: Preview (HTML rendered output)
- Accessible via: toolbar button, command palette action, keyboard shortcut (Cmd+Shift+P), right-click context menu
- Preview mode is read-only — switching back to WYSIWYG or Source restores editing

### Context Menu Integration

Extend the sidebar file context menu for `.md` files:

- "Preview as HTML" — opens the file in a tab with the HTML preview viewer active
- "Export as HTML" — renders and saves without opening a preview (same flow as PDF export from context menu)

### Clipboard Copy

The "Copy HTML" button produces HTML suitable for pasting into rich text editors:

- Uses the `text/html` MIME type on the clipboard
- Strips the `<!DOCTYPE>`, `<html>`, `<head>` wrapper — only the `<body>` content with inline styles
- Preserves formatting: headings, lists, code blocks, tables, callouts render correctly in Gmail, Notion, Google Docs
- Falls back to `text/plain` (the raw markdown) as a secondary clipboard format

### Standalone HTML Document Structure

The exported `.html` file is a complete, self-contained document:

```html
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="Notesage">
  <title>Document Title</title>
  <style>
    /* Embedded CSS — no external dependencies */
    /* Typography: Inter (system fallback), Source Serif 4, JetBrains Mono */
    /* Theme colors from globals.css mapped to static values */
    /* Responsive: max-width 720px centered content */
    /* Print styles: clean output when printing from browser */
  </style>
</head>
<body>
  <article class="notesage-document">
    <!-- Rendered content -->
  </article>
</body>
</html>
```

**Key properties:**

- No external stylesheets, fonts, scripts, or images (except embedded SVGs and data URIs)
- Font stack uses system fonts with fallbacks (`"Inter", "SF Pro Display", system-ui` for body; `"JetBrains Mono", "SF Mono", "Fira Code", monospace` for code)
- Max content width of 720px, centered — matching the editor's typeset feel
- Print-friendly: `@media print` styles for clean browser printing
- Drawing SVGs embedded inline (read from `.svg` sidecar files, base64-encoded if needed)

## Rendered Feature Mapping

Every Notesage markdown extension must render correctly in HTML output:

| Feature | Markdown Syntax | HTML Output |
| --- | --- | --- |
| Callout (Note) | `> [!note]\n> Content` | `<div class="callout callout-note">` with info icon, blue-grey border |
| Callout (Tip) | `> [!tip]\n> Content` | `<div class="callout callout-tip">` with lightbulb icon, green-grey border |
| Callout (Warning) | `> [!warning]\n> Content` | `<div class="callout callout-warning">` with alert icon, amber-grey border |
| Callout (Important) | `> [!important]\n> Content` | `<div class="callout callout-important">` with exclamation icon, red-grey border |
| Table metadata | `<!-- type:currency,summary:sum -->` | Metadata stripped from display; footer `<tfoot>` row with computed aggregation |
| Sparkline | `{{spark:12,15,9,22,18}}` | Inline `<svg>` polyline (\~60x20px) with muted stroke color |
| Drawing | `<div data-drawing-id="path" data-type="drawing" class="drawing-block"></div>` | `<img>` with embedded SVG (base64 data URI from `.svg` sidecar) |
| Link preview | `> [!link](url)` | Styled `<a>` card with title, description, favicon placeholder |
| Text color | Tiptap marks | `<span style="color: ...">` |
| Highlight | Tiptap marks | `<mark>` with background color |
| Task list | `- [x] Done` | `<input type="checkbox" disabled checked>` (comrak default) |
| Code block | ```` ```lang ``` ```` | `<pre><code>` with syntect inline syntax highlighting |
| Footnotes | `[^1]` | `<sup>` links with `<section class="footnotes">` at document end |

## CSS Theme Mapping

The embedded CSS maps Notesage's oklch color palette to static CSS values for both themes:

**Light theme:**

```css
:root[data-theme="light"] {
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted-bg: #f2f2f2;
  --muted-fg: #737373;
  --border: #e5e5e5;
  --code-bg: #f5f5f5;
}
```

**Dark theme:**

```css
:root[data-theme="dark"] {
  --bg: #262626;
  --fg: #fafafa;
  --muted-bg: #3d3d3d;
  --muted-fg: #a3a3a3;
  --border: #404040;
  --code-bg: #2d2d2d;
}
```

These are static approximations of the oklch values — the exported HTML doesn't depend on oklch browser support.

## Security

**XSS prevention:**

- comrak's `unsafe_` option is NOT enabled — raw HTML in markdown is escaped by default
- The `render_html` command never passes user content through as raw HTML
- Callout/sparkline/link-preview rendering uses string templates, not `innerHTML`
- The iframe preview uses `sandbox="allow-same-origin"` — no script execution
- Exported HTML contains no `<script>` tags

**Content Security Policy:**

The standalone HTML includes a CSP meta tag:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
```

This prevents any accidental script injection if the file is served from a web server.

## Data Model

### New Tauri Commands

| Command | Parameters | Returns |
| --- | --- | --- |
| `render_html` | `markdown`, `title`, `theme`, `include_styles`, `project_root` | `String` (full HTML document or body fragment) |

No new Zustand stores needed. Preview state (which mode the viewer is in) is tracked in the existing `editor-store` tab model.

### Editor Store Extension

Add an optional `viewMode` field to the tab model:

```typescript
interface Tab {
  // ... existing fields
  viewMode?: 'wysiwyg' | 'source' | 'html-preview';
}
```

## Dependencies

**No new dependencies required.**

- comrak (existing, v0.50.0 with `syntect`) — markdown parsing and syntax highlighting
- Tauri `save` dialog (existing) — native file save
- `dom-search.ts` (existing) — find in document for iframe content
- `srcdoc` iframe attribute (web standard) — no additional library

## Files

| File | Change |
| --- | --- |
| `src-tauri/src/commands/export.rs` | Add `render_html` command |
| `src-tauri/src/export/mod.rs` | Add `markdown_to_html` module |
| `src-tauri/src/export/markdown_to_html.rs` | **New** — comrak-based HTML renderer with Notesage extensions |
| `src-tauri/src/export/html_styles.rs` | **New** — embedded CSS templates (light + dark themes) |
| `src-tauri/src/lib.rs` | Register `render_html` in `generate_handler![]` |
| `src/components/editor/viewers/HtmlViewer.tsx` | **New** — sandboxed iframe HTML preview with toolbar |
| `src/components/editor/Editor.tsx` | Route `html-preview` view mode to `HtmlViewer` |
| `src/components/editor/Toolbar.tsx` | Add HTML preview toggle button |
| `src/stores/editor-store.ts` | Add `viewMode` to tab model |
| `src/components/sidebar/FileTreeItem.tsx` | Add "Preview as HTML" / "Export as HTML" context menu items |
| `src/components/CommandPalette.tsx` | Add "Preview as HTML" action |
| `src/hooks/useFileOperations.ts` | Add `exportHtml()` helper |
| `docs/features/document-formats.md` | Document HTML preview & export |
| `docs/keyboard-shortcuts.md` | Add Cmd+Shift+P shortcut |

## UI/UX

### Preview Toolbar

```
┌─────────────────────────────────────────────────┐
│  ◉ HTML Preview  │  📋 Copy HTML  │  💾 Export  │
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│                                                 │
│           ┌──────────────────────┐              │
│           │  <h1>Document Title  │              │
│           │                      │              │
│           │  Paragraph text...   │              │
│           │                      │              │
│           │  ┌─ Note ─────────┐  │              │
│           │  │ Callout content │  │              │
│           │  └────────────────┘  │              │
│           │                      │              │
│           │  | Col | Col | Col | │              │
│           │  |-----|-----|------| │              │
│           │  | ... | ... | ╱╲╱ | │              │
│           │  └──── Sum: 42 ────┘ │              │
│           └──────────────────────┘              │
│                                                 │
└─────────────────────────────────────────────────┘
```

- Toolbar uses the same muted style as the PDF viewer toolbar
- Content is centered at max-width 720px within the iframe
- Callouts render with left border, icon, and subtle background
- Sparklines render as inline SVGs in table cells
- Table footers show aggregation results

### View Mode Switching

The toolbar gains a small segmented control or dropdown for view modes:

```
[ WYSIWYG | Source | Preview ]
```

- Active mode highlighted with `bg-primary` background
- Transitions are instant (no animation between modes)
- Preview mode triggers a `render_html` call and displays the result in the iframe
- Switching away from preview returns to the previous editing mode

## Quality Gates

### Functional

- [x] `render_html` Tauri command returns valid HTML for all markdown features

- [x] Callout blocks render with correct icon, border color, and background

- [x] Table metadata comments stripped from rendered output

- [x] Table aggregation footers computed and rendered as `<tfoot>`

- [x] Sparklines render as inline SVG with correct polyline path

- [x] Drawing blocks embed SVG from sidecar files

- [x] Link preview cards render with title and URL

- [x] Code blocks have syntax highlighting via syntect

- [x] Task list checkboxes render as disabled checkboxes

- [x] Footnotes render with superscript links and footnote section

- [ ] Text colors and highlights preserved in output

- [ ] Standalone HTML opens correctly in Safari, Chrome, and Firefox

- [x] Exported HTML has no external dependencies (fully self-contained)

- [x] Preview iframe updates when theme is toggled (light ↔ dark)

### Security

- [x] Raw HTML in markdown is escaped (comrak `unsafe_` not enabled)

- [x] Iframe uses `sandbox` attribute — no script execution

- [x] Exported HTML contains no `<script>` tags

- [x] CSP meta tag prevents script injection when file is served

- [x] No user input passed through as raw HTML

### Clipboard

- [x] "Copy HTML" puts `text/html` on clipboard

- [ ] Pasting into Gmail preserves headings, lists, code blocks, and tables

- [ ] Pasting into Google Docs preserves basic formatting

- [x] `text/plain` fallback contains the raw markdown

### Integration

- [x] Context menu "Preview as HTML" opens file in preview mode

- [x] Context menu "Export as HTML" saves without opening preview

- [x] Cmd+Shift+P toggles HTML preview mode

- [x] Command palette includes "Preview as HTML" action

- [x] Find in document (Cmd+F) works in HTML preview via dom-search

### Design

- [x] Preview matches editor theme (light/dark)

- [x] Content width capped at 720px, centered

- [x] Typography matches editor feel (system font stack, proper hierarchy)

- [x] Callout styling is visually consistent with editor rendering

- [x] Sparklines use muted stroke color matching the theme

- [x] Code blocks have tasteful syntax highlighting

- [x] Works in both light and dark mode

- [x] Print from browser produces clean output

### Testing

- [x] Rust unit tests for `markdown_to_html` covering all GFM features

- [x] Rust unit tests for callout, sparkline, link preview, and drawing rendering

- [x] Rust unit tests for table metadata stripping and footer computation

- [x] Rust unit tests for XSS prevention (HTML escaping of user content)

- [x] Rust unit tests for theme CSS injection (light and dark)

- [x] Frontend unit tests for `HtmlViewer` component rendering

- [ ] Frontend unit tests for clipboard copy (text/html MIME type)

- [x] Existing markdown round-trip tests continue to pass

## Out of Scope

- **Custom HTML templates** — unlike PDF export's three templates, HTML starts with one clean template. Template selection is a future enhancement.
- **Live preview (side-by-side editing)** — the preview is a separate mode, not a live split view. Live preview adds complexity (debounced re-rendering, scroll sync) that can be added later.
- **CSS customization** — the embedded CSS matches the app theme. Users who want custom styles can edit the exported file.
- **Image optimization** — embedded SVGs are included as-is. Image compression or lazy loading is not needed for standalone documents.
- **Markdown export settings** — unlike PDF export's template/TOC/page-size options, HTML export has no configuration dialog. Theme is auto-detected from the app.
- **RSS/Atom feed generation** — out of scope for a document editor.
- **Web publishing or hosting** — Notesage exports files, it does not host them.

## Future Enhancements

- Live side-by-side preview (WYSIWYG on left, rendered HTML on right)
- Custom HTML templates (minimal, blog, documentation, presentation)
- Export selection (export highlighted text only, not full document)
- Batch export (export all files in a project as HTML)
- HTML-to-markdown import (reverse direction)
- Embedded font subsets for offline rendering with exact typography match
- OG meta tags for social sharing when exported HTML is hosted