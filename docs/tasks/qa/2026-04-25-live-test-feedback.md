# Live-test feedback — 2026-04-25

Resume point after a `/clear`. Read this file and the related code, then tackle items in priority order.

**Setup:**
- All Phase 1 code is shipped to `main` (commits up to `dfeb406`).
- Most issues below are bugs in shipped fixes, not unimplemented features.
- The dev session wasn't running the worktree; the user tests against `pnpm tauri dev` which reads `main`.

---

## P0 — Broken / regressed

### #138 — Skill picker still reopens on backspace; input loses focus
**Status:** unfixed. The previous `dismissedPrefixRef` suppression in `FloatingCommandBar.recomputePrefix` doesn't hold — the picker re-mounts and steals focus once typing resumes after Esc.

Likely root causes to investigate before patching:
1. Verify `dismissedPrefixRef` is actually populated when Esc fires from outside the input (the bus path in `subscribeToCmdBarEvents`). Add a `console.log` of the ref value AT the start of `recomputePrefix`.
2. Check if there's a second code path that bypasses `recomputePrefix` and calls `setActivePrefix` directly — search for all `setActivePrefix(` in the file.
3. Check whether the picker (e.g. `SkillMode`) has its own auto-focus on mount that competes with the input's autofocus.

Acceptance: type `/de`, Esc, then Backspace twice — input keeps focus, no skill picker re-opens until the user re-types `/`.

---

### #139 — ⌘⇧E twice in a row opens TreeOverlay then Export dialog
**Status:** unfixed. First press toggles TreeOverlay open. Second press toggles overlay closed (correct), but ALSO falls through to the legacy export handler.

Where to look:
- `QuietLayout.tsx` capture-phase listener around line 175. It calls `event.stopImmediatePropagation()` only when not inside the overlay search box.
- After overlay closes (`toggleOverlay()` flips `open` to false), the `[data-tree-overlay]` element unmounts. On the SECOND keypress, the focused element is no longer inside the overlay (because it just closed) — so the listener still preempts? OR maybe focus moved BACK to the editor by the close-restore logic, and the next press is treated as "outside overlay" → preempts. But then export shouldn't fire.
- Possible: `stopImmediatePropagation` doesn't stop the DEFAULT action that the legacy `useKeyboardShortcuts` hook sets via `e.preventDefault()` + `callbacks.onExportOpen()`. The legacy hook uses `addEventListener` without capture, so capture-phase should fire first. But if QuietLayout's effect is unmounted somehow between presses…
- Try: log inside QuietLayout's listener for both keypresses to confirm it fires. If only first press hits, the listener got unregistered.

Acceptance: ⌘⇧E ⌘⇧E in succession toggles TreeOverlay open then closed. Export dialog never appears under Quiet Composer.

---

### #140 — Right-click on project + child rows STILL opens OS native menu
**Status:** unfixed despite wrapping `<ProjectRow>` and `<ChildRow>` in `<SidebarContextMenu>` in `ProjectsSection.tsx`.

Where to look:
- The shadcn `<ContextMenu>` wraps with `<ContextMenuTrigger asChild>`. Verify the trigger element actually receives the right-click. The `ProjectRow` / `ChildRow` are `<div>` elements — should accept asChild.
- Check if any inner element calls `event.stopPropagation()` on `onContextMenu` and breaks the bubble path to the trigger.
- Check that the `ContextMenuContent` doesn't have `display: none` for some reason (Radix portal misconfig).
- Also: `FolderPeek` or `FilePreview` wraps the row externally — see if their `onContextMenu` stops the event before it reaches the SidebarContextMenu.

Acceptance: right-click any project row OR child file/folder row → our context menu opens with the full Quiet sidebar action set.

---

### #141 — Recent rows still show project name (parent path) instead of "2h" / "1d"
**Status:** half-fixed. New recent files DO get `lastAccessedAt` stamped (verified in `editor-store.openTab`), but the user's existing recents from before the migration don't have it, so they fall back to `parentHint`.

Two-part fix:
1. Backfill `lastAccessedAt` for pre-existing recent files. Either (a) on persist/rehydrate migration, set to `Date.now() - (index * 60_000)` so the order maps to relative ages, or (b) drop the parent-hint fallback entirely (always show "—" or nothing if no timestamp).
2. Verify the live test by opening a fresh file and confirming the new entry shows e.g. "now" or "1m".

Acceptance: every Recent row shows a relative-time hint; opening an old file refreshes its hint.

---

### #142 — Translucent chrome doesn't actually look translucent
**Status:** unfixed. User reports the title bar still appears opaque even with `quietChromeTransparent` toggle ON.

Root cause analysis:
- TitleBar gets `bg-background/70 backdrop-blur-md` applied via the `cn` in `TitleBar.tsx` when `props.className?.includes("absolute")`.
- BUT QuietLayout's grid was given `pt-11` to clear the absolute title bar. So the doc area starts at y=44px and never extends BEHIND the title bar.
- Without content behind it, the title bar's translucent bg blends with the layout root (also `bg-background`) → looks identical to opaque.

Fix:
1. Remove `pt-11` from the doc area (or set to 0).
2. Add equivalent padding INSIDE the Editor's scroll region (e.g. on the ProseMirror content wrapper) so initial markdown content sits below the title bar at start, but scrolls UP behind it.
3. Verify by opening a file with a code block / image near the top and scrolling — block should pass behind a frosted title bar.

Acceptance: scroll an image to the top of the editor → image is partially visible through a frosted title-bar layer.

Same root cause applies to the StatusBar — the editor's scroll region needs bottom padding too if we want content to flow under the StatusBar.

---

## P1 — Visual / UX gaps still open

### #143 — Settings panel padding too generous vs mockup-e
`SettingsShell.tsx` right column wraps content in `mx-auto w-full max-w-[640px] px-6 py-6`. Mockup-e has tighter inner padding. Compare and reduce.

### #144 — Accent colors don't apply when selected
User picks an accent (orange/blue/system) in Appearance settings — UI doesn't update. The `--accent` CSS variable isn't being set on `<html>` or the click handler isn't wired. Investigate `AppearanceSettings.tsx` accent radio handler + `ThemeProvider`.

### #145 — AI connection config opens legacy dialog
From the new AI panel, clicking "Add Connection" or editing one opens the OLD `AddConnectionDialog` / config. Either rebuild those sub-dialogs to match v2 chrome or accept the inconsistency in writing.

### #146 — About → View changelog opens legacy dialog
Same pattern as #145.

### #147 — Settings ⌘F filter only matches nav titles, not row content
`SettingsSearchContext` is consumed by `SettingsRow` for matching, but the filter pipe in `SettingsDialogV2` only narrows the nav. Verify `useSettingsSearchQuery()` is read by every panel and rows hide on no-match.

### #148 — Floating toolbar centered relative to editor, not app
The pill toolbar (`Editor.tsx`, line ~630, `absolute top-3 left-1/2 -translate-x-1/2`) is centered inside its parent `relative` container — which is the editor area, not the app. The TitleBar / cmd bar / revert banner are centered relative to the app. Decide which centering is canonical and align.

### #149 — Edit-mode Esc still collapses bar immediately
After clicking Edit on a user message, the "Editing message" banner appears. Pressing Esc collapses the bar instead of cancelling the edit first.

The bus dismiss handler IS supposed to check `editContextRef.current` BEFORE calling `collapse()`. Verify the ref is populated when `handleStreamEdit` fires (it sets `editContext` state; the `useEffect` mirrors to ref). Could be a stale closure issue or the order of state updates.

### #150 — Focus mode redo per mockup-f
Current implementation: padding-top: 140px pushes the document down; title bar still visible.
Mockup-f: title bar HIDDEN entirely; document occupies full height; only the small `<FocusPill>` exit affordance at top.

Fix: in `globals.css` `.app.focus-mode [data-titlebar-mode="quiet"]` set `display: none` (or opacity 0 + pointer-events-none). Doc area padding can drop back to a small value (or 0). Test that the focus pill remains visible at top-center.

### #151 — Cmd bar text input doesn't grow vertically; attachments above input
Legacy ChatInput uses a `<textarea>` with auto-resize. Attachments render INSIDE the input area (between text and send button). Quiet Composer's command bar uses a single-line `<input>` and renders attachments ABOVE the input row. Port the textarea + auto-resize + inline attachment placement.

### #152 — FolderPeek doesn't match mockup-d
Mockup-d shows a tighter list with file-type icons and different padding. Compare `FolderPeek.tsx` styling to the mockup HTML and align.

### #153 — FilePreview should match FolderPeek bg/style
User expects the two hover popovers to feel like siblings. Currently FilePreview has `bg-popover` (default shadcn surface); FolderPeek has its own treatment. Align.

### #154 — Sidebar right border too subtle
Sidebar's right edge against the doc area should be more distinct per mockup-d. Increase border opacity or use a slightly thicker treatment.

### #155 — Cmd bar / popover bg should be whiter
User says popovers and the cmd bar are too dark vs mockup-d. Verify `--color-popover` value or override locally.

### #156 — Pinned long file names cover the time hint
The relative-time span on the right of a Pinned row gets covered when the filename is long. Either truncate filename harder (e.g. `max-w-[14ch]`) or move the time hint to a fixed-width slot like the Projects section's `+`-button slot.

### #157 — Status bar orange dot
There's an orange dot to the left of the word count. Probably a Local AI indicator that conflicts with the green dot in the StatusTray popover. Find where the dot is rendered and either remove or unify with the popover indicator.

### #158 — Conversation-history toggle: change clock icon when active
When the bar is in history mode, the clock icon should swap to a chat-bubble or back-arrow icon to make the toggle direction clear.

### #159 — Keyboard shortcuts dialog: too long, consider 2-column
The current single-column scroll is long. User suggested either trimming the catalogue or adopting a wider 2-column layout.

---

## Already verified working

- ⌘, opens SettingsDialogV2 ✅
- All 9 panels render real content ✅
- ⌘3 → bar opens with `#` + first Esc collapses (one-stage chord) ✅
- Image paste/drop/picker into command bar ✅
- TreeOverlay traffic-light clearance ✅
- TreeOverlay Esc dismiss ✅
- SidebarContextMenu items on Pinned/Recent rows (not Project rows — see #140) ✅
- FilePreview shows rendered markdown + "md" badge + no footer ✅
- 252 px sidebar grid track ✅
- AgentOrb hover tooltip + shadow ✅

---

## Suggested resume order

1. **#138 (skill picker focus theft)** — most disruptive while typing.
2. **#142 (translucent chrome doesn't show)** — visible regression, easy to verify the layout fix.
3. **#150 (focus mode redo)** — current behaviour is wrong per mockup-f.
4. **#140 (project context menu)** — silent UX regression.
5. **#141 (recent time hint)** — backfill old entries.
6. **#149 (edit-mode Esc)** — small Esc-chain bug.
7. **#139 (⌘⇧E double-press)** — secondary chord issue.
8. **#151 (cmd bar textarea)** — bigger port from legacy ChatInput.
9. Then the visual polish queue (#143–#159).

Each item should be: confirm-bug-with-trace → minimal-fix → manual-verify against the live app before claiming done.
