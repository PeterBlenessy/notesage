# WYSIWYG Export Fidelity — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-12 |
| **Status** | Not started |
| **PRD** | [wysiwyg-export-font-fidelity](../prds/2026-04-11-wysiwyg-export-font-fidelity.md) |
| **Total** | 12 tasks: 5S, 4M, 3L |
| **Suggested order** | WebKit PDF (#1-#3) → Remove Typst (#4-#6) → Document styling (#7-#9) → TOC (#10) → DOCX/PPTX cleanup (#11) → Tests (#12) |

**Risks:**

- WKWebView `createPDF` is accessed via `with_webview` + `objc2` — low-level unsafe Rust with minimal Tauri community examples. Prototype #1 early to validate.
- Safari's CSS Paged Media support is limited compared to Chrome — `@page` rules for page numbers may not work as expected. Test in #3.
- Removing Typst (#4-#6) is a large, high-blast-radius deletion across many files. Sequence carefully: new pipeline must be fully working before old is removed.
- The `render_html` command currently receives `embedded_svgs` for chart/drawing export. With WebKit PDF, the HTML preview approach may need charts/drawings rendered in the HTML itself — verify this works end-to-end in #2.

---

### #1 — Implement WKWebView `createPDF` Tauri command

**Description:** Add a new Tauri command `export_pdf_webkit` that:

1. Creates an offscreen `WKWebView` via Tauri's `with_webview` and `objc2_web_kit`
2. Loads an HTML string into it
3. Waits for navigation completion (implement `WKNavigationDelegate` or poll)
4. Calls `createPDF(configuration:completionHandler:)` with a `WKPDFConfiguration` rect matching the requested page size
5. Returns PDF bytes as `Vec<u8>`

Accept `html: String`, `page_width: f64`, `page_height: f64` (in points — A4 = 595.28 × 841.89, Letter = 612 × 792, A5 = 419.53 × 595.28).

Reference: `wry-0.54.2/src/wkwebview/ios/WKWebView.rs` has `createPDFWithConfiguration_completionHandler`. The command is registered in `src-tauri/src/lib.rs` alongside existing export commands.

**Acceptance criteria:**

- Command compiles and runs on macOS 11+
- Accepts HTML from `render_html` output and produces valid PDF bytes
- Page dimensions match the requested size
- Text, images, SVGs, and CSS all render in the PDF
- Async: doesn't block the main thread

**Complexity:** L **Category:** backend **Dependencies:** None **Files:** `src-tauri/src/commands/export.rs` (new command), `src-tauri/src/lib.rs` (register command), `src-tauri/Cargo.toml` (may need `objc2-web-kit` direct dep)

---

### #2 — Wire frontend PDF export to WebKit command

**Description:** Update the PDF export flow in `useExportOperations.ts`:

1. Call `render_html` to get standalone HTML (already done for HTML preview)
2. Inject `@media print` CSS for page size and margins into the HTML string
3. Call the new `export_pdf_webkit` command instead of `export_pdf`
4. Show save dialog and write bytes to disk (existing flow)

Keep the old `export_pdf` (Typst) command temporarily so both paths exist during the transition. Add a feature flag or just switch the call site.

For charts/drawings/mermaid: the `render_html` command already receives `embedded_svgs` and inlines them. WebKit renders these natively — no color resolution or font preprocessing needed. However, verify that the `render_html` HTML output (which is currently designed for iframe preview) works correctly when loaded into an offscreen WKWebView.

**Acceptance criteria:**

- PDF export button produces a PDF via WebKit, not Typst
- Fonts match the editor (SF Pro for default, user's choice for custom)
- Colors, highlights, code themes preserved
- Charts, drawings, mermaid rendered correctly
- Page size selection (A4/Letter/A5) works
- DOCX and PPTX paths unchanged

**Complexity:** M **Category:** frontend **Dependencies:** #1 **Files:** `src/hooks/useExportOperations.ts`, `src/lib/tauri.ts` (add new command type)

---

### #3 — Add `@media print` CSS for page layout

**Description:** Add print-specific CSS to the HTML export output. This CSS should be injected into the HTML before WebKit renders it. Include:

- `@page` rule with dynamic size and margin
- `break-inside: avoid` for code blocks, tables, charts, drawings, mermaid, blockquotes
- `page-break-after: avoid` for headings
- `orphans: 3; widows: 3` for paragraphs
- Optional page numbers via `@page { @bottom-center { content: counter(page); } }` — test Safari support
- Hide any interactive/editor-only elements if present

Can be injected as a `<style>` block in the HTML string on the frontend, or added to `html_styles.rs` behind a flag.

**Acceptance criteria:**

- PDF has \~1 inch margins
- Code blocks and tables don't break across pages
- No orphan/widow lines at page boundaries
- Headings aren't stranded at page bottoms
- Page numbers appear when enabled (or documented if Safari doesn't support `@page` counters)

**Complexity:** M **Category:** both **Dependencies:** #1, #2 **Files:** `src/hooks/useExportOperations.ts` (CSS injection), or `src-tauri/src/export/html_styles.rs` (Rust-side), `src-tauri/src/export/markdown_to_html.rs`

---

### #4 — Remove Typst Rust code and dependencies

**Description:** Delete all Typst-related Rust code:

- Delete `src-tauri/src/export/markdown_to_typst.rs` (1,319 lines)
- Delete `src-tauri/src/export/typst_world.rs` (234 lines)
- Remove Typst-related functions from `templates.rs` (keep PPTX template logic: `PptxTemplate`, `PptxTemplateConfig`, `generate_typst_styles` → delete, `generate_typst_header_footer` → delete)
- Delete `src-tauri/templates/clean.typ`, `academic.typ`, `report.typ`
- Delete `src-tauri/fonts/` directory (2.7MB of Inter, Source Serif, JetBrains Mono TTFs)
- Remove the old `export_pdf` command from `export.rs` and unregister from `lib.rs`
- Remove `preprocess_svg_text()`, `svg_to_png()`, `shared_fontdb()`, `FONTDB` static from `export.rs`
- Remove `typst`, `typst-pdf`, `typst-syntax`, `typst-library`, `typst-utils`, `usvg`, `resvg`, `fontdb` from `Cargo.toml`
- Update `src-tauri/src/export/mod.rs` to remove deleted modules
- Remove or update Typst-specific integration tests in `integration_tests.rs`

**Acceptance criteria:**

- `cargo build` succeeds without any Typst/usvg/resvg/fontdb deps
- `cargo test` passes (Typst tests removed, remaining export tests pass)
- No dead code warnings related to removed modules
- DOCX and PPTX exports still compile and work
- App binary size decreases

**Complexity:** L **Category:** backend **Dependencies:** #2 (new PDF path must be working first), #11 (DOCX/PPTX must not depend on usvg/resvg before removal) **Files:** Many — see deletion list above. High blast radius — review carefully.

---

### #5 — Remove Typst-related frontend code

**Description:** Clean up frontend code that only existed for the Typst pipeline:

- Remove `resolveChartColors()`, `oklchToHex()`, `THEME_COLORS`, `COLOR_PALETTES` import from `useExportOperations.ts`
- Remove the SVG color resolution in `collectEmbeddedSvgs()` — for PDF, WebKit handles everything; for DOCX/PPTX, frontend PNG capture (#11) replaces it
- Remove `embeddedSvgs` parameter from `tauriApi.exportPdf()` type (new command doesn't use it)
- Remove the pre-cache SVG logic in `Editor.tsx` (`cachedEmbeddedSvgsRef`, `prevViewModeRef`, the synchronous DOM collection block)
- Remove `cachedEmbeddedSvgs` prop from `HtmlViewer.tsx` — HTML preview can use `render_html` directly
- Simplify `ExportDialog.tsx`: remove template picker for PDF, remove "Include TOC" checkbox

**Acceptance criteria:**

- `pnpm typecheck` clean
- `pnpm test` all pass
- Export dialog shows only page size + page numbers for PDF format
- No dead imports or unused functions

**Complexity:** S **Category:** frontend **Dependencies:** #2, #4 **Files:** `src/hooks/useExportOperations.ts`, `src/components/ExportDialog.tsx`, `src/components/editor/Editor.tsx`, `src/components/editor/viewers/HtmlViewer.tsx`, `src/lib/tauri.ts`

---

### #6 — Clean up Rust export typography code

**Description:** Simplify `typography.rs` — the `resolve_font_family()` function and `ExportFormat` enum were needed to bridge frontend font names to Typst font names. With WebKit PDF, this mapping is no longer needed for PDF. Keep only what DOCX still uses (Word needs font names in its XML).

Also remove `TypographyPresets` fields that were only consumed by Typst (check if DOCX/HTML still use them — they do, so keep the struct but simplify resolution).

Remove the `generate_typst_styles` and `generate_typst_header_footer` functions from `templates.rs`. Keep PPTX template logic.

**Acceptance criteria:**

- `typography.rs` is simplified — no Typst-specific logic
- `templates.rs` only contains PPTX template code
- DOCX export still receives correct font names
- HTML export still receives correct font names
- No dead code

**Complexity:** S **Category:** backend **Dependencies:** #4 **Files:** `src-tauri/src/export/typography.rs`, `src-tauri/src/export/templates.rs`

---

### #7 — Parse `style:` frontmatter and apply in editor

**Description:** Extend frontmatter parsing (`src/lib/frontmatter.ts`) to recognize a `style:` block. Define a `DocumentStyle` TypeScript interface matching the YAML format in the PRD (`page`, `body`, `h1`-`h6`, `code`, `blockquote` sections with `font`, `size`, `weight`, `lineHeight`, etc.).

When a document with `style:` is opened:

1. Parse the `style:` block into a `DocumentStyle` object
2. Convert it to `TypographyPresets` (the existing editor format)
3. Apply as a per-document override in the editor styles store (new: document-level presets that take priority over global)

The editor-styles-store needs a new field: `documentPresets: TypographyPresets | null` that, when set, overrides the global `presets` for the active tab.

**Acceptance criteria:**

- A `.md` file with `style:` frontmatter opens with those typography settings
- The editor toolbar shows the document's font/size choices, not the global defaults
- Switching tabs applies the correct per-document (or global) presets
- Documents without `style:` behave as before

**Complexity:** L **Category:** both **Dependencies:** None (independent of WebKit PDF — can be done in parallel) **Files:** `src/lib/frontmatter.ts`, `src/stores/editor-styles-store.ts`, `src/hooks/useEditor.ts`, `src/components/editor/Editor.tsx`

---

### #8 — Convert `style:` frontmatter to CSS for export

**Description:** Add a function `documentStyleToCSS(style: DocumentStyle): string` that converts the parsed YAML style block to CSS rules. This CSS is injected into the HTML before `render_html` or `export_pdf_webkit`.

Mapping (from PRD): `font` → `font-family`, `size` → `font-size`, `weight` → `font-weight`, `lineHeight` → `line-height`, `color` → `color`, `textAlign`/`align` → `text-align`, `letterSpacing` → `letter-spacing`, `textTransform` → `text-transform`, `style` → `font-style`, `pageBreakBefore` → `page-break-before`, `margin` → `@page { margin }`, `size` under `page` → `@page { size }`.

**Acceptance criteria:**

- `documentStyleToCSS()` produces valid CSS for all supported YAML fields
- CSS is injected into HTML export output when `style:` frontmatter is present
- PDF exported from a styled document uses the document's typography
- HTML preview of a styled document uses the document's typography

**Complexity:** M **Category:** frontend **Dependencies:** #7 **Files:** `src/lib/frontmatter.ts` (or new `src/lib/document-style.ts`), `src/hooks/useExportOperations.ts`

---

### #9 — Add "Save as document style" / "Reset" toolbar actions

**Description:** Add two actions to the typography settings area of the toolbar:

- **"Save as document style"**: reads the current global `TypographyPresets`, converts to the YAML `style:` format, and writes it into the active document's frontmatter
- **"Reset to global style"**: removes the `style:` key from the active document's frontmatter

Both actions should mark the document as dirty and trigger auto-save.

**Acceptance criteria:**

- "Save as document style" creates/updates `style:` in frontmatter
- "Reset to global style" removes `style:` from frontmatter
- Document re-renders with the appropriate styles
- The frontmatter change is visible in source mode

**Complexity:** S **Category:** frontend **Dependencies:** #7, #8 **Files:** `src/components/editor/Toolbar.tsx` (typography settings section), `src/lib/frontmatter.ts`

---

### #10 — Add TOC Tiptap extension

**Description:** Create a Tiptap node extension for a live table of contents. Inserted via `/toc` slash command. Renders as an auto-updating outline of document headings (H1-H3). The TOC is a ProseMirror node that:

- Scans the document for heading nodes on every transaction
- Renders a clickable list with heading text and nesting
- Scrolls to the heading when clicked
- Serializes to markdown (e.g., as an HTML comment `<!-- toc -->` or a custom syntax) and round-trips
- Exports as HTML — visible in both HTML preview and WebKit PDF

**Acceptance criteria:**

- `/toc` slash command inserts a TOC block
- TOC shows all H1-H3 headings with correct hierarchy
- TOC updates live when headings change
- Clicking a heading entry scrolls to it
- TOC renders in HTML export and PDF
- Round-trip: TOC survives save → reopen

**Complexity:** L **Category:** frontend **Dependencies:** None (fully independent) **Files:** `src/components/editor/extensions/toc.ts` (new), `src/components/editor/extensions/index.ts`, `src/components/editor/SlashCommand.tsx`, `src/lib/markdown.ts` (serialization), `src/styles/editor.css`

---

### #11 — Move DOCX/PPTX chart/drawing images to frontend PNG capture

**Description:** Replace Rust-side `svg_to_png()` (usvg + resvg) with browser Canvas-based PNG capture for DOCX and PPTX exports. The frontend:

1. Serializes chart/drawing SVGs from the DOM (or Excalidraw `exportToSvg`)
2. Loads SVG into an `<img>` element via Blob URL
3. Draws onto a `<canvas>` at 2x scale
4. Extracts PNG bytes via `canvas.toBlob("image/png")`
5. Passes PNG bytes (as `number[]`) to the Rust DOCX/PPTX commands

The Rust commands receive `embedded_pngs: Option<Vec<Vec<u8>>>` instead of `embedded_svgs: Option<Vec<String>>`. The DOCX converter uses `Pic::new(&png_data)` directly (no SVG parsing). The PPTX converter writes PNG to temp file for `Image::from_path()`.

This removes the last dependency on `usvg`, `resvg`, and `fontdb` in Rust.

**Acceptance criteria:**

- DOCX export includes charts/drawings as properly sized PNG images
- PPTX export includes charts/drawings as properly sized PNG images
- PNG images use correct fonts (Virgil for drawings, sans-serif for chart labels)
- `usvg`, `resvg`, `fontdb` can be removed from `Cargo.toml` (verify no other uses)
- No visual regression compared to current Rust-side rasterization

**Complexity:** M **Category:** both **Dependencies:** None (can be done in parallel with #1-#3) **Files:** `src/hooks/useExportOperations.ts`, `src/lib/tauri.ts`, `src-tauri/src/commands/export.rs`, `src-tauri/src/export/markdown_to_docx.rs`, `src-tauri/src/export/markdown_to_pptx.rs`

---

### #12 — Write export fidelity tests

**Description:** Add/update tests for the new export pipeline:

1. **Rust integration test:** Call `export_pdf_webkit` with simple HTML, verify non-empty PDF bytes returned
2. **Rust:** Verify old `export_pdf` command is removed (no handler registered)
3. **Rust:** DOCX export with `embedded_pngs` produces valid DOCX
4. **Frontend unit test:** `documentStyleToCSS()` correctly converts YAML style to CSS
5. **Frontend unit test:** Frontmatter `style:` parsing produces correct `DocumentStyle` object
6. **Frontend:** ExportDialog no longer shows template picker for PDF format
7. **Remove:** All Typst-specific integration tests from `integration_tests.rs`

**Acceptance criteria:**

- All new tests pass
- No references to Typst remain in test code
- DOCX/PPTX export tests updated for PNG-based pipeline
- `pnpm test` and `cargo test` both green

**Complexity:** S **Category:** both **Dependencies:** #1, #4, #5, #8, #11 **Files:** `src-tauri/src/export/integration_tests.rs`, frontend test files