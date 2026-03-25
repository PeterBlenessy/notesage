# Release v0.23.2

**Date:** 2025-07-24
**Previous version:** 0.23.1

## Changes

### Improvements

- **Full codebase audit (38 tasks, 43 findings):** Comprehensive audit covering Rust backend, memory leaks, async flows, render performance, and decomposition
- **Rust backend fixes (#1–#5):** Fix double keychain read, replace panic with error return in ACP runtime creation, add warn logging for silent proxy cleanup failures, reuse reqwest::Client for connection pooling, improve error context in Tauri commands
- **Memory leak fixes (#6–#11):** Fix listener leaks on early unmount (useSandboxViolations, useMcpDiscovery), fix double cleanup guard (useAcpLifecycle), fix listener overwrite leak (useSpeechRecognition), add unmount guards for Whisper fallback, audit timeout cleanup (useCopilotCompletion)
- **Async flow fixes (#12–#24):** Add spawn locks to ACP agent singletons, fix stale closure in comment save debounce, add AbortController to useLocalCompletion, fix fetchedRef reset in useModelMetadata, replace Promise.all with Promise.allSettled in useLocalAI, add outer error boundary to useSkillDiscovery, fix stale state in debounced file watcher handlers, add editor null checks after awaits, fix didChange/completion race in useCopilotCompletion, add abort to visibility handlers, fix iCloud discovery stale store snapshot, guard debounce map overflow
- **Render performance (#25–#30):** Add Zustand selectors to Layout, ChatPanel, Sidebar, FileTreeItem, AISettings; fix CommandPalette useMemo defeated by unmemoized callbacks; memoize Layout inline callback props; stabilize ChatPanel selectedProjectPaths array identity; memoize DocumentOutline per-heading callbacks
- **Decomposition (#31–#38):** Decompose Editor.tsx (1822 → 753 lines), extract ConnectAgent/ConnectCopilotLsp from ConnectionsSettings.tsx, decompose useAIOperations.ts (505 → ~130 lines), extract SkillsSettings.tsx inline dialogs (1267 → 665 lines), decompose useAcpLifecycle.ts (823 → 369 lines), decompose local_inference.rs (1769 → 752 lines), deduplicate JSON-RPC transport between copilot_lsp.rs and mcp.rs, decompose acp.rs (1481 → 1016 lines)

### Fixes

- Normalize base URLs consistently — handle trailing slashes and /v1

## Files Changed
- 66 files changed across 18 commits
