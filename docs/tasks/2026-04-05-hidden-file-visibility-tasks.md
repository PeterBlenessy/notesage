# Hidden File & Folder Visibility Toggle — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-05 |
| **Status** | Complete |
| **PRD** | [hidden-file-visibility](../prds/2026-04-05-hidden-file-visibility.md) |
| **Total** | 12 tasks: 5S, 5M, 2L |
| **Suggested order** | Backend (#1-#3) → Store (#4) → Settings UI (#5) → Frontend wiring (#6-#8) → Visual (#9) → Watcher (#10) → Tests (#11-#12) |

**Risks:**

- `listDirectory` is called from \~20 callsites across `useFileOperations`, `useAppLifecycle`, `useFileWatcher`, `FoldersSection`, `App.tsx`, `scan-icloud-projects`, etc. The `tauriApi.listDirectory()` wrapper in `src/lib/tauri.ts` is the single choke point — update the wrapper signature and all callers get the parameter for free.
- Performance: `.git/` can contain thousands of entries. The always-hidden exclusion list must be enforced in the Rust backend, not the frontend.
- AI tool calling also uses `list_directory` (via `tool-executor.ts` and `skill-store.ts`). Tool calls should always show hidden files so the AI can browse `.notesage/` — pass `show_hidden: true` from the tool executor.

---

### #1 — Add `hidden` field to Rust `FileEntry` struct ✅

**Description:** Add `pub hidden: bool` to `FileEntry` in `file.rs`. Set it to `true` when the entry name starts with `.`. This field is always populated regardless of whether hidden files are shown — it's a metadata flag for frontend styling.

**Complexity:** S **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/src/commands/file.rs` — `FileEntry` struct definition, `list_directory_recursive`, `list_files_shallow`

---

### #2 — Add `show_hidden` parameter to `list_directory` command ✅

**Description:** Update `list_directory` and `list_directory_recursive` to accept `show_hidden: Option<bool>`. When `None` or `Some(false)`, skip dotfiles (current behavior). When `Some(true)`, include dotfiles but apply always-hidden exclusions. Update `list_files_shallow` similarly.

**Acceptance criteria:**

- `list_directory("/path", None)` behaves identically to today
- `list_directory("/path", Some(true))` includes dotfiles
- `.DS_Store` is always excluded regardless of the toggle

**Complexity:** M **Category:** backend **Dependencies:** Depends on #1 **Files:**

- `src-tauri/src/commands/file.rs` — `list_directory`, `list_directory_recursive`, `list_files_shallow`

---

### #3 — Add always-hidden exclusion list ✅

**Description:** When `show_hidden` is true, still exclude these paths to prevent performance degradation:

- `.git/objects/`
- `.git/pack/`
- `.git/logs/`
- `.DS_Store` (already excluded in watcher, add to listing)

Implement as a check in `list_directory_recursive`: if current path is inside `.git/` and the child name matches `objects`, `pack`, or `logs`, skip it. The `.git/` directory itself and other children (`.git/config`, `.git/HEAD`, `.gitignore`) remain visible.

**Complexity:** S **Category:** backend **Dependencies:** Depends on #2 **Files:**

- `src-tauri/src/commands/file.rs`

---

### #4 — Add `showHiddenFiles` to settings store ✅

**Description:** Add `showHiddenFiles: boolean` field to `SettingsStore` interface with default `false`. Add `setShowHiddenFiles` setter. Field persisted via existing Zustand persist middleware.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/stores/settings-store.ts`

---

### #5 — Add toggle in Settings &gt; Advanced ✅

**Description:** Add a "Show hidden files and folders" switch in the Advanced section of the settings dialog. Description text: "Show dotfiles and dot-directories (starting with ".") in the sidebar file tree." Follow the pattern of existing advanced toggles (e.g., `externalChangeDiffReview`).

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #4 **Files:**

- `src/components/settings/SettingsDialog.tsx` (or whichever component renders the Advanced section)

---

### #6 — Update `tauriApi.listDirectory` wrapper to pass `showHidden` ✅

**Description:** Update `listDirectory` in `src/lib/tauri.ts` to accept an optional `showHidden` parameter and pass it to the Tauri invoke call. Also update `listFilesShallow` similarly.

```typescript
async listDirectory(path: string, showHidden?: boolean): Promise<FileEntry[]> {
  return await invoke<FileEntry[]>("list_directory", { path, showHidden });
}
```

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #2 **Files:**

- `src/lib/tauri.ts` — `listDirectory`, `listFilesShallow`, `FileEntry` interface (add `hidden` field)

---

### #7 — Wire `showHiddenFiles` setting to all `listDirectory` callsites ✅

**Description:** Update all callsites that invoke `tauriApi.listDirectory()` to read `showHiddenFiles` from `settings-store` and pass it through. Key callsites:

- `src/hooks/useFileOperations.ts` — `refreshFileTree()` and related calls (\~5 callsites)
- `src/hooks/useAppLifecycle.ts` — startup tree loading (\~4 callsites)
- `src/hooks/useFileWatcher.ts` — tree refresh on file changes
- `src/components/sidebar/FoldersSection.tsx` — open folder handler
- `src/App.tsx` — drag-and-drop, URL scheme, file tree refreshes (\~6 callsites)
- `src/lib/scan-icloud-projects.ts` — iCloud discovery
- `src/lib/document-index.ts` — index building
- `src/lib/refresh-notes-tree.ts` — notes tree refresh
- `src/components/sidebar/FileTreeItem.tsx` — delete dialog child count

AI tool executor (`src/lib/tool-executor.ts`) should always pass `showHidden: true` so the model can browse `.notesage/` directories.

**Acceptance criteria:**

- Toggling the setting and refreshing the tree shows/hides dotfiles
- AI tool calls always see hidden files

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #4, #6 **Files:**

- `src/hooks/useFileOperations.ts`
- `src/hooks/useAppLifecycle.ts`
- `src/hooks/useFileWatcher.ts`
- `src/components/sidebar/FoldersSection.tsx`
- `src/App.tsx`
- `src/lib/scan-icloud-projects.ts`
- `src/lib/document-index.ts`
- `src/lib/refresh-notes-tree.ts`
- `src/components/sidebar/FileTreeItem.tsx`
- `src/lib/tool-executor.ts`

---

### #8 — Trigger file tree refresh when toggle changes ✅

**Description:** When `showHiddenFiles` changes, the sidebar file tree must refresh to reflect the new visibility. Add a `useEffect` (or equivalent) in the component that owns the file tree lifecycle that watches `showHiddenFiles` and calls `refreshFileTree()`.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #7 **Files:**

- `src/hooks/useFileOperations.ts` or `src/components/sidebar/Sidebar.tsx` — wherever tree refresh is triggered

---

### #9 — Style hidden entries with dimmed opacity and bottom-sort ✅

**Description:** In `FileTreeItem`, when `entry.hidden` is `true`:

- Apply `opacity-50` to the entire row
- Apply `text-muted-foreground` to the icon

In `FileTree` (or wherever children are sorted for display), sort hidden entries after all regular entries within each directory level. Maintain alphabetical order within each group (regular files first alphabetically, then hidden files alphabetically).

**Acceptance criteria:**

- Hidden entries are visually dimmed in both light and dark mode
- Dotfiles appear at the bottom of their directory listing
- Non-hidden entries are unaffected

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #6 (needs `hidden` field on `FileEntry`) **Files:**

- `src/components/sidebar/FileTreeItem.tsx` — dimmed styling
- `src/components/sidebar/FileTree.tsx` — sort order

---

### #10 — Update watcher to respect hidden file toggle for tree refresh ✅

**Description:** The watcher already emits events for dotfile changes (except `.git/` internals and `.DS_Store`). The `useFileWatcher` hook calls `refreshFileTree()` on create/delete events, which will now correctly include/exclude dotfiles based on the setting (because `refreshFileTree` passes `showHiddenFiles` after #7).

For modify events on dotfiles: when `showHiddenFiles` is OFF, skip the content-reload check for dotfile paths (they're not shown in the UI, so no tab to update). When ON, process normally.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #7 **Files:**

- `src/hooks/useFileWatcher.ts`

---

### #11 — Backend unit tests ✅

**Description:** Add Rust tests for the updated `list_directory` behavior:

- `show_hidden: None` excludes dotfiles (backward compat)
- `show_hidden: Some(true)` includes dotfiles
- Always-hidden exclusions (`.git/objects/`, `.git/pack/`, `.git/logs/`, `.DS_Store`) are filtered even with `show_hidden: true`
- `FileEntry.hidden` is `true` for dotfiles, `false` for regular files

**Complexity:** M **Category:** backend **Dependencies:** Depends on #3 **Files:**

- `src-tauri/src/commands/file.rs` — `#[cfg(test)]` module

---

### #12 — Frontend unit tests ✅

**Description:** Add Vitest tests:

- `settings-store`: `showHiddenFiles` defaults to `false`, setter works, persisted
- `FileTreeItem`: hidden entries receive `opacity-50` class
- `FileTree`: sort order places hidden entries after regular entries
- `tool-executor`: `list_directory` tool call passes `showHidden: true`
- Mock `list_directory` in `tauri-mock.ts` to handle the new `showHidden` parameter

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #9, #10 **Files:**

- `src/stores/__tests__/settings-store.test.ts`
- `src/components/sidebar/__tests__/FileTreeItem.test.ts` (new or existing)
- `src/lib/__tests__/tool-executor.test.ts` (new or existing)
- `src/test/tauri-mock.ts`