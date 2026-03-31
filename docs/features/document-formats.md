# Document Formats

Support for non-markdown file types: viewing, exporting, and format conversion.

## PDF Export

Export notes to professionally typeset PDFs using the embedded Typst engine.

**Export triggers:**

- Cmd+Shift+E keyboard shortcut
- Export button in app toolbar (top right)
- Right-click sidebar context menu on .md files → "Export as PDF"

**Templates:**

- **Clean** — Sans-serif (Inter), generous whitespace, minimal headers/footers
- **Academic** — Serif (Source Serif 4), numbered headings, justified text, header with title and page number
- **Report** — Title page with document title and date, header/footer throughout, table of contents

**Export options:**

- Template selection (Clean, Academic, Report)
- Include table of contents (on/off)
- Include page numbers (on/off)
- Page size (A4, Letter, A5)
- Settings remembered between exports

**Architecture:**

- Typst 0.14 embedded compiler with custom `World` trait implementation (`NotesageWorld`)
- Markdown → Typst markup conversion via comrak GFM parser (`markdown_to_typst`)
- Bundled fonts: Inter (sans-serif), Source Serif 4 (serif), JetBrains Mono (code) — all OFL-licensed, \~2.7MB total
- Template `.typ` files loaded via `include_str!` with parameterized `#show` rules
- Tauri commands: `export_pdf` (compile), `save_binary_file` (write to disk)
- Drawing blocks: `.excalidraw` image references rewritten to `.svg` paths; SVG files resolved from project root via `project_root` parameter
- Dynamic table support: parses `<!-- type:currency,summary:sum -->` HTML comments from header cells, computes aggregation footer rows, applies number/currency/percentage formatting, degrades `{{spark:...}}` to comma-separated text

## EPUB Viewer

Read EPUB ebooks directly in Notesage with paginated or scrollable rendering.

**Rendering:**

- Powered by vendored foliate-js (MIT) — modern Web Component-based EPUB renderer
- Paginated mode: single-column layout with CSS multi-column, prev/next navigation
- Scroll mode: continuous vertical scrolling
- Dark/light mode: content theme follows app theme
- Arrow key navigation in paginated mode

**Reading features:**

- Running header (chapter title) and footer (page number) in paginated mode
- Book-wide page numbering accumulated from physical pages across sections
- TOC dropdown for chapter navigation
- Bookmark persistence and restoration on app restart (CFI-based, per file path)
- View mode preference (scroll/paginated) persisted globally
- In-document search (Cmd+F) with match count, prev/next navigation

**Architecture:**

- foliate-js vendored in `public/foliate-js/` (cannot be bundled by Vite — uses dynamic ES module imports)
- `<foliate-view>` Web Component loaded via dynamic `import('/foliate-js/view.js')`
- Vendored `view.js` patched to suppress red SVG overlay annotations from search
- Content theming via `renderer.setStyles()` CSS injection into EPUB iframe
- Keyboard event forwarding from EPUB iframes to parent window
- `epub-store` (Zustand, persisted): view mode preference + per-file bookmarks

## DOCX Export

Export notes to editable Word documents using the `docx-rs` crate.

**Export triggers:**

- Cmd+Shift+E keyboard shortcut (opens export dialog, select Word format)
- Right-click sidebar context menu on .md files → Export as... → Word (.docx)

**Templates:**

- **Clean** — Inter, 11pt body, 1.15 line spacing, no header/footer
- **Academic** — Source Serif 4, 12pt body, 1.5 line spacing, header with title + page number
- **Report** — Inter, 11pt body, title page (title + date), header/footer throughout

**Content mapping:**

| Markdown Element | Word Representation |
| --- | --- |
| Headings (H1-H6) | Bold paragraphs with template-appropriate font sizes |
| Paragraphs | Normal style with template body font |
| Bold, italic, strikethrough | Run formatting properties |
| Inline code | Monospace font (JetBrains Mono) with grey shading |
| Links | Hyperlinks with underline and grey color |
| Bullet/ordered/task lists | Word numbering with nesting (bullet/decimal) |
| Blockquotes | Indented paragraphs with grey text |
| Callout blocks | Single-cell table with colored background and bold label |
| Code blocks | Monospace text with grey background shading |
| Tables | Word tables with header row shading and optional aggregation footer |
| Images | Embedded from local files (resolved from project root) |
| Drawings (.excalidraw) | Embedded .svg sidecar files |
| Link preview cards | Styled paragraphs (bold title, description, grey URL) |
| Sparklines | Degraded to comma-separated text |
| YAML frontmatter | Stripped (not visible in output) |

**Dynamic table support:** Parses `<!-- type:currency,summary:sum -->` metadata, formats values by type, computes aggregation footers (sum/avg/count/min/max), strips sparkline syntax.

**Architecture:**

- `docx-rs` 0.4 crate for OOXML document generation
- Markdown parsed with `comrak` (GFM extensions)
- Shared table utilities in `table_utils.rs` (also used by Typst and HTML exporters)
- Tauri command: `export_docx`

## DOCX Viewer

- Powered by `docx-preview` for high-fidelity OOXML rendering (fonts, colors, table shading, headers/footers)
- mammoth.js retained solely for "Convert to Markdown" (`docxToMarkdown()` in `import-utils.ts`)
- White-background island in dark mode (document content stays light, surrounding chrome is dark)
- In-document search via shared `dom-search.ts` utility
- Read-only rendering

## Plain Text Viewer

- Simple `<pre>` rendering for non-markdown text files
- In-document search via `dom-search.ts`

## PDF Viewer

- Powered by pdfjs-dist
- Text layer search with `highlightTextLayerMatches` utility
- In-document search (Cmd+F)

## PPTX Export

Export notes to presentation slides using the ppt-rs crate.

**Export triggers:**

- Cmd+Shift+E keyboard shortcut (opens export dialog, select PowerPoint format)
- Right-click sidebar context menu on .md files → "Export as PowerPoint"

**Slide splitting:**

- H1 headings create new slides with the heading as title
- H2 appears as subtitle on the same slide
- H3-H6 rendered as bold body text
- `---` horizontal rules force explicit slide breaks
- First slide is always a title slide with document title and date
- Content before first heading becomes title slide subtitle
- Slides with >8 bullets or >300 words split into continuation slides with "(cont.)" suffix

**Content type mapping:**

- Bullet lists → PowerPoint bullet points with nesting levels
- Numbered lists → numbered points
- Task lists → checkbox symbols (☐/☑)
- GFM tables → native PowerPoint tables via QuickTable
- Code blocks → monospace-styled text (14pt, no bullet marker)
- Images → embedded in PPTX (resolved from project root)
- Excalidraw drawings → resolved to .svg counterparts
- Inline charts → native PowerPoint charts (bar, line, area, pie, donut)
- `> [!notes]` callouts → speaker notes pane (not on slide)
- Other callouts (note, tip, warning, important) → styled text with label prefix
- `> [!link](url)` → text with URL

**Templates (built-in):**

- **Simple** — 44pt titles, neutral colors, no slide numbers
- **Business** — 40pt titles, header line, slide numbers
- **Report** — 44pt titles, white-on-dark title color, slide numbers

**User-uploaded templates:**

- Import `.pptx`/`.potx` files via "Add Template" button in export dialog
- Templates stored in `~/.notesage/pptx-templates/` (global) and `<project>/.notesage/pptx-templates/` (project)
- Per-project templates override global templates with the same name
- Delete on hover in template picker

**Architecture:**

- `ppt-rs` v0.2 crate for PPTX generation (ECMA-376 Office Open XML)
- Markdown parsed with `comrak` (already a dependency) into intermediate slide model
- Template config applied via font sizes and colors on SlideContent
- Tauri commands: `export_pptx` (generate), `import_pptx_template`, `list_pptx_templates`, `delete_pptx_template`

## HTML Preview & Export

Preview and export markdown documents as self-contained HTML files with full feature parity.

**Preview triggers:**

- Cmd+Shift+P keyboard shortcut
- Eye icon in editor toolbar
- Command palette: "Preview as HTML"
- Right-click sidebar context menu on .md files: "Preview as HTML"

**Export triggers:**

- "Export" button in HTML preview toolbar
- Right-click sidebar context menu: Export as... > HTML

**Features:**

- Rendered in a sandboxed `<iframe>` with `sandbox="allow-same-origin"` (no script execution)
- Theme-reactive: re-renders when light/dark mode changes
- "Copy HTML" button copies `text/html` + `text/plain` (raw markdown) to clipboard for pasting into rich text editors
- Find in document (Cmd+F) via shared `dom-search.ts` utility
- Self-contained output: no external stylesheets, fonts, or scripts
- CSP meta tag prevents script injection when served from a web server

**Rendered feature mapping:**

| Feature | HTML Output |
| --- | --- |
| Callout blocks | Styled `<div class="callout callout-{type}">` with SVG icon |
| Table metadata | Footer `<tfoot>` row with computed aggregation |
| Sparklines | Inline `<svg>` polyline charts |
| Drawing blocks | Embedded SVG as data URI from `.svg` sidecar files |
| Link preview cards | Styled `<a>` cards with title and URL |
| Code blocks | Syntax highlighting via syntect with inline styles |
| Task lists | Custom checkbox styling |
| Footnotes | Superscript links with footnote section |

**Architecture:**

- `comrak` (v0.50.0 with `syntect`) for markdown parsing and syntax highlighting
- Pre-processing: table metadata extraction, drawing block resolution
- Post-processing: callout blocks, link previews, sparklines, table aggregation footers
- Embedded CSS with light and dark themes (static oklch approximations)
- Tauri command: `render_html` (full document or body-only fragment for clipboard)

## Key Files

| File | Purpose |
| --- | --- |
| `src-tauri/src/commands/export.rs` | PDF + DOCX + PPTX + HTML export commands, template management |
| `src-tauri/src/export/` | Typst engine + DOCX converter + PPTX converter + HTML renderer |
| `src-tauri/src/export/markdown_to_docx.rs` | Markdown → docx-rs document model converter |
| `src-tauri/src/export/table_utils.rs` | Shared table utilities (column metadata, aggregation, formatting) |
| `src-tauri/src/export/markdown_to_html.rs` | Markdown → HTML with Notesage extensions |
| `src-tauri/src/export/html_styles.rs` | Embedded CSS templates (light + dark themes) |
| `src-tauri/src/export/markdown_to_pptx.rs` | Markdown → ppt-rs slide model converter |
| `src-tauri/src/export/templates.rs` | PDF + PPTX template configurations |
| `src-tauri/fonts/` | Bundled fonts |
| `src-tauri/templates/` | Typst template presets |
| `src/components/editor/viewers/HtmlViewer.tsx` | Sandboxed iframe HTML preview with toolbar |
| `src/components/editor/viewers/EpubViewer.tsx` | EPUB reader |
| `src/components/editor/viewers/PdfViewer.tsx` | PDF viewer |
| `src/components/editor/viewers/DocxViewer.tsx` | DOCX viewer |
| `src/components/editor/viewers/PlainTextViewer.tsx` | Plain text viewer |
| `src/components/ExportDialog.tsx` | Export options dialog (PDF + DOCX + PowerPoint) |
| `src/hooks/useExportOperations.ts` | Export operations hook (PDF + DOCX + PPTX routing) |
| `src/stores/epub-store.ts` | EPUB viewer preferences and bookmarks |
| `public/foliate-js/` | Vendored EPUB renderer |

## Future Enhancements

- ~~DOCX export~~ — Complete: full content mapping, three templates, dynamic tables
- Custom template editor and template marketplace
- Code file syntax highlighting