# Tasks: Copilot LSP Chat & Conversation Support

|  |  |
| --- | --- |
| **Date** | 2026-04-10 |
| **Status** | Complete |
| **PRD** | [copilot-lsp-chat](../prds/2026-04-10-copilot-lsp-chat.md) |
| **Total** | 14 tasks: 3S, 7M, 4L |
| **Suggested order** | Spike (#1) → Backend (#2-#5) → Frontend (#6-#10) → Integration (#11-#13) → Cleanup (#14) |

### Risks & open questions

- **Protocol payload format unknown** — the `$/progress` and `conversation/*` parameter shapes are undocumented. Task #1 (spike) must determine these before production code. CopilotForXcode and copilot.el are the reference implementations.
- **Tool calling flow** — `conversation/invokeClientTool` is a server→client request that blocks the LSP until we respond. The backend needs an async bridge (Tauri events + oneshot channel) to collect the tool result from the frontend. This is new infrastructure not present in the direct API or ACP paths.
- **Model listing** — the method name for listing models is unconfirmed. The spike must determine if it's `conversation/models`, `models/list`, or something else. Hardcoded fallback list is the backup plan.
- **LSP binary version compatibility** — older versions of `copilot-language-server` may not support `conversation/*`. Need graceful detection and error messaging.

---

### #1 — Protocol discovery spike ✅

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/copilot_lsp.rs` (temporary debug logging) |

**Description:** Run the Copilot LSP with verbose logging and probe the `conversation/*` methods to document the exact wire protocol. Use the existing `copilot-lsp-message` Tauri event to inspect traffic.

**Acceptance criteria:**
- [ ] Document the exact JSON-RPC params for `conversation/create`, `conversation/turn`, `conversation/destroy`
- [ ] Document the `$/progress` notification payload structure (text chunks, thinking, completion signal)
- [ ] Document the `conversation/context` server→client request format and expected response
- [ ] Document the `conversation/invokeClientTool` request format and expected response
- [ ] Document the model listing method (name and response format) or confirm it doesn't exist
- [ ] Determine if `conversation/registerTools` is a request or notification, and its parameter format
- [ ] Document error responses for common failures (not authenticated, rate limited, unsupported method)
- [ ] Write findings as a section in the research doc or as code comments

**Approach:** Add a temporary Tauri command `copilot_lsp_conversation_probe` that sends `conversation/create` with a hardcoded workDoneToken, then `conversation/turn` with a test message. Log all `$/progress` and server→client requests. Reference CopilotForXcode's `GitHubCopilotConversationServiceType` and copilot.el PR #446 for expected formats.

---

### #2 — Backend: Conversation lifecycle commands ✅

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | #1 |
| **Files** | `src-tauri/src/commands/copilot_lsp.rs`, `src-tauri/src/lib.rs` |

**Description:** Add the core conversation Tauri commands: create, turn (with streaming), destroy, and models.

**Acceptance criteria:**
- [ ] `copilot_lsp_conversation_create(model)` → sends `conversation/create`, returns conversation ID
- [ ] `copilot_lsp_conversation_turn(window, conversation_id, message, model)` → sends `conversation/turn`, streaming response emitted as Tauri events
- [ ] `copilot_lsp_conversation_destroy(conversation_id)` → sends `conversation/destroy`
- [ ] `copilot_lsp_conversation_models()` → returns list of available models (or hardcoded fallback)
- [ ] All four commands registered in `generate_handler![]` in `lib.rs`
- [ ] `CopilotLspProcess` gains `active_conversations: Vec<String>` for tracking
- [ ] Conversations cleaned up on LSP stop (`copilot_lsp_stop`)

**Pattern:** Follow the existing command pattern in `copilot_lsp.rs` — acquire state lock, get transport, send JSON-RPC request via `transport.send_request()`, await response.

---

### #3 — Backend: `$/progress` streaming handler ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #1, #2 |
| **Files** | `src-tauri/src/commands/copilot_lsp.rs` |

**Description:** Add `$/progress` handling to `handle_server_notification` in the reader loop. Map progress payloads to Tauri events for the frontend.

**Acceptance criteria:**
- [ ] `$/progress` notifications with conversation tokens are dispatched as `copilot-chat-chunk`, `copilot-chat-thinking`, or `copilot-chat-done` Tauri events
- [ ] Token matching — only emit events for known active conversation tokens (ignore unrelated progress)
- [ ] Begin/report/end lifecycle handled correctly (begin → streaming, report → chunks, end → done)
- [ ] Unknown progress token types logged at debug level (don't crash on unexpected payloads)

**Pattern:** Follow the existing `handle_server_notification` match arms. The payload format comes from spike #1.

---

### #4 — Backend: Server→client request handlers (context + tool calling) ✅

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | #1, #2 |
| **Files** | `src-tauri/src/commands/copilot_lsp.rs` |

**Description:** Handle `conversation/context`, `conversation/invokeClientTool`, and `conversation/invokeClientToolConfirmation` server→client requests in `handle_server_request`. These are blocking requests — the LSP waits for our response.

**Acceptance criteria:**
- [ ] `conversation/context` → emits `copilot-context-request` Tauri event, collects response from frontend via oneshot channel (or returns cached active document info from state)
- [ ] `conversation/invokeClientTool` → emits `copilot-tool-call` Tauri event with tool name/args, waits for tool result from frontend via oneshot channel, responds to LSP
- [ ] `conversation/invokeClientToolConfirmation` → emits `copilot-tool-confirmation` Tauri event, waits for approval/denial, responds to LSP
- [ ] Timeout handling — if the frontend doesn't respond within 60s, respond with an error to avoid deadlocking the LSP
- [ ] Add corresponding `copilot_lsp_tool_result` and `copilot_lsp_context_response` Tauri commands for the frontend to send results back

**Key design decision:** The server→client request handler runs in the reader loop (async). It needs to wait for frontend input. Use a `HashMap<String, oneshot::Sender<Value>>` on `CopilotLspProcess` to bridge: the handler inserts a sender, emits a Tauri event, the frontend calls a Tauri command that resolves the oneshot.

---

### #5 — Backend: Tool registration on conversation create ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #1, #2 |
| **Files** | `src-tauri/src/commands/copilot_lsp.rs` |

**Description:** After `conversation/create` succeeds, send `conversation/registerTools` with the same tool definitions used by the direct API path.

**Acceptance criteria:**
- [ ] Tool definitions (web_search, read_file, write_file, list_directory, execute_skill_script, read_skill_content) registered with the LSP after conversation creation
- [ ] Skill tools from `extract_skill_tools` also registered
- [ ] Tool definitions formatted per the LSP's expected schema (determined in spike #1)
- [ ] Registration failure logged but doesn't block conversation (tools just won't be available)

**Pattern:** Reuse `get_tool_definitions()` or the equivalent from `skill-store.ts` / `tool-executor.ts`. May need a new Tauri command `copilot_lsp_register_tools(conversation_id, tools)` if tool definitions come from the frontend, or build them in Rust if they're static.

---

### #6 — Frontend: `useCopilotChat` hook ✅

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #2, #3 |
| **Files** | `src/hooks/useCopilotChat.ts` (new), `src/lib/tauri.ts` |

**Description:** Create the main frontend hook for Copilot LSP chat, parallel to `useDirectApiChat` and `useAcpLifecycle`. Handles conversation lifecycle, streaming events → segment store, and tool call events.

**Acceptance criteria:**
- [ ] `sendChatMessage(content, messages, opts)` — creates conversation if needed, sends turn, streams response to segments
- [ ] `cancelChat()` — destroys conversation, cleans up event listeners
- [ ] Listens for `copilot-chat-chunk` → `appendTextSegment`
- [ ] Listens for `copilot-chat-thinking` → `pushSegment` (thinking type)
- [ ] Listens for `copilot-chat-done` → `finalizeSegments`
- [ ] Listens for `copilot-tool-call` → routes to `tool-executor.ts`, sends result back via `copilot_lsp_tool_result`
- [ ] Listens for `copilot-tool-confirmation` → shows `ToolCallPermissionCard`, sends approval/denial back
- [ ] Tool call and result segments written to chat store (same segment types as direct API)
- [ ] Conversation ID tracked per-chat, destroyed on chat clear or provider switch
- [ ] New Tauri command wrappers added to `src/lib/tauri.ts`

**Pattern:** Follow `useDirectApiChat.ts` for segment writing and event listener lifecycle. Follow `useAcpSessionListeners.ts` for the event → segment mapping pattern.

---

### #7 — Frontend: Routing update in `useAIOperations` ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #6 |
| **Files** | `src/hooks/useAIOperations.ts` |

**Description:** Add the Copilot LSP routing path alongside ACP and direct API.

**Acceptance criteria:**
- [ ] `generateText` routes to Copilot LSP when `effectiveConnection?.credentials?.lspBinary` is truthy
- [ ] `sendChatMessage` routes to Copilot LSP when `effectiveConnection?.credentials?.lspBinary` is truthy
- [ ] `cancelChat` cleans up Copilot LSP listeners when applicable
- [ ] Check order: `lspBinary` → `agent_managed` (ACP) → direct API (prevents Copilot LSP from falling into ACP path)

---

### #8 — Frontend: Agent tasks routing for Copilot LSP ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #4, #6 |
| **Files** | `src/hooks/useAgentTaskOperations.ts` |

**Description:** Add Copilot LSP as a routing option for the `agent_tasks` slot — comment delegation and background tasks.

**Acceptance criteria:**
- [ ] When the `agent_tasks` connection has `lspBinary`, use Copilot LSP conversation commands instead of ACP spawn
- [ ] Each agent task creates its own LSP conversation (isolated context)
- [ ] Task progress streams to Activity panel via segment events
- [ ] Conversation destroyed on task completion or cancellation
- [ ] Tool calling works within agent tasks (same permission flow)
- [ ] Agent task lifecycle (started → running → completed/error) tracked in `activity-store`

**Key difference from ACP path:** ACP spawns a new agent process per task. Copilot LSP reuses the single running LSP process but creates a separate conversation per task. No spawn, no auth, no sandbox — the LSP handles all of that.

---

### #9 — Frontend: Capability unlock ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None (can be done early, but chat won't work until #6-#7 are done) |
| **Files** | `src/components/settings/ConnectionsSettings.tsx` |

**Description:** Remove the forced `['inline_completion']` capability override for Copilot LSP connections.

**Acceptance criteria:**
- [ ] Remove or gate the `if (option.lspBinary)` override at line ~219-220
- [ ] Copilot LSP connections get `['interactive', 'inline_completion', 'agent_tasks']` capabilities (from `PROVIDER_OPTIONS`)
- [ ] Existing Copilot LSP connections updated on next app launch (may need a one-time migration in connections store rehydration)
- [ ] Copilot LSP appears in all three routing dropdowns

---

### #10 — Frontend: Model picker integration ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #2, #9 |
| **Files** | `src/components/chat/ChatPanel.tsx` or `ChatFooter.tsx`, `src/lib/tauri.ts` |

**Description:** Wire up `copilot_lsp_conversation_models` to the model picker in the chat footer so users can select which Copilot model to use.

**Acceptance criteria:**
- [ ] When a Copilot LSP connection is selected for interactive, the model picker queries `copilot_lsp_conversation_models`
- [ ] Available models displayed in the picker (id + display name)
- [ ] Selected model passed to `conversation/create` and `conversation/turn`
- [ ] If model listing fails, fall back to a hardcoded list of common Copilot models
- [ ] Model selection persisted per routing slot (existing `routing-store` `model` field)

**Pattern:** Follow how Ollama or local AI models are listed — the chat footer already supports dynamic model lists per provider.

---

### #11 — Frontend: Context response bridge ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #4, #6 |
| **Files** | `src/hooks/useCopilotChat.ts`, `src/lib/tauri.ts` |

**Description:** Handle `copilot-context-request` events from the backend by collecting current editor state and sending it back.

**Acceptance criteria:**
- [ ] Listen for `copilot-context-request` events
- [ ] Collect active file path, content (from ProseMirror or tab state), language ID
- [ ] Send response via `copilot_lsp_context_response` Tauri command
- [ ] Timeout gracefully if editor state is unavailable (return empty context, don't block)

---

### #12 — Existing connection migration ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #9 |
| **Files** | `src/stores/connections-store.ts` |

**Description:** Existing Copilot LSP connections have capabilities locked to `['inline_completion']`. Add a one-time migration on store rehydration to expand them.

**Acceptance criteria:**
- [ ] On rehydration, detect Copilot LSP connections with `capabilities === ['inline_completion']` and `credentials.agentBinary === 'copilot-language-server'`
- [ ] Update their capabilities to `['interactive', 'inline_completion', 'agent_tasks']`
- [ ] Migration is idempotent (safe to run multiple times)
- [ ] Log the migration for debugging

**Pattern:** Follow existing migration patterns in `connections-store.ts` rehydration (e.g., the v1 ai-store migration).

---

### #13 — Tests ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | both |
| **Dependencies** | #2, #6, #7, #8, #9 |
| **Files** | `src-tauri/src/commands/copilot_lsp.rs` (Rust tests), `src/hooks/__tests__/useCopilotChat.test.ts` (new), `src/hooks/__tests__/useAIOperations.test.ts`, `src/stores/__tests__/routing-store.test.ts` |

**Acceptance criteria:**
- [ ] **Rust:** Test conversation lifecycle (create → turn → destroy) with mock transport
- [ ] **Rust:** Test `$/progress` notification dispatch (correct events emitted for text/thinking/done)
- [ ] **Frontend:** Test routing discrimination — `lspBinary` routes to Copilot LSP, not ACP
- [ ] **Frontend:** Test event → segment mapping (chunk → text segment, thinking → thinking segment, done → finalize)
- [ ] **Frontend:** Test tool call event flow (receive tool call → execute → send result back)
- [ ] **Frontend:** Test capability migration for existing connections
- [ ] **Routing store:** Test that Copilot LSP connections appear in all three routing slots

---

### #14 — Cleanup and edge cases ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | both |
| **Dependencies** | #2, #3, #4, #6, #8 |
| **Files** | `src-tauri/src/commands/copilot_lsp.rs`, `src/hooks/useCopilotChat.ts`, `docs/bugs/2026-04-10-copilot-lsp-limited-to-inline-completion.md` |

**Description:** Handle edge cases, cleanup, and close the bug.

**Acceptance criteria:**
- [ ] Conversations cleaned up on LSP crash/restart (iterate `active_conversations`, don't leak)
- [ ] Conversation destroyed when user clears chat or switches provider
- [ ] Graceful handling if LSP doesn't support `conversation/*` (e.g., old binary version) — detect via error response to `conversation/create`, show toast with upgrade guidance
- [ ] Rate limit errors surfaced as user-visible toasts (not silent failures)
- [ ] Auth expiry during conversation handled (re-auth prompt or clear error)
- [ ] Agent task conversations isolated — one per task, destroyed on completion
- [ ] Update bug doc status to "Fixed"
- [ ] Update PRD status to "Implemented"
- [ ] Update `docs/features/ai-providers.md` and `docs/tauri-commands.md` with new commands
