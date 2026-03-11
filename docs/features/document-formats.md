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
- Bundled fonts: Inter (sans-serif), Source Serif 4 (serif), JetBrains Mono (code) — all OFL-licensed, ~2.7MB total
- Template `.typ` files loaded via `include_str!` with parameterized `#show` rules
- Tauri commands: `export_pdf` (compile), `save_binary_file` (write to disk)

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

## DOCX Viewer

- Powered by mammoth.js (HTML conversion)
- In-document search via shared `dom-search.ts` utility
- Read-only rendering

## Plain Text Viewer

- Simple `<pre>` rendering for non-markdown text files
- In-document search via `dom-search.ts`

## PDF Viewer

- Powered by pdfjs-dist
- Text layer search with `highlightTextLayerMatches` utility
- In-document search (Cmd+F)

## Key Files

| File | Purpose |
| --- | --- |
| `src-tauri/src/commands/export.rs` | PDF export commands |
| `src-tauri/src/export/` | Typst engine (world, converter, templates) |
| `src-tauri/fonts/` | Bundled fonts |
| `src-tauri/templates/` | Typst template presets |
| `src/components/editor/viewers/EpubViewer.tsx` | EPUB reader |
| `src/components/editor/viewers/PdfViewer.tsx` | PDF viewer |
| `src/components/editor/viewers/DocxViewer.tsx` | DOCX viewer |
| `src/components/editor/viewers/PlainTextViewer.tsx` | Plain text viewer |
| `src/components/ExportDialog.tsx` | PDF export options dialog |
| `src/stores/epub-store.ts` | EPUB viewer preferences and bookmarks |
| `public/foliate-js/` | Vendored EPUB renderer |

## Future Enhancements

- DOCX export (preserve formatting, embedded images, Word styles mapping)
- PPTX export (headings → slides, lists → bullet points)
- Custom template editor and template marketplace
- HTML rendering and preview
- Code file syntax highlighting
