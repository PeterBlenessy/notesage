# Release v0.28.4

**Date:** 2026-04-05
**Previous version:** 0.28.3

## Changes

### Fixes
- Fix stream listener registration race in useDirectApiChat — done event could fire before attachment
- Fix ACP cancel escalation listener leak on timeout
- Add recursion depth limit to ensureAcpAgent and ensureTaskAgent (max 3 retries)
- Fix stale whisper listeners on rapid dictation toggle
- Fix stale closure in useCommentDelegation capturing full comment object
- Add abort signal to useDirectApiChat stream listeners for rapid cancel
- Fix save failure not re-marking tab dirty — prevents silent data loss
- Bound file watcher debounce map growth under extreme file churn

### Improvements
- Add mounted guards to useMcpOperations and useActionScanner listeners
- Add focus-visible styling to ChatMessage plain buttons
- Improve disabled button contrast for AA compliance in soft light mode
- Add aria-live to StatusBar index progress for screen reader announcements
- Add guidance text to Activity panel empty state
- Add actionable "Ollama not running" error message
- Add retry UI for direct API chat failures
- Show error state in CommandPalette on index query failure
- Replace Tiptap storage `as any` casts with getEditorStorage<T>()
- Define WebSpeechRecognition interface replacing 3 `as any` casts
- Replace Rust stringly-typed APIs with enums (CopilotStatusKind, FileChangeKind, GitFileStatus, ActionSourceType, ActionStatus)
- Add return types to public hooks (useEditor, useAIContext, useAgentTaskOperations, useCommentDelegation)
- Memoize FileTreeItem destinations array and context menu callbacks
- Memoize SidebarPanel conditional style objects
- Memoize ExplorerFolderItem isProjectFolder check
- Use selector factory for ProjectItem project lookup
- Lift expensive store subscriptions from FileTreeItem to parent FileTree

### Tests
- Add ACP agent lifecycle tests (spawn, permissions, crash recovery)
- Add file watcher tests (create, modify, delete, self-write filter, debounce)
- Add git command Rust tests (status parsing, branch detection, commit, error handling)
- Add sandbox policy Rust tests (deny default, writable paths, sensitive dirs, domain matching)
- Add MCP server lifecycle Rust tests (spawn, tool discovery, crash cleanup)
- Add AI streaming edge case tests (abort, timeout, malformed SSE, concurrent streams)
- Add conversationOps and segmentOps unit tests (34 new tests)

### Decomposition
- Decompose ai_streaming.rs (1720→1040 lines): extract tool_execution.rs and segment_builder.rs
- Decompose model_management.rs (1582→683 lines): extract model_providers/hf_search.rs and binary_resolution.rs
- Decompose PptxViewer.tsx (1088→338 lines): extract PptxSlideRenderer, PptxChartRenderer, PptxSearchBar, PptxZoomControls
- Decompose chat-store.ts: extract conversationOps.ts and segmentOps.ts

### Documentation
- Fix web_search file location in tauri-commands.md
- Document slow startup bug (sequential iCloud tree validation)
- Update architecture docs for decomposed modules

## Files Changed
- 60+ files changed across 7 commits
