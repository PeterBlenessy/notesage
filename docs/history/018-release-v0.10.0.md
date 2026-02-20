# Release v0.10.0

**Date:** 2026-02-19 **Previous version:** 0.9.0

## Changes

### Features

- Add custom title bar with drag region overlay
- Add rail-to-drawer sidebar with collapsible sections
- Add command palette with file search, actions, and focus mode toggle (Cmd+K, Cmd+Shift+F)
- Add focus mode — hides sidebar, tabs, status bar (Cmd+.)
- Add document outline popover (Cmd+Shift+O)
- Add contextual status bar with git branch, comment count, page position indicator
- Add comment list popover from status bar badge with scroll-to-comment navigation
- Add page break visibility toggle (visible gap vs continuous margin ticks)
- Add toolbar visibility toggle in settings

### Fixes

- Fix empty catch blocks, add strokeWidth and standard icon size to slash commands
- Fix code review warnings: inline styles, any types, error toasts, keyboard shortcuts
- Replace alert() with toast notifications for save/auto-save errors
- Fix drag region clickability, settings row interaction

### Improvements

- Eliminate all inline CSS variable styles and hover handlers across codebase
- Normalize text sizes to Tailwind scale, add missing strokeWidth={1.5}
- Replace inline styles with Tailwind classes throughout
- Make editor scrollbar more prominent
- Add focus states and normalize font sizes in CommentListPopover
- Improve CSS custom property typing for editor styles
- Command palette: denser rows, file count in placeholder

## Files Changed

- 44 files changed across 15 commits