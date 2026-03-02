# PRD: Expand Ollama Capabilities — Agent Tasks + Inline Completions

**Date:** 2026-03-02 **Status:** Implemented

## Problem

Ollama is currently limited to `interactive` capability only (chat + inline actions like Improve/Summarize/Expand). However, Ollama can handle two additional use cases:

1. **Agent tasks (comment delegation)** — Comment delegation is fundamentally single-turn streaming chat. The current `startTask()` in `useAgentTaskOperations.ts` hard-requires `agent_managed` auth (ACP), but the same prompt/response flow can work via direct API streaming (`ai_chat_stream`).

2. **Inline completions (FIM)** — Ollama supports Fill-in-the-Middle via `/api/generate` with a `suffix` parameter. Models like `qwen2.5-coder`, `codellama`, `deepseek-coder` support FIM natively. The existing `GhostText` Tiptap extension is fully generic — it renders any text as ghost decorations, completely decoupled from Copilot LSP.

## Solution

### Design Decisions

1. **Reuse** `ai_chat_stream` **for Ollama agent tasks** — no new Tauri command needed for chat-based delegation. Add a direct-API code path alongside the existing ACP path in task operations.
2. **New** `ollama_fim_completion` **Tauri command** — FIM requires the `/api/generate` endpoint (not `/api/chat`), with `prompt` (text before cursor) and `suffix` (text after cursor) parameters.
3. **New** `useOllamaCompletion` **hook** — mirrors `useCopilotCompletion` but uses the FIM command. Feeds into the same generic `GhostText` extension.
4. **Guard** `useCopilotCompletion` — must skip LSP start when the `inline_completion` connection is not `agent_managed` (i.e., not Copilot LSP).

### Changes

| File | Changes |
| --- | --- |
| `src/lib/ai/connections.ts` | Added `agent_tasks` and `inline_completion` to Ollama's capabilities |
| `src/hooks/useAgentTaskOperations.ts` | Added direct-API streaming path for non-`agent_managed` connections |
| `src-tauri/src/commands/ai.rs` | Added `ollama_fim_completion` command (`/api/generate` with `suffix`) |
| `src-tauri/src/lib.rs` | Registered `ollama_fim_completion` in `generate_handler![]` |
| `src/lib/tauri.ts` | Added `ollamaFimCompletion` typed wrapper |
| `src/hooks/useOllamaCompletion.ts` | New FIM completion hook (debounced, feeds `GhostText`) |
| `src/hooks/useCopilotCompletion.ts` | Guarded: only starts LSP if connection is `agent_managed` |
| `src/components/editor/Editor.tsx` | Integrated `useOllamaCompletion` alongside `useCopilotCompletion` |

### Architecture

**Agent Tasks (Direct API path):**

- `useAgentTaskOperations.startTask()` now routes based on `connection.authMethod`
- `agent_managed` connections use existing ACP path (full tool use)
- `api_key` and `local` connections use `ai_chat_stream` for single-turn streaming chat
- Same task lifecycle (activity store, callbacks) regardless of path

**Inline Completions (FIM):**

- `useOllamaCompletion` hook reads `inline_completion` connection from routing-store
- Only activates when `authMethod === 'local'` (Ollama)
- 300ms debounce (vs Copilot's 150ms) since Ollama runs locally
- Calls `ollama_fim_completion` Tauri command with prefix/suffix text
- Feeds into the same `GhostText` ProseMirror extension (Tab to accept, Escape to dismiss)
- Reuses the `copilotDisabled` per-tab toggle

**Copilot LSP Guard:**

- `useCopilotCompletion` now checks `connection.authMethod === 'agent_managed'` before starting LSP
- Non-agent-managed connections (Ollama, API key) are treated as "no connection" for this hook

## Verification

- Assign Ollama to `agent_tasks` slot in Advanced Routing -&gt; delegate a comment -&gt; agent responds via streaming chat
- Assign Ollama to `inline_completion` slot -&gt; type in editor -&gt; ghost text suggestions appear (with FIM-capable model like `qwen2.5-coder`)
- Tab accepts, Escape dismisses, per-document disable toggle works
- Copilot LSP still works when assigned to `inline_completion` (no regression)
- Existing Ollama interactive chat still works (no regression)