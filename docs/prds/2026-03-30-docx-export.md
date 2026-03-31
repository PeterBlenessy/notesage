# PRD: DOCX Export

|  |  |
| --- | --- |
| **Date** | 2026-03-30 |
| **Status** | Complete |
| **Priority** | High |
| **Impact** | Users can export notes as Word documents for sharing with collaborators who don't use markdown tools |
| **Research** | [document-format-enhancements](../research/2026-03-30-document-format-enhancements.md) |
| **Tasks** | [docx-export-tasks](../tasks/2026-03-30-docx-export-tasks.md) |

## Problem

Notesage can export to PDF but not to Word (.docx). PDF is a final-form format — recipients cannot edit it. In professional, academic, and collaborative workflows, Word documents are the expected interchange format. Collaborators, editors, and reviewers need to receive editable documents with tracked changes support, proper heading styles for navigation panes, and tables that resize correctly.

Users currently must copy-paste content into Google Docs or Word to create a .docx, losing all formatting, tables, and structure. This is a high-friction workflow gap for anyone who writes in Notesage but collaborates with non-markdown users.

## Goals

1. **One-click DOCX export** — export the active markdown document to a `.docx` file with correct Word styles, tables, lists, and images
2. **Template support** — three built-in style presets (Clean, Academic, Report) matching the existing PDF templates, so users get consistent output across formats
3. **Full content mapping** — all Notesage content types render correctly: headings, lists (bullet, ordered, task), tables (including dynamic table metadata), code blocks, blockquotes, callout blocks, images, drawings, link preview cards, inline formatting (bold, italic, strikethrough, code, links, highlights)
4. **Dynamic table intelligence** — parse `<!-- type:currency,summary:sum -->` column metadata, compute aggregation footers, format numbers by type, degrade sparklines to comma-separated text
5. **Seamless UX** — integrate into the existing Export Dialog alongside PDF; same keyboard shortcut (Cmd+Shift+E), same settings persistence

## Non-Goals

- DOCX import or editing — Notesage already has read-only DOCX viewing via mammoth.js; editing Word documents is out of scope
- Custom user-defined Word templates (.dotx) — would require a template management system; deferred to a future enhancement
- Track changes or revision marks in the exported document
- Password protection or document encryption
- Embedded macros or active content
- Bi-directional DOCX round-tripping (export then re-import without loss)
- Header/footer customization beyond what templates provide
- Footnotes or endnotes — not supported in the editor's markdown model

## User Stories

- As a report author, I want to export my note as a Word document so that my colleagues can review and edit it in Microsoft Word
- As an academic writer, I want my exported .docx to use proper Word heading styles (Heading 1, Heading 2, etc.) so the document outline and navigation pane work correctly in Word
- As a user with data tables, I want my currency-formatted columns and aggregation footers to appear correctly in the Word export so the numbers look professional
- As a user with callout blocks and drawings, I want these to render as styled elements in the Word document so my visual content is preserved
- As a user, I want to choose between Clean, Academic, and Report templates for my Word export, just like I can for PDF
- As a user, I want my last-used export format and settings to be remembered so I don't have to reconfigure every time

## Technical Approach

### Rust Backend: `docx-rs` Crate

Add the `docx-rs` crate to `src-tauri/Cargo.toml`:

```toml
# DOCX export
docx-rs = "0.4"
```

`docx-rs` is a pure-Rust OOXML document builder (500+ GitHub stars, 1M+ crates.io downloads) that produces valid `.docx` files. It supports paragraphs with runs, heading styles, tables, images, and custom styling — all the primitives needed for the converter.

### New Module: `markdown_to_docx.rs`

Create `src-tauri/src/export/markdown_to_docx.rs` following the same pattern as the existing `markdown_to_typst.rs`:

1. Parse markdown with `comrak` (GFM extensions: tables, tasklists, strikethrough, autolinks, frontmatter)
2. Walk the AST tree recursively
3. Emit `docx-rs` document nodes for each markdown node

```rust
use comrak::{parse_document, Arena, Options};
use docx_rs::*;

pub fn markdown_to_docx(
    markdown: &str,
    title: &str,
    template: &str,
    options: &DocxOptions,
) -> Result<Vec<u8>, String> {
    // Parse markdown AST
    let arena = Arena::new();
    let root = parse_document(&arena, markdown, &options);

    // Build document with template styling
    let mut converter = DocxConverter::new(title, template, options);
    converter.convert_node(root);
    converter.finish()
}

pub struct DocxOptions {
    pub include_toc: bool,
    pub include_page_numbers: bool,
    pub page_size: String,        // "a4" | "letter" | "a5"
    pub project_root: Option<String>,
}
```

Register the module in `src-tauri/src/export/mod.rs`:

```rust
pub mod markdown_to_docx;
```

### Content Mapping

| Markdown Element | Word Representation |
| --- | --- |
| `# Heading 1` – `###### Heading 6` | Built-in Word heading styles (`Heading1` – `Heading6`) with appropriate font sizes and weights |
| Paragraph | Normal style paragraph |
| **Bold** | Run with `bold: true` |
| *Italic* | Run with `italic: true` |
| ~~Strikethrough~~ | Run with `strike: true` |
| `inline code` | Run with monospace font (JetBrains Mono or Consolas) and light grey background shading |
| [Link](url) | Hyperlink run with underline and grey color (matching design system — no blue) |
|  | Inline image embedded in the document; local paths resolved from `project_root` |
| Bullet list | Word bullet list with proper nesting (indent levels) |
| Ordered list | Word numbered list with proper nesting |
| Task list | Bullet list with checkbox Unicode characters (☐ / ☑) — Word doesn't have native task lists |
| Blockquote | Paragraph with left indent (0.5in) and left border (grey, 3pt) |
| Callout (`> [!type]`) | Table with single cell: colored left border, light background tint, icon character + type label in bold first line |
| Code block | Paragraph with monospace font, light grey background shading, 8pt padding |
| Table | Word table with header row styling, borders, and alignment per column |
| Horizontal rule | Paragraph with bottom border (styled divider) |
| Drawing (`.excalidraw`) | Embedded SVG image (resolved from `.svg` sidecar file) |
| Link preview (`> [!link]`) | Styled paragraph: bold title, description on next line, URL in grey below |
| Inline chart (`{{spark:...}}`) | Comma-separated numbers as plain text (same degradation as PDF) |
| Text color / highlight | Run with corresponding color / shading properties |

### Dynamic Table Support

Reuse the same metadata parsing logic from `markdown_to_typst.rs`:

1. **Column metadata extraction:** Parse `<!-- type:currency,summary:sum -->` HTML comments from header cells using the existing `parse_column_metadata()` function (extract to a shared utility in the `export` module)
2. **Number formatting:** Apply `format_value_for_pdf()` (rename to `format_value()`) based on column type (currency, percentage, number)
3. **Aggregation footer:** Compute SUM/AVG/COUNT/MIN/MAX from data rows using `compute_aggregation()`, render as a final table row with bold styling and a top border
4. **Sparkline degradation:** Strip `{{spark:1,2,3}}` patterns to `"1, 2, 3"` using `strip_sparkline_syntax()`

These utility functions should be extracted from `markdown_to_typst.rs` into a shared `src-tauri/src/export/table_utils.rs` module to avoid duplication.

### Template Styling

Three templates matching the existing PDF presets. Templates are defined as Rust structs with font, size, and color parameters — no external `.docx` template files for v1.

| Property | Clean | Academic | Report |
| --- | --- | --- | --- |
| Body font | Inter | Source Serif 4 | Inter |
| Heading font | Inter | Source Serif 4 | Inter |
| Code font | JetBrains Mono | JetBrains Mono | JetBrains Mono |
| Body size | 11pt | 12pt | 11pt |
| Heading 1 size | 24pt | 22pt | 24pt |
| Heading 2 size | 20pt | 18pt | 20pt |
| Line spacing | 1.15 | 1.5 | 1.15 |
| Title page | No | No | Yes (title + date) |
| Header/footer | None | Title left, page right | Title left, page right |
| Page numbers | Optional | Optional | Optional |
| Table of contents | Optional | Optional | Optional |

**Font embedding:** `docx-rs` references fonts by name — Word resolves them at render time. The bundled fonts (Inter, Source Serif 4, JetBrains Mono) won't be embedded in the .docx. This is standard Word behavior; if the recipient doesn't have the font, Word substitutes a similar one. The font names chosen have broad availability or close substitutes on all platforms.

### New Tauri Command

Add `export_docx` to `src-tauri/src/commands/export.rs`:

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
) -> Result<Vec<u8>, String> {
    let options = DocxOptions {
        include_toc,
        include_page_numbers,
        page_size,
        project_root,
    };
    markdown_to_docx(&markdown, &title, &template, &options)
}
```

Register in `src-tauri/src/lib.rs` `generate_handler![]` alongside `export_pdf`.

### Frontend Integration

Add the Tauri API wrapper in `src/lib/tauri.ts`:

```typescript
exportDocx: async (options: {
  markdown: string;
  title: string;
  template: ExportTemplate;
  includeToc: boolean;
  includePageNumbers: boolean;
  pageSize: ExportPageSize;
  projectRoot?: string;
}) => invoke<number[]>('export_docx', {
  markdown: options.markdown,
  title: options.title,
  template: options.template,
  includeToc: options.includeToc,
  includePageNumbers: options.includePageNumbers,
  pageSize: options.pageSize,
  projectRoot: options.projectRoot,
}),
```

## UI/UX

### Export Dialog Changes

Add a format picker at the top of the existing `ExportDialog`:

```
┌─────────────────────────────────────────────┐
│  Export Document                             │
│                                             │
│  Format                                     │
│  ┌─────────────┐ ┌─────────────────┐       │
│  │  📄 PDF     │ │  📝 Word (.docx) │       │
│  └─────────────┘ └─────────────────┘       │
│                                             │
│  Template                                   │
│  ○ Clean — Minimal, generous whitespace     │
│  ○ Academic — Serif, numbered headings      │
│  ○ Report — Title page, header/footer       │
│                                             │
│  ☐ Include table of contents                │
│  ☐ Include page numbers                     │
│  Page size: [A4 ▾]                          │
│                                             │
│              [Cancel]  [Export]              │
└─────────────────────────────────────────────┘
```

**Format picker details:**

- Two side-by-side toggle buttons (not a dropdown — only two options)
- Use `ToggleGroup` from shadcn/ui or styled buttons with active state
- Icons: `FileText` (PDF) and `FileType` (DOCX) from lucide-react
- Last-used format persisted in `settings-store` as `lastExportFormat: 'pdf' | 'docx'`
- Template, TOC, page numbers, and page size options shared between both formats
- Page size relevant for both PDF and DOCX (sets Word page dimensions)

### Export Hook Changes

Extend `useExportOperations.ts` to handle both formats:

```typescript
export function useExportOperations(editor: Editor | null) {
  const exportDocument = useCallback(async (options: ExportOptions) => {
    if (options.format === 'pdf') {
      // Existing PDF export logic
    } else if (options.format === 'docx') {
      const docxBytes = await tauriApi.exportDocx({ ... });
      const savePath = await save({
        title: "Export Word Document",
        defaultPath: filePath.replace(/\.md$/i, ".docx"),
        filters: [{ name: "Word Document", extensions: ["docx"] }],
      });
      await tauriApi.saveBinaryFile(savePath, docxBytes);
    }
  }, [editor]);
}
```

### Context Menu Integration

The existing sidebar right-click context menu item "Export as PDF" becomes "Export..." and opens the Export Dialog (which now has the format picker). Alternatively, add a second item "Export as Word Document" alongside "Export as PDF".

### `ExportOptions` Type Update

```typescript
export interface ExportOptions {
  format: 'pdf' | 'docx';
  template: ExportTemplate;
  includeToc: boolean;
  includePageNumbers: boolean;
  pageSize: ExportPageSize;
}
```

## Data Model

### Settings Store Additions

Add to `settings-store.ts`:

```typescript
lastExportFormat: 'pdf' | 'docx';  // Default: 'pdf'
setLastExportFormat: (format: 'pdf' | 'docx') => void;
```

All other export settings (`lastExportTemplate`, `lastExportPageSize`, etc.) are shared across formats.

### No New Stores

DOCX export is stateless — no new Zustand stores needed. The document is generated on-demand from the editor content and written to disk via the save dialog.

## Dependencies

### Rust (Cargo.toml)

| Crate | Version | Purpose |
| --- | --- | --- |
| `docx-rs` | `0.4` | OOXML document builder |

No new frontend dependencies. The existing `@tauri-apps/plugin-dialog` (save dialog) and `sonner` (toast) are reused.

### Shared Utilities (Refactor)

Extract from `markdown_to_typst.rs` into `src-tauri/src/export/table_utils.rs`:

- `ColumnMeta` struct and `parse_column_metadata()`
- `compute_aggregation()`
- `format_value()` (renamed from `format_value_for_pdf`)
- `parse_numeric_value()`
- `strip_sparkline_syntax()`
- `CalloutInfo` struct and callout detection logic
- `LinkPreviewInfo` struct and link preview detection logic

Both `markdown_to_typst.rs` and `markdown_to_docx.rs` import from `table_utils.rs`. This refactor eliminates code duplication and ensures both export paths handle dynamic tables identically.

## Quality Gates

### Functional

- [ ] Export produces a valid `.docx` file that opens without errors in Microsoft Word, Google Docs, and LibreOffice Writer

- [ ] Headings use built-in Word heading styles (`Heading1` through `Heading6`) and appear in Word's navigation pane

- [ ] Bold, italic, strikethrough, and inline code render with correct formatting

- [ ] Links are clickable hyperlinks in the exported document

- [ ] Bullet lists, ordered lists, and task lists render with correct indentation and markers

- [ ] Nested lists (2+ levels) render with appropriate indent levels

- [ ] Tables render with header row styling, column alignment, and borders

- [ ] Dynamic table columns with `<!-- type:currency -->` metadata display formatted numbers

- [ ] Aggregation footer rows (SUM, AVG, etc.) compute correctly and appear as bold summary rows

- [ ] Sparkline `{{spark:...}}` patterns degrade to comma-separated text

- [ ] Code blocks render with monospace font and background shading

- [ ] Blockquotes render with left indent and border

- [ ] Callout blocks render with colored border, background tint, and type label

- [ ] Images (both local and remote URLs) embed correctly in the document

- [ ] Drawing blocks (`.excalidraw`) embed the SVG preview as an image

- [ ] Link preview cards render as styled paragraphs (title, description, URL)

- [ ] Horizontal rules render as visible dividers

- [ ] Text colors and highlights transfer to the Word document

- [ ] YAML frontmatter is stripped and not visible in the exported document

### Templates

- [ ] Clean template uses sans-serif font, minimal styling, no header/footer

- [ ] Academic template uses serif font, includes header with title and page numbers

- [ ] Report template includes a title page with document title and date

- [ ] Table of contents option generates a Word TOC field (updatable in Word)

- [ ] Page numbers option adds page numbers in the footer

- [ ] Page size setting correctly applies A4, Letter, or A5 dimensions

### Source Document Integrity

- [ ] Exporting does not modify the source markdown file

- [ ] Exporting does not modify the editor state or undo history

- [ ] Export can be triggered on unsaved documents (uses editor content, not disk content)

### UI/UX

- [ ] Format picker appears in the Export Dialog with PDF and DOCX options

- [ ] Last-used export format is persisted and restored on next open

- [ ] Cmd+Shift+E opens the Export Dialog (unchanged shortcut)

- [ ] Save dialog suggests `.docx` extension and correct file filter

- [ ] "Reveal in Finder" toast action works after successful export

- [ ] Exporting shows a loading state on the Export button

- [ ] Export errors display a clear toast message

### Testing

- [ ] Rust unit tests for `markdown_to_docx` converter covering all node types

- [ ] Rust unit tests for shared `table_utils` functions (extracted from typst converter)

- [ ] Existing `markdown_to_typst` tests still pass after the `table_utils` refactor

- [ ] Frontend unit test for `useExportOperations` covering DOCX export path

- [ ] TypeScript type check passes (`pnpm typecheck`)

- [ ] All existing tests pass (`pnpm test`, `cargo test`)

### Performance

- [ ] Export of a 50-page document completes in under 3 seconds

- [ ] Export of a document with 10+ images completes without memory issues

- [ ] No UI freeze during export (async operation)

## Out of Scope

- **PPTX export** — different document model (slides vs pages); requires separate PRD
- **HTML export** — trivial via existing markdown libraries; lower priority
- **Custom Word templates (.dotx)** — loading user-provided reference documents for styling; deferred
- **Embedded charts as Word charts** — sparklines degrade to text; full chart embedding requires OLE objects
- **Math equations** — not supported in the editor; no source content to export
- **Table of figures / table of tables** — niche academic feature; deferred
- **Multi-file export** (export entire project as one document) — separate feature
- **Watermarks or document protection** — enterprise feature; not aligned with current user base