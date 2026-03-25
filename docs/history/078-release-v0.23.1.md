# Release v0.23.1

**Date:** 2026-03-25
**Previous version:** 0.23.0

## Changes

### Fixes
- Fix `list_models` always rejecting OpenAI-compatible connections — the heartbeat test always returned "Base URL is required" regardless of whether a base URL was provided, due to a logic error in the let-else fallback pattern
- Fix API key field always empty when editing connections — after keychain migration, the edit dialog now loads the key from the OS keychain instead of reading the empty `credentials.key` field
- Fix TypeScript build error in `action-store.ts` — add missing `_consecutiveFailures` and `_scanDisabled` fields to the `ActionStore` interface (caused v0.23.0 release build failure)

## Files Changed
- 3 files changed across 3 commits
