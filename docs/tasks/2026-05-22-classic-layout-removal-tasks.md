# Classic Layout Removal — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-05-22 |
| **Status** | All 13 tasks implemented on `feat/classic-layout-removal` (2026-05-23). Branch pending review + merge to main. |
| **PRD** | [classic-layout-removal](../prds/2026-05-22-classic-layout-removal.md) |
| **Total** | 13 tasks: 7S, 6M, 0L |
| **Suggested order** | Prep (#1–#2) → Remove references (#3–#7) → Delete files (#8–#10) → Cleanup (#11–#13) |

> **Key risk:** `src/components/chat/` contains components shared between Classic (`ChatPanel.tsx`) and Quiet Composer (`FloatingCommandBar` / `CommandBarStream`). Task #1 must complete before Task #9 — only delete files with zero non-ChatPanel consumers.
>
> **Strategy:** Remove all references first (tasks #3–#7), then delete the now-orphaned files (#8–#10). TypeScript will enforce completeness — if a deleted file still has importers, `pnpm typecheck` will fail.

---

### #1 — Audit chat/ subcomponent imports (human checkpoint) ✅ before #9

**Description:**
Grep every file under `src/components/chat/` and determine, for each component, whether it is imported only by `ChatPanel.tsx` (safe to delete) or also by Quiet Composer components (`FloatingCommandBar`, `CommandBarStream`, `ChatMessage`, etc.).

Produce a two-column list: `DELETE with ChatPanel` vs `KEEP`. Commit this list as a comment at the top of the Task #9 PR description.

Likely safe to delete: `ChatInput.tsx`, `BranchSwitcher.tsx` (verify).
Likely must keep: `ChatMessage.tsx`, `PermissionCard.tsx`, `DomainApprovalCard.tsx`, `AttachmentStrip.tsx`, `AgentSwitchCard.tsx`, all `segments/` components.

**Acceptance criteria:**
- Every file in `src/components/chat/` is classified as DELETE or KEEP.
- Classification verified by `grep -r "import.*from.*<filename>" src/` for each file.

**Complexity:** S
**Category:** frontend
**Dependencies:** none
**Files:** `src/components/chat/` (read-only audit)

---

### #2 — Harden settings-store: make Quiet Composer the persisted default ✅

**Description:**
- Change the `settings-store` initial state default for `uiPreview` from `"legacy"` to `"quiet-composer"`.
- Add a Zustand persist migration (bump the store version by 1) that upgrades any serialised `uiPreview: "legacy"` value to `"quiet-composer"` for existing users.
- The `uiPreview` field and type are NOT deleted yet — that happens in task #6. This task only changes the default and adds the migration, so users are forced onto Quiet Composer at next launch.

**Acceptance criteria:**
- `settings-store.ts` persist `version` is incremented by 1.
- The `migrate` function sets `state.uiPreview = "quiet-composer"` when the stored value is `"legacy"` or `undefined`.
- `pnpm test` passes — update the `uiPreview` default expectation in `settings-store.test.ts` from `"legacy"` to `"quiet-composer"`.

**Complexity:** S
**Category:** frontend
**Dependencies:** none
**Files:** `src/stores/settings-store.ts`, `src/stores/__tests__/settings-store.test.ts`

---

### #3 — Simplify App.tsx: remove all uiPreview branches ✅

**Description:**
Remove all Classic Layout gating in `App.tsx`. This is the largest single-file change in the project.

Specific removals:
- Delete `shouldRenderLegacyNewDialogs()` helper and its usages (lines ~76–77, ~242, ~511, ~523).
- Delete `shouldRenderLegacyChrome()` helper and its usages.
- Remove the `renderLegacyNewDialogs` derived flag.
- Remove the `SettingsDialog` (legacy) branch — always mount `SettingsDialogV2` (lines ~846).
- Remove the `CommandPalette` conditional mount entirely — stop importing and mounting it (line ~893).
- Remove the `KeyboardShortcutsDialog` (legacy) branch — always mount `KeyboardShortcutsDialogV2` (line ~955).
- In `handleNewNote()` (~line 511): remove the legacy dialog-open path; Quiet Composer path is now unconditional.
- In `handleNewProject()` (~line 523): same.
- In `action-open` handler (~line 774) and `action-click` handler (~line 808): remove Classic routing path.
- Remove imports of `SettingsDialog`, `CommandPalette`, `NewNoteDialog`, `NewProjectDialog`, `KeyboardShortcutsDialog`, `PreviewInvitation`, `RevertInvitation`, `Layout` (all now unused).
- Remove `uiPreview` read from settings-store (no longer read in App.tsx after this).

Do NOT delete the actual component files yet — that happens in tasks #8–#10.

**Acceptance criteria:**
- `pnpm typecheck` passes.
- `pnpm test` passes (App-level tests that referenced `uiPreview` branching are updated/deleted — see task #12).
- No import of `SettingsDialog`, `CommandPalette`, `NewNoteDialog`, `NewProjectDialog`, `KeyboardShortcutsDialog`, `PreviewInvitation`, `RevertInvitation`, or `Layout` remains in `App.tsx`.
- `grep "uiPreview" src/App.tsx` returns zero results.

**Complexity:** M
**Category:** frontend
**Dependencies:** #2 (migration must land first so users are already on quiet-composer when this fires)
**Files:** `src/App.tsx`

---

### #4 — Simplify Editor.tsx: remove isQuietVariant ternaries ✅

**Description:**
Remove the Classic-vs-Quiet branching in `Editor.tsx`:
- Delete `const isQuietVariant = uiPreview === "quiet-composer"` (~line 569) and `const isQuietComposer` (~line 625).
- Replace the toolbar variant ternary (~line 626) with the unconditional `"pill"` value.
- Replace the StatusBar variant ternary with the unconditional `"quiet"` value.
- Remove the `isLegacy` toolbar render path (~line 630) — only the Quiet Composer toolbar path remains.
- Remove the `uiPreview` read from settings-store in this component.

**Acceptance criteria:**
- `pnpm typecheck` passes.
- `grep "isQuietVariant\|isQuietComposer\|isLegacy\|uiPreview" src/components/editor/Editor.tsx` returns zero results.
- `pnpm test` passes.

**Complexity:** S
**Category:** frontend
**Dependencies:** #3
**Files:** `src/components/editor/Editor.tsx`

---

### #5 — Simplify hooks: remove Classic routing paths ✅

**Description:**
Remove `uiPreview` reads and Classic-path branches from five hooks:

1. **`useKeyboardShortcuts.ts`** (~lines 91–92, 104, 139–145):
   - Delete `const uiPreview` and `const isQuiet = uiPreview === "quiet-composer"`.
   - Remove the legacy `CommandPalette` dispatch path for ⌘K — always route to cmd-bar.
   - Remove the legacy Esc/focus-mode path (line ~104).

2. **`useCommandBarShortcuts.ts`** (~line 73):
   - Delete `if (uiPreview !== 'quiet-composer') return` early-return guard.
   - Delete the `uiPreview` read.

3. **`useDoubleTapCmd.ts`** (~line 55):
   - Delete `if (uiPreview !== 'quiet-composer') return` early-return guard.
   - Delete the `uiPreview` read.

4. **`useAppLifecycle.ts`** (~lines 52–53, 73–74):
   - Remove both `uiPreview === "quiet-composer"` checks.
   - Always emit cmd-bar events (Quiet Composer paths become unconditional).

5. **`useRecentDocumentCycle.ts`** (~line 50):
   - Remove the `uiPreview` check; always use the Quiet Composer cycling behaviour.

**Acceptance criteria:**
- `grep "uiPreview\|isQuiet\b" src/hooks/` returns zero results across all five files.
- `pnpm typecheck` and `pnpm test` pass.

**Complexity:** M
**Category:** frontend
**Dependencies:** #3
**Files:** `src/hooks/useKeyboardShortcuts.ts`, `src/hooks/useCommandBarShortcuts.ts`, `src/hooks/useDoubleTapCmd.ts`, `src/hooks/useAppLifecycle.ts`, `src/hooks/useRecentDocumentCycle.ts`

---

### #6 — Prune settings-store: remove uiPreview and Classic-only fields ✅

**Description:**
With no more code reading these fields, delete them from the store entirely.

Remove from `settings-store.ts`:
- `type UiPreview = "legacy" | "quiet-composer"` type alias.
- `uiPreview: UiPreview` field from `SettingsState`.
- `setUiPreview(preview: UiPreview): void` action.
- `previewInvitationShownAt: number | null` field.
- `previewInvitationDismissedAt: number | null` field.
- `chatPanelOpen: boolean` field (Classic chat sidebar open/close state).
- `shouldShowPreviewInvitation()` helper.
- `shouldShowRevertInvitation()` helper.
- All corresponding initial state values.

In `settings-store.test.ts`:
- Delete the `describe('uiPreview flag', ...)` suite and any tests referencing the deleted fields.

**Acceptance criteria:**
- `pnpm typecheck` passes (no "property does not exist" errors).
- `grep "uiPreview\|chatPanelOpen\|previewInvitationShownAt\|previewInvitationDismissedAt" src/stores/settings-store.ts` returns zero results.
- `pnpm test` passes with the pruned test suite.

**Complexity:** M
**Category:** frontend
**Dependencies:** #3, #4, #5 (all callers removed before field deletion)
**Files:** `src/stores/settings-store.ts`, `src/stores/__tests__/settings-store.test.ts`

---

### #7 — Prune editor-store: remove isQuietComposer helper ✅

**Description:**
Remove the `isQuietComposer()` helper from `editor-store.ts` and all its call sites.

- Delete `isQuietComposer()` function definition (~lines 16–18).
- Remove the Classic `closeTab` / panel-focus branches that were gated on its result (~lines 216, 332).
- Update `editor-store.test.ts` to remove any test that mocks `uiPreview` or tests the `isQuietComposer()` branching.

**Acceptance criteria:**
- `grep "isQuietComposer" src/` returns zero results.
- `pnpm typecheck` and `pnpm test` pass.

**Complexity:** S
**Category:** frontend
**Dependencies:** #6 (settings-store fields removed so the read in isQuietComposer() would already be dead)
**Files:** `src/stores/editor-store.ts`, `src/stores/__tests__/editor-store.test.ts`

---

### #8 — Delete Classic shell: Layout.tsx, TabBar.tsx, Tab.tsx ✅

**Description:**
After tasks #3–#7 have removed all references, delete the Classic shell files:

- `src/components/Layout.tsx` — delete entirely (LegacyLayout function + the `Layout` wrapper that dispatched between the two shells). `QuietLayout.tsx` is now the direct root layout mounted by `App.tsx`.
- `src/components/tabs/TabBar.tsx`
- `src/components/tabs/Tab.tsx`
- Delete the `src/components/tabs/` directory if empty after deletion.

Before deleting, confirm zero importers remain: `grep -r "from.*Layout\b\|from.*TabBar\|from.*['\"].*Tab['\"]" src/` should return no results pointing to these files.

Also delete any test files that exclusively test the deleted components:
- `src/components/__tests__/Layout.test.tsx` (if it exists — check)
- `src/components/tabs/__tests__/` (if it exists)

**Acceptance criteria:**
- Files are gone.
- `pnpm typecheck` passes (no missing module errors).
- `pnpm test` passes.

**Complexity:** M
**Category:** frontend
**Dependencies:** #3, #4, #5, #6, #7
**Files:** `src/components/Layout.tsx`, `src/components/tabs/TabBar.tsx`, `src/components/tabs/Tab.tsx`

---

### #9 — Delete Classic chat/activity: ChatPanel, ChatFooter, ActivityStrip ✅

**Description:**
Using the audit from task #1, delete Classic-only chat and activity components.

**Always delete:**
- `src/components/chat/ChatPanel.tsx`
- `src/components/chat/ChatFooter.tsx`
- `src/components/activity/ActivityStrip.tsx`

**Delete only if confirmed safe in #1 audit** (zero non-ChatPanel importers):
- `src/components/chat/ChatInput.tsx` (verify)
- `src/components/chat/BranchSwitcher.tsx` (verify)
- Any other chat/ files the audit marks as DELETE

**Do NOT delete** (confirmed shared with Quiet Composer):
- `src/components/chat/ChatMessage.tsx`
- `src/components/chat/PermissionCard.tsx`
- `src/components/chat/DomainApprovalCard.tsx`
- `src/components/chat/AttachmentStrip.tsx`
- `src/components/chat/AgentSwitchCard.tsx`
- `src/components/chat/segments/` (all)
- Any other file the audit marks as KEEP

Delete accompanying test files for deleted components (verify each exists first).

**Acceptance criteria:**
- All targeted files are deleted.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `grep -r "ChatPanel\|ActivityStrip\|ChatFooter" src/` returns zero results.

**Complexity:** M
**Category:** frontend
**Dependencies:** #1 (audit), #3, #5, #6, #7
**Files:** `src/components/chat/ChatPanel.tsx`, `src/components/chat/ChatFooter.tsx`, `src/components/activity/ActivityStrip.tsx`, + audit-confirmed chat/ files

---

### #10 — Delete Classic dialogs and palette ✅

**Description:**
Delete the remaining Classic-only standalone components:

- `src/components/CommandPalette.tsx`
- `src/components/NewNoteDialog.tsx`
- `src/components/NewProjectDialog.tsx`
- `src/components/KeyboardShortcutsDialog.tsx`
- `src/components/PreviewInvitation.tsx`
- `src/components/RevertInvitation.tsx`

Delete accompanying test files for each (check existence first):
- `src/components/__tests__/CommandPalette.test.tsx`
- `src/components/__tests__/NewNoteDialog.test.tsx`
- `src/components/__tests__/NewProjectDialog.test.tsx`
- `src/components/__tests__/PreviewInvitation.test.tsx`

**Acceptance criteria:**
- All files are deleted.
- `pnpm typecheck` passes.
- `pnpm test` passes.

**Complexity:** S
**Category:** frontend
**Dependencies:** #3 (all imports removed from App.tsx before deletion)
**Files:** As listed above.

---

### #11 — Clean up settings UI: remove uiPreview toggle ✅

**Description:**
`src/components/settings/v2/AppearanceSettings.tsx` has a "UI version" / "Quiet Composer" toggle section (~lines 192–221) that allowed users to switch between layouts. Remove it — there is no longer a choice.

- Delete the toggle rows from the Appearance section.
- Remove the `uiPreview` / `setUiPreview` reads from the component.
- If there is a "Layout" section heading with only this toggle under it, remove the section heading too.

Also verify `src/components/settings/SettingsDialog.tsx` has already been deleted in task #10 (it is listed as a Classic-only component). If for any reason it still exists, remove its `uiPreview` toggle (~line 1121).

**Acceptance criteria:**
- No "Quiet Composer toggle" or "UI version" row appears in `AppearanceSettings.tsx`.
- `grep "uiPreview\|setUiPreview" src/components/settings/` returns zero results.
- `pnpm typecheck` and `pnpm test` pass.

**Complexity:** S
**Category:** frontend
**Dependencies:** #6
**Files:** `src/components/settings/v2/AppearanceSettings.tsx`

---

### #12 — Delete dead test suites for Classic branching ✅

**Description:**
Remove test suites whose only purpose was verifying `uiPreview` branching that no longer exists.

Files/suites to delete or prune:

1. **`settings-store.test.ts`**: Delete `describe('uiPreview flag', ...)` suite (if not already done in task #6).
2. **`App-preview-gates.test.tsx`** (if it exists): Delete the file — it tests `shouldRenderLegacyNewDialogs()` which is now gone.
3. **`useCommandBarShortcuts.test.tsx`**: Remove the no-op guard test branch (`it('does nothing when uiPreview is legacy', ...)`).
4. **`useDoubleTapCmd.test.tsx`**: Remove the no-op guard test branch.
5. **`useAppLifecycle.test.ts`**: Remove the Classic palette-dispatch test cases; keep only cmd-bar dispatch tests.
6. **`useKeyboardShortcuts.test.tsx`**: Remove the `uiPreview: "legacy"` mock setup and any tests that assert Classic ⌘K palette path.
7. **`focus-mode-bar-collapse-composition.test.tsx`**: Remove the explicit `uiPreview: "quiet-composer"` state-setter (it should now be the default).

**Acceptance criteria:**
- `grep "uiPreview" src/**/*.test.*` returns zero results.
- `pnpm test` passes.
- No test imports a deleted component.

**Complexity:** S
**Category:** frontend
**Dependencies:** #6, #10
**Files:** Various test files listed above.

---

### #13 — CSS cleanup: remove stale Classic comments ✅

**Description:**
Remove stale comments referencing the Classic layout from CSS files:

- `src/styles/globals.css` ~line 811: Remove comment referencing "legacy pt-11 compensation".
- `src/styles/globals.css` ~line 944: Remove comment referencing "legacy chat panel".
- `src/styles/editor.css` ~line 14: Remove "legacy vars kept for backwards compat" comment (and verify the variables themselves are still used by Quiet Composer before deleting them).

Run `grep -i "classic\|legacy\|legalcy\|tab-bar" src/styles/` to find any additional stale references.

**Acceptance criteria:**
- `grep -i "legacy\|classic" src/styles/` returns zero results (or only legitimate content-word uses like "legacy format not supported" in the PPTX viewer message — leave those alone).
- `pnpm test` passes (CSS changes don't break snapshot tests if any exist).

**Complexity:** S
**Category:** frontend
**Dependencies:** none (can run in parallel with any task after #3)
**Files:** `src/styles/globals.css`, `src/styles/editor.css`

---

## Final verification checklist

After all tasks complete, run these grep checks to confirm clean removal:

```bash
# Should all return zero results
grep -r "uiPreview" src/
grep -r "isQuietComposer\|isLegacy\|quiet-composer" src/
grep -r "LegacyLayout\|ChatPanel\|ActivityStrip\|CommandPalette" src/
grep -r "TabBar\|NewNoteDialog\|NewProjectDialog\|PreviewInvitation" src/
grep -i "legacy" src/styles/

# Full suite must pass
pnpm typecheck
pnpm test
pnpm test:e2e
```
