# Release v0.15.4

**Date:** 2026-02-24
**Previous version:** 0.15.3

## Changes

### Fixes
- "Later" no longer permanently dismisses update — keeps it available for install at any time
- Settings and StatusBar show update indicator whenever an update is known, not just immediately after check
- Fix dialog footer button spacing in UpdateDialog

### Improvements
- Remove redundant "Check for Updates" label in Settings > About
- CI generates real release notes from git commit history instead of placeholder link
- Add `createUpdaterArtifacts` to bundle config for signed updater artifacts
- Fix updater signing secret names in release workflow

## Files Changed
- 5 files changed across 1 commit (+ release files)
