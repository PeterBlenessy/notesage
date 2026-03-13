# Release v0.19.3

**Date:** 2026-03-13
**Previous version:** 0.19.2

## Changes

### Features
- Open Actions Dashboard (Cmd+5) — unified view of all open tasks, comments, agent delegations, and goals across projects
- Rust backend scanner (`scan_actions`) parses markdown task lists, goal frontmatter, and comment JSON sidecars
- Zustand action store with full/incremental scanning, file watcher integration, and optimistic checkbox toggling
- Filter bar with search, source type, status, and project filters
- Status bar indicator showing open action count
- Command palette entry for "Open Actions"
- Click-to-navigate: clicking an action opens the file and scrolls to the matching text

### Improvements
- Accessible dialog with visually hidden DialogTitle for screen readers
- Actions grouped by project with collapsible completed section

## Files Changed
- 35 files changed across 1 commit
- New: `src-tauri/src/commands/actions.rs`, `src/stores/action-store.ts`, `src/hooks/useActionScanner.ts`, `src/components/actions/` (4 components)
- Modified: `App.tsx`, `Editor.tsx`, `StatusBar.tsx`, `CommandPalette.tsx`, `editor-store.ts`, `useFileOperations.ts`, `useKeyboardShortcuts.ts`, `tauri.ts`
