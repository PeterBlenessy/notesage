# Tasks: Document Generation (Phase 4)

**Status:** ✅ Complete

**Source PRD:** `docs/prds/2026-02-18-document-generation.md`

## Summary

**13 tasks: 3S, 6M, 4L — All complete**

**Implementation order:** Backend foundation (Rust crates, Typst world, markdown conversion) -&gt; templates & fonts -&gt; Tauri command -&gt; frontend state -&gt; UI dialog -&gt; integration & wiring -&gt; docs.

**Risks / Open Questions:**

- Typst crate version compatibility — `typst` and `typst-pdf` must be the same version. Pin explicitly.
- `typst-as-lib` may lag behind `typst` releases — evaluate whether to use it or implement `World` trait directly.
- Binary size impact — Typst adds \~40MB. Measure before/after.
- Font licensing — verify all bundled fonts have OFL/Apache licenses permitting redistribution.
- Image path resolution — local image paths in markdown must be resolved to absolute paths for Typst to embed them.

---

## Tasks

### #1 ✅ DONE. Add Typst and markdown parsing dependencies to Cargo.toml

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/Cargo.toml` |

Add `typst`, `typst-pdf`, `typst-syntax`, `typst-library`, and `comrak` (GFM-compatible markdown parser) to dependencies. Pin Typst crates to a consistent version. Run `cargo check` to verify resolution.

**Acceptance criteria:**

- `cargo check` passes with new dependencies
- All Typst crates are the same version

---

### #2 ✅ DONE. Bundle fonts for deterministic PDF rendering

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/fonts/inter/*.ttf`, `src-tauri/fonts/source-serif/*.ttf`, `src-tauri/fonts/jetbrains-mono/*.ttf` |

Download and add font files to `src-tauri/fonts/`:

- **Inter** (Regular, Bold, Italic, BoldItalic) — sans-serif body
- **Source Serif 4** (Regular, Bold, Italic, BoldItalic) — serif body
- **JetBrains Mono** (Regular) — code blocks

Verify all fonts are OFL or Apache 2.0 licensed. Add a `fonts/LICENSE` file with attributions.

**Acceptance criteria:**

- Font files present in `src-tauri/fonts/`
- License file included
- Total font size under 3MB

---

### #3 ✅ DONE. Implement Typst World trait for embedded compilation

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | Depends on #1, #2 |
| **Files** | `src-tauri/src/export/mod.rs`, `src-tauri/src/export/typst_world.rs` |

Implement the Typst `World` trait so the compiler can run embedded in the Tauri backend. The world must:

- Load bundled fonts from `src-tauri/fonts/` (ignore system fonts for determinism)
- Resolve file reads for template `.typ` files
- Provide the main source (converted Typst markup) as the compilation input
- Handle current date/time for `datetime` in templates

Evaluate `typst-as-lib` wrapper vs direct `World` implementation. Use whichever is simpler and doesn't lag behind Typst releases.

**Acceptance criteria:**

- Can compile a simple Typst string (`= Hello World`) into PDF bytes using the embedded world
- Bundled fonts are discoverable by the compiler
- No system font dependency

---

### #4 ✅ DONE. Implement markdown-to-Typst conversion

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | Depends on #1 |
| **Files** | `src-tauri/src/export/markdown_to_typst.rs` |

Parse markdown (using `comrak` with GFM extensions) and emit Typst markup. Handle all node types from the PRD mapping table:

- Headings (H1-H6) -&gt; `=` to `======`
- Paragraphs -&gt; plain text with blank line separation
- Bold -&gt; `*bold*`, Italic -&gt; `_italic_`, Strikethrough -&gt; `#strike[text]`
- Inline code -&gt; `` `code` ``
- Links -&gt; `#link("url")[text]`
- Images -&gt; `#image("path")` with absolute path resolution
- Bullet lists -&gt; `- item` with nesting
- Ordered lists -&gt; `+ item` or numbered
- Task lists -&gt; custom checkbox function
- Blockquotes -&gt; `#quote(block: true)[text]`
- Code blocks -&gt; ```` ```lang ... ``` ```` (Typst raw blocks)
- Tables -&gt; `#table(columns: N, ...cells)`
- Horizontal rules -&gt; `#line(length: 100%)`
- YAML frontmatter -&gt; strip entirely (don't render)

**Acceptance criteria:**

- Unit tests for each markdown node type -&gt; Typst output
- Complex document with mixed elements converts correctly
- Frontmatter stripped from output
- Image paths resolved to absolute paths (relative to document directory)

---

### #5 ✅ DONE. Create Typst template presets

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | Depends on #2, #3 |
| **Files** | `src-tauri/templates/clean.typ`, `src-tauri/templates/academic.typ`, `src-tauri/templates/report.typ`, `src-tauri/src/export/templates.rs` |

Write three `.typ` template files and a Rust module to load/apply them:

**Clean** (default): Sans-serif (Inter), generous margins, minimal headers/footers, no ToC by default.

**Academic**: Serif (Source Serif 4), tighter spacing, numbered headings, suitable for papers.

**Report**: Title page with document title, header with title and page numbers, ToC by default, Inter body.

Each template accepts parameters: `title`, `include-toc`, `include-page-numbers`, `page-size`. The `templates.rs` module loads templates via `include_str!` and injects the converted markdown content and parameters.

**Acceptance criteria:**

- Each template produces a visually distinct PDF
- Parameters (ToC, page numbers, page size) work correctly
- Fonts render from bundled set

---

### #6 ✅ DONE. Implement `export_pdf` Tauri command

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | Depends on #3, #4, #5 |
| **Files** | `src-tauri/src/commands/export.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` |

Create the `export_pdf` command following the pattern in `commands/file.rs`:

```rust
#[tauri::command]
pub async fn export_pdf(
    markdown: String,
    title: String,
    template: String,
    include_toc: bool,
    include_page_numbers: bool,
    page_size: String,
) -> Result<Vec<u8>, String>
```

Pipeline: markdown -&gt; `markdown_to_typst` -&gt; wrap with template -&gt; compile via Typst world -&gt; `typst_pdf::pdf()` -&gt; return bytes.

Register in `mod.rs` and `lib.rs` invoke handler.

Also add a `save_binary_file` command (existing `write_file` only handles strings):

```rust
#[tauri::command]
pub async fn save_binary_file(path: String, data: Vec<u8>) -> Result<(), String>
```

**Acceptance criteria:**

- `export_pdf` returns valid PDF bytes for a test markdown document
- All three templates work
- All three page sizes work
- `save_binary_file` writes bytes to disk correctly
- Commands registered and callable from frontend

---

### #7 ✅ DONE. Add export settings to settings-store

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/stores/settings-store.ts` |

Add export preferences to the existing settings store (already uses Zustand persist):

```typescript
// New fields
lastExportTemplate: 'clean' | 'academic' | 'report';  // default: 'clean'
lastExportPageSize: 'a4' | 'letter' | 'a5';            // default: 'a4'
lastExportIncludeToC: boolean;                          // default: false
lastExportIncludePageNumbers: boolean;                  // default: false
// + setters
```

**Acceptance criteria:**

- Settings persist across app restarts
- Default values are sensible

---

### #8 ✅ DONE. Add typed Tauri invoke wrappers for export commands

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | Depends on #6 |
| **Files** | `src/lib/tauri.ts` |

Add typed wrappers following the existing pattern in `tauri.ts`:

```typescript
async exportPdf(options: {
  markdown: string;
  title: string;
  template: string;
  includeToc: boolean;
  includePageNumbers: boolean;
  pageSize: string;
}): Promise<number[]>  // PDF bytes

async saveBinaryFile(path: string, data: number[]): Promise<void>
```

**Acceptance criteria:**

- TypeScript types match Rust command signatures
- Wrappers follow existing patterns in `tauri.ts`

---

### #9 ✅ DONE. Build ExportDialog component

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | Depends on #7 |
| **Files** | `src/components/ExportDialog.tsx` |

Build the export dialog using shadcn/ui `dialog`, `button`, `select`, `checkbox`:

- Template selector with 3 style cards (Clean, Academic, Report) — selected state uses accent background
- Checkbox: Include table of contents
- Checkbox: Include page numbers
- Page size select: A4, Letter, A5
- Cancel and Export PDF buttons
- Loading state: spinner on Export button during compilation
- Defaults loaded from settings-store; choices saved back on export
- Template defaults: Clean (no ToC, no page numbers), Academic (ToC on, page numbers on), Report (ToC on, page numbers on) — switching template updates checkboxes to template defaults

Follow design system: neutral palette, transitions, both themes, proper spacing.

**Acceptance criteria:**

- Dialog opens and closes cleanly
- All controls function (template selection, checkboxes, dropdown)
- Settings persist between dialog opens
- Template switching updates checkbox defaults
- Loading state shown during export
- Works in both light and dark mode

---

### #10 ✅ DONE. Implement useExportOperations hook

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Depends on #8, #9 |
| **Files** | `src/hooks/useExportOperations.ts` |

Create a hook that orchestrates the export flow:

1. Get markdown from current editor via `getMarkdownFromEditor()`
2. Get document title from active tab filename (strip `.md` extension)
3. Call `exportPdf` Tauri command with options
4. Open native save dialog via `tauri-plugin-dialog` with suggested filename `{title}.pdf`
5. If user confirms, call `saveBinaryFile` to write PDF bytes
6. Show success toast with "Reveal in Finder" action (use existing `reveal_in_finder` command)
7. Show error toast on failure
8. Save last-used settings to settings-store

**Acceptance criteria:**

- Full export flow works end-to-end
- Native save dialog shows with correct suggested filename
- Success/error toasts shown
- Settings saved after successful export

---

### #11 ✅ DONE. Wire up keyboard shortcut and context menu

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Depends on #9, #10 |
| **Files** | `src/App.tsx`, `src/components/tabs/TabBar.tsx` |

- Add `Cmd+Shift+E` handler in `App.tsx` keyboard shortcuts (follow existing pattern for Cmd+Shift+A, Cmd+Shift+N)
- Add "Export as PDF..." to tab right-click context menu in `TabBar.tsx` (if context menu exists) or tab bar area
- Only enable when an active file is open
- Opens ExportDialog

**Acceptance criteria:**

- Cmd+Shift+E opens export dialog when a file is active
- Cmd+Shift+E does nothing when no file is open
- Context menu entry works

---

### #12 ✅ DONE. Update documentation

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | both |
| **Dependencies** | Depends on #11 |
| **Files** | `docs/product-description.md`, `docs/keyboard-shortcuts.md`, `docs/tauri-commands.md`, `docs/architecture.md` |

- Move Document Generation from Roadmap to Current Features in `product-description.md`
- Add `Cmd+Shift+E` to `keyboard-shortcuts.md`
- Add `export_pdf` and `save_binary_file` to `tauri-commands.md`
- Add export module to project structure in `architecture.md`

**Acceptance criteria:**

- All docs accurately reflect the implementation
- No orphaned references

---

### #13 ✅ DONE. End-to-end testing with reference documents

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | both |
| **Dependencies** | Depends on #11 |
| **Files** | `tests/export/` (new test fixtures) |

Create reference markdown documents and verify PDF output:

- Simple document (headings, paragraphs, lists)
- Complex document (all node types: code blocks, tables, images, task lists, blockquotes, links)
- Long document (10+ pages for ToC and page number testing)
- Edge cases: empty document, frontmatter-only, document with no headings (ToC should be empty)

Test all 3 templates x 3 page sizes = 9 combinations minimum.

Verify:

- Export completes under 2 seconds for 10-page doc
- PDFs open correctly in Preview.app
- All markdown elements rendered
- Fonts are the bundled ones (not system fallbacks)

**Acceptance criteria:**

- Reference documents produce correct PDFs
- Performance target met (&lt; 2s)
- All template/page-size combinations work