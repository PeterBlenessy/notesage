# Release v0.11.1

**Date:** 2026-02-20
**Previous version:** 0.11.0

## Changes

### Fixes
- Fix filesystem watcher for explorer folders — create, modify, and delete events now all work
- Fix macOS FSEvents reporting file deletions as modify events (reclassify when path no longer exists)
- Filter `.git/` and `.DS_Store` paths from watcher to eliminate event flood from iCloud-synced repos
- Increase self-write TTL from 2s to 5s to cover macOS FSEvents re-reporting delay
- Fix self-write regression where editing in Notesage triggered false external change notifications
- Fix editor not updating on external file changes (push content to Tiptap, not just Zustand store)
- Fix stale sidebar entries when deleting already-deleted files via context menu
- Add debounced git status refresh on external file changes
- Normalize paths for tab lookup (macOS `/private/` prefix handling)
- Fix `package.json` invalid JSON escape (`\~` to `~`)

### Improvements
- Show "File updated from disk" toast when editor auto-reloads external changes
- Prevent duplicate toasts for the same file update (stable toast ID + pending change dedup)

## Files Changed
- 5 files changed across 2 commits
