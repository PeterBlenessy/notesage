# Export Fidelity — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-12 (revised after browser-based export revert) |
| **Status** | Partial — 6 tasks complete, 5 remaining |
| **PRD** | [wysiwyg-export-font-fidelity](../prds/2026-04-11-wysiwyg-export-font-fidelity.md) |
| **Total** | 11 tasks: 5S, 4M, 2L (6 complete, 5 remaining) |
| **Suggested order** | PNG capture (#1) → System fonts (#2) → Style mapping (#3) → Color export (#4) → Tests (#5) |

**Context:** Browser-based PDF export (WKWebView) was attempted and reverted — WebKit cannot repeat headers/footers on printed pages. The Typst pipeline is restored. Remaining work: feed chart/drawing PNGs into Typst, load system fonts, and map document styling.

---

### #1 — Per-document `style:` frontmatter in editor ✅

**Description:** Parse `style:` YAML frontmatter into `DocumentStyle`, apply as per-document override in editor-styles-store, convert between presets and frontmatter format.

**Files:** `src/lib/frontmatter.ts`, `src/stores/editor-styles-store.ts`, `src/components/editor/Editor.tsx`

**Complexity:** L **Category:** both

---

### #2 — "Save to Document" / "Reset" toolbar actions ✅

**Description:** Add toolbar actions to save current typography presets into frontmatter and reset to global style.

**Files:** `src/components/editor/toolbar/TypographyPopover.tsx`, `src/lib/frontmatter.ts`

**Complexity:** S **Category:** frontend

---

### #3 — TOC Tiptap extension ✅

**Description:** Live table of contents via `/toc` slash command. Auto-updates, clickable, round-trips via `<!-- toc -->` markdown.

**Files:** `src/components/editor/extensions/toc.ts`, `src/components/editor/extensions/index.ts`, `src/components/editor/extensions/slash-command.tsx`, `src/lib/markdown.ts`, `src/styles/editor.css`

**Complexity:** L **Category:** frontend

---

### #4 — svg-to-png utility for DOCX/PPTX ✅

**Description:** Frontend Canvas-based PNG capture of chart/drawing/mermaid SVGs for embedding in DOCX/PPTX.

**Files:** `src/lib/svg-to-png.ts`, `src/hooks/useExportOperations.ts`

**Complexity:** M **Category:** frontend

---

### #5 — Performance: debounced serialization + targeted tree refresh ✅

**Description:** Debounce `getMarkdownFromEditor` to 150ms (was per-keystroke). File watcher passes `targetPath` to `refreshFileTree` instead of refreshing all sections. Restored individual Zustand selectors in Editor.tsx. Fixed `useActiveProject` to use filePath selector instead of subscribing to full tabs array.

**Files:** `src/hooks/useEditor.ts`, `src/hooks/useFileWatcher.ts`, `src/components/editor/Editor.tsx`, `src/hooks/useActiveProject.ts`, `src/components/editor/charts/ChartNodeView.tsx`

**Complexity:** M **Category:** frontend

---

### #6 — Bug fixes (PDF viewer, file watcher, slash command) ✅

**Description:** PDF viewer ReadableStream error suppression. File watcher binary file extension skip. Slash command search matches word starts and collapsed titles. Slash command menu scrollable with flip positioning.

**Files:** `src/components/editor/viewers/PdfViewer.tsx`, `src/hooks/useFileWatcher.ts`, `src/components/editor/extensions/slash-command.tsx`

**Complexity:** S **Category:** frontend

---

### #7 — Feed chart/drawing/mermaid PNGs into Typst PDF export

**Description:** Extend `export_pdf` to accept `embedded_images: Option<Vec<EmbeddedImage>>` (PNG bytes + dimensions). In `markdown_to_typst.rs`, when encountering a `chart`/`excalidraw`/`mermaid` code block, emit `#image(bytes(...))` instead of skipping the block. On the frontend, call `collectEmbeddedImages()` before `export_pdf` (same as DOCX/PPTX path).

**Acceptance criteria:**
- PDF export includes charts, drawings, and mermaid as images
- Images are correctly sized and positioned
- Existing text/table/heading export unchanged

**Complexity:** M **Category:** both **Dependencies:** #4 **Files:** `src-tauri/src/commands/export.rs`, `src-tauri/src/export/markdown_to_typst.rs`, `src/hooks/useExportOperations.ts`

---

### #8 — Load system fonts into Typst's fontdb

**Description:** Extend `shared_fontdb()` in `export.rs` to scan macOS system font directories (`/System/Library/Fonts/`, `/Library/Fonts/`, `~/Library/Fonts/`). Cache the fontdb across exports. The `resolve_font_family()` function in `typography.rs` can then pass through system font names (Georgia, Helvetica, SF Pro, etc.) since Typst will find them.

**Acceptance criteria:**
- PDF export uses the editor's chosen body font when it's a system font
- PDF export uses the editor's chosen heading font
- "System" font resolves to "SF Pro" (or similar) instead of falling through
- Font loading doesn't add >500ms to export time (lazy or cached)

**Complexity:** M **Category:** backend **Dependencies:** None **Files:** `src-tauri/src/commands/export.rs` (`shared_fontdb`), `src-tauri/src/export/typography.rs`

---

### #9 — Map document `style:` frontmatter to Typst parameters

**Description:** When `style:` frontmatter is present, convert `DocumentStyle` to Typst `#set` and `#show` rules. Add a new function in `typography.rs` or `markdown_to_typst.rs` that emits Typst preamble from the style block. This replaces the template-based approach for per-document styling while keeping templates as defaults.

**Acceptance criteria:**
- Document with `style: { body: { font: Georgia, size: 10.5pt } }` exports PDF in Georgia 10.5pt
- Heading styles (font, size, weight, alignment) applied per level
- Code block font applied
- Page size/margin from style frontmatter overrides export dialog selection

**Complexity:** M **Category:** backend **Dependencies:** #8 (system fonts must be loadable) **Files:** `src-tauri/src/export/markdown_to_typst.rs`, `src-tauri/src/export/typography.rs`

---

### #10 — Export text colors and highlights via Typst

**Description:** The `markdown_to_typst.rs` converter currently ignores text color marks and highlight marks. Add support for:
- Text color: emit `#text(fill: rgb("..."))[]` around colored text
- Highlight: emit `#highlight(fill: rgb("..."))[]` around highlighted text

Parse the color values from ProseMirror marks (stored as HTML `<span>` elements with style attributes in the comrak AST).

**Acceptance criteria:**
- Colored text in the editor appears colored in the PDF
- Highlighted text in the editor appears highlighted in the PDF
- All 8 text colors and 6 highlight colors mapped

**Complexity:** S **Category:** backend **Dependencies:** None **Files:** `src-tauri/src/export/markdown_to_typst.rs`

---

### #11 — Export fidelity tests

**Description:** Add tests for the new export capabilities:
1. Rust: `export_pdf` with `embedded_images` produces valid PDF with images
2. Rust: system fonts loaded into fontdb (at least one non-bundled font found)
3. Rust: `DocumentStyle` → Typst preamble conversion
4. Frontend: `collectEmbeddedImages` called for PDF format (not just DOCX/PPTX)
5. Frontend: document style test coverage (already partially done)

**Acceptance criteria:**
- All new tests pass
- `pnpm test` and `cargo test` both green

**Complexity:** S **Category:** both **Dependencies:** #7, #8, #9 **Files:** `src-tauri/src/export/integration_tests.rs`, frontend test files
