# PRD: Document Generation (Phase 4)

**Status:** ✅ Complete (v0.8.0)

## Problem

Notesage users write and edit markdown documents but have no way to export them as professionally formatted PDFs for sharing, printing, or archiving. Users must copy content into external tools (Google Docs, Word, LaTeX) to produce presentable output. This breaks the writing flow and loses formatting fidelity.

## Goals

1. Export the active document as a polished PDF from within Notesage (Cmd+Shift+E or menu)
2. Offer 2-3 built-in style presets so users get professional output without configuration
3. Generate PDFs that faithfully represent all supported markdown content (headings, lists, code blocks, tables, images, etc.)
4. Keep export fast — under 2 seconds for a typical document
5. Lay the groundwork for DOCX/PPTX export in a follow-up phase

## Non-Goals

- DOCX export (follow-up)
- PPTX/slide export (follow-up)
- Custom template editor UI (follow-up — users cannot create/edit templates yet)
- Template marketplace
- Batch export (multiple files at once)
- Print dialog integration (just save-as-PDF for now)

## User Stories

1. **As a writer**, I want to export my note as a PDF, so that I can share it with someone who doesn't use Notesage.
2. **As a student**, I want to choose a clean academic style for my export, so that my paper looks professional.
3. **As a user**, I want the PDF to include a table of contents generated from my headings, so that long documents are navigable.
4. **As a user**, I want page numbers in the footer, so that printed documents are easy to reference.
5. **As a user**, I want to pick where the PDF is saved via a native file dialog, so that I control where it goes.

## Technical Approach

### PDF Engine: Typst

Use [Typst](https://typst.app/) as the PDF generation engine. Typst is a modern typesetting system written in Rust with excellent markdown affinity, fast compilation (milliseconds), and clean template syntax.

**Integration strategy:** Use the `typst` crate as a Rust library embedded in the Tauri backend. This avoids shipping a separate CLI binary and eliminates process startup overhead. The `typst-as-lib` wrapper crate simplifies the `World` trait implementation needed for embedding.

**Why Typst over alternatives:**

- Native Rust — no FFI, no sidecar process, integrates cleanly with Tauri
- Fast compilation (\~5-50ms per document)
- Small footprint (\~40MB binary contribution)
- Template syntax is simple and readable (vs LaTeX)
- First-class support for headings, lists, tables, code blocks, images
- Growing ecosystem with active development

### Conversion Pipeline

```
ProseMirror doc → Markdown string → Typst markup → Typst compiler → PDF bytes → Save to disk
```

1. **Serialize**: Use existing `getMarkdownFromEditor()` to get markdown
2. **Convert**: Transform markdown to Typst markup in Rust (new `markdown_to_typst` module)
3. **Apply template**: Wrap Typst markup with a template preamble that sets fonts, margins, page numbering, ToC, and styling
4. **Compile**: Call Typst compiler to produce PDF bytes
5. **Save**: Write PDF to user-selected path via native save dialog

### Markdown-to-Typst Mapping

| Markdown | Typst |
| --- | --- |
| `# Heading` | `= Heading` |
| `## Heading` | `== Heading` |
| `**bold**` | `*bold*` |
| `*italic*` | `_italic_` |
| `~~strike~~` | `#strike[text]` |
| `` `code` `` | `` `code` `` |
| `- item` | `- item` |
| `1. item` | `+ item` (or `1.`) |
| `- [x] task` | `- #checkbox(checked: true) task` (custom) |
| `> quote` | `#quote[text]` |
| `---` | `#line(length: 100%)` |
| `![alt](url)` | `#image("url", alt: "alt")` |
| Code blocks | `#raw(block: true, lang: "..")[...]` |
| Tables | Typst `#table(...)` |
| Links | `#link("url")[text]` |

### Template Presets

Three built-in presets, each a `.typ` file bundled with the app:

1. **Clean** (default) — Minimal, generous whitespace, sans-serif body (similar to Notion exports). Good for general notes and sharing.
2. **Academic** — Serif body font, tighter spacing, numbered headings, suitable for papers and reports.
3. **Report** — Company-report style with larger title page, header/footer with document title and page numbers, table of contents.

Each template defines: page size (A4), margins, fonts, heading styles, code block styling, table styling, header/footer content, and optional ToC.

Templates are stored as Typst files in `src-tauri/templates/` and bundled into the binary via `include_str!` or Tauri's resource system.

### Font Strategy

Bundle a small set of open-source fonts with the app to ensure consistent rendering across machines:

- **Sans-serif:** Inter or Source Sans 3
- **Serif:** Source Serif 4 or Libertinus Serif
- **Monospace:** JetBrains Mono

Fonts stored in `src-tauri/fonts/` and loaded by the Typst world implementation. Use `--ignore-system-fonts` approach so output is deterministic.

## UI/UX

### Export Dialog

Triggered by: Cmd+Shift+E, or File menu &gt; Export PDF, or right-click context menu on a tab, or click Export button in app toolbar (top right corner).

**Dialog layout** (shadcn/ui `dialog`, max-width 420px):

```
┌────────────────────────────────────┐
│  Export as PDF                     │
│                                    │
│  Style                             │
│  ┌────────┐ ┌────────┐ ┌────────┐  │
│  │  Clean │ │Academic│ │ Report │  │
│  │    ✓   │ │        │ │        │  │
│  └────────┘ └────────┘ └────────┘  │
│                                    │
│  ☐ Include table of contents       │
│  ☐ Include page numbers            │
│                                    │
│  Page size: [A4 ▾]                 │
│                                    │
│        [Cancel]  [Export PDF]      │
└────────────────────────────────────┘
```

- Style cards show a tiny preview thumbnail or icon for each preset
- Table of contents checkbox (default: off for Clean, on for Report/Academic)
- Page numbers checkbox (default: on for Report/Academic, off for Clean)
- Page size dropdown: A4 (default), Letter, A5
- Export button opens native save dialog with suggested filename `{note-name}.pdf`
- Show progress indicator during compilation (spinner on button or toast)
- Success: toast notification with "Open" action to reveal in Finder
- Error: toast with error message

### Keyboard Shortcut

- `Cmd+Shift+E` — Open export dialog

### Menu Integration

Add to right-click context menu on tabs: "Export as PDF..."

## Data Model

### TypeScript

```typescript
interface ExportOptions {
  template: 'clean' | 'academic' | 'report';
  includeToC: boolean;
  includePageNumbers: boolean;
  pageSize: 'a4' | 'letter' | 'a5';
}

// Persisted in settings-store so user's last choice is remembered
interface ExportSettings {
  lastTemplate: ExportOptions['template'];
  lastPageSize: ExportOptions['pageSize'];
  lastIncludeToC: boolean;
  lastIncludePageNumbers: boolean;
}
```

### Tauri Commands

```rust
/// Convert markdown to PDF bytes using Typst
#[tauri::command]
async fn export_pdf(
    markdown: String,
    title: String,
    template: String,       // "clean" | "academic" | "report"
    include_toc: bool,
    include_page_numbers: bool,
    page_size: String,      // "a4" | "letter" | "a5"
) -> Result<Vec<u8>, String>
```

The frontend calls `export_pdf` to get PDF bytes, then uses `tauri-plugin-dialog` save dialog + `write_file` (or a new `save_binary_file` command) to write to disk.

### Rust Modules

```
src-tauri/src/
├── commands/
│   └── export.rs          # export_pdf command
├── export/
│   ├── mod.rs
│   ├── markdown_to_typst.rs  # Markdown → Typst conversion
│   ├── typst_world.rs        # World trait implementation for embedded Typst
│   └── templates.rs          # Template loading and preset definitions
├── templates/             # Bundled .typ template files
│   ├── clean.typ
│   ├── academic.typ
│   └── report.typ
└── fonts/                 # Bundled fonts for deterministic rendering
    ├── inter/
    ├── source-serif/
    └── jetbrains-mono/
```

## Dependencies

### Rust (Cargo.toml)

- `typst` — Core compiler (or `typst-as-lib` wrapper)
- `typst-pdf` — PDF export from Typst documents
- `comrak` or `pulldown-cmark` — Markdown parsing in Rust (to walk AST and emit Typst)

### Frontend

- No new npm dependencies needed
- Uses existing shadcn/ui components (dialog, button, select, checkbox, tooltip)

### Bundled Assets

- 3 Typst template files (\~5KB each)
- Font files (\~2-3MB total for 3 families)

## Quality Gates

### Functional

- \[x\]Cmd+Shift+E opens export dialog

- \[x\]All three presets produce visually distinct PDFs

- \[x\]Headings (H1-H6) render with correct hierarchy

- \[x\]Bold, italic, underline, strikethrough, inline code render correctly

- \[x\]Bullet lists, ordered lists, and task lists render correctly

- \[x\]Code blocks render with monospace font and language label

- \[x\]Tables render with headers and borders

- \[x\]Table rows are kept together when page breaks

- \[x\]Headings are kept together with next section when page breaks

- \[x\]Images embedded in PDF (local file paths resolved)

- \[x\]Links are clickable in the PDF

- \[x\]Blockquotes styled distinctly

- \[x\]Horizontal rules render as visual separators

- \[x\]Table of contents generated from headings when enabled

- \[x\]Page numbers appear in footer when enabled

- \[x\]All three page sizes (A4, Letter, A5) work

- \[x\]Native save dialog appears with suggested filename

- \[x\]Success toast shown after export

- \[x\]Error toast shown if export fails

- \[x\]Export completes in under 2 seconds for a 10-page document

- \[x\]User's last export settings remembered across sessions

- \[x\]YAML frontmatter stripped from PDF output (not rendered)

### Design

- \[x\]Export dialog follows design system (neutral palette, transitions, proper spacing)

- \[x\]Style cards are visually clear and show which is selected

- \[x\]Dialog works in both light and dark mode

- \[x\]Loading state during export is smooth (not jarring)

## Out of Scope

- DOCX export — follow-up phase, likely using `docx-rs` crate
- PPTX export — follow-up phase
- Custom template editor — users cannot create/modify templates yet
- Template marketplace
- Batch/multi-file export
- Print dialog (Cmd+P) — just save-as-PDF
- PDF preview within the app
- Export from chat panel or AI-generated content
- Watermarks or custom branding