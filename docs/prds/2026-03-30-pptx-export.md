# PRD: PPTX Export — Markdown to Presentation Slides

|  |  |
| --- | --- |
| **Date** | 2026-03-30 |
| **Status** | Complete |
| **Priority** | Low |
| **Impact** | Users can generate presentation slides directly from structured notes |
| **Research** | [document-format-enhancements](../research/2026-03-30-document-format-enhancements.md) |
| **Tasks** | [pptx-export-tasks](../tasks/2026-03-30-pptx-export-tasks.md) |

## Problem

Notesage users frequently write structured content — project updates, meeting notes, research summaries, proposals — that they later need to present. Today the workflow is painful: copy text from Notesage, paste into PowerPoint/Google Slides/Keynote, manually create slides, reformat headings as titles, restructure bullet points, re-insert images, rebuild tables. This manual conversion takes 15-30 minutes per document and produces slides that drift from the source material.

PDF export solves the "print/share" use case but not the "present" use case. Presentations require a fundamentally different layout: one idea per slide, large titles, concise bullet points, embedded visuals. Markdown's heading hierarchy maps naturally to slide structure — H1 as slide titles, H2 as subtitles, lists as bullet points — but no tool in Notesage automates this today.

## Goals

1. **One-click PPTX export** — generate a `.pptx` file from the active markdown document via the existing export dialog
2. **Intelligent slide splitting** — automatically break content into slides using heading hierarchy and explicit separators
3. **Content mapping** — tables become PowerPoint tables, images become slide images, code blocks become styled monospace text boxes, inline charts become native PowerPoint charts
4. **Template selection** — three built-in templates (Simple, Business, Report) with consistent, professional styling
5. **Speaker notes** — dedicated syntax (`> [!notes]`) for content that appears in the speaker notes pane, not on the slide
6. **User-uploaded** `.pptx` **templates** — users can import their own `.pptx` template files (with slide masters and layouts) and select them alongside the built-in presets during export

## Non-Goals

- Slide editing or preview within Notesage (export only — edit in PowerPoint/Keynote/Slides)
- Custom template editor with visual design tools (future enhancement)
- Animations or transitions (static slides only for v1)
- Master slide customization beyond what the uploaded template provides
- Two-way sync between markdown and PPTX
- Collaborative presentation editing
- Presenter mode or slideshow playback within Notesage

## User Stories

- As a project manager, I want to export my weekly status update to PPTX so that I can present it in a team meeting without recreating slides manually
- As a researcher, I want to turn my analysis notes into presentation slides so that I can share findings with colleagues in a familiar format
- As a user, I want horizontal rules (`---`) in my document to act as explicit slide breaks so that I have precise control over slide boundaries
- As a presenter, I want to add speaker notes in my markdown using a callout block so that my presentation notes stay with the source document
- As a user with inline charts in my document, I want them to appear as native PowerPoint charts so that recipients can edit the data
- As a user, I want to choose a presentation template before exporting so that my slides look professional without manual formatting
- As a user, I want to upload my company's branded `.pptx` template so that exported presentations match our corporate slide deck

## Technical Approach

### Rust Crate: ppt-rs

Add `ppt-rs` to `src-tauri/Cargo.toml`. This crate is a Rust port of python-pptx with built-in markdown-to-PPTX conversion, chart support, and ECMA-376 compliance. See [research](../research/2026-03-30-document-format-enhancements.md#2-pptx-export) for evaluation details.

**Why ppt-rs:**

- Built-in markdown-to-slides conversion — headings, lists, tables, images handled natively
- Chart support (bar, line, pie, area, scatter, doughnut, radar) — maps directly to Notesage inline charts
- Template system with built-in presets
- Full ECMA-376 Office Open XML compliance — files open in PowerPoint, Keynote, LibreOffice Impress, and Google Slides
- Pure Rust, no external dependencies — same deployment model as the Typst PDF pipeline

### New Tauri Command: `export_pptx`

```rust
#[tauri::command]
pub async fn export_pptx(
    markdown: String,
    title: String,
    template: String,
    project_root: Option<String>,
) -> Result<Vec<u8>, String>
```

**Parameters:**

- `markdown`: Full markdown content (including frontmatter if present)
- `title`: Document title (used on the title slide)
- `template`: Template preset — `"simple"`, `"business"`, or `"report"`
- `project_root`: Project root path for resolving relative image/drawing/chart paths

**Returns:**

- `Ok(Vec<u8>)`: PPTX file as raw bytes
- `Err(String)`: Error message if conversion fails

**Pipeline:** markdown → `markdown_to_pptx()` → slide model → apply template → `ppt-rs` serialization → PPTX bytes.

Reuses the existing `save_binary_file` command for writing bytes to disk.

### Slide Splitting Strategy

Content is split into slides using a two-tier strategy:

**Tier 1 — Heading-based splitting (default):**

| Markdown element | PowerPoint mapping |
| --- | --- |
| `# H1` | New slide — text becomes the slide title |
| `## H2` | Slide subtitle (displayed below the title on the same slide) |
| `### H3` – `###### H6` | Bold/styled text within slide body content |
| Bullet list (`- item`) | Bullet points in the slide content area |
| Numbered list (`1. item`) | Numbered points in the slide content area |
| Task list (`- [ ] item`) | Bullet points with checkbox symbols (Unicode) |
| Paragraph text | Body text in the slide content area |
| `---` (horizontal rule) | Explicit slide break — forces a new slide regardless of heading level |

**Tier 2 — Content overflow:**

If a single slide accumulates more content than fits (heuristic: &gt; 8 bullet points or &gt; 300 words of body text), the converter splits it into continuation slides with the same title suffixed with "(cont.)".

**Title slide:**

The first slide is always a title slide containing the document title (from the `title` parameter) and the current date. If the document starts with an H1, that H1 text replaces the title parameter. Content before the first heading becomes subtitle text on the title slide.

**Speaker notes:**

Content inside `> [!notes]` callout blocks is extracted and attached to the preceding slide's speaker notes pane. This reuses the same callout syntax as the existing callout extension (Note, Tip, Warning, Important) but with the `notes` type reserved for PPTX export. In the editor, `> [!notes]` renders as a regular callout block. During export, the converter strips these blocks from slide content and redirects them to PowerPoint's notes field.

```markdown
# Q3 Results

- Revenue up 15%
- New customers: 2,400

> [!notes]
> Mention that Q3 includes the summer promotion period.
> Emphasize the YoY comparison chart on the next slide.
```

### Content Type Mapping

**Tables:**

Markdown GFM tables map to native PowerPoint table objects. Header rows are styled with bold text and a darker background. Column widths are distributed proportionally based on content length. Tables that exceed slide width are scaled to fit.

**Code blocks:**

Fenced code blocks (```` ```language ````) render as text boxes with:

- Monospace font (Consolas or Courier New — widely available on all platforms)
- Light grey background fill
- Reduced font size (14pt vs 18pt body text)
- No syntax highlighting in v1 (PowerPoint has no native code highlighting — would require manual color runs)

**Images and drawings:**

- Relative image paths resolved against `project_root`
- `.excalidraw` references resolved to their `.svg` counterparts (same logic as PDF export in `resolve_drawing_svgs`)
- Images centered on the slide, scaled to fit within content area bounds while preserving aspect ratio
- If a slide contains only an image (no text besides the title), it gets a full-slide image layout

**Inline charts:**

Notesage inline charts (stored as JSON in `.notesage/charts/<id>.json`) map to native PowerPoint charts via `ppt-rs`'s chart API:

| Notesage chart type | PowerPoint chart type |
| --- | --- |
| Bar | Clustered bar chart |
| Line | Line chart |
| Area | Area chart |
| Pie | Pie chart |
| Donut | Doughnut chart |
| Horizontal bar | Clustered horizontal bar chart |

Chart data (labels + series) is read from the sidecar JSON file and passed to `ppt-rs`'s chart builder. Recipients can click the chart in PowerPoint to edit the underlying data — a significant advantage over rasterized SVG images.

**Link preview cards:**

`> [!link](url)` blocks are converted to a text box with the link title and URL, styled as a clickable hyperlink. The preview image (if available) is not included to avoid layout complexity.

**Callout blocks:**

Non-`notes` callout types (`> [!note]`, `> [!tip]`, `> [!warning]`, `> [!important]`) render as styled text boxes with a left border accent and the type label in bold. Colors are neutral (PowerPoint-safe greys) since the Notesage color palette is strictly neutral.

### Templates

Three built-in templates bundled in `src-tauri/templates/`:

| Template | Description | Title slide | Body slides |
| --- | --- | --- | --- |
| **Simple** | Clean, minimal, white background | Centered title + subtitle | Title at top, content below, generous margins |
| **Business** | Professional, subtle header/footer | Title + date + subtle divider line | Title at top, thin header line, slide number in footer |
| **Report** | Formal, structured | Title + author + date, dark background accent | Title at top, two-column option for dense content, slide numbers |

Built-in templates are applied by configuring `ppt-rs`'s slide master properties: font choices, colors, layout dimensions, placeholder positions. Built-in template definitions stored as Rust constants or JSON configuration (not `.pptx` template files) to avoid bundling binary assets.

**Font choices (built-in templates):**

- Title: Calibri (universally available on Windows/Mac/Linux)
- Body: Calibri
- Code: Consolas (Windows/Mac) with Courier New fallback

These are PowerPoint-safe system fonts — no font embedding needed.

### User-Uploaded `.pptx` Templates

Users can import their own `.pptx` template files to use as the base for exported presentations. The converter applies the template's slide masters, layouts, fonts, and color theme while populating content from the markdown document.

**Storage:**

- Templates stored in `~/.notesage/pptx-templates/` (global) and `<project>/.notesage/pptx-templates/` (per-project)
- Each template is a standard `.pptx` file containing slide masters and layouts (the same format PowerPoint uses for `.potx` template files — `.pptx` is accepted to avoid user confusion)
- Template metadata (display name, source path, date added) stored in a `templates.json` index file alongside the templates

**Import flow:**

1. User clicks "Add Template" in the PPTX template selector (or in Settings &gt; Export)
2. Native file dialog opens filtered to `.pptx` and `.potx` files
3. Selected file is copied to `~/.notesage/pptx-templates/<sanitized-name>.pptx`
4. Template is validated: must contain at least one slide layout with a title placeholder
5. On success, template appears in the template picker alongside built-in presets
6. On failure (invalid or corrupt file), toast error with explanation

**Template application:**

- The converter opens the user's `.pptx` as the base document via `ppt-rs`
- Slide masters, layouts, theme colors, and fonts are inherited from the template
- Content slides are added using the template's layouts — the converter maps:
  - Title slide: first layout with a centered title placeholder (or layout named "Title Slide")
  - Content slides: first layout with title + content placeholders (or layout named "Title and Content")
  - If expected layouts are missing, falls back to the first available layout
- The template's existing slides (if any) are removed — only the masters/layouts are used

**Management UI:**

- Template picker in ExportDialog shows built-in templates first, then a divider, then user templates
- User templates show a delete button (hover) to remove them
- Settings &gt; Export section for managing templates (list, add, delete)
- Per-project templates override global templates with the same name

**New Tauri commands:**

```rust
#[tauri::command]
pub async fn import_pptx_template(
    source_path: String,
    scope: String,          // "global" | "project"
    project_root: Option<String>,
) -> Result<PptxTemplateInfo, String>

#[tauri::command]
pub async fn list_pptx_templates(
    project_root: Option<String>,
) -> Result<Vec<PptxTemplateInfo>, String>

#[tauri::command]
pub async fn delete_pptx_template(
    template_id: String,
    scope: String,
    project_root: Option<String>,
) -> Result<(), String>
```

```rust
#[derive(Serialize, Deserialize)]
pub struct PptxTemplateInfo {
    pub id: String,          // sanitized filename without extension
    pub name: String,        // display name (original filename)
    pub scope: String,       // "builtin" | "global" | "project"
    pub path: String,        // absolute path to the .pptx file
    pub date_added: String,  // ISO 8601 date
}
```

`export_pptx` **command update:**

The `template` parameter accepts both built-in names (`"simple"`, `"business"`, `"report"`) and user template IDs. When a user template ID is provided, the converter loads the `.pptx` file as the base document instead of building from scratch.

### Export Dialog Integration

Extend the existing `ExportDialog.tsx` to support PPTX as a format option.

**Changes to ExportDialog:**

1. Add a format selector at the top: "PDF (.pdf)" | "PowerPoint (.pptx)"
2. When "PowerPoint" is selected, show PPTX-specific options:
   - Template: Simple / Business / Report (radio group or select)
3. When "PDF" is selected, show existing PDF options (template, TOC, page numbers, page size) — no changes
4. The `ExportOptions` interface gains an `exportFormat` discriminator:

```typescript
type ExportFormat = 'pdf' | 'pptx';

interface ExportOptions {
  format: ExportFormat;
  // PDF-specific
  template?: ExportTemplate;
  includeToc?: boolean;
  includePageNumbers?: boolean;
  pageSize?: ExportPageSize;
  // PPTX-specific
  pptxTemplate?: PptxTemplate;
}

type PptxTemplate = 'simple' | 'business' | 'report';
```

**Changes to useExportOperations:**

Add an `exportPptx` method alongside the existing `exportPdf`. The `onExport` callback routes based on `format`:

```typescript
if (options.format === 'pptx') {
  const pptxBytes = await tauriApi.exportPptx({
    markdown,
    title,
    template: options.pptxTemplate,
    projectRoot,
  });
  // save dialog with .pptx filter
} else {
  // existing PDF flow
}
```

**Keyboard shortcut:** The existing `Cmd+Shift+E` opens the export dialog — no new shortcut needed.

**Context menu:** The sidebar right-click menu on `.md` files already has "Export as PDF". Add "Export as PowerPoint" as a sibling option.

### Settings Persistence

Add to `settings-store.ts`:

```typescript
lastExportFormat: ExportFormat;       // default: 'pdf'
lastPptxTemplate: PptxTemplate;       // default: 'simple'
```

The export dialog remembers the last-used format and PPTX template across sessions.

### Markdown-to-PPTX Converter Module

New file: `src-tauri/src/export/markdown_to_pptx.rs`

This module mirrors the structure of `markdown_to_typst.rs`:

1. Parse markdown with `comrak` (already a dependency) into an AST
2. Walk the AST, accumulating content per slide
3. On H1 or `---`: finalize current slide, start new slide
4. Map each AST node type to the corresponding `ppt-rs` builder call
5. Resolve image paths, chart JSON paths against `project_root`
6. Extract `> [!notes]` blocks and attach as speaker notes
7. Return the `ppt-rs` `Presentation` object

**Chart resolution:**

When the converter encounters an image node referencing a `.chart.json` sidecar file (from the inline charts feature), it:

1. Reads the JSON file from `<project_root>/.notesage/charts/<id>.json`
2. Deserializes the chart data (type, labels, series, colors)
3. Creates a native PowerPoint chart via `ppt-rs`'s chart API
4. Falls back to a placeholder text box if the chart file is missing or unreadable

### File Structure Changes

```
src-tauri/
  src/
    commands/
      export.rs          # Add export_pptx command alongside export_pdf
    export/
      mod.rs             # Add markdown_to_pptx module
      markdown_to_pptx.rs  # NEW: Markdown → ppt-rs slide model
      markdown_to_typst.rs # Existing
      templates.rs       # Extend with PPTX template configs
      typst_world.rs     # Existing (unchanged)
  Cargo.toml             # Add ppt-rs dependency
src/
  components/
    ExportDialog.tsx     # Add format selector, PPTX template options
  hooks/
    useExportOperations.ts  # Add exportPptx method, format routing
  stores/
    settings-store.ts    # Add lastExportFormat, lastPptxTemplate
  lib/
    tauri.ts             # Add exportPptx wrapper
```

## Dependencies

| Package | Location | Purpose | Size impact |
| --- | --- | --- | --- |
| `ppt-rs` | Cargo.toml | PPTX generation (slides, tables, charts, images) | \~500KB compiled |

No new frontend npm dependencies. The export dialog extensions use existing shadcn/ui components (Select, RadioGroup, Button).

`comrak` is already a dependency (used by the document index parser and `markdown_to_typst`). No additional markdown parsing library needed.

## UI/UX

### Export Dialog — Format Selector

The format selector appears at the top of the dialog as a segmented control or tab-style toggle:

```
 [PDF]  [PowerPoint]
```

- Active segment has a filled background (using `--primary` CSS variable)
- Switching formats smoothly cross-fades the options section below (150ms transition)
- Dialog title updates: "Export PDF" or "Export PowerPoint"

### PPTX Options Section

When PowerPoint is selected:

- **Template** — Three cards in a row (like the existing PDF template cards): Simple, Business, Report. Each card shows the template name, a one-line description, and a subtle preview icon. Selected card has a border accent.
- No page size selector (PowerPoint uses 16:9 widescreen by default — standard for modern presentations)
- No TOC or page number toggles (not applicable to slides)

### Sidebar Context Menu

```
Export as PDF...
Export as PowerPoint...
```

Both menu items open the export dialog with the corresponding format pre-selected.

### Progress and Completion

- Export button shows a spinner while generating (same pattern as PDF export)
- On success: native save dialog → toast "Exported presentation.pptx" with a "Reveal in Finder" action
- On error: toast with error message

## Data Model

### ExportOptions (Extended)

```typescript
type ExportFormat = 'pdf' | 'pptx';
type PptxTemplate = 'simple' | 'business' | 'report';

interface ExportOptions {
  format: ExportFormat;
  // PDF options (existing)
  template?: ExportTemplate;
  includeToc?: boolean;
  includePageNumbers?: boolean;
  pageSize?: ExportPageSize;
  // PPTX options
  pptxTemplate?: PptxTemplate;
}
```

### Settings Store Additions

```typescript
interface Settings {
  // ... existing
  lastExportFormat: ExportFormat;     // persisted, default 'pdf'
  lastPptxTemplate: PptxTemplate;    // persisted, default 'simple'
}
```

### Tauri API Wrapper

```typescript
// In src/lib/tauri.ts
exportPptx: (options: {
  markdown: string;
  title: string;
  template: string;
  projectRoot?: string;
}) => invoke<number[]>('export_pptx', {
  markdown: options.markdown,
  title: options.title,
  template: options.template,
  projectRoot: options.projectRoot,
})
```

## Implementation Order

 1. **Add** `ppt-rs` **dependency** — Add to Cargo.toml, verify it compiles
 2. **Markdown-to-PPTX converter** — `markdown_to_pptx.rs` with heading-based slide splitting, text content, bullet points
 3. **Tauri command** — `export_pptx` command wired up in `lib.rs` handler list
 4. **Basic export flow** — Frontend can generate a PPTX with plain text slides
 5. **Template system** — Three built-in templates with font/color/layout configuration
 6. **Tables and code blocks** — PowerPoint tables from GFM tables, monospace text boxes for code
 7. **Images and drawings** — Resolve local paths, embed images, handle `.excalidraw` → `.svg`
 8. **Charts** — Read inline chart JSON, create native PowerPoint charts
 9. **Speaker notes** — Parse `> [!notes]` callouts, attach to slide notes
10. **Export dialog integration** — Format selector, PPTX template picker, settings persistence
11. **Context menu** — Add "Export as PowerPoint" to sidebar right-click menu
12. **User template import** — Tauri commands for import/list/delete, storage in `~/.notesage/pptx-templates/`
13. **Template picker UI** — Add "Add Template" button, user template section with delete, divider between built-in and user templates
14. **Template-based export** — Load user `.pptx` as base document, inherit masters/layouts/theme
15. **Testing** — Unit tests for converter, template import validation, integration tests for full pipeline

## Quality Gates

### Functional

- [x] PPTX file opens without errors in Apple Keynote

- [x] H1 headings create new slides with the heading as the title

- [x] H2 headings appear as slide subtitles

- [x] Bullet lists render as PowerPoint bullet points

- [x] Numbered lists render as PowerPoint numbered points

- [x] Horizontal rules (`---`) force slide breaks

- [x] Tables render as native PowerPoint tables with header row styling

- [x] Code blocks render in monospace font with background fill

- [x] Local images are embedded in the PPTX (not linked)

- [x] Excalidraw drawings export as SVG images in slides

- [x] Inline charts produce native editable PowerPoint charts

- [x] Speaker notes (`> [!notes]`) appear in the notes pane, not on the slide

- [x] Content overflow triggers continuation slides

- [x] Title slide contains document title and date

- [x] All three templates (Simple, Business, Report) produce visually distinct results

- [x] Export dialog shows format selector with PDF and PowerPoint options

- [x] PPTX-specific options appear only when PowerPoint is selected

- [x] Settings remember last-used format and template

- [x] Sidebar context menu includes "Export as PowerPoint"

- [x] User-uploaded `.pptx` templates can be imported via the template picker

- [x] Imported templates appear alongside built-in presets in the export dialog

- [x] Exported slides inherit the uploaded template's slide masters, fonts, and colors

- [x] Invalid or corrupt `.pptx` files show a clear error on import

- [x] User templates can be deleted from the template picker

- [x] Per-project templates override global templates with the same name

- [x] Error handling: missing images show placeholder, missing charts show text fallback

- [x] Documents with no headings still produce valid slides (content split by paragraph count)

- [x] Empty documents produce a single title slide (no crash)

### Performance

- [x] A 50-slide document exports in under 3 seconds

- [x] A document with 20 embedded images exports without memory issues

- [x] Export does not block the UI (async Tauri command)

### Design

- [x] Export dialog format selector follows the neutral greyscale palette

- [x] Template cards are visually consistent with existing PDF template cards

- [x] Smooth transition between PDF and PPTX option panels

- [x] All new UI elements work in both light and dark mode

- [x] Export progress indicator matches existing PDF export pattern

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `ppt-rs` crate is immature or has bugs | Medium | High | Evaluate early with realistic test documents; have fallback plan to use lower-level XML generation |
| Chart type mapping incomplete (Notesage chart types don't all have PowerPoint equivalents) | Low | Low | All 6 Notesage chart types have direct PowerPoint counterparts |
| Font rendering differs across platforms | Medium | Low | Use universally available system fonts (Calibri, Consolas); no custom font embedding |
| Large images cause oversized PPTX files | Medium | Medium | Compress images before embedding; set a max dimension (1920px) and downscale larger images |
| Slide content overflow heuristic is too aggressive or too lenient | Medium | Low | Make the threshold configurable internally; tune based on user feedback |
| User-uploaded templates have unexpected layout names or missing placeholders | High | Medium | Fall back to first available layout; validate on import and warn about missing standard layouts |
| `ppt-rs` doesn't support opening existing `.pptx` as base document | Medium | High | Verify early; fallback is raw ZIP manipulation to swap slide masters into a new document |

## Out of Scope

- **Slide preview in Notesage** — Users preview in their presentation app
- **Visual template editor** — Editing slide masters/layouts within Notesage; users edit templates in PowerPoint and re-import
- **Slide animations and transitions** — Static slides only for v1
- **Presenter notes from YAML frontmatter** — Only `> [!notes]` callout syntax supported
- **Two-way conversion** — PPTX import to markdown is a separate feature (already exists as document import)
- **Slide layout variants** — v1 uses a single title+content layout; two-column, image-only, and comparison layouts are future work
- **Custom color themes** — Templates use fixed neutral color schemes matching Notesage's greyscale aesthetic