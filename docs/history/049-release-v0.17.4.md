# Release v0.17.4

**Date:** 2026-03-03
**Previous version:** 0.17.3

## Changes

### Improvements
- Replace cloud sync badge with RefreshCw (sync arrows) overlay icon — more recognizable at small sizes, consistent across folders, folder-open, and file icons
- Update check-for-updates button to always show download icon and "Check for Updates" label instead of misleading "You're up to date" on initial open

## Files Changed
- 2 files changed across 2 commits
- `src/components/sidebar/SyncedIcon.tsx` — Swap Cloud badge for RefreshCw overlay on all synced items
- `src/components/settings/SettingsDialog.tsx` — Download icon, simplified button states, remove unused Check import
