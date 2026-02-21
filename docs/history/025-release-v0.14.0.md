# Release v0.14.0

**Date:** 2026-02-21
**Previous version:** 0.13.0

## Changes

### Features
- Add Copilot Language Server integration for inline completions (Phase 6e)
  - JSON-RPC 2.0 over stdio transport for LSP communication
  - OAuth device flow authentication with GitHub
  - Document sync (didOpen/didChange/didClose/didFocus) for active tabs
  - Ghost text completions via `textDocument/inlineCompletion` requests
  - GhostText Tiptap extension with ProseMirror widget decorations
  - `useCopilotCompletion` hook for LSP lifecycle and completion orchestration
  - Copilot LSP auth flow in ConnectionsSettings (device code phase)
  - Ghost text styles (dimmed, italic, non-interactive)
- Add status bar Copilot indicator with per-document toggle
  - GitHub icon in status bar when inline completion connection is active
  - Popover with toggle switch to disable completions per document
  - Session-only (resets when tab is closed, not persisted)
  - Icon dims when disabled; green/grey status dot reflects state

### Fixes
- Fix Copilot LSP auth flow, rename providers, enable all capabilities
- Fix Copilot LSP key collision, race condition, and dead process detection
- Remove `inline_completion` capability from Copilot CLI provider (only LSP supports it)
- Rename "GitHub Copilot LS" to "GitHub Copilot LSP" throughout UI
- Remove debug console.log statements from ghost-text extension

### Docs
- Add Copilot Language Server PRD and task breakdown (Phase 6e)
- Update architecture with Copilot LSP data flow, Path 3 (LSP), and new files
- Update product description with Inline Completions section
- Mark all 10 PRD tasks + 1 bonus task as complete

## Files Changed
- 17 files changed across 7 commits
- New files: `copilot_lsp.rs` (1157 lines), `ghost-text.ts`, `useCopilotCompletion.ts`, PRD + tasks docs
- Modified: Editor.tsx, StatusBar.tsx, ConnectionsSettings.tsx, connections.ts, editor-store.ts, editor.css, architecture.md, product-description.md
