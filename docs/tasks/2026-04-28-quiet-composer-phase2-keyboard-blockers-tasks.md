# Quiet Composer Phase 2 Keyboard-Only Blockers — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-28 |
| **Status** | Not started |
| **Source QA pass** | [keyboard-only walkthrough](./qa/2026-04-21-keyboard-only.md) |
| **Companion** | [voiceover-checklist](./qa/2026-04-21-voiceover-checklist.md) (clean pass — no actions needed) |
| **Phase 2 gate** | [ui-refresh-rollout-tasks](./2026-04-21-ui-refresh-rollout-tasks.md) — "no P0/P1 issue reports outstanding for >2 weeks" before flipping default-on |
| **Total** | 11 tasks: 8 S, 2 M, 1 L (L is investigate-then-fix) |
| **Suggested order** | Bundle A (#1, #2, #3 — punctuation chord layout sweep) → Bundle B (#4 — Folders tabIndex) → Bundle C (#5 — Settings nav focus) → Bundle D (#6 — new-note focus restoration) → Bundle E (#7, #8 — chat AgentSwitchCard autofocus + DOM-order verify) → Bundle F (#9 — Export Tab investigation, then #10 fix, then #11 re-run walkthrough). Bundles A–D ship cleanly first since they're trivial, low-risk, and unrelated to the chat/export findings. |

## Risks and open questions

- **Finding #4 (Export PDF Tab nav) root cause unknown.** Source-reading didn't surface a culprit — the dialog uses standard Radix/shadcn primitives that should all be Tab-reachable. Task #9 reproduces the bug live before scoping #10. If the repro shows the issue is environmental (e.g. only triggers when a specific format option is pre-selected), the fix scope might shift.
- **Bundle E (chat AgentSwitchCard).** Two-part fix: (a) autofocus the card's first button on mount; (b) verify Shift+Tab from textarea reaches `CommandBarContext`. Part (b) might be a no-op (works as-is); leave it as a verify-step in #8 rather than a fix-step.
- **Cross-keyboard punctuation sweep (#3) is partly proactive.** `⌘,` and `⌘.` work on Swedish keyboard today (no Shift, characters land on physical keys). Adding `event.code` fallbacks defends against future layouts, but the cost is touching working code. Locked-in: do the sweep but flag the proactive patches as low-risk additions, not bug fixes.
- **No PRD.** These are bug fixes traced to a QA pass. The "how" is locked in by the verification done before tasking. The risk register here covers what's unknown; the verified findings have explicit fix lines in their task descriptions.

---

## Bundle A — Cross-keyboard punctuation layout fix

Findings #6 and #7 share a root cause: chord checks use `event.key === "<punctuation>"`, which is layout-dependent. Swedish (and many European) keyboards produce different characters when Shift is held, OR require Option to type bracket characters at all. `event.code` reports the physical key position and is layout-independent.

### #1 — Fix `⌘⇧,` context-menu chord (Finding #6) ✅

| Field | Value |
| --- | --- |
| Description | In `src/components/sidebar/quiet/useSidebarItemShortcuts.ts:42-47`, extend `isContextMenuKey` to accept `event.code === "Comma"` alongside `event.key === ","`. Layout-independent fallback. Keep the `event.key` check for layouts where Shift+, does produce a literal comma (US, etc.) — the OR makes the helper layout-tolerant. Add a unit test in `src/components/sidebar/quiet/__tests__/useSidebarItemShortcuts.test.ts` (create if missing) covering: (a) US-style `event.key === ","` matches; (b) Swedish-style `event.key === ";"` + `event.code === "Comma"` matches; (c) other Shift-punctuation chords (e.g. `;` produced by a different physical key) do NOT match. |
| Complexity | S |
| Category | frontend |
| Depends on | — |
| Files | `src/components/sidebar/quiet/useSidebarItemShortcuts.ts`, `src/components/sidebar/quiet/__tests__/useSidebarItemShortcuts.test.ts` (or wherever the helper currently lives if a test file exists) |

### #2 — Fix `⌘⇧[` / `⌘⇧]` MRU cycle chord (Finding #7) ✅

| Field | Value |
| --- | --- |
| Description | In `src/hooks/useKeyboardShortcuts.ts:412-421`, extend the bracket-chord branch to accept `event.code === "BracketLeft"` and `event.code === "BracketRight"` alongside `event.key === "["` / `"]"`. Note the `direction` derivation at line 417 uses `key === "["` — switch to a derived `isLeft` that respects either signal: `const isLeft = key === "[" \|\| e.code === "BracketLeft";`. Update the corresponding test in `src/hooks/__tests__/useKeyboardShortcuts.test.tsx` to assert the chord fires on `event.code === "BracketLeft"` even when `event.key !== "["` (Swedish keyboard scenario). |
| Complexity | S |
| Category | frontend |
| Depends on | — |
| Files | `src/hooks/useKeyboardShortcuts.ts`, `src/hooks/__tests__/useKeyboardShortcuts.test.tsx` |

### #3 — Punctuation-chord audit sweep + project rule ✅

| Field | Value |
| --- | --- |
| Description | Inventory of remaining punctuation chord call sites that *could* break on non-US layouts (verified 2026-04-28): `useKeyboardShortcuts.ts:259` (`⌘.` focus mode classic), `useKeyboardShortcuts.ts:345` (`⌘,` Settings), `useFocusMode.ts:202` (`⌘.` focus mode Quiet). All three currently work on Swedish keyboard because `,` and `.` are on their own physical keys without Shift. Proactively add `event.code` fallbacks (`Comma`, `Period`) so future layouts (e.g. AZERTY where `.` is `Shift+;`) don't regress. **Reference pattern:** `src/hooks/useEditorKeyBindings.ts:82-94` already does this for `/` with a Nordic-specific `Shift+Digit7` fallback. **Project rule:** add a new section to `docs/keyboard-shortcuts.md` titled "Cross-keyboard layout safety" documenting the rule: any chord using punctuation must use `event.code` as the layout-independent signal, optionally OR'd with `event.key` for ergonomics. Cite the Nordic `/` pattern + `Comma`/`BracketLeft` fixes as references. |
| Complexity | S |
| Category | frontend + docs |
| Depends on | #1, #2 (mirror their fix pattern) |
| Files | `src/hooks/useKeyboardShortcuts.ts` (lines 259, 345), `src/hooks/useFocusMode.ts:202`, `docs/keyboard-shortcuts.md` (new section) |

---

## Bundle B — Sidebar Folders Tab-reachability

### #4 — Fix FoldersSection tabIndex roving pattern (Finding #5)

| Field | Value |
| --- | --- |
| Description | `src/components/sidebar/quiet/FoldersSection.tsx:495` and the matching `ChildRow` at line 545+ use `tabIndex={isFocused ? 0 : -1}`. When `focusedRowId === null` (initial state), every row has `tabIndex=-1` so the section is invisible to Tab. Mirror the working pattern from `ProjectsSection.tsx:1123`: `const tabIndex = isFocused \|\| !hasFocusWithin ? 0 : -1`. The first row becomes tabbable when no row is focused yet, which lets Tab from the previous section land on it; once focus enters the section, only the focused row stays at 0. Apply to BOTH `FolderRow` AND `ChildRow` (consistency — `ProjectsSection`'s ChildRow uses the same pattern at line 1310). Add `hasFocusWithin: boolean` to the row props if not already present. Add a regression test in `src/components/sidebar/quiet/__tests__/FoldersSection.test.tsx`: render with one folder and `focusedRowId === null`, assert at least one element with `tabIndex=0` is rendered. |
| Complexity | S |
| Category | frontend |
| Depends on | — |
| Files | `src/components/sidebar/quiet/FoldersSection.tsx`, `src/components/sidebar/quiet/__tests__/FoldersSection.test.tsx` |

---

## Bundle C — Settings v2 nav focus

### #5 — Fix Settings v2 ScrollArea Viewport Tab trap (Finding #1)

| Field | Value |
| --- | --- |
| Description | In `src/components/settings/v2/SettingsShell.tsx:165` and `:230`, the two `<ScrollArea>` instances wrap the nav column and content column respectively. Radix's `<ScrollAreaPrimitive.Viewport>` carries `tabIndex={0}` for keyboard scrolling — that's why Tab from the search input lands on the LEFT viewport (not the nav buttons inside) and ↑/↓ scrolls the panel instead of triggering `handleNavKeyDown` at lines 103-114. Two fix paths; prefer (a): (a) **patch the shadcn `ScrollArea` wrapper** at `src/components/ui/scroll-area.tsx:19-24` to forward a `tabIndex` prop down to `<ScrollAreaPrimitive.Viewport>` (default leave alone), then in SettingsShell pass `tabIndex={-1}` to both. This is the lowest-blast-radius change — every other ScrollArea call site keeps its current behaviour. (b) Hoist `onKeyDown={handleNavKeyDown}` from `<nav>` to a wrapper above the ScrollArea — heavier refactor, more side effects. Add a unit test in `src/components/settings/v2/__tests__/SettingsShell.test.tsx`: render the dialog, simulate Tab from the search input, assert the focused element's `data-nav-item-id` matches the active section's id (i.e. focus actually lands on a nav button). Then simulate ArrowDown and assert the active section advances. |
| Complexity | M |
| Category | frontend |
| Depends on | — |
| Files | `src/components/ui/scroll-area.tsx`, `src/components/settings/v2/SettingsShell.tsx`, `src/components/settings/v2/__tests__/SettingsShell.test.tsx` |

---

## Bundle D — New-note focus restoration

### #6 — Restore focus to editor after Quiet inline-create commit (Finding #3)

| Field | Value |
| --- | --- |
| Description | After a successful inline-create in QuietSidebar, the cursor falls to `document.body` because the inline-edit input unmounts and nothing claims focus. In `src/components/sidebar/quiet/ProjectsSection.tsx:357-376` `handleCreateCommit`, after `await openFile(filePath, fileName)` succeeds, dispatch a `notesage:focus-editor` `CustomEvent` on `window`. In `src/components/editor/Editor.tsx`, add a one-time listener (or extend an existing lifecycle hook in `useEditor`) that calls `editor.commands.focus()` when the event fires. Apply the same fix to `handleCreateProjectCommit` at line 408 if the new-project flow opens a README/scaffold — verify by reading the body. Sanity-check classic Layout: the legacy `NewNoteDialog` should be unaffected (it likely already restores focus via the dialog-close pattern); only the Quiet path needs the fix. Add a vitest case in `src/components/sidebar/quiet/__tests__/ProjectsSection.test.tsx`: mock `openFile` + the editor, simulate the inline-create commit, assert the `notesage:focus-editor` event fires after `openFile` resolves. |
| Complexity | S |
| Category | frontend |
| Depends on | — |
| Files | `src/components/sidebar/quiet/ProjectsSection.tsx`, `src/components/editor/Editor.tsx` (or `src/hooks/useEditor.ts`), `src/components/sidebar/quiet/__tests__/ProjectsSection.test.tsx` |

---

## Bundle E — Chat AgentSwitchCard autofocus + Tab order verification

### #7 — Auto-focus AgentSwitchCard's first button on mount (Finding #2 part a)

| Field | Value |
| --- | --- |
| Description | In `src/components/chat/AgentSwitchCard.tsx:28-62`, the card renders two shadcn `<Button>` components ("Include history" / "Start fresh") but doesn't claim focus when it appears. With the textarea `disabled={switchPending}` and the card upstream in the chat-stream DOM, Tab forward from the textarea bypasses it, leaving the user unable to leave the input. Mirror the existing `PermissionCard.tsx` pattern: add `role="alert"` + `aria-live="assertive"` to the outer `<div>` (line 29), wrap `<Button>` "Include history" in a `ref` (or use `useRef` + `autoFocus`), and `useEffect(() => firstButtonRef.current?.focus(), [])` on mount. The "Include history" button is the conservative default — preserves chat continuity unless the user explicitly chooses Start fresh. Add a vitest case asserting focus moves to the first button when the card mounts. |
| Complexity | S |
| Category | frontend |
| Depends on | — |
| Files | `src/components/chat/AgentSwitchCard.tsx`, `src/components/chat/__tests__/AgentSwitchCard.test.tsx` (create if missing) |

### #8 — Verify Shift+Tab from cmd-bar textarea reaches CommandBarContext (Finding #2 part b)

| Field | Value |
| --- | --- |
| Description | After #7 lands, the AgentSwitchCard claims focus on appearance. But the underlying DOM-order issue (`CommandBarContext` upstream of textarea, so Tab forward escapes the bar) might still trap users who want to switch provider WITHOUT triggering the card. Verification step: open the bar in Quiet Composer, focus the textarea, press Shift+Tab, confirm focus reaches the `CommandBarContext` provider/projects/mode pickers. If it does, no fix needed — document the keyboard contract in `docs/keyboard-shortcuts.md` ("Shift+Tab from the chat input cycles back to the context row"). If it doesn't, file a follow-up task; the fix is likely making `CommandBarContext` controls more discoverable (e.g. a focus-ring or label that mentions Shift+Tab from input). This is a verify-step, not a fix-step — the deliverable is either a doc update or a follow-up task description. |
| Complexity | S |
| Category | manual + docs |
| Depends on | #7 |
| Files | `docs/keyboard-shortcuts.md` (potentially), this task file (potentially with a follow-up task) |

---

## Bundle F — Export PDF Tab investigation

### #9 — Reproduce Finding #4 in the running app

| Field | Value |
| --- | --- |
| Description | Source-reading 2026-04-28 did NOT surface a root cause — the Export dialog (`src/components/ExportDialog.tsx`) uses standard Radix `<Dialog>`, `<Select>`, `<Checkbox>`, shadcn `<Button>` primitives that should be Tab-reachable by default. Open the running app in dev mode, trigger the dialog via ⌘⇧E (Quiet Composer) or ⌘⇧E (Classic) or right-click → Export as PDF on a `.md` file in the sidebar. Document precisely: (1) what control receives focus on dialog open; (2) what Tab does from there at each step; (3) which control (if any) traps Tab; (4) what the user means by "export not possible" — is the Export button reachable but disabled, or unreachable entirely. Capture in this task file as a comment block on #10. Don't make code changes during this task. |
| Complexity | M |
| Category | manual |
| Depends on | — |
| Files | This task file (add a "Repro notes for #10" subsection on completion) |

### #10 — Fix Export Tab nav blocker (Finding #4)

| Field | Value |
| --- | --- |
| Description | Scope locked when #9 completes. Likely candidates: (a) Radix `<Select>` autoFocus on dialog open eats Tab → set `defaultOpen={false}` explicitly or use an early-return `<DialogContent onOpenAutoFocus>` to direct initial focus elsewhere; (b) a `<Button>` or `<Checkbox>` has a stale `tabIndex={-1}` from copy-paste; (c) the format-conditional rendering (`format === "pdf"` etc.) hides the Export button when no format is selected and #9 reveals the user is hitting that state; (d) something else entirely. **Do not write the fix description until #9 lands.** Acceptance: Tab from dialog open reaches every control in the visible format's branch; Export button is reachable + activatable via Enter; Cancel is reachable + activatable via Esc OR Tab→Enter. |
| Complexity | M |
| Category | frontend |
| Depends on | #9 |
| Files | `src/components/ExportDialog.tsx`, possibly tests |

---

## Bundle G — Re-verify

### #11 — Re-run keyboard-only walkthrough end-to-end

| Field | Value |
| --- | --- |
| Description | After #1–#10 land, re-run the full `docs/tasks/qa/2026-04-21-keyboard-only.md` flows (5 spec flows + S1–S5 surface checks). Update each row's checkbox + remove "not working" comments where now resolved. Any NEW findings discovered during the re-run get filed as fresh tasks (not retro-fitted into this file). The walkthrough run also gates the Phase 2 default-flip — copy a brief summary into the rollout file's "Pre-Phase-2 verification" section once green. |
| Complexity | L |
| Category | manual |
| Depends on | #1, #2, #3, #4, #5, #6, #7, #8, #10 |
| Files | `docs/tasks/qa/2026-04-21-keyboard-only.md`, `docs/tasks/2026-04-21-ui-refresh-rollout-tasks.md` (note the green walkthrough as input to the Phase 2 gate) |

---

## Bundling guidance

Per Notesage convention, ship in self-contained commits. Each bundle below is one commit:

| Bundle | Tasks | Commit message shape |
| --- | --- | --- |
| A — Punctuation chord layout fix | #1, #2, #3 | `fix(shortcuts): Swedish/non-US keyboard layout safety for punctuation chords (⌘⇧, / ⌘⇧[ / ⌘⇧])` |
| B — Folders tab order | #4 | `fix(sidebar): Folders section first row tabbable when section is unfocused` |
| C — Settings v2 nav | #5 | `fix(settings): Tab from search reaches nav; ↑/↓ cycles items instead of scrolling pane` |
| D — New-note focus | #6 | `fix(quiet-sidebar): focus moves to editor after inline-create commit` |
| E — AgentSwitchCard autofocus | #7, #8 | `fix(chat): autofocus AgentSwitchCard buttons on appearance + verify cmd-bar Shift+Tab` |
| F — Export Tab | #9 + #10 | `fix(export): Tab navigation in Export dialog (root cause: TBD per #9 repro)` |
| G — Re-verify | #11 | `docs(qa): keyboard-only walkthrough green — Phase 2 gate input` |

Bundles A–D can ship in any order; they're independent and trivial. Bundle E ships after A–D so the chat fix lands on a clean keyboard-first foundation. Bundle F starts with investigation (#9) and is the only one with unknown scope — keep it parallel-safe. Bundle G is the final verification gate.

## Ship gate (this task file)

- [ ] All 11 tasks merged
- [ ] `pnpm test`, `pnpm typecheck` green
- [ ] Re-run of `docs/tasks/qa/2026-04-21-keyboard-only.md` is green for all 5 spec flows + S1–S5 surface checks
- [ ] Each finding row in the QA file's "Findings log" table is either ticked off or has a follow-up task linked in the "Filed as" column
- [ ] Phase 2 rollout file's gate criterion "no P0/P1 issue reports outstanding for >2 weeks" is unblocked by this work
