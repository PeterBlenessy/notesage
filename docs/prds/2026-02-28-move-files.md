# PRD: Move Files Between Projects and Folders

**Date:** 2026-02-28 **Status:** Pending **Parent:** File Management

## Problem

Users organize work across multiple projects and explorer folders in Notesage. Currently, a limited "Move to Project" submenu exists but only for Quick Notes files, and only lists projects as destinations. Files inside projects or explorer folders have no move option at all. Users must manually copy/move files in Finder and re-open them — breaking open tabs and losing context.

## Goals

1. Any file or folder in the sidebar can be moved to any listed project or explorer folder via context menu
2. The "Move to..." submenu shows all available destinations with clear labeling
3. Open tabs update their paths seamlessly after a move
4. File conflicts (same-name file at destination) are caught before the move with a clear error
5. Phase 2: drag-and-drop files between sidebar sections

## Non-Goals

- Moving files to arbitrary filesystem locations outside listed projects/folders
- Moving files to subfolders within a destination (moves to root of destination)
- Batch/multi-select move operations
- Cross-device or iCloud-aware move semantics (standard filesystem rename)
- Undo/revert move operations

## User Stories

- As a user, I want to right-click a file in a project and move it to another project, so I can reorganize notes across projects
- As a user, I want to move a file from an explorer folder into a project, so I can promote loose files into project-managed notes
- As a user, I want to move Quick Notes into a project, so I can organize scratch notes into structured work
- As a user, I want the current container disabled in the submenu, so I don't accidentally "move" a file to where it already is
- As a user, I want a clear error if a file with the same name already exists at the destination, so I don't lose data

## Technical Approach

### Phase 1: Context Menu "Move to..."

**Extends the existing pattern** — `FileTreeItem.tsx` already has `handleMoveToProject` using `renamePath()` from `useFileOperations`. The approach:

1. **Remove the** `showMoveToProject` **prop** — the "Move to..." submenu is always available when valid destinations exist
2. **Extend the submenu** to list both projects and explorer folders as destinations
3. **Rename and generalize** `handleMoveToProject` → `handleMoveTo`
4. **Add conflict check** before the move via `tauriApi.pathExists()`

**Data flow (unchanged from existing pattern):**

```
Context menu → handleMoveTo(destPath)
  → tauriApi.pathExists(destPath/filename) — conflict check
  → renamePath(oldPath, destPath/filename)
    → tauriApi.renamePath() — filesystem move
    → renameTab() — update open tab path
    → refreshFileTree() — refresh source and destination trees
    → refreshGitForPath() — update git status
```

**No new Tauri commands needed** — `rename_path` already handles cross-directory moves via `fs::rename`.

### Phase 2: Drag and Drop (Future)

Deferred. Will use HTML5 drag-and-drop on `FileTreeItem` components with drop targets on project/folder headers.

## UI/UX

### Context Menu Submenu

The "Move to..." submenu appears for all files and folders in all sidebar sections (Quick Notes, Projects, Explorer Folders).

**Submenu structure:**

When both projects and explorer folders exist:

```
Move to... →
  ── Projects ──
  My Project          (disabled if file is already here)
  Another Project
  ── Folders ──
  Documents           (disabled if file is already here)
  Downloads
```

When only one category exists, show a flat list without headers.

**Disabled state:** The destination containing the current file is disabled (greyed out). Determined by checking if `entry.path.startsWith(dest.path + "/")`.

**Conflict error:** Toast: "A file named \[filename\] already exists in \[destination name\]"

**Icon:** `FolderInput` (lucide) — matches existing usage.

### Submenu Placement

Same position as the existing "Move to Project" — after the "Make Project" item, before "Reveal in Finder", separated by `ContextMenuSeparator`.

## Data Model

No new stores, interfaces, or Tauri commands. All infrastructure exists:

- **Destinations:** `useWorkspaceStore` → `projects` (array of `{ path, fileTree }`) + `explorerFolders` (array of `{ path, fileTree }`)
- **Project names:** `useProjectMetadataStore` → `metadataMap[path]?.name`
- **Folder names:** Derived from `path.split("/").pop()`
- **Move operation:** `useFileOperations().renamePath(oldPath, newPath)`
- **Conflict check:** `tauriApi.pathExists(destPath)`

## Dependencies

None. All required infrastructure exists.

## Files to Modify

| File | Change |
| --- | --- |
| `src/components/sidebar/FileTreeItem.tsx` | Remove `showMoveToProject` prop, read `explorerFolders` from store, extend submenu, rename handler, add conflict check |
| `src/components/sidebar/FileTree.tsx` | Remove `showMoveToProject` prop from interface and passthrough |
| `src/components/sidebar/Sidebar.tsx` | Remove `showMoveToProject` from Notes FileTree props |

## Quality Gates

### Functional

- [x] Right-click file in Quick Notes → "Move to..." shows projects AND explorer folders

- [x] Right-click file in a project → "Move to..." shows other projects and explorer folders

- [x] Right-click file in an explorer folder → "Move to..." shows projects and other explorer folders

- [x] Current container is disabled in the submenu

- [x] "Move to..." hidden when no valid destinations exist (only one project, no folders)

- [x] Moving a file updates the open tab path and filename

- [x] Moving a file refreshes both source and destination file trees

- [x] Moving a file with a name conflict shows toast error, no move occurs

- [x] Moving a folder works (entire subtree moves)

- [x] Git status refreshes after move

### Design

- [x] Submenu follows existing context menu styling (icons, spacing, separators)

- [x] Category headers ("Projects" / "Folders") use `ContextMenuLabel` style

- [x] Disabled items are clearly greyed out

- [x] Works in both light and dark mode

## Out of Scope

- Drag-and-drop file moving (Phase 2)
- Moving to subfolders within a destination
- Multi-file selection and batch move
- Move undo/history
- File merge on conflict