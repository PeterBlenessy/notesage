# Release v0.17.5

**Date:** 2026-03-05
**Previous version:** 0.17.4

## Changes

### Features
- Comment delegation modes: Chat (inline popover stays open) and Delegate (background) with separate UX flows
- Per-reply activity logs: each agent reply persists its own activity log (tool calls, steps) instead of a single flat list per comment
- Move to Chat carries per-reply activities through to chat panel messages

### Fixes
- Fix activity spinners not stopping after task completion — added `completeAllActivities()` to all terminal paths in activity-store
- Sanitize stale `running` activities at render time in CommentPopover and ActivityTaskCard
- Fix stale Zustand state snapshot when snapshotting activities onto reply
- Fix code review issues in useCommentDelegation

### Improvements
- Polish CommentPopover: dropdown menu for edit/delete/resolve, tooltips on all action buttons, textarea for comment input, icon consistency (User vs BotMessageSquare)

## Files Changed
- 8 files changed across 5 commits
