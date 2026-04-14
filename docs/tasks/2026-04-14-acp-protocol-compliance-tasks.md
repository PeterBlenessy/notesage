# ACP Protocol Compliance — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-14 |
| **Status** | Not started |
| **PRD** | [acp-protocol-compliance](../prds/2026-04-14-acp-protocol-compliance.md) |
| **Audit** | [2026-04-14-acp-audit](../audits/2026-04-14-acp-audit.md) |
| **Total** | 20 tasks: 8S, 8M, 4L |
| **Suggested order** | Phase 1 Quick Wins (#1-#6) → Phase 2 Modes & Config (#7-#12) → Phase 3 Rich Streaming (#13-#18) → Phase 4 Robustness (#19-#20) |

**Risks:**

- Crate bump (#1) could introduce breaking changes in serialization — test with all four ACP agents (Claude Code, Codex, Copilot, Gemini)
- Session modes (#8-#9) depend on agents actually advertising modes — test with Claude Code which is known to support them
- Config options (#10-#12) replace hardcoded thinking effort UI — must verify backward compat for Codex

---

## Phase 1 — Quick Wins

### #1 — Bump ACP crate versions ✅

**Description:** Update `agent-client-protocol` from `0.10.4` → latest and `agent-client-protocol-schema` from `0.11.4` → latest in `Cargo.toml`. Review changelog for breaking changes. Run `cargo check` and fix any compilation issues. The `#[non_exhaustive]` design should make this largely backward-compatible.

**Complexity:** S\
**Category:** backend\
**Dependencies:** None\
**Files:**

- `src-tauri/Cargo.toml`
- `src-tauri/src/commands/acp.rs` (if any API changes)
- `src-tauri/src/commands/acp_client.rs` (if trait signature changes)

---

### #2 — Add thinking segments to chat listeners ✅

**Description:** Handle `agent_thought_chunk` events in `setupAcpChatListeners()`. When `update.sessionUpdate === 'agent_thought_chunk'` with text content, append to a `ThinkingSegment`. Follow the existing pattern in `useAgentTaskOperations.ts:317`.

Need a new `appendThinkingSegment` function in `segmentOps.ts` that appends text to the last thinking segment if it exists, or pushes a new one (mirror `appendTextSegment` but for `type: 'thinking'`). Wire it through the chat store as a new action.

**Acceptance criteria:**

- Thinking output from Claude Code, Codex, and Gemini visible in chat as collapsible thinking segments
- Auto-expanded while streaming, auto-collapsed on turn complete (already handled by `finalizeSegments`)
- `ThinkingSegmentView` renders correctly (already exists)

**Complexity:** M\
**Category:** frontend\
**Dependencies:** None\
**Files:**

- `src/lib/segmentOps.ts` — add `appendThinkingSegment()`
- `src/stores/chat-store.ts` — add `appendThinkingSegment` store action
- `src/hooks/useAcpSessionListeners.ts` — add `agent_thought_chunk` handler
- `src/hooks/useAcpSessionListeners.ts` — add `appendThinkingSegment` to `ChatListenerDeps`

---

### #3 — Handle session_info_update for conversation titles ✅

**Description:** Handle `session_info_update` events in `useAcpSessionListeners.ts`. Extract `title` and call `renameConversation()` (already exists in chat store). Only override if the agent provides a non-empty title.

Add `conversationId` to `ChatListenerDeps` (needed to call `renameConversation`).

**Acceptance criteria:**

- Conversations with ACP agents show agent-generated titles in chat history
- Empty or null titles from agents don't overwrite existing titles

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:**

- `src/hooks/useAcpSessionListeners.ts` — add handler + `conversationId` dep
- `src/hooks/useAcpLifecycle.ts` — pass `conversationId` when calling `setupAcpChatListeners`

---

### #4 — Graceful handling of unknown SessionUpdate types ✅

**Description:** Add a fallback `else` branch in the session update handler that logs unknown `sessionUpdate` values at debug level. Currently, unknown types fall through silently. After the crate bump (#1), new update types the agent sends won't crash or fail to deserialize.

Also add the same fallback in `useAgentTaskOperations.ts`.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** None\
**Files:**

- `src/hooks/useAcpSessionListeners.ts`
- `src/hooks/useAgentTaskOperations.ts`

---

### #5 — Add thinking segment to task operations (dual-write consistency) ✅

**Description:** The task operations handler at `useAgentTaskOperations.ts:317` already handles `agent_thought_chunk` for the activity store. Also push a `ThinkingSegment` to the task's message segments if the task is tracked in a chat conversation, ensuring dual-write consistency with the chat path.

**Complexity:** S\
**Category:** frontend\
**Dependencies:** #2\
**Files:**

- `src/hooks/useAgentTaskOperations.ts`

---

### #6 — Write tests for Phase 1 changes ✅

**Description:** Add unit tests for:

- `appendThinkingSegment` in segmentOps (append to existing thinking, create new thinking, interleave with text)
- `session_info_update` handling (title set, empty title ignored)
- Unknown `sessionUpdate` doesn't crash (mock event with unknown type)

Follow existing test patterns in `src/stores/__tests__/` and `src/hooks/__tests__/`.

**Complexity:** M\
**Category:** frontend\
**Dependencies:** #2, #3, #4\
**Files:**

- `src/lib/__tests__/segmentOps.test.ts` (new or extend existing)
- `src/hooks/__tests__/useAcpSessionListeners.test.ts` (new or extend existing)

---

## Phase 2 — Session Modes & Config Options

### #7 — Extend SessionResult to include modes and config options (backend)

**Description:** Modify `acp_session_new` and `acp_session_load` in `acp.rs` to extract `modes` and `config_options` from the ACP `NewSessionResponse`/`LoadSessionResponse`. Add these fields to `SessionResult` as `Option<serde_json::Value>` (pass through as JSON to avoid tightly coupling Rust types to the protocol schema).

Also extract and return `AgentCapabilities` from the initialize response as part of `SpawnResult`.

**Complexity:** M\
**Category:** backend\
**Dependencies:** #1\
**Files:**

- `src-tauri/src/commands/acp.rs` — extend `SessionResult`, `SpawnResult`, extraction in `NewSession`/`LoadSession`/init handlers

---

### #8 — Add set_mode and set_config_option Tauri commands (backend)

**Description:** Add two new Tauri commands and their `AgentCmd` variants:

1. `acp_session_set_mode(instance_id, session_id, mode_id)` → calls `conn.set_session_mode()`
2. `acp_session_set_config_option(instance_id, session_id, option_id, value_id)` → calls `conn.set_session_config_option()`

Follow the pattern of existing commands like `acp_session_cancel`. Add `SetMode` and `SetConfigOption` variants to `AgentCmd`. Register commands in `lib.rs` `generate_handler![]`.

**Complexity:** M\
**Category:** backend\
**Dependencies:** #1, #7\
**Files:**

- `src-tauri/src/commands/acp.rs` — new commands, new AgentCmd variants, command loop handlers
- `src-tauri/src/lib.rs` — register commands in `generate_handler![]`

---

### #9 — Session mode picker UI

**Description:** Add a mode picker in the chat footer. Store session modes in `acp-agent-state.ts` (new `sessionModes` and `currentModeId` fields). After `acp_session_new` returns, check for modes and store them. When user selects a mode, invoke `acp_session_set_mode`.

Handle `current_mode_update` in `useAcpSessionListeners.ts` to reflect agent-initiated mode changes.

UI: Compact dropdown chip (same style as model picker). Only visible when agent reports 2+ modes. Show mode name, description on hover.

**Per-agent mode label mapping:** Agents use modes for fundamentally different purposes:

- **Claude Code** modes = behavioral style (`code`/`architect`/`ask`)
- **Codex** modes = sandbox permission level (`read-only`/`workspace-write`/`danger-full-access`)
- **Gemini CLI** modes = approval level (`auto-approve` + others)
- **Copilot CLI** = no session modes via ACP

Only Claude Code's modes benefit from writing-friendly labels. Apply mapping **only for known Claude Code mode IDs**:

| Agent Mode ID | Notesage Label | Tooltip |
| --- | --- | --- |
| `code` | Edit | Agent can read and modify your documents |
| `architect` | Plan | Agent discusses approach without making changes |
| `ask` | Chat | Conversation only — no file access |

All other mode IDs (from Codex, Gemini, or unknown agents) show the agent's native `name` field as-is — these are already human-readable ("Read Only", "Workspace Write", etc.).

The mapping lookup should key on `(agentBinary, modeId)` so it's scoped per agent. Store the map in `acp-agent-state.ts` as a constant.

**Default mode:** When creating a new session, auto-select the agent's first mode as default. For Claude Code this is `code` ("Edit") — the most useful mode for a writing app where users expect the agent to be able to make changes.

**Visibility toggle:** Add a setting in **Settings &gt; Advanced**: "Show agent mode picker" (default: off). When off, the mode picker is hidden from the chat footer and the default mode (`code`/Edit) is used automatically. When on, the mode picker chip appears in the chat footer. Store in `settings-store` as `showAgentModePicker: boolean` (default `false`).

**Acceptance criteria:**

- Mode picker hidden by default; default mode is Edit (`code`)
- Settings toggle shows/hides the mode picker in chat footer
- When visible, mode picker appears for Claude Code (Edit/Plan/Chat)
- Labels show as Edit/Plan/Chat with descriptive tooltips
- Switching mode calls the backend command
- Agent-initiated mode changes reflected in UI
- Mode picker hidden regardless of setting for agents that don't report modes

**Complexity:** L\
**Category:** both\
**Dependencies:** #7, #8\
**Files:**

- `src/lib/ai/acp-agent-state.ts` — add mode state + label mapping utility
- `src/hooks/useAcpLifecycle.ts` — store modes from session result
- `src/hooks/useAcpSessionListeners.ts` — handle `current_mode_update`
- `src/components/chat/ChatPanel.tsx` or `ChatFooter` — mode picker UI (conditional on setting)
- `src/lib/tauri.ts` — add `acpSessionSetMode` wrapper
- `src/stores/settings-store.ts` — add `showAgentModePicker` setting
- `src/components/settings/AdvancedSettings.tsx` — add toggle

---

### #10 — Dynamic config options state and rendering

**Description:** Store `configOptions` from session creation in `acp-agent-state.ts`. Handle `config_option_update` notifications to update options dynamically.

Render config options in chat footer:

- `thinkingEffort` category → labeled dropdown adjacent to mode picker
- `model` category → skip (already handled by model picker)
- Other categories → dropdown in overflow menu

When user changes a value, invoke `acp_session_set_config_option`.

This replaces the hardcoded Codex reasoning effort suffix logic in `ensureAcpAgent()`.

**Acceptance criteria:**

- Config options from agents render as dropdowns
- Changing a value calls the backend command
- Agent-initiated changes reflected in UI
- Codex thinking effort works via config options instead of model suffix

**Complexity:** L\
**Category:** both\
**Dependencies:** #7, #8\
**Files:**

- `src/lib/ai/acp-agent-state.ts` — add config option state
- `src/hooks/useAcpLifecycle.ts` — store config options from session result
- `src/hooks/useAcpSessionListeners.ts` — handle `config_option_update`
- `src/components/chat/ChatPanel.tsx` or `ChatFooter` — config option UI
- `src/lib/tauri.ts` — add `acpSessionSetConfigOption` wrapper

---

### #11 — Replace hardcoded model flags with session/set_model

**Description:** Instead of injecting `--model <model>` or `-c model="<model>"` CLI args at spawn time per provider in `ensureAcpAgent()`, use `session/set_model` after session creation.

1. Add `acp_session_set_model` Tauri command (calls `conn.set_session_model()`)
2. After `acp_session_new`, if a model was selected and capabilities support it, call `set_model`
3. Fallback: If agent doesn't respond to `set_model`, keep current CLI arg injection

Remove the provider-specific model flag branching (`--model` vs `-c model=`).

**Complexity:** M\
**Category:** both\
**Dependencies:** #1, #7\
**Files:**

- `src-tauri/src/commands/acp.rs` — new `acp_session_set_model` command + AgentCmd variant
- `src-tauri/src/lib.rs` — register command
- `src/lib/ai/acp-agent-state.ts` — remove per-provider model flag logic, add post-session model set
- `src/hooks/useAcpLifecycle.ts` — call set_model after session creation

---

### #12 — Write tests for Phase 2 changes

**Description:** Add unit tests for:

- Mode state management (set modes, update current mode, clear on session end)
- Config option state management (set options, update selected value)
- `current_mode_update` and `config_option_update` event handling
- Fallback behavior when agent doesn't support modes/config

**Complexity:** M\
**Category:** frontend\
**Dependencies:** #9, #10, #11\
**Files:**

- `src/lib/__tests__/acp-agent-state.test.ts` (new or extend)
- `src/hooks/__tests__/useAcpSessionListeners.test.ts`

---

## Phase 3 — Rich Streaming Data

### #13 — Usage tracking display

**Description:** Parse `usage_update` events in `useAcpSessionListeners.ts`. Store in a per-conversation usage accumulator on the chat store or a lightweight reactive ref.

Display in chat footer: "4.2K / 200K tokens" with cost on hover tooltip. Format numbers with `Intl.NumberFormat`. Use `text-muted-foreground` — unobtrusive.

Also parse per-turn `Usage` from `PromptResponse` if available (inputTokens, outputTokens).

**Acceptance criteria:**

- Token usage shown in chat footer during ACP sessions
- Cost shown on hover when agent provides it
- Updates live during streaming
- Hidden when no usage data available

**Complexity:** M\
**Category:** both\
**Dependencies:** #1\
**Files:**

- `src/hooks/useAcpSessionListeners.ts` — handle `usage_update`
- `src/stores/chat-store.ts` or new lightweight store — usage accumulator
- `src/components/chat/ChatPanel.tsx` — usage indicator in footer
- `src/lib/ai/types.ts` — usage types

---

### #14 — Agent plan display (PlanSegment)

**Description:** Add `PlanSegment` to the `Segment` union type. Handle `plan` session updates in listeners — plans are full replacements, so update the last plan segment rather than appending.

Create `PlanSegmentView.tsx`: collapsible card with header "Plan" + entry count badge. Entries show status icon (circle/spinner/check) + priority dot + text. Auto-expanded during streaming, collapsed after turn complete.

**Acceptance criteria:**

- Plans from Claude Code render as collapsible entries in chat
- Plan updates replace previous plan (not accumulate)
- Status and priority indicators visible
- Collapses on turn complete

**Complexity:** L\
**Category:** frontend\
**Dependencies:** None\
**Files:**

- `src/lib/ai/types.ts` — add `PlanSegment`, `PlanEntry`
- `src/lib/segmentOps.ts` — add `updateOrPushPlanSegment()`
- `src/stores/chat-store.ts` — expose plan segment action
- `src/hooks/useAcpSessionListeners.ts` — handle `plan` update
- `src/components/chat/segments/PlanSegmentView.tsx` — new component
- `src/components/chat/ChatMessage.tsx` — render `PlanSegment` in `SegmentRenderer`

---

### #15 — Rich tool call updates (status, locations, rawOutput)

**Description:** Expand `tool_call_update` handling beyond label-only:

1. **Status mapping:** Map ACP `status` field to segment status (`pending`/`in_progress` → `running`, `completed` → `done`, `failed` → `error`)
2. **Locations:** Add `locations?: { path: string; line?: number }[]` to `ToolCallSegment`. Render file paths as clickable links in `ToolCallSegmentView` that open the file via the same navigation logic as `link-utils.ts`.
3. **rawOutput:** Store on the following `ToolResultSegment` when available

Update the `tool_call_update` handler to find the corresponding segment by `toolCallId` and patch all changed fields.

**Complexity:** M\
**Category:** frontend\
**Dependencies:** None\
**Files:**

- `src/lib/ai/types.ts` — add `locations` to `ToolCallSegment`
- `src/hooks/useAcpSessionListeners.ts` — expand `tool_call_update` handler
- `src/components/chat/segments/ToolCallSegmentView.tsx` — clickable file locations
- `src/components/chat/segments/ToolResultSegmentView.tsx` — show rawOutput

---

### #16 — Agent slash command passthrough

**Description:** Handle `available_commands_update` events. Store commands in `acp-agent-state.ts` as `availableCommands: { name, description, inputHint? }[]`.

Surface in ChatInput's skill menu when user types `/`:

- New section "Agent Commands" below "Notesage Skills"
- Agent commands show description and input hint
- Selection inserts `/command `into input text
- Commands sent as normal prompt text (agents parse `/command arg` from prompt)

Update command list when new `available_commands_update` arrives.

**Complexity:** L\
**Category:** frontend\
**Dependencies:** None\
**Files:**

- `src/lib/ai/acp-agent-state.ts` — add `availableCommands` state
- `src/hooks/useAcpSessionListeners.ts` — handle `available_commands_update`
- `src/components/chat/ChatInput.tsx` — integrate agent commands into skill menu
- `src/components/chat/SkillMenu.tsx` (or equivalent) — agent command section

---

### #17 — Write tests for Phase 3 changes

**Description:** Add unit tests for:

- `usage_update` parsing and accumulation
- `PlanSegment` creation, replacement, and finalization
- `PlanSegmentView` rendering (entries, status icons, collapse behavior)
- Rich `tool_call_update` handling (status mapping, locations, rawOutput)
- `available_commands_update` state management

**Complexity:** M\
**Category:** frontend\
**Dependencies:** #13, #14, #15, #16\
**Files:**

- `src/lib/__tests__/segmentOps.test.ts`
- `src/hooks/__tests__/useAcpSessionListeners.test.ts`
- `src/components/chat/segments/__tests__/PlanSegmentView.test.tsx` (new)

---

### #18 — Update docs for new ACP features

**Description:** Update documentation to reflect new ACP capabilities:

- `docs/features/ai-providers.md` — update ACP section with modes, config options, usage tracking
- `docs/features/ai-workflows.md` — update chat panel features list, add plan display and slash commands
- `docs/keyboard-shortcuts.md` — if any new shortcuts added
- `docs/audits/2026-04-14-acp-audit.md` — update status column for implemented features

**Complexity:** S\
**Category:** frontend\
**Dependencies:** #6, #12, #17\
**Files:**

- `docs/features/ai-providers.md`
- `docs/features/ai-workflows.md`
- `docs/audits/2026-04-14-acp-audit.md`

---

## Phase 4 — Robustness

### #19 — Capability checking before gated methods

**Description:** Before calling capability-gated methods, check the agent's advertised capabilities (returned from #7):

| Method | Guard |
| --- | --- |
| `session/load` | `agentCapabilities.loadSession === true` |
| `session/set_mode` | `modes` present in session response |
| `session/set_model` | `agentCapabilities` supports it |
| Config options | `configOptions` non-empty in session response |

Store capabilities in `AgentHandle` (backend) and pass to frontend via extended `SpawnResult`. Frontend uses capabilities to conditionally show UI elements (mode picker, config options) and guard method calls.

**Complexity:** S\
**Category:** both\
**Dependencies:** #7\
**Files:**

- `src-tauri/src/commands/acp.rs` — guard `session/load` calls
- `src/lib/ai/acp-agent-state.ts` — store capabilities, guard UI decisions
- `src/hooks/useAcpLifecycle.ts` — check `loadSession` before reconnect

---

### #20 — Cancel contract compliance

**Description:** Verify and fix the cancel flow to comply with ACP spec: when sending `cancel`, the client MUST respond `Cancelled` to all pending `session/request_permission` requests.

Currently, the frontend denies pending permissions via `acp_permission_respond` with `optionId: null`. Verify this maps to `RequestPermissionOutcome::Cancelled` in the backend. If `optionId: null` maps to `Cancelled` (check `acp.rs` PermissionRespond handler), this is already correct. If not, add a dedicated `cancelled: true` field to the respond command.

Also ensure the permission waiters in `acp_client.rs` are all drained with `Cancelled` when the agent thread receives `Stop` or `Cancel`.

**Complexity:** S\
**Category:** both\
**Dependencies:** None\
**Files:**

- `src-tauri/src/commands/acp.rs` — verify PermissionRespond with null optionId → Cancelled
- `src-tauri/src/commands/acp_client.rs` — verify waiter drain on Stop
- `src/hooks/useAcpLifecycle.ts` — verify cancel denies all pending with correct outcome