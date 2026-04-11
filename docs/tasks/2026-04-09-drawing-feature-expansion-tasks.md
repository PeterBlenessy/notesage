# Drawing Feature Expansion — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-09 |
| **Status** | Complete |
| **PRD** | [drawing-feature-expansion](../prds/2026-04-09-drawing-feature-expansion.md) |
| **Total** | 9 tasks: 4S, 4M, 1L |
| **Suggested order** | Save as Image (#1) → Libraries (#2-#5) → Mermaid polish (#6-#7) → Convert to Drawing (#8) → Tests (#9) |

**Note:** Mermaid code block rendering is already implemented (extension `mermaid.ts`, preview component `MermaidPreview.tsx`, CSS in `editor.css`, markdown preprocessor in `markdown.ts`, `mermaid` package installed). This task list covers the remaining gaps identified in the PRD.

---

### #1 — Re-enable Save as Image in Excalidraw ✅

**Description:** Flip `saveAsImage: false` to `true` in the Excalidraw `UIOptions.canvasActions` prop. This restores Excalidraw's built-in "Save as Image" dialog (PNG/SVG export with background, padding, and scale options). No custom code needed.

**Complexity:** S
**Category:** frontend
**Dependencies:** None
**Files:**
- `src/components/editor/DrawingEditor.tsx` — change `saveAsImage: false` → `true`

---

### #2 — Add library persistence functions to drawing-storage ✅

**Description:** Add functions to load and save the global Excalidraw library file (`~/.notesage/excalidraw-library.json`). The library is a JSON array of `LibraryItem` objects (standard Excalidraw format). Uses existing Tauri `read_file` / `write_file` / `path_exists` / `create_directory` commands — no new backend work.

**Acceptance criteria:**
- `loadLibrary()` returns parsed library items array (or empty array if file doesn't exist)
- `saveLibrary(items)` writes the array to disk, creating `~/.notesage/` if needed
- `importLibraryFile(filePath)` reads a `.excalidrawlib` file, parses it, and merges items into the global library (dedup by ID)

**Complexity:** M
**Category:** frontend
**Dependencies:** None
**Files:**
- `src/lib/drawing-storage.ts` — add `loadLibrary()`, `saveLibrary()`, `importLibraryFile()`

---

### #3 — Wire up library props in DrawingEditor ✅

**Description:** Pass library items to Excalidraw via `initialData.libraryItems` and persist changes via `onLibraryChange`. Re-enable the docked sidebar by setting `dockedSidebarBreakpoint: 640`.

**Acceptance criteria:**
- On mount, load library items from disk and pass to `initialData`
- On `onLibraryChange`, debounce-save to disk (500ms)
- Library panel visible in the Excalidraw sidebar when editor width >= 640px
- Library items persist across editor close/reopen

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #2
**Files:**
- `src/components/editor/DrawingEditor.tsx` — add library loading, `onLibraryChange` handler, update `UIOptions.dockedSidebarBreakpoint`

---

### #4 — Add "Import Library" button to drawing editor header ✅

**Description:** Add a button in the drawing editor header bar (next to "Done") that opens a native file picker dialog filtered to `.excalidrawlib` files. Selected library file is merged into the global library via `importLibraryFile()` and the Excalidraw component is updated via `excalidrawAPI.updateLibrary()`.

**Acceptance criteria:**
- Button with `Library` (or `FolderOpen`) icon appears in the header bar
- Clicking opens Tauri's native file dialog filtered to `.excalidrawlib`
- Imported items appear immediately in the library panel
- Toast confirms "Library imported (N items)"
- Duplicate items (by ID) are not added twice

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #2, #3
**Files:**
- `src/components/editor/DrawingEditor.tsx` — add import button + handler
- `src/styles/editor.css` — style the button consistent with `drawing-done-button`

---

### #5 — Expand ExcalidrawAPI type for library methods ✅

**Description:** The current `ExcalidrawAPI` type in `DrawingEditor.tsx` is a minimal inline type. Add the `updateLibrary` method and `libraryItems` to the type so the import button (#4) and library persistence (#3) can call them without `as unknown` casts.

**Complexity:** S
**Category:** frontend
**Dependencies:** None
**Files:**
- `src/components/editor/DrawingEditor.tsx` — expand `ExcalidrawAPI` type with `updateLibrary`, `setLibraryItems`

---

### #6 — Add /mermaid slash command ✅

**Description:** Add a "Mermaid diagram" entry to the slash command menu. The Mermaid extension and rendering are already implemented — this task just adds the menu entry to make it discoverable.

**Acceptance criteria:**
- `/mermaid` appears in the slash command menu with a diagram icon
- Selecting it inserts a mermaid block with placeholder content (flowchart example)
- The inserted block renders correctly with the live preview

**Complexity:** S
**Category:** frontend
**Dependencies:** None
**Files:**
- `src/components/editor/extensions/slash-command.tsx` — add entry after "Chart", using the `insertMermaidBlock` command or `insertContent`

---

### #7 — Add insertMermaidBlock command to MermaidBlock extension ✅

**Description:** Add a Tiptap command `insertMermaidBlock` to the MermaidBlock extension so the slash command (#6) and the "Convert to Drawing" action (#8) can programmatically insert mermaid blocks. Currently the extension has no `addCommands()`.

**Acceptance criteria:**
- `editor.chain().focus().insertMermaidBlock({ source }).run()` inserts a mermaid block with the given source
- Default source is a simple flowchart placeholder if none provided

**Complexity:** S
**Category:** frontend
**Dependencies:** None
**Files:**
- `src/components/editor/extensions/mermaid.ts` — add `addCommands()` with `insertMermaidBlock`

---

### #8 — Add "Convert to Drawing" action on Mermaid blocks ✅

**Description:** Add a button to the MermaidPreview component that converts the Mermaid diagram into an editable Excalidraw drawing node. Uses `@excalidraw/mermaid-to-excalidraw` to convert the Mermaid source into Excalidraw elements, then replaces the mermaid block with a drawing node pre-loaded with those elements.

**Acceptance criteria:**
- "Convert to Drawing" button (Pencil icon) appears in the mermaid preview header/toolbar
- Clicking converts a flowchart to native Excalidraw shapes (editable, not a raster image)
- Non-flowchart diagrams either: (a) convert to an embedded image in Excalidraw, or (b) show a toast explaining the limitation
- The mermaid block is replaced by the drawing node in the document
- The converted drawing's JSON is stored inline via `drawingJson` attribute (current storage model)

**Complexity:** L
**Category:** frontend
**Dependencies:** Depends on #7
**Files:**
- `package.json` — add `@excalidraw/mermaid-to-excalidraw` dependency
- `src/components/editor/MermaidPreview.tsx` — add convert button + handler
- `src/lib/mermaid-to-drawing.ts` (new) — conversion utility wrapping `parseMermaidToExcalidraw`

---

### #9 — Tests for library persistence and mermaid slash command ✅

**Description:** Add unit tests for the new library persistence functions and verify the mermaid slash command integration.

**Acceptance criteria:**
- Tests for `loadLibrary()` / `saveLibrary()` / `importLibraryFile()` with mocked Tauri IPC
- Test that `importLibraryFile` deduplicates by ID
- Test for `insertMermaidBlock` command (inserts correct node type with source attribute)
- Existing drawing and mermaid round-trip tests still pass

**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #2, #7
**Files:**
- `src/lib/__tests__/drawing-storage.test.ts` (new or extend existing)
- `src/components/editor/extensions/__tests__/mermaid.test.ts` (new or extend existing)
