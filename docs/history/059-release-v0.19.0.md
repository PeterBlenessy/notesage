# Release v0.19.0

**Date:** 2026-03-10
**Previous version:** 0.18.6

## Changes

### Features
- Bundled Local AI with llama-server sidecar — privacy-focused offline inference with zero setup
- Curated model catalog with FIM-capable code models (Qwen2.5 Coder 1.5B/3B/7B)
- Model management UI in Settings → Local AI (download, delete, set active, FIM badge)
- First-run setup card in chat panel when no AI connections exist
- Inline completions via FIM `/infill` endpoint with chat-based fallback for non-FIM models
- Configurable FIM context size via status bar slider
- Custom inline completion icon (italic T with sparkle trail)
- Thinking/reasoning model support for local models via tag parser
- System RAM detection for model recommendations

### Improvements
- Hardened orphan process cleanup: `pkill llama-server` at startup, `beforeunload` stop, PID file recovery
- Auto-start llama-server on app launch when enabled
- Health checks every 30s with auto-restart on crash (max 3 retries)
- Error backoff for inline completions (stops after 5 consecutive failures)
- Generic inline completion status bar icon replacing provider-specific icons

### Fixes
- Port race condition during server restart (clear port immediately after kill)
- Space insertion logic for ghost text completions
- Console error spam from repeated FIM failures

## Files Changed
- 39 files changed across 3 commits
