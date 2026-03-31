# Tasks: WYSIWYG Typography & Page Constructs

|  |  |
| --- | --- |
| **Date** | 2026-03-31 |
| **Status** | Not started |
| **PRD** | [wysiwyg-typography](../prds/2026-03-30-wysiwyg-typography.md) |
| **Total** | 18 tasks: 4S, 9M, 5L |
| **Suggested order** | Store foundation (#1-#2) → CSS & editor (#3-#5) → Toolbar UI (#6-#8) → Page breaks (#9-#10) → Backend export alignment (#11-#14) → Frontend export (#15-#16) → Migration & presets (#17) → Tests (#18) |

**Risks:**

- ProseMirror node attributes for local overrides must not break markdown round-trip — overrides are transient (not serialized)
- Removing the template picker from exports is a breaking UX change — ensure the default typography presets produce output equivalent to the current "Clean" template
- The 4 export pipelines (Typst, DOCX, PPTX, HTML) each have their own style application patterns — changes must be coordinated

**Open questions:**

- Should PPTX exports keep their own template picker (Simple/Business/Report) since slide design has no WYSIWYG equivalent? Recommendation: yes, PPTX is an exception — slides don't map 1:1 to editor appearance
- Should per-block-type color be included in Phase 1 or deferred? The PRD includes it but it adds complexity to every export pipeline

---

## Phase 1 — Per-Block-Type Typography & Export Alignment

### #1 — Extend editor-styles-store to per-block-type presets ✅

**Description:** Replace the flat `EditorStyles` interface with `TypographyPresets` containing per-block-type `BlockTypeStyle` objects (paragraph, heading1-6, codeBlock, blockquote). Add `loadTypography(notesagePath)` and `saveTypography(notesagePath)` that read/write `typography.json`. Keep the old `EditorStyles` fields as computed getters for backwards compatibility during migration. Add `updatePreset(blockType, style)` for the "Update to match" action and `getEffectiveStyle(blockType)` for toolbar context-awareness.

**Complexity:** L **Category:** frontend **Dependencies:** None **Files:**

- `src/stores/editor-styles-store.ts` — major rewrite
- `src/lib/typography-presets.ts` — new: default presets, type definitions, merge logic

---

### #2 — Auto-migrate editor-styles.json to typography.json ✅

**Description:** On `loadTypography()`, detect the old flat format in `editor-styles.json`. Map fontFamily → all block types, fontSize → paragraph fontSize (headings get proportional defaults: H1=2x, H2=1.5x, H3=1.25x, etc.), lineHeight → paragraph lineHeight, paragraphSpacing → paragraph spacingAfter. Write the new `typography.json`. Keep `editor-styles.json` untouched for rollback safety. Gate migration behind a version field in the new format.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- `src/stores/editor-styles-store.ts` — migration logic in `loadTypography()`
- `src/lib/typography-presets.ts` — migration function

---

### #3 — Apply per-block-type CSS variables in editor ✅

**Description:** Replace the 4 global CSS variables (`--editor-font-family`, `--editor-font-size`, `--editor-line-height`, `--editor-paragraph-spacing`) with per-block-type variables (`--ns-paragraph-font-family`, `--ns-h1-font-family`, etc.). Update `Editor.tsx` to compute and set all variables as inline styles on the editor container from the typography presets. Update `editor.css` to consume the new variables for each block type selector (`.ProseMirror p`, `.ProseMirror h1`, etc.).

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- `src/components/editor/Editor.tsx` — style computation (replace lines \~486-491)
- `src/styles/editor.css` — per-block-type CSS rules

---

### #4 — Add local override node attributes to heading and paragraph nodes ✅

**Description:** Extend the Tiptap Heading and Paragraph node specs to accept optional attributes: `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `color` (all default `null`). When non-null, render as inline styles on the node's DOM element, overriding the CSS variables. These attributes are **not serialized to markdown** — they exist only in ProseMirror. Add a `clearOverrides` command that removes all override attributes from the current node.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #3 **Files:**

- `src/hooks/useEditor.ts` — extend Heading/Paragraph extension config with custom attrs
- `src/components/editor/extensions/` — may need a custom extension or nodeView to apply inline styles from attrs

---

### #5 — Ensure local overrides don't break markdown round-trip ✅

**Description:** Verify that ProseMirror node attributes with `null` defaults are not serialized by `prosemirror-markdown`. Add a round-trip test with a document containing heading and paragraph nodes that have override attrs set — confirm the markdown output is identical to a document without overrides. If `prosemirror-markdown` does serialize custom attrs, add explicit filtering in the markdown serializer.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #4 **Files:**

- `src/lib/markdown.ts` — possible serializer adjustment
- `tests/` — round-trip test fixture

---

### #6 — Make Typography popover context-aware ✅

**Description:** Update `TypographyPopover` to read the current block's effective style (preset + any local overrides) instead of the global editor styles. When the cursor is in an H2, the popover shows H2's font/size/weight/spacing. Changes apply as local overrides to the current block (set node attributes via ProseMirror transaction). Add a font weight dropdown (Regular 400, Medium 500, Semibold 600, Bold 700). Adjust slider ranges to be appropriate for headings (fontSize up to 48px for H1).

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #1, #4 **Files:**

- `src/components/editor/toolbar/TypographyPopover.tsx` — major rewrite to be block-context-aware
- `src/hooks/useEditor.ts` — helper to get current block type and effective style

---

### #7 — Add "Update to match" and "Reset" actions to heading picker ✅

**Description:** Enhance the block-type dropdown (HeadingPicker in `Toolbar.tsx`) with two actions below a separator: "Update 'Heading N' to match" and "Reset to 'Heading N' style". "Update to match" reads the current block's effective style (preset + local overrides), writes it to the store as the new preset for that block type, and clears local overrides on the current node. "Reset" clears local override attributes on the current node. Both actions are only visible when the current block has local overrides (compare node attrs to preset). Show the current block type name dynamically.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1, #4, #6 **Files:**

- `src/components/editor/Toolbar.tsx` — HeadingPicker section enhancement
- May extract to `src/components/editor/toolbar/HeadingPicker.tsx` if it grows large

---

### #8 — Add override indicator to block-type dropdown ✅

**Description:** When the current block has local typography overrides (any non-null override attr), show a subtle visual indicator next to the block type name in the dropdown trigger (e.g., a small dot or modified icon). This signals to the user that the block diverges from its preset and that "Update to match" / "Reset" actions are available.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #4, #7 **Files:**

- `src/components/editor/Toolbar.tsx` — heading picker trigger rendering

---

### #9 — Add insertable page break node ✅

**Description:** Create a new ProseMirror atom node `pageBreak` that renders as a labeled horizontal divider ("Page Break"). Add it to the editor schema. Render as a `<div>` with dashed border and centered "Page Break" label. Make it selectable, deletable, and draggable. In paged view, the existing page break calculation logic should recognize this node and force a page break at its position. Add `/pagebreak` to the slash command menu following the existing command pattern.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/components/editor/extensions/page-break-node.ts` — new: ProseMirror node extension
- `src/components/editor/extensions/slash-command.tsx` — add Page Break command item
- `src/components/editor/extensions/page-breaks.ts` — integrate with existing visualization
- `src/hooks/useEditor.ts` — register the new extension
- `src/styles/editor.css` — page break node styling

---

### #10 — Page break markdown round-trip and export mapping ✅

**Description:** Serialize the `pageBreak` node as `<!-- pagebreak -->` HTML comment in markdown. Parse `<!-- pagebreak -->` back to the `pageBreak` node on load. Add export support: Typst → `#pagebreak()`, DOCX → page break paragraph property, HTML → `<div style="page-break-before: always"></div>`. Verify round-trip with a test fixture.

**Complexity:** M **Category:** both **Dependencies:** Depends on #9 **Files:**

- `src/lib/markdown.ts` — serializer and parser for `<!-- pagebreak -->`
- `src-tauri/src/export/markdown_to_typst.rs` — handle `<!-- pagebreak -->` comment
- `src-tauri/src/export/markdown_to_docx.rs` — handle page break
- `src-tauri/src/export/markdown_to_html.rs` — handle page break
- `tests/fixtures/page-break.md` — new test fixture

---

### #11 — Add TypographyPresets struct to Rust backend ✅

**Description:** Define `TypographyPresets` and `BlockTypeStyle` structs in the export module matching the frontend types. Add `serde::Deserialize` for receiving from frontend via IPC. Add a `resolve_font_family()` helper that maps preset keys ("system", "source-serif-4", "jetbrains-mono") to actual font names for each export format. Add default preset values matching the current Clean template output.

**Complexity:** M **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/src/export/mod.rs` or new `src-tauri/src/export/typography.rs` — struct definitions
- `src-tauri/src/export/templates.rs` — integrate with existing template system

---

### #12 — Update PDF (Typst) export to use typography presets ✅

**Description:** Replace the current `apply_template()` approach with `generate_typst_styles(presets)` that emits `#set text(...)`, `#set heading(...)`, etc. from the typography presets. Update the `export_pdf` command signature to accept `typography: Option<TypographyPresets>` instead of `template: String`. When `typography` is `None`, use default presets (equivalent to current Clean template output). Keep TOC, page numbers, and page size as separate parameters. Ensure bundled fonts (Inter, Source Serif 4, JetBrains Mono) are resolved correctly for each preset font family.

**Complexity:** L **Category:** backend **Dependencies:** Depends on #11 **Files:**

- `src-tauri/src/commands/export.rs` — update `export_pdf` signature
- `src-tauri/src/export/templates.rs` — replace `apply_template()` with `generate_typst_styles()`
- `src-tauri/src/export/markdown_to_typst.rs` — pass presets to converter if needed

---

### #13 — Update DOCX export to use typography presets ✅

**Description:** Replace the hardcoded `TemplateConfig::from_name()` with a function that builds `TemplateConfig` from `TypographyPresets`. Map each block type's preset to the corresponding DOCX paragraph/run style (font, size in half-points, weight as bold flag, line spacing in twips). Update the `export_docx` command signature to accept `typography: Option<TypographyPresets>` instead of `template: String`. When `None`, use defaults matching current Clean output.

**Complexity:** L **Category:** backend **Dependencies:** Depends on #11 **Files:**

- `src-tauri/src/commands/export.rs` — update `export_docx` signature
- `src-tauri/src/export/markdown_to_docx.rs` — replace `TemplateConfig::from_name()`, apply preset values

---

### #14 — Update HTML export to use typography presets ✅

**Description:** Generate a `<style>` block from typography presets and embed it in the HTML output. Map each block type's preset to CSS rules (`h1 { font-family: ...; font-size: ...; }` etc.). Update the `render_html` command signature to accept `typography: Option<TypographyPresets>`. The existing embedded CSS in `html_styles.rs` provides the base; preset-derived styles override the typography-specific properties.

**Complexity:** M **Category:** backend **Dependencies:** Depends on #11 **Files:**

- `src-tauri/src/commands/export.rs` — update `render_html` signature
- `src-tauri/src/export/markdown_to_html.rs` — inject preset-derived CSS
- `src-tauri/src/export/html_styles.rs` — adjust base styles to be overridable

---

### #15 — Update ExportDialog to remove template picker ✅

**Description:** Remove the template picker grid (Clean/Academic/Report) from the PDF and DOCX sections of `ExportDialog`. Keep the options: TOC toggle, page numbers toggle, page size selector. For PPTX, keep the existing template picker (slide design has no WYSIWYG equivalent). Update the dialog layout — it should be cleaner and more compact without the template grid. Remove `lastExportTemplate` from the settings store's export persistence (keep the field but stop reading/writing it).

**Complexity:** S **Category:** frontend **Dependencies:** None (can be done in parallel with backend work) **Files:**

- `src/components/ExportDialog.tsx` — remove template grid for PDF/DOCX sections
- `src/stores/settings-store.ts` — stop using `lastExportTemplate` for PDF/DOCX

---

### #16 — Update useExportOperations to pass typography presets ✅

**Description:** Update `useExportOperations` to read typography presets from the store and pass them to the Tauri export commands (`exportPdf`, `exportDocx`, `renderHtml`) instead of the template name. Update the `tauriApi` type definitions for the new command signatures. For PPTX, continue passing the template name (slide templates are independent of editor typography).

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #12, #13, #14 **Files:**

- `src/hooks/useExportOperations.ts` — pass presets instead of template
- `src/lib/tauri.ts` or equivalent — update IPC type definitions

---

### #17 — Add document creation presets to New Note dialog ✅

**Description:** Add a "Style" selector to the New Note dialog with three options: Default, Academic, Report. Each option pre-populates the project's `typography.json` with a preset bundle (Default = system fonts, Academic = Source Serif 4, Report = Inter). This replaces the concept of "export templates" with "creation presets". Only shown when creating a note in a project context. If `typography.json` already exists for the project, the selector defaults to "Keep current" and doesn't overwrite.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- `src/components/NewNoteDialog.tsx` — add style preset selector
- `src/lib/typography-presets.ts` — preset bundles (Default, Academic, Report)

---

### #18 — Write tests for typography presets and page breaks ✅

**Description:** Add unit tests covering:

1. Typography preset store: load, save, getEffectiveStyle, updatePreset, per-block-type independence
2. Migration: old `editor-styles.json` → new `typography.json` with correct proportional heading sizes
3. Page break node: insert, delete, selection behavior
4. Page break markdown round-trip: `<!-- pagebreak -->` ↔ pageBreak node
5. Rust: typography preset deserialization, font family resolution, Typst/DOCX/HTML style generation from presets

**Complexity:** L **Category:** both **Dependencies:** Depends on #1, #2, #9, #10, #11, #12, #13, #14 **Files:**

- `src/stores/__tests__/editor-styles-store.test.ts` — extend or rewrite
- `src/lib/__tests__/typography-presets.test.ts` — new
- `tests/fixtures/page-break.md` — new test fixture
- `src-tauri/src/export/` — `#[cfg(test)]` modules in relevant files

---

## Phase 2 — Page Constructs (Future)

> These tasks are scoped but not broken down in detail. They will get their own task breakdown when Phase 1 is complete.

### Headers/Footers

- Define `DocumentPageSettings` data model and frontmatter schema
- Implement header/footer zones as ProseMirror decorations in paged view
- Build inline editing UI for header/footer content with variable insertion
- Add "Different first page" toggle
- Map to PDF (Typst `set page(header/footer)`), DOCX (Word header/footer XML), HTML (`@page` CSS)

### Title Page Toggle

- Add toggle to header/footer edit UI
- First page gets independent header/footer settings (or none)
- Content on first page styled by user with standard block-type typography