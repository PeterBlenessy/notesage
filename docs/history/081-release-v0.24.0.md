# Release v0.24.0

**Date:** 2026-03-28
**Previous version:** 0.23.3

## Changes

### Features
- Conversation branching — branch from any chat message to explore alternative AI responses, with a full-width branch separator and popover to switch between branches
- Tab reordering via drag and drop with visual insertion indicator
- Internal document linking — link to other workspace files with search, click navigation, and dashed-underline styling
- System font enumeration with searchable font picker (14 presets + all installed fonts)
- Continuous contrast slider (0–100) replacing the binary soft contrast toggle
- Client-side tool calling for all AI providers (Anthropic, OpenAI, Ollama, local) with web search, file read/write, and skill execution

### Fixes
- Fix paper mode pages not rendering at full page height, including widow heading prevention
- Fix Local AI not auto-starting by using PID-file cleanup instead of pkill
- Fix Document Outline showing blank document after heading navigation
- Fix AI suggestion diff not always visible after Expand/Improve/Summarize
- Fix clipboard copying markdown syntax instead of plain text

### Improvements
- Conversation export supports branched conversations — export active thread, all branches (Markdown), or full tree (JSON)
- Branch count shown in conversation history metadata
- Performance benchmark infrastructure with baseline thresholds and CI integration
- Security hardening: TOCTOU fixes, async safety, error handling, listener cleanup
- Test coverage expanded to 1293 tests across 53 test files

## Files Changed
- 231 files changed across 46 commits
