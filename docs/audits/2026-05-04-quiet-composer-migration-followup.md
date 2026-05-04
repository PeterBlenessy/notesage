**Date:** 2026-05-04
**Parent audit:** [2026-04-27-quiet-composer-migration.md](2026-04-27-quiet-composer-migration.md)

---

## Resolved since 2026-04-27

- **Finding #1 — In-document tag/mention click broken.** Fixed via sidebar-simplification task #17 (✅). Tag/mention click now routes through `cmd-bar-events` with the correct prefix in Quiet Composer.

- **Finding #2 — Quick Capture not shipped.** Confirmed removed end-to-end. Regression lock exists: `src/components/cmd/__tests__/no-quick-capture.test.ts` asserts no `'quick-capture'` literal or `quickCapture` identifier remains in `src/`. `Cargo.toml` contains no `tauri-plugin-global-shortcut`.

- **Finding #4 — Action count missing from StatusTray.** `ActionsGroup` implemented at `StatusTray.tsx:503–534`. Reads `useActionStore(s => s.getOpenCount())`, renders "N open actions" or muted "No open actions", wired to `onOpenActions` callback at line 860. Bugs task markers for #3–#5 were never flipped to ✅ (bookkeeping gap — the code is complete).

- **Finding #16 — Agent-orb toast covers orb.** Bugs task #2 ✅. `notify('agent_completion', ...)` in `src/lib/notifications.ts` now passes `dismissible: true` with an explicit × close button. The toast and orb still share the bottom-right corner but the dismiss affordance makes the orb reachable without waiting.

- **Finding #18 — Project-lock tooltip shows raw connection ID.** Bugs task #1 ✅. `SidebarRowIndicators.tsx:85–92` now resolves `aiLock.connectionId` through `useConnectionsStore` and renders `lockedConnection.label` when available, with an `(unavailable)` suffix as fallback.

- **Finding #8/#9/#10/#11 — Inactive-window de-emphasis.** Bugs tasks #8–#11 all ✅. CSS token `--color-accent-primary-inactive`, `useWindowFocus()` hook, and `data-window-inactive` attribute are shipped. Contrast audit test in place.

- **Sidebar-simplification milestones M1–M4, M6–M10 (tasks #1–#11, #17–#22, #24).** All marked ✅. TreeOverlay deleted (#20–#21 ✅); `⌘⇧E` rebound to Export (#22 ✅); FolderPeek rewired to inline expand; Folders section complete.

---

## Still open

- **Finding #5 — KeyboardShortcutsDialogV2 drift (chord conflict).** `src/components/KeyboardShortcutsDialogV2.tsx:78` still lists `"Tree overlay (workspace tree)" → ⌘⇧E` in the Navigation section, while line 44 correctly shows `"Export (PDF / DOCX / PPTX / HTML)" → ⌘⇧E` in File Operations. The stale Navigation entry survived the TreeOverlay deletion (#20), creating a duplicate-chord inconsistency. Bugs task #12 (post-sidebar KB dialog verification) is marked ✅ but missed this line.

- **Sidebar-simplification M5 (tasks #12–#16) — NOT STARTED.** The persistent visible sidebar search input is unimplemented. `QuietSidebar.tsx:197` still uses the invisible `FilterBadge` (keystroke-capture badge with no visible input element). Tasks #12 (replace with `<Input>`), #13 (auto-focus fallback), #14 (`⌘L` binding), #15 (FTS results section), and #16 (tests) have no markers. The sidebar spec calls for a visible, focusable input; the current behavior is invisible and undiscoverable without reading docs.

- **Sidebar-simplification #23 (row memoization) — 🚧 partial.** Only `PinnedRow` is memoized; `RecentRow`, `ProjectRow`, `FolderRow`, `ChildRow` are deferred per the task file note.

- **Bugs tasks #3–#5 markers missing.** `ActionsGroup` is fully implemented in code (see Resolved above) but the three task entries remain unmarked. Task file needs a cleanup pass.

- **Sidebar-simplification ship-gate checklist incomplete.** The M11 gate checklist item `"type in sidebar search input → FTS results render"` cannot pass until M5 ships.

---

## New gaps

- **Duplicate ⌘⇧E in `KeyboardShortcutsDialogV2`.** The same chord appears at line 44 ("Export") and line 78 ("Tree overlay") — the Navigation section was not updated when TreeOverlay was deleted. This is user-visible: the in-app shortcut reference contradicts the shipped behavior.

- **`FloatingCommandBar.tsx:843` TODO.** A `TODO(#25 / future)` comment about replacing the inline-text fallback with a structured response exists. Not blocking, but worth tracking if it accumulates.

- **No `uiPreview` branches added since 2026-04-27.** `grep -rn 'uiPreview' src/` returns the same 30+ gate sites as before the week began — no new uneven retrofits detected.
