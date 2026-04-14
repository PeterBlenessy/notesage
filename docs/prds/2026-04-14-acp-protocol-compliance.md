# PRD: ACP Protocol Compliance & Feature Expansion

|  |  |
| --- | --- |
| **Date** | 2026-04-14 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Closes 60% ACP feature gap — thinking in chat, session modes, usage tracking, dynamic config, richer tool call display |
| **Audit** | [2026-04-14-acp-audit.md](../audits/2026-04-14-acp-audit.md) |
| **Tasks** | [acp-protocol-compliance-tasks](../tasks/2026-04-14-acp-protocol-compliance-tasks.md) |

## Problem

The ACP audit reveals that Notesage implements **41% of the ACP specification** (24 of 59 features). The core happy path works — spawn, authenticate, stream, permissions — but significant protocol surface is unused or hardcoded:

1. **Thinking/reasoning content from ACP agents is silently dropped in chat.** `agent_thought_chunk` events are handled in background task operations but completely missing from the interactive chat listeners. Users see no thinking output from Claude Code or Codex in the primary chat panel.

2. **Session modes (code/architect/ask) are inaccessible.** Claude Code supports three operating modes, but there's no UI to switch between them. Users must restart the agent to change modes.

3. **Usage data flows through the system and is discarded.** The `unstable_session_usage` feature flag is enabled, `usage_update` events arrive, but nothing reads them. Users have zero visibility into token usage or cost.

4. **Provider-specific logic is hardcoded where ACP provides dynamic alternatives.** Model flag format (`--model` vs `-c model=`), reasoning effort (Codex suffix), and config options are all special-cased per provider instead of using `session/set_model` and `session/set_config_option`.

5. **Tool call updates are shallow.** Only the label is updated — status transitions, file locations, rawOutput, and diff content are ignored.

6. **ACP crate versions are behind** (v0.10.4/v0.11.4 vs latest v0.11.6), risking deserialization failures on unknown `SessionUpdate` variants.

## Goals

1. **Raise ACP feature coverage to 70%+** by implementing all stable protocol features that have user-facing impact
2. **Eliminate hardcoded provider logic** by using ACP-native mechanisms for model selection, config options, and thinking effort
3. **Surface all streaming data** — thinking, plans, usage, session titles — that agents already send
4. **Improve robustness** — graceful handling of unknown update types, capability checking, crate version currency
5. **Establish extensibility** — dynamic config rendering and slash command passthrough so new agent features work without Notesage code changes

## Non-Goals

- Client FS/terminal capabilities (`fs/read_text_file`, `terminal/create`, etc.) — high effort, separate PRD
- NES (Next Edit Suggestions) — unstable, architectural overlap with Copilot LSP
- Elicitation — unstable, low priority
- Session forking/resuming — unstable, niche use case
- Audio content blocks — no current agent sends these
- MCP server passthrough to ACP sessions — separate PRD

## User Stories

1. **As a user chatting with Claude Code**, I want to see its thinking/reasoning output so I can understand its approach before it starts making changes.

2. **As a user working with Claude Code**, I want to switch between code, architect, and ask modes without restarting the agent so I can adapt the conversation style to my current need.

3. **As a user monitoring cost**, I want to see token usage and cost per conversation so I can understand what my agent sessions cost.

4. **As a user watching an agent work**, I want to see its execution plan so I know what steps it intends to take before it starts.

5. **As a power user**, I want to use agent-specific slash commands (like `/compact` or `/clear`) directly from the chat input.

6. **As a user**, I want the conversation title from the agent to be used in my chat history rather than Notesage's auto-generated one.

## Technical Approach

### Phase 1 — Quick Wins (no architectural changes)

**1.1 Thinking segments in chat**

Add `agent_thought_chunk` handling to `setupAcpChatListeners()` in `useAcpSessionListeners.ts`. Push a `ThinkingSegment` — the type and `ThinkingSegmentView` renderer already exist.

```typescript
} else if (update.sessionUpdate === 'agent_thought_chunk' && update.content?.type === 'text' && update.content.text) {
  deps.pushOrAppendThinkingSegment(deps.assistantMessageId, update.content.text);
}
```

Need a new store action `pushOrAppendThinkingSegment` that appends to the last thinking segment if it exists, or creates a new one. Mirror the pattern in `useAgentTaskOperations.ts:317`.

**Files:** `src/hooks/useAcpSessionListeners.ts`, `src/stores/chat-store.ts`, `src/lib/segmentOps.ts`

**1.2 Crate version bump**

Bump `agent-client-protocol` from `0.10.4` → latest and `agent-client-protocol-schema` from `0.11.4` → latest in `Cargo.toml`. Review changelog. The `#[non_exhaustive]` design should make this backward-compatible.

**Files:** `src-tauri/Cargo.toml`

**1.3 Session info titles**

Handle `session_info_update` in `useAcpSessionListeners.ts`. Extract `title` and update `conversation.title` in chat store. Only override if the agent provides a non-empty title.

```typescript
} else if (update.sessionUpdate === 'session_info_update' && update.title) {
  useChatStore.getState().updateConversationTitle(deps.conversationId, update.title);
}
```

**Files:** `src/hooks/useAcpSessionListeners.ts`, `src/stores/chat-store.ts`

**1.4 Graceful unknown update handling**

Wrap the session update handler in a try-catch or add a fallback `else` branch that logs unknown `sessionUpdate` values at debug level instead of silently dropping or crashing.

**Files:** `src/hooks/useAcpSessionListeners.ts`, `src/hooks/useAgentTaskOperations.ts`

### Phase 2 — Session Modes & Config Options

**2.1 Extract modes and config from session/new response**

Modify `acp_session_new` (Rust) to return `modes` and `config_options` from `NewSessionResponse` alongside `session_id` and models. Add these fields to `SessionResult`.

```rust
pub struct SessionResult {
    pub session_id: String,
    pub current_model: Option<String>,
    pub available_models: Vec<AgentModelInfo>,
    pub modes: Option<SessionModeState>,        // NEW
    pub config_options: Vec<SessionConfigOption>, // NEW
}
```

**Files:** `src-tauri/src/commands/acp.rs`

**2.2 Session mode picker UI**

Add a mode picker in the chat footer (next to the model picker). Show available modes as a dropdown. When the user selects a mode, call a new `acp_session_set_mode` Tauri command.

New Tauri command:

```rust
#[tauri::command]
pub async fn acp_session_set_mode(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    mode_id: String,
) -> Result<(), String>
```

Handle `current_mode_update` notifications to reflect agent-initiated mode changes.

**State:** Add `sessionModes` and `currentModeId` to `acp-agent-state.ts` or a new store.

**Files:** `src-tauri/src/commands/acp.rs`, `src/lib/ai/acp-agent-state.ts`, `src/components/chat/ChatFooter.tsx` (or equivalent), `src/hooks/useAcpSessionListeners.ts`

**2.3 Dynamic config options**

Replace hardcoded thinking effort UI with dynamic config rendering:

1. Store `configOptions` from session creation
2. Render config options as dropdown/toggle in chat footer based on `SessionConfigOption` metadata (id, name, values, category)
3. Call `acp_session_set_config_option` when values change
4. Handle `config_option_update` notifications for agent-initiated changes

New Tauri command:

```rust
#[tauri::command]
pub async fn acp_session_set_config_option(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    option_id: String,
    value_id: String,
) -> Result<(), String>
```

This replaces the hardcoded Codex reasoning effort suffix (`model/low`, `model/high`, etc.) with the ACP-native mechanism.

**Files:** `src-tauri/src/commands/acp.rs`, `src/lib/ai/acp-agent-state.ts`, `src/components/chat/ChatFooter.tsx`, `src/hooks/useAcpSessionListeners.ts`

**2.4 Replace hardcoded model flags with session/set_model**

Instead of injecting `--model <model>` or `-c model="<model>"` at spawn time per provider, use the ACP `session/set_model` method (already feature-flagged) to set the model after session creation.

Fallback: If the agent doesn't support `set_model` (check capabilities), fall back to current CLI arg injection.

**Files:** `src/lib/ai/acp-agent-state.ts`, `src-tauri/src/commands/acp.rs`

### Phase 3 — Rich Streaming Data

**3.1 Usage tracking display**

Parse `usage_update` events in both chat and task listeners. Store in a per-conversation usage accumulator.

```typescript
interface ConversationUsage {
  contextUsed: number;   // tokens currently in context
  contextSize: number;   // total context window
  totalCost?: { amount: number; currency: string };
}
```

Display in chat footer: "4.2K / 200K tokens" with optional cost badge. Per-turn usage (inputTokens, outputTokens) shown in message metadata on hover.

**Files:** `src/hooks/useAcpSessionListeners.ts`, `src/stores/chat-store.ts`, `src/components/chat/ChatFooter.tsx`, `src/components/chat/ChatMessage.tsx`

**3.2 Agent plan display**

Handle `plan` session updates. Render as a collapsible segment in the chat stream showing plan entries with priority and status indicators.

New segment type:

```typescript
interface PlanSegment {
  type: 'plan';
  entries: { content: string; priority: 'high' | 'medium' | 'low'; status: 'pending' | 'in_progress' | 'completed' }[];
  timestamp: number;
}
```

Plans are full replacements — update the last plan segment rather than appending a new one.

**Files:** `src/lib/ai/types.ts`, `src/hooks/useAcpSessionListeners.ts`, `src/components/chat/segments/PlanSegmentView.tsx`

**3.3 Rich tool call updates**

Expand `tool_call_update` handling beyond label-only:

1. **Status:** Map `status` field to segment status (pending → running, in_progress → running, completed → done, failed → error)
2. **Locations:** Store `locations` array on the tool call segment. Render file paths as clickable links that open the file in a tab and scroll to the line.
3. **rawOutput:** Store and display in a collapsible section on the tool result segment
4. **Diff content:** If `content` includes a `diff` entry, render with the existing `InlineDiff` decoration view or a simplified diff component

**Files:** `src/hooks/useAcpSessionListeners.ts`, `src/lib/ai/types.ts`, `src/components/chat/segments/ToolCallSegmentView.tsx`, `src/components/chat/segments/ToolResultSegmentView.tsx`

**3.4 Agent slash command passthrough**

Handle `available_commands_update` events. Store commands in `acp-agent-state.ts`. Surface them in the chat input autocomplete when the user types `/`.

- Agent commands shown in a separate "Agent Commands" section below Notesage skills
- When selected, prepend the command text to the prompt (agents parse `/command arg` from the prompt text)
- Update command list when `available_commands_update` arrives

**Files:** `src/hooks/useAcpSessionListeners.ts`, `src/lib/ai/acp-agent-state.ts`, `src/components/chat/ChatInput.tsx`

### Phase 4 — Robustness

**4.1 Capability checking**

Before calling capability-gated methods, check the agent's advertised capabilities:

| Method | Required Capability |
| --- | --- |
| `session/load` | `agentCapabilities.loadSession` |
| `session/set_mode` | presence of `modes` in session response |
| `session/set_model` | `unstable_session_model` + agent support |
| `session/list` | `sessionCapabilities.list` |

Store `AgentCapabilities` in `AgentHandle` and pass to frontend as part of `SpawnResult`.

**Files:** `src-tauri/src/commands/acp.rs`, `src/lib/ai/acp-utils.ts`

**4.2 Cancel contract compliance**

When sending `cancel`, the ACP spec requires the client to respond `Cancelled` to all pending `session/request_permission` requests. Verify this happens reliably — the current implementation denies pending permissions on cancel but may not use the `Cancelled` outcome consistently.

**Files:** `src/hooks/useAcpLifecycle.ts`, `src-tauri/src/commands/acp.rs`

## UI/UX

### Chat Footer Additions

The chat footer already contains: model picker, agent picker, project selector, search toggle, tools indicator.

**New elements (Phase 2-3):**

- **Mode picker:** Dropdown showing available modes. Compact chip style matching model picker. **Hidden by default** — a toggle in Settings > Advanced ("Show agent mode picker") reveals it. When hidden, the agent's first/default mode is used automatically. Writing-friendly labels applied **only for Claude Code** modes: `code` → "Edit", `architect` → "Plan", `ask` → "Chat" with descriptive tooltips. All other agents (Codex: read-only/workspace-write/full-access, Gemini: auto-approve, etc.) show their native mode names as-is — these are already human-readable and represent fundamentally different concepts (permission levels, approval levels) that shouldn't be remapped. Always hidden for agents that don't report modes (e.g., Copilot CLI).
- **Config options:** For `thinkingEffort` category options, render as a labeled slider or small dropdown adjacent to the mode picker. Other categories render as dropdowns in a "..." overflow menu.
- **Usage indicator:** Right-aligned in footer. Format: "4.2K / 200K" with a thin progress bar. Cost shown on hover as tooltip: "$0.03". Uses `text-muted-foreground` — unobtrusive.

### Plan Segment

- Renders as a collapsible card in the message stream (like thinking segments)
- Header: "Plan" with entry count badge
- Each entry: status icon (circle/spinner/check) + priority dot (high=destructive, medium=muted, low=faint) + text
- Auto-expanded while streaming, collapses to header after turn complete

### Tool Call Locations

- File paths in tool call segments become clickable links
- Click opens the file in a tab and scrolls to the referenced line
- Uses the same navigation logic as internal document links (`link-utils.ts`)

### Slash Command Autocomplete

- When user types `/` in chat input, show a combined list:
  - Section 1: "Notesage Skills" — existing skill commands
  - Section 2: "Agent Commands" — from `available_commands_update` with description and input hint
- Agent commands have a subtle badge (agent icon or name) to distinguish them
- Selection inserts `/command `into the input for the user to add arguments

## Data Model

### New/Modified Rust Types

```rust
// Extended SessionResult
pub struct SessionResult {
    pub session_id: String,
    pub current_model: Option<String>,
    pub available_models: Vec<AgentModelInfo>,
    pub modes: Option<serde_json::Value>,         // SessionModeState JSON
    pub config_options: Option<serde_json::Value>, // Vec<SessionConfigOption> JSON
}

// Extended SpawnResult
pub struct SpawnResult {
    pub instance_id: String,
    pub agent_name: Option<String>,
    pub agent_version: Option<String>,
    pub auth_methods: Vec<AuthMethodInfo>,
    pub sandbox_enabled: bool,
    pub network_sandbox_enabled: bool,
    pub supports_images: bool,
    pub capabilities: Option<serde_json::Value>,  // AgentCapabilities JSON
}
```

### New/Modified TypeScript Types

```typescript
// In types.ts — new segment type
interface PlanSegment {
  type: 'plan';
  entries: PlanEntry[];
  timestamp: number;
}
interface PlanEntry {
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
}

// Extend Segment union
type Segment = TextSegment | ThinkingSegment | ToolCallSegment | ToolResultSegment | ImageSegment | PlanSegment;

// In acp-agent-state.ts or new store
interface AcpSessionState {
  modes: { currentModeId: string; availableModes: { id: string; name: string; description?: string }[] } | null;
  configOptions: { id: string; name: string; description?: string; values: { id: string; name: string }[]; selectedValueId: string; category?: string }[];
  availableCommands: { name: string; description: string; inputHint?: string }[];
  usage: { contextUsed: number; contextSize: number; cost?: { amount: number; currency: string } } | null;
}

// Extended ToolCallSegment
interface ToolCallSegment {
  type: 'tool_call';
  kind: string;
  label: string;
  detail?: string;
  status: 'running' | 'done' | 'error';
  locations?: { path: string; line?: number }[];  // NEW
  timestamp: number;
}
```

### New Tauri Commands

| Command | Parameters | Returns |
| --- | --- | --- |
| `acp_session_set_mode` | `instance_id, session_id, mode_id` | `()` |
| `acp_session_set_config_option` | `instance_id, session_id, option_id, value_id` | `()` |

### New AgentCmd Variants

```rust
enum AgentCmd {
    // ... existing variants ...
    SetMode { session_id: String, mode_id: String, reply: oneshot::Sender<Result<(), String>> },
    SetConfigOption { session_id: String, option_id: String, value_id: String, reply: oneshot::Sender<Result<(), String>> },
}
```

## Dependencies

- **ACP crate bump** to latest (`agent-client-protocol` + `agent-client-protocol-schema`)
- No new external dependencies required
- All UI components use existing shadcn/ui primitives (DropdownMenu, Tooltip, Collapsible)

## Quality Gates

### Functional

- [x] Thinking output from Claude Code visible in chat panel as collapsible thinking segments

- [ ] Mode picker appears when agent reports available modes

- [ ] Switching modes calls `session/set_mode` and reflects in UI

- [ ] Config options render dynamically from agent metadata

- [ ] Changing a config option calls `session/set_config_option`

- [ ] Usage indicator shows live token count during streaming

- [ ] Cost shown on hover when agent provides it

- [ ] Agent plans render as collapsible entries in message stream

- [ ] Tool call locations are clickable and navigate to the file

- [ ] Agent slash commands appear in chat input autocomplete

- [x] Unknown `SessionUpdate` types are logged and don't crash

- [ ] `session/load` only called when agent advertises `loadSession` capability

- [x] Session title from agent used in conversation history

- [ ] Cancel properly responds `Cancelled` to all pending permission requests

### Design

- [ ] Mode picker matches model picker chip style — compact, consistent

- [ ] Usage indicator uses `text-muted-foreground`, unobtrusive in footer

- [ ] Plan segment follows thinking segment collapsible pattern

- [ ] All new elements work in both light and dark mode

- [ ] No chromatic accent colors (strictly neutral palette per design system)

### Testing

- [x] Unit tests for new segment types (PlanSegment, extended ThinkingSegment)

- [x] Unit tests for `session_info_update` → conversation title

- [ ] Unit tests for `usage_update` parsing and accumulation

- [ ] Unit tests for mode/config option state management

- [x] Unit tests for unknown `SessionUpdate` graceful handling

- [x] Existing ACP tests pass after crate bump

- [ ] TypeScript typecheck passes

- [ ] Performance benchmarks pass within budget

## Out of Scope

- **Client FS/terminal capabilities** — significant new functionality, separate PRD. Enables editor follow-along and faster agent file I/O.
- **NES (Next Edit Suggestions)** — unstable ACP feature for inline completions. Architectural overlap with existing Copilot LSP integration. Evaluate when NES stabilizes.
- **Elicitation** — unstable. Agents requesting structured user input via URL. Low current demand.
- **Session fork/resume/close** — unstable. Parallel session exploration. Niche use case.
- **Audio content blocks** — no current ACP agent sends audio.
- **MCP server passthrough** — passing user's MCP servers to ACP sessions. Separate PRD for tool ecosystem integration.
- **Resource blocks** (`resource_link`, `resource`) — embedded context from agents. Low priority until agents start sending these.
- `EnvVar` **and** `Terminal` **auth types** — unstable. Gemini workaround is functional.
- **Multi-root workspace** (`additionalDirectories`) — unstable.