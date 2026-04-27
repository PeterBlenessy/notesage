# Sidebar Simplification & TreeOverlay Removal — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-27 |
| **Status** | Not started |
| **Source audit** | [2026-04-27-quiet-composer-migration](../audits/2026-04-27-quiet-composer-migration.md) |
| **Related PRD** | [ui-refresh](../prds/2026-04-21-ui-refresh.md) (this work consolidates the sidebar follow-ups + TreeOverlay decision) |
| **Total** | 24 tasks across 11 milestones: ~5 S, ~13 M, ~6 L |
| **Suggested order** | M1 (#1–#2) → M2 (#3–#4) → M3 (#5–#7) → M4 (#8–#11) → M5 (#12–#16) → M6 (#17) → M7 (#18) → M8 (#19) → M9 (#20–#21) → M10 (#22) → M11 (#23–#24) |

## Scope

The 9-step sidebar simplification program from the 2026-04-27 audit, plus 2 related polish items (F1 cleanup-on-delete, F6 row memoization). Standalone bugs (action count in StatusTray, TaskMode grouping, Quick Capture decision, agent-orb toast, KeyboardShortcutsDialog drift, project-lock tooltip) are tracked separately as the "standalone bugs" chunk.

## Locked-in decisions (do not re-derive — resolved 2026-04-27)

1. TreeOverlay deleted entirely; `⌘⇧E` rebinds to **Open Export dialog** (multi-format).
2. Folders section between Projects and Recent. **No user-facing cap.** Visible when `folders.length > 0`. Hover-peek via existing `FolderPeek`. Inline expand on `→`. Right-click → Remove. `⌘O` dedup by canonical path. `⌘O` on `.notesage/` folders auto-promotes to Projects (existing behavior preserved).
3. Pinned and Projects already have NO cap (verified — no `sidebarPinnedCap` / `sidebarProjectsCap` exists in `settings-store.ts`). Tags / Mentions / Recents keep their slider.
4. **Quick Notes — no separate sidebar section.** Newly created Quick Notes auto-surface in Recent on creation.
5. **Persistent sidebar search input** at top of QuietSidebar. **Full workspace SQLite FTS** scope (reuses `index_search_content` from `src-tauri/src/index/mod.rs:835`). **Replaces the inline keystroke-capture filter in `QuietSidebar.tsx:118-161` entirely.** Auto-focus-on-first-printable-keystroke fallback when sidebar has focus. `Esc` clears + returns focus. Chord: **`⌘L`**.
6. In-document `#tag` / `@mention` click → cmd bar at level-2 occurrences (same drilldown payload as sidebar TagsSection / MentionsSection click).

## Sequencing constraints

- **Task #1 (keyboard-nav fix) MUST land first.** Folders section, search input, and inline-expand polish all inherit its bugs otherwise.
- **TreeOverlay deletion (#19) MUST come AFTER Folders + search input land** — never have a regression window where deep-tree access is gone with no replacement.

## Risks and open questions

- **Sidebar search FTS scope vs. command-bar `?` mode overlap.** Both use `index_search_content`; consider whether the sidebar search results panel should be visually distinct from the cmd-bar `?` results, or share a result-row component. Resolve during M5.
- **Quick Notes via tray menu — verify it already updates Recent.** If the existing tray-create path doesn't auto-add to Recent, M8 grows from 1 task to 2.
- **Auto-focus-on-keystroke fallback in M5.** Implementation needs to gate on "is the focused element NOT already a text input" so we don't hijack typing inside the search input itself or other inputs in the sidebar. Bug-prone; needs careful test coverage.
- **`⌘O` dedup canonical-path comparison.** macOS path canonicalization (`/var` vs `/private/var`, iCloud paths) needs verification to avoid false-negative dedups.
- **TreeOverlay tests deletion blast radius.** The component has its own test file; deleting it cascades to test imports across the sidebar test suite. M9 includes a "smoke test" task to catch dangling imports.

---

## M1. Keyboard-nav consistency (prerequisite for everything else)

### #1 — Fix sidebar keyboard-nav consistency bug ✅

| Field | Value |
| --- | --- |
| Title | Fix "sometimes a folder gets selected, sometimes the +" in QuietSidebar |
| Description | User-reported bug: keyboard navigation in QuietSidebar inconsistently selects rows vs. action buttons (e.g. the `+` add button next to a section header). Root-cause inside `useRovingTabindex.ts` (likely tabindex management when child action buttons are present) and `useSidebarItemShortcuts.ts` (key dispatch). Acceptance: pressing `↑/↓` always lands on a row (never on an action button); `Tab` cycles between section roots; arrow keys don't focus action-buttons unless the user explicitly tabs into them. |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `src/components/sidebar/quiet/useRovingTabindex.ts`, `src/components/sidebar/quiet/useSidebarItemShortcuts.ts`, sections that render action buttons (`ProjectsSection.tsx`, `PinnedSection.tsx`) |

### #2 — Regression tests for keyboard-nav fix ✅

| Field | Value |
| --- | --- |
| Description | Add unit tests covering: arrow nav skips over action buttons; Tab cycles to next section; Tab from a section root doesn't get caught on the `+` button; Enter on a row opens, Enter on a `+` button creates. Should fail on the bug behavior pre-fix. |
| Complexity | S |
| Category | frontend |
| Depends on | #1 |
| Files | `src/components/sidebar/quiet/__tests__/useRovingTabindex.test.ts` (new or extend existing) |

---

## M2. In-sidebar inline-expand polish for Projects

### #3 — Polish `→` / `←` inline-expand UX for Projects ✅

| Field | Value |
| --- | --- |
| Description | The in-sidebar inline expand exists today (per user feedback "the keyboard navigation is better, i.e. selecting a project then pressing the right arrow opens an in-sidebar folder treeview"). Make it rock-solid: `→` on a focused project row expands one level inline; `←` collapses; arrow-down enters the first child; arrow-up at the top child returns to the project root. Persist expand state per session (not localStorage — ephemeral, like RecentSection's filter state). |
| Complexity | M |
| Category | frontend |
| Depends on | #1 |
| Files | `src/components/sidebar/quiet/ProjectsSection.tsx`, `src/components/sidebar/quiet/useSidebarItemShortcuts.ts` |

### #4 — Tests for inline-expand keyboard flow ✅

| Field | Value |
| --- | --- |
| Description | Cover: `→` expands; `←` collapses; arrow-down enters child; arrow-up at top-child returns to parent; expand state survives section re-render but not full unmount. |
| Complexity | S |
| Category | frontend |
| Depends on | #3 |
| Files | `src/components/sidebar/quiet/__tests__/ProjectsSection.test.tsx` |

---

## M3. FolderPeek rewire (drop TreeOverlay coupling)

### #5 — Add `notesage:sidebar-expand-path` event + listener pattern ✅

| Field | Value |
| --- | --- |
| Description | New custom DOM event `notesage:sidebar-expand-path` with `{ projectPath, targetPath }` payload. ProjectsSection (and the upcoming FoldersSection) listen on `window` and inline-expand to the requested path when fired. Mirrors the `cmd-bar-events` pattern (typed event helper in a `lib/sidebar-events.ts` file). |
| Complexity | S |
| Category | frontend |
| Depends on | #3 |
| Files | `src/lib/sidebar-events.ts` (new), `src/components/sidebar/quiet/ProjectsSection.tsx` (listener) |

### #6 — Re-wire FolderPeek folder-clicks to dispatch `notesage:sidebar-expand-path` ✅

| Field | Value |
| --- | --- |
| Description | `FolderPeek.tsx:333-342` currently calls `onOpenTreeOverlay()` for both `handleFolderClick` and `handleTreeOverlay`. Replace with `emitSidebarExpandPath({ projectPath: rootPath, targetPath: clickedFolder.path })`. Drop the `onOpenTreeOverlay` prop from FolderPeek's interface. The "See full tree" button at the bottom of the peek either becomes "Expand in sidebar" (same dispatch with the project root as target) or is removed entirely — propose removal once inline-expand is solid. |
| Complexity | M |
| Category | frontend |
| Depends on | #5 |
| Files | `src/components/sidebar/quiet/FolderPeek.tsx`, every caller that passes `onOpenTreeOverlay` (find via `grep`) |

### #7 — Tests for FolderPeek rewire ✅

| Field | Value |
| --- | --- |
| Description | Cover: clicking a folder in the peek dispatches the expand event; clicking a file still opens it as a tab (unchanged); the event payload includes correct project + target paths. |
| Complexity | S |
| Category | frontend |
| Depends on | #6 |
| Files | `src/components/sidebar/quiet/__tests__/FolderPeek.test.tsx` |

---

## M4. Folders section

### #8 — `workspace-store.explorerFolders` dedup helper ✅

| Field | Value |
| --- | --- |
| Description | Add a canonical-path normalizer to `addExplorerFolder` so opening the same folder twice (`/Users/peter/foo` vs `/private/var/.../foo` vs symlinks) doesn't create duplicate entries. Use `tauriApi.canonicalize` (or equivalent) before comparison. On dedup hit, return the existing entry's id and emit a toast `"Folder already in sidebar"` from the calling site (`App.tsx:323-339`). |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `src/stores/workspace-store.ts`, `src/App.tsx` (handleOpenFolder) |

### #9 — Add `FoldersSection.tsx` component ✅

| Field | Value |
| --- | --- |
| Description | Clone `ProjectsSection.tsx` as `FoldersSection.tsx`. Read from `workspace-store.explorerFolders` instead of `projects`. Each row shows the folder basename. Hover-peek via existing `FolderPeek` component. Inline expand on `→` (using #5's event). Right-click → "Remove from sidebar" (calls `workspace-store.removeExplorerFolder`). NO cap, NO slider, NO settings UI. Render nothing when `explorerFolders.length === 0`. |
| Complexity | L |
| Category | frontend |
| Depends on | #1, #5, #8 |
| Files | `src/components/sidebar/quiet/FoldersSection.tsx` (new) |

### #10 — Mount FoldersSection in QuietSidebar ✅

| Field | Value |
| --- | --- |
| Description | In `QuietSidebar.tsx`, add `<FoldersSection filter={filter} />` between `<ProjectsSection />` and `<RecentSection />` (line ~199). Pass the same `filter` prop pattern. No settings toggle; no conditional render at the QuietSidebar level (FoldersSection self-hides when empty). |
| Complexity | S |
| Category | frontend |
| Depends on | #9 |
| Files | `src/components/sidebar/quiet/QuietSidebar.tsx` |

### #11 — Tests for FoldersSection + dedup ✅

| Field | Value |
| --- | --- |
| Description | Cover: section hides when no folders; section shows when ≥1 folder; right-click → Remove removes the folder from the store; `⌘O` on the same folder twice dedups (no duplicate row, toast fires); `⌘O` on a folder containing `.notesage/` adds to Projects, not Folders (existing behavior preserved). |
| Complexity | M |
| Category | frontend |
| Depends on | #10 |
| Files | `src/components/sidebar/quiet/__tests__/FoldersSection.test.tsx` (new), `src/stores/__tests__/workspace-store.test.ts` (extend) |

---

## M5. Persistent sidebar search input (replaces invisible filter)

### #12 — Replace inline keystroke-capture in QuietSidebar with visible `<Input>`

| Field | Value |
| --- | --- |
| Description | Remove the `useState<string>("filter")` + `keydown` listener block in `QuietSidebar.tsx:118-161` (the invisible filter capture). Add a visible `<Input ref={searchInputRef}>` at the very top of the sidebar (above Pinned), ~28px tall, magnifying-glass icon, "Filter sidebar…" placeholder. The input owns the `filter` state. Each section continues to receive `filter` as a prop (existing API unchanged). Remove `<FilterBadge />` (the input itself shows the current value). `Esc` clears the input. |
| Complexity | M |
| Category | frontend |
| Depends on | #1 |
| Files | `src/components/sidebar/quiet/QuietSidebar.tsx` |

### #13 — Auto-focus-on-first-printable-keystroke fallback

| Field | Value |
| --- | --- |
| Description | When the sidebar has focus (any sidebar element is the active descendant) and the user types a printable key, auto-focus the search input and pass through the keystroke. Gate on: target is NOT already a text input/textarea/contenteditable. Preserves the "just start typing" muscle memory the invisible filter provided, while the visible input remains the source of truth. Skip if `e.metaKey || e.ctrlKey || e.altKey` (don't hijack chords). |
| Complexity | M |
| Category | frontend |
| Depends on | #12 |
| Files | `src/components/sidebar/quiet/QuietSidebar.tsx` |

### #14 — Bind `⌘L` to focus the sidebar search input

| Field | Value |
| --- | --- |
| Description | In `useKeyboardShortcuts.ts`, add `⌘L` (no shift, no alt) handler that focuses the sidebar search input via a `notesage:focus-sidebar-search` event (or similar — pick the cleanest pattern). Update the JSDoc table at top of file. Verify `⌘L` is currently free (`grep` confirmed: only `⌘⇧L` is bound, to sidebar pin toggle). |
| Complexity | S |
| Category | frontend |
| Depends on | #12 |
| Files | `src/hooks/useKeyboardShortcuts.ts`, `src/components/sidebar/quiet/QuietSidebar.tsx` (event listener) |

### #15 — Add "Files matching" results section using `index_search_content` FTS

| Field | Value |
| --- | --- |
| Description | When the search input has a non-empty value, render a "Files matching" results list below the input (above Pinned). Calls `tauriApi.indexSearchContent({ projectPaths: <all known project paths>, query, limit: 25 })` (existing command at `src-tauri/src/index/mod.rs:835`). Each result row: file basename, dim path, click-to-open. Debounce input (150ms) before issuing the query. Loading state while the query runs. Empty state ("No files match") when results === 0. |
| Complexity | L |
| Category | frontend |
| Depends on | #12 |
| Files | `src/components/sidebar/quiet/QuietSidebar.tsx`, possibly a new `SidebarSearchResults.tsx` component if size warrants extraction |

### #16 — Tests for search input + FTS results

| Field | Value |
| --- | --- |
| Description | Cover: typing in the input updates per-section filter prop AND triggers FTS query (debounced); `Esc` clears input + restores focus to previously-focused row; auto-focus-on-keystroke when sidebar focused; `⌘L` from anywhere focuses the input; FTS results render below input; clicking a result opens the file as a tab; loading + empty states. Mock `indexSearchContent` in test setup. |
| Complexity | M |
| Category | frontend |
| Depends on | #15 |
| Files | `src/components/sidebar/quiet/__tests__/QuietSidebar.test.tsx` |

---

## M6. In-document tag/mention click → cmd bar

### #17 — Branch `useAppLifecycle` tag/mention handlers on `uiPreview` ✅

| Field | Value |
| --- | --- |
| Description | In `useAppLifecycle.ts:38-55`, the two handlers (`notesage:open-tag-search`, `notesage:open-mention-search`) currently call `onOpenPalette(...)` which is wired to the legacy `CommandPalette`. That component isn't mounted in Quiet Composer, so clicks do nothing. Branch on `useSettingsStore.getState().uiPreview === "quiet-composer"`. Quiet path: emit `cmd-bar-events` `{ type: 'focus', prefix: '#' or '@', drilldown: { kind: 'tag' or 'mention', name: tagOrMention } }` (same payload as `TagsSection.tsx:139`). Legacy path stays unchanged. Add a unit test covering both branches. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/hooks/useAppLifecycle.ts`, `src/hooks/__tests__/useAppLifecycle.test.ts` |

---

## M7. F1 cleanup on delete (extends to Recent)

### #18 — `forgetFile(path)` workspace-store action — cleanup pinned + recent on delete ✅

| Field | Value |
| --- | --- |
| Description | Add `forgetFile(path: string)` to `workspace-store.ts` that calls both `unpinFile(path)` and `removeRecent(path)` (or whatever the existing recent-remove action is named). Wire it into `useFileOperations.deletePath` and `useEditorStore.markTabDeleted`. Acceptance: deleting a file removes it from both Pinned and Recent within one render cycle. Tests: add a file to both, delete the underlying file, assert both stores no longer reference it. |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `src/stores/workspace-store.ts`, `src/hooks/useFileOperations.ts`, `src/stores/editor-store.ts` (if `markTabDeleted` lives there), `src/stores/__tests__/workspace-store.test.ts` |

---

## M8. Quick Notes auto-surface in Recent

### #19 — Verify Quick Notes via tray menu auto-add to Recent ✅

| Field | Value |
| --- | --- |
| Description | Verify that the existing tray "New Quick Note" path lands in `~/Notesage/<timestamp>.md` AND immediately surfaces in `workspace-store.recentFiles` (or wherever Recent reads from). If it doesn't, wire it up — the file-create path in the tray handler should call the same "track recent" logic the regular file-open uses. Acceptance: create a Quick Note via tray → it appears at the top of Recent in the sidebar without further action. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/App.tsx` (tray event handler), possibly `src-tauri/src/tray.rs` if a Tauri-side change is needed, recent-tracking store |

---

## M9. TreeOverlay deletion (only AFTER M3-M5 land)

### #20 — Delete TreeOverlay component, store, listener, prop chain

| Field | Value |
| --- | --- |
| Description | Delete: `src/components/sidebar/quiet/TreeOverlay.tsx`, `src/stores/tree-overlay-store.ts`, the `⌘⇧E` capture-phase listener in `QuietLayout.tsx:194-232`, the `<TreeOverlay />` mount in `QuietLayout.tsx:467`, the `onOpenTreeOverlay` prop on FolderPeek and any callers (#6 already removed it from FolderPeek itself). Delete TreeOverlay's test file. **Verify all M3-M5 tasks have shipped before opening this PR.** |
| Complexity | M |
| Category | frontend |
| Depends on | #6, #10, #15 |
| Files | `src/components/sidebar/quiet/TreeOverlay.tsx` (DELETE), `src/stores/tree-overlay-store.ts` (DELETE), `src/components/QuietLayout.tsx`, every caller (find via `grep -r 'TreeOverlay\|tree-overlay-store'`) |

### #21 — Smoke test: no dangling imports after TreeOverlay deletion

| Field | Value |
| --- | --- |
| Description | Run `pnpm typecheck` AND `pnpm test` AND `pnpm test:e2e` after the deletion. Fix any dangling imports. Add a tiny grep-based check to `scripts/` that fails CI if `TreeOverlay` or `tree-overlay-store` strings appear anywhere in `src/` (catches future regressions where someone re-introduces them). Could live as a `scripts/no-treeoverlay.sh` or be folded into an existing lint step. |
| Complexity | S |
| Category | frontend |
| Depends on | #20 |
| Files | `scripts/no-treeoverlay.sh` (new), CI config if applicable |

---

## M10. ⌘⇧E rebinding to Open Export dialog

### #22 — Re-bind `⌘⇧E` to Open Export dialog (multi-format)

| Field | Value |
| --- | --- |
| Description | The `⌘⇧E` chord was preempted by QuietLayout's capture-phase listener (now removed in #20). The legacy bubble-phase handler in `useKeyboardShortcuts.ts:362-371` already opens the Export dialog — verify it now reaches Quiet Composer too. Update the dialog name in any user-facing strings from "Export as PDF" to just "Export" (multi-format: PDF/DOCX/PPTX/HTML). Update the JSDoc table at top of `useKeyboardShortcuts.ts`. Update `src/components/KeyboardShortcutsDialogV2.tsx` File Operations row from `⌘⇧P` (commands palette workaround) back to `⌘⇧E` Export. |
| Complexity | S |
| Category | frontend |
| Depends on | #20 |
| Files | `src/hooks/useKeyboardShortcuts.ts`, `src/components/KeyboardShortcutsDialogV2.tsx`, `src/components/ExportDialog.tsx` (verify title) |

---

## M11. F6 row memoization + perf budget tightening

### #23 — Memoize sidebar row components

| Field | Value |
| --- | --- |
| Description | Wrap `PinnedRow`, `RecentRow`, `ChildRow` (in ProjectsSection / FoldersSection), `ProjectRow`, `FolderRow` in `React.memo`. Lift event handlers to `useCallback` with stable deps in the parent so the memo'd children don't re-render on every keystroke. Verify with the perf benchmark that N=2000 keystroke time drops to the 50ms target. |
| Complexity | M |
| Category | frontend |
| Depends on | #9, #12 |
| Files | `src/components/sidebar/quiet/PinnedSection.tsx`, `RecentSection.tsx`, `ProjectsSection.tsx`, `FoldersSection.tsx` |

### #24 — Tighten `FIRST_KEYSTROKE_BUDGETS` perf budget to 50ms

| Field | Value |
| --- | --- |
| Description | After #23, update `src/perf/sidebar-filter.perf.test.tsx` `FIRST_KEYSTROKE_BUDGETS` constants from the current jsdom-ceiling values (8000ms) to the spec target (50ms first keystroke, 20ms subsequent). The test should pass at the tighter budget after memoization. If it doesn't, profile and fix before merging. |
| Complexity | S |
| Category | test |
| Depends on | #23 |
| Files | `src/perf/sidebar-filter.perf.test.tsx` |

---

## Documentation updates (bundle into the relevant landing PRs)

These aren't standalone tasks — fold each doc update into the PR for the corresponding code change so docs land with code (per Notesage convention).

| Doc | Update | Bundles with |
| --- | --- | --- |
| `docs/architecture.md` | Strip TreeOverlay from quiet sidebar inventory (line 116). Strip `tree-overlay-store` from store table (line ~245). Add `FoldersSection.tsx` to quiet sidebar inventory. Add `lib/sidebar-events.ts` to lib utilities | #20, #9, #5 |
| `docs/features/editor.md` | Remove TreeOverlay references; document the visible sidebar search input + `⌘L` chord | #20, #14 |
| `docs/features/workspace.md` | Document Folders section behavior; document `⌘O` dedup | #9, #8 |
| `docs/keyboard-shortcuts.md` | Rebind `⌘⇧E` description to "Open Export dialog (multi-format)"; add `⌘L` "Focus sidebar search"; remove TreeOverlay row | #22, #14, #20 |
| `docs/design-system.md` | Strip the "Tree Overlay (⌘⇧E)" subsection of the Quiet Composer Layout chapter; document the persistent sidebar search input pattern | #20, #15 |

---

## Ship gate

The full program is shipped when:

- [ ] All 24 tasks merged
- [ ] `pnpm test`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm test:perf` all pass
- [ ] No `TreeOverlay` / `tree-overlay-store` strings remain in `src/` (#21 enforces)
- [ ] Manual smoke: `⌘O` a folder → row appears in Folders section; `⌘O` again → toast, no duplicate; `⌘O` a folder with `.notesage/` → lands in Projects; click `#tag` in editor → cmd bar opens at occurrences; type in sidebar search input → FTS results render; `⌘L` from anywhere focuses search input; `⌘⇧E` opens Export dialog
- [ ] Audit `2026-04-27-quiet-composer-migration.md` findings #1, #7, #11, #13, #14, #15 marked resolved (#1 by #17; #7 + #14 by #20; #11 by #12+#15; #13 by #9-#11; #15 by #19)
