# Release v0.16.0

**Date:** 2026-02-25
**Previous version:** 0.15.5

## Changes

### Features
- Raw mode enhancements: Copilot inline completions (ghost text) in CodeMirror via LSP
- Raw mode enhancements: AI text actions bubble menu (Improve, Summarize, Expand) on selection
- YAML frontmatter recognition and syntax highlighting in raw mode with fold support
- Cmd+/ keyboard shortcut works in raw mode to toggle back to rich text

### Fixes
- Fix selection visibility in raw mode — selection background now clearly visible in both light and dark themes
- Fix line numbers styling — gutters use muted background with subtle border, lighter text color, smaller font
- Fix comment interaction in raw mode — shows toast with "Switch" action instead of broken popover positioning
- Fix Copilot LSP document sync coordination — rich text and raw mode hooks properly hand off document tracking

### Improvements
- CodeMirror theme: explicit selection/match colors instead of relying on CSS variables
- Dark mode: proper overrides for selection, search matches, and gutter colors
- Raw editor container layout: proper scroll handling with relative positioning for bubble menu
- Rename view mode labels: "Source" → "Raw", "WYSIWYG" → "Rich text"

## Files Changed
- 10 files changed across 4 new files and 6 modified files
