# PRD: Explorer Folder File Watcher Fix

## Problem

The filesystem watcher infrastructure (Rust `notify` crate + Tauri events + React hooks) exists but silently fails for explorer folders. Users report three symptoms:

1. **Externally modified files** open in the editor don't auto-reload or show the external change banner
2. **New files** created in explorer folders (e.g., via terminal) don't appear in the sidebar tree
3. **Deleted files** remain visible in the sidebar until the folder is manually reopened

The watcher chain is wired up end-to-end: `useStartWatchers` watches the explorer path, the Rust `notify` debouncer emits `file-changed` events, and `useFileWatcher` listens for them. But path comparison failures cause the handler to silently discard events.

## Root Cause

### 1. Path mismatch on `refreshFileTree(path)`

When `useFileWatcher` received a create/delete event, it called `refreshFileTree(path)` with the specific file path from the event. Inside `refreshFileTree`, the check `targetPath.startsWith(ws.explorerPath)` compares the event path against the stored explorer path. On macOS, the `notify` crate (via FSEvents) can canonicalize paths — resolving symlinks like `/tmp` to `/private/tmp`, `/var` to `/private/var`. If the event path is canonicalized differently than the stored workspace path, the `startsWith` check fails silently and no tree refresh occurs.

### 2. Tab path mismatch on modify events

The same canonicalization issue affects modify events. The tab lookup `state.tabs.find((t) => t.filePath === path)` uses strict equality, which fails when the event path doesn't exactly match the stored tab path.

### 3. No git status refresh on external changes

Git status indicators in the sidebar only refreshed on internal file operations (save, create, delete via the app). External changes — the exact scenario the watcher is designed for — never triggered a git status refresh.

## Solution

### Changes to `src/hooks/useFileWatcher.ts`

**Path normalization helper**:Added `normalizePath()` that strips trailing slashes and resolves the `/private/` prefix that macOS FSEvents adds to `/var`, `/tmp`, `/etc` symlinks.

**Create/delete events — refresh everything**:Changed `refreshFileTree(path)` to `refreshFileTree()` (no argument). Without a target path, `refreshFileTree` refreshes all open trees (explorer, projects, notes). This sidesteps path comparison entirely. The 300ms debounce prevents excessive calls when multiple files change rapidly.

**Modify events — normalized tab lookup**:Tab path comparison now uses `normalizePath()` on both sides:

```typescript
const normalizedPath = normalizePath(path);
const tab = state.tabs.find((t) => normalizePath(t.filePath) === normalizedPath);
```

**External change banner key:**`setExternalChange` now uses `tab.filePath` (the stored path) instead of the event `path`, ensuring the editor store can look up the external change correctly.

**Git status refresh**:All watcher events now trigger a debounced (500ms) `refreshGitForPath()` call, keeping sidebar git indicators current after external changes.

### Changes to `src/hooks/useFileOperations.ts`

**Exported** `refreshGitForPath`:Changed from a private module-level function to an exported function so `useFileWatcher` can import and call it.

## Files Changed

| File | Change |
| --- | --- |
| `src/hooks/useFileWatcher.ts` | Path normalization, refresh-all on create/delete, git refresh |
| `src/hooks/useFileOperations.ts` | Export `refreshGitForPath` |
| `package.json` | Fix invalid JSON escape (`\~` to `~` in typescript version) |

## Verification

1. `npx tsc --noEmit` passes
2. `pnpm tauri dev` compiles and launches without errors
3. Open a folder as explorer in the app
4. From terminal, `touch <folder>/test-watcher.md` — file appears in sidebar
5. Open the file, then from terminal, `echo "# Changed" > <folder>/test-watcher.md` — editor reloads or shows external change banner
6. From terminal, `rm <folder>/test-watcher.md` — file disappears from sidebar
7. Git status indicators update after external file modifications

## Status

**Complete.** Implemented and type-checked. The `package.json` JSON parse error (`\~` escape) was also fixed as a prerequisite for `pnpm tauri dev` to run.
