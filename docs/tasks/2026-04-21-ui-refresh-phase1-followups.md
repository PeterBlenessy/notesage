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

## F6 — Memoize PinnedRow / RecentRow / project rows for type-to-filter scaling

**Surfaced by:** Batch M1.8 / task #91 (sidebar-filter perf, 2026-04-23)

**Problem:** Type-to-filter at N=2000 pinned + N=2000 recent items takes ~6.2s in jsdom (real Chromium is 5–10× faster, so still ~600ms — well above the 50ms spec target). Each keystroke causes React to re-render every row in PinnedSection, RecentSection, and the flat ProjectsSection child rows because none of the row components are wrapped in `memo`. The `#91` perf test currently sets the N=2000 first-keystroke budget to 8000ms (jsdom ceiling) — a smoke test, not a regression lock.

**Fix approach:** Wrap `PinnedRow`, `RecentRow`, and `ProjectsSection`'s `ChildRow` / `ProjectRow` in `React.memo` with stable callback refs (use `useCallback` for `onOpen` / `onStartRename` / etc. in the parent). Or push the filter to a CSS class so non-matching rows don't unmount — but memo is simpler. After memoization, tighten `FIRST_KEYSTROKE_BUDGETS` in `src/perf/sidebar-filter.perf.test.tsx` toward the spec target (50ms) — that's the regression-lock value.

**Scope:** M. ~5–10 callback refs to lift, four row components to wrap, perf budgets to tighten + verify they pass.

**Blockers:** none. Production users rarely have >50 items in either section, so this is performance hygiene, not a user-facing bug.

## F7 — Mount the editor inside QuietLayout center column (Phase 2 scope)

**Surfaced by:** First-user trial of the Quiet Composer Preview, 2026-04-23

**Problem:** `QuietLayout.tsx` line 264–269 renders `<div data-doc-area-placeholder>Document area (placeholder)</div>` instead of the actual Tiptap editor. Clicking a file in the QuietSidebar opens it in `editor-store` but the editor itself never mounts in the new shell. Phase 1 built the perimeter (sidebar, doc-head, command bar, orb, overlay) but the `Editor` component / `EditorContent` / `Toolbar` were never wired in.

**Fix approach:** Port the editor mount from `Layout.tsx` (which renders `<Editor />` from `src/components/editor/Editor.tsx`). Replace the placeholder div with the real component. May need to also mount `<FindBar />`, the floating `<Toolbar />`, and the editor-area chrome that lives alongside the editor. Verify `editor-store` integration (active tab → editor content) flows through.

**Scope:** L. This is a Phase 2 cornerstone task — the Quiet Composer is unusable without it.

**Blockers:** none, but this is the largest gap in Phase 1; everything else is polish without this.

## F8 — Mount the chat panel inside QuietLayout right column (Phase 2 scope)

**Surfaced by:** Same trial as F7

**Problem:** When the FloatingCommandBar is NOT in pinned mode, the right column is `<ZonePlaceholder label="Reserved (placeholder)" />`. The classic Layout has `<ChatPanel />` in this slot. The intent for QuietLayout was for the FloatingCommandBar (pinned mode) to BE the chat surface, but unpinned mode leaves the slot empty — and even pinned, there's no separate "agent activity panel" surface (only the orb-anchored Popover).

**Fix approach:** Decide whether the right column in QuietLayout's unpinned mode shows (a) nothing — keep the column for layout balance only, removing the placeholder text; (b) a compact "Recent threads" rail; or (c) the full ChatPanel for users who want both surfaces. Probably (a) is correct — the FloatingCommandBar IS the chat. Replace the `ZonePlaceholder` with either an empty div or the full ChatPanel based on the resolved decision.

**Scope:** S–M depending on decision.

**Blockers:** depends on F7 (editor mount); this is the second gap blocking real use.

## F9 — TitleBar in QuietLayout still shows legacy chat / agent toggle buttons

**Surfaced by:** Same trial — title bar visual leak, 2026-04-23

**Problem:** `<TitleBar onToggleChat={noop} onToggleActivityStrip={noop} />` in `QuietLayout.tsx` line 251 mounts the same TitleBar as the legacy Layout, including the chat-toggle and agent-strip-toggle buttons. In Quiet Composer those buttons do nothing (the props are `noop` stubs), but the buttons still render — visual clutter that contradicts the "calmer UI" promise.

**Fix approach:** Either (a) extend `TitleBar` with `mode?: 'classic' | 'quiet'` to suppress the toggle buttons in quiet mode, or (b) make them conditional on the prop being a real handler vs `noop`. Option (a) is cleaner.

**Scope:** S. Single component prop + conditional render.

**Blockers:** none.

## F10 — TreeOverlay covers macOS traffic-light buttons; ⌘⇧E toggle + Esc dismiss broken

**Surfaced by:** Same trial — TreeOverlay UX, 2026-04-23

**Problem:** Pressing `⌘⇧E` while TreeOverlay is open does NOT close it (it's open-only, never toggle). Esc doesn't dismiss reliably either — the user needs to click in the document area to close. Additionally, the overlay's `top: 0` positioning covers the macOS window-control buttons (red/yellow/green) at the top-left, blocking close/minimize/maximize.

**Fix approach:**
- Make `⌘⇧E` toggle: in `QuietLayout.tsx` line 117–150, check `useTreeOverlayStore.getState().open` and call `closeOverlay()` if true.
- Verify Esc handling: `TreeOverlay.tsx` line 426 has the keydown handler, but it depends on focus being inside the overlay. The search input auto-focuses on open, so Esc SHOULD work — investigate whether focus is escaping the overlay or whether some intermediate component is swallowing the key.
- Move the overlay's `top: 0` down by the `--titlebar-inset` (~28px on macOS) so it sits below the traffic lights. Or add `padding-top` to the overlay's first row so the top of the search input clears the controls.

**Scope:** S. Three small fixes.

**Blockers:** none.

## F11 — Document name should appear in window title bar

**Surfaced by:** Same trial, 2026-04-23

**Problem:** In QuietLayout, the active document name appears in the DocHead breadcrumb (project / folder / file.md) but NOT in the macOS window title (the OS title bar at the very top, which is usually "Notesage" — should be e.g. "Notesage — file.md" or "file.md — Notesage" per macOS convention). Power users use ⌘` (window switcher) and rely on the title-bar text to find the right window.

**Fix approach:** Extend `TitleBar` (or wherever the window title is set — possibly `document.title` driven by an effect on active tab change) to set the title to `${activeFileName} — Notesage` when a document is active, falling back to `Notesage` when no tab is open. The classic Layout has the same gap; consider fixing both surfaces.

**Scope:** S. One effect in `App.tsx` (or `useAppLifecycle`) reading from `editor-store`.

**Blockers:** none.

## F12 — AgentOrb hover state lacks polish

**Surfaced by:** Same trial — orb visual, 2026-04-23

**Problem:** The AgentOrb uses `hover:scale-105` (a 5% scale grow on hover) per `AgentOrb.tsx`, which is subtle. The user expected richer hover feedback — possibly a soft glow ring, a tooltip showing "Agent — N tasks running" on hover, or a small label preview next to the orb.

**Fix approach:** Add either (a) a Radix Tooltip with the same aria-label text, (b) a soft `box-shadow` ring on hover via `hover:shadow-lg` or a custom glow, or (c) both. Keep it subtle — the orb is meant to be ambient, not attention-grabbing.

**Scope:** S. Component-only change, no store work.

**Blockers:** none. Pure polish.

## How to use this file

- Add entries here when a task returns with a well-scoped follow-up that's outside the numbered 100-task Phase 1 plan.
- One H2 section per follow-up, numbered `F1`, `F2`, …
- When a follow-up is picked up and landed, move its heading to mark `✅` the same way normal tasks do (via `git apply --cached` per the markdown-formatter workaround).
