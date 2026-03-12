# Release v0.19.1

**Date:** 2026-03-12
**Previous version:** 0.19.0

## Changes

### Features
- Heading level picker dropdown in toolbar (Paragraph, H1-H6)
- Text color popover with 8-color palette
- Background highlight popover with 6-color palette and dark mode support
- Text alignment buttons (left, center, right)
- Indent/outdent buttons for lists (disabled outside lists)
- Table toolbar popover with row/column add/remove, merge/split, header toggle, delete
- Visual table grid picker (hover to select rows×cols before inserting)
- macOS file association for .md/.markdown files
- Table-specific lucide icons (TableCellsMerge, TableCellsSplit, etc.)

### Fixes
- Dark mode highlight colors now use richer tones for readable contrast
- List item paragraph spacing fixed (no more double-spaced bullets)
- Consistent shadcn/ui tooltips across all toolbar buttons (replaced native title attributes)
- Table toolbar no longer conflicts with AI bubble menu (moved from BubbleMenu to Popover)

### Improvements
- Local AI first-start UX with clearer status messages
- Dynamic model metadata enrichment with hover tooltips
- Documentation split into slim core + feature-specific pages
- Consistent completion status markers across all task/PRD files

### Deferred
- Block drag handles (tasks #13-14) — needs unified left-gutter design
- Item annotations (tasks #10-12) — needs unified left-gutter design

## Files Changed
- 111 files changed across 8 commits
