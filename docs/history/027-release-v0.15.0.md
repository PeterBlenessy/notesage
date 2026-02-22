# Release v0.15.0

**Date:** 2026-02-22
**Previous version:** 0.14.1

## Changes

### Features

- **Agent comment delegation (Part 1):** Delegate inline comments to AI agents — agents reply within the comment thread with full activity log
  - Delegate from comment create mode ("Delegate" button), view mode (bot icon), or comment list popover
  - "Delegate all" bulk action in comment list popover header
  - Comment lifecycle states: open → delegated (spinner + activity log) → done (reply received) → resolved (highlight removed)
  - Per-comment activity log showing agent tool calls, permissions, auto-approvals, errors
  - Cancel active delegation with stop button (reverts to open)
  - Resolve completed comments (hides highlight and removes from list)
  - Agent replies persisted as `CommentReply` in sidecar JSON (survives restart)
  - Uses existing `useAgentTaskOperations` infrastructure via `agent_tasks` routing slot
- **External change detection setting:** Configurable toggle between auto-accept (default) and inline diff review (beta) in Settings > Editor Options
- **Chat provider indicator & picker:** Interactive connection picker in chat footer, per-message provider badges, shared ProviderLogo component
- **Tiered permission approval UI:** PermissionCard with split Allow button (once/session/always), context-aware chat footer (Search for direct API, Tools popover for ACP agents)
- **Agent install & auth guidance:** Step-by-step install guides with copyable commands and URLs for all agent providers
- **Orphaned agent process cleanup:** `kill_on_drop(true)` on ACP child processes, `RunEvent::Exit` hook, frontend `beforeunload` cleanup
- **MIT license** added to repository
- **CI build checks** via GitHub Actions release workflow

### Fixes

- Removed all `any` types in comment-mark.ts and useCommentOperations.ts (proper ProseMirror/Tiptap types)
- Added typed ACP invoke wrappers to tauri.ts (7 methods), refactored useAgentTaskOperations to use them
- Fixed accessibility: replaced span-as-button with proper `<button>` elements in CommentListPopover
- Fixed deprecated `navigator.platform` usage (replaced with `navigator.userAgent`)
- Fixed React key warning: index-as-key replaced with timestamp-based keys
- Added toast error notification for saveComments failures (was silent)

### Improvements

- Icon strokeWidth consistency (2 → 1.5) across comment UI icons
- Switch component alignment fixed (origin-right → origin-center)
- Added `active:opacity-75` states to all raw interactive buttons
- Added `.thin-scrollbar` CSS class for compact scroll areas (comment popover, activity log)
- Replaced arbitrary spacing with Tailwind scale values (max-h-[320px] → max-h-80, pt-[100px] → pt-24)
- Added focus-visible ring states to settings navigation buttons
- Copilot LSP workspace handling and configuration improvements
- Copilot status dot uses neutral `bg-foreground/70` instead of chromatic `bg-green-500`

## Files Changed

- 44 files changed across 11 commits
- 2,910 insertions, 461 deletions

## New Files

| File | Purpose |
|------|---------|
| `src/hooks/useCommentDelegation.ts` | Comment → agent delegation flow hook |
| `src/components/chat/PermissionCard.tsx` | ACP tool call approval UI (tiered) |
| `src/components/ProviderLogo.tsx` | Shared provider logo component |
| `docs/prds/2026-02-22-agent-comments.md` | Agent comment delegation PRD |
| `docs/prds/2026-02-22-chat-provider-indicator.md` | Chat provider indicator PRD |
| `docs/prds/2026-02-22-permission-approval-ui.md` | Permission approval UI PRD |
| `docs/prds/2026-02-22-agent-install-guidance.md` | Agent install guidance PRD |
| `docs/prds/2026-02-22-orphaned-agent-cleanup.md` | Orphaned agent cleanup PRD |
| `public/logos/copilot.svg` | Official GitHub Copilot Octicons logo |
| `LICENSE` | MIT license |
| `.github/workflows/release.yml` | CI release workflow (updated) |
