# Release v0.9.0

**Date:** 2026-02-18
**Previous version:** 0.8.0

## Changes

### Features
- Inline comments system (Phase 5, Stream A) — select text, add/edit/delete comments via popover, comment highlights with orange accent
- Filesystem watcher with external change detection (Phase 5, Stream C) — detects when open files are modified externally, prompts to reload
- Git branch diff review (Phase 5, Stream B) — compare current branch against another, accept/reject changes
- Restore open tabs on app restart — persists which files were open and re-opens them
- Comments on non-project files (Explorer) using path-based keys — no frontmatter modification to external files

### Fixes
- Fix per-tab scroll position regression (tabs were sharing scroll positions)
- Fix stray cursor appearing in top-left corner after tab switch
- Fix comment decoration race condition on first comment creation
- Fix comment popover not dismissing delete confirmation dialog correctly

### Improvements
- Comment storage strategy: UUID keys for project files (survives renames), path hash keys for non-project files (no file modification)
- UUID generated eagerly when comment popover opens, reverted on cancel
- Added Phase 5.5 (Notesage Library & iCloud Sync) to roadmap

### Docs
- Added Phase 5 PRD: Comments & Change Detection
- Updated architecture.md with comment key strategy
- Updated product-description.md with implemented Phase 5 features and Phase 5.5 roadmap

## Files Changed
- 40 files changed across 8 commits
