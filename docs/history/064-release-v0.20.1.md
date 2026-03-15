# Release v0.20.1

**Date:** 2026-03-15
**Previous version:** 0.20.0

## Changes

### Improvements

- Add React error boundaries around editor, chat panel, and sidebar — prevents white-screen crashes from component errors
- Extract shared JSON-RPC 2.0 module from copilot_lsp.rs and mcp.rs — eliminates duplicated Content-Length framing, types, and pending request logic (18 unit tests)
- Decompose skills.rs into agents.rs + script_exec.rs — skills.rs reduced from 1,643 to 593 lines
- Decompose useAIOperations.ts: extract useAcpLifecycle.ts (ACP agent management), context.ts (prompt building), errors.ts (error formatting)
- Decompose Editor.tsx: extract useScrollPersistence.ts, useEditorResize.ts, TranscriptionOverlay.tsx, SourceModeEditor.tsx
- Decompose CommentPopover.tsx: extract CommentThread.tsx and DelegationPanel.tsx
- Decompose App.tsx: extract useAppLifecycle.ts (startup effects) and Layout.tsx (panel layout)
- Migrate serde_yaml to serde_yml (archived crate replaced with maintained fork)
- Remove unused hound crate (zero imports) and slim tokio features from "full" to 7 specific features
- Remove unused next-themes dependency (zero imports, app uses custom ThemeProvider)
- Move @types/diff-match-patch to devDependencies
- Add ACP tool permission unit tests (session/always tiers, independence from skill permissions)
- Update architecture docs to reflect new file structure

### Dependency Changes

- Removed: `next-themes`, `hound`
- Replaced: `serde_yaml` -> `serde_yml`
- Moved to devDependencies: `@types/diff-match-patch`
- Slimmed: `tokio` features from `["full"]` to `["rt-multi-thread", "macros", "io-util", "process", "sync", "time", "fs"]`

## Files Changed

- 35 files changed across 21 commits
