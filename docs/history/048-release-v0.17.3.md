# Release v0.17.3

**Date:** 2026-03-02
**Previous version:** 0.17.2

## Changes

### Features
- File content search in command palette (Cmd+Shift+F) — grep-like search across all workspace files with debounced backend calls, line numbers, and content snippets
- Recent files section now visible in file search mode (Cmd+Shift+F), matching the standard palette (Cmd+K) behavior

### Improvements
- New `search_file_content` Tauri command: case-insensitive substring search across 40+ text file extensions, skips hidden files and files >1MB, capped at 100 results
- File search results grouped as Recent → Files → Content Matches for clear visual hierarchy
- Recent files excluded from the Files group in file search mode to avoid duplicates
- Updated placeholder text to indicate content search capability

## Files Changed
- 4 files changed across 1 commit
- `src-tauri/src/commands/file.rs` — ContentMatch struct, search_file_content command, scan_dir_for_content helper
- `src-tauri/src/lib.rs` — Register search_file_content in handler
- `src/lib/tauri.ts` — ContentMatch type and searchFileContent wrapper
- `src/components/CommandPalette.tsx` — Recent section in filesOnly, content search UI with debounce and loading state
