# UI Refresh — Phase 1 (Preview) Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-22 |
| **Status** | Not started |
| **PRD** | [ui-refresh](../prds/2026-04-21-ui-refresh.md) |
| **Phase** | 1 of 3 — ship the preview behind a flag; legacy stays working |
| **Rollout tasks** | [ui-refresh-rollout-tasks](./2026-04-21-ui-refresh-rollout-tasks.md) (Phase 2 + 3) |
| **Total** | 100 tasks across 10 milestones |
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
| Description | Add `uiPreview: "legacy" | "quiet-composer"` to `settings-store` with persist. Default `"legacy"` on upgrade. Include a Zustand persist migration (bump store version). Expose a Settings &gt; Advanced toggle "Try the new UI" wired to this value. Acceptance: toggling the flag in Settings persists across reload; new field surfaces in DevTools. |
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

### #20 — Command-bar keyboard shortcuts ✅

| Field | Value |
| --- | --- |
| Description | Implement: ⌘K → focus bar; ⌘1/⌘⇧1 → focus + prefill `!`; ⌘2/⌘⇧2 → `@`; ⌘3/⌘⇧3 → `#`; ⌘4/⌘⇧4 → `?`; ⌘⇧P → `>`; Esc → collapse bar (with fall-through: closes suggest dropdown first, then collapses). Both unshifted and shifted variants bound to same handlers. |
| Complexity | M |
| Category | frontend |
| Depends on | #9, #13 |
| Files | `src/hooks/useCommandBarShortcuts.ts` |

### #21 — Double-tap ⌘ detection (alternate bar focus) ✅

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
| Description | Extend skill-detection to match `(?:^|\s)/[a-z0-9-]+` tokens anywhere in user message, not just first character. Applies to direct-API path. For ACP pass-through, preserve verbatim forwarding (no re-parsing). Add unit tests covering URL false positives, numeric edge cases, and multi-skill messages. |
| Complexity | M |
| Category | backend |
| Depends on | none |
| Files | `src-tauri/src/commands/skills_tool_parser.rs`, `src/stores/skill-store.ts` (frontend helper), tests |

### #23 — Wire composer send → chat-store ✅

| Field | Value |
| --- | --- |
| Description | Enter in input sends the message via existing `chat-store` APIs (new or append). Attachment chips sent along as context. On send: clear chips from input, display thumbnails in the resulting user message (like today's image-attach pattern). |
| Complexity | M |
| Category | frontend |
| Depends on | #9, #11, #12 |
| Files | `src/components/cmd/FloatingCommandBar.tsx`, `src/stores/chat-store.ts` wiring |

### #24 — Provider pill — wire to connections-store ✅

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

### #27 — History view inside stream ✅

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

### #93 — Update `docs/design-system.md` 🚧

| Field | Value |
| --- | --- |
| Description | Add Quiet Composer layout section. Codify fade-on-type, orb pattern, peek/tree-overlay. Accent token guardrails. |
| Complexity | M |
| Category | doc |
| Depends on | most UI tasks |
| Files | `docs/design-system.md` |

### #94 — Update `docs/features/editor.md` + `ai-workflows.md` + `workspace.md` 🚧

| Field | Value |
| --- | --- |
| Description | Tabs removed; doc-head breadcrumb. Chat panel → floating composer; activity strip → orb. Sidebar flat + tree overlay. **Workspace.md line 108 banner cleanup required.** |
| Complexity | M |
| Category | doc |
| Depends on | most UI tasks |
| Files | three files |

### #95 — Update `docs/keyboard-shortcuts.md` 🚧

| Field | Value |
| --- | --- |
| Description | Add ⌘⇧E, ⌘⇧H, ⌘⌥C, ⌘⌥R, ⌘⇧K. Note ⌘1–4 / ⌘⇧1–4 both bindings. Add double-tap ⌘. Remove ⌘⇧P (Preview HTML). Show glyph notation. |
| Complexity | S |
| Category | doc |
| Depends on | #76 |
| Files | `docs/keyboard-shortcuts.md` |

### #96 — Update `docs/architecture.md` 🚧

| Field | Value |
| --- | --- |
| Description | Component tree updated per PRD's Component Inventory. New stores/hooks noted. |
| Complexity | S |
| Category | doc |
| Depends on | most tasks |
| Files | `docs/architecture.md` |

### #97 — Preview invitation banner 🚧

| Field | Value |
| --- | --- |
| Description | One-time dismissible banner shown on first launch after the Phase 1 release installs. "Try the new UI — a calmer, more focused Notesage \[Try it\]". Repeats once after 30 days if dismissed. Stored via settings-store flag. |
| Complexity | M |
| Category | frontend |
| Depends on | #1 |
| Files | `src/components/PreviewInvitation.tsx`, settings-store |

### #98 — Changelog entry for Phase 1 🚧

| Field | Value |
| --- | --- |
| Description | Write release notes for the Phase 1 release. Call out: Preview UI, how to try it, what's in it, what's removed (Preview HTML, DiffReviewBanner), known limitations. |
| Complexity | S |
| Category | doc |
| Depends on | all |
| Files | `CHANGELOG.md` |

---

## M1.10 Pre-ship validation (2 tasks)

### #99 — VoiceOver walk-through

| Field | Value |
| --- | --- |
| Description | Manual test per main surface (Mockups D, E, F, I). VoiceOver enabled; navigate every user story. Findings logged as blocker tasks if P0/P1, deferred to Phase 2 list if lower. |
| Complexity | L |
| Category | qa |
| Depends on | all a11y tasks |
| Files | `docs/tasks/qa/2026-04-21-voiceover-checklist.md` (artifact) |

### #100 — Keyboard-only walkthrough

| Field | Value |
| --- | --- |
| Description | Disconnect mouse. Complete 5 flows end-to-end: create new note, delegate a comment, export PDF, switch provider mid-chat, enter + exit focus mode. Any mouse-required step = blocker. |
| Complexity | M |
| Category | qa |
| Depends on | all a11y tasks |
| Files | `docs/tasks/qa/2026-04-21-keyboard-only.md` (artifact) |

---

## Ship gate — all of Phase 1

Before promoting "preview" to "ready for general availability" (which gates Phase 2):

- [ ] All 100 tasks completed

- [ ] All new perf suites pass within budget at 1× multiplier

- [ ] No existing baseline regressed by &gt; 20%

- [ ] VoiceOver walk-through: 0 P0/P1 findings

- [ ] Keyboard-only walkthrough: all 5 flows pass

- [ ] Contrast audit: 0 AA failures

- [ ] Legacy UI verified still functional when flag is `legacy`

- [ ] CHANGELOG + release notes written

- [ ] Feature docs updated (editor, ai-workflows, workspace, keyboard-shortcuts, design-system)

- [ ] Preview invitation banner tested on fresh install

Phase 2 (default-on for new installs) and Phase 3 (legacy deletion) tracked separately in [ui-refresh-rollout-tasks](./2026-04-21-ui-refresh-rollout-tasks.md).