# Release v0.33.0

**Date:** 2026-04-14
**Previous version:** 0.32.1

## Changes

### Features
- Subscript and superscript marks with `~sub~` / `^sup^` markdown syntax (via markdown-it-sub/sup plugins) and toolbar buttons
- Focus mode dimming: non-focused blocks fade to 30% opacity when focus mode is active (Cmd+.), powered by @tiptap/extension-focus with `mode: 'all'`
- Trailing node extension: ensures an empty paragraph exists after the last block so users can always click below to continue writing
- UniqueID extension: stable UUIDs on block nodes for improved comment anchoring (in-memory only, not persisted to markdown)

### Improvements
- Decoration plugin factory (`createDecorationPlugin`) reduces boilerplate across 4 decoration extensions (tag-highlight, mention-highlight, date-highlight, table-sparkline)
- Migrated 14 `view.dispatch(tr)` calls to Tiptap `editor.chain()` API for consistency (ai-suggestion, comment-mark, search-highlight, link-preview, markdown utilities)
- Comment anchoring refactored to use node ID + offset (falls back to position-based for existing comments)

### Fixes
- Missing file tabs now show "File not found" instead of infinite "Loading..." (handles renamed/moved/deleted files gracefully)
- Fixed panic in document indexer when truncating strings containing multi-byte characters (emojis)
- Fixed tool calling for OpenAI-compatible and Ollama providers, improved Copilot LSP error handling
- Updated rand 0.9.2 → 0.9.4 to fix Dependabot alert #32

### Tests
- 11 new sub/superscript markdown tests
- 10 UniqueID round-trip tests
- 4 comment store node ID tests
- Sub/superscript round-trip fixture
- 11 Rust export pipeline tests for sub/sup content
- All 24 perf benchmarks pass within budget

## Files Changed
- 30 files changed across 3 commits
