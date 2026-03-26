# Release v0.23.3

**Date:** 2026-03-26
**Previous version:** 0.23.2

## Changes

### Fixes
- Fix FileTreeItem expand/collapse broken by React.memo wrapper — subscribe to actual boolean state instead of stable function reference
- Fix tab switch performance regression — useFileTreeItemState subscribed to full tabs array causing all tree items to re-render on every tab switch
- Fix tippy.js "destroy() called on already-destroyed instance" warning in all 4 suggestion extensions (tag, mention, date, slash)

### Features
- Background tab preloading — after active tab loads on startup, remaining placeholder tabs preload from disk sequentially for instant switching
- Structured performance debug logs (`perf:tab-load`, `perf:tab-preload`, `perf:tab-switch`) with file size and timing data, gated behind debug log level

### Tests
- Markdown round-trip test framework: 16 fixture files covering all supported syntax, 17 vitest tests
- Rust SQL query builder tests: 33 tests covering tags, mentions, FTS5 content search, tasks, goals, stats
- Vitest tests for core hooks: 28 tests for useFileOperations and useAIOperations with Tauri IPC mock infrastructure
- Store persistence round-trip tests: 16 tests for editor-store, connections-store, chat-store
- Vitest config with path aliases and jsdom environment

### Documentation
- Full 12-category codebase audit v2 with 38 fix tasks (all complete)
- E2E testing research for Tauri v2 on macOS (9 options evaluated)
- Test infrastructure PRD with task breakdown (18 tasks)
- Performance observability PRD with task breakdown (16 tasks)

## Files Changed
- 100 files changed across 18 commits
