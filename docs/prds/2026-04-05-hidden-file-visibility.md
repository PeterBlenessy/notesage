# PRD: Hidden File & Folder Visibility Toggle

|  |  |
| --- | --- |
| **Date** | 2026-04-05 |
| **Status** | Draft |
| **Priority** | Low |
| **Impact** | Advanced users can browse `.notesage/`, `.git/`, and other dotfile directories directly in the sidebar, enabling manual inspection and editing of research files, comments, agent instructions, and project metadata |

## Problem

Notesage hides all dotfiles and dot-directories from the sidebar file tree. This is correct as the default — `.notesage/` contains app-specific metadata (comments, research, drawings, project config) that most users should never need to see. The `list_directory` Rust command skips any entry whose name starts with `.`.

However, this creates friction for advanced users who want to:

1. **Browse research files visually.** Research stored in `.notesage/research/` is only accessible via the command palette `?` search. Users cannot see the file listing, reorganize files, or spot naming issues without a terminal.
2. **Inspect agent instructions.** `.notesage/agents.md` and `.notesage/agents/` contain AI agent configuration that users may want to edit directly rather than through the settings UI.
3. **Debug metadata.** Comments (`.notesage/comments/`), MCP configs (`.notesage/mcp.json`), and project settings (`.notesage/project.json`) sometimes need manual inspection when things go wrong.
4. **Work with dotfiles in general.** Developers working on projects with `.github/`, `.husky/`, `.vscode/`, or config dotfiles (`.eslintrc`, `.prettierrc`) cannot see or edit these from the Notesage sidebar.

## Goals

1. Add an advanced setting to toggle visibility of hidden files and folders in the sidebar file tree
2. Default is OFF (hidden) — the current behavior, optimized for most users
3. When ON, dotfiles and dot-directories appear in the sidebar with clear visual distinction from regular files
4. The toggle is per-user (global setting), not per-project
5. Certain directories remain always-hidden regardless of the toggle (e.g., `.git/objects/`, `.git/pack/`) to prevent performance issues from massive directory trees

## Non-Goals

- **Editing `.notesage/` metadata through custom UI** — this toggle is for raw file access; structured editing (comments, research) uses existing purpose-built UI
- **Per-project hidden file settings** — one global toggle is sufficient
- **Showing hidden files by default** — the default must remain hidden
- **gitignore-aware filtering** — a separate concern; this PRD only addresses dotfile visibility

## User Stories

1. **As an advanced user**, I want to toggle hidden file visibility in settings, so that I can browse my `.notesage/research/` files directly in the sidebar without opening a terminal.

2. **As a developer**, I want to see and edit `.github/workflows/`, `.eslintrc`, and other config dotfiles in the sidebar, so that I don't need to switch to another editor for these files.

3. **As a power user**, I want hidden files to be visually distinct from regular files (dimmed or badged), so that I can tell at a glance which files are "app internals" vs. my own dotfiles.

4. **As a user**, I want the default to remain "hidden files invisible", so that the sidebar stays clean and I'm not overwhelmed by metadata directories I don't understand.

## Design

### Settings UI

A new toggle in **Settings > Advanced**:

```
Show hidden files and folders
Toggle visibility of dotfiles (files and folders starting with ".") in the sidebar file tree.
  [ OFF ]
```

Stored in `settings-store` as `showHiddenFiles: boolean` (default `false`). Persisted via Zustand persist middleware.

### Backend Change

The `list_directory` Rust command currently unconditionally skips dotfiles:

```rust
// Current behavior (file.rs)
if file_name.starts_with('.') {
    continue;
}
```

Updated to accept a parameter:

```rust
#[tauri::command]
async fn list_directory(path: String, show_hidden: Option<bool>) -> Result<Vec<FileEntry>, String>
```

When `show_hidden` is `Some(true)`, dotfiles are included in the listing. Default behavior (`None` or `Some(false)`) remains unchanged — fully backward compatible.

### Always-Hidden Exclusions

Even with the toggle ON, these paths are excluded to prevent performance degradation and noise:

| Path pattern | Reason |
|-------------|--------|
| `.git/objects/` | Thousands of pack files |
| `.git/pack/` | Large binary pack files |
| `.git/logs/` | Verbose reflog |
| `node_modules/` | Already excluded (not a dotfile, but for reference) |
| `.DS_Store` | macOS metadata, never useful |

The `.git/` directory itself is shown (so users can see `.git/config`, `.gitignore`, etc.), but its bulk subdirectories are pruned.

### Sidebar Visual Treatment

Hidden files and folders, when visible, are rendered with **dimmed opacity** to distinguish them from regular files:

- Dotfile entries: `opacity-50` (Tailwind) applied to the `FileTreeItem` row
- Dotfile icon color: `text-muted-foreground` (same muted color as non-active items but dimmed further)
- Sort order: dotfiles sorted to the bottom of their directory level, after all regular entries
- No special badge or icon — dimming is sufficient and keeps the UI clean

### FileEntry Extension

The `FileEntry` struct gains a `hidden` flag set by the backend:

```rust
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<FileEntry>>,
    pub hidden: bool,  // true if name starts with "."
}
```

Frontend uses this flag for styling without needing to re-parse filenames.

### Filesystem Watcher Integration

When `showHiddenFiles` is ON, the watcher (`watcher.rs`) should emit events for changes to dotfiles that it currently suppresses. The existing `.DS_Store` and `.git/` internal filters remain active regardless.

## Implementation Plan

- [ ] Add `showHiddenFiles` to `settings-store` (default `false`, persisted)
- [ ] Add toggle to Settings > Advanced section
- [ ] Update `list_directory` Rust command to accept `show_hidden` parameter
- [ ] Add always-hidden exclusion list (`.git/objects/`, `.git/pack/`, `.git/logs/`, `.DS_Store`)
- [ ] Add `hidden` field to `FileEntry` struct
- [ ] Update frontend `FileTree` / `FileTreeItem` to pass `showHiddenFiles` setting to `list_directory`
- [ ] Style hidden entries with dimmed opacity and bottom-sort order
- [ ] Update `useFileWatcher` to handle dotfile change events when toggle is ON
- [ ] Update TypeScript `FileEntry` interface to include `hidden` field
- [ ] Test: toggle OFF shows no dotfiles (existing behavior preserved)
- [ ] Test: toggle ON shows dotfiles except always-hidden exclusions
- [ ] Test: `.git/` top-level visible but bulk subdirs pruned
- [ ] Test: dimmed styling applied only to hidden entries

## Quality Gates

1. Default behavior unchanged: with toggle OFF, sidebar is identical to current behavior
2. Toggle ON reveals `.notesage/`, `.git/`, `.github/`, `.vscode/`, and other dotfiles
3. Always-hidden exclusions prevent `.git/objects/` and other bulk directories from appearing
4. Hidden entries are visually distinct (dimmed) from regular files
5. Dotfiles sort to the bottom of each directory listing
6. `FileEntry.hidden` flag correctly set for all hidden entries
7. Performance: enabling the toggle on a project with `.git/` does not cause noticeable lag
8. Watcher correctly reports/suppresses dotfile events based on toggle state
9. Round-trip: toggle ON → browse `.notesage/research/` → open a research file → edit → save works correctly
10. Both light and dark mode render dimmed entries with appropriate contrast

## Out of Scope

- **Per-project toggle** — a single global setting covers the use case
- **Inline hidden-file filter/search** — use the existing command palette for targeted search
- **Custom exclusion patterns** — the built-in always-hidden list is sufficient initially
- **gitignore-aware filtering** — orthogonal feature, could be a future PRD
- **File tree filter bar** — general-purpose sidebar filtering is a bigger feature
