# UI Refresh Phase 1 — Known Follow-ups

Tracked work that surfaced during task implementation but was explicitly scoped out of the numbered Phase 1 breakdown. Each entry has enough context to be picked up later without re-deriving the problem.

## F1 — Pinned files cleanup on delete

**Surfaced by:** Batch G2 / task #31 (PinnedSection wiring, 2026-04-23)

**Problem:** `workspace-store.pinnedFiles` is updated on rename (`updateFilePaths` + `updateProjectPath`) but NOT on delete. If a user deletes a file or removes a project that contains pinned children, stale entries remain in `pinnedFiles` and will render as broken rows (or silently 404 on click) in the Quiet Sidebar's Pinned section.

**Fix approach (two options, either acceptable):**
- (a) In `useFileOperations.deletePath` and `useEditorStore.markTabDeleted`, call `useWorkspaceStore.getState().unpinFile(path)` for the affected path. Cross-store coupling is already present in these hooks.
- (b) Add a store action `unpinFilesByPrefix(prefix: string)` and invoke it from the same call sites, plus from `removeProject` (the project-removal path that currently just drops the project).

**Scope:** S. Two or three touch points, with tests that assert "delete X → X removed from pinnedFiles".

**Blockers:** none. Can be picked up any time.

## F2 — Tag click → FloatingCommandBar seed

**Surfaced by:** Batch G2 / task #34 (TagsSection wiring, 2026-04-23)

**Problem:** Clicking a tag in the Quiet Sidebar's Tags section emits `{ type: 'focus', prefix: '#' }` on the `cmd-bar-events` bus. This:
- ✅ Puts the FloatingCommandBar into Tag mode (prefix `#`)
- ❌ Does NOT pre-fill the specific tagname the user clicked — they see the full top-N list instead of the filtered-to-clicked-tag view.

Additionally, `FloatingCommandBar` currently does **not** subscribe to the `cmd-bar-events` bus at all, so even the `prefix: '#'` emission is a no-op in production today. Presumably tasks #20 / #21 will land the subscribe side.

**Fix approach:** Widen `CmdBarEvent` in `src/lib/cmd-bar-events.ts` from `{ type: 'focus'; prefix?: string }` to `{ type: 'focus'; prefix?: string; seed?: string }`. Have `FloatingCommandBar` subscribe to the bus, open on `focus`, and pre-fill the input with `prefix + (seed ?? "")`. Wire `TagsSection.handleTagClick(tagName)` to emit `{ type: 'focus', prefix: '#', seed: tagName }`. The `_tagName` param in TagsSection is already kept underscore-prefixed and ready to swap in.

**Scope:** S (payload change + one subscribe + two call sites).

**Blockers:** depends on whichever task actually makes FloatingCommandBar subscribe to the bus (#20 or adjacent). If that hasn't landed yet, do F2 as part of the same touch.

## F3 — Focus restoration on type-to-filter clear

**Surfaced by:** Batch G4 / task #43 (type-to-filter, 2026-04-23)

**Problem:** When the user presses Esc to clear an active type-to-filter, or clicks the Clear ✕ button on the FilterBadge, focus isn't restored to the sidebar row that was active before the filter started. Keyboard-only users lose their "you are here" marker.

**Fix approach:** Cache `document.activeElement` (as a `WeakRef` to avoid leaks) when the filter transitions from empty → non-empty. When clearing, call `cached?.focus?.()`. If the cached element is no longer in the DOM, fall back to focusing the nav root.

**Scope:** S. One `useRef` + two `useEffect` tweaks in QuietSidebar.

**Blockers:** none.

## F4 — Renaming a project root

**Surfaced by:** Batch G5 / task #40 (inline rename, 2026-04-23)

**Problem:** #40 intentionally skipped project rows (and folders). Renaming a project root is a bigger change — it affects:
- `.notesage/` metadata paths (comments, research, skills, mcp config all pin by path prefix)
- Filesystem watcher registrations (`watch_directory` calls would need to unregister + re-register)
- SQLite document index (`project.path` is a FK in the tags/mentions/tasks/goals rows)
- Open editor tabs rooted in that project (`editor-store.updateFilePaths` already handles prefix rewriting, but the sequence matters)
- Git repo state per path (`git-store` keys by path)
- Project metadata store (`.notesage/project.json` self-reference)

**Fix approach:** Treat this as its own PRD rather than a drop-in task. The interactions above make a one-liner impossible — need a coordinated sequence: rename_path on disk → batch-rewrite all path-prefixed stores → re-register watcher → trigger index rebuild for the new path. Consider whether renaming an iCloud-synced project also requires moving the folder inside `Mobile Documents/com~apple~CloudDocs/Notesage/`.

**Scope:** L. Probably a standalone PRD.

**Blockers:** should wait until Phase 1 ships. Not a refresh-UI task.

## F5 — Hidden-dir `.md` counts in ProjectsSection

**Surfaced by:** Batch G2 / task #32 (ProjectsSection wiring, 2026-04-23)

**Problem:** `countMarkdownFiles(tree)` in ProjectsSection walks every entry and counts anything ending in `.md`. In practice this is correct today because `list_directory` defaults to `show_hidden=false` — so `.notesage/`, `.git/`, etc. never enter the tree. But if a future change lets hidden entries through (e.g., a debug toggle, a test fixture, or a setting we add), project rows could display bloated counts including meta files.

**Fix approach:** In `countMarkdownFiles`, skip entries whose `name.startsWith('.')` OR entries whose `hidden === true` (the FileEntry interface already has this field from `list_directory`). One-line change with a regression test.

**Scope:** S.

**Blockers:** none. Speculative — not a current bug.

## How to use this file

- Add entries here when a task returns with a well-scoped follow-up that's outside the numbered 100-task Phase 1 plan.
- One H2 section per follow-up, numbered `F1`, `F2`, …
- When a follow-up is picked up and landed, move its heading to mark `✅` the same way normal tasks do (via `git apply --cached` per the markdown-formatter workaround).
