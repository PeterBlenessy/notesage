# Release v0.18.4

**Date:** 2026-03-08
**Previous version:** 0.18.3

## Changes

### Features
- Structured logging with `tauri-plugin-log` — rotating 5MB log files, runtime debug toggle, frontend structured logger with batched IPC forwarding
- Log file management in Settings (path display, Reveal in Finder, Clear Logs)
- File-backed persistence for chat and activity stores (`~/.notesage/state/`) with throttled writes and atomic file operations
- Health check commands (`ping`, `health_check`) for sleep/wake recovery
- `visibilitychange` wake handler — detects dead WebView, recovers filesystem watchers, reports dead AI processes
- Startup cleanup of orphaned ACP agent processes via `pkill`

### Fixes
- Fix `flushInterval` out-of-scope bug in streaming cleanup (`useAIOperations`)
- Fix MutationObserver leak in inline-diff with deterministic Map-based cleanup
- Fix reader loop hangs in Copilot LSP and MCP with 30s timeouts
- Fix `@mozilla/readability` vulnerability by bumping to ^0.6.0

### Improvements
- Store bounds: max 50 conversations, 500 messages, 100 completed tasks, 200 activities per task, 7-day task TTL, 20 pending external changes, 200 scroll positions (LRU)
- Streaming state (`partialOutput`, `thinkingOutput`) excluded from persistence writes
- Filesystem watcher overflow guards (500 entry cap) and batch event emission
- Disable macOS App Nap to prevent aggressive process suspension
- Settings UI: consistent card layout for toggles, smaller switch component, icon-only log buttons with tooltips
- Rename "Create Prompt" to "Add" for consistency

## Files Changed
- 44 files changed across 4 commits
