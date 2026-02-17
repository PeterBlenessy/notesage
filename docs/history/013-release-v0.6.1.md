# Release v0.6.1

**Date:** 2026-02-17
**Previous version:** 0.6.0

## Changes

### Fixes
- Fix scroll position lost when resizing window across the 1200px wide/narrow layout breakpoint
- Fix scroll position lost on window resize (fullscreen toggle, split-screen, etc.)
- Eliminate flicker when restoring scroll position on tab switch and layout remount

### Improvements
- Persist per-document scroll positions across app restarts (stored as ratios in localStorage)
- Scroll positions keyed by file path so they survive tab close/reopen cycles
- Suppress scroll position saves during resize to prevent overwriting with incorrect values
- Double-RAF scroll restore ensures correct positioning after ProseMirror DOM updates

## Files Changed
- 3 files changed across 1 commit
