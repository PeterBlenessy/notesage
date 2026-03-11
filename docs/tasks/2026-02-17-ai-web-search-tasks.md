# AI Web Search — Implementation Tasks

**Status:** ✅ Complete

**PRD:** [2026-02-17-ai-web-search.md](2026-02-17-ai-web-search.md)**Total:** 13 tasks — 4S, 6M, 3L — All complete **Suggested order:** Backend cleanup (#1) → Anthropic streaming rewrite (#2) → frontend state/types (#3, #4) → search toggle UI (#5) → citation display (#6) → wire up frontend (#7) → OpenAI migration (#8, #9) → Ollama guard (#10) → non-streaming commands (#11) → testing (#12) → docs (#13)

**Risks / open questions:**

- Anthropic `web_search_20260209` requires `anthropic-beta: code-execution-web-tools-2026-02-09` header — need to confirm this doesn't change other response behavior
- OpenAI Responses API has a completely different streaming format — this is the highest-risk task
- Multi-turn conversations with Anthropic web search require passing back `encrypted_content` / `encrypted_index` fields — need to verify how this works with our message store (which only stores `content` strings)

---

### #1 ✅ DONE — Remove DuckDuckGo tool infrastructure

**Description:** Delete `src-tauri/src/commands/tools.rs` entirely. Remove all imports/references to `tools` from `ai_streaming.rs` and `mod.rs`. Remove the `urlencoding` crate from `Cargo.toml` (only used in `tools.rs`). Verify the project compiles after removal.

**Complexity:** S **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/src/commands/tools.rs` — delete
- `src-tauri/src/commands/mod.rs` — remove `pub mod tools;`
- `src-tauri/src/commands/ai_streaming.rs` — remove `use super::tools::*` import line and all references to `tools_to_anthropic_format`, `tools_to_openai_format`, `execute_tool`, `ToolCall`
- `src-tauri/Cargo.toml` — remove `urlencoding` dependency

---

### #2 ✅ DONE — Rewrite Anthropic streaming with server-side web search

**Description:** Rewrite `anthropic_chat_stream()` in `ai_streaming.rs` to:

 1. Accept a `web_search_enabled: bool` parameter
 2. When enabled, include `{"type": "web_search_20260209", "name": "web_search", "max_uses": 5}` in the `tools` array and add `anthropic-beta: code-execution-web-tools-2026-02-09` header
 3. Switch from non-streaming request + character-by-character emit to actual SSE streaming (`"stream": true`)
 4. Parse SSE events: `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`
 5. Handle `server_tool_use` blocks — emit `ai-tool-use` event with `"web_search"` when detected
 6. Handle `web_search_tool_result` blocks — no local execution needed
 7. Extract citations from text blocks that have `citations` array — emit `ai-citation` events
 8. Handle `pause_turn` stop reason (continue the conversation automatically)
 9. Remove the old tool execution loop (`execute_tool` calls, manual tool_result injection)
10. When `web_search_enabled` is false, omit the tools array entirely (current behavior minus DuckDuckGo)

**Acceptance criteria:** Anthropic chat works with and without search. Streaming is real SSE, not character-by-character. Citations are emitted as events. "Searching the web..." indicator fires.

**Complexity:** L **Category:** backend **Dependencies:** #1 **Files:**

- `src-tauri/src/commands/ai_streaming.rs` — rewrite `anthropic_chat_stream()`

---

### #3 ✅ DONE — Add `webSearchEnabled` to chat store

**Description:** Add `webSearchEnabled: boolean` (default `false`) and `setWebSearchEnabled` action to the chat store. Include in persistence. Add `citations` support to `updateMessage` — allow updating citations alongside content.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/stores/chat-store.ts`

---

### #4 ✅ DONE — Extend ChatMessage type with citations

**Description:** Add `Citation` interface and optional `citations` field to `ChatMessage` type. Update `updateMessage` in chat store to accept and store citations.

```typescript
interface Citation {
  url: string;
  title: string;
  citedText: string;
}
```

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/ai/types.ts`

---

### #5 ✅ DONE — Add search toggle to chat input footer

**Description:** Add a Globe icon toggle button to the chat input footer in `ChatPanel.tsx`, positioned after the project selector and before the goals indicator.

- Use `Globe` from lucide-react
- Label: "Search"
- Click toggles `webSearchEnabled` in chat store
- Active state: `foreground` color; inactive: `muted-foreground`
- Disabled with tooltip when provider is `ollama` or no provider configured
- When clicked while Ollama is selected, show toast: "Web search is not yet available for Ollama. Please use Anthropic or OpenAI for search."
- Match existing footer button styling (persona selector pattern)
- 150ms transition on state change

**Complexity:** M **Category:** frontend **Dependencies:** #3 **Files:**

- `src/components/chat/ChatPanel.tsx`

---

### #6 ✅ DONE — Display citations in chat messages

**Description:** Update `ChatMessage.tsx` to render citations when present on a message:

- After the markdown content, if `message.citations` is non-empty, render a "Sources" section
- Each source shows: numbered list with title and URL
- URLs are clickable — use Tauri's `opener` plugin to open in system browser
- Style: small text, muted foreground, separator line above sources
- Links styled with underline on hover, `--color-primary` color
- Works in both light and dark mode

**Complexity:** M **Category:** frontend **Dependencies:** #4 **Files:**

- `src/components/chat/ChatMessage.tsx`

---

### #7 ✅ DONE — Wire up frontend to pass search flag and handle citation events

**Description:** Update `useAIOperations.ts` to:

1. Read `webSearchEnabled` from chat store
2. Pass it to the `ai_chat_stream` Tauri command as `webSearchEnabled` parameter
3. Listen for `ai-citation` events — accumulate citations and call `updateMessage` with them
4. Update the Tauri `invoke` call signature

Update `ai.rs` `ai_chat_stream` command to accept and forward the new `web_search_enabled` parameter to the provider-specific streaming functions.

**Complexity:** M **Category:** both **Dependencies:** #2, #3, #4 **Files:**

- `src/hooks/useAIOperations.ts`
- `src-tauri/src/commands/ai.rs` — update `ai_chat_stream` signature

---

### #8 ✅ DONE — Migrate OpenAI to Responses API (non-search)

**Description:** Rewrite `openai_chat_stream()` to use the Responses API (`/v1/responses`):

1. Change endpoint from `/v1/chat/completions` to `/v1/responses`
2. Update request format: messages go in `input` field, model updated to `gpt-4o`
3. Update SSE parsing for new event types: `response.output_text.delta`, `response.completed`, etc.
4. Emit `ai-stream-chunk` and `ai-stream-done` events as before
5. Also update `openai_generate()` and `openai_chat()` in `ai.rs` to use `/v1/responses` and `gpt-4o`

**Acceptance criteria:** OpenAI chat works with the Responses API without search. Streaming is functional. No regressions in basic conversation.

**Complexity:** L **Category:** backend **Dependencies:** #1 **Files:**

- `src-tauri/src/commands/ai_streaming.rs` — rewrite `openai_chat_stream()`
- `src-tauri/src/commands/ai.rs` — update `openai_generate()`, `openai_chat()`

---

### #9 ✅ DONE — Add OpenAI web search support

**Description:** Extend the rewritten `openai_chat_stream()` to support web search:

1. Accept `web_search_enabled: bool` parameter
2. When enabled, include `{"type": "web_search", "search_context_size": "medium"}` in tools array
3. Parse search-related events from the Responses API stream
4. Extract citations/annotations from the response and emit `ai-citation` events
5. Emit `ai-tool-use` event when search is in progress

**Complexity:** M **Category:** backend **Dependencies:** #8 **Files:**

- `src-tauri/src/commands/ai_streaming.rs`

---

### #10 ✅ DONE — Ollama search guard

**Description:** Update `ollama_chat_stream()` to accept the `web_search_enabled` parameter (ignore it). The frontend toggle disabling + toast (task #5) handles the UX. The backend should just log a warning if it somehow receives `web_search_enabled: true` for Ollama and proceed without search.

**Complexity:** S **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/src/commands/ai_streaming.rs` — update `ollama_chat_stream` signature

---

### #11 ✅ DONE — Update non-streaming AI commands

**Description:** Update `ai_chat()` and `ai_generate_text()` in `ai.rs` to remove any references to the deleted tools module. These non-streaming commands don't support web search (search is streaming-only), but they must compile after the tools removal. Also update the model strings:

- Anthropic: keep `claude-sonnet-4-5-20250929`
- OpenAI: update from `gpt-4-turbo-preview` to `gpt-4o`

**Complexity:** M **Category:** backend **Dependencies:** #1 **Files:**

- `src-tauri/src/commands/ai.rs`

---

### #12 ✅ DONE — End-to-end testing

**Description:** Manual testing checklist (no automated tests for API calls):

1. Anthropic with search off — basic chat works, no tool events
2. Anthropic with search on — AI searches when appropriate, citations appear, "Searching the web..." shows
3. Anthropic multi-turn with search — follow-up questions use search context
4. OpenAI with search off — basic chat works via Responses API
5. OpenAI with search on — AI searches, citations appear
6. Ollama — search toggle disabled, toast shown, basic chat works
7. Toggle persistence — search state survives app restart
8. No provider configured — search toggle disabled
9. Error handling — API errors surface correctly as toast/inline errors

**Complexity:** M **Category:** both **Dependencies:** #2, #5, #6, #7, #8, #9, #10 **Files:** None (manual testing)

---

### #13 ✅ DONE — Update documentation

**Description:** Update project documentation to reflect changes:

- `docs/future-phases.md` — move "Web search integration" from remaining to completed under Phase 3
- `docs/architecture.md` — update AI Operations data flow, note Responses API for OpenAI, remove tool execution mention
- `docs/tauri-commands.md` — update `ai_chat_stream` signature with new `web_search_enabled` param
- `CLAUDE.md` — no changes needed (version bump happens at release)

**Complexity:** M **Category:** both **Dependencies:** #12 **Files:**

- `docs/future-phases.md`
- `docs/architecture.md`
- `docs/tauri-commands.md`