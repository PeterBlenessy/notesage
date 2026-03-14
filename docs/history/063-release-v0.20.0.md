# Release v0.20.0

**Date:** 2026-03-14
**Previous version:** 0.19.3

## Changes

### Features
- SQLite document index with AST-parsed tags, mentions, tasks, goals, and FTS5 content search
- Index progress spinner in status bar, clear orphaned localStorage keys
- Actions dashboard: icons, counts, and sub-grouped filter dropdown (Projects/Folders/Notes)
- Actions dashboard: type filter with per-type counts (Tasks, Comments, Agent tasks, Goals)
- Secure credential storage PRD for future macOS Keychain migration

### Fixes
- Date pill: fix picker not updating document — use exact ProseMirror positions instead of coordinate-based proximity search
- Date pill: suppress slash command and date suggestion menus inside existing date decorations via allow() filters
- Date pill: fix CSS layout issues — remove display: inline-block from date-badge-prefix
- Actions dashboard: deduplicate items from overlapping project/global DB queries
- Actions dashboard: fix project filter showing 0 items — findProjectRoot() now checks projects, folders, and notes root
- Actions dashboard: fix "Done" status filter to include both 'done' and 'completed' statuses
- Actions dashboard: fix status dropdown not reflecting current selection
- Sidebar: show toast errors instead of silent console.error on folder/file open failures

### Security
- Fix XSS in command palette FTS5 snippet rendering — replace dangerouslySetInnerHTML with safe React element rendering
- Fix XSS in DocxViewer — add DOMPurify sanitization on mammoth.js HTML output
- MCP: project-scoped servers (.notesage/mcp.json) default to enabled: false — prevents auto-execution from cloned repos

### Improvements
- Remove any type casts in Editor.tsx, useEditor.ts, and slash-command.tsx — use PMNode, TiptapEditor, and narrowed Record types
- Type suggestion allow() state parameter as EditorState directly instead of unknown + cast
- Use stable key={item.title} instead of key={index} in slash command list
- Use FolderKanban icon for projects in sidebar and actions dashboard
- Add minimum 600ms spin duration to actions refresh button
- Remove "Delegated" status filter — delegated tasks filterable via "Agent tasks" type instead
- Add warning for unhandled status filter values

## Files Changed
- 17 files changed across 13 commits
