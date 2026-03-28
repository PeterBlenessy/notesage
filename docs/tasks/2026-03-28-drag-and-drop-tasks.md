# Drag and Drop Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-28 |
| **Status** | Completed |
| **PRD** | [drag-and-drop](../prds/2026-03-28-drag-and-drop.md) |
| **Total** | 10 tasks: 3S, 4M, 3L |
| **Suggested order** | State (#1) → Tab reorder (#2-#3) → Editor drop (#4-#5) → Shared util (#6) → Sidebar external drop (#7-#9) → Docs (#10) |

**Risks:**

- Tauri v2's WKWebView on macOS may not expose `file.path` on `dataTransfer.files` from native drops — may need Tauri's `onDragDropEvent` API instead of HTML5 DnD for external file paths
- HTML5 `dragenter`/`dragleave` fire on child elements, causing flicker — the existing sidebar code uses a `dragCounter` ref pattern to handle this; reuse it for the editor overlay
- Tab reorder DnD must not interfere with middle-click-to-close or the existing tab click handlers

---

## Feature 1: Tab Reordering

### #1 — Add `reorderTab` action to editor-store ✅

**Description:** Add `reorderTab(fromIndex: number, toIndex: number)` to `editor-store.ts`. It splices the tab out of `fromIndex` and inserts it at `toIndex`. No-op if indices are equal. The tabs array is already persisted via Zustand persist, so the new order survives app restarts. Write a unit test: reorder in a 4-tab array, verify order and active tab unchanged.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/stores/editor-store.ts`, `src/stores/__tests__/editor-store.test.ts`

---

### #2 — Add drag source and drop target to TabBar ✅

**Description:** In `TabBar.tsx`, make each tab `draggable={true}`. On `onDragStart`, set `e.dataTransfer` with a custom MIME (`application/x-notesage-tab`) containing the tab ID and index. On `onDragOver`, call `preventDefault()` and calculate whether the cursor is in the left or right half of the tab to determine the insertion side. Track the insertion position in component state (`dropIndicatorIndex`). On `onDrop`, read the source tab index, call `reorderTab()`. On `onDragEnd`, clear the indicator state. Ignore drops that don't have the tab MIME (external files, sidebar items). Reduce opacity of the dragged tab to 0.5 via a `isDragging` state.

**Complexity:** L | **Category:** frontend | **Dependencies:** #1

**Files:** `src/components/tabs/TabBar.tsx`

---

### #3 — Style tab drag insertion indicator ✅

**Description:** Add CSS for the tab drag insertion indicator. When `dropIndicatorIndex` is set, render a 2px-wide vertical line in `--color-primary` at the indicated gap between tabs. Use a `::before` pseudo-element on the target tab, or a dedicated `<div>` spacer. The indicator should be the full height of the tab bar. Ensure it looks correct in both light and dark mode.

**Complexity:** S | **Category:** frontend | **Dependencies:** #2

**Files:** `src/components/tabs/TabBar.tsx` (inline styles or CSS module)

---

## Feature 2: External File Drop on Editor

> **Skipped (2026-03-28):** Tauri v2's `dragDropEnabled` setting is mutually exclusive — when `true`, Tauri intercepts all native drops (providing file paths) but breaks HTML5 DnD entirely (ProseMirror text drag stops working). When `false`, HTML5 DnD works but WKWebView doesn't expose `File.path` on `dataTransfer.files`, so we can't get file paths. There is an [open Tauri feature request](https://github.com/tauri-apps/tauri/issues/13189) to toggle `dragDropEnabled` at runtime which would solve this. Revisit when Tauri ships that API.

### ~~#4 — Add external file drop handler to Editor \[SKIPPED\]~~

**Description:** In `Editor.tsx`, add `onDragOver`, `onDragEnter`, `onDragLeave`, and `onDrop` handlers to the editor scroll container (`scrollAreaRef`). On `dragenter`/`dragover`: check if `e.dataTransfer.types` includes `"Files"` — if not, ignore (allows internal Notesage drags to pass through). Use the `dragCounter` ref pattern from `FileTreeItem.tsx` to prevent child-element flicker. Set `isDragOverEditor` state for the overlay. On `drop`: extract file paths. In Tauri v2 WKWebView, `File.path` may not be available — try HTML5 first, and if paths are empty, fall back to Tauri's `onDragDropEvent` from `@tauri-apps/api/webviewWindow`. Filter files to `OPENABLE_EXTENSIONS` (import from `MarkdownContent.tsx` or extract to shared util). Call `openTab()` for each valid file. Show toast for unsupported types: "Cannot open \[name\] — unsupported file type".

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/editor/Editor.tsx`

---

### ~~#5 — Add editor drop overlay UI \[SKIPPED\]~~

**Description:** When `isDragOverEditor` is true, render a full-area overlay on top of the editor scroll container. Style: dashed 2px border (`--color-border`), centered text "Drop files to open" in `text-muted-foreground`, background `--color-muted` at 50% opacity. Fade in via `transition-opacity duration-150`. Use `pointer-events-none` on the overlay text so drop events still reach the container. Use `position: absolute` + `inset-0` inside the scroll area's relative parent. Only show for external file drags, not internal Notesage drags.

**Complexity:** M | **Category:** frontend | **Dependencies:** #4

**Files:** `src/components/editor/Editor.tsx`, `src/styles/editor.css`

---

## Feature 3: External File Drop on Sidebar

> **Skipped (2026-03-28):** Same Tauri v2 `dragDropEnabled` limitation as Feature 2. External file drops require file paths which are only available via Tauri's native drag handler, but enabling it breaks all HTML5 DnD (sidebar internal drag, ProseMirror text drag). Blocked on [tauri-apps/tauri#13189](https://github.com/tauri-apps/tauri/issues/13189).

### ~~#6 — Extract external drop detection utility~~

**Description:** Add `parseExternalFileDrop(e: React.DragEvent): string[]` to `src/lib/drag-utils.ts`. Returns an array of absolute file paths from an external drop event (Finder/Desktop). Returns empty array for internal Notesage drags or if no files detected. Handles both HTML5 `e.dataTransfer.files` (with `File.path` — Tauri-specific) and `text/uri-list` fallback. This utility will be shared by the sidebar drop handlers and could be reused by the editor drop handler.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/lib/drag-utils.ts`

---

### ~~#7 — Create ImportFileDialog component~~

**Description:** Create `src/components/sidebar/ImportFileDialog.tsx` using shadcn/ui `AlertDialog`. Props: `files: string[]` (source paths), `destinationPath: string`, `destinationName: string`, `onComplete: () => void`. Title: "Import \[filename\]" for single file, "Import \[N\] files" for multiple. Body: "Choose how to add to \[destination name\]". Three actions: "Move here" (primary), "Copy here" (secondary), Cancel. On Move: call `rename_path` per file. On Copy: call `copy_file` for files, `copy_directory` for directories. Before each operation, check `pathExists` — skip with toast on conflict. After all operations, call `refreshFileTree` and `onComplete`. Show success toast with count.

**Complexity:** L | **Category:** frontend | **Dependencies:** #6

**Files:** new: `src/components/sidebar/ImportFileDialog.tsx`

---

### ~~#8 — Extend FileTreeItem drop handler for external files~~

**Description:** In `FileTreeItem.tsx` `handleDrop`, after the existing `parseNotesageDrop()` check, add a fallback: call `parseExternalFileDrop(e)`. If it returns files, and the current entry is a directory, set state to show the `ImportFileDialog` with the entry path as destination. If the entry is a file, use the entry's parent directory as destination. The dialog state (`importFiles`, `importDestination`) can be local component state. Render `ImportFileDialog` conditionally.

**Complexity:** M | **Category:** frontend | **Dependencies:** #6, #7

**Files:** `src/components/sidebar/FileTreeItem.tsx`

---

### ~~#9 — Extend ExplorerFolderItem and ProjectItem for external drops~~

**Description:** Apply the same external drop handling pattern from #8 to `ExplorerFolderItem.tsx` and `ProjectItem.tsx`. In each component's `handleDrop`, after the internal drag check, call `parseExternalFileDrop()`. If files returned, show `ImportFileDialog` with the folder/project root as destination. Follow the exact same pattern as #8 to keep consistency.

**Complexity:** M | **Category:** frontend | **Dependencies:** #6, #7

**Files:** `src/components/sidebar/ExplorerFolderItem.tsx`, `src/components/sidebar/ProjectItem.tsx`

---

## Documentation

### #10 — Update docs for drag and drop ✅

**Description:** Update `docs/features/workspace.md` to document all DnD capabilities: sidebar file DnD (existing), tab reordering, external file drop on editor, external file drop on sidebar with Move/Copy. Update `docs/keyboard-shortcuts.md` if any keyboard modifiers are relevant (e.g., hold Option while dragging to force copy). Update the parent PRD `docs/prds/2026-02-28-move-files.md` Phase 2 section to reference the new DnD PRD as implemented.

**Complexity:** S | **Category:** docs | **Dependencies:** #3, #5, #9

**Files:** `docs/features/workspace.md`, `docs/prds/2026-02-28-move-files.md`