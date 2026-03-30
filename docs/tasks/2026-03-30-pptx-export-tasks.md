# PPTX Export — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-03-30 |
| **Status** | Complete |
| **PRD** | [pptx-export](../prds/2026-03-30-pptx-export.md) |
| **Total** | 15 tasks: 4S, 7M, 4L |
| **Suggested order** | Backend foundation (#1-#3) → Core converter (#4-#5) → Content types (#6-#8) → Frontend (#9-#12) → User templates (#13-#14) → Tests (#15) |

**Risks:**

- `ppt-rs` is a newer crate — validate it compiles and produces valid PPTX files early (#1). If it's unusable, fall back to lower-level `office` XML crate or `pptx` crate.
- Chart mapping (#8) depends on `ppt-rs` chart API maturity — may need to degrade charts to images if the native chart API is incomplete.
- User template import (#13-#14) depends on `ppt-rs` supporting opening existing `.pptx` as a base document — verify in #1.

---

### #1 — Add `ppt-rs` dependency and validate ✅

**Description:** Add `ppt-rs` to `src-tauri/Cargo.toml`. Write a minimal smoke test that creates a presentation with one text slide and serializes to bytes. Verify the output opens in Keynote/PowerPoint. This de-risks the entire feature.

**Complexity:** S **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/Cargo.toml` — add `ppt-rs` dependency
- `src-tauri/src/export/mod.rs` — add `markdown_to_pptx` module declaration

---

### #2 — Create `markdown_to_pptx.rs` with heading-based slide splitting ✅

**Description:** New converter module that parses markdown with `comrak` and splits into slide structures based on H1 headings and `---` horizontal rules. For now, handle only plain text content: headings become slide titles, H2 becomes subtitle, paragraphs become body text. Output a `ppt-rs` `Presentation` object.

Acceptance criteria:

- H1 creates a new slide with the heading as title
- H2 appears as subtitle on the same slide
- H3-H6 rendered as bold/styled body text
- `---` forces a slide break
- First slide is a title slide with document title and date
- Content before first heading becomes title slide subtitle
- Empty documents produce a single title slide

**Complexity:** L **Category:** backend **Dependencies:** #1 **Files:**

- `src-tauri/src/export/markdown_to_pptx.rs` — NEW: core converter

---

### #3 — Add `export_pptx` Tauri command ✅

**Description:** Wire up the `export_pptx` Tauri command in `commands/export.rs` and register it in `lib.rs`'s `generate_handler![]` list. Command takes `markdown`, `title`, `template`, `project_root` and returns `Vec<u8>`. For now, use the `"simple"` template only (plain white slides). Reuse `save_binary_file` for writing to disk.

Acceptance criteria:

- `export_pptx` command callable from frontend
- Returns valid PPTX bytes
- Error messages propagated as `Err(String)`

**Complexity:** S **Category:** backend **Dependencies:** #2 **Files:**

- `src-tauri/src/commands/export.rs` — add `export_pptx` command
- `src-tauri/src/lib.rs` — register in `generate_handler![]`

---

### #4 — Add bullet lists, numbered lists, and task lists ✅

**Description:** Extend the converter to handle list AST nodes from `comrak`. Bullet lists → PowerPoint bullet points, numbered lists → numbered points, task lists → bullet points with Unicode checkbox symbols (☐/☑). Handle nested lists with indentation levels.

Acceptance criteria:

- Bullet lists render as bulleted text
- Numbered lists render as numbered text
- Task lists show checkbox symbols
- Nested lists show increasing indent levels

**Complexity:** M **Category:** backend **Dependencies:** #2 **Files:**

- `src-tauri/src/export/markdown_to_pptx.rs`

---

### #5 — Content overflow and continuation slides ✅

**Description:** Implement the overflow heuristic: if a single slide accumulates more than 8 bullet points or \~300 words, split into continuation slides with the title suffixed "(cont.)". This prevents slides from being unreadably dense.

Acceptance criteria:

- Slides with &gt;8 bullets split into continuations
- Slides with &gt;300 words of body text split
- Continuation slides show "Title (cont.)"

**Complexity:** M **Category:** backend **Dependencies:** #4 **Files:**

- `src-tauri/src/export/markdown_to_pptx.rs`

---

### #6 — Tables and code blocks ✅

**Description:** Map GFM tables to native PowerPoint table objects via `ppt-rs`. Header rows get bold text and darker background. Code blocks render as text boxes with monospace font (Consolas/Courier New), light grey background, and reduced font size (14pt).

Acceptance criteria:

- Markdown tables → PowerPoint tables with header styling
- Column widths proportional to content length
- Code blocks → monospace text boxes with grey background
- Language annotation preserved as a label (optional)

**Complexity:** M **Category:** backend **Dependencies:** #2 **Files:**

- `src-tauri/src/export/markdown_to_pptx.rs`

---

### #7 — Images and drawings ✅

**Description:** Resolve local image paths against `project_root` and embed in slides. Handle `.excalidraw` references by resolving to `.svg` counterparts (reuse `resolve_drawing_svgs` logic from PDF export). Images centered on slide, scaled to fit content area while preserving aspect ratio. Image-only slides get a full-slide layout.

Acceptance criteria:

- Local images embedded in PPTX (not linked)
- Relative paths resolved from `project_root`
- `.excalidraw` → `.svg` resolution
- Missing images show a placeholder text box
- Aspect ratio preserved

**Complexity:** M **Category:** backend **Dependencies:** #2 **Files:**

- `src-tauri/src/export/markdown_to_pptx.rs`

---

### #8 — Inline charts as native PowerPoint charts ✅

**Description:** When the converter encounters a chart reference (image node pointing to `.notesage/charts/<id>.json`), read the chart JSON, deserialize data (type, labels, series), and create a native PowerPoint chart via `ppt-rs`'s chart API. Map all 6 Notesage chart types to their PowerPoint equivalents. Fall back to a text placeholder if chart file is missing.

Acceptance criteria:

- Bar → clustered bar, Line → line, Area → area, Pie → pie, Donut → doughnut, Horizontal bar → clustered horizontal bar
- Chart data editable by recipients in PowerPoint
- Missing chart files show "\[Chart: filename\]" text placeholder

**Complexity:** L **Category:** backend **Dependencies:** #2 **Files:**

- `src-tauri/src/export/markdown_to_pptx.rs`

---

### #9 — Speaker notes and callout blocks ✅

**Description:** Parse `> [!notes]` callout blocks and attach content to the preceding slide's speaker notes pane (not on the slide). Other callout types (`note`, `tip`, `warning`, `important`) render as styled text boxes with a left border accent and bold type label. Link preview cards (`> [!link](url)`) render as hyperlink text boxes.

Acceptance criteria:

- `> [!notes]` content appears in PowerPoint notes pane
- `> [!notes]` content does NOT appear on the slide
- Other callouts render as styled text boxes
- Link previews render as clickable hyperlink text

**Complexity:** M **Category:** backend **Dependencies:** #2 **Files:**

- `src-tauri/src/export/markdown_to_pptx.rs`

---

### #10 — Built-in PPTX templates (Simple, Business, Report) ✅

**Description:** Define three template configurations (font choices, colors, layout dimensions, title slide styling, header/footer). Templates applied by configuring `ppt-rs`'s slide master properties. Store as Rust constants. Add `Template` enum and `from_str` matching for PPTX templates (separate from existing PDF templates).

Acceptance criteria:

- Simple: white background, centered title, generous margins
- Business: subtle header line, slide numbers in footer
- Report: dark accent title slide, two-column support option, slide numbers
- All use Calibri/Consolas (system fonts)
- Three visually distinct outputs

**Complexity:** L **Category:** backend **Dependencies:** #3 **Files:**

- `src-tauri/src/export/templates.rs` — extend with PPTX template config
- `src-tauri/src/export/markdown_to_pptx.rs` — apply template

---

### #11 — Frontend: `tauriApi.exportPptx` wrapper and `useExportOperations` update ✅

**Description:** Add `exportPptx` wrapper in `src/lib/tauri.ts`. Add `exportPptx` method in `useExportOperations` hook alongside existing `exportPdf`. Route based on export format. Add `lastExportFormat` and `lastPptxTemplate` to `settings-store.ts`.

Acceptance criteria:

- `tauriApi.exportPptx()` invokes `export_pptx` command
- `useExportOperations` exposes `exportPptx` method
- Settings store persists `lastExportFormat` and `lastPptxTemplate`
- Save dialog defaults to `.pptx` extension

**Complexity:** M **Category:** frontend **Dependencies:** #3 **Files:**

- `src/lib/tauri.ts` — add `exportPptx` wrapper
- `src/hooks/useExportOperations.ts` — add `exportPptx`, format routing
- `src/stores/settings-store.ts` — add `lastExportFormat`, `lastPptxTemplate`

---

### #12 — Export dialog: format selector and PPTX options ✅

**Description:** Extend `ExportDialog.tsx` with a format toggle (PDF / PowerPoint) at the top. When PowerPoint is selected, show PPTX template cards (Simple, Business, Report) and hide PDF-specific options (TOC, page numbers, page size). Dialog title updates dynamically. Format cross-fades with 150ms transition. Export button label changes ("Export PDF" / "Export PowerPoint").

Acceptance criteria:

- Format toggle: PDF / PowerPoint segmented control
- PPTX template cards match existing PDF template card styling
- PDF options hidden when PowerPoint selected (and vice versa)
- Last-used format and template restored on dialog open
- Works in both light and dark mode
- Export button routes to correct method

**Complexity:** M **Category:** frontend **Dependencies:** #11 **Files:**

- `src/components/ExportDialog.tsx`

---

### #13 — Sidebar context menu: "Export as PowerPoint" ✅

**Description:** Add "Export as PowerPoint" option to the sidebar right-click context menu on `.md` files, alongside the existing "Export as PDF". Clicking it opens the export dialog with PowerPoint format pre-selected.

Acceptance criteria:

- Context menu shows "Export as PowerPoint" for `.md` files
- Opens export dialog with PowerPoint format pre-selected
- Icon consistent with export dialog

**Complexity:** S **Category:** frontend **Dependencies:** #12 **Files:**

- `src/components/sidebar/FileTreeItem.tsx`

---

### #14 — User-uploaded PPTX templates ✅

**Description:** Implement Tauri commands `import_pptx_template`, `list_pptx_templates`, `delete_pptx_template` for managing user `.pptx` template files. Templates stored in `~/.notesage/pptx-templates/` (global) and `<project>/.notesage/pptx-templates/` (project). Validate imported templates have at least one title placeholder layout. Update `export_pptx` to accept user template IDs and load the `.pptx` as base document. Add template picker UI in export dialog: divider between built-in and user templates, "Add Template" button, delete on hover.

Acceptance criteria:

- Import `.pptx`/`.potx` files via native file dialog
- Templates listed alongside built-in presets with divider
- Invalid files show toast error
- Delete removes template file and index entry
- Per-project templates override global with same name
- Exported slides inherit template's masters/layouts/theme
- "Add Template" button in template picker

**Complexity:** L **Category:** both **Dependencies:** #10, #12 **Files:**

- `src-tauri/src/commands/export.rs` — add `import_pptx_template`, `list_pptx_templates`, `delete_pptx_template`
- `src-tauri/src/lib.rs` — register new commands
- `src/lib/tauri.ts` — add wrappers
- `src/components/ExportDialog.tsx` — template picker with user templates section

---

### #15 — Tests ✅

**Description:** Write unit tests for the markdown-to-PPTX converter covering: heading-based splitting, list conversion, table/code rendering, overflow continuation, speaker notes extraction, empty document handling. Add a Rust integration test that generates a PPTX from a fixture markdown file and validates it's non-empty valid ZIP (PPTX is a ZIP file). Add a frontend test for the export dialog format toggle behavior.

Acceptance criteria:

- Converter unit tests: slide count, title extraction, list formatting, overflow splitting
- Integration test: fixture → PPTX bytes → valid ZIP with expected entries
- ExportDialog test: format toggle shows/hides correct options
- All tests pass in CI

**Complexity:** S **Category:** both **Dependencies:** #9, #12 **Files:**

- `src-tauri/src/export/markdown_to_pptx.rs` — `#[cfg(test)]` module
- `src-tauri/src/export/integration_tests.rs` — PPTX integration test
- `src/components/ExportDialog.test.tsx` — format toggle tests