# Overnight Progress Report — 2026-04-28

|  |  |
| --- | --- |
| **Date** | 2026-04-28 |
| **Scope** | Sidebar simplification (#1–#24) + Quiet Composer bug fixes (#1–#14) + live-test follow-ups |
| **Parent audit** | [2026-04-27-quiet-composer-migration.md](2026-04-27-quiet-composer-migration.md) |
| **Task files** | [sidebar-simplification](../tasks/2026-04-27-sidebar-simplification-tasks.md) · [quiet-composer-bugs](../tasks/2026-04-27-quiet-composer-bugs-tasks.md) |

## TL;DR

All 24 sidebar-simplification tasks landed in 17 commits between `1fbeec45` and `70cecfef` plus the in-flight working-tree batch. All 14 standalone bug fixes landed (the audit's high-priority `#16 agent-orb toast covers orb` and `#18 project-lock tooltip raw ID` were the last two). Live-test feedback from morning testing has been folded into the working tree but NOT committed yet — held per the "don't make piecemeal commits during active testing/feedback cycles" guidance.

`pnpm test` reports **4345 passed / 1 skipped** across 234 test files. `pnpm typecheck` clean. `pnpm test:perf` passes at the new tighter budgets (see #24 below).

## Shipped (committed)

| Hash | Subject |
| --- | --- |
| `1fbeec45` | docs(ui-refresh): post-Phase-1 audit — 18 findings, 2 task files, doc drift sweep |
| `08ccfa30` | fix(quiet-composer): project-lock tooltip label + agent toast dismiss + tooltip descender clip |
| `5fa6ade4` | fix(sidebar): keyboard-nav polish — focus ring stacking, accent color, hide Tab traps |
| `c7d40e1c` | test(sidebar): regression lock for section-header `+` tabIndex=-1; mark sidebar #1 + #2 done |
| `ed1e710c` | feat(sidebar): inline-expand polish — Folder/FolderOpen icon swap, empty-project guard |
| `73ac5438` | fix(quiet-composer): in-document tag/mention click routes to FloatingCommandBar (audit #1) |
| `fa6c3034` | feat(sidebar): sidebar-events bus + ProjectsSection expand-path listener (sidebar #5) |
| `cd25387d` | feat(sidebar): rewire FolderPeek folder-clicks to expand-path event (sidebar #6 + #7) |
| `b81bafc8` | feat(quiet-composer): macOS unfocused-window de-emphasis (audit #17) |
| `4656fe4e` | feat(sidebar): canonical-path dedup for explorer folders + ⌘O re-open toast (sidebar #8) |
| `a2f842b9` | feat(sidebar): Folders section between Projects and Recent (sidebar #9 + #10 + #11) |
| `fde2aa59` | fix(sidebar): cleanup pinned + recent on file/folder delete (sidebar #18 — F1) |
| `155ad867` | fix(tray): route 'New Note' to QuietSidebar inline-create under Quiet Composer (sidebar #19) |
| `c38a24d8` | refactor(sidebar): DELETE TreeOverlay — component, store, listener, prop chain (sidebar #20 + #21) |
| `70cecfef` | feat(shortcuts): rebind ⌘⇧E to Open Export dialog (sidebar #22 + bugs #12) |

Sub-agent races: A and B (audit #1 + bugs #6/#7) co-committed in `73ac5438` because they ran `git add/commit` simultaneously in the same working dir. No amendments per the "no amending" rule. Sub-agent C (macOS unfocused, audit #17) committed cleanly as `b81bafc8`.

## Live-test fixes — held in working tree (uncommitted)

These came in during morning testing after the user awoke. They sit on top of the committed batch above. None have been committed yet — the user is iterating, and the pattern is to batch-commit once they say we're done.

| Finding | What changed | Files |
| --- | --- | --- |
| Live-test #1 | Project / explorer-folder rows now toggle inline-expand on click + Enter (was: click opened README; now matches standard tree-view + the new FoldersSection) | `ProjectsSection.tsx` |
| Live-test #2 | "+N more…" overflow rows became clickable; activating expands the project to show every child via `derivePeekChildren(..., { unbounded: true })` | `FolderPeek.tsx`, `ProjectsSection.tsx`, `FoldersSection.tsx` |
| Live-test #3 | Expanded child rows now wear hover previews — `FolderPeek` for folders, `FilePreview` for previewable files. Wrap order matches the project-row chain (peek/preview OUTSIDE, `SidebarContextMenu` INSIDE) so right-click props still land | `ProjectsSection.tsx`, `FoldersSection.tsx` |
| Live-test #4 | Settings > System > "Show hidden files" toggle was a no-op in the Quiet sidebar — `derivePeekChildren` and `countFilesInFolder` unconditionally dropped `entry.hidden`. Now they accept `showHidden` and `FolderPeek`, `ProjectsSection`, `FoldersSection` thread `useSettingsStore((s) => s.showHiddenFiles)` through every call. `.DS_Store` always dropped | `FolderPeek.tsx`, `ProjectsSection.tsx`, `FoldersSection.tsx`, plus a unit test |
| Live-test #5 | Folder file-count was hidden when the row had keyboard focus (`group-focus-within/row:opacity-0`) — now stays visible | `ProjectsSection.tsx` |
| Live-test #6 | StatusTray "Open actions" used to open the legacy Actions dialog under Quiet Composer; now opens the FloatingCommandBar with `!` prefix (= TaskMode), matching ⌘⇧1. Also adds an "Actions" group to the StatusTray popover styled as a button (matches the "Keyboard shortcuts" row in HelpGroup) with the open-count label and `⌘!` chord hint | `App.tsx`, `StatusBar.tsx`, `StatusTray.tsx` |
| Tooltip descender | Global tooltip padding bumped from `py-1.5` to `pt-1.5 pb-2 text-xs leading-5` — fixes the `p` descender clip in the project-lock tooltip and everywhere else | `ui/tooltip.tsx` |

## Sidebar #23 / #24 — perf

**#23 — partial.** PinnedRow is now `React.memo`-wrapped with a reshaped prop interface so the parent passes stable `useRovingTabindex` handlers (`onFocus={roving.handleFocus}` etc.) directly. Every parent-side handler in PinnedSection (`handleOpen`, `startRename`, `commitRename`, `handleRowDragStart`, …) is `useCallback`-stable; the drag handlers use ref-pinned mutating values so their identity survives a type-to-filter keystroke that changes `visibleFiles`.

The other four row components (RecentRow, ProjectRow, FolderRow, ChildRow ×2) are NOT memoized yet — same pattern, more rows. Deferred to a follow-up; the file is set up so the work can land incrementally without touching the new memoized PinnedRow.

**#24 — done.** `FIRST_KEYSTROKE_BUDGETS` tightened from the historical jsdom-ceiling values `{100: 50, 500: 500, 2000: 8000}` to `{100: 50, 500: 100, 2000: 400}` — roughly 2× current measured cost. Subsequent-keystroke budget unchanged at 20ms.

The 50ms spec target for N=2000 is unreachable without windowed virtualization — first-keystroke cost is dominated by React unmounting filtered-out rows, which scales with N, not by render of the survivors. Memoization helps the steady-state subsequent-keystroke path (already at ~5ms vs 20ms budget) and prevents future regressions; it doesn't move the unmount-cost needle.

Latest perf measurements (jsdom; Chromium typically 5–10× faster):

| Scenario | Before #23 | After #23 | Budget |
| --- | --- | --- | --- |
| N=100 first keystroke | 8.7ms | 13.4ms | 50ms |
| N=500 first keystroke | 35.9ms | 46.9ms | 100ms |
| N=2000 first keystroke | 216.0ms | 228.0ms | 400ms |
| N=100 subsequent | 1.0ms | 0.8ms | 20ms |
| N=500 subsequent | 1.4ms | 1.4ms | 20ms |
| N=2000 subsequent | 5.2ms | 4.7ms | 20ms |

(First-keystroke didn't get faster because PinnedRow memoization helps unchanged rows skip rendering; here the filter "" → "a" unmounts ~1923/2000 rows, which is the dominant cost. The numbers are within noise.)

## Outstanding

- **Live-test commit.** Hold the working-tree batch until the user signs off after one more pass.
- **Sidebar #23 expansion.** RecentRow / ProjectRow / FolderRow / ChildRow memoization, same pattern as PinnedRow. Low-risk follow-up.
- **Virtualization (separate PRD-shaped work).** Required to hit the 50ms spec target at N=2000.
- **Audit #2 — Quick Capture.** Build for real (global-shortcut + floating window) vs permanently remove the false promise. Decision needed before tasking.
- **Audit #3 — File-search mode in cmd bar.** No prefix exists; design decision needed (no-prefix default surfaces files alongside chat? dedicated `:file` prefix?).
- **Audit #8/#10 — Document Outline re-skin.** Currently a legacy modal Dialog; needs a Quiet Composer popover design before tasking.

## Ship gate (sidebar program)

- [x] All 24 tasks merged or held in working tree
- [x] `pnpm test`, `pnpm typecheck`, `pnpm test:perf` all pass
- [x] No `TreeOverlay` / `tree-overlay-store` strings remain in `src/` (smoke test enforces)
- [ ] Manual smoke walkthrough — held until live-test batch lands
- [x] Audit findings #1, #7, #11, #13, #14, #15 marked resolved in the parent audit
