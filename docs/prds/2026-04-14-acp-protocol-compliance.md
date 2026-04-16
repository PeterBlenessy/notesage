# PRD: ACP Protocol Compliance & Feature Expansion

|  |  |
| --- | --- |
| **Date** | 2026-04-14 |
| **Status** | Implemented (v0.34.0) ✅ |
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

### Phase 2 — Session Modes & Config Options (Implemented)

Phase 2 delivered the backend infrastructure and initial UI for modes and config options:

- `SessionResult` extended with `modes` and `config_options` (JSON pass-through)
- `SpawnResult` extended with `capabilities` (AgentCapabilities from initialize)
- Three new Tauri commands: `acp_session_set_mode`, `acp_session_set_config_option`, `acp_session_set_model`
- Mode picker and config option dropdowns in chat footer (`AcpSessionControls` component)
- `current_mode_update` and `config_option_update` event handlers
- Hardcoded model CLI arg injection replaced with post-session `set_model`
- `showAgentModePicker` setting in Settings &gt; Advanced

### Phase 2B — Capability Probing, Session Lifecycle & Mode-Sandbox Reconciliation

Phase 2 revealed that the mode picker only populates after the first message (because ACP sessions are created on-demand). Phase 2B addresses this plus several deeper design requirements.

**2B.1 Capability probe at connection registration**

When a user adds a new ACP connection and authenticates successfully, perform a lightweight capability probe:

1. Spawn agent → initialize → `session/new` (empty working directory `/tmp`)
2. Read `modes` and `config_options` from the session response
3. Store discovered capabilities on the `Connection` object as `acpCapabilities`
4. Stop the agent subprocess

This runs once at registration time (a few hundred ms for local subprocesses). The discovered data populates the connection config dialog so the user can set defaults.

```typescript
// Stored on Connection
interface AcpDiscoveredCapabilities {
  availableModes?: { id: string; name: string; description?: string }[];
  configOptions?: AcpSessionConfigOption[];
  supportsLoadSession?: boolean;
  supportsImages?: boolean;
  agentVersion?: string;
  lastProbed?: number; // re-probe if stale (>24h) or agent version changed
}
```

**Staleness**: Re-probe when user opens connection settings (manual refresh), when `lastProbed` &gt; 24h and agent is spawned anyway, or when `SpawnResult.agent_version` differs from stored version.

**Files:** `src/lib/ai/acp-agent-state.ts`, `src/hooks/useAcpLifecycle.ts`, `src/stores/connections-store.ts`, `src/components/settings/ConnectionsSettings.tsx`

**2B.2 Connection config defaults for mode and thinking effort**

Add default mode and thinking effort to the connection configuration dialog:

- **Default mode**: Dropdown populated from `acpCapabilities.availableModes`. Default: agent's own reported `currentModeId` (typically the safest). User can change to any available mode.
- **Default thinking effort**: Dropdown populated from `acpCapabilities.configOptions` where `category === 'thought_level'`. Only shown if the agent supports it.

Stored on the connection:

```typescript
interface AcpDefaults {
  modeId?: string;           // e.g., "code", "read-only", "default"
  thinkingEffort?: string;   // e.g., "medium", "high"
}
```

This replaces the hardcoded `reasoningEffort` field on Codex connection config with a generic, agent-discovered mechanism.

**Files:** `src/stores/connections-store.ts`, `src/components/settings/ConnectionsSettings.tsx`, `src/lib/ai/connections.ts`

**2B.3 Eager session creation at chat open**

When the user opens the chat panel (or switches to a conversation) with an ACP connection, create the session immediately in the background — before the user types their first message.

Flow:

1. Chat panel mounts with an ACP connection → spawn agent (if not running) + `session/new`
2. Apply user's configured defaults: `set_mode(acpDefaults.modeId)`, `set_config_option('reasoning_effort', acpDefaults.thinkingEffort)`
3. Mode picker and config options populate immediately (\~100ms)
4. User sees controls while composing their first message
5. When user sends, session already exists — prompt goes directly, no creation delay

Cleanup: If the user switches connections before sending, stop the unused session.

**Files:** `src/hooks/useAcpLifecycle.ts`, `src/lib/ai/acp-agent-state.ts`, `src/components/chat/ChatPanel.tsx`

**2B.4 Session restoration for existing chats**

Store `sessionId` on the `Conversation` object (persisted). When opening an existing chat:

1. If `sessionId` exists AND agent supports `loadSession` → call `session/load`
   - Agent retains server-side conversation history — references to earlier messages work
   - `LoadSessionResponse` returns `modes` and `config_options` — picker populates
2. If `session/load` fails (session expired, agent restarted) → fall back to `session/new` + history injection (current behavior)
3. If agent doesn't support `loadSession` → always `session/new`

**Files:** `src/stores/chat-store.ts` (add `sessionId` to `Conversation`), `src/hooks/useAcpLifecycle.ts`

**2B.5 Mode-sandbox conflict resolution**

When the user selects a mode that implies unrestricted access (e.g., `bypassPermissions`, `yolo`, `full-access`, `auto`) but the connection has sandbox/network restrictions enabled, show a confirmation dialog:

**Mode classification:**

| Risk level | Modes | Behavior |
| --- | --- | --- |
| Restricted | `default`, `plan`, `dontAsk` | No conflict — these modes already restrict |
| Moderate | `acceptEdits`, `autoEdit`, `auto` | No conflict — sandbox enforces boundaries regardless |
| Unrestricted | `bypassPermissions`, `yolo`, `full-access`, `autopilot` | Conflict if restrictions enabled — show dialog |

**Conflict dialog:**

> **Mode conflicts with security settings**
>
> "{Mode Name}" allows the agent to operate without permission checks, but this connection has security restrictions enabled that will block some operations.
>
> - **Keep restrictions** — Use this mode but sandbox and network limits still apply. The agent may encounter errors when blocked operations are attempted.
> - **Remove restrictions for this session** — Temporarily disable sandbox, network restrictions, and kernel enforcement. Restrictions restore on next session.
> - **Remove restrictions permanently** — Update connection settings to disable all restrictions. ⚠️ The agent will have unrestricted filesystem and network access.
> - **Cancel** — Stay in current mode.

"Remove permanently" updates the connection: `sandboxEnabled: false`, `networkSandboxEnabled: false`, `kernelNetworkDeny: false`. This requires agent respawn to take effect.

**Files:** `src/components/chat/AcpSessionControls.tsx`, `src/stores/connections-store.ts`, new `ModeConflictDialog.tsx`

**2B.6 Migrate hardcoded thinking effort to dynamic config**

Remove the hardcoded `reasoningEffort` field from Codex connection config. Replace with `acpDefaults.thinkingEffort` populated from the capability probe. Existing Codex connections with `reasoningEffort` set are migrated to the new field on first load.

**Files:** `src/stores/connections-store.ts`, `src/lib/ai/connections.ts`, `src/components/settings/ConnectionsSettings.tsx`

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

**New elements (Phase 2/2B/3):**

- **Mode picker:** Dropdown with Shield icon, populated from `session/new` response. Shows **permission-level common modes** mapped from agent-specific mode IDs — not the raw agent modes. **Hidden by default** — toggle in Settings &gt; Advanced ("Show agent mode picker"). When hidden, the user's configured default mode is used automatically. "Full Access" shows a lock icon when sandbox restrictions are active and triggers a conflict dialog on selection.

  **Common mode mapping (permission levels):**

  | Common Mode | Description | Claude Code | Codex | Gemini CLI | Copilot CLI |
  | --- | --- | --- | --- | --- | --- |
  | **Read Only** | Can read — must ask for everything else | `default` | `read-only` | `default` | — |
  | **Agent** | Can read and edit — asks for risky ops | `acceptEdits` | `auto` | `autoEdit` | `agent` URL |
  | **Full Access** | No permission prompts | `bypassPermissions` | `full-access` | `yolo` | `autopilot` URL |
  | **Plan** | Read-only — proposes without executing | `plan` | — | `plan` | `plan` URL |

  Agent-specific modes not in this table (e.g., `dontAsk`) are hidden from the picker.

  **Provider support matrix:**

  | Common Mode | Claude Code | OpenAI Codex | Gemini CLI | GitHub Copilot CLI |
  | --- | --- | --- | --- | --- |
  | **Read Only** | ✅ | ✅ | ✅ | — |
  | **Agent** | ✅ | ✅ | ✅ | ✅ |
  | **Full Access** | ✅ | ✅ | ✅ | ✅ |
  | **Plan** | ✅ | — | ✅ | ✅ |

- **Config options:** Config options with `category: "mode"` filtered out (duplicates mode picker). `category: "thought_level"` renders as a labeled dropdown adjacent to the mode picker. `category: "model"` filtered out (handled by model picker). Other categories render as dropdowns. Select options use `value` field per ACP schema.

- **Usage indicator:** Circular progress icon that fills clockwise as context is consumed. Token count and cost shown in tooltip on hover. Uses `text-muted-foreground` — unobtrusive.

### Connection Config Additions (Phase 2B)

- **Default mode:** Dropdown in connection config dialog, populated from capability probe. Shows agent's actual available modes with descriptions. Default: agent's own reported default (typically the safest mode).
- **Default thinking effort:** Dropdown in connection config dialog, populated from capability probe config options where `category === 'thought_level'`. Only shown for agents that support it. Replaces the hardcoded Codex `reasoningEffort` field.
- **Capability refresh:** Button to re-probe agent capabilities (re-runs the lightweight spawn → session → read → stop cycle).

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

### New/Modified Connection Types (Phase 2B)

```typescript
// Stored on Connection (persisted in connections-store)
interface Connection {
  // ... existing fields ...

  // Discovered at registration, refreshed periodically
  acpCapabilities?: {
    availableModes?: { id: string; name: string; description?: string }[];
    configOptions?: AcpSessionConfigOption[];
    supportsLoadSession?: boolean;
    supportsImages?: boolean;
    agentVersion?: string;
    lastProbed?: number; // ISO timestamp — re-probe if stale (>24h)
  };

  // User-chosen defaults (from connection config dialog)
  acpDefaults?: {
    modeId?: string;          // e.g., "default", "code", "read-only"
    thinkingEffort?: string;  // e.g., "medium", "high"
  };
}
```

### New Tauri Commands

| Command | Parameters | Returns |
| --- | --- | --- |
| `acp_session_set_mode` | `instance_id, session_id, mode_id` | `()` |
| `acp_session_set_config_option` | `instance_id, session_id, option_id, value_id` | `()` |
| `acp_session_set_model` | `instance_id, session_id, model_id` | `()` |

### New AgentCmd Variants

```rust
enum AgentCmd {
    // ... existing variants ...
    SetMode { session_id: String, mode_id: String, reply: oneshot::Sender<Result<(), String>> },
    SetConfigOption { session_id: String, option_id: String, value_id: String, reply: oneshot::Sender<Result<(), String>> },
    SetModel { session_id: String, model_id: String, reply: oneshot::Sender<Result<(), String>> },
}
```

## Dependencies

- **ACP crate bump** to latest (`agent-client-protocol` + `agent-client-protocol-schema`)
- No new external dependencies required
- All UI components use existing shadcn/ui primitives (DropdownMenu, Tooltip, Collapsible)

## Quality Gates

### Functional

- [x] Thinking output from Claude Code visible in chat panel as collapsible thinking segments

- [x] Mode picker appears when agent reports available modes

- [x] Switching modes calls `session/set_mode` and reflects in UI

- [x] Config options render dynamically from agent metadata

- [x] Changing a config option calls `session/set_config_option`

- [x] Usage indicator shows live token count during streaming

- [x] Cost shown on hover when agent provides it

- [x] Agent plans render as collapsible entries in message stream

- [x] Tool call locations are clickable and navigate to the file

- [x] Agent slash commands appear in chat input autocomplete

- [x] Unknown `SessionUpdate` types are logged and don't crash

- [x] Mode picker populated before first message (eager session creation)

- [x] Connection config shows mode and thinking effort defaults from capability probe

- [x] Selecting unrestricted mode with restrictions enabled shows conflict dialog

- [x] "Remove restrictions permanently" updates connection settings

- [x] Session restored via `session/load` when reopening existing chat (if agent supports it)

- [x] `session/load` only called when agent advertises `loadSession` capability

- [x] Hardcoded Codex `reasoningEffort` migrated to dynamic `acpDefaults.thinkingEffort`

- [x] Session title from agent used in conversation history

- [x] Cancel properly responds `Cancelled` to all pending permission requests

### Design

- [x] Mode picker matches model picker chip style — compact, consistent

- [x] Usage indicator uses `text-muted-foreground`, unobtrusive in footer

- [x] Plan segment follows thinking segment collapsible pattern

- [x] All new elements work in both light and dark mode

- [x] No chromatic accent colors (strictly neutral palette per design system)

### Testing

- [x] Unit tests for new segment types (PlanSegment, extended ThinkingSegment)

- [x] Unit tests for `session_info_update` → conversation title

- [ ] Unit tests for `usage_update` parsing and accumulation *(gap — no test file covers this)*

- [x] Unit tests for mode/config option state management

- [x] Unit tests for unknown `SessionUpdate` graceful handling

- [x] Existing ACP tests pass after crate bump

- [x] TypeScript typecheck passes

- [x] Performance benchmarks pass within budget

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