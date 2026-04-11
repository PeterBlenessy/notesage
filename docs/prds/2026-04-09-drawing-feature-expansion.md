# PRD: Drawing Feature Expansion

|  |  |
| --- | --- |
| **Date** | 2026-04-09 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | Transforms drawing from blank-canvas sketching to professional diagramming with reusable shape libraries and AI-generated Mermaid diagrams |
| **Research** | [drawing-feature-expansion](../research/2026-04-09-drawing-feature-expansion.md) |

## Problem

Notesage embeds Excalidraw as an inline drawing canvas, but the integration only exposes core drawing tools. Two high-value capabilities are disabled or missing:

1. **Shape libraries** -- Every diagram starts from scratch. Users can't load reusable element packs (AWS icons, flowchart symbols, UI wireframes) that Excalidraw natively supports. This is the gap between "whiteboard toy" and "professional diagramming tool."

2. **Structured diagrams** -- There's no text-to-diagram path. Users who need flowcharts, sequence diagrams, or architecture diagrams must draw everything manually. Competitors (Obsidian, Typora, AFFiNE) all support Mermaid code blocks for text-first diagramming, and Notesage's AI chat is well-positioned to generate these.

## Goals

- **G1:** Enable Excalidraw shape libraries with persistence, so users can install and reuse element packs across drawings
- **G2:** Add Mermaid code block rendering as a native editor node with live preview
- **G3:** Bridge Mermaid and Excalidraw with a "Convert to Drawing" action, enabling AI-generated diagrams to become visually editable
- **G4:** Add "Save as Image" export from within the drawing editor for quick PNG/SVG sharing

## Non-Goals

- **draw.io integration** -- Research concluded no competitive signal, high iframe-based complexity, no note-taking competitor uses it
- **Excalidraw collaboration/multiplayer** -- Requires server infrastructure; deferred to post-collaboration phase
- **Excalidraw AI features** -- Requires Excalidraw+ subscription keys; not aligned with local-first philosophy
- **Custom Excalidraw fonts** -- Default fonts work well; low user impact
- **Embeddable iframes in drawings** -- Niche use case for a note editor

## User Stories

- As a developer, I want to install an AWS architecture library into Excalidraw so I can quickly diagram cloud infrastructure in my notes
- As a user, I want to write a Mermaid flowchart in a code block and see it rendered as a diagram inline
- As a user, I want to ask AI to "draw a sequence diagram for this API flow" and get an editable diagram
- As a user, I want to convert a Mermaid diagram into an Excalidraw drawing so I can refine it visually
- As a user, I want to save my drawing as a PNG image to share in Slack or email
- As a user, I want my installed shape libraries to persist across sessions and be available in every drawing

## Technical Approach

### Part 1: Shape Libraries

**Props changes to `DrawingEditor.tsx`:**

Wire up three Excalidraw props that are currently unused:

```typescript
<Excalidraw
  initialData={{
    ...existingInitialData,
    libraryItems: loadedLibraryItems,  // NEW: persisted library
  }}
  onLibraryChange={handleLibraryChange}  // NEW: persist on change
  UIOptions={{
    canvasActions: { saveAsImage: true, loadScene: false },  // RE-ENABLE saveAsImage
    dockedSidebarBreakpoint: 640,  // RE-ENABLE: shows library panel at >=640px
  }}
/>
```

**Library persistence:**

- Global library file: `~/.notesage/excalidraw-library.json`
- Load on DrawingEditor mount, save on `onLibraryChange` callback
- Tauri commands: reuse existing `read_file` / `write_file` (JSON content)
- No per-project libraries initially -- global is simpler and matches how users think about "my shape collection"

**Library browsing:**

- Excalidraw's built-in library panel (docked sidebar) includes a search and browse UI
- Set `libraryReturnUrl` prop to enable one-click "Add to Excalidraw" installs from [libraries.excalidraw.com](https://libraries.excalidraw.com/)
- This requires Notesage to handle the return URL callback -- Excalidraw redirects back with library data as a URL parameter

**Library return URL handling:**

- When a user clicks "Add to Excalidraw" on libraries.excalidraw.com, the site opens `libraryReturnUrl` with `#addLibrary=<encoded-data>` hash
- Since Notesage is a desktop app (not a web page), this redirect won't work directly
- Two approaches:
  - **A (recommended):** Register a custom URL scheme (`notesage://library?data=...`) via Tauri's deep link plugin. The website redirects to this URL, Tauri intercepts it, and the frontend loads the library data.
  - **B (simpler fallback):** Users download `.excalidrawlib` files manually and import via a file picker button in the drawing editor header. Skip the return URL entirely.
- Start with approach B (file import button); add deep link support as a follow-up if there's demand.

### Part 2: Mermaid Code Block Rendering

**New Tiptap extension: `mermaid-block.ts`**

A node extension that renders Mermaid syntax as an inline SVG diagram:

- **Node type:** `mermaidBlock` (block group, atom: false -- editable content)
- **Markdown round-trip:** Standard fenced code block with `mermaid` language tag -- no custom syntax needed, `prosemirror-markdown` already handles code blocks
- **Rendering:** `ReactNodeViewRenderer` with a split view:
  - Code editing area (CodeMirror or plain textarea)
  - Live SVG preview rendered by the `mermaid` npm package
- **Theme:** Mermaid supports themes (`default`, `dark`, `neutral`). Use `neutral` for both modes to match Notesage's greyscale palette.
- **Error handling:** Invalid syntax shows a red error message below the code area instead of the preview

**Mermaid package:**

- Add `mermaid` npm package (~1.5MB, but it's tree-shakeable and only loaded when a mermaid block is present)
- Lazy-load via dynamic `import()` on first render, same pattern as Excalidraw
- Use `mermaid.render()` API to produce SVG from syntax

**Supported diagram types (via Mermaid):**

- Flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, Gantt charts, pie charts, mindmaps, timeline, user journey, git graphs

### Part 3: Mermaid-to-Excalidraw Conversion

**"Convert to Drawing" action on mermaid blocks:**

- Toolbar button (or right-click context menu) on mermaid code blocks: "Open as Drawing"
- Uses `@excalidraw/mermaid-to-excalidraw` package to convert Mermaid syntax to Excalidraw elements
- Creates a new drawing node, replacing the mermaid block, with the converted elements pre-loaded
- Currently only flowcharts produce editable Excalidraw shapes; other types render as embedded images (this is a limitation of the conversion library, not our code)

**AI integration:**

- No special code needed -- AI models already generate Mermaid when asked for diagrams
- The mermaid code block renders inline, and the user can optionally convert to a drawing
- Could add a system prompt hint: "When asked to create diagrams, use mermaid code blocks"

### Part 4: Save as Image

**Re-enable `saveAsImage` in Excalidraw UIOptions:**

```typescript
canvasActions: { saveAsImage: true, loadScene: false }
```

This restores Excalidraw's built-in "Save as Image" dialog, which exports PNG/SVG with configurable background, padding, and scale. No custom code needed -- Excalidraw handles the file save dialog natively.

## UI/UX

### Drawing Editor (updated)

- **Library panel:** Appears as a docked sidebar on the left when the editor is wide enough (>=640px). On narrow widths, accessible via the hamburger menu. Contains the user's installed library items with search.
- **Import library button:** Small button in the drawing editor header bar (next to "Done") with a `Library` icon. Opens a file picker filtered to `.excalidrawlib` files.
- **Save as Image:** Accessible via the Excalidraw hamburger menu (top-left) > "Save as Image". Native Excalidraw dialog.

### Mermaid Code Block

- **Appearance:** Fenced code block with a header bar showing "Mermaid" label and action buttons
- **Split view:** Code on the left/top, SVG preview on the right/bottom (toggle between split and preview-only)
- **Header actions:** "Preview" toggle, "Copy", "Convert to Drawing" (Pencil icon)
- **Empty state:** Placeholder text with example syntax
- **Error state:** Red error banner replacing the preview area
- **Dark mode:** Mermaid `neutral` theme with CSS variable overrides for background

### Slash Command

- Add `/mermaid` to the slash command menu: "Mermaid diagram -- Insert a text-based diagram"
- Inserts an empty mermaid code block with placeholder content:
  ```
  graph TD
      A[Start] --> B{Decision}
      B -->|Yes| C[Result]
      B -->|No| D[Other]
  ```

## Data Model

### Library Storage

```typescript
// ~/.notesage/excalidraw-library.json
// Standard Excalidraw library format — array of LibraryItem
interface ExcalidrawLibraryItem {
  id: string;
  status: "published" | "unpublished";
  elements: ExcalidrawElement[];
  name?: string;
  created: number;
}
```

No new Zustand store needed -- library items are loaded from disk on DrawingEditor mount and saved on change. The Excalidraw component manages the in-memory state.

### Mermaid Block

No new data model -- uses existing ProseMirror code block node with `language: "mermaid"`. The markdown serialization is standard fenced code blocks. No sidecar files.

### New Dependencies

| Package | Purpose | Size |
| --- | --- | --- |
| `mermaid` | Mermaid diagram rendering | ~1.5MB (lazy-loaded) |
| `@excalidraw/mermaid-to-excalidraw` | Mermaid → Excalidraw conversion | ~50KB |

### Tauri Commands

No new Tauri commands needed. Library files use existing `read_file`, `write_file`, `path_exists`, and `create_directory`.

## Dependencies

- `@excalidraw/excalidraw` ^0.18.0 (already installed)
- `mermaid` (new -- install via `pnpm add mermaid`)
- `@excalidraw/mermaid-to-excalidraw` (new -- install via `pnpm add @excalidraw/mermaid-to-excalidraw`)

## Quality Gates

### Functional

- [ ] Shape libraries: can import a `.excalidrawlib` file via file picker
- [ ] Shape libraries: installed library items appear in the Excalidraw sidebar panel
- [ ] Shape libraries: library items persist across editor close/reopen and app restart
- [ ] Shape libraries: can drag library items onto the canvas
- [ ] Shape libraries: can add custom elements to the library from the canvas
- [ ] Save as Image: can export drawing as PNG/SVG via Excalidraw's built-in dialog
- [ ] Mermaid: `/mermaid` slash command inserts a mermaid code block with placeholder
- [ ] Mermaid: editing mermaid syntax updates the preview in real-time
- [ ] Mermaid: invalid syntax shows error message, doesn't crash
- [ ] Mermaid: mermaid blocks round-trip through markdown (parse → edit → serialize → identical)
- [ ] Mermaid: all major diagram types render (flowchart, sequence, class, state, ER, Gantt, pie)
- [ ] Mermaid: diagrams render correctly in both light and dark mode
- [ ] Convert to Drawing: "Open as Drawing" on a mermaid flowchart creates an editable Excalidraw drawing
- [ ] Convert to Drawing: non-flowchart diagrams convert as embedded images (graceful degradation)

### Design

- [ ] Library panel integrates cleanly with the drawing editor chrome (no visual clash)
- [ ] Mermaid block looks consistent with existing code blocks (similar header bar, border-radius, background)
- [ ] Mermaid preview SVG is crisp and properly sized (no overflow, no tiny rendering)
- [ ] Mermaid error state is clear but not alarming (muted red, not bright)
- [ ] Both light and dark mode look polished for all new UI

### Testing

- [ ] Unit tests for library load/save (mock Tauri IPC)
- [ ] Unit tests for mermaid block markdown round-trip
- [ ] Mermaid rendering with various diagram types (snapshot or visual)
- [ ] Mermaid-to-Excalidraw conversion for flowcharts
- [ ] All existing drawing tests still pass

## Out of Scope

- **Per-project libraries** -- Start with global only; add per-project override later if needed
- **Deep link URL scheme for library install** -- Start with file import; add `notesage://` deep link later
- **Mermaid export to PDF/DOCX** -- The existing markdown-to-typst and markdown-to-docx pipelines would need Mermaid awareness; defer to a follow-up
- **Mermaid AI auto-generation** -- No special tooling needed; models already generate Mermaid when asked. A system prompt hint could be added later.
- **Bidirectional Excalidraw-to-Mermaid** -- Converting a drawing back to Mermaid syntax is not supported by any existing library
- **Collaborative drawing** -- Requires CRDT/WebSocket infrastructure; separate initiative
