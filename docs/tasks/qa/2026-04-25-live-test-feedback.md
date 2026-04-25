# Live-test feedback — 2026-04-25

Resume point after a `/clear`. Read this file and the related code, then tackle items in priority order.

**Setup:**
- All Phase 1 code is shipped to `main` (commits up to `a053328`).
- The dev session wasn't running the worktree; the user tests against `pnpm tauri dev` which reads `main`.
- Live-testing in the running app is the only way to verify visual / UX behavior — Vitest catches logic but not pixels.

---

## ✅ Done in next batch (2026-04-25 night, uncommitted)

| # | Title | How it was fixed |
| --- | --- | --- |
| Cmd+Shift+V plain-text paste | Generic prose-with-markdown-punctuation paste | New `Mod-Shift-v` keyboard shortcut on `PasteHandler` reads `navigator.clipboard.readText()` and inserts the literal text via `tr.insertText` — bypasses both the paste-rule registry AND tiptap-markdown. Tested in `paste-handler.test.ts` (7 tests). Documented in `docs/keyboard-shortcuts.md` + `docs/features/editor.md`. |
| #144 | Accent colors don't apply when selected | `useAccent()` was defined but never mounted. Added it to `App.tsx` alongside the other lifecycle hooks. AppearanceSettings swatches updated to match the real `--accent` values from `globals.css` (orange `oklch(68% 0.21 37)`, blue `oklch(56% 0.16 253)`). Regression test in `AppearanceSettings.test.tsx` mounts AppearanceSettings + useAccent together and asserts the `.accent-orange` / `.accent-blue` class actually lands on `<html>` after a click. **Follow-ups split out into `docs/tasks/qa/2026-04-25-accent-audit.md`** — the System swatch reads orange (cached fallback) and a wider audit of which UI surfaces should be tinted by the accent vs. stay neutral. |
| #147 | Settings ⌘F filter only narrows nav, not row content | `SettingsRow` now consults `useSettingsSearchQuery()` and self-hides when the query doesn't match its `label` / string `description` / string `controlSublabel`. `SettingsGroup` walks its `SettingsRow` children and self-hides when none match (so empty bordered boxes never show). Tested in `SettingsRow.test.tsx` (rowMatchesQuery + 4 self-filter tests) + `SettingsGroup.test.tsx` (3 group-hide tests). |
| #143 | Settings panel padding too generous | `SettingsShell` right-column container went from `px-6 py-6` → `px-5 py-4`. AppearanceSettings header went from `mb-8 pb-6` → `mb-6 pb-4`. Other panels rely on group labels and were not affected. |
| #157 | Status bar orange dot conflicts with green dot | Removed the orange "inline completions active" dot from the QuietStatusBar — users read it as a SECOND state of the green Local AI indicator. The Completions group is still reachable through the StatusTray popover and via `OutOfScopeCompletionsIndicator`. `useStatusDotsState` still computes `showOrange` for future consumers. Tests updated. |

**Test counts after this batch:** 80 settings v2 tests (up from 68), 24 StatusBar tests, 7 paste-handler tests. Typecheck clean.

---

## ✅ Done in commit a053328 (2026-04-25 evening)

| # | Title | How it was fixed |
| --- | --- | --- |
| #138 | Skill picker reopens on backspace; input loses focus | SkillMode no longer focuses listRef on mount; keyboard nav moved to a window listener (TagMode pattern). |
| #139 | ⌘⇧E twice opens TreeOverlay then Export dialog | Removed the misguided `target.closest("[data-tree-overlay]")` carve-out so the chord always preempts the legacy export binding. |
| #140 | Right-click on project + child rows opens OS native menu | Wrapped `<ProjectRow>` / `<ChildRow>` in passthrough `<div>` so Radix's `asChild` Slot can attach `onContextMenu` to a real DOM element. |
| #141 | Recent rows show project name instead of relative time | v1→v2 editor-store migration backfills `lastAccessedAt` in MRU order. |
| #142 | Translucent chrome doesn't actually look translucent | Title bar drops to `bg-background/40 backdrop-blur-xl`; doc-area `pt-11` removed so content scrolls behind; StatusBar absolute-positioned at `[data-doc-area]` bottom with matching treatment; doc-area `padding-bottom: 0` so no opaque stripe below the bar. |
| #149 | Edit-mode Esc collapses bar instead of cancelling edit | `editContextRef` + `activePrefixRef` now write synchronously during render (was post-commit `useEffect`), closing the timing window where a fast Esc could fall through to `collapse()`. |
| #150 | Focus mode redo per mockup-f | `display: none` on `[data-titlebar-mode="quiet"]` in focus mode; doc-area top padding dropped to 80 px (just the FocusPill clearance). |
| #160 | FolderPeek popover items show OS native context menu | Wrapped each preview folder/file button in `SidebarContextMenu`. |
| Sidebar `+` alignment | Section header `+`, project row numbers, project row `+` all aligned right | Numbers + button share a 24×24 right-edge slot, right-aligned to match Pinned/Recent time hints. |
| Sidebar context-menu race | Right-click in FolderPeek preview vanished both menus; preview reopened when hovering menu items | New `src/lib/sidebar-context-menu-state.ts` flag — `SidebarContextMenu` increments via Radix `onOpenChange`; FilePreview/FolderPeek consult the flag in mouseEnter/mouseLeave/openTimer/closeTimer. Subscribers re-evaluate on flag→0. |
| iCloud path `~apple~` rendered as `<sub>` | In-app Copy Path | `copyToClipboard` writes both `text/plain` and `text/html` (path wrapped in `<span>`). |
| iCloud path from Finder | Same paste hits markdown parser | New extensible paste-rule registry (`src/lib/editor/paste-rules.ts`) + `PasteHandler` Tiptap extension. Built-in rules: `filePathPasteRule` (POSIX/home/relative/Windows + Finder quote stripping) + `preformattedTextPasteRule` (box-drawn tables → fenced code block). |
| Project allowlist | Reduce permission prompts | `.claude/settings.json` now allowlists `Bash(open:*)` and `Bash(yarn test:*)`. |

**Test counts at `a053328`:** 27 paste-rule tests, 6 sidebar-context-menu-state tests, all 307 quiet-sidebar tests, 36 QuietLayout tests, 161 cmd-bar tests, 68 editor-store tests, 13 SkillMode tests. Typecheck clean.

---

## Still open

### Generic "plain prose with markdown punctuation" paste — option #1 SHIPPED

The path rule and box-drawn rule cover their specific cases. The new `Cmd+Shift+V` shortcut covers the generic case (insert literal text). Two further candidate fixes still on the table:

1. ~~**`Cmd+Shift+V` "paste as plain text" shortcut.**~~ — shipped this batch.
2. **Fallback paste rule:** if `clipboardData` has only `text/plain` (no `text/html`), insert as plain text. Risk: breaks pasting actual markdown source from `cat foo.md` in a terminal.
3. **Heuristic "looks like flowing prose" rule:** detect lack of structural markdown markers (no `# `, no `- `, no fenced code, no `> `, no tables) and treat as plain text. Heuristic — false positives possible.

Skip #2 unless the user confirms they don't paste raw markdown often. #3 is a future opt-in setting.

### P1 visual / UX queue (untouched this session)

| # | Description | Notes |
| --- | --- | --- |
| ~~#143~~ | ~~Settings panel padding too generous vs mockup-e~~ | ✅ Done — `px-5 py-4` + tighter AppearanceSettings header. |
| ~~#144~~ | ~~Accent colors don't apply when selected~~ | ✅ Done — `useAccent` mounted in `App.tsx`. Audit follow-up split into `docs/tasks/qa/2026-04-25-accent-audit.md`. |
| #145 | AI connection config opens legacy dialog | From the v2 AI panel, "Add Connection" / edit opens the OLD `AddConnectionDialog`. Either rebuild to v2 chrome or accept the inconsistency in writing. |
| #146 | About → View changelog opens legacy dialog | Same pattern as #145. |
| ~~#147~~ | ~~Settings ⌘F filter only matches nav titles, not row content~~ | ✅ Done — `SettingsRow` + `SettingsGroup` self-filter. |
| #148 | Floating toolbar centered relative to editor, not app | The pill toolbar (`Editor.tsx` ~line 630, `absolute top-3 left-1/2 -translate-x-1/2`) is centered inside its `relative` editor parent, not the app. Decide canonical centering and align. |
| #151 | Cmd bar text input doesn't grow vertically; attachments above input | Legacy ChatInput uses a `<textarea>` with auto-resize; attachments render INSIDE the input area. Quiet Composer uses a single-line `<input>` with attachments ABOVE. Port the textarea + auto-resize + inline attachment placement. |
| #152 | FolderPeek doesn't match mockup-d | Tighter list with file-type icons and different padding. Compare `FolderPeek.tsx` styling to the mockup HTML and align. |
| #153 | FilePreview should match FolderPeek bg/style | Currently FilePreview has `bg-popover` (default shadcn surface); FolderPeek has its own treatment. Align so the two hover popovers feel like siblings. |
| #154 | Sidebar right border too subtle | Increase border opacity or use slightly thicker treatment per mockup-d. |
| #155 | Cmd bar / popover bg should be whiter | Verify `--color-popover` value or override locally. |
| #156 | Pinned long file names cover the time hint | Either truncate filename harder (e.g. `max-w-[14ch]`) or move the time hint to a fixed-width slot. |
| ~~#157~~ | ~~Status bar orange dot~~ | ✅ Done — orange "completions active" dot removed from QuietStatusBar. |
| #158 | Conversation-history toggle: change clock icon when active | When the bar is in history mode, swap the clock to a chat-bubble or back-arrow icon to make the toggle direction clear. |
| #159 | Keyboard shortcuts dialog: too long, consider 2-column | Current single-column scroll is long. Trim the catalogue or adopt a wider 2-column layout. |

---

## Already verified working (pre-existing)

- ⌘, opens SettingsDialogV2 ✅
- All 9 panels render real content ✅
- ⌘3 → bar opens with `#` + first Esc collapses (one-stage chord) ✅
- Image paste/drop/picker into command bar ✅
- TreeOverlay traffic-light clearance ✅
- TreeOverlay Esc dismiss ✅
- SidebarContextMenu items on Pinned/Recent rows ✅
- FilePreview shows rendered markdown + "md" badge + no footer ✅
- 252 px sidebar grid track ✅
- AgentOrb hover tooltip + shadow ✅

---

## Suggested resume order

1. **Generic plain-prose paste — `Cmd+Shift+V` shortcut** (smallest, zero behavior risk, addresses the user's most-cited remaining paste annoyance).
2. **#144 Accent colors don't apply** (visible regression that breaks the Appearance settings flow — should be a one-file fix in `AppearanceSettings.tsx` or `ThemeProvider`).
3. **#147 Settings ⌘F filter** (functional bug — the filter looks like it works but only narrows the nav, confusing users).
4. **#143 Settings panel padding** (visible drift from mockup-e — quick CSS).
5. **#157 Status bar orange dot** (small but visible inconsistency).
6. Then the rest of the P1 visual queue in numerical order or as the user prioritises.

Each item: confirm-bug-with-trace → minimal-fix → manual-verify against the live app before claiming done.
