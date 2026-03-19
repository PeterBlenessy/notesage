# Release v0.22.5

**Date:** 2026-03-19
**Previous version:** 0.22.4

## Changes

### Fixes
- Fix ghost task items corrupting bullet lists on round-trip — ProseMirror's "Bullet List Limbo" (Tiptap #3128) created invisible empty task items that compounded on each reload, escaping brackets (`\[ \]`) and growing the list. New per-block `stripGhostTaskItems` replaces the old document-tail-only cleanup, with 12 vitest cases.
- Fix task list checkbox vertical alignment with text (margin-top 0.25rem → 0.15rem)
- Fix AI suggestion decorations disappearing on tab switch — suggestion state is now saved/restored per tab via a Map ref in Editor.tsx

### Improvements
- Restyle AI suggestion diffs: highlight-only (no strikethrough, no colored text), with proper dark mode variants via CSS classes instead of inline styles
- Change Open Actions Dashboard shortcut from Cmd+5 to Cmd+1

## Files Changed
- 8 files changed across 4 commits
