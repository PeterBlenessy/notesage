# Audit: Quiet Composer Migration & Doc Drift

|  |  |
| --- | --- |
| **Date** | 2026-04-27 |
| **Scope** | Phase 1 ship-readiness — every legacy surface that should have a Quiet Composer counterpart, every doc claim about Quiet Composer behavior, every in-app reference (KeyboardShortcutsDialog, StatusBar, StatusTray) |
| **Trigger** | User asked: what legacy features have we missed migrating, and what docs no longer match shipped code? |
| **Method** | Two parallel exploration passes (migration gaps + doc drift), verified each finding against actual code, then a deeper second-pass + user feedback round to surface things both passes missed. |
| **Related PRD** | `docs/prds/2026-04-21-ui-refresh.md` |
| **Related task files** | [phase1-tasks](../tasks/2026-04-21-ui-refresh-phase1-tasks.md), [phase1-followups](../tasks/2026-04-21-ui-refresh-phase1-followups.md), [rollout-tasks](../tasks/2026-04-21-ui-refresh-rollout-tasks.md) |

## Executive summary

Phase 1 of the UI Refresh is functionally complete for the core flows (editor, chat send, history, sidebar navigation, tool calling, accent picker, focus mode, settings v2, viewer toolbars). The two manual-QA tasks left in the task file (`#108` VoiceOver, `#109` keyboard-only) are the only checkbox-blockers on the formal ship gate.

But a careful re-read against actual user behavior surfaces **17 real gaps the task file does not cover**, plus several doc / in-app-dialog drift issues. Findings #13–#17 surfaced from the 2026-04-27 walk-through with the user and reflect product decisions made during that session (TreeOverlay removal, Folders section, Quick Notes visibility, agent-orb toast bug, macOS unfocused-window de-emphasis). Top-of-mind:

1. **In-document tag/mention click does nothing in Quiet Composer** — events are fired but the legacy `CommandPalette` (the only listener) isn't mounted in Quiet mode. CRITICAL.
2. **Action count indicator missing from Quiet Composer status bar** — legacy showed "274 actions" with click-to-open; Quiet has nothing. HIGH.
3. **TaskMode (**`!` **prefix) lacks grouping by project** — legacy ActionsDashboard groups under "REVISOR OCH SKATTEEXPERT (3 open)" / "NOTESAGE (2 open)" / etc.; TaskMode is a flat list. MEDIUM.
4. **Quick Capture (**`⌘⇧Space`**) advertised everywhere, not implemented** — no global shortcut plugin, no quick-capture window. CRITICAL doc lie.
5. **No file-search mode in the Quiet Composer command bar** — `⌘⇧F` focuses the bar but typing goes to chat input, not file results. HIGH.
6. **TreeOverlay top positioning still looks wrong** — `top-9` was applied but the visual gap with the macOS traffic lights is unresolved. MEDIUM.
7. **In-app KeyboardShortcutsDialogV2 has the same drift the docs had** — wrong glyph forms, missing tasks shortcut, advertises Quick Capture, mentions "tabs". HIGH.
8. **Document Outline (**`⌘⇧O`**) uses a legacy modal Dialog**, not a Quiet Composer popover. LOW.
9. **F1 scope underestimated** — pinned-file cleanup-on-delete must extend to recent files too (user-reported). LOW.

The legacy `Layout.tsx` path is fully retained behind `uiPreview !== "quiet-composer"` per the Phase 3 deletion plan; switching back to Classic is safe and reversible.

## CRITICAL findings (should not flip Phase 2 default until fixed)

### 1. In-document tag/mention click does nothing in Quiet Composer

**Surface:** clicking a `#tag` or `@mention` badge inside the editor body.

**Today's wiring:**

- `src/components/editor/extensions/tag-highlight.ts:82` dispatches `notesage:open-tag-search`
- `src/hooks/useAppLifecycle.ts:43` listens, calls `onOpenPalette("tags", tag)`
- `src/App.tsx:205-209` sets `commandPaletteOpen = true` with mode `"tags"` and drilldown
- `src/App.tsx:879` only mounts `<CommandPalette>` when `uiPreview !== "quiet-composer"`

**Result in Quiet Composer:** state is set, but no listener exists — clicking does nothing. The FloatingCommandBar does not subscribe to `notesage:open-tag-search`. Same bug for `notesage:open-mention-search`.

**Fix:** in `useAppLifecycle`, branch on `uiPreview`. Quiet path emits `cmd-bar-events` `{ type: 'focus', prefix: '#'/'@', drilldown: { kind: 'tag'/'mention', name } }` — same payload shape the sidebar TagsSection and MentionsSection already use (verified working in `TagsSection.tsx:139`).

### 2. Quick Capture (`⌘⇧Space`) is advertised but not shipped

**The lie surfaces in:**

- `docs/keyboard-shortcuts.md` (now corrected)
- `docs/product-description.md` System Tray section (now corrected)
- `src/components/KeyboardShortcutsDialogV2.tsx:93` — entry "Quick capture (global) ⌘⇧Space" (now removed)
- `src/components/cmd/modes/PaletteMode.tsx:198-202` — palette entry "Open the floating quick-capture window" with `shortcut: '⌘⇧Space'`

**Reality (verified):**

- No `tauri-plugin-global-shortcut` registered in `src-tauri/Cargo.toml` or `src-tauri/src/lib.rs`
- No global keydown listener for `⌘⇧Space`
- No separate `quick-capture` window registered in `src-tauri/tauri.conf.json`
- The in-app palette entry's handler in `App.tsx:667-669` just calls `setNewNoteOpen(true)` — opens the regular New Note dialog, which is itself hidden when `uiPreview === "quiet-composer"` per `App.tsx:879`

**Recommendation:** either (a) ship Quick Capture as a small standalone PRD (global-shortcut plugin + floating 480x320 window with destination picker — original spec), or (b) permanently remove the entry from the palette and the System Tray "Completed" roadmap claim. Don't leave it half-promised.

## HIGH findings

### 3. No file-search mode in the Quiet Composer command bar

**Today's wiring:**

- `⌘⇧F` in Quiet Composer emits `{ type: 'focus' }` with no prefix (`useKeyboardShortcuts.ts:198-204`)
- The bar opens in default chat-composer mode — typing goes to the AI prompt, not a file search
- The 6 prefix modes (`/`, `@`, `#`, `!`, `?`, `>`) all exist; **none is for file search**

**Closest existing path today:** `@` prefix opens ReferenceMode (files/people/comments). But that's framed as "attach a file as context", not "find a file to open".

**Recommendation:** decide and document — is the command bar's no-prefix default expected to surface file results alongside chat suggestions, or should there be a dedicated `:file` (or other) prefix? The PRD's regression-audit table promised "Open a specific file" via `⌘K` + two letters + Enter — that flow doesn't actually work today.

### 4. Action count indicator missing from Quiet Composer

**Legacy** (`src/components/editor/StatusBar.tsx:528, 605`): `<ActionsIndicator>` shows "274 actions" with click → opens Actions dashboard. Tooltip says `⌘5` (also stale — should be `⌘1` per current bindings).

**Quiet** (`src/components/editor/StatusBar.tsx:902-1000` → `QuietStatusBar`): no `ActionsIndicator` at all. The user's screenshot of the legacy bar shows the indicator as a familiar fixture; users will miss it.

**Recommendation:** either (a) add `ActionsIndicator` to `QuietStatusBar` next to word count and `SavedLabel`, or (b) add a new "Actions" group inside `StatusTray` popover (alongside Completions, Comments, Session, Help) — the click-to-reveal pattern matches the rest of StatusTray. **(b) is the cleaner fit.**

### 5. In-app KeyboardShortcutsDialogV2 has the same drift the markdown doc had

**Before this audit:**

- Listed "Close tab" — should be "Close active document"
- Listed `⌘2`/`⌘3`/`⌘4` instead of glyph form `⌘@`/`⌘#`/`⌘?`
- Missing the "Tasks" shortcut (`⌘!`)
- Listed "Quick capture (global) `⌘⇧Space`" — see #2
- Listed "Toggle chat panel `⌘⇧C`" with no mention of the three-summon-paths reality
- Missing `⌘⌥C` copy path, `⌘⌥R` reveal in Finder, `⌘⇧F` open command bar
- "Search files `⌘⇧F`" misleads — there is no file-search mode (see #3)

**Status:** fixed in `src/components/KeyboardShortcutsDialogV2.tsx` as part of this audit. The legacy `KeyboardShortcutsDialog.tsx` (used in Classic Layout) still has the same drift but is on the Phase 3 deletion list.

## MEDIUM findings

### 6. TaskMode (`!` prefix) lacks grouping by project

**Legacy ActionsDashboard** (`src/components/actions/ActionsDashboard.tsx:60-70`) groups open actions by `project_root`:

- Uppercase header per project ("REVISOR OCH SKATTEEXPERT (3 open)")
- Quick Notes group at bottom for ungrouped items
- Completed section is collapsible

**Quiet TaskMode** (`src/components/cmd/modes/TaskMode.tsx`) renders a flat list of `rows = filtered.slice(0, MAX_RESULTS)`. Type / Status / Project filters work; grouping is the missing piece.

**Recommendation:** implement the same `groupedOpen` Map&lt;project_root, ActionItem\[\]&gt; grouping the dashboard uses. \~30 lines.

### 7. TreeOverlay — won't fix; scheduled for removal

**Decision (2026-04-27):** TreeOverlay is being removed entirely. It does not match how the user actually navigates the sidebar (the in-sidebar inline-expand pattern is preferred), the top-positioning bug is non-trivial to fix, and `⌘⇧E` will be reclaimed for the Export dialog.

**Scope of the removal program:**

- Delete `src/components/sidebar/quiet/TreeOverlay.tsx` (\~600 lines)
- Delete `src/stores/tree-overlay-store.ts`
- Delete the `⌘⇧E` capture-phase listener in `QuietLayout.tsx:194-232`
- Re-bind `⌘⇧E` to **Open Export dialog** (multi-format: PDF / DOCX / PPTX / HTML — not just PDF)
- Delete the `onOpenTreeOverlay` prop chain through `FolderPeek`; rewire FolderPeek folder-clicks to dispatch a `notesage:sidebar-expand-path` event the QuietSidebar's project rows listen for (in-sidebar inline expand instead of overlay)
- Strip TreeOverlay references from `architecture.md`, `editor.md`, `keyboard-shortcuts.md`, `design-system.md`

**Sequence:** TreeOverlay deletion lands AFTER the Folders section + persistent sidebar search input ship, so users never have a regression window where deep-tree access is gone with no replacement.

### 8. F2 — sidebar tag/mention click works; document tag/mention click is broken

**User correction:** F2 was originally about sidebar clicks. The sidebar implementation now drills directly to occurrences (`TagsSection.tsx:139`) — better than the original "seed input" idea. **F2 from the sidebar can be closed.**

**But F2 from the document body is broken** — see finding #1 above. Re-scope F2 to cover only the in-document case.

## LOW findings (polish)

### 9. F1 — pinned cleanup on delete should extend to Recent

**Original F1 scope:** delete a file → its row stays in `pinnedFiles` as a broken link.

**User-reported addition:** the same bug applies to `recentFiles`. Update F1 to call both `unpinFile(path)` AND `removeRecent(path)` (or add a single `forgetFile(path)` action).

### 10. Document Outline (`⌘⇧O`) uses legacy modal Dialog

`src/components/DocumentOutline.tsx:18-58` is a shadcn `Dialog` (full backdrop, centered modal). Functions correctly in both shells but feels jarring inside Quiet Composer where most popups are popovers. Re-skin to a Quiet Composer overlay/popover or to a StatusTray entry.

### 11. F3 — persistent search input above Pinned (committed; supersedes invisible type-to-filter)

**Decision (2026-04-27):** With TreeOverlay scheduled for removal (finding #7), this becomes the sole deep-search path in the sidebar — it earns its keep. F3's original "restore focus on filter clear" bug *vanishes* because the visible input owns its own focus, no magic transitions.

**Shape:**

- `<Input>` at the very top of `QuietSidebar`, above the Pinned section header. \~28px, magnifying-glass icon, "Filter sidebar…" placeholder.
- Co-owns filter state with `useSidebarTypeFilter` (typing on a focused row also writes here; both surfaces show the same value).
- Filter scope = visible items + descendants of inline-expanded projects/folders. Unexpanded deep tree is NOT searched. Rule: "search what you can see; expand to see more."
- `Esc` clears the filter and returns focus to the previously-focused sidebar row.

**Prerequisite:** the sidebar keyboard-nav consistency bug ("sometimes a folder gets selected, sometimes the +") must be fixed first — the search input will inherit that bug otherwise.

### 12. F6 — sidebar row memoization (perf hygiene)

Wrap `PinnedRow`, `RecentRow`, `ChildRow`, `ProjectRow` in `React.memo` with stable callback refs. After memo, tighten `FIRST_KEYSTROKE_BUDGETS` in `src/perf/sidebar-filter.perf.test.tsx` to the spec target (50ms). Production users rarely hit N=2000 in either section, so this is hygiene not a bug.

### 13. Arbitrary-folder navigation — `⌘O` silently mutates state with no UI surface

**Today's wiring:** `App.tsx:323-339` — `⌘O` opens the native folder picker, checks for `.notesage/` (auto-promotes to a Project if found), otherwise calls `addExplorerFolder(folderPath, tree)` which writes to `workspace-store.explorerFolders[]`.

**Result in Quiet Composer:** the folder is added to the store but **has no visible surface**. QuietSidebar doesn't render an Explorer section. TreeOverlay's `:33` comment explicitly excludes Explorer folders. The folder only appears as a destination in the right-click "Move to…" dropdown (`SidebarContextMenu.tsx:204-211`). Users repeatedly press `⌘O`, see nothing, accumulate orphan entries.

**Decision (2026-04-27):** add a togglable **Folders** section to QuietSidebar.

- Position: between Projects and Recent
- Default cap: `sidebarFoldersCap = 0` (hidden out of the box, like Tags/Mentions)
- Slider in Settings &gt; Appearance &gt; Sidebar Composition, clamp `[0, 15]`
- Each row shows the folder's basename; hover-peek via the existing `FolderPeek` component (folders first 8, files first 6)
- Inline expand on `→` arrow (same in-sidebar tree pattern Projects use)
- Right-click → Remove from sidebar (no dialog)
- `⌘O` on a folder containing `.notesage/` continues to auto-promote to Projects (existing behavior preserved)
- `⌘O` on an already-opened folder (or project): dedup by canonical path; reuse existing entry; toast "Folder already in sidebar"

### 14. TreeOverlay removal program

See finding #7 for the deletion list. Sequence:

1. Fix sidebar keyboard-nav consistency bug (audit #11 prerequisite)
2. Polish in-sidebar inline-expand for Projects (`→` / `←` / arrow-down-into-children)
3. Re-wire FolderPeek folder-clicks to dispatch `notesage:sidebar-expand-path` (or equivalent) instead of opening TreeOverlay
4. Add the togglable Folders section (finding #13)
5. Add the persistent sidebar search input (finding #11)
6. Delete TreeOverlay component / store / capture-phase listener
7. Re-bind `⌘⇧E` to **Open Export dialog** (multi-format — PDF / DOCX / PPTX / HTML — not just PDF)
8. Strip TreeOverlay references from architecture.md, editor.md, keyboard-shortcuts.md, design-system.md

### 15. Quick Notes has no surface in QuietSidebar

**Today:** `notesRootPath` (`~/Notesage`) is a destination concept used by:

- Tray menu "New Quick Note" → file lands at `~/Notesage/<timestamp>.md`
- Right-click "Move to…" lists "Quick Notes" as a destination (`SidebarContextMenu.tsx:188`)
- Action store groups untracked items under "Quick Notes" (when `project_root === undefined`)

**Result in Quiet Composer:** Quick Notes are written to disk but **invisible** unless the user opens one (then it shows in Recent) or pins one. A user who creates 10 Quick Notes via the tray and never opens them sees them nowhere in the sidebar.

**Recommendation:** treat Quick Notes the same way as Folders — a permanent always-visible row at the top of the sidebar (above Pinned), or below Folders. Single non-removable entry; hover-peek shows recent contents; click opens the most recent. Needs a small design decision before implementation.

### 16. Agent-orb completion toast covers the orb (user-reported 2026-04-27)

**Bug:** when a delegated comment completes, an agent-completion toast appears at the bottom-right with an "open the result" action. The toast **physically covers the AgentOrb**, blocking the user from clicking the orb to open the agent panel and read the result. The toast does not auto-dismiss quickly enough; the user is forced to wait or move the cursor blindly.

**Fix:** make the toast explicitly dismissable (X button on the toast), and/or reposition so it doesn't overlap the orb's hit-target (e.g., toast at top-right while orb is bottom-right; or toast offset so the orb stays clickable). The "open the result" action stays — the user just needs the dismiss path so they can use the orb directly.

**File:** likely `src/lib/notifications.ts` or wherever `agent-task-complete` event handler lives. Verify before scoping.

### 17. macOS unfocused-window de-emphasis (user-requested 2026-04-27)

**Native macOS behavior:** when a window loses key/main status (the user clicks into another app), AppKit applies a system-wide de-emphasis pass — accent colors desaturate to grey, traffic-light buttons dim, sidebars lose their tint. This is part of the macOS Human Interface Guidelines for "active" vs "inactive" window state and is what makes native apps feel calm when in the background. Web apps inside Tauri don't get this for free — the WebKit content keeps rendering at full saturation regardless of NSWindow key status.

**Why it fits Quiet Composer:** the existing `fade-on-type` pattern already commits to "chrome should yield gracefully when the user is engaged elsewhere". Window-blur is the macro-scale version of the same principle — when the user is engaged with a different *app*, the entire chrome should yield. Same philosophy, larger scope.

**Implementation shape:**

- **Hook:** `useWindowFocus()` listens to Tauri's window-focus events (or the standard `window.addEventListener('blur'/'focus')` — both work in Tauri WebViews) and writes `data-window-inactive="true"` onto the QuietLayout root (or `<html>` if Classic should benefit too)
- **CSS tokens:** add `--color-accent-primary-inactive: oklch(70% 0 0)` (neutral grey, zero chroma). Selector `[data-window-inactive='true']` swaps the active accent var to the inactive one, plus reduces opacity on `[data-quiet-chrome-*]` targets (the same elements `useQuietChrome` already manages for fade-on-type)
- **What gets desaturated:** primary buttons (`--color-accent-primary` consumers), switch ON-state, focus rings, editor link colour, dirty dot, AgentOrb pulse ring (from accent-tinted to grey)
- **What stays unchanged:** body text, borders, backgrounds, syntax highlighting, diff colors, destructive (red). Preserves WCAG contrast — desaturating chrome doesn't drop body-text contrast below AA
- **Reduced motion:** the swap is instantaneous (no transition), but a 200ms ease is gentle and reduced-motion-safe (it's an opacity/color transition, not a layout transform)
- **Both shells or Quiet only?** Recommend BOTH — this is a macOS-native polish, not a Quiet-Composer-specific aesthetic. But if scoping is tight, ship Quiet first

**Note:** the standard `:-moz-window-inactive` CSS pseudo-class is Firefox-only and doesn't help in Tauri's WebKit. The Tauri/JS focus-event approach is the right path.

**References:**

- [CSS-Tricks — Window Inactive Styling](https://css-tricks.com/window-inactive-styling/)
- [MDN — Window: blur event](https://developer.mozilla.org/en-US/docs/Web/API/Window/blur_event)
- [macOS Monterey unfocused-window discussion (MacRumors)](https://forums.macrumors.com/threads/monterey-grays-out-ui-on-non-active-windows-way-to-defeat-this.2346096/) — describes the system-wide behavior

### 18. Project-lock tooltip displays raw connection ID instead of pretty name (user-reported 2026-04-27)

**Bug:** the AI-lock padlock tooltip on a project row in QuietSidebar shows `Locked to conn-1774086797085-ak920t` instead of the connection's user-set label (e.g. `Locked to Claude — Personal`).

**Root cause:** `src/components/sidebar/quiet/SidebarRowIndicators.tsx:136` renders `aiLock.connectionId` directly with no lookup against `connections-store`. The legacy `Layout`-shell code (`src/components/sidebar/ProjectItem.tsx:61-63`) does this correctly via `connections.find((c) => c.id === aiLock.connectionId)` and `describeLockTarget(aiLock.connectionId, lockedConnection?.label)`. `ProjectSettings.tsx:469` and `ProjectCard.tsx:100` also handle it correctly. SidebarRowIndicators is the only regression.

**Fix:** read `connections` from `connections-store`, look up the locked connection by `id`, render `lockedConnection?.label ?? aiLock.connectionId` (or use the existing `describeLockTarget` helper for consistency with the legacy ProjectItem). Handle the "connection was deleted but the lock persists" case gracefully — fallback to the ID with an "(unavailable)" suffix.

**Severity:** HIGH for first-impression polish — every locked project shows the raw ID, which looks like a developer leak. Trivial fix (\~10 lines).

## Open task-file items reviewed

| ID | Title | Verdict |
| --- | --- | --- |
| `#27` | History view inside stream ⚠️ | Functional in user testing. Per user: `⌘⇧H` shortcut not needed; `Esc`**-back-to-chat is**. Mark ✅ once Esc behavior lands. |
| `#124` | TitleBar buttons in Quiet Composer | **Close as duplicate of** `#103` (already implemented in `TitleBar.tsx:127-160` via `mode === "quiet"` branch). |
| `#108` | VoiceOver walkthrough | Runnable now; \~30-45 min. macOS → Accessibility → VoiceOver → ON, follow `docs/tasks/qa/2026-04-21-voiceover-checklist.md`. |
| `#109` | Keyboard-only walkthrough | Runnable now; \~20 min. Disconnect mouse, follow `docs/tasks/qa/2026-04-21-keyboard-only.md`. |

## Doc drift fixed in this pass

| File | Fix |
| --- | --- |
| `CLAUDE.md` | Version `0.36.0` → `0.39.1` |
| `docs/product-description.md` | Version bump; struck false Quick Capture claim with explanatory note; added UI Refresh roadmap entry |
| `docs/architecture.md` | Added `theme.rs` to commands inventory; added 6 missing files to export inventory (`markdown_to_pptx.rs`, `markdown_to_html.rs`, `html_styles.rs`, `page_settings.rs`, `typography.rs`); added `SidebarRowIndicators.tsx` to quiet sidebar list; expanded `editor-store` row to spell out the partial `openTabs` → `openDocuments` rename; rewrote `ai-store` "(legacy, fallback)" wording |
| `docs/keyboard-shortcuts.md` | Renamed "Tab Navigation" → "Document Navigation"; added "Glyph form (display)" column; rewrote `⌘W` (Close active document), `⌘⇧E` (Quiet Composer routes to TreeOverlay), `⌘⇧F` (no file-search mode), `⌘⇧C` (third summon path), `⌘⇧M` (Tiptap, not this hook); added "Future Shortcuts (Planned but unshipped)" with Quick Capture + file-search-mode |
| `src/hooks/useKeyboardShortcuts.ts` | JSDoc: `⌘⇧[` / `⌘⇧]` no longer marked `(TODO #77)` — that ships via `useRecentDocumentCycle` mounted in `App.tsx:196` |
| `src/components/KeyboardShortcutsDialogV2.tsx` | Same corrections as the markdown doc — see finding #5 above |

## Recommendations

**Close immediately (housekeeping, \~30 min):**

- Close `#124` as duplicate of `#103`
- Close F2's sidebar half (drilldown payload supersedes the seed-text idea); rescope F2 to cover only the in-document case
- Update F1 scope to include Recent files

**Schedule before Phase 2 default-on (genuine bugs):**

- Finding #1 — in-document tag/mention click in Quiet Composer (CRITICAL, \~1hr)
- Finding #2 — Quick Capture: pick (a) ship for real or (b) permanently remove the false promise from product-description, KeyboardShortcutsDialog, and PaletteMode
- Finding #3 — file-search mode in cmd bar: needs a design decision before code can land
- Finding #4 — Action count in StatusTray (option (b) — new "Actions" group inside the popover)
- Finding #6 — TaskMode grouping by project
- Finding #11 — sidebar keyboard-nav bug (prerequisite for #13 + persistent search input)
- Finding #12 (was #16) — agent-orb completion toast covering the orb (user-blocking; small fix)

**Sidebar simplification program (sequenced, replaces TreeOverlay):**

Decisions resolved in the 2026-04-27 walk-through; this is the locked-in shape.

1. Fix sidebar keyboard-nav consistency (#11)
2. Polish in-sidebar inline-expand for Projects (`→` / `←` / arrow-down-into-children)
3. Re-wire FolderPeek folder-clicks to inline-expand (drop `onOpenTreeOverlay` prop chain)
4. Add Folders section (#13) — **no user-facing cap; visible whenever ≥1 folder exists** (no slider, no settings UI for Folders). Same model retroactively applies to Pinned and Projects (also no cap). `⌘O` dedups on canonical path; `⌘O` on a folder containing `.notesage/` auto-promotes to Projects (existing behavior).
5. Quick Notes (#15) — **no separate sidebar section.** Newly created Quick Notes auto-surface in Recent. Lightest possible surface.
6. Add persistent sidebar search input (#11 — F3 supersession). **Filter scope: full workspace via SQLite FTS** (not just visible rows). **Replaces the invisible** `useSidebarTypeFilter` entirely (the visible input is the only filter path; an "auto-focus on first printable keystroke when sidebar has focus" fallback preserves the keyboard ergonomics). Chord: `⌘L` (browser location-bar muscle memory; currently unbound).
7. In-document `#tag` / `@mention` click → cmd bar at **level-2 occurrences** (consistent with sidebar Tags/Mentions click) (#1)
8. Delete TreeOverlay component / store / capture-phase listener (#7 + #14)
9. Re-bind `⌘⇧E` to **Open Export dialog** (multi-format — PDF / DOCX / PPTX / HTML)

**Polish (not blocking, schedule when convenient):**

- Finding #8 (was #10) — Document Outline re-skin to a Quiet Composer popover
- Finding #12 (F6) — sidebar row memoization
- Finding #17 — macOS unfocused-window de-emphasis. **Quiet Composer only** (Classic on Phase 3 deletion list)
- Finding #18 — project-lock tooltip raw-ID leak (\~10 lines)

**Manual QA gate (Phase 1 ship):**

- `#108` VoiceOver walkthrough
- `#109` keyboard-only walkthrough

**Process:**

- Add a doc-bump line to the `/release` script that fails if `CLAUDE.md` and `docs/product-description.md` "Current version" don't match `package.json`. The 3-release version drift across both files shows this is brittle as a manual step.
- Run `audit-documentation` after each closed milestone, not only at release. The architecture inventory drift was exactly the failure mode that audit catches.