# Research: Document Format Enhancements

**Date:** 2026-03-30 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [docx-export](../prds/2026-03-30-docx-export.md) | Complete |
| Tasks | [docx-export-tasks](../tasks/2026-03-30-docx-export-tasks.md) | Complete |
| PRD | [pptx-export](../prds/2026-03-30-pptx-export.md) | Complete |
| Tasks | [pptx-export-tasks](../tasks/2026-03-30-pptx-export-tasks.md) | Complete |
| PRD | [custom-templates](../prds/2026-03-30-custom-templates.md) | Draft |
| PRD | [html-preview](../prds/2026-03-30-html-preview.md) | Complete |
| Tasks | [html-preview-tasks](../tasks/2026-03-30-html-preview-tasks.md) | Complete |
| PRD | [code-file-highlighting](../prds/2026-03-30-code-file-highlighting.md) | Draft |
| PRD | [pptx-viewer](../prds/2026-03-30-pptx-viewer.md) | Complete |
| Tasks | [pptx-viewer-tasks](../tasks/2026-03-30-pptx-viewer-tasks.md) | Complete |

Notesage currently exports to PDF (via Typst) and views EPUB, DOCX, PDF, and plain text files. The [document-formats feature doc](../features/document-formats.md) lists five future enhancements: DOCX export, PPTX export, custom template editor, HTML preview, and code file syntax highlighting. This research evaluates the best solutions for each.

---

## Executive Summary

All five enhancements are feasible with the current stack. DOCX export has the strongest library support in Rust — `docx-rs` (500+ stars, 1M+ downloads) provides a mature API, and `rdocx` offers a newer alternative with a built-in layout engine. PPTX export is viable via `ppt-rs`, a Rust port of python-pptx with markdown-to-slides support, charts, and animations. Both fit cleanly as Tauri commands alongside the existing Typst PDF pipeline.

A custom template editor for PDF export can build on Typst Universe's template format — users edit `.typ` files with a preview panel, and the existing Typst compiler renders them. No new dependencies needed.

HTML preview is straightforward: the markdown is already parsed for the Tiptap editor, so rendering it to a styled HTML document for preview/export requires only a serialization pass with a CSS stylesheet. The `comrak` crate (already a dependency) can render markdown to HTML on the backend.

Code file syntax highlighting for the plain text viewer has two strong options: extend the existing CodeMirror 6 setup (already used for source mode) to support read-only code viewing with \~30 language packages, or use the existing lowlight/highlight.js library (192 languages, already used for code blocks) for static rendering. CodeMirror is recommended for its superior UX (line numbers, folding, selection).

**Recommended priority:** DOCX export (highest user value) &gt; Code file highlighting (low effort) &gt; HTML preview (low effort) &gt; Custom templates (medium effort) &gt; PPTX export (niche use case).

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

## 3. Custom Template Editor

### Current State

Notesage bundles three Typst templates (`clean.typ`, `academic.typ`, `report.typ`) loaded via `include_str!` at compile time. Users select a template at export time but cannot customize or create new ones.

### Approach: User-Editable Typst Templates

| Attribute | Details |
| --- | --- |
| **Template format** | Typst `.typ` files |
| **Storage** | `~/.notesage/templates/` (user) and `<project>/.notesage/templates/` (project) |
| **Discovery** | Same pattern as skills/agents: scan directories, merge with bundled templates |
| **Editing** | CodeMirror 6 editor panel with Typst syntax highlighting (community grammar exists) |
| **Preview** | Live preview using the existing embedded Typst compiler — render to PDF on keystroke (debounced) |
| **Marketplace** | Link to [Typst Universe](https://typst.app/universe/) for community templates; download `.typ` files to the templates directory |

### Implementation

1. **Template directory scanning** — follow the bundled-skills pattern: extract default templates to `~/.notesage/templates/` on first launch, scan for user additions
2. **Template editor UI** — split-pane: CodeMirror (left) with Typst syntax + live PDF preview (right) using the existing `export_pdf` Tauri command
3. **Template metadata** — YAML frontmatter in `.typ` files: `name`, `description`, `author`, `page_size`, `variables` (user-configurable parameters)
4. **Export dialog update** — show user templates alongside bundled ones in the template picker

### Recommendation

This is a medium-effort feature that requires no new dependencies. The Typst compiler is already embedded, CodeMirror is already in the app. The main work is the editor UI and template discovery logic. Typst Universe provides a natural "marketplace" without building custom infrastructure.

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
| **Custom templates** | Typst `.typ` files + CodeMirror editor + live preview | Medium | None (existing stack) | Medium |
| **HTML preview** | `comrak` HTML rendering (already a dep) + themed iframe | Small | None | Medium |
| **Code highlighting** | CodeMirror 6 read-only (already bundled) | Small | \~15 `@codemirror/lang-*` packages | High |

## Recommendation

### Phase 1 (Quick Wins)

1. **Code file syntax highlighting** — Replace `PlainTextViewer` with read-only CodeMirror. Small effort, immediate value for developers.
2. **HTML preview & export** — Add `render_html` Tauri command using comrak, themed iframe viewer, and file export. Small effort, useful for sharing.

### Phase 2 (Export Formats)

3. **DOCX export** — `docx-rs` crate, new `markdown_to_docx.rs` converter, export dialog integration. High user demand — "export to Word" is the #1 missing format.
4. **Custom template editor** — Template directory scanning, CodeMirror-based editor with live Typst preview. Unlocks user customization without a marketplace.

### Phase 3 (Nice to Have)

5. **PPTX export** — `ppt-rs` crate with markdown-to-slides. Niche use case but the library makes it straightforward.

## Open Questions

- **DOCX fidelity**: How well does `docx-rs` handle complex content (Excalidraw SVGs as embedded images, callout blocks, link preview cards)? May need a spike to test edge cases.
- **PPTX slide splitting**: Should heading levels map to slide breaks automatically, or should users insert explicit slide separators (e.g., `---` horizontal rules)?
- **Template variables**: Should custom Typst templates support user-configurable variables (author name, company logo, color scheme) editable from the export dialog?
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