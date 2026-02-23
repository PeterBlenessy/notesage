# Release v0.15.2

**Date:** 2026-02-23
**Previous version:** 0.15.1

## Changes

### Features
- In-app auto-update via Tauri updater plugin — silent check on launch, download with progress, install & restart
- UpdateDialog with markdown release notes, version transition display, and progress bar
- Status bar update indicator (ArrowUpCircle icon) when update is available
- Settings > About tab with version display, Check Now button, and auto-check toggle
- Toast notification when a new version is detected

### Fixes
- Fix settings dialog width and suppress Rust warnings
- Fix production binary resolution and add devtools support
- Fix agent binary resolution failing in production macOS builds

### Improvements
- Rewrite provider picker as DropdownMenu with polished connection flow
- CI release workflow generates `latest.json` update manifest via `updaterJsonPreferNsis`
- Friendly error messages for update check failures (network, 404, timeout, signature)
- Update check timestamp persisted and displayed as relative time ("Just now", "2 minutes ago")

## Files Changed
- 28 files changed across 5 commits
