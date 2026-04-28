# Standalone Quiet Composer Bugs — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-27 |
| **Status** | Not started |
| **Source audit** | [2026-04-27-quiet-composer-migration](../audits/2026-04-27-quiet-composer-migration.md) |
| **Related PRD** | [ui-refresh](../prds/2026-04-21-ui-refresh.md) |
| **Companion task file** | [sidebar-simplification-tasks](./2026-04-27-sidebar-simplification-tasks.md) |
| **Total** | 14 tasks: 5 S, 7 M, 2 L |
| **Suggested order** | Independent — pick by priority. Recommended: #1 (project-lock tooltip — trivial polish, user-facing leak) → #2 (agent-orb toast — user-blocking) → #3-#5 (Actions group in StatusTray) → #6-#7 (TaskMode grouping) → #8-#11 (macOS unfocused window) → #12 (KbdDialog post-sidebar verification) → #13-#14 (regression tests + contrast audit) |

## Scope

Six standalone bugs / improvements from the 2026-04-27 audit that have clear scope and locked-in decisions. These are independent of the [sidebar simplification program](./2026-04-27-sidebar-simplification-tasks.md) — they share no code paths and can ship in any order. Three audit findings (#2 Quick Capture, #3 file-search mode, #8/10 Document Outline re-skin) are deferred pending product decisions; see "Deferred items" at the bottom.

## Verified file references

Spot-checked during planning, 2026-04-27:

- **Agent-completion toast:** `src/hooks/useAgentTaskOperations.ts:425` calls `notify('agent_completion', ...)` in `src/lib/notifications.ts`. The Sonner Toaster is positioned `bottom-right` in `src/App.tsx:1019` — same corner as `AgentOrb` (`fixed bottom-6 right-6`). Overlap confirmed.
- **`describeLockTarget`:** already exported from `src/lib/ai/project-lock.ts` (used by legacy `ProjectItem.tsx:8`). Reusable as-is.
- **`useActionStore.getOpenCount()`:** exists at `src/stores/action-store.ts:408`. Reusable as-is.
- **StatusTray groups:** four exist today — `CompletionsGroup` (line 212), `CommentsGroup` (318), `SessionGroup` (465), `HelpGroup` (581) — composed in the popover at lines 730-746. The new Actions group fits this pattern exactly.

## Risks and open questions

- **Toast vs orb collision** (#2): repositioning the toast (e.g. `bottom-right` → `top-right`) affects ALL toasts in the app, not just agent completions. Adding a `?dismiss` button is per-call; safer for one bug fix. Lean toward dismiss-first; defer the global reposition unless multiple toasts collide.
- **Actions group click target** (#3-#5): the legacy `ActionsIndicator` opens the Actions dialog. The Quiet Composer alternative could be (a) open the same dialog, or (b) focus the cmd bar in `!` mode. Tasking proceeds with (a) for parity; raising as an in-task design check.
- **macOS unfocused color contrast** (#8): the desaturated accent `oklch(70% 0 0)` must still pass WCAG AA against the background. Add a contrast-audit test (#14) to enforce.
- **Tauri window focus events vs WebKit `blur`/`focus`**: both should fire when the window loses key status, but Tauri offers richer events (`tauri://focus`, `tauri://blur`). #8 implementation will use the simpler `window` events first; switch to Tauri events only if reliability issues surface.

---

## #1 — Fix project-lock tooltip showing raw connection ID ✅

| Field | Value |
| --- | --- |
| Title | SidebarRowIndicators: render connection label, not connection ID |
| Description | `src/components/sidebar/quiet/SidebarRowIndicators.tsx:136` renders `aiLock.connectionId` directly (e.g. `Locked to conn-1774086797085-ak920t`). Replace with the connection's user-set `label` field. Read `connections` from `useConnectionsStore`, look up by `id`, render via the existing `describeLockTarget(connectionId, label)` helper from `src/lib/ai/project-lock.ts` (already imported in legacy `ProjectItem.tsx:8`). Handle "connection deleted but lock persists" gracefully — `describeLockTarget` already returns the ID with an "(unavailable)" suffix when label is undefined; verify and reuse. Acceptance: tooltip on a locked project shows `Locked to <label>` (e.g. `Locked to Claude — Personal`) when the connection exists; `Locked to <connectionId> (unavailable)` otherwise. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/components/sidebar/quiet/SidebarRowIndicators.tsx`, `src/lib/ai/project-lock.ts` (verify `describeLockTarget` is exported), tests |

## #2 — Make agent-completion toast dismissable ✅

| Field | Value |
| --- | --- |
| Title | notifications: agent_completion toast carries an X dismiss button |
| Description | `notify('agent_completion', ...)` in `src/lib/notifications.ts` currently fires a Sonner toast that auto-dismisses after the default duration AND covers the AgentOrb (`bottom-right` corner, same as orb's `fixed bottom-6 right-6`). The "open the result" action is unreachable until the toast clears. Add an explicit dismiss affordance: pass `dismissible: true` (Sonner default) AND ensure a visible `×` close button is rendered. If Sonner's default dismiss UI isn't prominent enough, render a custom toast with an explicit `<button onClick={() => toast.dismiss(id)}>×</button>`. Don't change toast position globally — keep the rest of the app's toast UX unchanged. Acceptance: when a delegated comment completes, the toast appears with a visible X; clicking X dismisses it instantly; the orb is then clickable. |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `src/lib/notifications.ts`, possibly `src/components/ui/sonner.tsx` if Sonner Toaster config needs tweaking |

## #3 — Add `ActionsGroup` to StatusTray popover

| Field | Value |
| --- | --- |
| Title | StatusTray: new Actions group with open-count + click to open dashboard |
| Description | New `ActionsGroup` component inside `src/components/editor/StatusTray.tsx`, mounted in the popover composition (line ~745) between `CommentsGroup` and `SessionGroup` (or wherever feels right — propose Comments → Actions → Session order, since both are "things to act on"). Reads `openCount` from `useActionStore.getOpenCount()` (exists at `src/stores/action-store.ts:408`). Renders a single row: `<icon> {openCount} actions` with a chevron. Click → `onOpenActions()` callback that opens the `ActionsDialog` (the same handler the legacy `ActionsIndicator` uses; thread it through props from `Editor.tsx` → `StatusBar.tsx` → `StatusTray.tsx`). When `openCount === 0`, render the row with a muted "No open actions" state — don't hide it (consistency with other groups). |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `src/components/editor/StatusTray.tsx` (new component + composition), `src/components/editor/StatusBar.tsx` (prop threading), `src/components/editor/Editor.tsx` (callback wiring) |

## #4 — Wire `onOpenActions` callback into Editor → QuietStatusBar → StatusTray

| Field | Value |
| --- | --- |
| Title | Plumb the open-actions callback to the new ActionsGroup |
| Description | The legacy full-variant StatusBar receives `onOpenActions` as a prop and passes it to `<ActionsIndicator>`. The QuietStatusBar variant currently doesn't receive it. Thread the callback: `Editor.tsx` already has `onOpenActions` (verify); pass it to `<StatusBar variant="quiet" onOpenActions={onOpenActions} />`; `QuietStatusBar` passes it to `<StatusTray onOpenActions={...} />`; StatusTray exposes it to the new `ActionsGroup` (#3). Should be a mechanical prop chain. Acceptance: clicking the new Actions row in the StatusTray popover opens the same `ActionsDialog` the legacy `ActionsIndicator` opens. |
| Complexity | S |
| Category | frontend |
| Depends on | #3 |
| Files | `src/components/editor/Editor.tsx`, `src/components/editor/StatusBar.tsx` (QuietStatusBar function), `src/components/editor/StatusTray.tsx` |

## #5 — Tests for ActionsGroup

| Field | Value |
| --- | --- |
| Description | Cover: ActionsGroup renders the open-count from the store; renders "No open actions" muted when count is 0; click fires `onOpenActions`; group sits in the documented order inside the popover composition. Use the existing StatusTray test patterns. |
| Complexity | S |
| Category | frontend |
| Depends on | #4 |
| Files | `src/components/editor/__tests__/StatusTray.test.tsx` (extend) |

## #6 — TaskMode: group results by project (mirror legacy ActionsDashboard) ✅

| Field | Value |
| --- | --- |
| Title | TaskMode picker groups items by project_root |
| Description | `src/components/cmd/modes/TaskMode.tsx` currently renders `rows = filtered.slice(0, MAX_RESULTS)` as a flat list. Mirror the grouping logic from `src/components/actions/ActionsDashboard.tsx:60-70`: build a `Map<project_root, ActionItem[]>` keyed by `item.project_root ?? 'ungrouped'`. Render each group with a small uppercase header (`text-xs font-medium uppercase tracking-wider`) showing the project name + open count, e.g. `REVISOR OCH SKATTEEXPERT (3 open)`. The `ungrouped` bucket renders last as `Quick Notes`. Existing Type / Status / Project filters stay; grouping applies to whatever is filtered. |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `src/components/cmd/modes/TaskMode.tsx` |

## #7 — Tests for TaskMode grouping ✅

| Field | Value |
| --- | --- |
| Description | Cover: items group by `project_root`; project name + open count render in the header; ungrouped items appear under "Quick Notes" at the bottom; grouping respects active Type/Status/Project filters; empty groups don't render. |
| Complexity | S |
| Category | frontend |
| Depends on | #6 |
| Files | `src/components/cmd/modes/__tests__/TaskMode.test.tsx` |

## #8 — Add `--color-accent-primary-inactive` token + macOS unfocused CSS rules ✅

| Field | Value |
| --- | --- |
| Title | globals.css: inactive-window accent token + selector-driven swap |
| Description | In `src/styles/globals.css`, add a new token `--color-accent-primary-inactive: oklch(70% 0 0)` (neutral grey, zero chroma) for both light and dark themes (tweak per-theme if needed for AA). Add the CSS rules: `[data-window-inactive='true']` (or wherever the QuietLayout root attribute lands per #9) re-points `--color-accent-primary` to the inactive variant via CSS custom property override. Also add a subtle opacity dimming on `[data-window-inactive='true'] [data-quiet-chrome-toolbar]`, `[data-quiet-chrome-status]`, `[data-quiet-chrome-orb]` (the same elements `useQuietChrome` already manages for fade-on-type) — e.g. `opacity: 0.85`. 200ms ease-in-out transition; honour `prefers-reduced-motion: reduce` (zero transition, instant swap). Body text, borders, backgrounds, syntax highlighting, diff colors, destructive (red) all stay unchanged. |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `src/styles/globals.css` |

## #9 — `useWindowFocus()` hook + QuietLayout root attribute ✅

| Field | Value |
| --- | --- |
| Title | Hook listens to window blur/focus, writes data-window-inactive on QuietLayout root |
| Description | New `src/hooks/useWindowFocus.ts` hook: subscribes to `window.addEventListener('blur', ...)` and `'focus'` events (the standard browser events fire reliably in Tauri WebViews). On blur, write `data-window-inactive="true"` onto the QuietLayout root (`document.querySelector('[data-quiet-layout-root]')` — the attribute exists per `QuietLayout.tsx:328`). On focus, remove the attribute. Initial state: read `document.hasFocus()`. Mount the hook from `QuietLayout.tsx` so it only runs while the Quiet shell is active (matches the "Quiet Composer only" decision). Cleanup on unmount. Acceptance: switching to another macOS app sets the attribute within one frame; switching back removes it. |
| Complexity | M |
| Category | frontend |
| Depends on | #8 |
| Files | `src/hooks/useWindowFocus.ts` (new), `src/components/QuietLayout.tsx` |

## #10 — Verify `--color-accent-primary` consumers swap correctly ✅

| Field | Value |
| --- | --- |
| Title | Audit accent consumers: primary buttons, switch ON, focus rings, link, dirty dot, orb pulse |
| Description | Per the design-system doc, `--color-accent-primary` is consumed by: primary button background+hover+focus, link button text, switch ON state, editor link colour, tab dirty dot, focus rings on chromatic affordances. Walk each consumer and verify it correctly inherits the inactive grey when `data-window-inactive="true"` is set on the root. The CSS swap from #8 should propagate via cascade — but some consumers spell `var(--color-accent-primary)` inline while others use a Tailwind arbitrary value `bg-[var(--color-accent-primary)]`. Both should work; this task is a verification + screenshot pass, not new CSS. Document any consumer that doesn't swap (likely a bug to fix). |
| Complexity | M |
| Category | frontend |
| Depends on | #9 |
| Files | (verification — no file changes unless drift found) |

## #11 — Tests for useWindowFocus + macOS unfocused behavior ✅

| Field | Value |
| --- | --- |
| Description | Unit tests for `useWindowFocus`: hook writes attribute on blur, removes on focus, cleans up on unmount, reads initial state from `document.hasFocus`. Component test (jsdom): `<QuietLayout>` mounts hook; firing a `blur` event on `window` adds `data-window-inactive` to the root; firing `focus` removes it. Use `fireEvent` from `@testing-library/react`. |
| Complexity | S |
| Category | frontend |
| Depends on | #9 |
| Files | `src/hooks/__tests__/useWindowFocus.test.ts` (new) |

## #12 — KeyboardShortcutsDialogV2: post-sidebar-simplification verification ✅

| Field | Value |
| --- | --- |
| Title | Live-test KbdDialog after TreeOverlay deletion ships; revert ⌘⇧E row to "Export" |
| Description | The audit-pass already rewrote `src/components/KeyboardShortcutsDialogV2.tsx` (correct glyph forms, removed Quick Capture, "Close active document", added missing chords). One row currently reads `Export (PDF / DOCX / PPTX / HTML) — via > palette` because while TreeOverlay owns `⌘⇧E`, Export must be reached via the `>` palette. Once the sidebar simplification's task `#22` (rebind `⌘⇧E` to Export) ships, revert this row to a simple `⌘⇧E Export` entry. Live-test the dialog rendering against the actual chord behavior at that point — no other drift expected. |
| Complexity | S |
| Category | frontend |
| Depends on | sidebar-simplification `#22` |
| Files | `src/components/KeyboardShortcutsDialogV2.tsx` |

## #13 — Regression test: project-lock tooltip shows label, not ID ✅

| Field | Value |
| --- | --- |
| Description | Regression-lock test for #1: render `<SidebarRowIndicators>` with a project that has `aiLock.connectionId = 'conn-test-1'` AND a connections-store containing `{ id: 'conn-test-1', label: 'Claude Test' }`. Assert the tooltip text contains "Claude Test" and does NOT contain "conn-test-1". Second case: lock points to a non-existent connectionId; assert the fallback shows the ID with "(unavailable)". This catches future regressions where someone refactors away the lookup. |
| Complexity | S |
| Category | frontend |
| Depends on | #1 |
| Files | `src/components/sidebar/quiet/__tests__/SidebarRowIndicators.test.tsx` (new or extend) |

## #14 — WCAG AA contrast audit for the inactive accent token ✅

| Field | Value |
| --- | --- |
| Description | Run `pnpm audit:contrast` (or extend `scripts/contrast-audit.ts`) to verify `--color-accent-primary-inactive` (oklch(70% 0 0)) clears 3:1 against `--color-background` in BOTH light and dark themes. The desaturated accent applies to UI affordances (buttons, switches, focus rings) — must hit the WCAG UI threshold. If 70% lightness fails in either theme, tweak the token to a value that passes. Add the inactive accent to the contrast audit's pair list as a regression lock. |
| Complexity | S |
| Category | test |
| Depends on | #8 |
| Files | `scripts/contrast-audit.ts`, possibly `src/styles/globals.css` (token tweak if needed) |

---

## Documentation updates (bundle into landing PRs)

These aren't standalone tasks — fold each doc update into the PR for the corresponding code change.

| Doc | Update | Bundles with |
| --- | --- | --- |
| `docs/design-system.md` | Document the macOS unfocused-window pattern under "Component Patterns" or a new "Window State" section. Note the `--color-accent-primary-inactive` token, the `[data-window-inactive='true']` selector convention, and the WCAG contrast guarantee | #8, #9 |
| `docs/architecture.md` | Add `useWindowFocus.ts` to the hooks inventory (around line 128) | #9 |
| `docs/features/ai-workflows.md` | Note that delegated-comment completion toasts are dismissable; clarify the orb is the canonical surface for re-opening the result | #2 |
| `docs/keyboard-shortcuts.md` | No changes required from this chunk (the `⌘⇧E` rebinding doc lives with the sidebar-simplification PR) | — |

---

## Deferred items (need user decisions before tasking)

The audit (`docs/audits/2026-04-27-quiet-composer-migration.md`) lists three findings that aren't actionable until product decisions land. They are intentionally NOT in this task file:

| Finding | Decision needed | Likely scope when decided |
| --- | --- | --- |
| **#2 Quick Capture (`⌘⇧Space`)** | Ship for real OR permanently remove the false promise? | (Ship) PRD-sized — global-shortcut plugin + floating 480x320 window + destination picker. (Remove) ~1-hour cleanup commit removing palette entry, tray menu hint, doc claim. |
| **#3 File-search mode in cmd bar** | Should the no-prefix default surface file results alongside chat suggestions, or should there be a dedicated `:file` (or other) prefix? | M-sized once shape is decided. Affects `FloatingCommandBar`'s default-mode rendering OR adds a new prefix mode entry to `prefix-modes.ts`. |
| **#8/10 Document Outline re-skin** | What should the new popover look like? Anchored where (StatusTray entry? Editor toolbar pill? Inline overlay?) | M-sized once shape is decided. Re-skin `src/components/DocumentOutline.tsx` from a shadcn `Dialog` to whatever popover/overlay form is chosen. |

When decisions land, spawn `/plan-tasks` to add these as a third chunk — don't retro-fit them into this file.

---

## Ship gate

Each task in this file ships independently — no global ship gate. After the chunk is fully merged:

- [ ] Audit findings #4, #5, #6, #16, #17, #18 marked resolved in the audit file
- [ ] Sidebar simplification task #22 has shipped before #12 runs (its only cross-dependency)
- [ ] `pnpm audit:contrast` passes for the inactive accent token (#14)
- [ ] Manual smoke: switch to another app → Quiet Composer chrome desaturates; switch back → restored. Click a `#tag` in the document → cmd bar opens at occurrences (sidebar-simplification #17, not this chunk). Lock a project to a connection → tooltip shows the connection label. Delegate a comment, wait for completion → toast has a visible X to dismiss; orb is clickable while the toast is up. Open the cmd bar with `!` → results group by project. StatusTray popover shows an Actions row with the open count.
