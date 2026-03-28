# PRD: Drag and Drop — Tab Reordering & External File Drops

|  |  |
| --- | --- |
| **Date** | 2026-03-28 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | Native-feeling file management and tab organization via drag and drop |
| **Parent** | Extends [move-files Phase 2](2026-02-28-move-files.md) |

## Problem

Notesage has partial drag-and-drop support: files can be dragged between folders in the sidebar (implemented via `drag-utils.ts`, `FileTreeItem.tsx`, `ExplorerFolderItem.tsx`, `ProjectItem.tsx`). But three common DnD interactions are missing:

1. **Tabs can't be reordered** — users must close and re-open files to change tab order
2. **External files can't be dropped onto the editor** — users must use File > Open or the sidebar to open files from Finder
3. **External files can't be dropped onto sidebar folders** — users must use Finder to copy/move files into project folders, then refresh

These are standard desktop app interactions (VS Code, Sublime, Bear all support them). Their absence makes Notesage feel less native.

## Goals

1. Drag tabs to reorder them in the tab bar
2. Drop files from Finder/Desktop onto the editor area to open them as new tabs
3. Drop files from Finder/Desktop onto a sidebar folder to move or copy them into the folder
4. All DnD interactions feel polished with appropriate visual feedback

## Non-Goals

- Drag tabs to split the editor into panes (split view)
- Drag tabs between multiple Notesage windows
- Drag text within or between documents
- Drag files from the sidebar to external apps
- Batch selection (multi-file drag) in the sidebar — existing internal DnD already doesn't support this

## User Stories

- As a user, I want to drag a tab to reorder it in the tab bar, so I can organize my workspace without closing and re-opening files
- As a user, I want to drop a file from Finder onto the editor to open it, so I can quickly open files without navigating the file tree
- As a user, I want to drop files from Finder onto a project folder in the sidebar, so I can import files into my projects without switching to Finder
- As a user, I want to choose between Move and Copy when dropping external files onto a folder, so I don't accidentally move files I intended to keep in their original location

## Technical Approach

### Existing DnD Infrastructure

Internal sidebar DnD is fully implemented:

- `src/lib/drag-utils.ts` — `NOTESAGE_DRAG_MIME` (text/plain for WKWebView compatibility), `NotesageDragPayload`, `parseNotesageDrop()`
- `src/components/sidebar/FileTreeItem.tsx` — `draggable`, `onDragStart`, `onDragEnd`, `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop` with conflict checking, self-drop prevention, ancestor-drop prevention, auto-expand on hover (600ms)
- `src/components/sidebar/ExplorerFolderItem.tsx` — Drop target for folder headers
- `src/components/sidebar/ProjectItem.tsx` — Drop target for project headers

All internal drops call `renamePath()` from `useFileOperations` which handles tab path updates, file tree refresh, and git status refresh.

### Feature 1: Tab Reordering

**Approach:** HTML5 DnD on tab elements in `TabBar.tsx`.

**Drag source:** Each tab button gets `draggable={true}`. `onDragStart` sets a custom MIME with the tab ID. Use a semi-transparent ghost of the tab element via `e.dataTransfer.setDragImage()`.

**Drop target:** Each tab handles `onDragOver` (with `preventDefault()` to allow drop) and `onDrop`. Calculate whether the drop position is to the left or right of the tab's center to determine insertion index.

**Visual feedback:** Show a 2px insertion indicator (vertical line) between tabs at the drop position. Use a CSS class toggled by `onDragEnter`/`onDragLeave` on a spacer element or `::before`/`::after` pseudo-element.

**State update:** Add `reorderTab(fromIndex: number, toIndex: number)` to `editor-store.ts`. This splices the `tabs` array and persists the new order.

**Edge cases:**
- Dragging a tab to its current position is a no-op
- Only internal tab drags accepted (check MIME type)
- External file drops on the tab bar should be ignored (or open as new tab — defer to Feature 2)

### Feature 2: External File Drop on Editor

**Approach:** HTML5 `dragover`/`drop` event handlers on the editor scroll container in `Editor.tsx`.

**Detection:** External file drops have `e.dataTransfer.types` containing `"Files"`. Internal Notesage drags have `text/plain` with a JSON payload — distinguish by checking for `"Files"` type first.

**Drop handling:**
1. Read file paths from `e.dataTransfer.files` (Tauri maps native file drops to `File` objects with `path` property, or use `e.dataTransfer.getData("text/uri-list")`)
2. Filter to supported file types using `OPENABLE_EXTENSIONS` regex (shared from `link-utils.ts` or `MarkdownContent.tsx`)
3. Open each file as a new tab via `openTab()` from `useFileOperations`
4. Unsupported file types: show toast "Cannot open [filename] — unsupported file type"

**Tauri file drop:** Tauri v2 provides `onDragDropEvent` from `@tauri-apps/api/webviewWindow`. This is more reliable than HTML5 for native file drops on macOS. Check if it provides file paths directly. If available, prefer it over HTML5.

**Visual feedback:** When dragging files over the editor, show a full-area overlay with a subtle border and "Drop to open" text. Use the same pattern as VS Code's file drop overlay. The overlay appears on `dragenter`, disappears on `dragleave`/`drop`.

**Edge cases:**
- Multiple files dropped at once: open all as tabs
- Drop on editor when no project is open: still works (opens standalone file)
- Ignore internal Notesage drags (sidebar items)

### Feature 3: External File Drop on Sidebar Folders

**Approach:** Extend existing drop handlers in `FileTreeItem.tsx`, `ExplorerFolderItem.tsx`, and `ProjectItem.tsx` to handle external file drops.

**Detection:** When `parseNotesageDrop()` returns `null`, check if `e.dataTransfer.types` contains `"Files"`. If yes, this is an external drop.

**Drop handling:**
1. Extract file paths from the drop event
2. Show a small dialog/popover near the drop point: "Move to [folder]" / "Copy to [folder]" / Cancel
3. **Move:** Use `rename_path` Tauri command (same as internal DnD)
4. **Copy:** Use `copy_file` for files, `copy_directory` for directories (both exist as Tauri commands)
5. Conflict check via `pathExists` before the operation
6. Refresh the target folder's file tree after

**Dialog design:** Use a minimal `AlertDialog` (shadcn/ui) — not a popover, since the drop target might be small. Title: "Import [filename]". Body: "Choose how to add this file to [folder name]". Two buttons: "Move here" (primary) and "Copy here" (secondary). Cancel via Escape or clicking outside.

**Edge cases:**
- Multiple files: show dialog once with "Import N files" title, apply chosen action to all
- File already exists at destination: show conflict toast, skip that file, continue with others
- Dropping onto a file (not a folder): drop onto the file's parent directory
- External drops on project/explorer folder headers: treated as drop onto root of that folder

## UI/UX

### Tab Drag Feedback

- Tab being dragged: reduce opacity to 0.5
- Insertion indicator: 2px wide vertical line in `--color-primary`, positioned at the gap between tabs
- No horizontal scrolling while dragging (keep it simple)

### Editor Drop Overlay

- Full editor area overlay with dashed border (2px, `--color-border`)
- Centered text: "Drop files to open" in `text-muted-foreground`
- Background: `--color-muted` at 50% opacity
- Smooth fade-in (150ms)
- Only appears for external file drags, not internal Notesage drags

### Sidebar External Drop Feedback

- Same folder highlight as internal DnD (existing `isDragOver` state toggles `bg-accent`)
- After drop: show the Move/Copy dialog immediately

## Data Model

### editor-store.ts Extension

```typescript
// New action
reorderTab: (fromIndex: number, toIndex: number) => void;
```

No new stores, interfaces, or Tauri commands required. All filesystem operations exist:
- `rename_path` — move files
- `copy_file` — copy single files (exists in `file.rs`)
- `copy_directory` — copy directories (exists in `file.rs`)
- `path_exists` — conflict detection

## Dependencies

No new libraries. Uses HTML5 Drag and Drop API exclusively. Tauri's `onDragDropEvent` API may be used for more reliable native file drops but is optional.

## Quality Gates

### Functional

- [x] Tabs can be reordered by dragging
- [x] Tab order persists across app restarts (via Zustand persist)
- [ ] Dropping a file from Finder onto the editor opens it as a new tab
- [ ] Dropping an unsupported file type shows an error toast
- [ ] Dropping a file from Finder onto a sidebar folder shows Move/Copy dialog
- [ ] Move operation relocates the file and refreshes the tree
- [ ] Copy operation duplicates the file and refreshes the tree
- [ ] Conflict detection works for external drops (same-name file at destination)
- [ ] Multiple file drops work for both editor and sidebar targets
- [ ] Internal sidebar DnD still works correctly (no regression)

### Design

- [x] Tab drag shows insertion indicator at correct position
- [ ] Editor drop overlay appears only for external file drags
- [ ] All DnD feedback works in both light and dark mode
- [ ] Transitions are smooth (no jarring state changes)
- [ ] Move/Copy dialog follows existing AlertDialog styling

## Out of Scope

- Drag tabs to create split editor panes
- Multi-window tab dragging
- Batch selection (Shift/Cmd+Click) for multi-file sidebar DnD
- Drag text between documents
- Drag files from sidebar to external apps (Finder, other editors)
- Drag images into the editor to embed them (separate feature)

## Files to Modify

### Modified Files

| File | Change |
| --- | --- |
| `src/components/tabs/TabBar.tsx` | Add drag source and drop target on each tab, insertion indicator |
| `src/stores/editor-store.ts` | Add `reorderTab(fromIndex, toIndex)` action |
| `src/components/editor/Editor.tsx` | Add external file drop handler and overlay |
| `src/components/sidebar/FileTreeItem.tsx` | Extend `handleDrop` to handle external file drops |
| `src/components/sidebar/ExplorerFolderItem.tsx` | Extend `handleDrop` to handle external file drops |
| `src/components/sidebar/ProjectItem.tsx` | Extend `handleDrop` to handle external file drops |
| `src/styles/editor.css` | Editor drop overlay styles |

### New Files

| File | Purpose |
| --- | --- |
| `src/components/sidebar/ImportFileDialog.tsx` | Move/Copy choice dialog for external file drops |
