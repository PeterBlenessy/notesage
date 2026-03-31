# DOCX Export — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-03-30 |
| **Status** | Not started |
| **PRD** | [docx-export](../prds/2026-03-30-docx-export.md) |
| **Total** | 14 tasks: 3S, 7M, 4L |
| **Suggested order** | Backend refactor (#1) → Backend core (#2-#6) → Frontend (#7-#11) → Tests (#12-#14) |

**Risks:**

- `docx-rs` 0.4 may have gaps in TOC field support or header/footer APIs — verify early in #3
- Image embedding (local files, SVGs from drawings) may require raw byte handling not covered by `docx-rs` examples — spike in #5
- Callout rendering as single-cell table with colored border depends on `docx-rs` table cell shading/border APIs

---

### #1 — Extract shared table utilities from `markdown_to_typst.rs`

**Description:** Extract `ColumnMeta`, `parse_column_metadata()`, `compute_aggregation()`, `format_value_for_pdf()` (rename to `format_value()`), `parse_numeric_value()`, `strip_sparkline_syntax()`, `CalloutInfo`, `detect_callout()`, `LinkPreviewInfo`, and `detect_link_preview()` into a new `src-tauri/src/export/table_utils.rs` module. Update `markdown_to_typst.rs` to import from the shared module. Verify all existing Typst export tests still pass.

**Complexity:** M (30-60 min)
**Category:** backend
**Dependencies:** None
**Files:**
- Create `src-tauri/src/export/table_utils.rs`
- Modify `src-tauri/src/export/markdown_to_typst.rs` (remove extracted code, add imports)
- Modify `src-tauri/src/export/mod.rs` (add `pub mod table_utils`)

---

### #2 — Add `docx-rs` dependency to Cargo.toml

**Description:** Add `docx-rs = "0.4"` to `src-tauri/Cargo.toml` dependencies. Run `cargo check` to verify it compiles. Verify the crate API supports: paragraphs with styled runs, heading styles, tables with borders, hyperlinks, images (embedded bytes), page setup (size, margins), headers/footers, and document properties (title, author).

**Complexity:** S (< 15 min)
**Category:** backend
**Dependencies:** None
**Files:**
- Modify `src-tauri/Cargo.toml`

---

### #3 — Implement `markdown_to_docx` converter — basic content (headings, paragraphs, inline formatting)

**Description:** Create `src-tauri/src/export/markdown_to_docx.rs` with a `DocxConverter` struct that walks the comrak AST. Implement:
- Headings (H1-H6) using Word heading styles with template-appropriate font sizes and weights
- Paragraphs with Normal style
- Bold, italic, strikethrough runs
- Inline code with monospace font and grey shading
- Links as hyperlinks with underline
- Horizontal rules as paragraph with bottom border
- Frontmatter stripping (skip `FrontMatter` nodes)

Follow the same comrak parsing setup as `markdown_to_typst.rs` (GFM extensions: table, tasklist, strikethrough, autolink, front_matter_delimiter).

The converter should accept a `DocxOptions` struct with `include_toc`, `include_page_numbers`, `page_size`, and `project_root` fields.

**Complexity:** L (2-3 hrs)
**Category:** backend
**Dependencies:** Depends on #1, #2
**Files:**
- Create `src-tauri/src/export/markdown_to_docx.rs`
- Modify `src-tauri/src/export/mod.rs` (add `pub mod markdown_to_docx`)

---

### #4 — Implement `markdown_to_docx` — lists, blockquotes, callouts, code blocks

**Description:** Extend the DOCX converter with:
- Bullet lists with proper nesting (indent levels)
- Ordered lists with numbering and nesting
- Task lists with checkbox Unicode characters (☐ unchecked, ☑ checked)
- Blockquotes with left indent (0.5in) and left border (grey, 3pt)
- Callout blocks (`> [!type]`) as single-cell tables with colored left border, light background tint, and bold type label. Use `detect_callout()` from `table_utils.rs`.
- Code blocks with monospace font (JetBrains Mono/Consolas) and light grey background shading

**Complexity:** L (2-3 hrs)
**Category:** backend
**Dependencies:** Depends on #3
**Files:**
- Modify `src-tauri/src/export/markdown_to_docx.rs`

---

### #5 — Implement `markdown_to_docx` — tables, images, drawings, link previews

**Description:** Extend the DOCX converter with:
- Tables with header row styling, borders, and column alignment
- Dynamic table support: parse column metadata via `parse_column_metadata()`, format values via `format_value()`, compute aggregation footers via `compute_aggregation()`, strip sparklines via `strip_sparkline_syntax()`
- Images: embed local images (resolve from `project_root`) and remote URLs as inline images
- Drawing blocks: resolve `.excalidraw` → `.svg` sidecar files and embed as images
- Link preview cards (`> [!link]`): bold title paragraph, description, grey URL. Use `detect_link_preview()` from `table_utils.rs`.
- Text color and highlight marks as run color/shading properties

**Complexity:** L (2-3 hrs)
**Category:** backend
**Dependencies:** Depends on #4
**Files:**
- Modify `src-tauri/src/export/markdown_to_docx.rs`

---

### #6 — Implement template styling and document options (TOC, page numbers, page size, headers/footers)

**Description:** Implement the three template presets as Rust structs with font/size/color parameters:
- **Clean:** Inter, 11pt body, 24pt H1, 1.15 line spacing, no header/footer
- **Academic:** Source Serif 4, 12pt body, 22pt H1, 1.5 line spacing, header with title + page number
- **Report:** Inter, 11pt body, title page (title + date), header/footer throughout

Implement optional features:
- Table of contents via Word TOC field (updateable in Word)
- Page numbers in footer
- Page size (A4: 210x297mm, Letter: 215.9x279.4mm, A5: 148x210mm)
- Document properties (title from parameter)

**Complexity:** M (1-2 hrs)
**Category:** backend
**Dependencies:** Depends on #3
**Files:**
- Modify `src-tauri/src/export/markdown_to_docx.rs`

---

### #7 — Add `export_docx` Tauri command

**Description:** Add the `export_docx` async Tauri command in `src-tauri/src/commands/export.rs` with the same parameter signature as `export_pdf`. Register it in `generate_handler![]` in `src-tauri/src/lib.rs`. Add the `exportDocx` wrapper in `src/lib/tauri.ts`.

```rust
#[tauri::command]
pub async fn export_docx(
    markdown: String,
    title: String,
    template: String,
    include_toc: bool,
    include_page_numbers: bool,
    page_size: String,
    project_root: Option<String>,
) -> Result<Vec<u8>, String>
```

**Complexity:** S (< 30 min)
**Category:** both
**Dependencies:** Depends on #3
**Files:**
- Modify `src-tauri/src/commands/export.rs`
- Modify `src-tauri/src/lib.rs` (add to `generate_handler![]`)
- Modify `src/lib/tauri.ts` (add `exportDocx` wrapper)

---

### #8 — Add `lastExportFormat` to settings store

**Description:** Add `lastExportFormat: 'pdf' | 'docx'` field to `settings-store.ts` with default `'pdf'` and a setter `setLastExportFormat`. Add `ExportFormat` type export. Update the `ExportOptions` interface in `ExportDialog.tsx` to include `format: ExportFormat`.

**Complexity:** S (< 15 min)
**Category:** frontend
**Dependencies:** None
**Files:**
- Modify `src/stores/settings-store.ts`
- Modify `src/components/ExportDialog.tsx` (update `ExportOptions` interface)

---

### #9 — Add format picker to ExportDialog

**Description:** Add a format picker at the top of the ExportDialog with two toggle buttons: PDF (FileText icon) and Word/DOCX (FileType icon). Use styled buttons with active state (matching the template selector pattern). The selected format is read from `lastExportFormat` on dialog open. Update dialog title to "Export Document" (from "Export as PDF"). Update button text to "Export PDF" or "Export DOCX" based on selection. Update `DialogDescription` accordingly.

**Complexity:** M (30-60 min)
**Category:** frontend
**Dependencies:** Depends on #8
**Files:**
- Modify `src/components/ExportDialog.tsx`

---

### #10 — Update `useExportOperations` to handle DOCX format

**Description:** Extend `useExportOperations` to branch on `options.format`:
- `'pdf'`: existing `exportPdf` logic (unchanged)
- `'docx'`: call `tauriApi.exportDocx(...)`, suggest `.docx` extension in save dialog, use `{ name: "Word Document", extensions: ["docx"] }` filter, show "DOCX exported" toast with Reveal in Finder action

Persist `lastExportFormat` alongside other settings. Rename the exported function from `exportPdf` to `exportDocument` (or add a second function and update callers).

**Complexity:** M (30-60 min)
**Category:** frontend
**Dependencies:** Depends on #7, #9
**Files:**
- Modify `src/hooks/useExportOperations.ts`
- Modify `src/components/editor/Editor.tsx` (update caller if function renamed)

---

### #11 — Update sidebar context menu for DOCX export

**Description:** The sidebar right-click context menu currently has "Export as PDF". Either:
- (a) Change to "Export..." which opens the Export Dialog (preferred — lets user pick format), or
- (b) Add a second item "Export as Word Document" alongside the existing one

Option (a) is simpler and aligns with the PRD. Ensure the context menu item is only shown for `.md` files.

**Complexity:** M (30 min)
**Category:** frontend
**Dependencies:** Depends on #10
**Files:**
- Modify `src/components/sidebar/FileTreeItem.tsx` (or wherever the context menu is defined)

---

### #12 — Write Rust unit tests for `table_utils.rs`

**Description:** Add unit tests for the extracted shared utilities:
- `parse_column_metadata()`: empty, single prop, multiple props, no comment
- `compute_aggregation()`: sum, avg, count, min, max, empty input
- `format_value()`: number, currency (USD, EUR), percentage
- `parse_numeric_value()`: plain number, currency-prefixed, percentage, non-numeric
- `strip_sparkline_syntax()`: with sparkline, without, nested

Verify existing `markdown_to_typst` integration tests still pass after the refactor.

**Complexity:** M (30-60 min)
**Category:** backend
**Dependencies:** Depends on #1
**Files:**
- Add tests in `src-tauri/src/export/table_utils.rs` (inline `#[cfg(test)]` module)

---

### #13 — Write Rust unit tests for `markdown_to_docx` converter

**Description:** Add unit tests for the DOCX converter covering all node types:
- Headings (H1-H6), paragraphs, inline formatting (bold, italic, strikethrough, code)
- Lists (bullet, ordered, task, nested)
- Tables (basic, with column metadata, with aggregation footer)
- Code blocks, blockquotes, callouts
- Links, images, horizontal rules
- Frontmatter stripping
- Template application (clean, academic, report)
- Page size options

Tests should verify the converter produces valid `Vec<u8>` output without panicking. For structural validation, inspect the docx-rs document model before serialization where the API allows it.

**Complexity:** L (2+ hrs)
**Category:** backend
**Dependencies:** Depends on #5, #6
**Files:**
- Add tests in `src-tauri/src/export/markdown_to_docx.rs` (inline `#[cfg(test)]` module) or `src-tauri/src/export/integration_tests.rs`

---

### #14 — Write frontend unit tests for DOCX export path

**Description:** Add/update tests for:
- `useExportOperations`: test that DOCX format calls `exportDocx` Tauri command with correct params, handles save dialog cancellation, persists `lastExportFormat`
- `ExportDialog`: test format picker renders, toggles between PDF/DOCX, updates button text, persists format selection
- `settings-store`: test `lastExportFormat` field default, setter, persistence

**Complexity:** M (30-60 min)
**Category:** frontend
**Dependencies:** Depends on #10
**Files:**
- Create or modify `src/hooks/__tests__/useExportOperations.test.ts`
- Create or modify `src/components/__tests__/ExportDialog.test.tsx`
- Modify `src/stores/__tests__/settings-store.test.ts` (if exists)
