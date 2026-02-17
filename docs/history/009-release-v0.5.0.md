# Release v0.5.0

**Date:** 2026-02-17
**Previous version:** 0.4.0

## Changes

### Features
- Git integration (opt-in via Settings > Editor > Version Control)
  - File status indicators (M/A/U/D/R/C) in sidebar file tree
  - Commit dialog with file selection, message input, and inline identity config
  - Branch indicator and switching in project sidebar
  - Per-file "Commit..." option in file context menu
  - Git init from project context menu for non-git projects
  - Git availability check when enabling the toggle
  - NUL-delimited git status parsing for robust path handling on all platforms
- Window position and size persisted across app restarts (tauri-plugin-window-state)

### Improvements
- Settings dialog: Editor tab is now the default/first tab, above AI tabs
- Development lifecycle: migrated slash commands to skills system
- Release workflow: removed macOS Intel build target

## Files Changed
- 47 files changed across 4 commits
