# Audit v3 Fix Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-04 |
| **Status** | Complete |
| **PRD** | [audit-v3-fixes](../prds/2026-04-04-audit-v3-fixes.md) |
| **Audit** | [2026-04-04-full](../audit/2026-04-04-full.md) |
| **Total** | 40 tasks: 19S, 14M, 7L |
| **Suggested order** | Quick wins (#1-#8) → Test-first bug fixes (#9-#19) → Compiler-driven refactors (#20-#30) → Coverage gaps (#31-#36) → Decomposition (#37-#40) |

**Risks:**

- Zustand selector refactoring (#30) touches always-visible FileTreeItem — test manually with large trees in both themes
- Rust enum migration (#22) changes IPC contract — frontend + backend must update atomically
- ACP lifecycle tests (#31) need subprocess mock harness
- Stream listener race fix (#9) changes Promise.all registration order — verify no timing assumptions

---

## Tier 1: Quick Wins (batch in one session)

### #1 — Add mounted guard to useMcpOperations listener ✅

**Description:** Add `if (!mounted) return;` at the top of the `mcp-server-status` listener callback in `useMcpOperations.ts` to skip store updates after unmount. Follow the pattern in `useSandboxViolations.ts`.

**Complexity:** S | **Category:** memory-leaks | **Dependencies:** None

**Files:** `src/hooks/useMcpOperations.ts`

---

### #2 — Add mounted guard to useActionScanner listener ✅

**Description:** Add a `mounted` flag to the `file-changed-batch` listener in `useActionScanner.ts`. Check `if (!mounted) return;` in the callback and call `fn()` immediately in the `.then()` if already unmounted.

**Complexity:** S | **Category:** memory-leaks | **Dependencies:** None

**Files:** `src/hooks/useActionScanner.ts`

---

### #3 — Fix web_search file location in tauri-commands.md ✅

**Description:** Change the section header at line \~546 from `Located in src-tauri/src/commands/ai.rs` to `Located in src-tauri/src/commands/web_search.rs`. Also add a note that tauri-commands.md covers a subset of commands — see architecture.md for full inventory.

**Complexity:** S | **Category:** documentation | **Dependencies:** None

**Files:** `docs/tauri-commands.md`

---

### #4 — Add focus-visible styling to ChatMessage plain buttons ✅

**Description:** Add `focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1` to the `<button>` elements in `ActivityLog` and `ToolCallItem` within `ChatMessage.tsx`.

**Complexity:** S | **Category:** accessibility | **Dependencies:** None

**Files:** `src/components/chat/ChatMessage.tsx`

---

### #5 — Improve disabled button contrast ✅

**Description:** In `button.tsx` and `tabs.tsx`, replace `disabled:opacity-50` with `disabled:text-muted-foreground disabled:opacity-70` (or explicit disabled color tokens) to ensure AA contrast in soft light mode.

**Complexity:** S | **Category:** accessibility | **Dependencies:** None

**Files:** `src/components/ui/button.tsx`, `src/components/ui/tabs.tsx`

---

### #6 — Add aria-live to StatusBar index progress ✅

**Description:** Wrap the IndexProgressIndicator output in `<div aria-live="polite" aria-atomic="true">` so screen readers announce completion status.

**Complexity:** S | **Category:** accessibility | **Dependencies:** None

**Files:** `src/components/editor/StatusBar.tsx`

---

### #7 — Add guidance text to Activity panel empty state ✅

**Description:** Change "No agent tasks yet" to include secondary text: "Open Chat (Cmd+Shift+C) to get started" in `ActivityStrip.tsx`.

**Complexity:** S | **Category:** error-ux | **Dependencies:** None

**Files:** `src/components/activity/ActivityStrip.tsx`

---

### #8 — Add actionable Ollama-not-running message ✅

**Description:** In `useLocalAI.ts`, when the Ollama connection fails with a connection-refused error, set a specific status reason: "Ollama not running. Start it with `ollama serve` in a terminal." instead of the generic connection error.

**Complexity:** S | **Category:** error-ux | **Dependencies:** None

**Files:** `src/hooks/useLocalAI.ts`

---

## Tier 2: Test-First Bug Fixes

**Process for each task:** (1) Write a failing test. (2) Verify it fails. (3) Implement the fix. (4) Verify the test passes.

### #9 — Fix useDirectApiChat listener registration race ✅

**Description:** The `ai-stream-done` listener is registered AFTER `Promise.all()` for other listeners. If the done event fires before attachment, cleanup never runs.

**Test first:** In `useDirectApiChat.test.ts`, add a test that emits `ai-stream-done` immediately after `ai_chat_stream` resolves (before the separate `listen` call). Assert all chunk/thinking listeners are cleaned up.

**Fix:** Move the `ai-stream-done` listener into the `Promise.all()` array with all other listeners. Remove the self-referencing `unlistenDone()` call inside the callback — use a flag instead.

**Complexity:** M | **Category:** memory-leaks | **Dependencies:** None

**Files:** `src/hooks/useDirectApiChat.ts`, `src/hooks/__tests__/useDirectApiChat.test.ts`

---

### #10 — Fix useAcpLifecycle cancel escalation listener leak ✅

**Description:** The cancel escalation listener in `acpCancelChat` can leak if the 5s timeout fires before the listener promise resolves.

**Test first:** Add a test in a new `useAcpLifecycle.test.ts` that calls `acpCancelChat`, advances timers past 5s, then verifies no dangling listeners remain.

**Fix:** Add a `cancelMounted` flag. In the `.then()` callback, if `cancelMounted` is false, call `unlisten()` immediately instead of storing it.

**Complexity:** M | **Category:** memory-leaks | **Dependencies:** None

**Files:** `src/hooks/useAcpLifecycle.ts`, `src/hooks/__tests__/useAcpLifecycle.test.ts`

---

### #11 — Add recursion depth limit to ensureAcpAgent ✅

**Description:** `ensureAcpAgent` can recurse unboundedly if multiple callers rapidly change connections. After awaiting `acpSpawnPromise`, it re-checks and may call itself again with no depth limit.

**Test first:** In a new `acp-agent-state.test.ts`, mock `acp_agent_start` to always return a mismatched connection. Call `ensureAcpAgent` and assert it throws after N retries instead of infinite recursion.

**Fix:** Add a `depth` parameter (default 0). If depth &gt; 3, throw an error: "Agent spawn failed after multiple retries."

**Complexity:** M | **Category:** async-flows | **Dependencies:** None

**Files:** `src/lib/ai/acp-agent-state.ts`, `src/lib/ai/__tests__/acp-agent-state.test.ts`

---

### #12 — Add recursion depth limit to ensureTaskAgent ✅

**Description:** Same pattern as #11 but in `useAgentTaskOperations.ts`.

**Test first:** Same approach — mock spawn to return mismatched project, assert bounded retries.

**Fix:** Add depth parameter with limit of 3.

**Complexity:** M | **Category:** async-flows | **Dependencies:** None

**Files:** `src/hooks/useAgentTaskOperations.ts`, `src/hooks/__tests__/useAgentTaskOperations.test.ts`

---

### #13 — Fix stale whisper listeners on rapid toggle ✅

**Description:** Rapid start/stop/start of dictation can leave dangling event listeners if the `listen()` promise chain fails mid-way.

**Test first:** In `useSpeechRecognition.test.ts` (or new), call `startWhisperDictation` → `stopDictation` → `startWhisperDictation` in rapid succession. Assert only one active `dictation-result` listener exists.

**Fix:** Convert the fire-and-forget `.then()` chain to `await` with try/catch. Check generation counter after each await.

**Complexity:** M | **Category:** async-flows | **Dependencies:** None

**Files:** `src/hooks/useSpeechRecognition.ts`, `src/hooks/__tests__/useSpeechRecognition.test.ts`

---

### #14 — Fix stale closure in useCommentDelegation ✅

**Description:** Delegation callbacks capture the full `comment` object. If the comment is edited between task start and completion, stale data is used.

**Test first:** In `useCommentDelegation.test.ts`, start a delegation, then update the comment's text in the store before the task completes. Assert the completion callback uses the original `comment.id` (not the full stale object).

**Fix:** Capture `comment.id` and `documentId` as separate variables at the top of the callback chain instead of closing over the full `comment` object.

**Complexity:** M | **Category:** async-flows | **Dependencies:** None

**Files:** `src/hooks/useCommentDelegation.ts`, `src/hooks/__tests__/useCommentDelegation.test.ts`

---

### #15 — Add abort signal to useDirectApiChat stream listeners ✅

**Description:** If `ai_chat_stream` completes before all listeners finish attaching, events can fire after cleanup.

**Test first:** Add a test that calls `sendChatMessage`, immediately calls cleanup (simulating rapid cancel), then emits stream events. Assert no state updates occur after cleanup.

**Fix:** Track a `cancelled` flag in the closure. Set it in cleanup. Check it at the top of each listener callback.

**Complexity:** M | **Category:** async-flows | **Dependencies:** #9

**Files:** `src/hooks/useDirectApiChat.ts`, `src/hooks/__tests__/useDirectApiChat.test.ts`

---

### #16 — Fix save failure not re-marking tab dirty ✅

**Description:** When `saveFile()` fails, the tab is NOT marked dirty. User thinks save succeeded, risking data loss.

**Test first:** In `useFileOperations.test.ts`, mock `write_file` to throw. Call `saveFile()`. Assert the tab's dirty flag is still `true` after the error.

**Fix:** In the catch block of `saveFile()`, call `markTabDirty(tabId)` before showing the error toast.

**Complexity:** M | **Category:** error-ux | **Dependencies:** None

**Files:** `src/hooks/useFileOperations.ts`, `src/hooks/__tests__/useFileOperations.test.ts`

---

### #17 — Add retry UI for direct API chat failures ✅

**Description:** Network/API errors leave chat stuck with empty assistant message. ACP has ReconnectCard but direct API does not.

**Test first:** In a test, mock `ai_chat_stream` to fail. Assert that a retry mechanism (button or resend option) is available on the failed message.

**Fix:** On stream error, set an `error` field on the assistant message. Render a "Retry" button that resends the last user message. Reuse the existing message resend logic.

**Complexity:** M | **Category:** error-ux | **Dependencies:** None

**Files:** `src/hooks/useDirectApiChat.ts`, `src/components/chat/ChatMessage.tsx`, `src/hooks/__tests__/useDirectApiChat.test.ts`

---

### #18 — Show error state in CommandPalette on index query failure ✅

**Description:** Failed index search shows "No results" instead of indicating the search itself failed.

**Test first:** Mock `indexSearchResearch` to throw. Open command palette in research mode. Assert the empty state says "Search failed" (not "No results").

**Fix:** Add an `error` state to the search modes. When catch fires, set error state. Render "Search failed — try again" in `CommandEmpty`.

**Complexity:** M | **Category:** error-ux | **Dependencies:** None

**Files:** `src/components/CommandPalette.tsx`, `src/components/__tests__/CommandPalette.test.ts`

---

### #19 — Bound file watcher debounce map growth ✅

**Description:** `modifyDebounce` and `icloudDiscoveryDebounce` maps grow without bounds under extreme file churn.

**Test first:** In `useFileWatcher.test.ts`, simulate 600 rapid file-changed events for unique paths. Assert the debounce map never exceeds the MAX_DEBOUNCE_ENTRIES threshold.

**Fix:** Add proactive size check before inserting. If at limit, flush the oldest entries instead of waiting for the reactive guard.

**Complexity:** S | **Category:** async-flows | **Dependencies:** None

**Files:** `src/hooks/useFileWatcher.ts`, `src/hooks/__tests__/useFileWatcher.test.ts`

---

## Tier 3: Compiler-Driven Refactors

**Process:** Make the change, let the compiler/linter catch errors, run existing tests.

### #20 — Migrate Tiptap storage ✅ `as any` to getEditorStorage()

**Description:** Replace 4 `as any` casts in `markdown.ts` (lines 739, 742, 754, 757) with the existing `getEditorStorage<T>()` utility from `src/lib/editor-storage.ts`.

**Complexity:** S | **Category:** type-safety | **Dependencies:** None

**Files:** `src/lib/markdown.ts`

---

### #21 — Define WebSpeechRecognition ✅ interface

**Description:** Create a `WebSpeechRecognition` interface in `useSpeechRecognition.ts` covering `start()`, `stop()`, `onresult`, `onerror`, `onend`, `continuous`, `interimResults`, `lang`. Replace 3 `as any` casts with typed construction.

**Complexity:** S | **Category:** type-safety | **Dependencies:** None

**Files:** `src/hooks/useSpeechRecognition.ts`

---

### #22 — Replace Rust stringly-typed ✅ APIs with enums

**Description:** Define enums for:

- `copilot_lsp.rs:27` — `CopilotStatusKind` (Normal, Error, Warning, Inactive)
- `watcher.rs:14` — `FileChangeKind` (Create, Modify, Delete)
- `git.rs:8` — `GitFileStatus` enum
- `actions.rs:19-20` — `ActionSourceType`, `ActionStatus` enums

Use `#[serde(rename_all = "lowercase")]` for backward-compatible JSON. Update frontend TypeScript types to match.

**Complexity:** M | **Category:** type-safety | **Dependencies:** None

**Files:** `src-tauri/src/commands/copilot_lsp.rs`, `src-tauri/src/commands/watcher.rs`, `src-tauri/src/commands/git.rs`, `src-tauri/src/commands/actions.rs`, `src/lib/ai/types.ts`, `src/hooks/useFileWatcher.ts`

---

### #23 — Add return types ✅ to public hooks

**Description:** Add explicit return type annotations to `useEditor`, `useAIContext`, `useAgentTaskOperations`, `useCommentDelegation`, and any other exported hooks in `src/hooks/` missing them.

**Complexity:** S | **Category:** type-safety | **Dependencies:** None

**Files:** `src/hooks/useEditor.ts`, `src/hooks/useAIContext.ts`, `src/hooks/useAgentTaskOperations.ts`, `src/hooks/useCommentDelegation.ts`

---

### #24 — Memoize FileTreeItem destinations ✅ array

**Description:** Wrap the `destinations` array construction (lines 428-453) in `useMemo` with dependencies `[notesRootPath, projects, explorerFolders, notesTree, currentParent, entry]`.

**Complexity:** S | **Category:** render-perf | **Dependencies:** None

**Files:** `src/components/sidebar/FileTreeItem.tsx`

---

### #25 — Extract FileTreeItem context menu ✅ callbacks

**Description:** Extract inline arrow functions in ContextMenuItem onClick handlers to `useCallback` at the component level. Priority: the setTimeout + getState() callback at line 562-568.

**Complexity:** S | **Category:** render-perf | **Dependencies:** None

**Files:** `src/components/sidebar/FileTreeItem.tsx`

---

### #26 — Memoize SidebarPanel conditional ✅ style objects

**Description:** Replace inline `style={{ left: ..., ...(isResizing && { transition: "none" }) }}` with `useMemo` or extract to className variants using `cn()`.

**Complexity:** S | **Category:** render-perf | **Dependencies:** None

**Files:** `src/components/SidebarPanel.tsx`

---

### #27 — Memoize ExplorerFolderItem ✅ isProjectFolder

**Description:** Wrap the `.some()` check at line 81-82 in `useMemo` with deps `[folderPath, projects, folder?.fileTree]`.

**Complexity:** S | **Category:** render-perf | **Dependencies:** None

**Files:** `src/components/sidebar/ExplorerFolderItem.tsx`

---

### #28 — Use selector factory ✅ for ProjectItem project lookup

**Description:** Replace `s.projects.find((p) => p.path === projectPath)` inside the selector with a stable selector factory: `const selectProject = useMemo(() => (s) => s.projects.find(...), [projectPath])`.

**Complexity:** S | **Category:** render-perf | **Dependencies:** None

**Files:** `src/components/sidebar/ProjectItem.tsx`

---

### #29 — Replace getState() in ChatFooter useMemo with selectors — SKIPPED

**Description:** The `invocableAgents`, `activeAgent`, and `toolDefs` memos call `useSkillStore.getState()` inside useMemo. Replace with proper selector subscriptions so updates are reactive.

**Complexity:** S | **Category:** render-perf | **Dependencies:** None

**Files:** `src/components/chat/ChatFooter.tsx`

---

### #30 — Lift expensive store subscriptions ✅ from FileTreeItem to parent

**Description:** Move `projects`, `explorerFolders`, `notesTree` subscriptions from individual FileTreeItem components to the parent FileTree. Pass relevant data as props. This eliminates N subscriptions (one per file) in favor of 1 subscription at the tree level.

**Complexity:** M | **Category:** render-perf | **Dependencies:** #24, #25

**Files:** `src/components/sidebar/FileTree.tsx`, `src/components/sidebar/FileTreeItem.tsx`

---

## Tier 4: Coverage Gap Tests

**Process:** These are net-new tests for untested critical paths. No code changes needed — test-only.

### #31 — Add ACP agent lifecycle tests ✅

**Description:** Create `src/lib/ai/__tests__/acp-agent-state.test.ts` (if not created in #11) and expand with tests for:

- Successful spawn + session init
- Binary not found → graceful error
- Permission request → approve → continue
- Permission request → deny → error message
- Process exit → cleanup state
- Reconnect after crash

Mock `invoke` for all `acp_*` Tauri commands.

**Complexity:** L | **Category:** test-coverage | **Dependencies:** #11

**Files:** `src/lib/ai/__tests__/acp-agent-state.test.ts`

---

### #32 — Add file watcher tests ✅

**Description:** Create `src/hooks/__tests__/useFileWatcher.test.ts` (if not expanded in #19) with tests for:

- File create → tree refresh triggered
- File modify → content comparison → reload or skip
- File delete → tab handling
- Self-write filter suppresses own changes
- Debounce coalesces rapid changes
- `.git/` and `.DS_Store` filtered out

Mock `listen` for `file-changed-batch` events and `invoke` for file operations.

**Complexity:** L | **Category:** test-coverage | **Dependencies:** #19

**Files:** `src/hooks/__tests__/useFileWatcher.test.ts`

---

### #33 — Add git command tests ✅

**Description:** Create `src-tauri/src/commands/git.rs` `#[cfg(test)]` module with tests for:

- Status parsing (modified, staged, untracked, deleted, renamed, conflicted)
- Branch detection
- Commit creation
- Error handling for non-git directories

Use `tempfile::tempdir()` + `git init` for test fixtures.

**Complexity:** M | **Category:** test-coverage | **Dependencies:** None

**Files:** `src-tauri/src/commands/git.rs`

---

### #34 — Add sandbox policy tests ✅

**Description:** Create `src-tauri/src/commands/sandbox.rs` `#[cfg(test)]` module with tests for:

- Profile generation includes `(deny default)`
- Writable paths correctly allowed
- Sensitive directories (`.ssh`, `.aws`, `.gnupg`) denied
- Network proxy-only allow rule present
- Domain matching: exact, wildcard, case-insensitive

**Complexity:** M | **Category:** test-coverage | **Dependencies:** None

**Files:** `src-tauri/src/commands/sandbox.rs`, `src-tauri/src/commands/network_proxy.rs`

---

### #35 — Add MCP server lifecycle tests ✅

**Description:** Create `src-tauri/src/commands/mcp.rs` `#[cfg(test)]` module (or expand) with tests for:

- Server spawn + initialize handshake
- Tool discovery from server
- Server crash → cleanup
- Duplicate server prevention

**Complexity:** M | **Category:** test-coverage | **Dependencies:** None

**Files:** `src-tauri/src/commands/mcp.rs`

---

### #36 — Add AI streaming edge case tests ✅

**Description:** Expand existing `ai_streaming.rs` tests and `useDirectApiChat.test.ts` with:

- Abort mid-stream → cleanup verified
- Network timeout → error surfaced
- Malformed SSE chunk → graceful skip
- Concurrent streams → second cancels first

**Complexity:** M | **Category:** test-coverage | **Dependencies:** #9, #15

**Files:** `src-tauri/src/commands/ai_streaming.rs`, `src/hooks/__tests__/useDirectApiChat.test.ts`

---

## Tier 5: Large File Decomposition (if time permits)

### #37 — Decompose ai_streaming.rs (1,603 lines) ✅

**Description:** Extract from `ai_streaming.rs`:

- `tool_execution.rs` — Tool call parsing, execution, result aggregation
- `segment_builder.rs` — Segment construction, state transitions

Keep `ai_streaming.rs` as the orchestrator (\~800 lines). Update `mod.rs` and imports.

**Complexity:** L | **Category:** decomposition | **Dependencies:** #36

**Files:** `src-tauri/src/commands/ai_streaming.rs`, `src-tauri/src/commands/tool_execution.rs`, `src-tauri/src/commands/segment_builder.rs`, `src-tauri/src/commands/mod.rs`

---

### #38 — Decompose model_management.rs (1,582 lines) ✅

**Description:** Extract per-provider model metadata fetchers into separate modules. Create `src-tauri/src/commands/model_providers/` with `openai.rs`, `anthropic.rs`, `ollama.rs`. Keep cache management in `model_management.rs`.

**Complexity:** L | **Category:** decomposition | **Dependencies:** None

**Files:** `src-tauri/src/commands/model_management.rs`, `src-tauri/src/commands/model_providers/`

---

### #39 — Decompose PptxViewer.tsx (1,088 lines) ✅

**Description:** Extract sub-components:

- `PptxSlideRenderer.tsx` (\~200 lines) — Slide canvas rendering
- `PptxSearchBar.tsx` (\~150 lines) — Search state and UI
- `PptxZoomControls.tsx` (\~100 lines) — Zoom buttons and fit modes
- `PptxChartRenderer.tsx` (\~200 lines) — Chart rendering (consolidate with ChartRenderer)

Keep PptxViewer.tsx as orchestrator (\~400 lines).

**Complexity:** M | **Category:** decomposition | **Dependencies:** None

**Files:** `src/components/editor/viewers/PptxViewer.tsx`

---

### #40 — Decompose chat-store.ts (906 lines) ✅

**Description:** Extract utility functions:

- `conversationOps.ts` — Conversation CRUD, pruning, auto-title
- `segmentOps.ts` — Segment append/update/finalize

Keep store as thin orchestrator calling utilities (\~500 lines).

**Complexity:** M | **Category:** decomposition | **Dependencies:** None

**Files:** `src/stores/chat-store.ts`, `src/lib/conversationOps.ts`, `src/lib/segmentOps.ts`