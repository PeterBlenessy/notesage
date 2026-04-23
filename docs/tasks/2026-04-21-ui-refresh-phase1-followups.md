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

## How to use this file

- Add entries here when a task returns with a well-scoped follow-up that's outside the numbered 100-task Phase 1 plan.
- One H2 section per follow-up, numbered `F1`, `F2`, …
- When a follow-up is picked up and landed, move its heading to mark `✅` the same way normal tasks do (via `git apply --cached` per the markdown-formatter workaround).
