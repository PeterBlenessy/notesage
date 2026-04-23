# Workspace

Projects, file tree, iCloud sync, git integration, and external change detection.

## Project Workspace

**Project metadata:**

- `.notesage/` metadata directory auto-bootstrapped per project (name, description, AI overrides, optional AI provider lock)
- New Project dialog (Cmd+Shift+N) with templates (Default, Research, Writing, Blank)
- New Note dialog (Cmd+N) with duplicate detection
- Project Settings tab in settings dialog

**AI provider lock (`aiLock`):**

- Hard per-project lock on which AI provider can access the project. Soft `ai.provider` override is still supported as an advisory default; `aiLock` is hard enforcement.
- Set from Settings > Project > "AI Provider Lock" section — pick a connection, optionally add a reason, confirm. Unlock from the same panel.
- Enforced at every send path: new chat message, resend, edit, comment delegation, inline actions (ACP and direct-API bubble menu). A mismatch raises a `ProjectLockViolation` toast; the wrong-provider API is never called.
- Chat footer multi-select refuses to mix projects with conflicting locks. A locked project drives the effective connection automatically — the provider picker becomes read-only with a Lock icon.
- Visual affordances: padlock overlay on the project folder in the sidebar (tooltip lists the locked provider); clickable Lock icon in the chat footer opens an "explain lock" modal when any selected project is locked.

**Project goals:**

- YAML frontmatter support (parse, preserve, edit)
- Goal templates: OKR, Simple Checklist, SMART Goals, Milestone Tracker
- Goals discovery by scanning for `type: goal` frontmatter
- AI context injection — goals included in chat system prompt
- Multi-select project selector in chat footer

**Chat project isolation:**

Every AI feature scopes to the chat footer's selected projects (plus the `~/Notesage` library root). The selection is the source of truth for:

- ACP Seatbelt sandbox writable paths and kernel read deny-by-default allow-list
- Direct-API tool executor — `read_file`, `list_directory`, `write_file`, and implicit-FS tools refuse out-of-scope paths
- Copilot LSP `workingDir`, `textDocument/didOpen`/`didChange`/`didFocus`, and `copilot/context-request`
- Inline completions (Copilot LSP, Ollama FIM, local bundled, OpenAI-compatible) — skipped for out-of-scope tabs unless `completionsOnOutOfScope` is on
- Active-tab auto-attach, "Currently editing" system-prompt injection, and the injected workspace file tree
- Per-project skill / agent / agent-instructions / MCP server registries — only `global ∪ selectedProjects` reach the system prompt
- Command palette scopes (`@` mentions, `#` tags, `?` research) with an "all projects" opt-in toggle
- History tab filters by project overlap with the selection
- Tray "Recent" submenu filters to the selection (opt-in "All Recent" submenu shows everything)
- Scoped persisted approvals — `alwaysAllowed`, `toolCallAlways`, `skillScriptAlways`, and `domainAlwaysAllowed` are stored as `(toolName, connectionId, projectRoot)` triples; legacy flat approvals migrate into a "legacy broad" bucket with a review toast

**Cross-project mode:** opt-in setting (Settings > Advanced) that exposes all workspace folders to the agent — a persistent banner above the chat input flags it when enabled. Default off. This is the escape hatch for multi-project refactors; it disables the isolation guarantee.

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
2. All events (including self-writes) queue a reindex entry for the SQLite document index
3. Self-write filter: `mark_self_write(path)` records a timestamp; self-write events are excluded from the frontend batch (prevents false "external change" detection) but still trigger reindexing
4. Events filtered: `.git/` internals and `.DS_Store` silently dropped
5. macOS FSEvents quirk: file deletions often arrive as `Modify` events — reclassified as `delete`
6. Reindex queue always drained after event processing (unconditionally, not gated on frontend batch)
7. Non-self-write events emitted as `file-changed-batch` Tauri events with `[{ path, kind }]` payload

**Frontend event handler (**`useFileWatcher.ts`**):**

1. Create/delete: debounced `refreshFileTree()` + git status refresh
2. Modify: content guard reads file from disk, compares against tab content — skips if identical
3. Behavior is governed by a single user setting, `settings-store.externalChangeDiffReview` (Settings &gt; Editor &gt; "Review external diff"). Clean and dirty tabs are treated identically:
   - **OFF (default):** `editor-store.setExternalChange()` → `useFileWatcherIntegration` silently auto-reloads the tab and emits a 3-second info toast (`<name> reloaded from disk`, no actions) via `toastExternalReload`. In-memory edits on dirty tabs are lost — users who want protection turn the setting ON.
   - **ON:** `external-change-store.addChange()` → inline diff decorations (red strikethrough deletions, green insertions) appear in the editor, plus a sticky action toast (`<name> changed externally`) via `toastExternalChange` with **Accept** / **Reject** / **Dismiss**. Accept reloads from disk and saves; Reject persists the in-memory version to disk to avoid a watcher re-detection loop; Dismiss leaves the decorations visible for per-hunk review via the inline controls.

**Critical implementation notes:**

- **Tiptap is source of truth**: Must use `editor.commands.setContent()` to visually reflect changes
- **Self-write TTL (5s)**: Covers debounce + macOS FSEvents re-reporting + iCloud sync latency. Self-write suppression is implemented at the Rust/backend level — `saveFile` calls `mark_self_write` before writing, and the backend excludes self-written paths from the `file-changed-batch` payload
- **Path normalization**: macOS FSEvents canonicalizes `/var` → `/private/var`; frontend strips `/private/` prefix
- **Toast dedup**: Stable `id: "external-change:<filePath>"` prevents duplicate notifications; repeated changes to the same file collapse into one toast
- **Toast helpers**: `toastExternalChange` / `toastExternalReload` live in `src/lib/notifications.ts` — single source of truth for external-change UX
- **Startup gating (**`startupReady`**)**: Watchers wait for startup validation to complete. Startup has a 30s global timeout and 10s per-step timeouts for cloud storage operations, ensuring `startupReady` is always set even if cloud paths hang.

## Key Files

| File | Purpose |
| --- | --- |
| `src/components/sidebar/Sidebar.tsx` | Main sidebar container |
| `src/components/sidebar/FileTree.tsx` | File/folder tree |
| `src/components/sidebar/FileTreeItem.tsx` | Individual tree node |
| `src/components/NewProjectDialog.tsx` | New project creation |
| `src/components/NewNoteDialog.tsx` | New note creation |
| `src/hooks/useFileOperations.ts` | File create/open/save/delete |
| `src/hooks/useFileWatcher.ts` | Filesystem watcher event handler (routes by `externalChangeDiffReview`) |
| `src/hooks/useFileWatcherIntegration.ts` | Auto-reload + toast display (OFF) / inline decorations + sticky action toast (ON) |
| `src/lib/notifications.ts` | `toastExternalChange`, `toastExternalReload` — external-change toast helpers |
| `src/hooks/useProjectMetadata.ts` | Auto-bootstrap `.notesage/project.json` |
| `src/lib/scan-icloud-projects.ts` | iCloud project auto-discovery |
| `src/stores/workspace-store.ts` | Explorer folders, projects, notes tree |
| `src/stores/project-metadata-store.ts` | Project metadata (incl. `aiLock`) |
| `src/stores/external-change-store.ts` | Pending external changes |
| `src/lib/ai/project-lock.ts` | `ProjectLockViolation` + lock lookup utilities |
| `src/lib/ai/uri-scope.ts` | `isUriInScope` for LSP doc sync / completion gate / active-tab attach |
| `src/components/chat/ExplainLockDialog.tsx` | Chat footer "provider locked by project" modal |
| `src/components/settings/LockProjectDialog.tsx` | Settings > Project lock-creation dialog |
| `src-tauri/src/commands/file.rs` | File operations |
| `src-tauri/src/commands/git.rs` | Git operations |
| `src-tauri/src/commands/watcher.rs` | Filesystem watcher |
| `src-tauri/src/commands/dialog.rs` | Native dialogs |

## Future Enhancements

- Sync progress/status monitoring from iCloud
- Non-Apple cloud providers (Dropbox, Google Drive, OneDrive)
- Per-hunk accept/reject from popover for non-focused files
- Cross-file Accept All / Reject All