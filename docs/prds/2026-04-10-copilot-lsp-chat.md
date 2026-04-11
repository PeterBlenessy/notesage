# PRD: Copilot LSP Chat & Conversation Support

|  |  |
| --- | --- |
| **Date** | 2026-04-10 |
| **Status** | Implemented |
| **Priority** | High |
| **Impact** | Users with a Copilot subscription can use GPT-4o, Claude, Gemini, and other models for chat conversations without needing the Copilot CLI installed |
| **Research** | [docs/research/2026-04-10-copilot-lsp-chat-capabilities.md](../research/2026-04-10-copilot-lsp-chat-capabilities.md) |

## Problem

The Copilot LSP connection is forcibly restricted to inline completions only (`ConnectionsSettings.tsx:219-220` overrides capabilities to `['inline_completion']` after creation). Users with a GitHub Copilot subscription who don't have or can't use the Copilot CLI (ACP) are locked out of chat entirely — even though the `copilot-language-server` binary we already spawn has fully functional `conversation/*` JSON-RPC methods.

This is the most common frustration path: a user installs Copilot LSP, sees the model picker listing Claude and GPT-4o, but can't use them for chat. The models are right there but inaccessible.

The `conversation/*` methods are confirmed working in GitHub's own CopilotForXcode, in copilot.el (Emacs), and in Zed. We already manage the LSP process lifecycle and have JSON-RPC infrastructure for it.

## Goals

1. **Copilot LSP as a full AI provider** — users can use their Copilot subscription for interactive chat, agent tasks, and inline completions through a single connection — full feature parity with ACP and direct API paths
2. **Tool calling** — the LSP's `conversation/registerTools` and `conversation/invokeClientTool` methods enable the same tool calling experience as other providers (web search, read/write files, execute skills)
3. **Agent tasks** — comment delegation and background agent tasks work through the Copilot LSP, using the `agent_tasks` routing slot
4. **Model selection** — users can choose which Copilot model to use (GPT-4o, Claude, Gemini, etc.)
5. **Streaming responses** — chat responses stream in real-time via LSP `$/progress` mechanism
6. **Segment rendering** — responses render as chronological segments (text, thinking, tool calls, tool results) consistent with other providers
7. **Zero additional setup** — works with the existing Copilot LSP auth flow, no new processes or API keys

## Non-Goals

- **Panel completions / inline edits** — `copilotPanelCompletion` and `copilotInlineEdit` are separate future features
- **Direct Copilot API fallback** — the undocumented `api.githubcopilot.com` REST endpoint is not part of this PRD (documented as a fallback option in the research doc if needed later)
- **Replacing ACP** — the Copilot CLI ACP path continues to work for users who have it installed

## User Stories

- **As a Copilot subscriber without CLI access**, I want to use my subscription's models (Claude, GPT-4o, Gemini) for chat and agent tasks, so I don't need to set up a separate API key or install additional software.
- **As a user who added a Copilot LSP connection**, I want it to appear in all routing dropdowns (Interactive, Agent Tasks, Inline Completion), so I can use it for every AI feature.
- **As a user chatting via Copilot LSP**, I want to choose which model to use (e.g., Claude Sonnet 4, GPT-4o), so I can pick the best model for my task.
- **As a user chatting via Copilot LSP**, I want tool calling to work (web search, file read/write, skill execution), so the AI can take actions on my behalf.
- **As a user delegating a comment to an agent**, I want Copilot LSP to handle it if it's my configured agent_tasks provider, so I get the same delegation experience as with other providers.
- **As a user chatting via Copilot LSP**, I want streaming responses with thinking and tool call segments, so the experience matches other providers.

## Technical Approach

### Architecture overview

The Copilot LSP chat adds a **third AI routing path** alongside direct API and ACP:

```
useAIOperations (routing)
  ├── Direct API  (api_key, local, local_bundled connections)
  │     └── useDirectApiChat → ai_chat_stream Tauri command
  ├── ACP         (agent_managed connections with agentBinary)
  │     └── useAcpLifecycle → acp_session_prompt Tauri command
  └── Copilot LSP (agent_managed connections with lspBinary)  ← NEW
        └── useCopilotChat → copilot_lsp_conversation_* Tauri commands
```

### Routing discrimination

Currently, `useAIOperations` routes on `authMethod === 'agent_managed'`. Both ACP and Copilot LSP connections use this auth method. The discriminator is the `lspBinary` field on the connection's credentials:

```typescript
// useAIOperations.ts routing logic
if (effectiveConnection?.credentials?.lspBinary) {
  // Copilot LSP path — uses conversation/* JSON-RPC
  return copilotChatSendMessage(content, messages, opts);
} else if (effectiveConnection?.authMethod === 'agent_managed') {
  // ACP path — uses acp_session_prompt
  return acpSendChatMessage(content, messages, opts);
} else {
  // Direct API path — uses ai_chat_stream
  return directSendChatMessage(content, messages, opts);
}
```

### Backend: New Tauri commands (`copilot_lsp.rs`)

Add conversation lifecycle commands alongside existing completion commands:

```rust
/// Create a new conversation session.
/// Returns a conversation ID (workDoneToken) for tracking responses.
#[tauri::command]
pub async fn copilot_lsp_conversation_create(
    state: State<'_, CopilotLspState>,
    model: Option<String>,
) -> Result<String, String>
// Sends: conversation/create { workDoneToken }
// Returns: conversation reference ID

/// Send a user message and stream the response.
/// Emits copilot-chat-chunk / copilot-chat-thinking / copilot-chat-done events.
#[tauri::command]
pub async fn copilot_lsp_conversation_turn(
    window: tauri::Window,
    state: State<'_, CopilotLspState>,
    conversation_id: String,
    message: String,
    model: Option<String>,
) -> Result<(), String>
// Sends: conversation/turn { conversationId, message, model, workDoneToken }
// Streaming via $/progress notifications → emitted as Tauri events

/// Destroy a conversation session.
#[tauri::command]
pub async fn copilot_lsp_conversation_destroy(
    state: State<'_, CopilotLspState>,
    conversation_id: String,
) -> Result<(), String>
// Sends: conversation/destroy { conversationId }

/// List available models for chat.
#[tauri::command]
pub async fn copilot_lsp_conversation_models(
    state: State<'_, CopilotLspState>,
) -> Result<Vec<CopilotModel>, String>
// Sends: conversation/models or models/list (probe both)
```

### Streaming via `$/progress`

The LSP uses `$/progress` notifications with a `workDoneToken` to stream conversation responses. The reader loop in `copilot_lsp.rs` already handles notifications — add a handler for `$/progress`:

```rust
// In handle_server_notification:
"$/progress" => {
    if let Some(params) = params {
        let token = params.get("token");
        let value = params.get("value");
        // Map to Tauri events matching our segment model:
        // - text chunks → "copilot-chat-chunk"
        // - thinking chunks → "copilot-chat-thinking"
        // - completion → "copilot-chat-done"
    }
}
```

The exact `value` format needs to be determined by inspecting actual LSP traffic. Reference implementations:

- CopilotForXcode: `GitHubCopilotConversationServiceType` handles `ProgressParams` with content and thinking fields
- copilot.el: PR #446 processes `$/progress` with `kind: begin/report/end` and content in `message` field

### Server-to-client callbacks

The LSP sends server→client requests that need responses. Handle in `handle_server_request`:

**`conversation/context`** — server requests editor context:

```rust
"conversation/context" => {
    // Return current editor document content, selection, file path.
    // Emit a Tauri event to the frontend to collect context,
    // or return a cached version from state.
    serde_json::json!({
        "activeDocument": {
            "uri": active_file_uri,
            "content": active_file_content,
            "languageId": language_id,
        }
    })
}
```

**`conversation/invokeClientTool`** — server requests the client to execute a tool:

```rust
"conversation/invokeClientTool" => {
    // The LSP requests execution of a registered tool.
    // Emit a Tauri event to the frontend for permission check + execution.
    // The frontend handles the same permission flow as direct API tool calls
    // (auto-allow for read-only, prompt for write/execute).
    // Response must include the tool result so the LSP can continue.
    let tool_name = params.get("name");
    let tool_args = params.get("arguments");
    // → emit "copilot-tool-call" event
    // → wait for "copilot-tool-result" from frontend
    // → respond to the LSP with the result
}
```

**`conversation/invokeClientToolConfirmation`** — server requests user confirmation before tool execution:

```rust
"conversation/invokeClientToolConfirmation" => {
    // The LSP wants the user to approve a tool action before executing.
    // Emit to frontend → show ToolCallPermissionCard → respond with approval/denial.
}
```

### Tool registration

On conversation create, register our built-in tools with the LSP via `conversation/registerTools`:

```rust
// After conversation/create succeeds:
let tools = get_tool_definitions(); // same tools as direct API path
transport.send_notification("conversation/registerTools", json!({
    "conversationId": conversation_id,
    "tools": tools, // web_search, read_file, write_file, list_directory, etc.
}));
```

The LSP then decides when to invoke tools during conversation turns. Tool calls arrive as `conversation/invokeClientTool` server→client requests. The response flow is synchronous from the LSP's perspective — it waits for our tool result before continuing generation.

This maps cleanly to the existing tool calling infrastructure:
- Read-only tools (`read_file`, `list_directory`, `web_search`, `read_skill_content`) → auto-allowed
- Write/execute tools (`write_file`, `execute_skill_script`) → `ToolCallPermissionCard` with tiered approval
- Skill tools (`skill__*` prefix) → routed through `tool-executor.ts`

### Agent tasks routing

With tool calling enabled, the Copilot LSP can handle the `agent_tasks` routing slot — comment delegation and background tasks. The `useCopilotChat` hook exposes the same interface as `useAcpLifecycle` so `useAgentTaskOperations` can route to it:

```typescript
// useAgentTaskOperations.ts — add Copilot LSP path
if (connection?.credentials?.lspBinary) {
  return copilotAgentTask(comment, instructions);
} else if (connection?.authMethod === 'agent_managed') {
  return acpAgentTask(comment, instructions);
}
```

Agent tasks create a new LSP conversation per task (isolated context), run the tool loop to completion, and destroy the conversation when done. Task progress streams to the Activity panel via the same segment events.

### Frontend: New hook `useCopilotChat`

A new hook parallel to `useDirectApiChat` and `useAcpLifecycle`:

```typescript
// src/hooks/useCopilotChat.ts
export function useCopilotChat({
  effectiveConnection,
  buildComposedSystemMessage,
  composedSystemMessage,
}: CopilotChatProps) {
  const conversationIdRef = useRef<string | null>(null);

  const sendChatMessage = useCallback(async (
    content: string,
    messages: ChatMessage[],
    opts?: ChatOpts,
  ) => {
    // 1. Create conversation if none exists (or if model changed)
    if (!conversationIdRef.current) {
      conversationIdRef.current = await invoke('copilot_lsp_conversation_create', { model });
    }

    // 2. Add user message to chat store with segments
    const userMsgId = addMessage(...)
    const assistantMsgId = addMessage(...)

    // 3. Listen for streaming events
    const unlisten = await listen('copilot-chat-chunk', (event) => {
      appendTextSegment(assistantMsgId, event.payload.text);
    });
    const unlistenThinking = await listen('copilot-chat-thinking', (event) => {
      // Push thinking segment
    });
    const unlistenDone = await listen('copilot-chat-done', () => {
      finalizeSegments(assistantMsgId);
      cleanup();
    });

    // 4. Send the turn
    await invoke('copilot_lsp_conversation_turn', {
      conversationId: conversationIdRef.current,
      message: content,
      model,
    });
  }, [...]);

  const cancelChat = useCallback(() => {
    // Destroy conversation and clean up listeners
  }, []);

  return { copilotSendChatMessage: sendChatMessage, cancelCopilotChat: cancelChat };
}
```

### Capability unlock

Remove the forced capability override in `ConnectionsSettings.tsx:219-220`:

```typescript
// BEFORE (current):
if (option.lspBinary) {
  useConnectionsStore.getState().updateConnection(connectionId, { capabilities: ['inline_completion'] });
}

// AFTER:
// Remove the override entirely — use the capabilities from PROVIDER_OPTIONS as-is:
// ['interactive', 'inline_completion', 'agent_tasks']
```

Full capabilities from day one. The PROVIDER_OPTIONS already declares all three — the override was a temporary restriction that this PRD removes.

### Model discovery and selection

The Copilot LSP likely supports model listing (CopilotForXcode uses it, CopilotChat.nvim queries `/models`). Add a `copilot_lsp_conversation_models` command that probes the LSP for available models. The frontend model picker in the chat footer already supports per-connection model lists — wire it up.

If the LSP doesn't expose a model listing method directly, fall back to a hardcoded list of known Copilot models (GPT-4o, Claude Sonnet 4, Claude 3.5 Sonnet, Gemini 2.5 Pro, o4-mini) that can be updated with app releases.

### State management

- **Conversation ID**: stored per-chat in `conversationIdRef` within `useCopilotChat`. Destroyed on conversation clear/switch.
- **No new Zustand store needed** — reuses `chat-store` segments, `routing-store` for connection selection.
- **CopilotLspState**: add an optional `active_conversations: HashMap<String, ConversationState>` to track open conversations (for cleanup on LSP restart/shutdown).

## UI/UX

### No new UI components needed

The chat panel, message rendering, segment views, model picker, and routing dropdowns all exist. This feature is about wiring up a new backend path to the existing UI.

### Changes to existing UI

1. **Routing dropdowns** — Copilot LSP appears in Interactive, Agent Tasks, and Inline Completion dropdowns (currently missing from first two because capabilities are overridden)
2. **Model picker** — shows Copilot-available models when a Copilot LSP connection is selected
3. **Chat footer** — "Search" toggle hidden for Copilot LSP (web search provided via client-side tool calling instead)
4. **Connection card** — badges show "Chat", "Agent", and "Completion"
5. **Tool call segments** — tool calls and results render as collapsible segments in assistant messages (reuses existing `ToolCallSegmentView` and `ToolResultSegmentView`)
6. **Permission cards** — `ToolCallPermissionCard` appears inline for write/execute tools (same UX as direct API tool calling)

### Streaming UX

Responses stream as chronological segments identical to other providers:

- Text segments render as markdown
- Thinking segments render as collapsible muted blocks (if the LSP provides thinking content)
- Tool call segments render with descriptive labels (reuses `formatToolLabel`)
- Tool result segments render as collapsible monospace output
- The `copilot-chat-done` event triggers segment finalization

## Data Model

### New Tauri command signatures

```rust
// Conversation lifecycle
copilot_lsp_conversation_create(model: Option<String>) -> Result<String, String>
copilot_lsp_conversation_turn(window, conversation_id: String, message: String, model: Option<String>) -> Result<(), String>
copilot_lsp_conversation_destroy(conversation_id: String) -> Result<(), String>
copilot_lsp_conversation_models() -> Result<Vec<CopilotModel>, String>

#[derive(Serialize, Deserialize)]
pub struct CopilotModel {
    pub id: String,        // e.g., "gpt-4o", "claude-sonnet-4"
    pub name: String,      // e.g., "GPT-4o", "Claude Sonnet 4"
    pub provider: String,  // e.g., "openai", "anthropic"
}
```

### New Tauri events

| Event | Payload | Purpose |
| --- | --- | --- |
| `copilot-chat-chunk` | `{ text: string }` | Text delta to append |
| `copilot-chat-thinking` | `{ text: string }` | Thinking/reasoning delta |
| `copilot-chat-done` | `{}` | Stream completed |
| `copilot-tool-call` | `{ id: string, name: string, arguments: object }` | LSP requests tool execution |
| `copilot-tool-confirmation` | `{ id: string, name: string, description: string }` | LSP requests user approval |

### Connection credential changes

No changes to the `ConnectionCredentials` type. The `lspBinary` field already exists and is the routing discriminator.

### CopilotLspState changes

```rust
pub struct CopilotLspProcess {
    pub transport: json_rpc::JsonRpcTransport,
    pub child: Child,
    pub status: tokio::sync::Mutex<CopilotStatus>,
    pub pending_auth_command: tokio::sync::Mutex<Option<(String, Value)>>,
    // NEW: track active conversation sessions for cleanup
    pub active_conversations: tokio::sync::Mutex<Vec<String>>,
}
```

## Dependencies

- No new crates or npm packages
- Requires the `copilot-language-server` binary (already a dependency)
- Requires an authenticated Copilot LSP session (existing auth flow)

## Implementation Plan

### Step 1: Protocol discovery (spike)

Before writing production code, run the Copilot LSP with debug logging and probe the `conversation/*` methods to document:

- Exact parameter format for `conversation/create` and `conversation/turn`
- `$/progress` notification payload structure (text, thinking, done signals)
- `conversation/context` request format and required response
- Model listing method (if any)
- Error handling for unauthenticated or rate-limited requests

Reference: CopilotForXcode source code, copilot.el PR #446 for known parameter formats.

### Step 2: Backend conversation commands

Add `copilot_lsp_conversation_create`, `copilot_lsp_conversation_turn`, `copilot_lsp_conversation_destroy` to `copilot_lsp.rs`. Add `$/progress` handler to the reader loop. Add `conversation/context` handler to `handle_server_request`.

### Step 3: Tool calling infrastructure

Add `conversation/registerTools` call after conversation creation. Handle `conversation/invokeClientTool` and `conversation/invokeClientToolConfirmation` server→client requests in the reader loop. Bridge to the existing tool execution infrastructure (`tool-executor.ts`, permission cards).

### Step 4: Frontend hook and routing

Create `useCopilotChat` hook with tool calling support. Update `useAIOperations` routing to discriminate between ACP and Copilot LSP connections using `lspBinary`. Wire up streaming events and tool call events to segment store actions. Update `useAgentTaskOperations` to route to Copilot LSP for agent tasks.

### Step 5: Capability unlock and model picker

Remove the forced `['inline_completion']` capability override. Wire up `copilot_lsp_conversation_models` to the model picker in the chat footer.

### Step 6: Cleanup and edge cases

- Conversation cleanup on LSP restart/crash
- Conversation cleanup on chat clear
- Handle LSP not supporting `conversation/*` gracefully (e.g., older binary versions — show toast with upgrade guidance)
- Handle rate limiting and quota errors
- Agent task conversation isolation (one conversation per task)

## Quality Gates

### Functional

- [ ] Copilot LSP connection appears in Interactive, Agent Tasks, and Inline Completion routing dropdowns
- [ ] Selecting Copilot LSP for interactive allows sending chat messages
- [ ] Chat responses stream in real-time (not delivered all-at-once)
- [ ] Responses render as chronological segments (text, thinking, tool calls, tool results)
- [ ] Tool calling works: web search, read_file, write_file, list_directory, execute_skill_script, read_skill_content
- [ ] Tool call permission flow works (auto-allow read-only, prompt for write/execute)
- [ ] Comment delegation to Copilot LSP agent works (agent_tasks routing)
- [ ] Background agent tasks show progress in Activity panel
- [ ] Model picker shows available Copilot models
- [ ] Switching models mid-conversation works
- [ ] Conversation cleanup on chat clear, tab close, app quit
- [ ] Inline completions continue to work alongside chat
- [ ] Graceful error handling if LSP doesn't support conversation methods

### Testing

- [ ] Unit tests for routing discrimination (lspBinary vs agentBinary)
- [ ] Unit tests for event-to-segment mapping
- [ ] Unit tests for tool call event → tool execution → result response flow
- [ ] Rust tests for conversation command lifecycle
- [ ] Manual test: full chat conversation with Copilot LSP
- [ ] Manual test: tool calling (ask AI to search the web, read a file)
- [ ] Manual test: comment delegation via Copilot LSP
- [ ] Manual test: inline completion still works while chat is active

### Design

- [ ] Chat panel UX identical to other providers (no visual distinction needed)
- [ ] Tool call segments render with descriptive labels (same as direct API)
- [ ] Model picker shows correct models for Copilot connection
- [ ] Error states (rate limit, auth expired) show actionable toasts

## Out of Scope (Future Iterations)

- **Panel completions** — `textDocument/copilotPanelCompletion` for multi-line suggestion panels.
- **Inline edits** — `textDocument/copilotInlineEdit` for "next edit suggestions".
- **Direct Copilot API fallback** — if the LSP conversation methods prove unstable, the `api.githubcopilot.com` REST endpoint (documented in research) can be added as an OpenAI-compatible provider with token exchange.
- **Conversation persistence** — LSP conversations are ephemeral (not restored across app restarts). The chat store already persists message history; only the LSP session state is lost.