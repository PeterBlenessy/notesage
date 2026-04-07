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

## Code File Editor

Editable CodeMirror 6 editor for code files with syntax highlighting, line numbers, and code navigation.

- **22+ languages supported:** JavaScript, TypeScript, Python, Rust, Go, Java, C, C++, HTML, CSS, JSON, YAML, TOML, Markdown, Shell, SQL, XML, Swift, Kotlin, Ruby, PHP, JSX/TSX
- **Lazy loading:** Language packages loaded on demand via dynamic `import()` — zero initial bundle cost
- **Full editing:** Type, paste, delete, undo/redo, save (Cmd+S), dirty indicator, auto-save on tab switch
- **Code navigation:** Line numbers, fold gutter, bracket matching, active line highlight, selection match highlighting
- **Find in document:** CodeMirror's built-in search panel (Cmd+F) with match highlighting, regex support
- **Muted chromatic syntax highlighting:** Keywords purple, strings green, comments olive italic, numbers orange, functions blue, types teal — via `--ns-code-*` CSS variables
- **Toolbar:** File name (left), dirty indicator, language name (right, e.g., "TypeScript")
- **Full width layout:** No 720px max-width constraint — code files use full available width
- **Graceful fallback:** Unknown extensions (`.txt`, `.log`, etc.) render as plain `<pre>` text
- **Theme integration:** Light/dark mode and contrast slider via CSS variables (`--ns-code-*`)

## Plain Text Viewer

- Simple `<pre>` rendering for non-code text files (`.txt`, `.log`, `.csv`, extensionless)
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

## PPTX Viewer

View PowerPoint presentations directly in Notesage with high-fidelity slide rendering, master/layout inheritance, chart rendering, and search.

**Rendering:**

- Powered by JSZip (ZIP extraction) and browser-native DOMParser (XML parsing)
- Frontend-only — no Rust backend dependency for viewing
- Each slide rendered as positioned HTML/CSS elements preserving the PPTX coordinate system
- Slide master and layout inheritance: backgrounds, placeholder positions, and shape trees merged with correct z-order
- Aspect ratio detection (16:9 vs 4:3) from PPTX metadata

**Supported elements:**

| PPTX Element | Rendering |
| --- | --- |
| Text boxes | Styled `<div>` with paragraph/run formatting (bold, italic, underline, strikethrough, superscript/subscript, font, size, color, alignment, bullets). `bodyPr` respected: vertical alignment (top/center/bottom), internal margins, font scaling (`normAutofit`), auto-fit overflow, no-wrap mode. Line/paragraph spacing (`lnSpc`, `spcBef`, `spcAft`), first-line indent, left margin. Auto-numbered bullets (`buAutoNum`: arabic, alpha, roman formats) with bullet font, color, and size |
| Images | `<img>` with base64 data URLs extracted from ZIP media/ |
| Shapes (rect, ellipse, roundRect, + 44 presets) | `<div>` or SVG `<path>` with CSS border-radius, background, border. `flipH`/`flipV` combined with rotation. 11 OOXML dash presets mapped to CSS `border-style` and SVG `stroke-dasharray` |
| Lines and arrows | `<svg>` with `<line>` and arrowhead markers. Dash styles supported |
| Tables | HTML `<table>` with cell styling, colspan/rowspan, background colors, per-cell borders (width, color, dash style, noFill), per-cell margins, vertical alignment |
| Charts (bar, line, pie, area, scatter, doughnut, radar, bubble) | recharts components with titles, legends (positioned), axis labels/titles, and data labels |
| Groups | Nested container with offset child elements |
| Gradient fills (linear, radial) | CSS `linear-gradient()` / `radial-gradient()` from DrawingML `a:gradFill`, alpha transparency on stops |
| Preset geometries (44 shapes) | SVG `<path>` rendering for arrows, stars, polygons, flowchart symbols, callouts, etc. — replaces generic rectangles |
| Hyperlinks | External URLs open in system browser, internal slide links navigate within the viewer. Text run and shape-level `hlinkClick` supported |
| Shape shadows | `outerShdw` parsed (blur, distance/direction, color with alpha) → CSS `box-shadow` or SVG `drop-shadow` filter |
| Image crop | `srcRect` and `fillRect` crop percentages rendered as CSS `clip-path: inset()` |
| Master/layout slides | Slide masters and layouts parsed. Shape trees merged (master → layout → slide z-order). Background and placeholder positions inherited. Placeholder deduplication |
| SmartArt | Fallback rasterized image, or placeholder if no fallback |

**Navigation:**

- Left/right arrow keys, clickable edge zones (15% width)
- Slide counter ("Slide N of M") with prev/next buttons
- Direct slide jump via clickable counter number

**Zoom:**

- Zoom in/out buttons (50%, 75%, 100%, 125%, 150%, 200%)
- "Fit to width" and "Fit to page" modes
- Cmd+= / Cmd+- / Cmd+0 keyboard shortcuts
- Cmd+scroll wheel zoom

**Speaker notes:**

- Toggle button in toolbar (StickyNote icon)
- Notes panel below the slide (150px)
- Empty state for slides without notes

**Search (Cmd+F):**

- Hybrid approach: plain text per slide extracted during parsing for total match counting
- DOM-based highlighting on current slide via shared `dom-search.ts` utility
- Cross-slide navigation with accurate global match count

**Dark mode:**

- Slide content renders with authored colors (not inverted)
- Slide sits on `bg-muted` neutral background
- Toolbar and chrome follow app theme

**Legacy .ppt handling:**

- `.ppt` files show "Legacy format not supported" message with conversion guidance

**Architecture:**

- `pptx-parser.ts` — pure TypeScript module: `parsePptx(Uint8Array) → PptxPresentation`
- Uses JSZip for ZIP extraction, DOMParser for XML parsing
- Theme color resolution: `schemeClr` → theme hex values with tint, shade, and luminance transforms. Alpha transparency on fills and gradient stops
- Master/layout inheritance: slide masters and layouts parsed and merged into each slide's shape tree with correct z-order and placeholder deduplication
- Preset geometry engine: 44 DrawingML preset shapes rendered as computed SVG paths
- EMU to pixel conversion: 1 pixel = 9525 EMU at 96 DPI
- 62 unit tests covering color transforms (26 tests) and bullet numbering (36 tests)

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
| `src/components/editor/viewers/PptxViewer.tsx` | PPTX slide viewer (orchestrator) |
| `src/components/editor/viewers/PptxSlideRenderer.tsx` | Slide element renderers (text, image, shape, table, group) |
| `src/components/editor/viewers/PptxChartRenderer.tsx` | Recharts-based chart rendering |
| `src/components/editor/viewers/PptxSearchBar.tsx` | Search hook + find bar UI |
| `src/components/editor/viewers/PptxZoomControls.tsx` | Zoom hook + toolbar controls |
| `src/lib/pptx-parser.ts` | PPTX ZIP extraction and XML parsing |
| `src/lib/pptx-types.ts` | PPTX parsed data model types |
| `src/components/editor/viewers/CodeEditor.tsx` | Editable CodeMirror 6 code file editor |
| `src/lib/codemirror-languages.ts` | Extension → language mapping, lazy loader, `isCodeFile()` |
| `src/components/editor/viewers/PlainTextViewer.tsx` | Plain text viewer + code file routing |
| `src/components/ExportDialog.tsx` | Export options dialog (PDF + DOCX + PowerPoint) |
| `src/hooks/useExportOperations.ts` | Export operations hook (PDF + DOCX + PPTX routing) |
| `src/stores/epub-store.ts` | EPUB viewer preferences and bookmarks |
| `public/foliate-js/` | Vendored EPUB renderer |

## Future Enhancements

- ~~DOCX export~~ — Complete: full content mapping, three templates, dynamic tables
- Custom template editor and template marketplace
- Code file syntax highlighting