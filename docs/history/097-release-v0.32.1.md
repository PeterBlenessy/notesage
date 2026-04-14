# Release v0.32.1

**Date:** 2026-04-13
**Previous version:** 0.32.0

## Changes

### Fixes
- Fix chat text truncation caused by selectMessages selector cache collision — replaced Date.now() with monotonic counter for conversation updatedAt to ensure every store mutation invalidates the selector cache
- Fix ACP tool call progress: "0/n" counter and endless spinners caused by single-index tracking overwritten during parallel tool calls — replaced with FIFO queue
- Fix tool call labels missing file paths and URLs for Claude Code agent — case-insensitive kind matching, path extraction from title field

### Features
- Support inline base64 data URI images in the editor — enables displaying embedded images from Apple Notes imports
- Preserve interrupted agent messages with "Interrupted" indicator instead of discarding partial content
- Include conversation history in new ACP session system prompt after interruption for context restoration

### Improvements
- Simplified tool call group counter to show total count instead of confusing doneCount/total format
- Added icon mappings for websearch, webfetch, toolsearch tool kinds
- buildAcpChatCleanup now calls finalizeSegments on cleanup so running spinners stop immediately

## Files Changed
- 13 files changed across 3 commits
