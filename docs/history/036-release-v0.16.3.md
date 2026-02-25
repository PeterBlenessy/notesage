# Release v0.16.3

**Date:** 2026-02-25
**Previous version:** 0.16.2

## Changes

### Features
- Multi-folder explorer support: open multiple folders simultaneously in the Folders sidebar section, each as a collapsible entry with independent expand/collapse, context menu, and file watching
- Full-width source editor with word wrap toggle in toolbar

### Fixes
- Fix tab restoration order and active tab on app restart
- Fix changelog dialog: scrollable content and dev mode loading
- Fix changelog dialog bullet alignment and capitalize section headings
- Fix image display: project-root relative paths, path normalization, load timing
- Fix Cmd+/ view mode toggle for Nordic keyboard layouts
- Enlarge toolbar and chat icons for better visibility
- Fix changelog CORS error in production: use Tauri HTTP plugin instead of browser fetch for GitHub release assets

### Improvements
- New ExplorerFolderItem component for collapsible folder entries (simplified ProjectItem)
- Workspace store refactored from single explorerPath to explorerFolders array with persistence migration
- Architecture docs updated for workspace-store rename and new component

## Files Changed
- 24 files changed across 9 commits
