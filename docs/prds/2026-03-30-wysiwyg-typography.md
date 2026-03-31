# PRD: WYSIWYG Typography & Page Constructs

|  |  |
| --- | --- |
| **Date** | 2026-03-30 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | What users see in the editor is what they get in every export format — fulfills the WYSIWYG promise |
| **Research** | [document-format-enhancements](../research/2026-03-30-document-format-enhancements.md) |

## Problem

Notesage is a WYSIWYG editor, but the WYSIWYG contract is broken at export time. Users configure typography in the editor (font family, size, line height), but when they export to PDF, DOCX, PPTX, or HTML, every format uses its own hardcoded template typography. A user who picks Source Serif 4 at 18pt for their headings sees it in the editor — then gets Inter at 24pt in the PDF because of a template preset.

Additionally, typography settings are global: headings and paragraphs share the same font family and size. Users cannot style H1 differently from H2 differently from body text — the fundamental capability of any serious document editor.

The current export dialog asks users to pick a template (Clean, Academic, Report), which adds cognitive overhead that contradicts the WYSIWYG model. For a text-only editor, export templates make sense. For a WYSIWYG editor, they don't — the document already looks the way the user wants it.

## Goals

### Phase 1 — Per-Block-Type Typography & Export Alignment

1. **Per-block-type style presets** — configurable typography for each block type (Paragraph, H1-H6, Code, Blockquote) with font family, font size, font weight, line height, spacing, and text color
2. **Google Docs-style update/reset** — "Update Heading 2 to match" saves current formatting as the preset for that block type; "Reset to Heading 2 style" strips local overrides
3. **Context-aware toolbar** — Typography controls show the current block's effective values, not global defaults
4. **Export alignment** — PDF, DOCX, PPTX, and HTML exports read block-type presets and apply them directly. No template picker needed.
5. **User-insertable page breaks** — `/pagebreak` slash command, visible divider in editor, respected in all exports

### Phase 2 — Page Constructs

6. **Editable headers/footers** — clickable header/footer zones in paged view with text + variables (`{page}`, `{pages}`, `{title}`, `{date}`)
7. **Title page toggle** — "Different first page" setting for distinct first-page header/footer (or none)

## Non-Goals

- **Typst template editor** — superseded by this approach; users style in the editor, not in Typst code
- **Export-time template picker** — the editor IS the template; export dialog reduces to page size + TOC + page numbers
- **Custom font installation** — templates use bundled fonts (Inter, Source Serif 4, JetBrains Mono) plus detected system fonts (already supported via `list_system_fonts`)
- **Collaborative style editing** — real-time multi-user style negotiation is out of scope
- **CSS-level control** — users configure typography through the toolbar, not by writing CSS

## User Stories

- As a writer, I want my H1 to use Source Serif 4 at 28pt and my body text to use Inter at 14pt, and see both styles live in the editor AND in my exported PDF
- As a user, I want to adjust a heading's font in the toolbar, then click "Update Heading 2 to match" so all H2s in my document adopt the same style
- As a user, I want to insert a page break before my appendix section and have it respected in PDF and DOCX exports
- As a user, I want to add a header with my document title and page number that appears on every page of my exported PDF
- As a user creating a new document, I want to start from a preset (e.g., "Academic") that pre-configures my block-type styles, then customize from there

## Technical Approach

### Per-Block-Type Style Presets

Extend `editor-styles-store` from a flat global config to a per-block-type preset system.

**Current store shape:**

```typescript
interface EditorStyles {
  fontFamily: EditorFontFamily;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
}
```

**New store shape:**

```typescript
interface BlockTypeStyle {
  fontFamily: EditorFontFamily;
  fontSize: number;          // px
  fontWeight: number;        // 400, 500, 600, 700
  lineHeight: number;        // multiplier
  spacingBefore: number;     // em
  spacingAfter: number;      // em
  color?: string;            // CSS color or undefined for default foreground
}

interface TypographyPresets {
  paragraph: BlockTypeStyle;
  heading1: BlockTypeStyle;
  heading2: BlockTypeStyle;
  heading3: BlockTypeStyle;
  heading4: BlockTypeStyle;
  heading5: BlockTypeStyle;
  heading6: BlockTypeStyle;
  codeBlock: Pick<BlockTypeStyle, 'fontFamily' | 'fontSize'>;
  blockquote: Pick<BlockTypeStyle, 'fontFamily' | 'fontSize' | 'fontWeight' | 'color'>;
}
```

**Default presets (matching current editor appearance):**

| Block Type | Font | Size | Weight | Line Height | Spacing Before | Spacing After |
| --- | --- | --- | --- | --- | --- | --- |
| Paragraph | System (SF Pro) | 16px | 400 | 1.7 | 0 | 0.75em |
| Heading 1 | System (SF Pro) | 32px | 700 | 1.3 | 1.0em | 0.5em |
| Heading 2 | System (SF Pro) | 24px | 600 | 1.3 | 0.8em | 0.4em |
| Heading 3 | System (SF Pro) | 20px | 600 | 1.3 | 0.6em | 0.3em |
| Heading 4 | System (SF Pro) | 18px | 600 | 1.3 | 0.5em | 0.25em |
| Heading 5 | System (SF Pro) | 16px | 600 | 1.3 | 0.4em | 0.2em |
| Heading 6 | System (SF Pro) | 14px | 600 | 1.3 | 0.4em | 0.2em |
| Code Block | JetBrains Mono | 14px | — | — | — | — |
| Blockquote | System (SF Pro) | 16px | 400 | — | — | — |

**Preset storage:**

| Path | Scope | Priority |
| --- | --- | --- |
| `<project>/.notesage/typography.json` | Per-project | Highest |
| `~/.notesage/typography.json` | Global | Fallback |
| Hardcoded defaults | App default | Lowest |

New documents inherit the presets in scope. The existing `editor-styles.json` file is migrated: its global font/size/lineHeight/spacing values become the Paragraph preset, with heading defaults inferred.

**Document creation presets ("templates"):**

Pre-configured typography preset bundles that can be applied when creating a new document:

| Preset | Paragraph Font | Heading Font | Character |
| --- | --- | --- | --- |
| Default | System (SF Pro) | System (SF Pro) | Clean, modern |
| Academic | Source Serif 4 | Source Serif 4 | Formal, traditional |
| Report | Inter | Inter | Business, structured |

These are applied at document creation (New Note dialog or project template), not at export time.

### CSS Variable Application

Extend the current CSS variable system from 4 global variables to per-block-type variables:

```css
/* Applied to .ProseMirror or scoped to block types */
.ProseMirror p {
  font-family: var(--ns-paragraph-font-family);
  font-size: var(--ns-paragraph-font-size);
  font-weight: var(--ns-paragraph-font-weight);
  line-height: var(--ns-paragraph-line-height);
  margin-bottom: var(--ns-paragraph-spacing-after);
}

.ProseMirror h1 {
  font-family: var(--ns-h1-font-family);
  font-size: var(--ns-h1-font-size);
  font-weight: var(--ns-h1-font-weight);
  line-height: var(--ns-h1-line-height);
  margin-top: var(--ns-h1-spacing-before);
  margin-bottom: var(--ns-h1-spacing-after);
}
/* ... h2-h6, code, blockquote similarly */
```

Variables set as inline styles on the editor container (same pattern as today), cascading to all block types.

### Google Docs-Style Update/Reset

The existing block-type dropdown (heading level picker in the toolbar) gains two actions per block type:

**Interaction flow:**

1. User places cursor in a block or selects text
2. Changes typography via toolbar (font picker, size, weight, etc.)
3. Change applies immediately as a **local override** on that specific block (ProseMirror node attribute)
4. The block-type dropdown shows the current type (e.g., "Heading 2") with a small indicator if the block has local overrides
5. Clicking the dropdown reveals existing block types plus:
   - **"Update 'Heading 2' to match"** — saves the current block's effective style as the H2 preset; all H2s without local overrides update; the current block's overrides become the new baseline
   - **"Reset to 'Heading 2' style"** — removes local overrides on the current block, reverts to the preset

**Implementation:**

- Local overrides stored as ProseMirror node attributes: `{ fontFamily?, fontSize?, fontWeight?, lineHeight?, color? }`
- When present, inline styles override the CSS variables for that specific block
- "Update to match" writes the effective values back to the store preset
- "Reset" clears the node attributes, so the block falls back to CSS variables
- The toolbar's Typography popover becomes context-aware: reads the current block's effective values (preset + any local overrides) and updates accordingly

### User-Insertable Page Breaks

Extend the existing `page-breaks.ts` extension:

- **New ProseMirror node type:** `pageBreak` — an atom node that renders as a labeled horizontal divider ("Page Break")
- **Slash command:** `/pagebreak` in the slash command menu
- **Rendering:** Visible divider with centered "Page Break" label, styled consistently with the existing page break gap decoration
- **Behavior:** Draggable, deletable, selectable. In paged view, forces content after it to start on a new page.
- **Export mapping:**
  - PDF (Typst): `#pagebreak()`
  - DOCX: `<w:br w:type="page"/>`
  - PPTX: New slide
  - HTML: `<div style="page-break-before: always"></div>`
- **Markdown round-trip:** Serialize as `<!-- pagebreak -->` HTML comment (invisible in other renderers, lossless round-trip)

### Editable Headers/Footers (Phase 2)

When the document is in paged view (A4/Letter/A5), render clickable header and footer zones.

**Header/footer model:**

```typescript
interface PageHeaderFooter {
  left: string;           // Text or variable template
  center: string;
  right: string;
  differentFirstPage: boolean;
  firstPage?: {
    left: string;
    center: string;
    right: string;
  };
}

interface DocumentPageSettings {
  header: PageHeaderFooter;
  footer: PageHeaderFooter;
}
```

**Variables supported:**

| Variable | Rendered As |
| --- | --- |
| `{page}` | Current page number |
| `{pages}` | Total page count |
| `{title}` | Document title (from frontmatter or filename) |
| `{date}` | Current date |

**UI:**

- In paged view: translucent header/footer zones at top/bottom of each page
- Click to enter edit mode — inline editing with variable insertion
- Three-column layout (left | center | right) via tab stops or segmented input
- "Different first page" toggle in the header/footer edit UI
- When not in paged view: accessible via document settings

**Storage:**

- Stored in YAML frontmatter under a `page` key
- Preserved across save/reload cycles

**Export mapping:**

- PDF (Typst): `set page(header: ..., footer: ...)` with `context` for page counters
- DOCX: Word header/footer XML elements with page fields
- HTML: CSS `@page` margin boxes or rendered `<header>`/`<footer>` elements

### Export Pipeline Changes

**Principle:** Exports read the active typography presets and apply them. No template selection.

**PDF (Typst):**

Replace the current `apply_template()` approach with dynamic Typst generation:

```rust
fn generate_typst_styles(presets: &TypographyPresets) -> String {
    // Generate #set text(...), #set heading(...), etc.
    // from the presets — no template file needed
}
```

The markdown-to-Typst converter receives the presets and emits appropriate `#set` rules. Bundled `.typ` templates are no longer needed for styling — they become optional layout-only scaffolding (TOC placement, page numbering format).

**DOCX:**

Replace `DocxStyleConfig` hardcoded values with preset values:

```rust
fn build_docx_styles(presets: &TypographyPresets) -> DocxStyles {
    // Map each block type's preset to Word paragraph/run styles
}
```

**PPTX:**

Map presets to slide text formatting. Title slides use H1 preset, body uses Paragraph preset.

**HTML:**

Generate a `<style>` block from presets, embedded in the HTML document.

**New export command signature:**

```rust
#[tauri::command]
pub async fn export_pdf(
    markdown: String,
    title: String,
    include_toc: bool,
    include_page_numbers: bool,
    page_size: String,
    project_root: Option<String>,
    typography: Option<TypographyPresets>,    // NEW — block-type presets
    page_settings: Option<DocumentPageSettings>, // NEW — headers/footers (Phase 2)
) -> Result<Vec<u8>, String>
```

The `template: String` parameter is removed. If `typography` is `None`, sensible defaults are used (matching the current Clean template appearance).

### Migration

**editor-styles.json migration:**

The existing `editor-styles.json` (flat: fontFamily, fontSize, lineHeight, paragraphSpacing) is auto-migrated to the new format:

1. On load, detect the old flat format
2. Map `fontFamily` → all block types' `fontFamily`
3. Map `fontSize` → Paragraph `fontSize` (headings get proportional defaults)
4. Map `lineHeight` → Paragraph `lineHeight`
5. Map `paragraphSpacing` → Paragraph `spacingAfter`
6. Write the new `typography.json` format
7. The old `editor-styles.json` is kept as-is (no deletion, no breakage)

**Export dialog migration:**

- The template picker (Clean/Academic/Report) is removed from the export dialog
- `lastExportTemplate` in settings-store becomes unused (kept for backwards compatibility, not displayed)
- Export dialog simplifies to: page size, TOC toggle, page numbers toggle

## UI/UX

### Block-Type Dropdown (Enhanced)

```
┌──────────────────────────────┐
│  Paragraph                   │
│  Heading 1                   │
│  Heading 2              ✓    │  ← current block type
│  Heading 3                   │
│  Heading 4                   │
│  Heading 5                   │
│  Heading 6                   │
├──────────────────────────────┤
│  ↑ Update 'Heading 2' to    │
│    match current formatting  │
│  ↺ Reset to 'Heading 2'     │
│    style                     │
└──────────────────────────────┘
```

- Separator line between block type selection and update/reset actions
- "Update to match" only visible when the current block has local overrides
- "Reset" only visible when the current block has local overrides
- Both actions show the current block type name dynamically

### Typography Popover (Context-Aware)

The existing Typography popover stays in the toolbar but becomes context-aware:

- Shows the **current block's** effective values (preset + any local overrides)
- Changes apply as local overrides to the current block
- The font picker, size slider, weight selector, and spacing controls remain the same
- A new "weight" control is added (dropdown: Regular 400, Medium 500, Semibold 600, Bold 700)

### Export Dialog (Simplified)

```
┌─────────────────────────────────────────────┐
│  Export as PDF                               │
├─────────────────────────────────────────────┤
│                                             │
│  ☑ Include table of contents                │
│  ☐ Include page numbers                     │
│                                             │
│  Page size              [A4          ▾]     │
│                                             │
│                    [Cancel]  [Export PDF]    │
└─────────────────────────────────────────────┘
```

No template picker. Typography comes from the editor. Page headers/footers come from the document settings (Phase 2).

### Page Break (In Editor)

```
─ ─ ─ ─ ─ ─ ─ Page Break ─ ─ ─ ─ ─ ─ ─
```

- Dashed line with centered "Page Break" label
- Muted text color, thin rule
- Hover: subtle highlight, delete (x) button appears on the right
- In paged view: content after the break starts on the next page

### Headers/Footers (Phase 2, In Paged View)

```
┌─────────────────────────────────────────────┐
│  Click to edit header                       │  ← translucent zone
├─────────────────────────────────────────────┤
│                                             │
│  Document content...                        │
│                                             │
├─────────────────────────────────────────────┤
│  Click to edit footer                       │  ← translucent zone
└─────────────────────────────────────────────┘
```

When clicked:

```
┌─────────────────────────────────────────────┐
│  [My Report     ] [         ] [Page {page}] │
│  ☐ Different first page    [Insert: {▾}]    │
└─────────────────────────────────────────────┘
```

Three-column inline editor with variable insertion dropdown.

## Data Model

### Typography Presets File (`typography.json`)

```json
{
  "version": 1,
  "presets": {
    "paragraph": {
      "fontFamily": "system",
      "fontSize": 16,
      "fontWeight": 400,
      "lineHeight": 1.7,
      "spacingBefore": 0,
      "spacingAfter": 0.75
    },
    "heading1": {
      "fontFamily": "source-serif-4",
      "fontSize": 32,
      "fontWeight": 700,
      "lineHeight": 1.3,
      "spacingBefore": 1.0,
      "spacingAfter": 0.5
    }
  }
}
```

### ProseMirror Node Attributes (Local Overrides)

```typescript
// Added to heading and paragraph node specs
attrs: {
  level: { default: 1 },          // existing (headings only)
  fontFamily: { default: null },   // local override, null = use preset
  fontSize: { default: null },
  fontWeight: { default: null },
  lineHeight: { default: null },
  color: { default: null },
}
```

Local overrides are **not serialized to markdown** — they exist only in the ProseMirror document. When a user does "Update to match", the overrides become the preset and are cleared from the node. This keeps markdown clean.

### Document Page Settings (Phase 2)

Stored in YAML frontmatter:

```yaml
---
page:
  header:
    left: ""
    center: ""
    right: "Page {page}"
    differentFirstPage: true
    firstPage:
      left: ""
      center: "{title}"
      right: ""
  footer:
    left: "{date}"
    center: ""
    right: ""
---
```

## Dependencies

- **No new crates or packages** — all changes build on existing infrastructure
- Extends: `editor-styles-store`, `editor.css`, heading picker, Typography popover
- Modifies: all four export pipelines (Typst, DOCX, PPTX, HTML)
- New: `pageBreak` ProseMirror node, `typography.json` preset files

## Quality Gates

### Phase 1 — Typography & Export Alignment

#### Functional

- [ ] Each block type (Paragraph, H1-H6, Code, Blockquote) has independently configurable typography

- [ ] Changing a preset updates all blocks of that type in the editor immediately

- [ ] "Update Heading N to match" saves current block's formatting as the preset

- [ ] "Reset to Heading N style" strips local overrides and reverts to preset

- [ ] Typography popover shows the current block's effective values

- [ ] Typography presets saved to `typography.json` and restored on reload

- [ ] Per-project presets override global presets

- [ ] Migration from `editor-styles.json` preserves existing user settings

- [ ] PDF export uses editor typography presets (not hardcoded template fonts)

- [ ] DOCX export uses editor typography presets

- [ ] PPTX export uses editor typography presets

- [ ] HTML export uses editor typography presets

- [ ] `/pagebreak` slash command inserts a page break node

- [ ] Page break renders as a labeled divider in the editor

- [ ] Page break respected in PDF, DOCX, PPTX, HTML exports

- [ ] Page break survives markdown round-trip (`<!-- pagebreak -->`)

- [ ] Export dialog no longer shows template picker

- [ ] Document creation presets (Default, Academic, Report) available in New Note dialog

#### Design

- [ ] Block-type dropdown update/reset actions look polished and intuitive

- [ ] Typography controls feel responsive and immediate

- [ ] Page break divider is visually distinct but not distracting

- [ ] Export dialog is clean and simplified

- [ ] Works in both light and dark mode

#### Testing

- [ ] Unit tests for typography preset store (load, save, migrate, per-block-type)

- [ ] Unit tests for ProseMirror node attribute overrides (set, clear, "update to match")

- [ ] Unit tests for page break node (insert, delete, markdown round-trip)

- [ ] Rust tests for export pipeline typography parameter handling

- [ ] Existing export tests updated for new command signatures

- [ ] Markdown round-trip test with `<!-- pagebreak -->` comment

### Phase 2 — Page Constructs

#### Functional

- [ ] Header/footer zones visible in paged view

- [ ] Click to edit header/footer content

- [ ] Variables (`{page}`, `{pages}`, `{title}`, `{date}`) render correctly

- [ ] Three-column layout (left, center, right) for header/footer content

- [ ] "Different first page" toggle works

- [ ] Header/footer settings stored in frontmatter and restored on reload

- [ ] Headers/footers rendered in PDF, DOCX, HTML exports

- [ ] Hidden when not in paged view

#### Design

- [ ] Header/footer zones are subtle and non-intrusive until clicked

- [ ] Editing experience is inline and intuitive (no modal dialogs)

- [ ] Variable insertion is discoverable

## Out of Scope

- **Typst template editor** — superseded by WYSIWYG approach
- **Export-time template selection** — the editor is the template
- **Per-paragraph style overrides in markdown** — local overrides are not serialized; they exist only in ProseMirror and are meant to be promoted to presets via "Update to match"
- **Custom font installation/bundling** — system fonts + 3 bundled families are sufficient
- **Footnote/endnote editing in paged view** — separate feature
- **Multi-column layout** — out of scope for v1

## Key Files (Existing, to Modify)

| File | Change |
| --- | --- |
| `src/stores/editor-styles-store.ts` | Extend to per-block-type presets, add update/reset logic |
| `src/components/editor/toolbar/TypographyPopover.tsx` | Context-aware: show current block's values |
| `src/components/editor/Toolbar.tsx` | Heading picker gains update/reset actions |
| `src/styles/editor.css` | Per-block-type CSS variables |
| `src/components/editor/Editor.tsx` | Apply per-block-type CSS variables, handle node attributes |
| `src/components/editor/extensions/page-breaks.ts` | Add insertable `pageBreak` node type |
| `src/components/editor/SlashCommand.tsx` | Add `/pagebreak` command |
| `src/lib/markdown.ts` | Serialize/parse `<!-- pagebreak -->` |
| `src/components/ExportDialog.tsx` | Remove template picker, pass typography presets |
| `src/hooks/useExportOperations.ts` | Pass typography presets to export commands |
| `src-tauri/src/commands/export.rs` | Accept typography presets parameter |
| `src-tauri/src/export/templates.rs` | Generate styles from presets instead of template enum |
| `src-tauri/src/export/markdown_to_typst.rs` | Apply presets to Typst output |
| `src-tauri/src/export/markdown_to_docx.rs` | Apply presets to DOCX styles |
| `src-tauri/src/export/markdown_to_pptx.rs` | Apply presets to PPTX text formatting |
| `src-tauri/src/export/markdown_to_html.rs` | Generate CSS from presets |

## Key Files (New)

| File | Purpose |
| --- | --- |
| `src/lib/typography-presets.ts` | Default presets, preset merging, migration logic |
| `src/components/editor/extensions/page-break-node.ts` | Insertable page break ProseMirror node |
