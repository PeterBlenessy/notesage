# UI Refresh — Phase 1 (Preview) Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-22 |
| **Status** | Not started |
| **PRD** | [ui-refresh](../prds/2026-04-21-ui-refresh.md) |
| **Phase** | 1 of 3 — ship the preview behind a flag; legacy stays working |
| **Rollout tasks** | [ui-refresh-rollout-tasks](./2026-04-21-ui-refresh-rollout-tasks.md) (Phase 2 + 3) |
| **Total** | 127 tasks across 13 milestones (M1.11 adds #101–#102; M1.12 grew from 5 → 25 with #103–#107 polish, #110–#112 toolbar + audit, #113 parity audit, #114–#120 first integration-gap batch, and #121–#130 second batch surfaced by the #113 audit; M1.13 = #108–#109). |
| **Complexity mix** | \~30 S, \~50 M, \~20 L |
| **Suggested order** | M1.1 Foundation (#1–#8) → M1.2 Composer + Orb (#9–#29) → M1.3 Sidebar + Chrome (#30–#62) → M1.4 Settings (#63–#68) → M1.5 Removals (#69–#74) → M1.6 State (#75–#77) → M1.7 Accessibility (#78–#87) → M1.8 Perf (#88–#92) → M1.9 Docs + release (#93–#98) → M1.10 Pre-ship validation (#99–#100) |

## Scope

Everything required to land the Quiet Composer UI *behind the* `uiPreview` *flag*, with legacy fully functional. The flag starts `legacy` for all existing users. No user is forced into the new UI. Phase 2 + Phase 3 (default-on, then legacy deletion) are in the rollout tasks file.

## Execution notes

- **Flag-gate everything.** Each new component mounts only when `uiPreview === "quiet-composer"`. The old path must continue to render correctly when the flag is `legacy`. Both paths ship in the same binary.
- **Use existing primitives.** Where possible reuse shadcn components, existing stores, existing tiptap extensions, existing chat-store message rendering. This refresh is about layout, not reinventing logic.
- **Performance is not optional.** Every new component has a budget in `2026-04-21-ui-refresh.md#performance-budgets`. Benchmark suites are explicit tasks; do not skip.
- **Accessibility is not optional.** Every surface has ARIA obligations in the PRD's Accessibility section. VoiceOver walk-through is a ship-blocker (#99).
- **Docs in lockstep.** Every behaviour change updates its feature doc in the same PR.

## Risks and open questions

- **⌘1–4 collisions on Windows/Linux WebView2/WebKitGTK** — may be consumed by OS before reaching the app. Verify during M1.2; if broken on non-macOS, document as known limitation for Phase 1 and treat as a Phase 2 gate.
- **Double-tap ⌘ detection** — requires native key event timing. Browser/WebView variance possible. If detection is unreliable, keep ⌘K as the sole path and defer double-tap to a follow-up.
- **Migration for** `editor-store.openTabs` **→** `openDocuments` — persisted localStorage needs a versioned migration. Test with real user state dumps before merging.
- **Backend skill-parser mid-text extension** — if the change is riskier than expected (ACP subagent forwarding edge cases), fall back to start-of-message-only matching in Phase 1 and schedule the broader match for Phase 2.

---

## M1.1 Foundation (8 tasks)

### #1 — Add `uiPreview` flag to settings-store ✅

| Field | Value |
| --- | --- |
| Title | Add `uiPreview` flag to settings-store |
| Description | Add \`uiPreview: "legacy" |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/stores/settings-store.ts`, `src/components/settings/AdvancedSettings.tsx`, store tests |

### #2 — Fix `html[data-theme]` vs `body[data-theme]` mismatch ✅

| Field | Value |
| --- | --- |
| Description | Audit current app theme usage. Standardise on `body[data-theme]` (matches most of the existing code). Ensure every CSS selector and every JS setter agree. Add a regression test that flips the theme and asserts CSS variables resolve correctly. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/styles/globals.css`, `src/hooks/useTheme.ts`, `src/components/ThemeProvider.tsx`, test |

### #3 — Scaffold `--accent` CSS variable + Default/Orange/Blue/System structure ✅

| Field | Value |
| --- | --- |
| Description | Add `--accent` to `globals.css`. Define `.accent-orange`, `.accent-blue`, `.accent-system` classes with per-theme oklch values (verified AA). Default (no class) keeps today's neutral `--primary`. Create `src/lib/accent.ts` with `setAccent(name)` util. No UI yet — just the scaffolding. |
| Complexity | M |
| Category | frontend |
| Depends on | #2 |
| Files | `src/styles/globals.css`, `src/lib/accent.ts`, `src/hooks/useAccent.ts` |

### #4 — Tauri command: macOS system accent bridge ✅

| Field | Value |
| --- | --- |
| Description | Add `get_system_accent_color` Tauri command. On macOS, read `NSColor.controlAccentColor` and return oklch string. On non-macOS, return null (frontend falls back to "Default"). Register in `lib.rs` `generate_handler![]`. |
| Complexity | M |
| Category | backend |
| Depends on | none |
| Files | `src-tauri/src/commands/theme.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs` |

### #5 — Preview-flag gate at Layout level ✅

| Field | Value |
| --- | --- |
| Description | Branch `<Layout>` on `uiPreview`. Legacy: renders current tree unchanged. `quiet-composer`: renders a new `<QuietLayout>` component (initially a placeholder with 3-column grid). Verify toggling in Settings swaps between layouts without state loss or stale styles. |
| Complexity | S |
| Category | frontend |
| Depends on | #1 |
| Files | `src/components/Layout.tsx`, `src/components/QuietLayout.tsx` (new) |

### #6 — Wire `--accent` to primary-affordance sites ✅

| Field | Value |
| --- | --- |
| Description | Replace `var(--primary)` with `var(--accent, var(--primary))` at: primary buttons, switch ON state, focus ring, dirty dot, link color in editor, running-task ring on orb (forward-declared), selected-row active band. Falls back to neutral when `--accent` is unset. Audit for accent leakage into surfaces/backgrounds. |
| Complexity | M |
| Category | frontend |
| Depends on | #3 |
| Files | `src/styles/globals.css`, selective component stylesheets |

### #7 — New perf-logger categories ✅

| Field | Value |
| --- | --- |
| Description | Add logger categories: `[perf:cmdbar]`, `[perf:orb]`, `[perf:status]`, `[perf:peek]`, `[perf:tree-overlay]`, `[perf:sidebar]`, `[perf:focus]`, `[perf:typing]` (extends existing). All use the existing batching flush pipeline. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/lib/logger.ts` |

### #8 — `useReducedMotion` hook + global CSS fallback ✅

| Field | Value |
| --- | --- |
| Description | Hook reads `matchMedia('(prefers-reduced-motion: reduce)')` and returns boolean. Add `@media (prefers-reduced-motion: reduce) { .reducemotion-skip { transition: none !important; animation: none !important; } }` to `globals.css`. Components use the hook to disable JS-driven animations and the class to disable CSS animations. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/hooks/useReducedMotion.ts`, `src/styles/globals.css` |

---

## M1.2 Composer + Orb (21 tasks)

### #9 — `FloatingCommandBar` component shell ✅

| Field | Value |
| --- | --- |
| Description | Build the bar shell with compact and expanded states. Portal-mounted at bottom-centre of `QuietLayout`. CSS transition for focus/unfocus (lifts 14 px on focus). No content beyond a placeholder input. Accepts `isPinned` prop (forward-declared). |
| Complexity | M |
| Category | frontend |
| Depends on | #5 |
| Files | `src/components/cmd/FloatingCommandBar.tsx` |

### #10 — `CommandBarContext` (context row) ✅

| Field | Value |
| --- | --- |
| Description | Build the context row: provider pill (click opens dropdown, reuses existing provider-switch flow), divider, project chips with remove × and lock 🔒, dashed `+ project` button, mode pill (permission-level picker), clock icon (history trigger, forward-declared), pin icon (pinned-panel trigger, forward-declared). Appears only when `cmdbar.expanded === true`. |
| Complexity | L |
| Category | frontend |
| Depends on | #9 |
| Files | `src/components/cmd/CommandBarContext.tsx` |

### #11 — `AttachmentChips` strip ✅

| Field | Value |
| --- | --- |
| Description | Row above the input showing chips for attached files/people/comments. Each chip: icon, name, × to remove. Click × dispatches remove callback. Accepts an array prop. |
| Complexity | S |
| Category | frontend |
| Depends on | #9 |
| Files | `src/components/cmd/AttachmentChips.tsx` |

### #12 — `CommandBarStream` (chat stream renderer) ✅

| Field | Value |
| --- | --- |
| Description | Renders the chat conversation inside the expanded state's scroll region. Reuses existing message rendering (`ChatMessage`, segments, quick-reply chips, inline permission cards). Max-height 50 vh. Auto-scroll-to-bottom on new messages. |
| Complexity | L |
| Category | frontend |
| Depends on | #9 |
| Files | `src/components/cmd/CommandBarStream.tsx` |

### #13 — Prefix morph logic + MODES registry ✅

| Field | Value |
| --- | --- |
| Description | Detect prefix character in input. Triggering rule: **at start-of-input OR preceded by whitespace**. Register `/`, `@`, `#`, `!`, `?`, `>` as modes. Central `MODES` registry maps prefix → mode component + label + icon. Pressing a matching prefix switches picker; non-matching character dismisses. Prefix stays literal in the input. |
| Complexity | M |
| Category | frontend |
| Depends on | #9 |
| Files | `src/components/cmd/prefix-modes.ts`, `src/components/cmd/FloatingCommandBar.tsx` |

### #14 — `SkillMode` picker ✅

| Field | Value |
| --- | --- |
| Description | List skills from `skill-store.getAvailableSkills()`. Filter on typed text after `/`. Click: keeps `/skill-name` as literal text in input (for agent parsing on send). Enter on first result same as click. |
| Complexity | M |
| Category | frontend |
| Depends on | #13 |
| Files | `src/components/cmd/modes/SkillMode.tsx` |

### #15 — `ReferenceMode` picker (files + people + comments) ✅

| Field | Value |
| --- | --- |
| Description | Unified results: files (from workspace index search), people (from mention index), comments (from comment-store). Type badge distinguishes each. Click: inserts an attachment chip, clears `@...` text from input. |
| Complexity | L |
| Category | frontend |
| Depends on | #11, #13 |
| Files | `src/components/cmd/modes/ReferenceMode.tsx` |

### #16 — `TagMode` picker ✅

| Field | Value |
| --- | --- |
| Description | Reads tags from SQLite document index, ordered by usage. Click keeps `#tag` literal in input. |
| Complexity | S |
| Category | frontend |
| Depends on | #13 |
| Files | `src/components/cmd/modes/TagMode.tsx` |

### #17 — `TaskMode` picker ✅

| Field | Value |
| --- | --- |
| Description | Reads open tasks (unchecked todos) from SQLite index. Behaviour: if no active chat, Enter navigates to the task location; if composing, Enter inserts a task-reference chip. |
| Complexity | M |
| Category | frontend |
| Depends on | #11, #13 |
| Files | `src/components/cmd/modes/TaskMode.tsx` |

### #18 — `ResearchMode` picker ✅

| Field | Value |
| --- | --- |
| Description | Wraps `search_research` Tauri command (existing). Click attaches research source as a chip. |
| Complexity | S |
| Category | frontend |
| Depends on | #11, #13 |
| Files | `src/components/cmd/modes/ResearchMode.tsx` |

### #19 — `PaletteMode` picker ✅

| Field | Value |
| --- | --- |
| Description | Registers Notesage commands (Export PDF, Preview removed — skip, New note, Toggle focus mode, Toggle sidebar, Open settings, etc.). Enter executes immediately; no message sent. |
| Complexity | M |
| Category | frontend |
| Depends on | #13 |
| Files | `src/components/cmd/modes/PaletteMode.tsx` |

### #20 — Command-bar keyboard shortcuts ⚠️

| Field | Value |
| --- | --- |
| Description | Implement: ⌘K → focus bar; ⌘1/⌘⇧1 → focus + prefill `!`; ⌘2/⌘⇧2 → `@`; ⌘3/⌘⇧3 → `#`; ⌘4/⌘⇧4 → `?`; ⌘⇧P → `>`; Esc → collapse bar (with fall-through: closes suggest dropdown first, then collapses). Both unshifted and shifted variants bound to same handlers. |
| Complexity | M |
| Category | frontend |
| Depends on | #9, #13 |
| Files | `src/hooks/useCommandBarShortcuts.ts` |

### #21 — Double-tap ⌘ detection (alternate bar focus) ⚠️

| Field | Value |
| --- | --- |
| Description | Detect double-tap on either ⌘ key within \~300 ms → focus command bar. Implement at Tauri IPC or use native `keydown`/`keyup` with timing. If detection unreliable on some platforms, log as known limitation and retain ⌘K as primary. |
| Complexity | M |
| Category | frontend |
| Depends on | #20 |
| Files | `src/hooks/useDoubleTapCmd.ts`, `src/hooks/useCommandBarShortcuts.ts` |

### #22 — Backend: skill-parser mid-text extension ✅

| Field | Value |
| --- | --- |
| Description | Extend skill-detection to match \`(?:^ |
| Complexity | M |
| Category | backend |
| Depends on | none |
| Files | `src-tauri/src/commands/skills_tool_parser.rs`, `src/stores/skill-store.ts` (frontend helper), tests |

### #23 — Wire composer send → chat-store ⚠️

| Field | Value |
| --- | --- |
| Description | Enter in input sends the message via existing `chat-store` APIs (new or append). Attachment chips sent along as context. On send: clear chips from input, display thumbnails in the resulting user message (like today's image-attach pattern). |
| Complexity | M |
| Category | frontend |
| Depends on | #9, #11, #12 |
| Files | `src/components/cmd/FloatingCommandBar.tsx`, `src/stores/chat-store.ts` wiring |

### #24 — Provider pill — wire to connections-store ⚠️

| Field | Value |
| --- | --- |
| Description | Click provider pill → dropdown showing registered connections (reuse `ProviderSwitcher` logic from existing ChatFooter). Selecting a provider triggers the same context-isolation flow (AgentSwitchCard when history exists). |
| Complexity | M |
| Category | frontend |
| Depends on | #10 |
| Files | `src/components/cmd/CommandBarContext.tsx`, reuses existing provider-switch logic |

### #25 — Project chips — wire to chat/workspace stores ✅

| Field | Value |
| --- | --- |
| Description | Chips reflect current conversation's `conv.projectPaths`. `×` removes a project from scope. `+ project` opens picker that lists available projects. Lock icon when project has `aiLock`. |
| Complexity | M |
| Category | frontend |
| Depends on | #10 |
| Files | `src/components/cmd/CommandBarContext.tsx`, `src/stores/chat-store.ts` |

### #26 — Mode pill — permission-level dropdown ✅

| Field | Value |
| --- | --- |
| Description | Click mode pill → dropdown: Read Only / Agent / Full Access / Plan. Same behavior as today's chat-footer mode selector, relocated. Full Access still triggers the mode-sandbox conflict dialog. |
| Complexity | S |
| Category | frontend |
| Depends on | #10 |
| Files | `src/components/cmd/CommandBarContext.tsx` |

### #27 — History view inside stream ⚠️

| Field | Value |
| --- | --- |
| Description | Clock icon in context row (or `⌘⇧H`) switches the stream into history-mode. List past conversations with date, title, provider, message count. Click loads conversation. `Esc` or click another mode returns to current chat. |
| Complexity | M |
| Category | frontend |
| Depends on | #10, #12 |
| Files | `src/components/cmd/CommandBarHistory.tsx` |

### #28 — Pinned-panel mode ✅

| Field | Value |
| --- | --- |
| Description | Pin icon in context row toggles composer from floating (bottom-centre) to pinned side panel (right edge, 400 px default, resizable via keyboard-focusable drag handle). State persists per window in settings-store. Orb hides while pinned. `⌘K` while pinned = focus in place (does NOT un-pin). Unpin via pin icon (now an "unpin" ×). |
| Complexity | L |
| Category | frontend |
| Depends on | #9 |
| Files | `src/components/cmd/FloatingCommandBar.tsx`, `src/components/QuietLayout.tsx` |

### #29 — `AgentOrb` component ✅

| Field | Value |
| --- | --- |
| Description | 46 px circle at bottom-right of workspace. CSS keyframe pulse while `activity-store.runningTasks > 0`; static otherwise. Count badge for running tasks. Keyboard focusable (`<button>`), activated by Space/Enter. Hidden when composer is in pinned-panel mode. |
| Complexity | M |
| Category | frontend |
| Depends on | #5, #8, #28 |
| Files | `src/components/activity/AgentOrb.tsx` |

---

## M1.3 Sidebar + Chrome (33 tasks)

### #30 — Flat-list `Sidebar` component ✅

| Field | Value |
| --- | --- |
| Description | New `Sidebar.tsx` (quiet-composer variant) rendering four sections: Pinned, Projects, Recent, Tags. Static layout first (no data wiring). Uppercase section headers with optional `+` add-button. |
| Complexity | M |
| Category | frontend |
| Depends on | #5 |
| Files | `src/components/sidebar/QuietSidebar.tsx` |

### #31 — Pinned section — wire to workspace-store ✅

| Field | Value |
| --- | --- |
| Description | Read pinned files from workspace-store (add `pinnedFiles: string[]` field if not present). Render items, click opens. Manual ordering preserved from drag-to-reorder (#45). |
| Complexity | S |
| Category | frontend |
| Depends on | #30 |
| Files | `src/components/sidebar/QuietSidebar.tsx`, `src/stores/workspace-store.ts` |

### #32 — Projects section — wire to workspace-store ✅

| Field | Value |
| --- | --- |
| Description | Flat list of projects with file counts. No expand/collapse. |
| Complexity | S |
| Category | frontend |
| Depends on | #30 |
| Files | `src/components/sidebar/QuietSidebar.tsx` |

### #33 — Recent section (with cap) ✅

| Field | Value |
| --- | --- |
| Description | Read recent documents from `editor-store`, sorted by last-touched. Default cap 5. "Show more" expands in place. |
| Complexity | S |
| Category | frontend |
| Depends on | #30 |
| Files | `src/components/sidebar/QuietSidebar.tsx` |

### #34 — Tags section (with cap) ✅

| Field | Value |
| --- | --- |
| Description | Query top N tags from SQLite index by usage count. Default cap 5. "Show more" expands. Click a tag → composer with `#tagname` prefilled (navigates via #20 ⌘3 path). |
| Complexity | S |
| Category | frontend |
| Depends on | #30 |
| Files | `src/components/sidebar/QuietSidebar.tsx` |

### #35 — Sidebar composition settings ✅

| Field | Value |
| --- | --- |
| Description | Settings &gt; Appearance &gt; Sidebar composition. Per-section: cap slider (3–15), hide toggle. Persisted in settings-store. Consumers read from settings. |
| Complexity | M |
| Category | frontend |
| Depends on | #30 |
| Files | settings panel, `src/stores/settings-store.ts` |

### #36 — `FolderPeek` hover popover ✅

| Field | Value |
| --- | --- |
| Description | Hover 220 ms on a Projects item → popover to the right showing one level of children (folders and a few recent files inside) + footer hint linking to tree overlay. Mouse-leave fades out. |
| Complexity | M |
| Category | frontend |
| Depends on | #30 |
| Files | `src/components/sidebar/FolderPeek.tsx` |

### #37 — FolderPeek keyboard equivalent ✅

| Field | Value |
| --- | --- |
| Description | Arrow-right (`→`) on a focused Projects item inline-expands children one level; arrow-left (`←`) collapses. Accessibility parity with hover-peek — hover-only UI is invisible to keyboard users. |
| Complexity | M |
| Category | frontend |
| Depends on | #36 |
| Files | `src/components/sidebar/FolderPeek.tsx`, sidebar keyboard handlers |

### #38 — `TreeOverlay` component ✅

| Field | Value |
| --- | --- |
| Description | Slide-in panel from left (over sidebar) on `⌘⇧E`. Search input auto-focused. Standard caret-triangle expand/collapse. `role="tree"` ARIA. Esc closes + restores focus. Handles arbitrary depth. |
| Complexity | L |
| Category | frontend |
| Depends on | #30 |
| Files | `src/components/sidebar/TreeOverlay.tsx` |

### #39 — `SidebarInlineEdit` primitive ✅

| Field | Value |
| --- | --- |
| Description | Shared inline-input for rename + create. Two modes: `rename` (pre-filled, Enter commits via callback, Esc cancels to original), `create` (blank input, Enter commits via callback, Esc removes the row and calls no callback — no FS write). |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `src/components/sidebar/SidebarInlineEdit.tsx` |

### #40 — Inline rename (F2, double-click) ✅

| Field | Value |
| --- | --- |
| Description | F2 or double-click on a focused sidebar item → enter rename mode. Enter calls `rename_path` Tauri command with old + new paths. Esc cancels. |
| Complexity | S |
| Category | frontend |
| Depends on | #39 |
| Files | `src/components/sidebar/QuietSidebar.tsx`, sidebar items |

### #41 — Inline create note (⌘N + `+` on Projects) ✅

| Field | Value |
| --- | --- |
| Description | `⌘N` inserts `SidebarInlineEdit` in create mode at current document's folder location. `+` button on a project creates in project root. On Enter: `create_file` Tauri command writes empty `.md` file. Esc: no FS write. New file auto-opens in editor. |
| Complexity | M |
| Category | frontend |
| Depends on | #39 |
| Files | `src/components/sidebar/QuietSidebar.tsx`, keyboard hook |

### #42 — Inline create project (⌘⇧N + `+` on Projects header) ✅

| Field | Value |
| --- | --- |
| Description | `⌘⇧N` or `+` button on Projects section header → `SidebarInlineEdit` in create mode. On Enter: `create_directory` under `~/Notesage/<name>/`. Projects start empty (no template picker). Esc: no FS write. |
| Complexity | M |
| Category | frontend |
| Depends on | #39 |
| Files | same |

### #43 — Type-to-filter per section ✅

| Field | Value |
| --- | --- |
| Description | When sidebar has focus, typing filters items in each section inline (case-insensitive substring). Esc clears. Matches Linear's issue-list filter pattern. |
| Complexity | M |
| Category | frontend |
| Depends on | #30 |
| Files | `src/components/sidebar/QuietSidebar.tsx` |

### #44 — Drag-to-pin + drag-to-reorder Pinned ✅

| Field | Value |
| --- | --- |
| Description | Drag a Projects or Recent item into the Pinned section → pin. Drag within Pinned → reorder. Persist order in workspace-store. |
| Complexity | L |
| Category | frontend |
| Depends on | #30, #31 |
| Files | `src/components/sidebar/QuietSidebar.tsx`, `src/stores/workspace-store.ts` |

### #45 — Right-click context menu (shadcn `context-menu`) ✅

| Field | Value |
| --- | --- |
| Description | On any sidebar item: Open, Rename (F2), Duplicate (⌘D), Pin / Unpin, Reveal in Finder (⌘⌥R), Copy path (⌘⌥C), Copy filename, Move to…, Move to trash (⌘⌫). Use shadcn `context-menu` primitive. |
| Complexity | M |
| Category | frontend |
| Depends on | #30 |
| Files | `src/components/sidebar/SidebarContextMenu.tsx` |

### #46 — Copy path / Reveal in Finder ✅

| Field | Value |
| --- | --- |
| Description | Use existing `reveal_in_finder` Tauri command if present, else add. `Copy path` writes absolute path to clipboard via Tauri clipboard API. Show toast confirmation. Keyboard shortcuts ⌘⌥C and ⌘⌥R wired. |
| Complexity | S |
| Category | both |
| Depends on | #45 |
| Files | `src-tauri/src/commands/file.rs` (if needed), frontend wiring |

### #47 — Hover preview for files ✅

| Field | Value |
| --- | --- |
| Description | 500 ms hover on a file row → popover with first \~10 lines of the document. Uses `read_file` Tauri command. Keyboard equivalent is the right-arrow expansion pattern, or simply the tree overlay for exhaustive browsing. |
| Complexity | M |
| Category | frontend |
| Depends on | #30 |
| Files | `src/components/sidebar/FilePreview.tsx` |

### #48 — `DocHead` breadcrumb ✅

| Field | Value |
| --- | --- |
| Description | Replaces TabBar. Breadcrumb showing `Notesage / project / folder / file.md` with dirty dot and right-aligned "saved 40 s ago". Fades on type. 130 px right-padding reserved for the future theme/accent area. |
| Complexity | M |
| Category | frontend |
| Depends on | #5 |
| Files | `src/components/editor/DocHead.tsx` |

### #49 — Toolbar floating pill refactor ✅

| Field | Value |
| --- | --- |
| Description | Refactor existing `Toolbar.tsx` into a floating pill at top-centre of the document area. Same content; new chrome. `backdrop-filter: blur(14px)`. Fades on type. |
| Complexity | M |
| Category | frontend |
| Depends on | #5 |
| Files | `src/components/editor/Toolbar.tsx` |

### #50 — Fade-on-type hook + class ✅

| Field | Value |
| --- | --- |
| Description | Hook detects typing (1200 ms inactivity timer). Adds `.typing` class on `.app` root. CSS `.app.typing X { opacity: 0 }` fades targets. Mouse-move, wheel-scroll, focus-change remove the class. Transition 340 ms ease. Respects `prefers-reduced-motion`. **Exclude** `.cmdbar` and `.cmdbar *` from fade. |
| Complexity | M |
| Category | frontend |
| Depends on | #49, #8 |
| Files | `src/hooks/useFadeOnType.ts`, `src/components/QuietLayout.tsx`, `src/styles/globals.css` |

### #51 — Quiet-chrome presets ✅

| Field | Value |
| --- | --- |
| Description | Settings &gt; Appearance &gt; Quiet chrome with 4 presets (Relaxed / Default / Aggressive / Focus mode is a separate mode). Each preset flips CSS classes on `.app` controlling which elements fade. Advanced sub-panel exposes per-element toggles. |
| Complexity | M |
| Category | frontend |
| Depends on | #50 |
| Files | `src/lib/quiet-chrome.ts`, settings panel |

### #52 — Simplified `StatusBar` + click handler ✅

| Field | Value |
| --- | --- |
| Description | Refactor status bar to minimal strip: `2,184 words · saved 40 s · ⌘K ask · ⌘. focus`. Click target opens `StatusTray` popover. Fades on type. |
| Complexity | S |
| Category | frontend |
| Depends on | #5 |
| Files | `src/components/editor/StatusBar.tsx` |

### #53 — `StatusTray` popover ✅

| Field | Value |
| --- | --- |
| Description | Popover opened from status bar click. Four groups (per PRD): Completions (segmented picker Off/Copilot/Local AI/Ollama), Comments (open count + list expansion), Session (Local AI running, tool calling, recording), Help (shortcuts icon, word count breakdown). Uses existing stores. |
| Complexity | L |
| Category | frontend |
| Depends on | #52 |
| Files | `src/components/editor/StatusTray.tsx` |

### #54 — Status-bar ambient dots ✅

| Field | Value |
| --- | --- |
| Description | Small inline dots on the status bar strip: ● green when Local AI server is the active provider and running, ● orange when inline completions are active on this doc, ● red when voice recording is live. Each dot links semantically to its group in the tray. |
| Complexity | S |
| Category | frontend |
| Depends on | #52 |
| Files | `src/components/editor/StatusBar.tsx` |

### #55 — `FocusPill` component ✅

| Field | Value |
| --- | --- |
| Description | Appears at top-centre when focus mode active. Text: `Focus · ⌘. to exit`. Clickable × exits focus mode. Respects reduced motion (no fade-in if `prefers-reduced-motion`). |
| Complexity | S |
| Category | frontend |
| Depends on | #5 |
| Files | `src/components/editor/FocusPill.tsx` |

### #56 — `useFocusMode` hook + Esc fall-through ✅

| Field | Value |
| --- | --- |
| Description | `⌘.` toggles `.app.focus-mode`. Sidebar fades+slides, chrome hides, doc gains +110 px top-padding, orb dims to 30%. `Esc` fall-through order: 1) any open popover/dropdown, 2) command bar expanded state, 3) inline edits, 4) focus mode. Screen reader announcement on enter/exit. |
| Complexity | M |
| Category | frontend |
| Depends on | #55, #50 |
| Files | `src/hooks/useFocusMode.ts` |

### #57 — `ViewerToolbarPill` shared primitive ✅

| Field | Value |
| --- | --- |
| Description | Shared floating pill primitive for viewers. Same visual as editor toolbar pill. Accepts a slotted content prop. Fades on scroll (viewers don't have a "typing" signal; use scroll events). |
| Complexity | M |
| Category | frontend |
| Depends on | #49 |
| Files | `src/components/editor/viewers/ViewerToolbarPill.tsx` |

### #58 — Adopt `ViewerToolbarPill` — PdfViewer ✅

| Field | Value |
| --- | --- |
| Description | Replace PdfViewer's current toolbar with `ViewerToolbarPill` content: zoom (−/+/fit-width/fit-page), page nav (← N of M →), bookmarks, search. Preserve all behaviour. |
| Complexity | M |
| Category | frontend |
| Depends on | #57 |
| Files | `src/components/editor/viewers/PdfViewer.tsx` |

### #59 — Adopt `ViewerToolbarPill` — EpubViewer ✅

| Field | Value |
| --- | --- |
| Description | Contents: TOC, bookmarks, paginated ↔ scroll toggle, search. |
| Complexity | M |
| Category | frontend |
| Depends on | #57 |
| Files | `src/components/editor/viewers/EpubViewer.tsx` |

### #60 — Adopt `ViewerToolbarPill` — DocxViewer ✅

| Field | Value |
| --- | --- |
| Description | Contents: zoom, search, Convert to Markdown action. |
| Complexity | S |
| Category | frontend |
| Depends on | #57 |
| Files | `src/components/editor/viewers/DocxViewer.tsx` |

### #61 — Adopt `ViewerToolbarPill` — PptxViewer ✅

| Field | Value |
| --- | --- |
| Description | Contents: zoom, slide nav, speaker-notes toggle, search. |
| Complexity | M |
| Category | frontend |
| Depends on | #57 |
| Files | `src/components/editor/viewers/PptxViewer.tsx` |

### #62 — CodeEditor language indicator pill ✅

| Field | Value |
| --- | --- |
| Description | Small pill at top of `CodeEditor` showing language name (e.g. "TypeScript"). Same visual family as viewer pills. CodeMirror content unchanged. |
| Complexity | S |
| Category | frontend |
| Depends on | #57 |
| Files | `src/components/editor/viewers/CodeEditor.tsx` |

---

## M1.4 Settings shell (6 tasks)

### #63 — `SettingsShell` + primitives (`SettingsRow`, `SettingsGroup`) ✅

| Field | Value |
| --- | --- |
| Description | Two-pane modal shell per Mockup E. Primitives for row (label + desc + right-aligned control) and group (label + 1 px hairlines). Shared across all panels. |
| Complexity | L |
| Category | frontend |
| Depends on | #5 |
| Files | `src/components/settings/v2/SettingsShell.tsx`, `SettingsRow.tsx`, `SettingsGroup.tsx` |

### #64 — Settings search ✅

| Field | Value |
| --- | --- |
| Description | `⌘F` when settings open focuses search input in nav. Filters both nav items and content rows with highlights. Announces match count. |
| Complexity | M |
| Category | frontend |
| Depends on | #63 |
| Files | `src/components/settings/v2/SettingsSearch.tsx` |

### #65 — Migrate Appearance panel ✅

| Field | Value |
| --- | --- |
| Description | New panel using `SettingsShell`. Rows: Color mode (Light/Dark/System), Contrast slider, Reduce motion toggle, Density, Sidebar composition (from #35), Quiet chrome preset (from #51), **Accent picker** (Default/Orange/Blue/System, calls `setAccent`, System via #4), Editor font, Font size, Line height, live preview card. |
| Complexity | L |
| Category | frontend |
| Depends on | #63, #3, #4, #51 |
| Files | `src/components/settings/v2/AppearanceSettings.tsx` |

### #66 — Migrate General + Editor + Skills + Projects + Privacy + Advanced + About panels ✅

| Field | Value |
| --- | --- |
| Description | Adopt `SettingsShell` primitives for the remaining non-AI panels. Content preserved; wrapper changes. Treat as one task of medium granularity per panel — seven panels total. Behaviour unchanged. |
| Complexity | L |
| Category | frontend |
| Depends on | #63 |
| Files | `src/components/settings/v2/*.tsx` |

### #67 — Migrate AI & Agents panel (dense — per Mockup K) ✅

| Field | Value |
| --- | --- |
| Description | Rebuild using new shell. Sections: Connections (cards with provider/status/badges/actions + add-connection row), Routing (use-case → provider selects), Tool calling (switches + select), Network sandbox (switches), Persisted approvals (revocable list). All data from existing stores. |
| Complexity | L |
| Category | frontend |
| Depends on | #63 |
| Files | `src/components/settings/v2/AISettings.tsx` |

### #68 — "Review external diff" setting placement + semantics clarified ✅

| Field | Value |
| --- | --- |
| Description | Move "Review external diff" to Settings &gt; Editor (if not already). Storage key and default unchanged. Docs and tooltip updated to reflect broadened scope: gates all external-change UX (clean + dirty). |
| Complexity | S |
| Category | frontend |
| Depends on | #66, #71 |
| Files | `src/components/settings/v2/EditorSettings.tsx` |

---

## M1.5 Removals + external-change rewire (6 tasks)

### #69 — Delete `NewNoteDialog` + callers ✅

| Field | Value |
| --- | --- |
| Description | Remove `NewNoteDialog.tsx`. All callers now route to inline create flow (#41). Under legacy path: dialog still exists until Phase 3 — gate the deletion behind `uiPreview === "quiet-composer"` at render time. Code itself stays. |
| Complexity | S |
| Category | frontend |
| Depends on | #41 |
| Files | `src/components/NewNoteDialog.tsx` (kept until Phase 3), `src/App.tsx` |

### #70 — Delete `NewProjectDialog` + callers (preview-gated) ✅

| Field | Value |
| --- | --- |
| Description | Same pattern as #69. Template picker moves to a `/scaffold-project` skill (not blocking for Phase 1; templates simply unavailable during preview until skill is authored — acceptable regression documented in release notes). |
| Complexity | S |
| Category | frontend |
| Depends on | #42 |
| Files | `src/components/NewProjectDialog.tsx` (kept until Phase 3) |

### #71 — Rewire external-change flow + delete `DiffReviewBanner` ✅

| Field | Value |
| --- | --- |
| Description | Implement `toastExternalChange({ onAccept, onReject, onDismiss })` helper (sonner action toast, sticky). Update `useFileWatcher` logic: when `externalChangeDiffReview` OFF → silent auto-reload + info toast (`<name> reloaded from disk`, no actions, 3 s). When ON → inline decorations + sticky action toast. `DiffReviewBanner.tsx` deleted. Update `docs/features/workspace.md` line 108 cleanup. |
| Complexity | L |
| Category | frontend |
| Depends on | none (independent of preview flag — this applies to both paths) |
| Files | `src/components/editor/DiffReviewBanner.tsx` (delete), `src/lib/notifications.ts`, `src/hooks/useFileWatcher.ts`, `docs/features/workspace.md` |

### #72 — Delete Preview-as-HTML mode ✅

| Field | Value |
| --- | --- |
| Description | Remove `HtmlViewer` mode and `⌘⇧P` shortcut binding. Keep HTML export (unchanged). Applies to both paths — this is a pure feature removal, not a UI-refresh gate. Release notes flag the removal. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/components/editor/viewers/HtmlViewer.tsx` (delete), keyboard shortcut hook, `docs/keyboard-shortcuts.md` |

### #73 — Delete cross-project-mode banner; replace with context-row pill ✅

| Field | Value |
| --- | --- |
| Description | Remove the persistent banner above the chat input. Add a compact "Cross-project scope" warning pill to the context row (only visible when `crossProjectMode` is on). |
| Complexity | S |
| Category | frontend |
| Depends on | #10 |
| Files | chat input markup, `src/components/cmd/CommandBarContext.tsx` |

### #74 — Hide legacy components under preview flag (TabBar, ChatPanel, ActivityStrip, CommandPalette, ChatFooter) ✅

| Field | Value |
| --- | --- |
| Description | In `Layout` / `QuietLayout`, do not render these components when `uiPreview === "quiet-composer"`. Components remain in code and render in legacy path. Use `Phase 3` to delete them entirely. |
| Complexity | M |
| Category | frontend |
| Depends on | #5, #9, #28, #29, #30 |
| Files | `src/components/Layout.tsx`, `src/components/QuietLayout.tsx` |

---

## M1.6 State + plumbing (3 tasks)

### #75 — Rename `editor-store.openTabs` → `openDocuments` ✅

| Field | Value |
| --- | --- |
| Description | Semantic rename across store and consumers. Zustand persist migration bumps store version; migrator maps `openTabs` → `openDocuments` on load. Keyboard navigation (⌘⇧\[/\]) still cycles. |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `src/stores/editor-store.ts`, all consumers, tests |

### #76 — Consolidated keyboard shortcut hook ✅

| Field | Value |
| --- | --- |
| Description | Central `useKeyboardShortcuts()` mounted at app root. Aware of `uiPreview` flag; activates either legacy or quiet-composer bindings. Includes: ⌘K, ⌘1–4 (both variants), ⌘⇧P, ⌘⇧E, ⌘⇧H, ⌘., ⌘⇧K, ⌘⇧\[/\], ⌘⌥C, ⌘⌥R, ⌘N, ⌘⇧N. |
| Complexity | M |
| Category | frontend |
| Depends on | #20, #56 |
| Files | `src/hooks/useKeyboardShortcuts.ts` |

### #77 — `⌘⇧[` / `⌘⇧]` cycle Recent ✅

| Field | Value |
| --- | --- |
| Description | Cycle through `editor-store.openDocuments` in most-recently-used order. Replaces tab-cycle muscle memory. |
| Complexity | S |
| Category | frontend |
| Depends on | #75, #76 |
| Files | shortcut hook |

---

## M1.7 Accessibility (10 tasks)

### #78 — ARIA: FloatingCommandBar ✅

| Field | Value |
| --- | --- |
| Description | `role="combobox"` on input; suggestion list `role="listbox"` with `aria-activedescendant`; `↑/↓` navigation; mode change announced via `aria-live="polite"`. Chat stream region `aria-live="polite"`. Tab order: input → suggestions → chips → context row. |
| Complexity | M |
| Category | frontend |
| Depends on | #9, #13 |
| Files | `src/components/cmd/FloatingCommandBar.tsx` + sub-components |

### #79 — ARIA: AgentOrb ✅

| Field | Value |
| --- | --- |
| Description | `<button>` with `aria-label="Agent — N tasks running"` (updated on count change). Pulse animation disabled under `prefers-reduced-motion`. Panel opens on Enter; focus traps; Esc restores focus to orb. |
| Complexity | S |
| Category | frontend |
| Depends on | #29 |
| Files | `AgentOrb.tsx`, `AgentPanel.tsx` |

### #80 — ARIA: Sidebar + keyboard hover-peek ✅

| Field | Value |
| --- | --- |
| Description | `↑/↓` within a section, `Tab` between sections. `F2` announces "Renaming *filename*". `→` expands FolderPeek inline (keyboard parity with hover — critical). Right-click menu also via macOS Menu key / `⌘⇧,`. |
| Complexity | M |
| Category | frontend |
| Depends on | #37, #45 |
| Files | sidebar + sub-components |

### #81 — ARIA: TreeOverlay ✅

| Field | Value |
| --- | --- |
| Description | Focus trap inside overlay. Search auto-focus. `role="tree"` with `aria-expanded` / `aria-level` per node. Esc closes + returns focus. |
| Complexity | M |
| Category | frontend |
| Depends on | #38 |
| Files | `TreeOverlay.tsx` |

### #82 — ARIA: PinnedPanel ✅

| Field | Value |
| --- | --- |
| Description | `role="region" aria-label="Chat panel"`. No focus trap (user can Tab out). Resize handle: `role="slider"` with `aria-valuenow`/min/max, keyboard ←/→ adjust width ±20 px. Unpin button: `aria-label="Return chat to floating bar"`. |
| Complexity | M |
| Category | frontend |
| Depends on | #28 |
| Files | `FloatingCommandBar.tsx` pinned mode |

### #83 — ARIA: PermissionCard ✅

| Field | Value |
| --- | --- |
| Description | Wrapper `aria-live="assertive"`. Buttons labeled with full intent (`"Allow write_file to <path>"`, not just "Allow"). Countdown throttled: appearance once, then only at 10 s and 5 s. Focus moves to Allow when card appears. |
| Complexity | S |
| Category | frontend |
| Depends on | #29 |
| Files | `PermissionCard.tsx` (existing, annotated) |

### #84 — ARIA: Focus mode announcements ✅

| Field | Value |
| --- | --- |
| Description | On enter: announce "Focus mode on. Press Command period to exit." On exit: "Focus mode off. Chrome restored." Focus returns to pre-focus-mode element. FocusPill is `aria-hidden="true"`. |
| Complexity | S |
| Category | frontend |
| Depends on | #56 |
| Files | `useFocusMode.ts`, `FocusPill.tsx` |

### #85 — ARIA: SettingsShell ✅

| Field | Value |
| --- | --- |
| Description | Focus trap while open; Esc closes. Each row's control has `aria-describedby` pointing to the description. Live preview `aria-hidden="true"`. |
| Complexity | S |
| Category | frontend |
| Depends on | #63 |
| Files | `SettingsShell.tsx`, `SettingsRow.tsx` |

### #86 — Reduced-motion sweep ✅

| Field | Value |
| --- | --- |
| Description | Audit every animation in new components: fade-on-type, orb pulse, focus-pill fade, tree overlay slide, cmdbar lift, peek unfurl, settings modal appear, status-tray popover. Each must detect `prefers-reduced-motion` and disable the transition (not just shorten). Global CSS `@media (prefers-reduced-motion: reduce)` fallback in addition. |
| Complexity | M |
| Category | frontend |
| Depends on | most animation tasks |
| Files | various |

### #87 — Automated contrast audit ✅

| Field | Value |
| --- | --- |
| Description | Node script scans `globals.css` for color pairs and asserts AA thresholds (4.5:1 body, 3:1 UI). Runs in CI; fails the job on regression. Includes all four accent combinations × light/dark. |
| Complexity | M |
| Category | frontend |
| Depends on | #3 |
| Files | `scripts/contrast-audit.ts`, `.github/workflows/test.yml` |

---

## M1.8 Performance benchmarks (5 tasks)

### #88 — `cmdbar.perf.test.ts` ✅

| Field | Value |
| --- | --- |
| Description | Suite covering: bar focus (compact→expanded ≤ 100 ms), dismiss (≤ 80 ms), prefix morph (≤ 50 ms), attachment-chip add (≤ 30 ms), context row initial render with 3 projects (≤ 20 ms). Uses existing `benchmark()` harness. |
| Complexity | M |
| Category | frontend |
| Depends on | #9 |
| Files | `src/perf/cmdbar.perf.test.ts` |

### #89 — `orb.perf.test.ts` ✅

| Field | Value |
| --- | --- |
| Description | Orb panel open with N tasks (≤ 120 ms). Orb pulse must have 0 ms/frame JS cost (profile assertion). |
| Complexity | S |
| Category | frontend |
| Depends on | #29 |
| Files | `src/perf/orb.perf.test.ts` |

### #90 — `status-tray.perf.test.ts` ✅

| Field | Value |
| --- | --- |
| Description | Popover open (≤ 150 ms), comments list expand, segmented picker click. |
| Complexity | S |
| Category | frontend |
| Depends on | #53 |
| Files | `src/perf/status-tray.perf.test.ts` |

### #91 — `sidebar-filter.perf.test.ts` ✅

| Field | Value |
| --- | --- |
| Description | Type-to-filter at N = 100 / 500 / 2000 items (first keystroke ≤ 50 ms, subsequent ≤ 20 ms). |
| Complexity | M |
| Category | frontend |
| Depends on | #43 |
| Files | `src/perf/sidebar-filter.perf.test.ts` |

### #92 — Update `docs/performance-baseline.md` with new budgets and post-Phase-1 measurements ✅

| Field | Value |
| --- | --- |
| Description | Append dated entry to Startup Performance section (required per CLAUDE.md perf-tracking rule). Record new-component budgets. Capture `phase1-ready`, `startup ready`, `tree refresh`, `skills total` for baseline comparison. |
| Complexity | S |
| Category | doc |
| Depends on | all perf tasks above |
| Files | `docs/performance-baseline.md` |

---

## M1.9 Docs + release prep (6 tasks)

### #93 — Update `docs/design-system.md` ✅

| Field | Value |
| --- | --- |
| Description | Add Quiet Composer layout section. Codify fade-on-type, orb pattern, peek/tree-overlay. Accent token guardrails. |
| Complexity | M |
| Category | doc |
| Depends on | most UI tasks |
| Files | `docs/design-system.md` |

### #94 — Update `docs/features/editor.md` + `ai-workflows.md` + `workspace.md` ✅

| Field | Value |
| --- | --- |
| Description | Tabs removed; doc-head breadcrumb. Chat panel → floating composer; activity strip → orb. Sidebar flat + tree overlay. **Workspace.md line 108 banner cleanup required.** |
| Complexity | M |
| Category | doc |
| Depends on | most UI tasks |
| Files | three files |

### #95 — Update `docs/keyboard-shortcuts.md` ✅

| Field | Value |
| --- | --- |
| Description | Add ⌘⇧E, ⌘⇧H, ⌘⌥C, ⌘⌥R, ⌘⇧K. Note ⌘1–4 / ⌘⇧1–4 both bindings. Add double-tap ⌘. Remove ⌘⇧P (Preview HTML). Show glyph notation. |
| Complexity | S |
| Category | doc |
| Depends on | #76 |
| Files | `docs/keyboard-shortcuts.md` |

### #96 — Update `docs/architecture.md` ✅

| Field | Value |
| --- | --- |
| Description | Component tree updated per PRD's Component Inventory. New stores/hooks noted. |
| Complexity | S |
| Category | doc |
| Depends on | most tasks |
| Files | `docs/architecture.md` |

### #97 — Preview invitation banner ✅

| Field | Value |
| --- | --- |
| Description | One-time dismissible banner shown on first launch after the Phase 1 release installs. "Try the new UI — a calmer, more focused Notesage \[Try it\]". Repeats once after 30 days if dismissed. Stored via settings-store flag. |
| Complexity | M |
| Category | frontend |
| Depends on | #1 |
| Files | `src/components/PreviewInvitation.tsx`, settings-store |

### #98 — Changelog entry for Phase 1 ✅

| Field | Value |
| --- | --- |
| Description | Write release notes for the Phase 1 release. Call out: Preview UI, how to try it, what's in it, what's removed (Preview HTML, DiffReviewBanner), known limitations. |
| Complexity | S |
| Category | doc |
| Depends on | all |
| Files | `CHANGELOG.md` |

---

## M1.10 Pre-ship validation (2 tasks)

### #99 — VoiceOver walkthrough — checklist artifact ✅

| Field | Value |
| --- | --- |
| Description | Draft the VoiceOver QA checklist covering every Phase 1 surface (FloatingCommandBar, AgentOrb / AgentPanel, QuietSidebar, TreeOverlay, FolderPeek, PermissionCard, FocusPill, SettingsShell, PreviewInvitation) plus reduced-motion verification + legacy-Layout regression. The actual VoiceOver run-through is Phase 2 #7 (gated on F7 — editor mount in QuietLayout). |
| Complexity | M |
| Category | doc |
| Depends on | all a11y tasks |
| Files | `docs/tasks/qa/2026-04-21-voiceover-checklist.md` |

### #100 — Keyboard-only walkthrough — checklist artifact ✅

| Field | Value |
| --- | --- |
| Description | Draft the keyboard-only QA checklist covering the 5 spec flows (create new note, delegate a comment, export PDF, switch provider mid-chat, enter + exit focus mode) plus a Phase-1-shell coverage section. Flag flows gated on F7 / F8 inline. The actual keyboard-only run-through is Phase 2 #8 (gated on F7 + F8). |
| Complexity | S |
| Category | doc |
| Depends on | all a11y tasks |
| Files | `docs/tasks/qa/2026-04-21-keyboard-only.md` |

---

## M1.11 Functionality — wire the editor + chat into QuietLayout (2 tasks)

This milestone closes the planning gap surfaced during the Phase 1 trial (2026-04-23): the Foundation milestones (M1.1–M1.10) built the new shell + design system + ARIA + perf, but never assigned tasks to mount the actual editor or chat inside QuietLayout. **Phase 1 cannot ship without these tasks** — the new UI is non-functional until they land.

### #101 — Mount the editor inside QuietLayout center column ✅

| Field | Value |
| --- | --- |
| Description | Replace the `<div data-doc-area-placeholder>Document area (placeholder)</div>` in `QuietLayout.tsx` (line 264) with the real `<Editor />` mount from `Layout.tsx`. Verify `editor-store` integration: clicking a file in QuietSidebar opens it in the editor; tab switching works; per-tab undo/redo cache survives. May need to also mount `<FindBar />`, the floating `<Toolbar />`, and any editor-area chrome that lives alongside. |
| Complexity | L |
| Category | frontend |
| Depends on | #30, #48 |
| Files | `src/components/QuietLayout.tsx`, possibly `src/components/editor/Editor.tsx` |
| Surfaced as | F7 in `phase1-followups.md` (promoted to numbered task) |

### #102 — Decide and mount the chat in QuietLayout right column ✅

| Field | Value |
| --- | --- |
| Description | When the FloatingCommandBar is NOT pinned, the right column is `<ZonePlaceholder label="Reserved (placeholder)" />`. The intent: the FloatingCommandBar IS the chat in Quiet Composer mode. Replace the placeholder with either (a) an empty div (if the column is purely for layout balance — likely correct), or (b) a compact "Recent threads" rail. Don't re-mount the full classic `<ChatPanel />` — that defeats the purpose of the FloatingCommandBar. |
| Complexity | S–M |
| Category | frontend |
| Depends on | #101 |
| Files | `src/components/QuietLayout.tsx` |
| Surfaced as | F8 in `phase1-followups.md` (promoted to numbered task) |

---

## M1.12 Trial-finding polish — close 5 gaps from the project lead's first trial (5 tasks)

### #103 — TitleBar in QuietLayout: hide legacy chat / agent toggle buttons

| Field | Value |
| --- | --- |
| Description | `<TitleBar onToggleChat={noop} onToggleActivityStrip={noop} />` in `QuietLayout.tsx` line 251 mounts the same TitleBar as classic, including chat-toggle and agent-strip-toggle buttons that do nothing in Quiet Composer (props are stubs). Add \`mode?: 'classic' |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/components/TitleBar.tsx`, `src/components/QuietLayout.tsx` |
| Surfaced as | F9 in `phase1-followups.md` |

### #104 — TreeOverlay UX bugs: ⌘⇧E toggle, Esc dismiss, traffic-light overlap

| Field | Value |
| --- | --- |
| Description | Three bugs in TreeOverlay: (a) `⌘⇧E` is open-only — re-pressing while open is a no-op visually; should toggle close. (b) Esc doesn't dismiss reliably — investigate whether focus is escaping the overlay or being swallowed elsewhere. (c) The overlay's `top: 0` covers macOS traffic-light buttons (red/yellow/green); add `padding-top: var(--titlebar-inset, 28px)` so it sits below them. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/components/QuietLayout.tsx` (toggle logic), `src/components/sidebar/quiet/TreeOverlay.tsx` (positioning + Esc investigation) |
| Surfaced as | F10 in `phase1-followups.md` |

### #105 — Set window title from active document

| Field | Value |
| --- | --- |
| Description | The macOS window title (very top, OS-rendered) currently stays as "Notesage" regardless of which file is open. Set `document.title` from `editor-store` active tab. Format: `${activeFileName} — Notesage` when a doc is open; `Notesage` when no tab. Applies to both classic + Quiet Composer. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/App.tsx` or `src/hooks/useAppLifecycle.ts` |
| Surfaced as | F11 in `phase1-followups.md` |

### #106 — AgentOrb hover state polish

| Field | Value |
| --- | --- |
| Description | The orb uses `hover:scale-105` which is too subtle. Add either (a) a Radix Tooltip showing the same aria-label text on hover, (b) a soft `hover:shadow-lg` glow, or (c) both. Keep ambient — the orb shouldn't grab attention. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/components/activity/AgentOrb.tsx` |
| Surfaced as | F12 in `phase1-followups.md` |

### #107 — Switch-back-to-legacy banner inside QuietLayout

| Field | Value |
| --- | --- |
| Description | The legacy Layout already has a one-time `<PreviewInvitation />` banner inviting users to try Quiet Composer (#97). The reverse direction is missing — when in Quiet Composer mode, the user has no obvious affordance to flip back to classic without digging into Settings. Add a symmetric dismissible banner in QuietLayout — "Prefer the classic UI? \[Switch back\]" — that dismisses to a settings flag (similar to `previewInvitationDismissedAt`). Suggest reusing `<PreviewInvitation />` as a generalized two-direction banner OR creating a peer `<RevertInvitation />` component. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/components/PreviewInvitation.tsx` (or new `src/components/RevertInvitation.tsx`), `src/components/QuietLayout.tsx`, `src/stores/settings-store.ts` |
| Surfaced from | Project lead's 2026-04-23 trial — discoverability of the toggle is asymmetric |

### #111 — Mockup-vs-implementation audit — inventory + close design drift

| Field | Value |
| --- | --- |
| Description | Surfaced 2026-04-23 by the project lead's first trial: the original 100-task plan was derived from the mockups but never had an "audit implementation against mockups" task. Drift accumulated silently — the toolbar (#110), the sidebar, the title bar (legacy chat/agent buttons leaking through, #103), and likely the chat surface (when #102 lands) all diverge from the spec in ways the user notices on first use. **Walk every shipped surface against its canonical mockup**, file each drift item, and either fix inline (small) or split into new numbered tasks (large). Surfaces in scope: QuietSidebar (mockup D / mockup A), TitleBar in QuietLayout (mockup D), DocHead breadcrumb (mockup D), FloatingCommandBar compact + expanded + pinned (mockup A / mockup G / mockup I), AgentOrb + AgentPanel (mockup D — orb at bottom-right, panel popover behaviour), TreeOverlay (mockup D — slide-in animation + tree style), Settings shell (mockup E), Focus mode (mockup F), Permission card inline (mockup H), Quiet chrome fade-on-type behaviour (all mockups). Deliverable: `docs/tasks/qa/2026-04-23-mockup-audit.md` with one row per drift item: \`surface |
| Complexity | L |
| Category | qa |
| Depends on | #101 (editor), #102 (chat — needed to audit chat surface), #110 (toolbar — same drift class) |
| Files | `docs/tasks/qa/2026-04-23-mockup-audit.md` (artifact) + new task entries it spawns |
| Surfaced from | Project lead's 2026-04-23 trial: "the design is in several aspects different than the mockups we created before the implementation" |

### #112 — Toolbar pill — add `•••` overflow menu (7 items) ✅

| Field | Value |
| --- | --- |
| Description | Surfaced 2026-04-23 by the project lead — they expected an overflow menu in the pill but #110 shipped without one (F13 had deferred it). Add a `•••` (MoreHorizontal icon) button on the right edge of the pill (after Typography), with a separator before it. Clicking opens a shadcn `DropdownMenu` with these 7 items in this order: Strikethrough (⌘⇧X) · Inline code (⌘E) · Link (⌘K) · Image · Drawing · Code block · Horizontal rule. Each item dispatches the same editor command as the corresponding legacy-toolbar button. No auto-sort (per F13 — visible order is fixed for muscle memory; auto-sort idea revisited if/when overflow grows). Inline (legacy) variant unchanged. |
| Complexity | S |
| Category | frontend |
| Depends on | #110 |
| Files | `src/components/editor/Toolbar.tsx` (add overflow render branch in pill mode), unit test |
| Surfaced from | Project lead's 2026-04-23 trial — "the ... menu is missing in the toolbar" |

### #110 — Quiet Composer toolbar — wire pill variant + simplified button set ✅

| Field | Value |
| --- | --- |
| Description | Task #49 built `Toolbar.tsx`'s `variant="pill"` mode (rounded shape, backdrop-blur, fade-on-type via `data-quiet-toolbar`) but `Editor.tsx` never opts in — it always renders the legacy `"inline"` variant. Two-part fix: (a) Wire `variant="pill"` through `Editor.tsx` when `settings.uiPreview === "quiet-composer"`. (b) Reduce the visible button set in pill mode to **mockup D's 8-button shape** with the user's revisions: \`Heading ▾ |
| Complexity | M |
| Category | frontend |
| Depends on | #49, #101 |
| Files | `src/components/editor/Editor.tsx` (read uiPreview, pass variant), `src/components/editor/Toolbar.tsx` (conditional button set), `src/components/editor/StatusTray.tsx` (host dictation + source-mode toggle), unit tests |
| Surfaced from | Project lead's 2026-04-23 trial — Quiet Composer still showed the flat legacy toolbar; planning gap from the original 100-task plan |

### #113 — Functional-parity audit (separate from #111 visual audit) ✅

| Field | Value |
| --- | --- |
| Description | Inventory every user-reachable action in the legacy Layout and assert each has a working path in QuietLayout. Scope: every keyboard shortcut, every button in TitleBar / ChatFooter / ChatPanel / ActivityStrip / Sidebar / TabBar, every right-click menu item, every slash/prefix mode. Deliverable: `docs/tasks/qa/2026-04-23-functional-parity.md` with one row per action: surface, legacy path, Quiet Composer path, status, fix task. Any row with status ≠ "reachable" spawns or references a numbered fix task. This audit is **separate from #111**: #111 is visual mockup fidelity only; #113 is functional parity with the existing legacy shell. Must run before Phase 1 ships. |
| Complexity | L |
| Category | qa |
| Depends on | #101, #102 |
| Files | `docs/tasks/qa/2026-04-23-functional-parity.md` (artifact) + fix tasks it spawns |
| Surfaced from | 2026-04-23 trial revealed five functional regressions (⌘K, ⌘⌘, send, history, AgentSwitchCard) that unit tests passed. Root cause: no gate existed to prove functional reachability through the new shell. |

### #114 — Wire `subscribeToCmdBarEvents` in FloatingCommandBar + Esc fall-through ✅

| Field | Value |
| --- | --- |
| Description | `useCommandBarShortcuts` emits focus / dismiss intents on the `cmd-bar-events` bus, but no production component subscribes. Fix: `FloatingCommandBar` subscribes via `subscribeToCmdBarEvents` in a `useEffect`, maps `{ type: 'focus', prefix? }` → `expand()` + optional prefix prefill, maps `{ type: 'dismiss' }` → `collapse()`. Update Esc handling: Esc from ANYWHERE dismisses the expanded bar first (not gated on focus being inside the bar); when the bar is collapsed, Esc passes through to the rest of the chain (editor FindBar → Radix popover → focus mode → etc.). **Outcome-shaped acceptance**: (a) press ⌘K in a fresh app → bar expands within one tick; (b) press ⌘⇧P → bar expands with `>` prefix; (c) press ⌘2 → bar expands with `@` prefix; (d) press Esc from the editor with the bar expanded → bar collapses, editor keeps its focus; (e) press Esc from the editor with the bar collapsed → editor Esc handlers fire normally. **Composition test mandatory**: `<QuietLayout />` mounted with real stores, dispatch real KeyboardEvent, assert `[data-cmd-bar]` has `data-expanded="true"` after each shortcut. |
| Complexity | M |
| Category | frontend |
| Depends on | #20 (reverted) |
| Files | `src/components/cmd/FloatingCommandBar.tsx`, `src/hooks/useCommandBarShortcuts.ts` (Esc policy update), composition test in `src/components/cmd/__tests__/` |
| Surfaced from | 2026-04-23 trial: ⌘K / ⌘⇧P / ⌘1–4 / Esc did not open or dismiss the bar. |

### #115 — Mount `useDoubleTapCmd` in `useKeyboardShortcuts` ✅

| Field | Value |
| --- | --- |
| Description | The hook is defined and unit-tested in isolation but never called from any production file. Fix: call `useDoubleTapCmd()` inside `useKeyboardShortcuts` alongside `useCommandBarShortcuts` (same gating: only active when `uiPreview === 'quiet-composer'`). **Outcome-shaped acceptance**: press and release ⌘ twice within 300 ms in a fresh app → bar expands. **Composition test mandatory**: `<QuietLayout />` mounted, dispatch two `keydown key='Meta'` within 300 ms, assert bar expanded. |
| Complexity | S |
| Category | frontend |
| Depends on | #21 (reverted), #114 (the bar must subscribe to the bus first, otherwise the emitted focus event is dead) |
| Files | `src/hooks/useKeyboardShortcuts.ts`, composition test |
| Surfaced from | 2026-04-23 trial: double-tap ⌘ did not open the bar. |

### #116 — Debug "send shows bubble, no streaming response"

| Field | Value |
| --- | --- |
| Description | User reports: typing in the bar and pressing Enter shows a user-message bubble but no assistant response streams in. `sendChatMessage` is called per the code, but the observable outcome is missing. Investigate in order: (a) does `CommandBarStream` re-render on `chat-store` updates (selector correctness); (b) does the `ai_chat_stream` Tauri invocation actually fire (check devtools network / Rust log); (c) is there a silent error (missing connection, `aiLock`, empty routing); (d) is the assistant message being written to a conversation the bar isn't watching. Add a composition test that mocks `ai_chat_stream` via `tauri-mock.ts` to emit `ai-stream-chunk` events and asserts an assistant message with the streamed content appears in `CommandBarStream`. **Outcome-shaped acceptance**: send "hello" with a valid interactive connection configured → assistant message bubble appears and streams content. |
| Complexity | M |
| Category | frontend |
| Depends on | #23 (reverted), #114 (so the bar opens before this is tested) |
| Files | TBD — investigate first. Candidates: `src/components/cmd/FloatingCommandBar.tsx`, `src/components/cmd/CommandBarStream.tsx`, `src/stores/chat-store.ts` |
| Surfaced from | 2026-04-23 trial: user's bubble appeared but no assistant response. |

### #117 — Render AgentSwitchCard inside CommandBarStream

| Field | Value |
| --- | --- |
| Description | `AgentSwitchCard` is the context-isolation warning shown when the user switches provider mid-conversation. Currently only rendered inside `ChatMessageList.tsx` (classic `ChatPanel`). `CommandBarStream` does not render it, so Quiet Composer users never see the warning and silently lose context. Fix: render `AgentSwitchCard` inside `CommandBarStream` at the appropriate segment boundary, matching the legacy behavior. **Outcome-shaped acceptance**: open chat in Quiet Composer, send a message with Provider A, switch to Provider B, send another message → `AgentSwitchCard` appears in the stream. **Composition test mandatory**: seed chat-store with a provider-switch segment, render `CommandBarStream`, assert `AgentSwitchCard` is present. |
| Complexity | S |
| Category | frontend |
| Depends on | #24 (reverted) |
| Files | `src/components/cmd/CommandBarStream.tsx`, composition test |
| Surfaced from | 2026-04-23 trial: provider switch did not fire the context warning. |

### #118 — Render conversation history inside FloatingCommandBar

| Field | Value |
| --- | --- |
| Description | `ChatHistoryView` is only imported by classic `ChatPanel`. Quiet Composer's `FloatingCommandBar` has no history affordance — the clock icon in `CommandBarContext` was planned (#10, #27) but never wired. Fix: add a history-mode branch to `FloatingCommandBar` (or `CommandBarStream`) that renders `ChatHistoryView` when active; trigger from the context-row clock icon (and `⌘⇧H` via the bus). **Outcome-shaped acceptance**: click the clock icon → history list renders; click a past conversation → loads it into the stream; click the clock again (or Esc) → returns to current chat. **Composition test mandatory**: `<QuietLayout />` mounted with seeded past conversations, click the clock icon, assert history list renders with the expected conversations. |
| Complexity | M |
| Category | frontend |
| Depends on | #27 (reverted), #114 |
| Files | `src/components/cmd/FloatingCommandBar.tsx`, `src/components/cmd/CommandBarStream.tsx`, `src/components/cmd/CommandBarContext.tsx` (wire clock icon), composition test |
| Surfaced from | 2026-04-23 trial: history list was unreachable in Quiet Composer. |

### #119 — Fix AgentOrb pulse (CSS cascade conflict) ✅

| Field | Value |
| --- | --- |
| Description | The orb applies `orb-pulsing` while running tasks &gt; 0, but the pulse is not visible. Root cause visible from code review: (a) the button has `transition-transform duration-150 ease-in-out` on the same element as the `transform: scale(X)` keyframe, which interpolates each keyframe stop; (b) `hover:scale-105` engages Tailwind v4's composed transform chain (`transform: ... scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))`) which resolves to `scale(1)` when not hovered — overriding the keyframe's `scale(1.05)`. Fix: either (a) replace `hover:scale-105` with `hover:[transform:scale(1.05)]` to bypass the transform chain, (b) drop `transition-transform` and let the animation be the sole driver of transform, or (c) refactor to wrap the pulse in an inner span so hover polish and ambient pulse live on different elements (cleaner, preferred). Upgrade the existing unit test: instead of asserting `className.contains('orb-pulsing')`, assert `getComputedStyle(orb).animationName === 'orb-pulse'` — proves no cascade is wiping the animation. **Outcome-shaped acceptance**: with a running task, the orb visibly scales up and down on a 1.4 s cycle in the running app. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/components/activity/AgentOrb.tsx`, `src/components/activity/__tests__/AgentOrb.test.tsx` |
| Surfaced from | 2026-04-23 trial: orb did not pulse under activity. User directive: "you MUST be able to conclude from looking at the code." |

### #120 — Entering focus mode collapses the command bar ✅

| Field | Value |
| --- | --- |
| Description | Per `design-system.md`'s documented Esc fall-through chain, the expanded command bar should consume Esc before focus mode. Symmetric expectation: entering focus mode (⌘.) should collapse the bar — focus mode is distraction-free writing, and the composer is chrome. Fix: `useFocusMode`'s enter path emits a `dismiss` on the cmd-bar-events bus (or calls `collapse()` via a shared store). **Outcome-shaped acceptance**: expand the bar, press ⌘. → focus mode enters AND bar collapses. Exiting focus mode does NOT auto-re-expand the bar (collapsed is the safe default). **Composition test mandatory**: `<QuietLayout />` mounted, expand bar, dispatch `⌘.`, assert `focus-mode` class on layout root AND bar has `data-expanded="false"`. |
| Complexity | S |
| Category | frontend |
| Depends on | #114 |
| Files | `src/hooks/useFocusMode.ts`, composition test |
| Surfaced from | 2026-04-23 trial: user observed Esc only collapsed bar when focused in input; same class of bug — focus mode did not trigger collapse. |

---

### #121 — Restore semantics for ⌘⇧C / ⌘⇧A under Quiet Composer

| Field | Value |
| --- | --- |
| Description | ⌘⇧C (toggle chat panel) and ⌘⇧A (toggle agent panel) fire in Quiet Composer but both legacy panels are gone — `settings-store.chatPanelOpen` toggles a store value nothing observes, and the orb's popover state is local. Decide and wire the Quiet Composer semantics: ⌘⇧C summons or pins/unpins the floating command bar; ⌘⇧A opens/closes the AgentOrb popover. No `noop` callbacks left in `QuietLayout.tsx`. **Outcome-shaped acceptance**: press ⌘⇧C → command bar expands (or toggles pinned if already expanded); press ⌘⇧A → orb popover opens/closes. **Composition test mandatory**: dispatch both chords on a mounted `<QuietLayout />`, assert observable state. |
| Complexity | S |
| Category | frontend |
| Depends on | #114 (bus subscription prerequisite) |
| Files | `src/hooks/useKeyboardShortcuts.ts`, `src/components/QuietLayout.tsx`, `src/lib/cmd-bar-events.ts` (possibly a new event type), `src/components/activity/AgentOrb.tsx` (expose open-state via bus or ref) |
| Surfaced from | #113 audit — ⌘⇧C / ⌘⇧A had no Quiet Composer binding |

### #122 — DocHead parity: tab close affordance + tab strip decision

| Field | Value |
| --- | --- |
| Description | DocHead is a read-only breadcrumb; legacy users rely on middle-click-to-close, drag-to-reorder, per-tab dirty dots, and visual tab switching. ⌘W still closes the active tab via the editor-store action, but there is no equivalent of middle-click or drag. Decide: (a) add a compact `QuietTabStrip` component that renders a thin row of tabs above DocHead, or (b) declare `⌘W` + sidebar/TreeOverlay + `⌘⇧[` / `⌘⇧]` as the parity surface and document the decision in keyboard-shortcuts.md and design-system.md. **Outcome-shaped acceptance**: PRD decision committed; whichever path is chosen has parity with legacy close/reorder behavior. |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | PRD update in `docs/prds/2026-04-21-ui-refresh.md`; either a new `src/components/editor/QuietTabStrip.tsx` or a doc note; `docs/keyboard-shortcuts.md` + `docs/design-system.md` updated |
| Surfaced from | #113 audit — missing middle-click close / drag-reorder in Quiet Composer |

### #123 — ⌘⇧L toggles Quiet sidebar visibility

| Field | Value |
| --- | --- |
| Description | `⌘⇧L` flips `settings-store.sidebarPinned` (existing behavior) but `QuietSidebar` renders unconditionally and `QuietLayout`'s grid-template-columns is static — the setting isn't observed. Fix: `QuietLayout` reads the setting and either conditionally renders the sidebar OR uses a CSS variable to toggle the column width (prefer the latter for zero re-renders during drag). **Outcome-shaped acceptance**: press ⌘⇧L → sidebar column hides; press again → reappears. **Composition test mandatory**: dispatch the chord, assert the grid-template-columns (or a data attribute) flips. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/components/QuietLayout.tsx`, `src/components/sidebar/quiet/QuietSidebar.tsx` |
| Surfaced from | #113 audit — ⌘⇧L chord fires but no visible effect |

### #124 — TitleBar buttons in Quiet Composer

| Field | Value |
| --- | --- |
| Description | `QuietLayout.tsx` mounts `<TitleBar onToggleChat={noop} onToggleActivityStrip={noop} />`. The chat and activity-strip toggle buttons still render but do nothing. Options: (a) extend `TitleBar` with \`mode?: 'classic' |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/components/TitleBar.tsx`, `src/components/QuietLayout.tsx` |
| Surfaced from | #113 audit + project lead's 2026-04-23 trial. Note: this overlaps with the already-filed #103 — either fold #103 into this or keep #103 as the parent and close #124 as a duplicate. |

### #125 — CommandBarContext feature parity with ChatFooter ✅

| Field | Value |
| --- | --- |
| Description | `CommandBarContext.tsx` is missing three pieces of ChatFooter: the `AcpConfigOptionPicker` (thinking effort + model dropdowns), the "N goals" indicator pill, and the `showAgentModePicker` gate (legacy hides the mode picker unless the setting is on; Quiet Composer shows it unconditionally). Port each across from `src/components/chat/ChatFooter.tsx` and `src/components/chat/AcpSessionControls.tsx`. **Outcome-shaped acceptance**: thinking effort, model, goals, and agent-mode-picker settings behave identically in both footers. **Composition test mandatory**: render `<CommandBarContext />` with seeded ACP state + goals, assert each affordance is present and wired. |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `src/components/cmd/CommandBarContext.tsx`, minor refactor in `src/components/chat/AcpSessionControls.tsx` to expose sub-pickers |
| Surfaced from | #113 audit — three ChatFooter affordances missing from CommandBarContext |

### #126 — FloatingCommandBar ChatInput parity ✅

| Field | Value |
| --- | --- |
| Description | The floating bar uses a raw `<input type="text">`. Legacy `ChatInput` provides image paste / drag-drop / file-picker, attachment thumbnails, vision-capability gating, a Stop-generation button, `/skill-name` body expansion, `@agent-name` intercept, sandbox-scope computation for comment conversations, explicit-attach offer, and attached-files context chips. Fix: either (a) replace the raw input with `ChatInput` (may need minor generalization), or (b) port the missing features into `FloatingCommandBar`. Option (a) is preferred — one surface, one set of tests. **Outcome-shaped acceptance**: user can paste an image into the bar; drag a file in; press Stop during streaming; send `/skill-name task` with skill expansion; send `@agent-name message` with agent addressing; comment-delegated conversations receive the correct sandbox scope. **Composition test mandatory**: exercise paste, drop, Stop, `/skill` expansion, and `@agent` intercept via integration-level tests with `tauri-mock.ts`. |
| Complexity | L |
| Category | frontend |
| Depends on | #114 (bar opens), #116 (send flow investigated) |
| Files | `src/components/cmd/FloatingCommandBar.tsx`, possibly `src/components/chat/ChatInput.tsx` (minor generalization), `src/components/cmd/AttachmentChips.tsx` (unify image + reference chips) |
| Surfaced from | #113 audit — six ChatInput features absent from the floating bar |

### #127 — CommandBarStream per-message parity ✅

| Field | Value |
| --- | --- |
| Description | `CommandBarStream.tsx` does not pass `onEdit` / `onResend` / `onBranch` / `onRetry` / `branchCount` to `<ChatMessage>`, does not render `<QuickReplies>`, `<ContextDivider>`, the branch-point separator, the empty-state onboarding prompts + `<LocalAISetupCard>`, the edit-mode banner, or the `<ResendProviderDialog>` flow. Port the surrounding `ChatMessageList.tsx` glue — including the autoscroll ref, edit/resend/branch state, and the resend-dialog state machine. **Outcome-shaped acceptance**: every per-message control, divider, quick-reply, empty-state affordance, edit banner, and resend dialog works identically in both shells. **Composition test mandatory**: seed chat-store with messages spanning all segment types, exercise each per-message action, assert observable behavior matches the legacy equivalent. |
| Complexity | L |
| Category | frontend |
| Depends on | #117 (AgentSwitchCard scope includes ProjectSwitchCard — same root cause), #118 (history view) |
| Files | `src/components/cmd/CommandBarStream.tsx`, `src/components/cmd/FloatingCommandBar.tsx` (wire edit-context + resend-dialog state), possibly a new `src/components/cmd/CommandBarMessageActions.tsx` |
| Surfaced from | #113 audit — ten per-message affordances / stream features missing from CommandBarStream |

### #128 — SidebarContextMenu parity with FileTreeItem ✅

| Field | Value |
| --- | --- |
| Description | `SidebarContextMenu.tsx` is missing "New File", "New Folder", "Make / Open as Project", "Move to…" (currently hard-coded disabled with "Coming soon"), "Add to chat" (for image files), "Export as…" sub-menu, and "Commit…". Also missing: drag-to-chat for sidebar rows. Legacy `FileTreeItem.tsx` has all of these. Port the actions across and wire `src/components/sidebar/quiet/file-drag.ts` to the vision event bus for image drops to the chat. **Outcome-shaped acceptance**: right-click any sidebar row → every context menu item available in legacy FileTreeItem appears and works; drag an image file onto the command bar → attachment appears. **Composition test mandatory**: render `SidebarContextMenu`, assert each menu item is present and wired. |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `src/components/sidebar/quiet/SidebarContextMenu.tsx`, `src/components/sidebar/quiet/file-drag.ts`, new-folder dialog plumbing |
| Surfaced from | #113 audit — seven context-menu actions and drag-to-chat missing |

### #129 — Quiet sidebar visual state parity ✅

| Field | Value |
| --- | --- |
| Description | `FileTreeItem.tsx` surfaces git status indicators (modified / staged / untracked / deleted / renamed / conflicted), external-change indicators (pending diff dot), and AI-lock padlock overlays on project folders. `QuietSidebar`'s sections (`ProjectsSection`, `PinnedSection`, `RecentSection`, `FolderPeek`, `TreeOverlay`) render none of these. Extract the shared rendering logic from the existing `useFileTreeItemState` hook (or equivalent) and reuse it across each Quiet sidebar surface. **Outcome-shaped acceptance**: a file modified externally, dirty under git, or owned by an AI-locked project shows the same visual cues in Quiet sidebar surfaces as in the legacy FileTree. **Composition test mandatory**: seed the relevant stores, render each section, assert the indicators are present. |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `src/components/sidebar/quiet/ProjectsSection.tsx`, `PinnedSection.tsx`, `RecentSection.tsx`, `FolderPeek.tsx`, `TreeOverlay.tsx` (+ shared hook if one needs extracting) |
| Surfaced from | #113 audit — three classes of visual state missing across all Quiet sidebar surfaces |

### #130 — CommandBarStream chat-card + banner parity ✅

| Field | Value |
| --- | --- |
| Description | `CommandBarStream.tsx` does not render `PermissionCard`, `DomainApprovalCard` (plus the `network-domain-request` listener that currently lives inside `ChatMessageList`), `ToolCallPermissionCard`, `AgentStatusBanner`, or the "AI is thinking…" / `activeTool` loading indicators. Additionally, `AgentOrb`'s popover does not pass `onCancelTask` or `onClickTask` through to `AgentPanel` — tasks render but cannot be cancelled and do not navigate to their source. Port each card/banner render branch + the domain-request listener across; wire the orb popover callbacks. **Outcome-shaped acceptance**: a tool call that requires approval → `ToolCallPermissionCard` appears in the stream; a domain request → `DomainApprovalCard` appears with a 30s timeout; agent goes unresponsive → `AgentStatusBanner` appears; orb popover → clicking a task navigates, cancel button terminates. **Composition test mandatory**: seed each scenario via `tauri-mock.ts` events and assert the corresponding UI appears. |
| Complexity | M |
| Category | frontend |
| Depends on | #117 (the AgentSwitchCard render is the same slot) |
| Files | `src/components/cmd/CommandBarStream.tsx`, `src/components/activity/AgentOrb.tsx`, `src/components/activity/AgentPanel.tsx` |
| Surfaced from | #113 audit — seven permission/approval/banner types and orb panel wiring missing |

### #131 — Remove DocHead breadcrumb, fold dirty + saved-ago into TitleBar ✅

| Field | Value |
| --- | --- |
| Description | User-requested at 2026-04-24 (option c): drop the `DocHead` breadcrumb from QuietLayout entirely — the filename already appears in the macOS window title and the TitleBar, so the breadcrumb is redundant chrome. Fold the dirty dot + "saved Xs ago" indicator into the TitleBar (quiet mode only) so users still see both pieces of information. Delete `src/components/editor/DocHead.tsx` + its test. Strip `[data-doc-head]` CSS from globals.css and the reduced-motion-sweep expectation. Keep the `docHead` quiet-chrome preset target in quiet-chrome.ts / settings-store migrations so persisted user settings stay valid — the target simply has no element receiving the attribute now. **Outcome-shaped acceptance**: QuietLayout renders with no breadcrumb row between the TitleBar and the editor; the TitleBar shows a dirty dot + saved-ago label whenever a document is active; all DocHead unit tests are gone; no stale CSS / test references to `[data-doc-head]`. |
| Complexity | M |
| Category | frontend |
| Depends on | #48 (DocHead shipped), #103/#124 (TitleBar quiet mode) |
| Files | `src/components/QuietLayout.tsx`, `src/components/TitleBar.tsx`, `src/components/editor/DocHead.tsx` (delete), `src/components/editor/__tests__/DocHead.test.tsx` (delete), `src/styles/globals.css`, `src/styles/__tests__/reduced-motion-sweep.test.ts`, `src/lib/saved-ago.ts` (extract SavedLabel to shared module), `docs/features/editor.md`, `docs/design-system.md`, `docs/architecture.md` |
| Surfaced from | 2026-04-24 user live-test: breadcrumb felt redundant with the TitleBar + window title |

### #132 — Editor flows under translucent TitleBar + StatusBar (toggleable)

| Field | Value |
| --- | --- |
| Description | User-requested at 2026-04-24 as a follow-up to #131. Two related changes: (a) the editor document area spans the full layout height and scrolls **under** a sticky/absolute TitleBar + StatusBar instead of being pushed below them; (b) the TitleBar and StatusBar gain a semi-transparent bg + `backdrop-filter: blur` so the content behind reads as frosted glass, matching Bear/Craft chrome. Optional user preference: when enabled, the centre slice of the TitleBar (the area directly above the editor column) goes fully transparent — only the two edge zones keep the frosted bg — to give the writing surface a more airy feel. Persisted as `settings.quietChromeTransparent` (default off so existing users see no change). **Contrast audit required**: the dirty dot, accent moments, and saved-ago label must clear 3:1 against every realistic content bg (page white, dark mode, images, code blocks). **Outcome-shaped acceptance**: toggling the setting changes the effect live; scrolling an image / code block up to the top of the editor is visible as a subtle frosted layer behind the TitleBar; all a11y contrast checks still pass. |
| Complexity | M |
| Category | frontend |
| Depends on | #131 (TitleBar owns dirty + saved readouts), #103/#124 (TitleBar quiet mode) |
| Files | `src/components/QuietLayout.tsx` (layering), `src/components/TitleBar.tsx`, `src/components/editor/StatusBar.tsx`, `src/stores/settings-store.ts`, `src/components/settings/v2/AppearanceSettings.tsx`, `src/styles/globals.css` |
| Surfaced from | 2026-04-24 user live-test after #131 landed: "could we make both the title bar and the status bar somewhat transparent? the document editor flows behind the title bar, which would create a layer" |

### #133 — FloatingCommandBar dictation mic button

| Field | Value |
| --- | --- |
| Description | Follow-up from #126: the legacy `ChatInput` renders a Mic button wired to `useSpeechRecognition` (Whisper + browser SpeechRecognition). Port the button + dictation UI into the command bar input row so Quiet Composer users can dictate chat messages. Includes interim/final text replacement in the input + recording indicator. **Outcome-shaped acceptance**: clicking the mic starts dictation, final transcription lands as the input value, clicking again stops. |
| Complexity | S |
| Category | frontend |
| Depends on | #126 (the input row exists) |
| Files | `src/components/cmd/FloatingCommandBar.tsx`, optionally share a `useDictationControl` hook with ChatInput |
| Surfaced from | #126 scope cut — deferred to keep the main parity PR focused |

### #134 — FloatingCommandBar context chips + explicit-attach offer

| Field | Value |
| --- | --- |
| Description | Follow-up from #126: legacy `ChatInput` renders a `ContextPill` row for auto-attached files (active tab when in scope) + an "Add this file to chat" offer when the active tab sits outside the scoped projects. The command bar does not surface either today. Port both so sandbox-scope transparency is consistent across shells. **Outcome-shaped acceptance**: opening a tab outside the selected project shows the "Add to chat" offer above the command bar input; clicking it attaches; dismiss button removes context items. |
| Complexity | S |
| Category | frontend |
| Depends on | #126 |
| Files | `src/components/cmd/FloatingCommandBar.tsx`, reuse `ContextPill` + `useChatContext` |
| Surfaced from | #126 scope cut |

### #135 — SidebarContextMenu Move to… + drag-to-chat

| Field | Value |
| --- | --- |
| Description | Follow-up from #128: the legacy FileTreeItem's "Move to…" submenu discovers every workspace root + its subfolders, categorises them (Quick Notes / Projects / Folders), and dispatches a move via rename_path. Port the discovery + submenu render into `SidebarContextMenu`. Also wire `src/components/sidebar/quiet/file-drag.ts` to the vision event bus so image file drops onto the command bar inject attachments (paired with the `onDrop` handler added in #126). |
| Complexity | M |
| Category | frontend |
| Depends on | #126 (for the drag-to-chat half), #128 (for the menu half) |
| Files | `src/components/sidebar/quiet/SidebarContextMenu.tsx`, `src/components/sidebar/quiet/file-drag.ts` |
| Surfaced from | #128 scope cut |

### #136 — Quiet sidebar: project-row right-hand slot polish

| Field | Value |
| --- | --- |
| Description | Live-test feedback (2026-04-24) on the approved mockup-D sidebar: project rows currently render the file count + the new `SidebarRowIndicators` + the `+` button side-by-side, which pushes the count out of alignment on hover (the `+` button only appears on hover, so the row shifts visually between states). Mockup-D approved a design where the `+` button *covers* the file-count number on hover — a stable right-hand slot. Update the Projects row layout so file count + indicators occupy a fixed-width right zone; the `+` button absolutely positions over that zone on `group-hover`, swapping from count → plus without shifting sibling rows. Apply the same pattern to any other hover-swapped count/action pairs in the sidebar. **Outcome-shaped acceptance**: hovering a project row reveals the `+` in the exact screen position where the count was, with no perceptible layout shift; counts in adjacent rows stay pixel-aligned. |
| Complexity | S |
| Category | frontend |
| Depends on | #129 (the indicators compete for the same slot) |
| Files | `src/components/sidebar/quiet/ProjectsSection.tsx` (project row), possibly `PinnedSection.tsx` / `RecentSection.tsx` if they share the pattern |
| Surfaced from | 2026-04-24 user live-test — "the sidebar does not have the same design as the mockup-d which i approved… the + that appears on hovering projects could cover the numbers displayed" |

## M1.13 Manual QA — run the checklists (2 tasks)

### #108 — VoiceOver walkthrough — manual run

| Field | Value |
| --- | --- |
| Description | Manual VoiceOver run-through following the checklist drafted in #99 (`docs/tasks/qa/2026-04-21-voiceover-checklist.md`). Tester opens Notesage with VoiceOver enabled and walks every surface in the checklist. Findings logged in the file's "Findings log" table; P0/P1 items become bug tasks before Phase 1 ships. |
| Complexity | L |
| Category | qa |
| Depends on | #101 (editor mount — many checklist items need a real editor), #102 |
| Files | `docs/tasks/qa/2026-04-21-voiceover-checklist.md` (update inline) |

### #109 — Keyboard-only walkthrough — manual run

| Field | Value |
| --- | --- |
| Description | Manual keyboard-only run-through following the checklist drafted in #100 (`docs/tasks/qa/2026-04-21-keyboard-only.md`). Tester disconnects mouse and runs the 5 spec flows + the Phase-1-shell coverage section. Any mouse-required step in the 5 flows = P0 blocker. |
| Complexity | M |
| Category | qa |
| Depends on | #101, #102 |
| Files | `docs/tasks/qa/2026-04-21-keyboard-only.md` (update inline) |

---

## Ship gate — all of Phase 1

Before promoting "preview" to "ready for general availability" (which gates Phase 2):

- [ ] All 127 tasks completed (M1.1–M1.13)

- [ ] All new perf suites pass within budget at 1× multiplier

- [ ] No existing baseline regressed by &gt; 20%

- [ ] VoiceOver walk-through: 0 P0/P1 findings (#108)

- [ ] Keyboard-only walkthrough: all 5 flows pass (#109)

- [ ] Contrast audit: 0 AA failures

- [ ] Legacy UI verified still functional when flag is `legacy`

- [ ] CHANGELOG + release notes written

- [ ] Feature docs updated (editor, ai-workflows, workspace, keyboard-shortcuts, design-system)

- [ ] Preview invitation banner tested on fresh install

- [ ] Switch-back banner in QuietLayout tested (symmetric to preview invitation)

Phase 2 (default-on for new installs) and Phase 3 (legacy deletion) tracked separately in [ui-refresh-rollout-tasks](./2026-04-21-ui-refresh-rollout-tasks.md).