# Research: Document Format Enhancements

**Date:** 2026-03-30 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [docx-export](../prds/2026-03-30-docx-export.md) | Complete |
| Tasks | [docx-export-tasks](../tasks/2026-03-30-docx-export-tasks.md) | Complete |
| PRD | [pptx-export](../prds/2026-03-30-pptx-export.md) | Complete |
| Tasks | [pptx-export-tasks](../tasks/2026-03-30-pptx-export-tasks.md) | Complete |
| PRD | [wysiwyg-typography](../prds/2026-03-30-wysiwyg-typography.md) | Complete |
| Tasks (Phase 1) | [wysiwyg-typography-tasks](../tasks/2026-03-30-wysiwyg-typography-tasks.md) | Complete |
| Tasks (Phase 2) | [wysiwyg-typography-phase2-tasks](../tasks/2026-03-31-wysiwyg-typography-phase2-tasks.md) | Complete |
| PRD | [html-preview](../prds/2026-03-30-html-preview.md) | Complete |
| Tasks | [html-preview-tasks](../tasks/2026-03-30-html-preview-tasks.md) | Complete |
| PRD | [code-file-highlighting](../prds/2026-03-30-code-file-highlighting.md) | Complete |
| Tasks | [code-file-highlighting-tasks](../tasks/2026-03-30-code-file-highlighting-tasks.md) | Complete |
| PRD | [pptx-viewer](../prds/2026-03-30-pptx-viewer.md) | Complete |
| Tasks | [pptx-viewer-tasks](../tasks/2026-03-30-pptx-viewer-tasks.md) | Complete |

Notesage currently exports to PDF (via Typst) and views EPUB, DOCX, PDF, and plain text files. The [document-formats feature doc](../features/document-formats.md) lists five future enhancements: DOCX export, PPTX export, WYSIWYG typography with export alignment, HTML preview, and code file syntax highlighting. This research evaluates the best solutions for each.

---

## Executive Summary

All five enhancements are feasible with the current stack. DOCX export has the strongest library support in Rust — `docx-rs` (500+ stars, 1M+ downloads) provides a mature API, and `rdocx` offers a newer alternative with a built-in layout engine. PPTX export is viable via `ppt-rs`, a Rust port of python-pptx with markdown-to-slides support, charts, and animations. Both fit cleanly as Tauri commands alongside the existing Typst PDF pipeline.

The original plan for a custom Typst template editor is superseded by a WYSIWYG typography approach: per-block-type style presets (H1-H6, paragraph, code, blockquote) with Google Docs-style "Update to match" / "Reset" actions, editable headers/footers in paged view, user-insertable page breaks, and export alignment across all formats. This eliminates the need for export-time template selection — what users see in the editor is what they get in the export.

HTML preview is straightforward: the markdown is already parsed for the Tiptap editor, so rendering it to a styled HTML document for preview/export requires only a serialization pass with a CSS stylesheet. The `comrak` crate (already a dependency) can render markdown to HTML on the backend.

Code file syntax highlighting for the plain text viewer has two strong options: extend the existing CodeMirror 6 setup (already used for source mode) to support read-only code viewing with \~30 language packages, or use the existing lowlight/highlight.js library (192 languages, already used for code blocks) for static rendering. CodeMirror is recommended for its superior UX (line numbers, folding, selection).

**Recommended priority:** DOCX export (highest user value) &gt; Code file highlighting (low effort) &gt; HTML preview (low effort) &gt; WYSIWYG typography & export alignment (fulfills the WYSIWYG promise) &gt; PPTX export (niche use case).

---

## 1. DOCX Export

### Option A: docx-rs (Rust)

| Attribute | Details |
| --- | --- |
| **Crate** | `docx-rs` (bokuweb) |
| **Stars / Downloads** | 500+ stars, 1M+ downloads |
| **Version** | 0.4.19 (active maintenance) |
| **API** | Builder pattern: `Docx::new().add_paragraph(...)` |
| **Features** | Paragraphs, headings, tables, images, lists, styles, page breaks, headers/footers, numbering |
| **WASM** | Yes — also compiles to WebAssembly |
| **Limitations** | Write-only (no template filling), no layout engine, no TOC generation |

The most mature Rust DOCX writer. The API maps well to Notesage's needs: walk the ProseMirror document or parsed markdown AST, emit `docx-rs` nodes. Similar pattern to the existing `markdown_to_typst.rs` converter.

### Option B: rdocx (Rust)

| Attribute | Details |
| --- | --- |
| **Crate** | `rdocx` |
| **API** | python-docx-inspired high-level API |
| **Features** | Read/write DOCX, paragraphs, tables, images, headers/footers, styles, lists, **built-in layout engine** (PDF, HTML, Markdown output) |
| **Advantages** | Multi-format output from a single document model; font subsetting; WASM compatible |
| **Limitations** | Newer, smaller community; less battle-tested than docx-rs |

More ambitious — includes a layout engine that can render the same document to PDF, HTML, and DOCX. Could theoretically replace the Typst pipeline for DOCX-specific rendering, but adds complexity.

### Option C: Pandoc (External)

| Attribute | Details |
| --- | --- |
| **Tool** | [Pandoc](https://pandoc.org/) |
| **Integration** | Shell-out via Tauri command: `pandoc input.md -o output.docx` |
| **Features** | Comprehensive markdown-to-DOCX with styles, equations, tables, images, TOC, custom reference templates |
| **Advantages** | Best formatting fidelity; supports custom `.docx` reference templates for styling |
| **Limitations** | External dependency (\~100MB binary); requires installation; not embeddable in the app bundle easily |

The gold standard for markdown-to-DOCX conversion. Formatting fidelity is unmatched. However, requiring users to install Pandoc separately is a significant UX barrier for a desktop app that targets zero-dependency setup.

### Recommendation

**docx-rs** for v1 — it's pure Rust, mature, and follows the same pattern as the existing Typst PDF pipeline (walk AST, emit document nodes). Create a `markdown_to_docx.rs` converter alongside `markdown_to_typst.rs`. This keeps the entire export pipeline in-process with no external dependencies.

Monitor **rdocx** for future consolidation if its community grows.

---

## 2. PPTX Export

### Option A: ppt-rs (Rust)

| Attribute | Details |
| --- | --- |
| **Crate** | `ppt-rs` |
| **API** | Builder pattern (Rust port of python-pptx) |
| **Features** | Slides, text boxes, images, tables, charts (bar/line/pie/area/scatter/doughnut/radar), shapes (100+ types), animations (50+ effects), gradient fills, connectors, **markdown-to-PPTX** built-in |
| **Templates** | Built-in business/report/simple templates |
| **Compliance** | Full ECMA-376 Office Open XML |

Surprisingly feature-rich. The built-in markdown-to-PPTX conversion is directly relevant — headings become slide titles, lists become bullet points. This maps perfectly to the PRD's planned feature.

### Option B: pptx crate (Rust)

| Attribute | Details |
| --- | --- |
| **Crate** | `pptx` |
| **Features** | Read/write PPTX, animations, 3D effects, SmartArt, freeform shapes |
| **Advantages** | Broader parsing support (SmartArt, 3D) |
| **Limitations** | Higher Rust version requirement (1.85+); less focused on generation |

### Recommendation

**ppt-rs** — its built-in markdown-to-PPTX support is a direct fit. The integration model: serialize the current document to markdown, pass it to `ppt-rs`'s converter, optionally apply a template, save the `.pptx`. A Tauri command `export_pptx(markdown, template)` mirrors the existing `export_pdf` pattern.

---

## 3. WYSIWYG Typography & Export Alignment

### Current State

Notesage has a global typography system (`editor-styles-store`) with font family, font size, line height, and paragraph spacing — applied to the editor via CSS variables. However, these settings are **global** (not per-block-type), and **completely ignored by all export pipelines**. Each export format (PDF, DOCX, PPTX, HTML) uses hardcoded template typography. This breaks the WYSIWYG contract: what users see in the editor is not what they get in exports.

Additionally, Notesage bundles three PDF export templates (Clean, Academic, Report) that users select at export time. The original plan was to build a custom Typst template editor with CodeMirror. However, for a WYSIWYG editor, requiring users to configure export-time templates is unnecessary overhead. The editor already shows the document's visual appearance — exports should simply honor it.

### Problem

1. Typography settings (font, size, weight, spacing) are global — headings and paragraphs share the same font family and size
2. Exports ignore editor typography entirely — each template hardcodes its own fonts and sizes
3. Users cannot configure individual block types (H1 gets one style, H2 another, paragraph another)
4. No mechanism to update a block-type preset from the current selection (Google Docs "Update Heading 2 to match" pattern)
5. No user-insertable page breaks (visual page break indicators exist but are display-only)
6. No editable headers/footers or title page support in the editor

### Approach: Per-Block-Type Typography with Export Alignment

The solution follows the Google Docs model — the most intuitive typography UX for WYSIWYG document editors.

**Per-block-type style presets:**

| Block Type | Configurable Properties |
| --- | --- |
| Paragraph | Font family, font size, font weight, line height, paragraph spacing, text color |
| Heading 1-6 | Font family, font size, font weight, line height, spacing before/after, text color |
| Code block | Font family (monospace), font size |
| Blockquote | Font family, font size, font style (italic), text color |

**Google Docs-style update/reset:**

1. User places cursor in (or selects) a block
2. Changes font/size/weight/spacing via toolbar — change applies immediately to that block (local override)
3. The block-type dropdown gains two actions:
   - **"Update Heading 2 to match"** — saves current formatting as the H2 preset; all H2s in the document update
   - **"Reset to Heading 2 style"** — strips local overrides, reverts to the preset

**Preset storage:**

- Per-project (`.notesage/typography.json`) with global fallback (`~/.notesage/typography.json`)
- New documents inherit whichever presets are in scope
- "Start from a template" is simply pre-populating the typography presets — a document creation concept, not an export concept

**Export alignment:**

- All export pipelines (PDF/Typst, DOCX, PPTX, HTML) read block-type presets and apply them directly
- The export dialog shrinks to: page size + TOC + page numbers + headers/footers. No template picker needed.
- What you see in the editor is what you get in the export

### Page Constructs

**Headers/Footers:**

- In paged view (A4/Letter/A5), render clickable header and footer zones on each page
- Click to edit — lightweight inline editor with free text and variables (`{page}`, `{pages}`, `{title}`, `{date}`)
- Left / center / right alignment sections (classic three-column header layout)
- Stored as document-level metadata (frontmatter or `.notesage/` sidecar)
- "Different first page" toggle — first page gets its own header/footer or none (same as Google Docs / Word)
- Hidden when not in paged view; settings entry point available for non-paged editing

**Title pages:**

- Enabled via the "Different first page" toggle
- User styles the first page content using the same block-level typography tools (large centered title, date, author)
- No special "title page template" — it's just content + the toggle

**User-insertable page breaks:**

- Slash command: `/pagebreak`
- Rendered as a visible horizontal divider with a "Page Break" label (like Google Docs)
- Draggable/deletable like any other block
- Respected in all exports: Typst `#pagebreak()`, DOCX page break paragraph property, HTML `page-break-before: always`

### Implementation Complexity

| Component | Effort | Dependencies |
| --- | --- | --- |
| Per-block-type style presets (store + CSS) | Medium | None — extends existing `editor-styles-store` |
| Block-type dropdown update/reset actions | Small | None — extends existing heading picker |
| Toolbar context-awareness (show current block's styles) | Small | None — reads ProseMirror node attrs |
| Export pipeline alignment (PDF, DOCX, PPTX, HTML) | Medium | None — passes presets to existing converters |
| User-insertable page breaks | Small | None — extends existing `page-breaks.ts` extension |
| Editable headers/footers in paged view | Large | ProseMirror decoration or separate editor instances |
| Title page toggle | Small | Depends on headers/footers |

### Recommendation

**Phase 1:** Per-block-type typography presets with Google Docs update/reset + export alignment. This is the highest-value change — it fulfills the WYSIWYG promise and eliminates the need for a template picker at export time. Medium effort, no new dependencies.

**Phase 2:** Page constructs — user-insertable page breaks (small effort), editable headers/footers (large effort), and title page toggle. Page breaks can ship independently; headers/footers are the most complex piece and may warrant a separate PRD.

The original plan for a Typst template editor with CodeMirror is **superseded** by this approach. Templates as a concept shift from "export-time styling" to "document creation presets" — a set of typography presets that can be applied when creating a new document.

---

## 4. HTML Preview & Export

### Current State

Notesage converts markdown to ProseMirror (for the editor) and markdown to Typst (for PDF). There is no markdown-to-HTML path, though `comrak` (used by the Rust backend for AST parsing in the document index) supports GFM HTML rendering.

### Approach A: Backend Rendering via comrak

| Attribute | Details |
| --- | --- |
| **Crate** | `comrak` (already a dependency) |
| **Features** | GFM-compatible: tables, task lists, strikethrough, autolinks, footnotes |
| **Output** | HTML string with class annotations for styling |
| **Integration** | New Tauri command: `render_html(markdown) -> String` |

comrak renders markdown to clean HTML. Add a CSS stylesheet (matching the editor's typography and color variables) and wrap in a full HTML document template. The output can be previewed in an embedded webview or exported as a `.html` file.

### Approach B: Frontend Rendering via react-markdown

| Attribute | Details |
| --- | --- |
| **Package** | `react-markdown` |
| **Features** | Safe rendering (no dangerouslySetInnerHTML), plugin ecosystem (remark/rehype) |
| **Advantages** | Stays in the frontend; can reuse existing Tailwind/editor styles |
| **Limitations** | Adds a dependency; duplicates rendering logic (Tiptap already renders markdown) |

### Recommendation

**comrak on the backend** — it's already a dependency, produces standards-compliant GFM HTML, and keeps the pattern consistent (all export goes through Rust Tauri commands). The frontend just needs a viewer component (similar to the existing plain text viewer) and an export-to-file option.

For the preview, render the HTML in a sandboxed `<iframe>` with a stylesheet that matches the editor's current theme (inject CSS variables). This gives a true WYSIWYG preview of how the document will look as a standalone HTML page.

---

## 5. Code File Syntax Highlighting

### Current State

- **Code blocks in the editor**: lowlight (highlight.js wrapper) via `@tiptap/extension-code-block-lowlight` with `common` language set (\~40 languages)
- **Source mode**: CodeMirror 6 with language-specific extensions
- **Plain text viewer**: `<pre>` element with no syntax highlighting — all code files (`.js`, `.py`, `.rs`, etc.) render as unstyled monospace text

### Option A: Extend CodeMirror 6 (Recommended)

| Attribute | Details |
| --- | --- |
| **Already in the app** | Yes — used for source mode editing |
| **Languages** | \~30 official packages (`@codemirror/lang-javascript`, `lang-python`, `lang-rust`, `lang-html`, `lang-css`, `lang-json`, `lang-markdown`, etc.) |
| **Features** | Line numbers, code folding, bracket matching, selection, search (Cmd+F already delegated) |
| **Read-only mode** | `EditorState.readOnly.of(true)` — single config flag |
| **Integration** | Replace the `<pre>` element in `PlainTextViewer.tsx` with a read-only CodeMirror instance, detect language from file extension |

This approach provides the richest UX: line numbers, folding, bracket matching, clickable selections — all for free since CodeMirror is already bundled. The main work is a file-extension-to-language-package mapping and lazy-loading the language grammars.

### Option B: lowlight / highlight.js (Static Rendering)

| Attribute | Details |
| --- | --- |
| **Already in the app** | Yes — used for code blocks |
| **Languages** | 192 languages (full set) |
| **Features** | Syntax highlighting only — no line numbers, folding, or selection |
| **Integration** | `lowlight.highlight(code, { language })` → HTML with `<span class="hljs-*">` → render in viewer |

Simpler but less capable. Good enough for "just show colors" but doesn't provide the code editor affordances users expect when viewing `.py` or `.rs` files.

### Option C: Syntect / tree-sitter (Rust Backend)

| Attribute | Details |
| --- | --- |
| **Crate** | `syntect` (Sublime Text grammars) or `tree-sitter-highlight` |
| **Languages** | syntect: 200+, tree-sitter: depends on installed grammars |
| **Features** | Backend rendering to HTML with `<span>` classes |
| **Advantages** | No frontend JS overhead; consistent with backend-first philosophy |
| **Limitations** | Adds Rust dependency; highlight output sent over IPC; no interactive features (folding, selection) |

Over-engineered for a viewer. The frontend already has the tools needed.

### Recommendation

**CodeMirror 6 in read-only mode** — leverage the existing dependency for a superior UX with line numbers, folding, and search. Lazy-load language packages based on file extension. Bundle the \~15 most common languages, load others on demand.

---

## Comparison

| Feature | Recommended Solution | Effort | Dependencies | Priority |
| --- | --- | --- | --- | --- |
| **DOCX export** | `docx-rs` (Rust crate) | Large | New Cargo dependency | High |
| **PPTX export** | `ppt-rs` (Rust crate) | Large | New Cargo dependency | Low |
| **WYSIWYG typography** | Per-block-type presets + export alignment + page constructs | Medium-Large | None (existing stack) | High |
| **HTML preview** | `comrak` HTML rendering (already a dep) + themed iframe | Small | None | Medium |
| **Code highlighting** | CodeMirror 6 read-only (already bundled) | Small | \~15 `@codemirror/lang-*` packages | High |

## Recommendation

### Phase 1 (Quick Wins)

1. **Code file syntax highlighting** — Replace `PlainTextViewer` with read-only CodeMirror. Small effort, immediate value for developers.
2. **HTML preview & export** — Add `render_html` Tauri command using comrak, themed iframe viewer, and file export. Small effort, useful for sharing.

### Phase 2 (Export Formats)

3. **DOCX export** — `docx-rs` crate, new `markdown_to_docx.rs` converter, export dialog integration. High user demand — "export to Word" is the #1 missing format.
4. **WYSIWYG typography & export alignment** — Per-block-type typography presets with Google Docs-style update/reset, export pipeline alignment across PDF/DOCX/PPTX/HTML, user-insertable page breaks, editable headers/footers, title page toggle. Fulfills the WYSIWYG promise — what you see is what you export.

### Phase 3 (Nice to Have)

5. **PPTX export** — `ppt-rs` crate with markdown-to-slides. Niche use case but the library makes it straightforward.

## Open Questions

- **DOCX fidelity**: How well does `docx-rs` handle complex content (Excalidraw SVGs as embedded images, callout blocks, link preview cards)? May need a spike to test edge cases.
- **PPTX slide splitting**: Should heading levels map to slide breaks automatically, or should users insert explicit slide separators (e.g., `---` horizontal rules)?
- **Typography preset scope**: Should per-block-type presets be per-document (frontmatter), per-project (`.notesage/`), or global (`~/.notesage/`)? Recommendation: per-project with global fallback.
- **Header/footer complexity**: Should headers/footers support rich formatting (bold, images/logos) or plain text + variables only for v1?
- **Code viewer language detection**: Should we use file extension only, or also attempt content-based detection (e.g., shebang lines, file signatures)?

## Sources

- [docx-rs (bokuweb)](https://github.com/bokuweb/docx-rs) — Rust DOCX writer, 500+ stars
- [rdocx](https://lib.rs/crates/rdocx) — Rust DOCX with layout engine
- [ppt-rs](https://github.com/yingkitw/ppt-rs) — Rust PPTX generation (python-pptx port)
- [pptx crate](https://crates.io/crates/pptx) — Rust PPTX read/write with animations
- [Typst Universe](https://typst.app/universe/) — Community template marketplace
- [Typst Making a Template](https://typst.app/docs/tutorial/making-a-template/) — Official template authoring guide
- [comrak](https://crates.io/crates/comrak) — GFM-compatible markdown parser (already a dependency)
- [react-markdown](https://github.com/remarkjs/react-markdown) — React markdown renderer
- [highlight.js Supported Languages](https://github.com/highlightjs/highlight.js/blob/main/SUPPORTED_LANGUAGES.md) — 192 languages
- [CodeMirror Language Packages](https://codemirror.net/examples/lang-package/) — Official language support
- [syntect](https://github.com/trishume/syntect) — Rust syntax highlighting with Sublime grammars
- [tree-sitter-highlight](https://crates.io/crates/tree-sitter-highlight) — Tree-sitter based highlighting
- [Pandoc](https://pandoc.org/) — Universal document converter
- [Typst DOCX Discussion #190](https://github.com/typst/typst/issues/190) — Typst team on DOCX export
- [typ2docx](https://github.com/sghng/typ2docx) — Community Typst-to-DOCX converter