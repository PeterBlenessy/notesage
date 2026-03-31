# Workspace

Projects, file tree, iCloud sync, git integration, and external change detection.

## Project Workspace

**Project metadata:**

- `.notesage/` metadata directory auto-bootstrapped per project (name, description, AI overrides)
- New Project dialog (Cmd+Shift+N) with templates (Default, Research, Writing, Blank)
- New Note dialog (Cmd+N) with duplicate detection
- Project Settings tab in settings dialog

**Project goals:**

- YAML frontmatter support (parse, preserve, edit)
- Goal templates: OKR, Simple Checklist, SMART Goals, Milestone Tracker
- Goals discovery by scanning for `type: goal` frontmatter
- AI context injection — goals included in chat system prompt
- Multi-select project selector in chat footer

## Notesage Library & iCloud Sync

**Library:**

- `~/Notesage` as the default folder for new projects and Quick Notes
- New Project dialog defaults to `~/Notesage` with option to choose another folder
- Cross-platform home directory resolution (macOS, Windows, Linux)

**iCloud sync:**

- Selective iCloud sync per project (not all-or-nothing) via Settings &gt; Sync tab
- iCloud sync toggle in per-project settings (sidebar cog icon)
- When enabled, project folders move to `~/Library/Mobile Documents/com~apple~CloudDocs/Notesage/`
- Quick Notes sync to iCloud with file merge across local and cloud
- Disable sync: project copied back to local `~/Notesage` and removed from iCloud
- Cloud badge icon on synced files and folders in sidebar
- "Configure then apply" pattern: toggles update pending state, Apply button triggers migration

**iCloud project auto-discovery:**

- On startup, scans iCloud Notesage folder for projects synced from other machines
- Newly discovered projects added to workspace and registered as synced projects
- At runtime, filesystem watcher detects new iCloud projects (1s debounce for gradual sync)
- Filesystem watchers gated behind `startupReady` flag

## Git Integration

- File status indicators in sidebar (modified, staged, untracked, deleted, renamed, conflicted)
- Commit dialog with file selection, staging/unstaging, and message input
- Branch display and switching via dropdown
- Auto-detection of git repos, git availability check
- Git identity configuration UI when `user.name`/`user.email` missing
- Status refresh on save, commit, branch switch, and window focus

**Git branch diff review:**

- Compare current branch against any other branch
- ProseMirror decorations showing additions (green) and deletions (red)
- Accept all / reject all controls in review banner

## External Change Detection & Review

Detects external file changes (from other editors, AI agents, terminal commands) and updates the sidebar tree and editor content.

**Rust backend (**`watcher.rs`**):**

1. `watch_directory(path)` starts recursive watching via `notify` crate with `notify_debouncer_full` (500ms debounce)
2. Self-write filter: `mark_self_write(path)` records a timestamp; events suppressed for 5 seconds
3. Events filtered: `.git/` internals and `.DS_Store` silently dropped
4. macOS FSEvents quirk: file deletions often arrive as `Modify` events — reclassified as `delete`
5. Surviving events emitted as `file-changed` Tauri events with `{ path, kind }` payload

**Frontend event handler (**`useFileWatcher.ts`**):**

6. Create/delete: debounced `refreshFileTree()` + git status refresh
7. Modify: content guard reads file from disk, compares against tab content — skips if identical
8. Clean-tab behavior gated on `settings-store.externalChangeDiffReview`:
   - **Auto-accept (default):** `editor-store.setExternalChange()` → Editor.tsx auto-reloads with toast
   - **Diff review (beta):** `external-change-store.addChange()` → inline diff decorations for review
9. Dirty tabs: show reload/keep banner for user decision

**Critical implementation notes:**

- **Tiptap is source of truth**: Must use `editor.commands.setContent()` to visually reflect changes
- **Self-write TTL (5s)**: Covers debounce + macOS FSEvents re-reporting + iCloud sync latency
- **Path normalization**: macOS FSEvents canonicalizes `/var` → `/private/var`; frontend strips `/private/` prefix
- **Toast dedup**: Stable `id: "external-change"` prevents duplicate notifications
- **Startup gating (**`startupReady`**)**: Watchers wait for startup validation to complete

## Key Files

| File | Purpose |
| --- | --- |
| `src/components/sidebar/Sidebar.tsx` | Main sidebar container |
| `src/components/sidebar/FileTree.tsx` | File/folder tree |
| `src/components/sidebar/FileTreeItem.tsx` | Individual tree node |
| `src/components/NewProjectDialog.tsx` | New project creation |
| `src/components/NewNoteDialog.tsx` | New note creation |
| `src/hooks/useFileOperations.ts` | File create/open/save/delete |
| `src/hooks/useFileWatcher.ts` | Filesystem watcher event handler |
| `src/hooks/useProjectMetadata.ts` | Auto-bootstrap `.notesage/project.json` |
| `src/lib/scan-icloud-projects.ts` | iCloud project auto-discovery |
| `src/stores/workspace-store.ts` | Explorer folders, projects, notes tree |
| `src/stores/project-metadata-store.ts` | Project metadata |
| `src/stores/external-change-store.ts` | Pending external changes |
| `src-tauri/src/commands/file.rs` | File operations |
| `src-tauri/src/commands/git.rs` | Git operations |
| `src-tauri/src/commands/watcher.rs` | Filesystem watcher |
| `src-tauri/src/commands/dialog.rs` | Native dialogs |

## Future Enhancements

- Sync progress/status monitoring from iCloud
- Non-Apple cloud providers (Dropbox, Google Drive, OneDrive)
- Per-hunk accept/reject from popover for non-focused files
- Cross-file Accept All / Reject All