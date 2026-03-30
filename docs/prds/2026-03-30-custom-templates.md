# PRD: Custom PDF Export Templates

|  |  |
| --- | --- |
| **Date** | 2026-03-30 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | Users can create and share custom PDF templates, unlocking branded document generation |
| **Research** | [document-format-enhancements](../research/2026-03-30-document-format-enhancements.md) |
| **Tasks** | [custom-templates-tasks](../tasks/2026-03-30-custom-templates-tasks.md) |

## Problem

Notesage bundles three PDF export templates (Clean, Academic, Report), loaded via `include_str!` at compile time. Users cannot create, edit, import, or share custom templates. Anyone needing branded output, specific formatting for a journal submission, or a personal letter style must either accept the bundled options or export raw markdown and typeset externally.

Typst has a thriving ecosystem (Typst Universe) with hundreds of community templates, but there is no way to use them in Notesage. The Typst compiler is already embedded in the Rust backend, and CodeMirror 6 is already available for source mode editing — the infrastructure for a template editor exists but is not connected.

## Goals

1. **User-created templates** — create, edit, duplicate, and delete custom Typst templates from within the app
2. **Template editor** — split-pane UI with CodeMirror (Typst syntax highlighting) on the left and live PDF preview on the right
3. **Template variables** — templates declare typed variables in YAML frontmatter; the export dialog renders input fields for each variable
4. **Template discovery** — scan `~/.notesage/templates/` (global) and `<project>/.notesage/templates/` (per-project) on startup and via filesystem watcher, same pattern as skills/agents
5. **Bundled template extraction** — existing Clean/Academic/Report templates extracted to `~/.notesage/templates/` on first launch as editable starting points
6. **Import support** — import `.typ` files from disk (manual file picker for v1)
7. **Export dialog integration** — custom templates appear alongside bundled ones with preview thumbnails

## Non-Goals

- **Typst Universe browser** — integrated marketplace browsing and one-click install is a future enhancement; v1 supports manual file import only
- **Font management** — custom font bundling or installation; templates use the three bundled font families (Inter, Source Serif 4, JetBrains Mono) plus system fonts if the World trait is extended later
- **Template sharing/publishing** — no upload, URL sharing, or community gallery in v1
- **Template versioning or git tracking** — templates are plain files; users manage versions externally
- **WYSIWYG template editing** — the editor is code-only (Typst source); no drag-and-drop layout builder
- **Template packages with multiple files** — each template is a single `.typ` file; multi-file templates (with assets, sub-modules) are out of scope for v1

## User Stories

- As a consultant, I want to create a branded PDF template with my company logo placement, custom fonts, and specific margins so that every exported document looks professional without manual formatting
- As an academic, I want to import a Typst template from Typst Universe that matches my journal's submission requirements so I can export directly from Notesage
- As a user, I want to see a live preview of my template while editing it so I can iterate quickly without exporting each time
- As a user, I want templates to declare variables (author name, date format, color accent) so I can fill them in at export time without editing the template source
- As a project lead, I want per-project templates so that each project can have its own export style without cluttering my global template library

## Technical Approach

### Template File Format

Each template is a single `.typ` file with an optional YAML frontmatter block delimited by `///` comment lines (Typst comments, not parsed by the compiler):

```typst
/// ---
/// name: Company Report
/// description: Branded report with logo and accent color
/// author: Jane Doe
/// version: 1.0
/// variables:
///   - name: company_name
///     type: string
///     label: Company Name
///     default: "Acme Corp"
///   - name: accent_color
///     type: color
///     label: Accent Color
///     default: "#2563eb"
///   - name: show_logo
///     type: boolean
///     label: Show Logo
///     default: true
///   - name: font_size
///     type: number
///     label: Body Font Size (pt)
///     default: 11
///     min: 8
///     max: 16
/// thumbnail: thumbnail.png
/// ---

#let template(
  title: "",
  include-toc: false,
  include-page-numbers: false,
  // Custom variables injected as named parameters
  company_name: "Acme Corp",
  accent_color: rgb("#2563eb"),
  show_logo: true,
  font_size: 11pt,
  body,
) = {
  // ... template body ...
}
```

**Frontmatter parsing:**

- Lines starting with `///` at the top of the file are collected
- The `---` delimiters (inside `///` comments) mark the YAML block
- Parsed by the Rust backend into a `TemplateMetadata` struct
- Templates without frontmatter are valid — they get a name derived from the filename and no custom variables

**Variable types:**

| Type | Typst Parameter Type | Export Dialog Widget |
| --- | --- | --- |
| `string` | `str` | Text input |
| `number` | `int` or `length` (with unit suffix) | Number input with optional min/max |
| `boolean` | `bool` | Checkbox |
| `color` | `color` (via `rgb()`) | Color picker (hex input) |
| `enum` | `str` (validated) | Select dropdown (from `options` array) |

### Template Directories

| Directory | Scope | Priority |
| --- | --- | --- |
| `<project>/.notesage/templates/` | Per-project | Highest (overrides global by name) |
| `~/.notesage/templates/` | Global (user) | Normal |
| Bundled (compile-time) | App default | Lowest (fallback) |

Project templates with the same name as a global template take precedence. The original bundled templates remain available as compile-time fallbacks even if the user deletes the extracted copies.

### Template Discovery

Follow the same pattern as skill/agent discovery (`useSkillDiscovery` / `discover_skills`):

1. **Startup:** Rust `discover_templates` command scans template directories, parses frontmatter metadata, returns `Vec<TemplateInfo>`
2. **Filesystem watcher:** Template directories are added to the existing watcher; `file-changed` events in template directories trigger re-scan
3. **Bundled extraction:** On first launch (gated by `templatesExtracted` flag in settings), extract bundled templates to `~/.notesage/templates/`
4. **Store:** New `template-store` (Zustand, persisted) holds the template registry

### New Tauri Commands

```rust
/// Discover templates from all template directories.
#[tauri::command]
async fn discover_templates(
    template_dirs: Vec<String>,
) -> Result<Vec<TemplateInfo>, String>

/// Read a template file's full source.
#[tauri::command]
async fn read_template(path: String) -> Result<TemplateSource, String>

/// Save a template file (create or overwrite).
#[tauri::command]
async fn save_template(
    path: String,
    source: String,
) -> Result<(), String>

/// Delete a template file.
#[tauri::command]
async fn delete_template(path: String) -> Result<(), String>

/// Compile a template with sample content and return PDF bytes.
/// Used for live preview and thumbnail generation.
#[tauri::command]
async fn preview_template(
    template_source: String,
    sample_markdown: String,
    title: String,
    variables: HashMap<String, serde_json::Value>,
    page_size: String,
) -> Result<Vec<u8>, String>

/// Extract bundled templates to ~/.notesage/templates/
#[tauri::command]
async fn extract_bundled_templates(
    target_dir: String,
) -> Result<u32, String>
```

**Structs:**

```rust
#[derive(Serialize, Deserialize)]
pub struct TemplateInfo {
    pub id: String,            // Derived from filename (e.g., "company-report")
    pub name: String,          // From frontmatter or filename
    pub description: String,   // From frontmatter or empty
    pub author: String,        // From frontmatter or empty
    pub path: String,          // Absolute path to .typ file
    pub scope: String,         // "project" | "global" | "bundled"
    pub variables: Vec<TemplateVariable>,
    pub is_bundled: bool,      // true if this is an extracted bundled template
}

#[derive(Serialize, Deserialize)]
pub struct TemplateVariable {
    pub name: String,
    pub var_type: String,      // "string" | "number" | "boolean" | "color" | "enum"
    pub label: String,
    pub default: serde_json::Value,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub options: Option<Vec<String>>,  // For enum type
}

#[derive(Serialize, Deserialize)]
pub struct TemplateSource {
    pub source: String,
    pub metadata: TemplateInfo,
}
```

### Modifying the Export Pipeline

The existing `export_pdf` command currently takes a `template: String` parameter that maps to the `Template` enum. This needs to support custom templates:

```rust
#[tauri::command]
pub async fn export_pdf(
    markdown: String,
    title: String,
    template: String,           // "clean" | "academic" | "report" | custom template id
    template_source: Option<String>,  // Full .typ source for custom templates
    include_toc: bool,
    include_page_numbers: bool,
    page_size: String,
    project_root: Option<String>,
    variables: Option<HashMap<String, serde_json::Value>>,  // Custom variable values
) -> Result<Vec<u8>, String>
```

When `template_source` is provided, it is used directly instead of looking up a bundled template. The `apply_template` function is extended to inject variable values as Typst parameters in the `#show: template.with(...)` call.

### Template Editor UI

A new full-screen dialog (or route) accessible from Settings > Templates or the export dialog's "Edit" button.

**Layout:**

```
┌─────────────────────────────────────────────────────┐
│  Template Editor                        [Save] [x]  │
├────────────────────────┬────────────────────────────┤
│                        │                            │
│  CodeMirror 6          │  PDF Preview               │
│  (Typst source)        │  (rendered output)         │
│                        │                            │
│  - Typst syntax hl     │  - Debounced 300ms         │
│  - Line numbers        │  - Shows compile errors    │
│  - Bracket matching    │  - Sample content or       │
│  - Auto-indent         │    active document         │
│                        │                            │
├────────────────────────┴────────────────────────────┤
│  Variables: [company_name: Acme Corp] [accent: #26..]│
│  Status: Compiled in 142ms  |  Page size: A4 ▾      │
└─────────────────────────────────────────────────────┘
```

**CodeMirror configuration:**

- Language: Typst syntax highlighting (use `@codemirror/lang-markdown` as a base or a community Typst grammar if available; fall back to a basic mode with `#` keyword highlighting)
- Extensions: line numbers, bracket matching, auto-indent, search (Cmd+F), active line highlight
- Theme: matches app theme (light/dark) using the same neutral palette

**Live preview:**

- Debounce: 300ms after last keystroke
- Calls `preview_template` Tauri command with the current source and sample markdown
- Sample content: either a built-in sample document covering all markdown features, or the currently active document (user toggle)
- PDF rendered via `<canvas>` using pdfjs-dist (same approach as PdfViewer)
- Compile errors shown inline below the preview area (red text, monospace)
- Compilation time displayed in the status bar

**Variable bar:**

- Rendered below the split pane
- Inputs generated from the template's declared variables
- Changes to variable values trigger a preview re-render
- Allows testing how the template responds to different variable inputs

### Export Dialog Changes

The existing `ExportDialog` component needs these modifications:

1. **Template grid expansion** — show custom templates alongside bundled ones in the same grid
2. **Template cards** — each card shows: name, description (truncated), scope badge (Project/Global), and a small preview thumbnail
3. **Preview thumbnails** — generated on template discovery by compiling with sample content and capturing the first page as a low-res image (stored in `~/.notesage/templates/.cache/`)
4. **Variable inputs** — when a custom template with variables is selected, a "Template Options" section appears below the template grid with the declared input fields
5. **Manage templates link** — "Manage templates..." link below the template grid opens Settings > Templates
6. **Create from current** — "Save as template" option in the export dialog copies the selected template to the user's global templates directory for customization

### Settings > Templates Tab

New tab in the Settings dialog for template management.

**Template list:**

- Cards for each template showing name, description, author, scope, variable count
- Scope badges: "Built-in", "Global", "Project: <name>"
- Actions per template: Edit (opens template editor), Duplicate, Delete (with confirmation), Move (global <-> project)
- Built-in templates show "Edit" which duplicates first, preventing modification of the originals

**Import button:**

- "Import Template" button opens a native file picker filtered to `.typ` files
- Selected file is copied to `~/.notesage/templates/`
- Frontmatter is parsed; if missing, user is prompted to add basic metadata

**Create button:**

- "New Template" opens the template editor with a starter template (based on Clean, with frontmatter boilerplate)

### Template Store

```typescript
// src/stores/template-store.ts
interface TemplateStore {
  templates: TemplateInfo[];
  isScanning: boolean;
  templatesExtracted: boolean;

  // Actions
  scanTemplates: () => Promise<void>;
  extractBundledTemplates: () => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  importTemplate: (sourcePath: string) => Promise<void>;
  getTemplate: (id: string) => TemplateInfo | undefined;
  getTemplatesByScope: (scope: string) => TemplateInfo[];
}
```

Persisted fields: `templatesExtracted` only. The `templates` array is rebuilt from disk on each scan (same as skills).

### Starter Template

When creating a new template, pre-populate with:

```typst
/// ---
/// name: My Template
/// description: A custom PDF template
/// author:
/// version: 1.0
/// variables: []
/// ---

#let template(
  title: "",
  include-toc: false,
  include-page-numbers: false,
  body,
) = {
  set document(title: title)

  set page(
    margin: (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm),
    footer: if include-page-numbers {
      context align(center, text(size: 9pt, fill: luma(120))[
        #counter(page).display()
      ])
    },
  )

  set text(
    font: "Inter",
    size: 11pt,
    fill: luma(30),
  )

  set par(leading: 0.8em)

  // Title
  if title != "" {
    text(size: 24pt, weight: "bold")[#title]
    v(1.5em)
  }

  // Table of contents
  if include-toc {
    outline(indent: 1.5em)
    v(2em)
  }

  body
}
```

## UI/UX

### Export Dialog (Updated)

```
┌─────────────────────────────────────────────┐
│  ⬇  Export as PDF                           │
├─────────────────────────────────────────────┤
│                                             │
│  Style                                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│  │ [thumb]  │ │ [thumb]  │ │ [thumb]  │      │
│  │  Clean   │ │ Academic │ │  Report  │      │
│  │ Built-in │ │ Built-in │ │ Built-in │      │
│  └─────────┘ └─────────┘ └─────────┘      │
│  ┌─────────┐ ┌─────────┐                   │
│  │ [thumb]  │ │    +     │                   │
│  │ Company  │ │  Import  │                   │
│  │  Global  │ │          │                   │
│  └─────────┘ └─────────┘                   │
│                                             │
│  Template Options                           │
│  Company Name  [Acme Corp         ]         │
│  Accent Color  [#2563eb           ]         │
│  ☑ Show Logo                                │
│                                             │
│  ☑ Include table of contents                │
│  ☐ Include page numbers                     │
│                                             │
│  Page size              [A4          ▾]     │
│                                             │
│  Manage templates...                        │
│                                             │
│                    [Cancel]  [Export PDF]    │
└─────────────────────────────────────────────┘
```

- Template cards are wider to accommodate thumbnails
- Dialog max-width increases from 420px to 520px to fit the expanded grid
- "Template Options" section only appears when the selected template has declared variables
- Scope badge (Built-in / Global / Project) shown below template name in muted text
- "+  Import" card opens the native file picker
- "Manage templates..." link at the bottom navigates to Settings > Templates

### Template Editor

- Full-width dialog (90vw x 85vh) with resizable split pane
- Left pane: CodeMirror editor (min 300px)
- Right pane: PDF preview canvas (min 300px)
- Top bar: template name (editable), Save button, Close button
- Bottom bar: variable inputs (horizontally scrollable), compile status, page size selector
- Error overlay: compile errors shown as a red banner below the preview with the Typst error message
- Unsaved changes indicator (dot on save button, confirm on close)

### Settings > Templates

```
┌─────────────────────────────────────────────┐
│  Templates                                  │
│                                             │
│  [+ New Template]  [Import Template]        │
│                                             │
│  Built-in                                   │
│  ┌─────────────────────────────────────┐   │
│  │ Clean          Minimal, generous... │   │
│  │ Built-in       0 variables   [Edit] │   │
│  ├─────────────────────────────────────┤   │
│  │ Academic       Serif, numbered...   │   │
│  │ Built-in       0 variables   [Edit] │   │
│  ├─────────────────────────────────────┤   │
│  │ Report         Title page, head...  │   │
│  │ Built-in       0 variables   [Edit] │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Global                                     │
│  ┌─────────────────────────────────────┐   │
│  │ Company Report  Branded report...   │   │
│  │ By Jane Doe    3 variables          │   │
│  │              [Edit] [Dup] [Delete]  │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Project: My Thesis                         │
│  ┌─────────────────────────────────────┐   │
│  │ Thesis Format   IEEE style...       │   │
│  │ By me          1 variable           │   │
│  │              [Edit] [Dup] [Delete]  │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Data Model

### Template Frontmatter Schema

```yaml
name: string           # Display name (required if frontmatter present)
description: string    # Short description
author: string         # Template author
version: string        # Semver version
variables:             # Array of variable declarations
  - name: string       # Typst parameter name (snake_case)
    type: string       # "string" | "number" | "boolean" | "color" | "enum"
    label: string      # Human-readable label for the export dialog
    default: any       # Default value (must match type)
    min: number        # Optional, for number type
    max: number        # Optional, for number type
    options: string[]  # Required for enum type
thumbnail: string      # Optional, relative path to thumbnail image
```

### Template Store Persistence

```typescript
// Persisted in localStorage via Zustand persist
{
  templatesExtracted: boolean;  // One-time extraction flag
}

// NOT persisted (rebuilt from disk on each scan)
{
  templates: TemplateInfo[];
  isScanning: boolean;
}
```

### Settings Store Changes

```typescript
// Extend ExportTemplate type
export type ExportTemplate = "clean" | "academic" | "report" | string;
// The string variant holds the custom template id

// Add to settings-store
lastExportVariables: Record<string, Record<string, unknown>>;
// Keyed by template id, stores last-used variable values per template
```

## Dependencies

- **CodeMirror 6** — already available (used by source mode editor); needs Typst language support package or custom grammar
- **pdfjs-dist** — already available (used by PdfViewer); reused for template preview rendering
- **No new Rust crates** — YAML parsing uses `serde_yaml` (already in Cargo.toml for other features) or simple line-based parsing since the frontmatter is inside `///` comments

### CodeMirror Typst Support

Typst syntax highlighting options (in priority order):

1. `@myriaddreamin/codemirror-lang-typst` — community package, if stable and maintained
2. Custom Lezer grammar — define Typst keywords, `#let`, `#set`, `#show`, string literals, comments
3. Fall back to `@codemirror/lang-markdown` with Typst-specific keyword highlighting via a simple `HighlightStyle`

## Migration

### Bundled Template Extraction

On first launch after the update (gated by `templatesExtracted` flag):

1. Create `~/.notesage/templates/` directory
2. Write `clean.typ`, `academic.typ`, `report.typ` with their current source plus frontmatter headers
3. Set `templatesExtracted = true` in template-store
4. Subsequent launches skip extraction

The compile-time `include_str!` bundled templates remain as fallback — if the user deletes all templates, the three built-in options still work via the existing `Template` enum. The export pipeline checks for a custom template source first, then falls back to the bundled enum.

### Backwards Compatibility

- The `export_pdf` command's `template` parameter continues to accept `"clean"`, `"academic"`, `"report"` for bundled templates
- The new `template_source` parameter is optional — `None` means use bundled
- Existing `lastExportTemplate` values in settings-store continue to work
- No changes to the markdown-to-typst conversion pipeline

## Quality Gates

### Functional

- [ ] Custom template renders correctly to PDF via the export pipeline
- [ ] Template variables declared in frontmatter appear as input fields in the export dialog
- [ ] Variable values are passed through to Typst and affect the output
- [ ] Template editor opens with CodeMirror and Typst syntax highlighting
- [ ] Live preview updates within 500ms of the last keystroke
- [ ] Compile errors display clearly in the preview pane (not a crash)
- [ ] Template discovery finds templates in both global and project directories
- [ ] Project templates override global templates of the same name
- [ ] Bundled templates extract on first launch and appear as editable Global templates
- [ ] Import copies a `.typ` file to `~/.notesage/templates/` and rescans
- [ ] Duplicate creates a copy with " (Copy)" suffix and opens the editor
- [ ] Delete removes the file and updates the template list
- [ ] Filesystem watcher detects external changes to template files

### Export Dialog

- [ ] Custom templates appear alongside bundled ones in the template grid
- [ ] Template cards show name, description, and scope badge
- [ ] Selecting a template with variables reveals the variable input section
- [ ] Variable defaults pre-populate the input fields
- [ ] Last-used variable values are remembered per template
- [ ] "Manage templates..." link opens Settings > Templates

### Template Editor

- [ ] Split pane with CodeMirror left, PDF preview right
- [ ] Resizable split (drag handle)
- [ ] Unsaved changes indicator and confirm-on-close
- [ ] Variable bar shows declared variables with editable defaults
- [ ] Compile time displayed in status bar
- [ ] Light and dark mode theming for both editor and preview

### Design

- [ ] Template cards in export dialog look polished with thumbnails
- [ ] Template editor feels like a premium IDE experience
- [ ] Consistent with Notesage design system (neutral palette, smooth transitions)
- [ ] Works in both light and dark mode
- [ ] No default browser controls visible in the template editor

### Testing

- [ ] Unit tests for frontmatter parsing (with variables, without, malformed)
- [ ] Unit tests for variable injection into `#show: template.with(...)` call
- [ ] Rust tests for `discover_templates` and `preview_template` commands
- [ ] Integration test: custom template with variables produces valid PDF
- [ ] Existing export tests continue to pass (bundled template backwards compatibility)

## Out of Scope

- **Typst Universe integration** — automated browsing and installing from the Typst package registry; users can manually download `.typ` files and import them
- **Custom fonts** — templates are limited to the three bundled font families; extending `NotesageWorld` to load user fonts is a separate feature
- **Multi-file templates** — each template is a single `.typ` file; templates that `#import` from other files would require extending the virtual filesystem in `NotesageWorld`
- **Template marketplace** — no sharing, rating, or discovery of community templates
- **PDF preview zoom/scroll sync** — the preview shows the full first page; scroll synchronization with the editor is a future enhancement
- **Auto-save for template editor** — templates are saved manually via the Save button; auto-save could overwrite work-in-progress

## Key Files (Existing)

| File | Purpose |
| --- | --- |
| `src-tauri/src/export/templates.rs` | Template enum, `apply_template()`, `TemplateOptions` |
| `src-tauri/src/export/typst_world.rs` | `NotesageWorld` — Typst World trait, virtual filesystem, bundled fonts |
| `src-tauri/src/export/markdown_to_typst.rs` | Markdown to Typst markup conversion |
| `src-tauri/src/commands/export.rs` | `export_pdf` and `save_binary_file` Tauri commands |
| `src-tauri/templates/` | Bundled `.typ` template files (clean, academic, report) |
| `src/components/ExportDialog.tsx` | Export options dialog |
| `src/hooks/useExportOperations.ts` | Export hook (calls Tauri commands) |
| `src/stores/settings-store.ts` | `ExportTemplate`, `ExportPageSize`, last-used export preferences |
| `src/components/editor/SourceModeEditor.tsx` | Existing CodeMirror 6 integration (reference for editor setup) |

## Key Files (New)

| File | Purpose |
| --- | --- |
| `src-tauri/src/commands/templates.rs` | New Tauri commands for template CRUD and discovery |
| `src/stores/template-store.ts` | Template registry Zustand store |
| `src/components/settings/TemplatesSettings.tsx` | Settings > Templates tab |
| `src/components/TemplateEditor.tsx` | Split-pane template editor dialog |
| `src/components/TemplatePreview.tsx` | PDF preview pane using pdfjs-dist |
| `src/hooks/useTemplateDiscovery.ts` | Template scanning lifecycle hook (mounted in App.tsx) |
