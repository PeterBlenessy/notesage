# Release v0.12.0

**Date:** 2026-02-20
**Previous version:** 0.11.1

## Changes

### Features

- **External Change Review** — inline diff decorations for externally modified files with per-hunk accept/reject controls
  - Word-level diffing via `diff-match-patch` with semantic cleanup, mapped to ProseMirror positions
  - Toast notification ("File changed externally") with Accept button, close X, 8s auto-dismiss
  - Inline diff decorations: red strikethrough for deletions, green highlights for insertions
  - Per-hunk accept/reject via inline click controls and keyboard shortcuts (`Cmd+Enter` / `Cmd+Backspace`)
  - Status bar change tracker (`RefreshCw` icon + count) with `ChangeListPopover`
  - Cross-file popover showing all pending changes: `[filename] : [change preview]  [✓] [✗]`
  - Per-hunk accept/reject from popover for the focused file; click-to-navigate for other files
  - Accept All / Reject All bulk actions in popover header
  - New `external-change-store` (Zustand, non-persisted) for tracking pending changes per file
  - New `external-diff.ts` utility with `computeExternalDiff()` and `mapExternalChangeToPM()`

### Fixes

- **Tab-switch race condition** — pending-change effect now uses `requestAnimationFrame` to ensure editor content is loaded before computing diffs (previously could diff wrong tab's content)
- **Self-write false suppression** — removed redundant frontend self-write guard; backend `markSelfWrite` is the single source of truth (frontend guard caused third+ changes to be silently dropped)
- **Sync effect double-save** — accept/reject handlers now nullify tracking ref and resolve store before dispatching ProseMirror transactions (prevents sync effect from racing)

### Improvements

- Sonner toast close button restyled: top-right, flat borderless window-style X
- Removed `ExternalReviewBanner` (caused confusing dual toast + banner UI)
- `ChangeListPopover` wider (384px) with filename, change preview, and per-hunk controls
- Popover stays open while browsing changes (no auto-close on click)

### Docs

- PRD updated to "Implemented" status with implementation decisions documented
- Task breakdown updated to "Complete" with all tasks marked
- Product description updated with full external change review feature description
- Architecture section updated with new stores and plugin details

## Files Changed

- 19 files changed across 5+ commits (including uncommitted work)
- New files: `external-diff.ts`, `external-change-store.ts`, `ChangeListPopover.tsx`, `ExternalReviewBanner.tsx` (dead code), `self-write-guard.ts` (dead code), `external-diff.test.ts`, PRD + task docs
- Modified: `Editor.tsx`, `StatusBar.tsx`, `inline-diff.ts`, `useFileWatcher.ts`, `globals.css`, `editor.css`, `product-description.md`
