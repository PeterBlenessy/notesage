# UI Refresh Phase 2 — Task Breakdown

Phase 2 of the UI refresh PRD (`docs/prds/2026-04-21-ui-refresh.md`). Picks up where Phase 1 left off — Phase 1 built the new shell (sidebar, command bar, orb, doc-head, status tray, settings, focus mode), Phase 2 wires the actual editor and chat into the shell so it becomes a usable surface, then completes the QA validation that was queued in M1.10.

## Task numbering

Phase 2 starts at #1 (independent of Phase 1's 1–100 range). When tasks are picked up, mark `🚧` on launch, `✅` on merge — both via `git apply --cached` per the markdown-formatter workaround (see Phase 1 batch plan).

---

## Foundation (mount the missing surfaces)

### #1 — Mount the editor inside QuietLayout center column

| Field | Value |
| --- | --- |
| Description | Replace the `<div data-doc-area-placeholder>Document area (placeholder)</div>` in `QuietLayout.tsx` (line 264) with the real `<Editor />` mount from `Layout.tsx`. Verify `editor-store` integration: clicking a file in QuietSidebar opens it in the editor; tab switching works; per-tab undo/redo cache survives. May need to also mount `<FindBar />`, the floating `<Toolbar />`, and any editor-area chrome that lives alongside. |
| Complexity | L |
| Category | frontend |
| Depends on | Phase 1 #30, #48 (already done) |
| Files | `src/components/QuietLayout.tsx`, possibly `src/components/editor/Editor.tsx` (if integration changes are needed) |
| Surfaced as | Phase 1 follow-up F7 |

### #2 — Decide and mount the chat in QuietLayout right column

| Field | Value |
| --- | --- |
| Description | When the FloatingCommandBar is NOT pinned, the right column is `<ZonePlaceholder label="Reserved (placeholder)" />`. The intent: the FloatingCommandBar IS the chat in Quiet Composer mode. Replace the placeholder with either (a) an empty div (if the column is purely for layout balance — likely correct), or (b) a compact "Recent threads" rail. Don't re-mount the full classic `<ChatPanel />` — that defeats the purpose of the FloatingCommandBar. |
| Complexity | S–M |
| Category | frontend |
| Depends on | #1 |
| Files | `src/components/QuietLayout.tsx` |
| Surfaced as | Phase 1 follow-up F8 |

---

## Polish (Phase 1 trial findings)

### #3 — TitleBar in QuietLayout: hide legacy chat / agent toggle buttons

| Field | Value |
| --- | --- |
| Description | `<TitleBar onToggleChat={noop} onToggleActivityStrip={noop} />` in `QuietLayout.tsx` line 251 mounts the same TitleBar as classic, including chat-toggle and agent-strip-toggle buttons that do nothing in Quiet Composer (props are stubs). Visual clutter that contradicts the "calmer UI" promise. Add `mode?: 'classic' | 'quiet'` to TitleBar to suppress those buttons in quiet mode. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/components/TitleBar.tsx`, `src/components/QuietLayout.tsx` |
| Surfaced as | Phase 1 follow-up F9 |

### #4 — TreeOverlay UX bugs: ⌘⇧E toggle, Esc dismiss, traffic-light overlap

| Field | Value |
| --- | --- |
| Description | Three bugs in the existing TreeOverlay: (a) `⌘⇧E` is open-only — re-pressing while open is a no-op visually; should toggle close. (b) Esc doesn't dismiss reliably — investigate whether focus is escaping the overlay or being swallowed elsewhere. (c) The overlay's `top: 0` covers macOS traffic-light buttons (red/yellow/green); add `padding-top: var(--titlebar-inset, 28px)` so it sits below them. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/components/QuietLayout.tsx` (toggle logic), `src/components/sidebar/quiet/TreeOverlay.tsx` (positioning + Esc investigation) |
| Surfaced as | Phase 1 follow-up F10 |

### #5 — Set window title from active document

| Field | Value |
| --- | --- |
| Description | The macOS window title (very top, OS-rendered) currently stays as "Notesage" regardless of which file is open. Set `document.title` from `editor-store` active tab so users can find the right window via ⌘` (window switcher) and dock previews. Format: `${activeFileName} — Notesage` when a doc is open; `Notesage` when no tab. Applies to both classic + Quiet Composer. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/App.tsx` or `src/hooks/useAppLifecycle.ts` (one effect on active tab change) |
| Surfaced as | Phase 1 follow-up F11 |

### #6 — AgentOrb hover state polish

| Field | Value |
| --- | --- |
| Description | The orb uses `hover:scale-105` which is too subtle. Add either (a) a Radix Tooltip showing the same aria-label text on hover, (b) a soft `hover:shadow-lg` glow, or (c) both. Keep ambient — the orb shouldn't grab attention. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/components/activity/AgentOrb.tsx` |
| Surfaced as | Phase 1 follow-up F12 |

---

## QA validation (Phase 1 M1.10 finishers)

### #7 — VoiceOver walkthrough — manual run

| Field | Value |
| --- | --- |
| Description | Manual VoiceOver run-through following the checklist drafted in Phase 1 #99 (`docs/tasks/qa/2026-04-21-voiceover-checklist.md`). Tester opens Notesage with VoiceOver enabled and walks every surface in the checklist. Findings logged in the file's "Findings log" table; P0/P1 items become Phase 2 bug tasks. |
| Complexity | L |
| Category | qa |
| Depends on | #1 (editor mount — many checklist items need a real editor) |
| Files | `docs/tasks/qa/2026-04-21-voiceover-checklist.md` (update inline) |

### #8 — Keyboard-only walkthrough — manual run

| Field | Value |
| --- | --- |
| Description | Manual keyboard-only run-through following the checklist drafted in Phase 1 #100 (`docs/tasks/qa/2026-04-21-keyboard-only.md`). Tester disconnects mouse and runs the 5 spec flows + the Phase-1-shell coverage section. Any mouse-required step in the 5 flows = P0 blocker. |
| Complexity | M |
| Category | qa |
| Depends on | #1, #2 (most flows need editor + chat mounted) |
| Files | `docs/tasks/qa/2026-04-21-keyboard-only.md` (update inline) |

---

## Ship gate — Phase 2

Before promoting Quiet Composer from "preview" to "default":

- [ ] All Phase 2 tasks above completed
- [ ] All Phase 1 follow-ups (F1–F12) addressed or explicitly out-of-scope
- [ ] All perf suites pass within budget at 1× multiplier (no jsdom budget inflation outside follow-up F6 work)
- [ ] No existing baseline regressed by > 20%
- [ ] VoiceOver walkthrough: 0 P0/P1 findings
- [ ] Keyboard-only walkthrough: all 5 flows pass
- [ ] Contrast audit: 0 AA failures
- [ ] User trial confirms parity with the mockups (the Phase 1 trial flagged "design in several aspects different from mockups" — Phase 2 closes that gap)

---

## How this file relates to others

- **PRD**: `docs/prds/2026-04-21-ui-refresh.md` — overall product spec, both phases
- **Phase 1 tasks**: `docs/tasks/2026-04-21-ui-refresh-phase1-tasks.md` — the 100-task breakdown that landed in 2026-04-21 → 2026-04-23
- **Phase 1 follow-ups**: `docs/tasks/2026-04-21-ui-refresh-phase1-followups.md` — small Fnn entries that surfaced during Phase 1 work
- **Phase 1 batch plan**: `docs/tasks/2026-04-21-ui-refresh-phase1-batches.md` — execution / dispatch notes
- **QA artifacts**: `docs/tasks/qa/2026-04-21-{voiceover-checklist,keyboard-only}.md` — drafted in Phase 1 M1.10; consumed by Phase 2 #7 and #8
