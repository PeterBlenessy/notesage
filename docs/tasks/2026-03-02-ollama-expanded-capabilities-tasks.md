# Tasks: Expand Ollama Capabilities — Agent Tasks + Inline Completions

**PRD:** `2026-03-02-ollama-expanded-capabilities.md`**Status:** ✅ All tasks completed

## Task 1: Update Ollama capabilities

**File:** `src/lib/ai/connections.ts`**Status:** Done

- Changed `local: ['interactive']` to `local: ['interactive', 'agent_tasks', 'inline_completion']` in `PROVIDER_CAPABILITIES`
- Updated matching entry in `PROVIDER_OPTIONS` array

## Task 2: Direct-API path for comment delegation

**File:** `src/hooks/useAgentTaskOperations.ts`**Status:** Done

- Extracted shared `setupTask()` helper for task creation and activity store registration
- Extracted ACP logic into `startAcpTask()` module-level function
- Added `startDirectApiTask()` for `api_key`/`local` connections using `ai_chat_stream`
- `startTask()` now routes based on `connection.authMethod`
- Updated `cancelTask()` to handle both ACP and direct-API tasks
- Made `InternalTask.instanceId` and `sessionId` nullable for direct-API tasks

## Task 3: Ollama FIM Tauri command

**Files:** `src-tauri/src/commands/ai.rs`, `src-tauri/src/lib.rs`, `src/lib/tauri.ts`**Status:** Done

- Added `ollama_fim_completion` Rust command calling Ollama `/api/generate` with `suffix` parameter
- `stream: false` for simplicity — FIM completions are short
- Options: `num_predict: 128`, `temperature: 0.2`, stop sequences for clean completions
- Registered in `generate_handler![]` in `lib.rs`
- Added `ollamaFimCompletion` typed wrapper in `tauri.ts`

## Task 4: Ollama completion hook

**File:** `src/hooks/useOllamaCompletion.ts` (new) **Status:** Done

- Reads `inline_completion` connection from routing-store
- Only activates when `authMethod === 'local'` (Ollama)
- 300ms debounce after typing pause
- Extracts prefix/suffix from ProseMirror doc around cursor position
- Calls `tauriApi.ollamaFimCompletion()` and feeds result to `setGhostText()`
- Request ID tracking to discard stale responses
- Respects `copilotDisabled` per-tab toggle
- Clears ghost text on tab switch

## Task 5: Editor integration

**File:** `src/components/editor/Editor.tsx`**Status:** Done

- Imported and called `useOllamaCompletion(editor)` alongside `useCopilotCompletion(editor)`
- Only one hook will be active based on the connection's auth method
- Status bar reuses existing `copilotActive` prop (driven by `copilotConnection`)

## Task 6: Guard Copilot LSP hook

**File:** `src/hooks/useCopilotCompletion.ts`**Status:** Done

- Added guard: `connection.authMethod === 'agent_managed'` check
- Non-agent-managed connections treated as null (no LSP start)
- Prevents spawning `copilot-language-server` when Ollama is assigned to inline completions