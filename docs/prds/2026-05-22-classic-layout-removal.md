# PRD: Remove Classic Layout

|  |  |
| --- | --- |
| **Date** | 2026-05-22 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Eliminates ~193 dual-path references across 62+ files; Quiet Composer becomes the one canonical UI shell, reducing maintenance surface and enabling confident new-feature development |
| **Tasks** | [classic-layout-removal-tasks](../tasks/2026-05-22-classic-layout-removal-tasks.md) |

## Problem

Notesage ships two parallel UI shells — the original Classic Layout (`Layout.tsx`) and the Quiet Composer (`QuietLayout.tsx`). Every new feature must be implemented, tested, and maintained in both. The Quiet Composer has been live in opt-in preview since v0.39.0, has received no P0/P1 reports, and is now the clear direction for the product.

Keeping both shells alive has compounding costs:
- Every keyboard shortcut, chat feature, sidebar enhancement, and AI workflow has two code paths, meaning twice the test surface and twice the review burden.
- The `uiPreview` flag (`"legacy" | "quiet-composer"`) threads through 62+ files, making it easy to accidentally regress one shell while working on the other.
- New features (inline create, TreeOverlay, FolderPeek, AgentOrb, etc.) were designed only for Quiet Composer. Backporting them to Classic is wasted effort.
- Tab-bar-based document switching is architecturally at odds with the document-centric QuietSidebar model the product is moving toward.

The product description already names Phase 3 as the Classic deletion phase. This PRD formalises the scope, acceptance criteria, and approach.

## Goals / Non-Goals

**Goals:**
1. Delete all Classic-only components (Layout.tsx LegacyLayout, TabBar, Tab, ChatPanel, ChatFooter, ActivityStrip, CommandPalette, NewNoteDialog, NewProjectDialog, KeyboardShortcutsDialog, PreviewInvitation) without regressions in Quiet Composer.
2. Remove the `uiPreview` feature flag and all gating logic; Quiet Composer is always on.
3. Simplify shared components (Editor.tsx, useKeyboardShortcuts, App.tsx) by removing the Classic branch of every conditional.
4. Prune dead store fields (`uiPreview`, `chatPanelOpen`, invitation timestamps) and associated tests.
5. All existing Quiet Composer functionality continues to work correctly after removal.

**Non-Goals:**
- Changing any Quiet Composer feature behaviour (this is pure deletion, not redesign).
- Migrating existing chat/activity subcomponents shared between both shells — those stay unchanged.
- Implementing any new Quiet Composer features as part of this work.
- Windows/Linux layout work.

## User Stories

- As a developer, I want to add a feature once and have it work, so I don't need to implement it in two layouts.
- As a user on the Quiet Composer, I want the same keyboard shortcuts and AI workflows I've always had, so the removal is invisible to me.
- As a new user, I open Notesage and immediately get the polished Quiet Composer experience with no toggle or upgrade prompt.

## Technical Approach

### Deletion order (suggested)

Work in small, CI-green commits. Each step should leave the app in a runnable state.

**Step 1 — Harden the gate, confirm Quiet Composer is default**
- Change `settings-store` default for `uiPreview` from `"legacy"` to `"quiet-composer"`.
- Add a one-time migration that sets `uiPreview = "quiet-composer"` for any existing user who is still on `"legacy"`.
- Ship and verify: all existing users are now on Quiet Composer.

**Step 2 — Delete Classic-only component files**

Delete the following files (all imports and references removed in the same commit):

| File | Replacement |
| --- | --- |
| `src/components/Layout.tsx` (LegacyLayout fn + wrapper) | `QuietLayout.tsx` becomes the root layout; `App.tsx` mounts it directly |
| `src/components/tabs/TabBar.tsx` | Quiet Composer has no tab bar |
| `src/components/tabs/Tab.tsx` | — |
| `src/components/chat/ChatPanel.tsx` | `FloatingCommandBar.tsx` (already live) |
| `src/components/chat/ChatFooter.tsx` | `CommandBarContext.tsx` (already live) |
| `src/components/activity/ActivityStrip.tsx` | `AgentOrb.tsx` + `AgentPanel.tsx` (already live) |
| `src/components/CommandPalette.tsx` | `FloatingCommandBar.tsx` prefix modes (already live) |
| `src/components/NewNoteDialog.tsx` | `QuietSidebar` inline-create row (already live) |
| `src/components/NewProjectDialog.tsx` | `QuietSidebar` inline-create row (already live) |
| `src/components/KeyboardShortcutsDialog.tsx` | `KeyboardShortcutsDialogV2` (already live) |
| `src/components/PreviewInvitation.tsx` | No replacement — invitation is gone |
| `src/components/RevertInvitation.tsx` | No replacement — no longer meaningful post-removal |

**Step 3 — Simplify App.tsx**

Remove all branching on `uiPreview`:
- Remove `shouldRenderLegacyNewDialogs()` helper.
- Remove `shouldRenderLegacyChrome()` helper.
- Always mount `SettingsDialogV2`, `KeyboardShortcutsDialogV2`.
- Stop mounting `CommandPalette`.
- Remove New Note / New Project legacy dialog paths in `handleNewNote()` / `handleNewProject()`.
- Remove the `action-open` and `action-click` Classic routing paths.

**Step 4 — Simplify Editor.tsx**

Remove `isQuietVariant` / `isQuietComposer` locals:
- Always use `"pill"` toolbar variant.
- Always use `"quiet"` StatusBar variant.
- Remove the `isLegacy` toolbar render path.

**Step 5 — Simplify hooks**

| Hook | Change |
| --- | --- |
| `useKeyboardShortcuts.ts` | Remove `isQuiet` local; remove legacy `CommandPalette` dispatch path for ⌘K; remove legacy Esc/focus-mode path |
| `useCommandBarShortcuts.ts` | Remove `if (uiPreview !== 'quiet-composer') return` guard |
| `useDoubleTapCmd.ts` | Remove `if (uiPreview !== 'quiet-composer') return` guard |
| `useAppLifecycle.ts` | Remove legacy palette dispatch paths; always emit cmd-bar events |
| `useRecentDocumentCycle.ts` | Remove `uiPreview` check |

**Step 6 — Prune settings-store**

Remove fields:
- `uiPreview` (and `UiPreview` type)
- `setUiPreview` action
- `previewInvitationShownAt`, `previewInvitationDismissedAt`
- `chatPanelOpen` (Classic chat sidebar open/close state)
- `shouldShowPreviewInvitation()`, `shouldShowRevertInvitation()` helpers

Remove store tests for all deleted fields.

**Step 7 — Prune editor-store**

Remove `isQuietComposer()` helper function and all call sites.
Remove the Classic `closeTab` / panel-focus branches in tab management.

**Step 8 — Clean up settings UI**

- `AppearanceSettings.tsx` (v2): Remove the "UI version" / "Quiet Composer" toggle row — Quiet Composer is the only option.
- `SettingsDialog.tsx` (legacy): This file itself will be deleted in Step 2 (it is a Classic-only component); if any individual panels are shared, strip the `uiPreview` toggle from them.

**Step 9 — Delete dead tests**

Delete or simplify test suites whose sole purpose is verifying `uiPreview` branching:
- `describe('uiPreview flag', ...)` in `settings-store.test.ts`
- `describe('Layout uiPreview branching', ...)` in `Layout.test.tsx` (if it exists)
- `describe('shouldRenderLegacyNewDialogs', ...)` in `App-preview-gates.test.tsx`
- All `PreviewInvitation.test.tsx` tests
- The no-op guard tests in `useCommandBarShortcuts.test.tsx` and `useDoubleTapCmd.test.tsx`
- The legacy-palette-dispatch tests in `useAppLifecycle.test.ts`

In keyboard-shortcut tests, remove the `uiPreview: "legacy"` mock setup; always use default (quiet-composer).

**Step 10 — CSS cleanup**

Remove stale comments in:
- `globals.css` line ~811 ("legacy pt-11 compensation")
- `globals.css` line ~944 ("legacy chat panel")
- `editor.css` line ~14 ("legacy vars kept for backwards compat")

Verify no `.classic-*` or `.legacy-*` selectors remain.

### Migration for existing users

Users who had `uiPreview: "legacy"` in persisted localStorage will have their preference silently upgraded to `"quiet-composer"` by the one-time migration in Step 1. No user-visible prompt is needed — Quiet Composer has been the shipped default for new installs since v0.39.0.

### Risk: shared chat/ subcomponents

`src/components/chat/` contains components used by both `ChatPanel.tsx` (Classic) and `FloatingCommandBar.tsx` / `CommandBarStream.tsx` (Quiet Composer). Before deleting `ChatPanel.tsx`, audit every import of components in `src/components/chat/` to confirm which ones are exclusively consumed by the Classic panel. Only files with zero imports outside `ChatPanel.tsx` should be deleted with it. All others stay.

Likely safe to delete with ChatPanel: `ChatInput.tsx`, `BranchSwitcher.tsx` (if used only in the classic panel — verify). Likely must keep: `ChatMessage.tsx`, `PermissionCard.tsx`, `DomainApprovalCard.tsx`, `AttachmentStrip.tsx`, segment view components — these are all consumed by the Quiet Composer stream.

## UI/UX

The removal is invisible to end users on Quiet Composer. The only user-visible change:

- The "UI version" toggle in Settings > Appearance disappears — there is no longer a "Legacy" option.
- Users who had manually switched back to "Legacy" (a very small cohort, given the migration) will find themselves on Quiet Composer at next launch.

No new UI is introduced.

## Data Model

**Deleted from `settings-store`:**

```typescript
// REMOVE
type UiPreview = "legacy" | "quiet-composer";
uiPreview: UiPreview;
setUiPreview: (preview: UiPreview) => void;
chatPanelOpen: boolean;
previewInvitationShownAt: number | null;
previewInvitationDismissedAt: number | null;
shouldShowPreviewInvitation(): boolean;
shouldShowRevertInvitation(): boolean;
```

**One-time migration in `settings-store`:**

```typescript
// In the persist migration (version bump):
if (state.uiPreview === "legacy" || state.uiPreview === undefined) {
  state.uiPreview = "quiet-composer";
}
// Then delete the field from the type in the same PR.
```

The Zustand persist version should be bumped so existing serialised state is migrated cleanly.

## Dependencies

No new libraries required. This is a pure deletion / simplification.

## Quality Gates

### Functional
- [ ] App launches and renders the Quiet Composer layout with no console errors
- [ ] All Quiet Composer features work: FloatingCommandBar, QuietSidebar (Pinned/Projects/Recent/Tags/Mentions), AgentOrb, TreeOverlay, FolderPeek, FocusPill, StatusTray
- [ ] All keyboard shortcuts work in Quiet Composer (⌘K, ⌘⇧C, ⌘1–4, ⌘N, ⌘⇧N, ⌘., ⌘⇧E for export, ⌘⇧L, etc.)
- [ ] New note (⌘N) triggers inline create in QuietSidebar, not a dialog
- [ ] New project (⌘⇧N) triggers inline create in QuietSidebar, not a dialog
- [ ] Settings opens SettingsDialogV2 (no SettingsDialog legacy component mounted)
- [ ] Keyboard shortcuts dialog opens KeyboardShortcutsDialogV2
- [ ] Users previously on `uiPreview: "legacy"` are silently migrated to Quiet Composer at next launch
- [ ] No `CommandPalette` component is mounted anywhere

### Testing
- [ ] `pnpm test` passes with zero failures
- [ ] `pnpm typecheck` passes with zero errors
- [ ] `pnpm test:e2e` passes (Playwright specs not broken by deleted component imports)
- [ ] No test references deleted components (all dead test suites removed)

### Design
- [ ] `/review-ui` passes for Quiet Composer surfaces post-cleanup (no regressions in Editor, Sidebar, CommandBar, AgentOrb)

### Code hygiene
- [ ] `grep -r "uiPreview" src/` returns zero results
- [ ] `grep -r "isQuietComposer\|isQuiet\|quiet-composer\|uiPreview" src/` returns zero results
- [ ] `grep -r "LegacyLayout\|ChatPanel\|ActivityStrip\|CommandPalette\|TabBar\|NewNoteDialog\|NewProjectDialog" src/` returns zero results
- [ ] No imports of deleted files remain (TypeScript enforces this at typecheck)

## Out of Scope

- Any visual or behavioural changes to Quiet Composer features.
- Removing or migrating `chat/` subcomponents that are still used by FloatingCommandBar/CommandBarStream.
- Windows/Linux layout work.
- The `e2e-real/` WebDriverIO specs that test Classic tab behaviour — those are tracked separately in [project_quiet_composer_e2e_spec_family.md](../../../.claude/projects/-Users-peter-Development-note-sage/memory/project_quiet_composer_e2e_spec_family.md); replace the Classic-specific specs with Quiet Composer equivalents in a follow-up.
