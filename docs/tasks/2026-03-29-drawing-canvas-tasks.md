# Drawing Canvas — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-03-29 |
| **Status** | In progress |
| **PRD** | [drawing-canvas](../prds/2026-03-29-drawing-canvas.md) |
| **Research** | [rich-content-editor-features](../research/2026-03-29-rich-content-editor-features.md) |
| **Total** | 14 tasks: 4S, 6M, 4L |
| **Suggested order** | Setup (#1) → Extension (#2) → Sidecar (#3) → NodeView (#4-#5) → Markdown (#6-#7) → UX (#8-#10) → PDF (#11) → Tests (#12-#13) → Polish (#14) |

### Risks & Open Questions

- **Bundle size:** Excalidraw adds \~500KB gzipped. Acceptable for a desktop Tauri app, but verify the Vite build handles the dynamic import correctly and doesn't break code splitting.
- **React NodeView precedent:** The codebase has no existing `ReactNodeViewRenderer` usage — all current node views use raw DOM. The Excalidraw editor is a React component, so the Drawing node will be the first to use `ReactNodeViewRenderer` from `@tiptap/react`. This is a new pattern that needs careful integration.
- **Lazy loading:** Excalidraw should be lazily imported (`React.lazy` + `Suspense`) to avoid loading it until the user actually opens a drawing. The SVG preview doesn't need Excalidraw.
- **tiptap-markdown image interception:** The Drawing node uses image syntax (`![drawing](path.excalidraw)`) but must intercept the parse before tiptap-markdown creates an `Image` node. May need a markdown preprocessor (like callouts) or a `parseHTML` rule that wins over the default image rule.
- **Sidecar cleanup:** When a drawing block is deleted, the sidecar `.excalidraw` and `.svg` files need to be cleaned up. Need to hook into ProseMirror transactions to detect node removal.
- **Undo/redo:** Since the drawing state lives in the sidecar file (not in ProseMirror), undo/redo in the main editor only affects the node's presence, not the drawing content. Excalidraw has its own undo/redo while in edit mode.

---

### #1 — Install Excalidraw and configure Vite ✅

**Description:** Add `@excalidraw/excalidraw` to `package.json`. Configure Vite to handle Excalidraw's assets (fonts, icons) and verify the dev server and production build work. Excalidraw has known Vite configuration requirements — may need to add it to `optimizeDeps.include` or configure asset handling.

Verify the build completes without errors and the bundle size increase is acceptable.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `package.json` — add `@excalidraw/excalidraw`
- `vite.config.ts` — add any required Excalidraw configuration (optimizeDeps, asset handling)

---

### #2 — Create Drawing Tiptap node extension (schema only) ✅

**Description:** Create the `Drawing` node extension with the ProseMirror schema definition. This task covers the node type, attrs (`drawingId`, `width`, `height`), `atom: true`, `parseHTML`, `renderHTML`, and basic commands (`insertDrawing`, `deleteDrawing`). Do NOT implement the NodeView yet — just the schema and a placeholder `<div>` render.

Register the extension in `useEditor.ts` and export from `extensions/index.ts`.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/components/editor/extensions/drawing.ts` — new file
- `src/components/editor/extensions/index.ts` — export `Drawing`
- `src/hooks/useEditor.ts` — register in extensions array

---

### #3 — Implement drawing sidecar file operations ✅

**Description:** Create a `drawing-store.ts` Zustand store (or utility module) that manages reading, writing, and deleting `.excalidraw` and `.svg` sidecar files. Follow the `comment-store.ts` pattern for `.notesage/drawings/` directory management.

Functions needed:

- `loadDrawing(drawingId, projectRoot)` — read `.excalidraw` JSON, return parsed scene
- `saveDrawing(drawingId, projectRoot, sceneData)` — write `.excalidraw` JSON, ensure directory exists
- `saveSvgPreview(drawingId, projectRoot, svgString)` — write `.svg` file
- `deleteDrawing(drawingId, projectRoot)` — remove both `.excalidraw` and `.svg` files
- `drawingExists(drawingId, projectRoot)` — check if sidecar file exists

All file operations via `tauriApi` (existing `read_file`, `write_file`, `delete_path`, `path_exists`).

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/stores/drawing-store.ts` — new file (or `src/lib/drawing-storage.ts` if pure utility)

---

### #4 — Implement SVG preview NodeView ✅

**Description:** Create the preview-mode NodeView for the Drawing node using `ReactNodeViewRenderer` from `@tiptap/react`. When the drawing has a saved SVG, display it as an inline image. When no SVG exists (empty/new drawing), show a placeholder with a "Click to draw" message and pencil icon.

Features:

- Display SVG preview (load from sidecar file on mount)
- Subtle border, rounded corners matching the app's design
- Hover state: show pencil icon + "Edit" label (bottom-right)
- Click handler to enter edit mode (dispatch a custom transaction or use extension storage)
- Minimum height 200px
- Respect `width`/`height` attrs

This task does NOT include the Excalidraw editor — just the static preview and click-to-edit trigger.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #2, #3 **Files:**

- `src/components/editor/extensions/drawing.ts` — add `addNodeView()` with `ReactNodeViewRenderer`
- `src/components/editor/DrawingPreview.tsx` — new React component for the preview
- `src/styles/editor.css` — add drawing preview styles

---

### #5 — Implement Excalidraw editor overlay

**Description:** Create the edit-mode component that replaces the SVG preview when the user clicks to edit. Lazy-load `@excalidraw/excalidraw` via `React.lazy` + `Suspense` to avoid loading the 500KB bundle until needed.

Features:

- Header bar with "Drawing" label and "Done" button
- Full Excalidraw editor with all tools (shapes, arrows, text, freehand, connectors)
- Theme matching (light/dark based on Notesage's current theme)
- Bottom resize handle (drag to change height)
- Background color matching the editor content area
- Exit triggers: click "Done", press Escape, or click outside the drawing block
- On exit: save scene JSON to sidecar, export SVG preview, switch back to preview mode

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #1, #3, #4 **Files:**

- `src/components/editor/DrawingEditor.tsx` — new React component (lazy-loaded Excalidraw wrapper)
- `src/components/editor/DrawingPreview.tsx` — add edit/preview toggle logic
- `src/styles/editor.css` — add drawing editor styles (header, resize handle, shadow)

---

### #6 — Add drawing markdown parsing ✅

**Description:** Intercept markdown image syntax where the src ends with `.excalidraw` and create a `Drawing` node instead of an `Image` node. The PRD specifies the syntax: `![drawing](/.notesage/drawings/abc123.excalidraw)`.

Two approaches (choose the simpler one that works):

1. **Preprocessor in** `markdown.ts`**:** Convert `![drawing](path.excalidraw)` to a custom HTML element `<div data-drawing-id="abc123"></div>` before tiptap-markdown parses it. The Drawing node's `parseHTML` matches this element.
2. **Parse priority:** Configure the Drawing extension's `parseHTML` to match `<img>` elements whose `src` ends with `.excalidraw` with higher priority than the Image extension.

Extract the `drawingId` from the path (filename without extension).

Regular images (non-`.excalidraw`) must not be affected.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #2 **Files:**

- `src/lib/markdown.ts` — add preprocessor (if approach 1)
- `src/components/editor/extensions/drawing.ts` — add `parseHTML` or `addStorage() → markdown.parse`

---

### #7 — Add drawing markdown serialization ✅

**Description:** Serialize the `Drawing` node back to the Obsidian-compatible image syntax:

```markdown
![drawing](/.notesage/drawings/<drawingId>.excalidraw)
```

Use the `addStorage() → markdown.serialize` pattern (same as `Table.extend()` in `useEditor.ts:82-91`). The serializer outputs the image reference syntax with the sidecar path.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #2 **Files:**

- `src/components/editor/extensions/drawing.ts` — add `addStorage()` with `markdown.serialize`

---

### #8 — Add drawing slash command

**Description:** Add a `/drawing` entry to the slash command list. Selecting it inserts a new Drawing node with a generated UUID, creates an empty `.excalidraw` sidecar file, and immediately opens the Excalidraw editor.

Follow the existing `CommandItem` pattern in `slash-command.tsx`. Use the `pencil` Lucide icon.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #2, #3, #5 **Files:**

- `src/components/editor/extensions/slash-command.tsx` — add drawing command to the `commands` array

---

### #9 — Add drawing toolbar button

**Description:** Add a drawing button to the top toolbar (after the image button), using the `pencil` Lucide icon. Clicking inserts a new drawing block and opens the editor — same behavior as the slash command.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #2, #3, #5 **Files:**

- `src/components/editor/Toolbar.tsx` — add drawing button

---

### #10 — Implement drawing deletion with sidecar cleanup ✅

**Description:** When a Drawing node is removed from the document (via Backspace/Delete or undo), delete the associated sidecar files (`.excalidraw` and `.svg`). Show a confirmation toast ("Drawing deleted" with undo) since the deletion is destructive.

Hook into ProseMirror transactions to detect when a Drawing node is removed from the document. On removal, queue the sidecar cleanup. If the user undoes (the node reappears), cancel the cleanup.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #2, #3 **Files:**

- `src/components/editor/extensions/drawing.ts` — add transaction watcher for node removal
- `src/components/editor/DrawingPreview.tsx` — toast + undo logic

---

### #11 — Add drawing rendering in Typst/PDF export ✅

**Description:** Extend the Typst converter to handle drawings in PDF export. When the converter encounters a markdown image with `.excalidraw` extension, read the corresponding `.svg` file from the sidecar directory and include it via Typst's `image()` function.

The SVG needs to be available to the Typst `World` implementation. Either:

1. Read the SVG content in the `markdown_to_typst` converter and embed it inline
2. Make the `NotesageWorld` resolve paths under `.notesage/drawings/`

If the `.svg` file doesn't exist, emit a placeholder text block or skip gracefully.

**Complexity:** L **Category:** backend **Dependencies:** None (parallelizable with frontend work) **Files:**

- `src-tauri/src/export/markdown_to_typst.rs` — detect `.excalidraw` image links, substitute SVG
- `src-tauri/src/export/typst_world.rs` — possibly extend file resolution for sidecar paths
- `src-tauri/src/commands/export.rs` — pass project root for sidecar resolution

---

### #12 — Add drawing round-trip test fixtures

**Description:** Create markdown test fixtures for drawings and verify round-trip parsing:

- Single drawing block
- Drawing with custom dimensions
- Drawing mixed with regular images (no false positives)
- Document with multiple drawings

Verify all existing round-trip tests still pass.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #6, #7 **Files:**

- `tests/fixtures/drawings.md` — new fixture file

---

### #13 — Add unit and integration tests

**Description:** Write tests covering:

- Drawing node schema (attrs, commands)
- Markdown preprocessor: `.excalidraw` image syntax → Drawing node, regular images unaffected
- Markdown serializer: Drawing node → `![drawing](path.excalidraw)` syntax
- Sidecar operations: load, save, delete, existence check (mock tauriApi)
- SVG preview: renders SVG, shows placeholder for empty drawings
- Deletion: sidecar cleanup triggered on node removal

**Complexity:** L **Category:** both **Dependencies:** Depends on #4, #5, #6, #7, #10 **Files:**

- `src/components/editor/extensions/__tests__/drawing.test.ts` — new test file
- `src/stores/__tests__/drawing-store.test.ts` — new test file (or `src/lib/__tests__/drawing-storage.test.ts`)

---

### #14 — Polish and visual QA

**Description:** Final polish pass:

- SVG preview appearance in both light and dark mode
- Excalidraw theme matching (verify light/dark sync)
- Smooth transitions between preview and edit mode
- Resize handle feels natural
- Drawing block spacing consistent with other block elements
- Test with various drawing sizes (small, large, wide, tall)
- Verify no console errors or React warnings from Excalidraw integration

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1-#13 **Files:**

- `src/styles/editor.css` — tune styles
- `src/components/editor/DrawingEditor.tsx` — theme and transition adjustments
- `src/components/editor/DrawingPreview.tsx` — visual refinements