# Release v0.20.2

**Date:** 2026-03-15
**Previous version:** 0.20.1

## Changes

### Improvements
- Consolidate hardcoded values into shared `constants.rs` and `constants.ts` — single source of truth for default model names, API versions, thinking tags, tuning parameters, web search tool IDs, and macOS fallback paths
- Add dynamic thinking tag detection from llama-server `/props` chat_template for custom models
- Close comment popover automatically when delegating in background (non-chat) mode
- Show toast notification when clicking a delegated comment ("An agent is working on this comment")
- Show toast notification when agent finishes a delegated comment ("Agent finished working on your comment")

### Fixes
- Fix CVE in quinn-proto — update to 0.11.14 (unauthenticated DoS via peer_uninit_address)
- Fix RUSTSEC-2025-0068 — migrate serde_yml to serde_norway
- Fix comment popover re-opening during delegation due to useEffect dependency on full comment object

## Files Changed
- 23 files changed across 3 commits
