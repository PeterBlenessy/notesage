# Release v0.16.6

**Date:** 2026-02-26
**Previous version:** 0.16.5

## Changes

### Features
- Project rename confirmation UX: inline check/cancel icons, Enter/Escape keyboard support, loading spinner
- External folder rename detection: renamed project folders automatically re-map in the sidebar
- Auto-scroll tab bar to keep active tab visible when many files are open

### Fixes
- Fix sidebar delete: use AlertDialog instead of window.confirm to prevent premature deletion
- Fix project metadata not persisting to disk on rename (async reload overwrote in-memory state)
- Fix ghost folder recreation when project directory was externally renamed or deleted
- Fix flickering update download progress bar (monotonic progress, reduced re-renders)
- Fix Copilot LSP sign-in: handle server-to-client signIn request for device code flow

### Improvements
- Deleted files show strikethrough in open tabs
- Bump rollup dependency for security

## Files Changed
- 12 files changed across 6 commits
