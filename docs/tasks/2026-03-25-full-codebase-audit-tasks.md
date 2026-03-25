# Full Codebase Audit — Implementation Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-25 |
| **Status** | In progress |
| **Audit** | [2026-03-25-full-codebase](../audit/2026-03-25-full-codebase.md) |
| **Total** | 38 tasks (covering all 43 findings): 14S, 15M, 9L |
| **Suggested order** | Rust backend (#1-#5) → Memory leaks (#6-#11) → Async fixes (#12-#24) → Render perf (#25-#30) → Decomposition (#31-#38) |

**Risks:**

- Decomposition tasks (#31-#38) are large refactors that touch critical paths — test thoroughly after each
- Zustand selector migration (#25) touches many files — risk of subtle regressions in re-render behavior
- Agent singleton lock (#12-#13) changes concurrency semantics — verify with manual concurrent spawn testing

**Finding coverage:** 38 tasks map to 43 audit findings. Tasks covering multiple findings:

- #25 covers 4 HIGH findings (Layout, ChatPanel, Sidebar, FileTreeItem broad subscriptions)
- #29 covers 2 findings (DocumentOutline inline onClick + inline style objects)

---

## Rust Backend (LOW risk, quick wins)

### #1 — Fix double keychain read in [credentials.rs](http://credentials.rs) ✅

**Description:** `get_credential` calls `entry.get_password()` twice — once to check, then with `.unwrap()`. Replace with single call using `match Ok(password) => Ok(Some(password))`.

**Complexity:** S **Category:** backend **Dependencies:** None **Files:** `src-tauri/src/commands/credentials.rs`

### #2 — Replace panic with error return in acp.rs tokio runtime creation ✅

**Description:** Line 411 uses `.expect()` which panics. Replace with `map_err(|e| e.to_string())?` to return a proper error to the frontend.

**Complexity:** S **Category:** backend **Dependencies:** None **Files:** `src-tauri/src/commands/acp.rs`

### #3 — Add warn logging for silent try_lock failures in network_proxy.rs ✅

**Description:** `try_lock()` failures during shutdown are silently ignored — proxy processes may not clean up. Add `log::warn!` on else branches (lines 195-205).

**Complexity:** S **Category:** backend **Dependencies:** None **Files:** `src-tauri/src/commands/network_proxy.rs`

### #4 — Reuse reqwest::Client instead of creating per request ✅

**Description:** `ai.rs` line 133 creates `reqwest::Client::new()` per request — no connection pooling. Store a shared `Client` in Tauri managed state or as a `once_cell::sync::Lazy` static. Low impact for UI app but easy to fix.

**Complexity:** S **Category:** backend **Dependencies:** None **Files:** `src-tauri/src/commands/ai.rs`

### #5 — Audit string-typed error context loss ✅

**Description:** All Tauri commands use `Result<T, String>` which is acceptable for IPC, but some error paths lose diagnostic detail during `.to_string()` conversion. Audit the worst offenders and add context where errors are most opaque (e.g., include file paths in IO errors, include HTTP status in network errors).

**Complexity:** M **Category:** backend **Dependencies:** None **Files:** `src-tauri/src/commands/ai.rs`, `src-tauri/src/commands/file.rs`, `src-tauri/src/commands/acp.rs`

---

## Memory Leaks (HIGH priority)

### #6 — Fix useSandboxViolations listener leak on early unmount ✅

**Description:** The `listen()` promise may resolve after unmount, leaving the listener orphaned. Add a `mounted` flag pattern: if already unmounted when the promise resolves, call the unlisten function immediately.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useSandboxViolations.ts`

### #7 — Fix useAcpLifecycle double cleanup guard ✅

**Description:** The `cleanupRef` callback chain can be called multiple times if unmount races with `acpCancelChat`. Add a null-guard: set `cleanupRef.current = null` at the start of cleanup to prevent re-entry.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useAcpLifecycle.ts`

### #8 — Fix useSpeechRecognition listener overwrite leak ✅

**Description:** When `startWhisperDictation` is called multiple times, old `unlistenRef.current` is overwritten without cleanup. Call `unlistenRef.current()` and null it before setting up a new listener.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useSpeechRecognition.ts`

### #9 — Verify useMcpDiscovery listener cleanup ✅

**Description:** Audit `useMcpOperations.ts` lines 139-150 to confirm the `mcp-server-status` Tauri event listener is properly cleaned up on unmount. Apply the same `mounted` flag pattern if needed.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useMcpOperations.ts`

### #10 — Fix useSpeechRecognition unmount guard for Whisper fallback ✅

**Description:** When Web Speech API fails, `startWhisperDictation()` is called async without unmount protection. Add a `mountedRef` that is checked before any state updates after the async call resolves.

**Complexity:** S **Category:** frontend **Dependencies:** #8 (same file) **Files:** `src/hooks/useSpeechRecognition.ts`

### #11 — Audit useCopilotCompletion timeout cleanup ✅

**Description:** Tracked open document timeouts are cleaned up, but other places in the hook may have stale timers. Full review of all `setTimeout`/`setInterval` usage in `useCopilotCompletion.ts` to confirm all are cleared on unmount.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useCopilotCompletion.ts`

---

## Async Flows & Race Conditions

### #12 — Add spawn lock to ACP agent singleton ✅

**Description:** Module-level `acpAgent` has a race condition: concurrent `ensureAcpAgent` calls can both see null and both spawn. Add a `spawnPromise` variable — if a spawn is in progress, concurrent callers await it instead of spawning again.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useAcpLifecycle.ts`

### #13 — Add spawn lock to task agent singleton ✅

**Description:** Identical race to #12 in the task agent. Same fix: add a `spawnPromise` that concurrent callers await.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useAgentTaskOperations.ts`

### #14 — Fix stale closure in comment save debounce ✅

**Description:** The `positionSaveTimeoutRef` debounce callback captures `commentKey` and `storageRoot` from closure. If the user switches tabs during the 2s debounce, the pending timeout uses stale values. Read current values from store/ref inside the timeout callback.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useCommentOperations.ts`

### #15 — Add AbortController to useLocalCompletion ✅

**Description:** Completion requests lack abort capability — while `requestId` discards stale results, the HTTP request still completes. Add an `AbortController` that is aborted on new requests and on unmount.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useLocalCompletion.ts`

### #16 — Fix useModelMetadata fetchedRef reset ✅

**Description:** `fetchedRef` is never reset when `modelType` changes, preventing refetch. Reset it when `modelType` changes (add `modelType` to the check or use a `lastModelTypeRef`).

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useModelMetadata.ts`

### #17 — Replace Promise.all with Promise.allSettled in useLocalAI ✅

**Description:** If any promise rejects, all results are lost. Use `Promise.allSettled` and handle individual `rejected` results gracefully (log warning, continue with successful ones).

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useLocalAI.ts`

### #18 — Add outer error boundary to useSkillDiscovery ✅

**Description:** The async IIFE in `useSkillOperations.ts` (lines 196-244) has no outer try/catch. Wrap the entire IIFE body in a try/catch with `console.error` to prevent unhandled rejections.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useSkillOperations.ts`

### #19 — Fix useFileWatcher stale state in debounced modify handler ✅

**Description:** The `handleModifyEvent` async handler fires from a `setTimeout` callback and reads `useEditorStore.getState()` at call time. State may be stale when awaits complete. Re-read state after each await boundary, or capture only the values needed before the first await.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useFileWatcher.ts`

### #20 — Add editor null check after await in useLocalCompletion ✅

**Description:** After an async operation, code accesses `editor.isFocused` and `editor.isDestroyed` without null check (line 133). If editor is destroyed during the await, this throws. Add a guard: `if (!editor || editor.isDestroyed) return;` after the await.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useLocalCompletion.ts`

### #21 — Fix useCopilotCompletion didChange/completion race ✅

**Description:** `didChange` invoke and debounced `requestCompletion` fire without coordination. Completion could use a stale document version. Add a version counter or ensure `didChange` completes before firing completion. Low severity but easy to fix.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useCopilotCompletion.ts`

### #22 — Add abort/cancellation to useAppLifecycle visibility handlers ✅

**Description:** `tauriApi.ping()` and `tauriApi.healthCheck()` called from visibility change handler have no abort on unmount. Add an `AbortController` or mounted guard so in-flight requests are cancelled on cleanup.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useAppLifecycle.ts`

### #23 — Fix iCloud discovery stale store snapshot ✅

**Description:** iCloud project discovery reads store state inside a 1s debounced `setTimeout`. Calling `addProject()` on a potentially superseded snapshot could lose concurrent updates. Read fresh state (`useWorkspaceStore.getState()`) inside the timeout callback instead of capturing it outside.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useFileWatcher.ts`

### #24 — Guard useFileWatcher debounce map overflow ✅

**Description:** Per-file debounce maps can briefly exceed `MAX_DEBOUNCE_ENTRIES` before the overflow guard triggers. Move the overflow check before adding a new entry, or use a bounded `Map` that evicts oldest entries. Low severity — only matters with very high file churn.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useFileWatcher.ts`

---

## Render Performance

### #25 — Add Zustand selectors to Layout, ChatPanel, Sidebar, FileTreeItem ✅

**Description:** Replace broad `const { x, y } = useStore()` destructuring with individual `const x = useStore(s => s.x)` selectors in the four highest-impact components. This prevents re-renders from unrelated store mutations.

**Covers 4 audit findings:**

- `Layout.tsx` (line 169): `useSettingsStore()` — top-level, cascades everywhere
- `ChatPanel.tsx` (line 51): 13 fields from `useChatStore()`
- `Sidebar.tsx` (lines 27-39): 11 fields from `useWorkspaceStore()`
- `FileTreeItem.tsx` (lines 69-71): `useWorkspaceStore()` + `useEditorStore()`

**Complexity:** L **Category:** frontend **Dependencies:** None **Files:** `src/components/Layout.tsx`, `src/components/chat/ChatPanel.tsx`, `src/components/sidebar/Sidebar.tsx`, `src/components/sidebar/FileTreeItem.tsx`

### #26 — Add Zustand selectors to AISettings ✅

**Description:** `AISettings.tsx` (lines 18-27) destructures 8 fields from `useAIStore()`. Lower impact than #25 (modal-based, not always visible) but same pattern. Replace with individual selectors.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/components/settings/AISettings.tsx`

### #27 — Fix CommandPalette useMemo defeated by unmemoized callbacks

**Description:** The `actions` array is wrapped in `useMemo` with 13 dependencies, but many are inline arrow functions recreated every render. Extract the action callbacks into `useCallback` hooks so the `useMemo` is actually effective.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/components/CommandPalette.tsx`

### #28 — Memoize Layout.tsx inline callback props

**Description:** Arrow functions created on every render and passed as props to `TitleBar` (lines 204-206). Wrap in `useCallback`.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/components/Layout.tsx`

### #29 — Stabilize ChatPanel selectedProjectPaths array identity

**Description:** `selectedProjectPaths` array identity changes on every render, causing a useEffect to run too often (line 120). Memoize with `useMemo` or use a stable reference via `useRef` + shallow comparison.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/components/chat/ChatPanel.tsx`

### #30 — Memoize DocumentOutline per-heading callbacks and style objects

**Description:** Each heading button creates inline `onClick` and `style` objects (covers 2 audit findings: inline onClick per heading + inline style objects). Use a single memoized handler that reads the position from `data-*` attributes, and convert padding to Tailwind classes or CSS custom properties.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/components/DocumentOutline.tsx`

---

## Decomposition (Large refactors)

### #31 — Decompose Editor.tsx (1,822 lines → \~600 lines)

**Description:** Extract four modules from `Editor.tsx`:

| Extract to | Responsibility |
| --- | --- |
| `EditorViewerContainer.tsx` | File type routing (PDF/EPUB/DOCX/images) |
| `useFileWatcherIntegration.ts` | External change detection + diff review |
| `useEditorKeyBindings.ts` | Keyboard shortcut handlers |
| `useCommentEditorSync.ts` | Comment position remapping |

Leave `Editor.tsx` as a thin orchestrator (\~600 lines). Each extraction should be a separate commit. Run tests after each extraction.

**Complexity:** L **Category:** frontend **Dependencies:** #25 (may touch same files) **Files:** `src/components/editor/Editor.tsx` + 4 new files

### #32 — Extract ConnectAgent and ConnectCopilotLsp from ConnectionsSettings.tsx

**Description:** `ConnectionsSettings.tsx` (1,685 lines) has `ConnectAgent` (468 lines) and `ConnectCopilotLsp` (384 lines) nested inline. Extract each to its own file. They're self-contained dialogs with clear boundaries.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:** `src/components/settings/ConnectionsSettings.tsx`, `src/components/settings/ConnectAgent.tsx` (new), `src/components/settings/ConnectCopilotLsp.tsx` (new)

### #33 — Decompose useAIOperations.ts into per-provider hooks

**Description:** Extract the \~50-line provider routing conditional into per-provider hooks:

| Extract to | Provider |
| --- | --- |
| `useAnthropicChat.ts` | Anthropic streaming |
| `useOpenAiChat.ts` | OpenAI streaming |
| `useOllamaChat.ts` | Ollama streaming |

Leave `useAIOperations.ts` as a router (\~150 lines) that delegates based on connection type.

**Complexity:** L **Category:** frontend **Dependencies:** None **Files:** `src/hooks/useAIOperations.ts` + 3 new files

### #34 — Extract SkillsSettings.tsx inline dialogs

**Description:** `SkillsSettings.tsx` (1,267 lines) has 3 dialogs and `AgentGroup` (406 lines) nested inline. Extract `AgentGroup` and the dialogs to separate files.

**Complexity:** L **Category:** frontend **Dependencies:** None **Files:** `src/components/settings/SkillsSettings.tsx` + new extracted files

### #35 — Decompose useAcpLifecycle.ts (800 lines)

**Description:** Auth flow, sandbox setup, and binary resolution are all interleaved. Extract into focused modules:

| Extract to | Responsibility |
| --- | --- |
| `useAcpAuth.ts` | Authentication flow (OAuth, API key, terminal fallback) |
| `useAcpSandbox.ts` | Sandbox profile generation, network proxy setup |
| `acp-binary.ts` | Binary resolution (bundled → \~/.notesage/bin → PATH) |

Leave `useAcpLifecycle.ts` as the orchestrator.

**Complexity:** L **Category:** frontend **Dependencies:** #7, #12 (same file — do bug fixes first) **Files:** `src/hooks/useAcpLifecycle.ts` + 3 new files

### #36 — Decompose local_inference.rs (1,769 lines)

**Description:** Model management, thinking tag detection, and server lifecycle are mixed. Extract:

| Extract to | Responsibility |
| --- | --- |
| `model_management.rs` | Download, delete, list, catalog queries |
| `thinking_tags.rs` | Hardcoded thinking tag parser (7 tag pairs) |

Leave `local_inference.rs` focused on server lifecycle (start, stop, health, restart).

**Complexity:** L **Category:** backend **Dependencies:** None **Files:** `src-tauri/src/commands/local_inference.rs` + 2 new modules

### #37 — Deduplicate JSON-RPC transport between copilot_lsp.rs and mcp.rs

**Description:** `copilot_lsp.rs` (1,684 lines) and `mcp.rs` both implement Content-Length framed JSON-RPC 2.0 transport independently. The shared types are already in `json_rpc.rs` but the framing/read/write logic is duplicated. Extract shared transport into `json_rpc.rs` or a new `json_rpc_transport.rs` module, then refactor both callers to use it.

**Complexity:** L **Category:** backend **Dependencies:** None **Files:** `src-tauri/src/commands/copilot_lsp.rs`, `src-tauri/src/commands/mcp.rs`, `src-tauri/src/commands/json_rpc.rs`

### #38 — Decompose acp.rs (1,481 lines)

**Description:** Auth, binary resolution, permissions, and session management are all in one file. Extract:

| Extract to | Responsibility |
| --- | --- |
| `acp_auth.rs` | Authentication methods, credential handling |
| `acp_binary.rs` | Binary resolution, version checking, sidecar detection |
| `acp_permissions.rs` | Permission request handling, approval flow |

Leave `acp.rs` focused on session lifecycle (spawn, prompt, cleanup).

**Complexity:** L **Category:** backend **Dependencies:** #2 (fix panic first) **Files:** `src-tauri/src/commands/acp.rs` + 3 new modules