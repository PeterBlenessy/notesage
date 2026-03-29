# PRD: Drawing Canvas

|  |  |
| --- | --- |
| **Date** | 2026-03-29 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Users can create diagrams, sketches, and visual annotations inline in their documents |
| **Research** | [rich-content-editor-features](../research/2026-03-29-rich-content-editor-features.md) |
| **Tasks** | [drawing-canvas-tasks](../tasks/2026-03-29-drawing-canvas-tasks.md) |

## Problem

Notesage documents are text-only. Users writing reports, planning documents, or research notes frequently need visual elements — diagrams, flowcharts, wireframes, annotated sketches — that cannot be expressed in text. Today the only option is to create an image in an external tool and paste it in, breaking the writing flow and producing static, un-editable images.

Drawing is the highest-requested rich content feature across note-taking apps. Obsidian's Excalidraw plugin has 2M+ downloads, Logseq made whiteboards a core feature, and Craft offers native sketch blocks.

## Goals

1. **Inline drawing blocks** — insert a drawing canvas anywhere in a document, just like an image or code block
2. **Full drawing tools** — shapes, arrows, text, freehand drawing, connectors — covering diagrams, sketches, and annotations
3. **Click-to-edit, collapse-to-preview** — drawings show as static SVG when not focused, open the full Excalidraw editor on click
4. **Sidecar storage** — drawing data stored as `.excalidraw` JSON files in `.notesage/drawings/`, keeping markdown clean
5. **PDF export** — drawings render as SVG images in exported PDFs

## Non-Goals

- Real-time collaborative drawing (future — requires CRDT integration)
- Apple Pencil / touch-optimized drawing (Notesage is desktop-first)
- Infinite canvas / standalone whiteboard mode (drawings are inline blocks, not a separate view)
- Image import into the drawing canvas (paste images into drawings)
- Custom Excalidraw libraries or template shapes

## User Stories

- As a report author, I want to insert a flowchart inline in my document so that I can visually explain a process without leaving the editor
- As a user planning a project, I want to sketch a quick wireframe or diagram that lives inside my note, not in a separate tool
- As a user, I want to click a drawing to edit it and see it as a clean preview when I'm writing, so it doesn't clutter my editing flow
- As a user exporting to PDF, I want my drawings to render as crisp vector graphics in the output

## Technical Approach

### Excalidraw as the Drawing Engine

Embed `@excalidraw/excalidraw` (MIT, 100K+ GitHub stars) as a React component inside a custom Tiptap node.

**Why Excalidraw:**

- Free and open source (MIT) — no license costs
- Hand-drawn aesthetic is charming and distinctive
- React component designed for embedding
- Scene stored as JSON, exportable as SVG/PNG
- Massive community, actively maintained
- \~500KB bundle addition (acceptable for a desktop app)

### Tiptap Node Extension

A new `Drawing` node extension:

```typescript
{
  group: 'block',
  atom: true,              // treated as a single unit, not editable inline
  attrs: {
    drawingId: { default: null },   // UUID linking to the .excalidraw sidecar file
    width: { default: null },       // rendered width (null = full editor width)
    height: { default: 400 },      // rendered height in pixels
  },
}
```

**Atom node** — the drawing block is a single opaque unit in ProseMirror. Clicking it opens the Excalidraw editor overlay; the document model only stores the reference ID.

### Storage: Sidecar Files

Drawing data is stored as `.excalidraw` JSON files alongside comments:

```
<project>/.notesage/drawings/<drawingId>.excalidraw
```

This keeps the markdown file clean — the document only contains a reference:

```markdown
![drawing](/.notesage/drawings/abc123.excalidraw)
```

On parse, the image syntax with `.excalidraw` extension is recognized as a drawing node. On serialize, the drawing node outputs the image reference syntax.

**Why sidecar, not inline:**

- Excalidraw scenes can be 10-100KB of JSON — embedding in markdown would bloat files
- The `.excalidraw` format is a recognized standard — other tools can open these files
- Follows the existing pattern used by comments (`.notesage/comments/`)

### SVG Preview Generation

When the user finishes editing a drawing (clicks away or presses Escape):

1. Excalidraw's `exportToSvg()` generates an SVG string
2. The SVG is cached in a `Map<drawingId, string>` in the extension's storage
3. The node view switches from the Excalidraw editor to the static SVG preview
4. The SVG is also written to `.notesage/drawings/<drawingId>.svg` for PDF export

### Edit/Preview Toggle

**Preview mode (default):** The drawing renders as a static SVG image. Shows a subtle border and a pencil icon overlay on hover indicating it's editable.

**Edit mode (on click):** The SVG is replaced with the full Excalidraw React component. The editor takes the full width of the content area with a fixed height (resizable by dragging the bottom edge). A toolbar appears above with Excalidraw's built-in tools.

**Exiting edit mode:** Click outside the drawing, press Escape, or click a "Done" button. The Excalidraw scene is saved to the sidecar file and the SVG preview is regenerated.

### PDF Export

The Typst converter reads the SVG file from `.notesage/drawings/<drawingId>.svg` and includes it via Typst's `image()` function. SVG renders at full quality at any scale.

If the SVG file doesn't exist (drawing was never previewed), the export pipeline calls Excalidraw's `exportToSvg()` on-demand via a Tauri command that loads the `.excalidraw` JSON.

### Data Flow

```
User clicks /drawing or toolbar button
  → Insert Drawing node with new UUID
  → Create empty .excalidraw file
  → Open Excalidraw editor inline

User draws shapes, arrows, text
  → Excalidraw manages its own state

User clicks outside / presses Escape
  → Save scene JSON to .notesage/drawings/<id>.excalidraw
  → Export SVG to .notesage/drawings/<id>.svg
  → Switch node view to SVG preview

User clicks the preview
  → Load scene JSON from sidecar
  → Open Excalidraw editor with the scene

PDF export
  → Read .svg file → Typst image()
```

## UI/UX

### Inserting a Drawing

- **Slash command:** `/drawing` inserts an empty drawing block and opens the editor immediately
- **Toolbar:** Add a drawing button (using the `pencil` Lucide icon) to the toolbar, after the image button

### Preview Appearance

```
┌─────────────────────────────────────────────────┐
│                                                 │
│         [SVG rendering of the drawing]          │
│                                                 │
│                                        ✏️ Edit  │
└─────────────────────────────────────────────────┘
```

- Subtle border (`border-border`), rounded corners
- "Edit" label with pencil icon appears on hover (bottom-right corner)
- Full editor content width
- Height determined by the drawing content (with a minimum of 200px)

### Editor Appearance

```
┌─ Drawing ───────────────────────────── Done ────┐
│ [Excalidraw toolbar: shapes, arrows, text, ...]  │
│                                                  │
│              [Drawing canvas]                    │
│                                                  │
│                                                  │
│▼ drag to resize                                  │
└──────────────────────────────────────────────────┘
```

- Header bar with "Drawing" label and "Done" button
- Excalidraw toolbar below the header
- Canvas area filling the block
- Bottom resize handle (drag to change height)
- Subtle shadow/elevation to indicate the active editing state

### Theming

Excalidraw supports theming. Match Notesage's current theme:

- Light mode: Excalidraw's default light theme
- Dark mode: Excalidraw's dark theme
- Background color matches the editor content area

### Deleting a Drawing

Select the drawing block → press Delete/Backspace. Shows a confirmation toast ("Drawing deleted" with undo) since the sidecar file is also removed.

## Data Model

### New Tiptap Extension

```typescript
// src/components/editor/extensions/drawing.ts
interface DrawingAttrs {
  drawingId: string;     // UUID, maps to .notesage/drawings/<id>.excalidraw
  width: number | null;  // null = full width
  height: number;        // pixels, default 400
}
```

### Sidecar File Format

Standard Excalidraw JSON format (`.excalidraw`):

```json
{
  "type": "excalidraw",
  "version": 2,
  "elements": [...],
  "appState": { "viewBackgroundColor": "#ffffff", ... },
  "files": {}
}
```

This is Excalidraw's native format — no custom wrapper needed.

### Markdown Serialization

```markdown
![drawing](/.notesage/drawings/abc123.excalidraw)
```

Uses standard image syntax with the `.excalidraw` extension as the discriminator. The parser detects `.excalidraw` in the src and creates a `Drawing` node instead of an `Image` node.

### New Tauri Commands

```rust
// Read/write .excalidraw sidecar files
// These can use existing read_file/write_file commands — no new commands needed.
// The SVG export happens in the frontend (Excalidraw's exportToSvg is JS-only).
```

No new Tauri commands required. The frontend reads/writes sidecar files using existing `read_file` and `write_file` commands.

## Dependencies

| Dependency | Version | Size | License | Purpose |
| --- | --- | --- | --- | --- |
| `@excalidraw/excalidraw` | latest | \~500KB gzipped | MIT | Drawing engine |

No other new dependencies. Excalidraw bundles its own UI components, icons, and canvas rendering.

## Quality Gates

### Functional

- [ ] `/drawing` slash command inserts an empty drawing block

- [ ] Toolbar button inserts a drawing block

- [ ] Click on preview opens Excalidraw editor inline

- [ ] Click outside / Escape / Done button saves and closes the editor

- [ ] Drawing scene persisted to `.notesage/drawings/<id>.excalidraw`

- [ ] SVG preview generated on save

- [ ] Drawing survives tab switch (sidecar file is the source of truth)

- [ ] Drawing survives app restart (sidecar file reloaded)

- [ ] Delete drawing removes both the node and the sidecar file

- [ ] All Excalidraw tools work: shapes, arrows, text, freehand, connectors

### Markdown Round-Trip

- [ ] Drawing node serializes to `![drawing](/.notesage/drawings/<id>.excalidraw)`

- [ ] Parsing the image syntax with `.excalidraw` extension creates a Drawing node

- [ ] Regular images are not affected

- [ ] Round-trip test passes

### PDF Export

- [ ] Drawings render as SVG images in exported PDFs

- [ ] SVG renders at full quality (vector, not rasterized)

- [ ] Missing SVG files gracefully handled (placeholder or skip)

### Design

- [ ] Preview mode shows clean SVG with hover-to-edit affordance

- [ ] Edit mode has clear visual boundary (header bar, shadow)

- [ ] Excalidraw theme matches Notesage light/dark mode

- [ ] Resize handle works smoothly

- [ ] Transitions between preview and edit mode are smooth

### Testing

- [ ] Unit tests for markdown parse/serialize of drawing nodes

- [ ] Sidecar file read/write integration test

- [ ] All existing markdown round-trip tests continue to pass

## Out of Scope

- **Collaborative drawing** — requires CRDT/real-time sync; future feature
- **Apple Pencil / touch input** — Notesage is desktop-first; Excalidraw has basic touch support but we won't optimize for it
- **Infinite canvas / whiteboard mode** — drawings are inline blocks, not a separate document view
- **Custom shape libraries** — Excalidraw's built-in shapes are sufficient for v1
- **Image import into drawings** — pasting images onto the canvas adds complexity; users can use regular image blocks
- **draw.io integration** — deferred; Excalidraw covers freehand + basic diagrams; draw.io would add UML/ER diagrams later
- **Animated / interactive drawings** — static SVG output only