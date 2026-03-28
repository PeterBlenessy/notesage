# Local AI Tool Calling Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-28 |
| **Status** | Complete |
| **PRD** | [local-ai-tool-calling](../prds/2026-03-11-local-ai-tool-calling.md) |
| **Total** | 18 tasks: 5S, 8M, 5L |
| **Suggested order** | Types (#1-#2) → Backend streaming (#3-#7) → Frontend state (#8-#11) → Execution loop (#12-#14) → UI (#15-#18) |

**Risks:**

- Anthropic, OpenAI, and Ollama each have different tool_use response formats in SSE streams — parsing must be provider-specific and tested against real APIs
- llama-server `--jinja` flag may not be available in all bundled builds — need graceful fallback to text-based tool descriptions
- Tool execution loop (call → result → continue) changes the streaming model from single-pass to multi-turn — the frontend must accumulate tool results into the message history and re-invoke `ai_chat_stream`
- Models without native tool calling (e.g., older Llama, Phi) will silently ignore tool definitions — text-based fallback injection needs testing

---

## Phase 1: Types & Data Model

### #1 — Add tool calling types to Rust backend ✅

**Description:** Add `ToolDefinition`, `ToolCall`, and `ToolResult` structs to `ai.rs`. Extend `ChatMessage` to support `role: "tool"` and add `tool_calls: Option<Vec<ToolCall>>` and `tool_call_id: Option<String>` fields. These types are serialized/deserialized across the IPC boundary. Ensure they match the shapes in the PRD.

**Complexity:** S | **Category:** backend | **Dependencies:** None

**Files:** `src-tauri/src/commands/ai.rs`

---

### #2 — Add tool calling types to frontend ✅

**Description:** Add `ToolDefinition`, `ToolCall`, `ToolResult` interfaces to `src/lib/ai/types.ts`. Extend the `ChatMessage` interface with `toolCalls?: ToolCall[]`, `toolCallId?: string`. Add a `ToolCallActivity` type for tracking tool execution state in the UI (pending, running, complete, error, denied).

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/lib/ai/types.ts`

---

## Phase 2: Backend Streaming & Tool Parsing

### #3 — Add `tools` parameter to `ai_chat_stream` ✅

**Description:** Add `tools: Option<Vec<ToolDefinition>>` parameter to the `ai_chat_stream` Tauri command. Pass the tools array to each provider's request builder. For Anthropic: add `tools` array as-is (name, description, input_schema). For OpenAI/Ollama/local: wrap each tool in `{ type: "function", function: { name, description, parameters } }`. Register the updated command signature in `lib.rs`.

**Complexity:** M | **Category:** backend | **Dependencies:** #1

**Files:** `src-tauri/src/commands/ai.rs`, `src-tauri/src/lib.rs`

---

### #4 — Parse Anthropic tool_use blocks in streaming ✅

**Description:** In `ai_streaming.rs`, extend the Anthropic SSE parser to detect `content_block_start` events with `type: "tool_use"`. Accumulate tool call `id`, `name`, and `input` JSON across `content_block_delta` events. When `content_block_stop` fires for a tool_use block, emit a new `ai-tool-call` Tauri event with `{ id, name, arguments }`. Also handle the `message_stop` event when the model's `stop_reason` is `"tool_use"` (indicating it wants tool results before continuing). Test with Anthropic's Claude models.

**Complexity:** L | **Category:** backend | **Dependencies:** #3

**Files:** `src-tauri/src/commands/ai_streaming.rs`

---

### #5 — Parse OpenAI tool_calls in streaming ✅

**Description:** In `ai_streaming.rs`, extend the OpenAI SSE parser to detect `tool_calls` in streamed `delta` chunks. OpenAI streams tool calls as incremental JSON: `delta.tool_calls[i].function.arguments` arrives in fragments that must be concatenated. When `finish_reason: "tool_calls"` appears, emit `ai-tool-call` events for each accumulated tool call. Handle both the Chat Completions and Responses API formats.

**Complexity:** L | **Category:** backend | **Dependencies:** #3

**Files:** `src-tauri/src/commands/ai_streaming.rs`

---

### #6 — Parse Ollama and local bundled tool_calls in streaming ✅

**Description:** In `ai_streaming.rs`, extend the Ollama and local bundled (OpenAI-compatible) SSE parsers to detect tool_calls. Ollama uses the same format as OpenAI Chat Completions for tool calling (when the model supports it). For local bundled, the `/v1/chat/completions` endpoint with `--jinja` returns tool calls in OpenAI format. Reuse the OpenAI parsing logic where possible. Emit `ai-tool-call` events.

**Complexity:** M | **Category:** backend | **Dependencies:** #5

**Files:** `src-tauri/src/commands/ai_streaming.rs`

---

### #7 — Add `--jinja` flag to llama-server startup ✅

**Description:** In `local_inference.rs`, add `--jinja` to the llama-server command arguments when starting the server. This enables the Jinja2 template engine needed for native tool calling support. Only add the flag when the active model's `supports_tool_calling` is true (read from model catalog metadata). If the model doesn't support tool calling, omit the flag (no-op, saves template parsing overhead).

**Complexity:** S | **Category:** backend | **Dependencies:** None

**Files:** `src-tauri/src/commands/local_inference.rs`

---

## Phase 3: Frontend State & Tool Building

### #8 — Add skill-to-tool conversion in skill-store ✅

**Description:** Add a `skillToToolDefinition(skill: SkillEntry): ToolDefinition` function to `skill-store.ts`. Convert skill metadata (name, description) into a tool definition with `execute_skill_script` as the tool name pattern and the skill's scripts as parameters. Add a `getToolDefinitions(allowedTools?: string[]): ToolDefinition[]` method that returns all active skills as tools, filtered by the optional `allowedTools` list. Include the 4 built-in tools (read_skill_content, execute_skill_script, read_file, write_file) as constants.

**Complexity:** M | **Category:** frontend | **Dependencies:** #2

**Files:** `src/stores/skill-store.ts`

---

### #9 — Extend permission-store with tool call permissions ✅

**Description:** Add `toolCallSession: Set<string>` (non-persisted) and `toolCallAlways: string[]` (persisted) to `permission-store.ts`. Add methods: `isToolAutoAllowed(toolName)` (returns true for read_file, read_skill_content), `allowToolSession(toolName)`, `allowToolAlways(toolName)`, `isToolAllowed(toolName)` (checks auto → always → session → denied). Read-only tools are auto-allowed; write/execute tools require approval.

**Complexity:** M | **Category:** frontend | **Dependencies:** #2

**Files:** `src/stores/permission-store.ts`

---

### #10 — Add tool calling toggle to settings-store ✅

**Description:** Add `toolCallingEnabled: boolean` (default: true) to `settings-store.ts`. This is a global toggle that controls whether tools are sent with direct API chat requests. When disabled, no tools are passed to `ai_chat_stream` and no tool call events are processed.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/stores/settings-store.ts`

---

### #11 — Build tools array in useDirectApiChat ✅

**Description:** In `useDirectApiChat.ts`, before calling `ai_chat_stream`, build the tools array by calling `skill-store.getToolDefinitions()`. Filter by the active agent's `allowed-tools` if set. Check `settings-store.toolCallingEnabled` — if false, pass `tools: undefined`. Check the active connection's model for `supports_tool_calling` — if false and using local/Ollama, inject tool descriptions as text in the system prompt instead (degraded mode). Pass the tools array to the Tauri invoke call.

**Complexity:** M | **Category:** frontend | **Dependencies:** #3, #8, #10

**Files:** `src/hooks/useDirectApiChat.ts`

---

## Phase 4: Tool Execution Loop

### #12 — Handle tool call events and execute tools ✅

**Description:** In `useDirectApiChat.ts`, listen for `ai-tool-call` events during streaming. When received: (a) check permission via `permission-store.isToolAllowed()`, (b) if not allowed, show permission prompt and wait for response, (c) if denied, add a tool result message with `is_error: true` and content "Permission denied", (d) if approved, execute the tool by invoking the appropriate Tauri command (`execute_skill_script` for skills, `read_file`/`write_file` for file tools, `read_skill` for skill content), (e) add the tool result to the messages array, (f) call `ai_chat_stream` again with the full message history including the tool result to continue generation. Enforce a 20 tool call limit per turn.

**Complexity:** L | **Category:** frontend | **Dependencies:** #4, #5, #6, #9, #11

**Files:** `src/hooks/useDirectApiChat.ts`

---

### #13 — Accumulate tool calls in chat message history ✅

**Description:** Update `chat-store.ts` to handle tool call messages in the conversation history. When a tool call is made, add an assistant message with `toolCalls` field. When a tool result is received, add a message with `role: "tool"` and `toolCallId`. Ensure the full tool call/result chain is preserved in the message array so it can be sent back to the model. Tool call messages should NOT be displayed as separate chat bubbles — they're rendered as activity blocks within the assistant message.

**Complexity:** M | **Category:** frontend | **Dependencies:** #2, #12

**Files:** `src/stores/chat-store.ts`

---

### #14 — Add tool execution Tauri commands ✅

**Description:** The frontend needs to execute tools via existing Tauri commands. Verify that `execute_skill_script`, `read_file`, `write_file` are already available (they are). Add a new `read_skill_content` Tauri command in `skills.rs` that reads the full SKILL.md body and file listing for a given skill name. Register it in `lib.rs`. Create a `executeToolCall(name, args)` dispatcher function in the frontend that routes tool calls to the correct Tauri invoke.

**Complexity:** M | **Category:** both | **Dependencies:** #1

**Files:** `src-tauri/src/commands/skills.rs`, `src-tauri/src/lib.rs`, `src/hooks/useDirectApiChat.ts`

---

## Phase 5: UI

### #15 — Render tool call activity blocks in ChatMessage ✅

**Description:** In `ChatMessage.tsx`, render tool calls as collapsible activity blocks within assistant messages. States: pending (spinner + tool name), running (spinner + elapsed time), complete (checkmark + collapsible result), error (red icon + error message), denied (grey icon + "Permission denied"). Follow the visual pattern of existing ACP `AgentActivity` display. Tool arguments shown in a compact format (skill name, script, args). Tool results shown in a monospace pre block.

**Complexity:** L | **Category:** frontend | **Dependencies:** #13

**Files:** `src/components/chat/ChatMessage.tsx`

---

### #16 — Add tool call permission prompt card ✅

**Description:** Create a `ToolCallPermissionCard` component, following the exact pattern of the existing `PermissionCard.tsx` used for ACP tool approvals. Show: tool name, arguments (formatted), and three buttons: Allow (once), Allow for session (dropdown), Deny. The card appears inline in the chat stream when a tool call needs approval. Wire it to `permission-store` methods. Include a 30-second auto-deny timeout matching the domain approval pattern.

**Complexity:** L | **Category:** frontend | **Dependencies:** #9, #12

**Files:** new: `src/components/chat/ToolCallPermissionCard.tsx`, modified: `src/components/chat/ChatPanel.tsx`

---

### #17 — Add tools indicator badge in chat footer ✅

**Description:** When tools are available for the active connection and tool calling is enabled, show a "Tools" badge/count in the chat footer (e.g., "5 tools"). Clicking opens a popover listing available tools with names and one-line descriptions. Follow the existing popover pattern in the chat footer. Show "(no tool support)" note if the active model doesn't support native tool calling. Hide entirely when tool calling is disabled in settings.

**Complexity:** M | **Category:** frontend | **Dependencies:** #8, #10

**Files:** `src/components/chat/ChatInput.tsx` or `src/components/chat/ChatPanel.tsx`

---

### #18 — Add tool calling toggle to Settings UI ✅

**Description:** In the Settings dialog's Advanced section, add a "Tool Calling" toggle with description: "Allow AI to call tools and execute skills autonomously. Safe tools (read files, read skills) are auto-allowed. Script execution requires approval." Default: enabled. Bound to `settings-store.toolCallingEnabled`. Follow existing toggle patterns in SettingsDialog.

**Complexity:** S | **Category:** frontend | **Dependencies:** #10

**Files:** `src/components/settings/SettingsDialog.tsx` (or relevant settings component)