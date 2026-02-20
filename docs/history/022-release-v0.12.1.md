# Release v0.12.1

**Date:** 2026-02-20
**Previous version:** 0.12.0

## Changes

### Fixes
- Fix cross-platform watcher type mismatch causing Linux/Windows build failures — use `RecommendedCache` instead of hardcoded `FileIdMap` in `WatcherState` (on Linux/Android, `RecommendedCache = NoCache`; on macOS/Windows, `RecommendedCache = FileIdMap`)
- Fix release workflow corrupting `package.json` via `sed` — replace fragile regex-based version update with `node -e` for safe JSON manipulation

## Files Changed
- 2 files changed across 2 commits
