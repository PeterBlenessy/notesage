# Task Breakdown: AI Provider Architecture v2

**PRD:** `docs/prds/2026-02-21-ai-provider-architecture-v2.md`**Total tasks:** 26 (6S, 10M, 10L) **Estimated phases:** 6a (tasks 1-10), 6b (tasks 11-19), 6c (tasks 20-22)

## Summary

**Suggested implementation order:**

1. **Types & stores first** (#1-3) — Foundation that everything depends on
2. **Migration & hook refactor** (#4-6) — Existing functionality continues to work through new abstractions
3. **Settings UI** (#7-10) — User-facing connections management
4. **ACP backend** (#11-15) — Rust ACP client, Tauri commands, event bridge
5. **Interactive ACP + Agent Activity** (#16-19) — Chat/inline via ACP, agent status panel Agent tasks (#20-22) — Task agents, permission bridge, diff review
6. **Additional agents** (#23-26) — Codex, Copilot, agent picker

**Risks & open questions:**

- The `agent-client-protocol` Rust crate (v0.9.4) is relatively new — may encounter API gaps or breaking changes. Mitigated by pinning version.
- `@zed-industries/claude-agent-acp` adapter must be installed globally by the user. Consider bundling or auto-installing in a future iteration.
- ACP session/prompt for interactive use (chat/inline) may have higher latency than direct API calls. Benchmark during Phase 6b and fall back to direct API if needed. ACP permission request flow may not map 1:1 to Notesage's existing inline diff review. Task #21 may need adaptation.
- Copilot and Codex ACP adapters are maintained by Zed Industries, not by the agent providers themselves — watch for version drift.

---

## Phase 6a: Connections & Routing Infrastructure

### #1 — Define connection and routing types

**Description:** Create the TypeScript type definitions for the new connection/routing system: `Connection`, `ConnectionProvider`, `AuthMethod`, `ConnectionCredentials`, `AICapability`, `UseCaseRouting`, and the `PROVIDER_CAPABILITIES` map. These are the foundational types used by all subsequent tasks.

**Acceptance criteria:**

- Types defined in a new file `src/lib/ai/connections.ts`
- `AICapability uses 3 values: 'interactive' | 'inline_completion' | 'agent_tasks' PROVIDER_CAPABILITIES` map correctly reflects the capability matrix from the PRD (varies by provider + auth method; all ACP providers support interactive + agent_tasks) Connection interface includes capabilities: AICapability\[\] field (resolved from PROVIDER_CAPABILITIES)
- Exported from `src/lib/ai/index.ts`
- No runtime code yet — types and constants only

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/lib/ai/connections.ts` (new), `src/lib/ai/index.ts`

---

### #2 — Create connections-store

**Description:** Create a Zustand store for managing provider connections. Follows the same pattern as existing stores (`ai-store.ts`, `chat-store.ts`) with `persist` middleware.

**Acceptance criteria:**

- Store at `src/stores/connections-store.ts`
- Implements `ConnectionsStore` interface from PRD: `connections[]`, `addConnection`, `updateConnection`, `removeConnection`, `getConnection`, `getConnectionsByProvider`
- `addConnection` auto-generates ID (UUID or timestamp), sets `createdAt`
- Persisted to localStorage key `notesage-connections`
- Unit-testable: store actions produce correct state

**Complexity:** M **Category:** frontend **Dependencies:** #1 **Files:** `src/stores/connections-store.ts` (new)

---

### #3 — Create routing-store

**Description:** Create a Zustand store for use-case-to-connection routing with 3 slots: interactive, agent_tasks, inline_completion. Includes the smart auto-assignment logic.

**Acceptance criteria:**

- Store at `src/stores/routing-store.ts`
- Implements `RoutingStore` interface: `routing` (UseCaseRouting with 3 slots), `setRouting`, `getConnectionForUseCase`, `autoAssign`
- `autoAssign(connectionId)` fills empty slots with compatible capabilities (uses `PROVIDER_CAPABILITIES` map)
- `autoAssign` does NOT override existing assignments (only fills `null` slots)
- `getConnectionForUseCase` resolves connection ID → Connection object (reads from connections-store)
- Persisted to localStorage key `notesage-routing`

**Complexity:** M **Category:** frontend **Dependencies:** #1, #2 **Files:** `src/stores/routing-store.ts` (new)

---

### #4 — Migrate v1 ai-store to connections/routing on first load

**Description:** Write a one-time migration that reads existing `ai-store` settings (provider, apiKeys, ollamaUrl) and creates equivalent Connection + Routing entries in the new stores. Runs on app startup if connections-store is empty.

**Acceptance criteria:**

- Migration function in `src/lib/ai/migration.ts` (new)
- Called from `App.tsx` or a top-level hook on mount
- Reads `ai-store`: if `provider` is set and `connections-store` is empty, creates a Connection:
  - `anthropic` + `apiKeys.anthropic` → Connection with `api_key` auth, auto-assign to `interactive`
  - `openai` + `apiKeys.openai` → Connection with `api_key` auth, auto-assign to `interactive`
  - `ollama` → Connection with `local` auth + `ollamaUrl`, auto-assign to `interactive`
- Does NOT delete old ai-store fields (rollback safety)
- Idempotent: running twice produces the same result
- Migration logged to console for debugging

**Complexity:** M **Category:** frontend **Dependencies:** #2, #3 **Files:** `src/lib/ai/migration.ts` (new), `src/App.tsx`

---

### #5 — Refactor useAIOperations to use routing-store

**Description:** Update the `useAIOperations` hook to resolve provider/credentials from the new routing-store instead of directly from ai-store. For now, only handle api_key and local connections via the existing direct API path. ACP routing is added in Phase 6b (#17).

**Acceptance criteria:**

- `useAIOperations` reads `interactive` connection from routing-store for `sendChatMessage`
- `and` `generateText`
- Falls back to ai-store if routing-store has no assignment (graceful degradation during migration)
- Resolves API key / Ollama URL from the Connection's credentials
- All existing chat and inline action functionality works unchanged
- Project-scoped overrides (project-metadata-store) still apply

**Prepared for ACP routing: connection's authMethod is checked but only api_key and local are handled (agent_managed throws "ACP not yet configured" error) Complexity:** L **Category:** frontend **Dependencies:** #1, #2, #3, #4 **Files:** `src/hooks/useAIOperations.ts`

---

### #6 — Update getAIProvider factory for connection-based resolution

**Description:** Extend the `getAIProvider` factory to accept a `Connection` object instead of loose parameters. Keep the old signature as a deprecated overload for backward compatibility.

**Acceptance criteria:**

- New overload: `getAIProvider(connection: Connection): AIProvider`
- Resolves provider type, API key, and Ollama URL from the Connection
- Old signature `getAIProvider(provider, apiKey, ollamaUrl)` still works (marked `@deprecated`)
- No changes to individual provider implementations (AnthropicProvider, OpenAIProvider, OllamaProvider)

**Complexity:** S **Category:** frontend **Dependencies:** #1 **Files:** `src/lib/ai/index.ts`

---

### #7 — Build ConnectionCard component

**Description:** Create a reusable card component for displaying a single connection in the settings UI. Shows provider logo, name, auth type badge, capability tags, status indicator, and action buttons.

**Acceptance criteria:**

- Component at `src/components/settings/ConnectionCard.tsx`
- Props: `connection: Connection`, `onConfigure`, `onDisconnect`
- Displays: provider logo (from `/logos/`), provider name, auth badge ("API Key" / "Subscription" / "Local"), status dot (green/yellow/red/grey)
- Capability tags: discrete badges showing enabled use cases (e.g., Interactive, Agent Tasks, Inline Completion) "Configure" and "Disconnect" buttons
- Follows design system: shadcn/ui components, neutral palette, hover transitions, both themes
- No standalone functionality — pure presentational component

**Complexity:** M **Category:** frontend **Dependencies:** #1 **Files:** `src/components/settings/ConnectionCard.tsx` (new)

---

### #8 — Build ConnectionsSettings component with capability guidance

**Description:** Create the new Connections section for the AI settings page. Shows existing connections as cards, "Add Connection" button with provider picker that includes capability guidance to help users choose the right subscription.

**Acceptance criteria:**

- Component at `src/components/settings/ConnectionsSettings.tsx`
- Lists all connections from connections-store as `ConnectionCard` components
- "+ Add Connection" button opens a popover/dropdown with provider options Each provider option shows: logo, name, supported use cases as badges, auth method, brief subscription note Provider options: Claude Code (Subscription): Interactive Agent Tasks — "Requires Claude Pro or Max" Anthropic (API Key): Interactive Agent Tasks — "Pay-per-use API key" OpenAI Codex (Subscription): Interactive Agent Tasks — "Requires ChatGPT Plus/Pro" OpenAI (API Key): Interactive Agent Tasks — "Pay-per-use API key" GitHub Copilot: Interactive Inline Completion Agent Tasks — "Free: 2,000 completions/month" Ollama (Local): Interactive — "Free, runs locally" For API key / Ollama: shows input
- field, saves connection, triggers auto-assign For subscription providers: shows "coming soon" placeholder (ACP agent auth is Phase 6b, task #16)
- "Disconnect" removes connection and clears routing assignments that used it

**Complexity:** L **Category:** frontend **Dependencies:** #2, #3, #7 **Files:** `src/components/settings/ConnectionsSettings.tsx` (new)

---

### #9 — Build UseCaseRoutingSettings component

**Description:** Create the "Advanced" collapsible section showing the use-case-to-connection routing grid with 3 rows.

**Acceptance criteria:**

- Component at `src/components/settings/UseCaseRoutingSettings.tsx`
- Collapsible section labeled "Advanced" (collapsed by default)
- Grid/table showing 3 rows: Interactive (Chat + Inline Actions), Agent Tasks, Inline Completion
- Each row: use case label with brief description, dropdown of compatible connections (filtered by capability), status indicator
- Dropdown shows "Not configured" when no connection assigned
- Incompatible connections are not shown in dropdowns (e.g., Ollama not shown for Agent Tasks)
- Complexity: M Category: frontend Dependencies: #3 Files: src/components/settings/UseCaseRoutingSettings.tsx (new) #10 — Integrate new settings components into `SettingsDialog Description`: Replace the old AISettings provider/key section with the new ConnectionsSettings + UseCaseRoutingSettings components in the SettingsDialog. Acceptance criteria: SettingsDialog.tsx AI tab content replaced with ConnectionsSettings + UseCaseRoutingSettings
- Existing PersonasSettings and PromptsSettings tabs remain unchanged
- Old AISettings component kept but no longer rendered (can be removed in a follow-up)

**Settings dialog layout looks polished in both light and dark mode Complexity:** M **Category:** frontend **Dependencies:** #8, #9 **Files:** `src/components/settings/SettingsDialog.tsx`

---

## Phase 6b: ACP Client + Interactive Agent

### #11 — Add agent-client-protocol crate dependency

**Description:** Add the `agent-client-protocol` and `agent-client-protocol-schema` crates to `Cargo.toml`. Verify the crate compiles and the key types (`ClientSideConnection`, `AgentInfo`, `SessionId`, etc.) are accessible.

**Acceptance criteria:**

- `agent-client-protocol = "0.9"` and `agent-client-protocol-schema = "0.6"` added to `Cargo.toml` under `[dependencies]`
- Section comment: `# ACP - Agent Client Protocol (Phase 6)`
- `cargo check` passes
- Can import key types in a test module

**Complexity:** S **Category:** backend **Dependencies:** None **Files:** `src-tauri/Cargo.toml`

---

### #12 — Add agent binary availability check Tauri command

Description: Add a Rust command that checks whether ACP agent binaries are installed on the system. Uses which (Unix) or where (Windows) to locate executables. Acceptance criteria: New command acp_agent_check_availability in src-tauri/src/commands/acp.rs (new module) Takes agent_id: String (e.g., "claude-agent-acp", "codex", "copilot") Returns AgentAvailability { installed: bool, path: Option&lt;String&gt;, version: Option&lt;String&gt; } Tries to run &lt;binary&gt; --version to get version string Registered in lib.rs handler and exported from commands/mod.rs Follow the pattern in commands/git.rs for subprocess execution Complexity: M Category: backend Dependencies: None Files: src-tauri/src/commands/acp.rs (new), src-tauri/src/commands/mod.rs, src-tauri/src/lib.rs #13 — Implement ACP client state and subprocess spawning

**Description:** Create the core ACP client infrastructure in Rust: `AcpState` managed state, subprocess spawning, and the `initialize` handshake. This is the foundation for all agent communication (both interactive and task agents).

**Acceptance criteria:**

- Extends `src-tauri/src/commands/acp.rs` (from #12)
- `AcpState` struct with `Mutex<HashMap<String, AcpAgentProcess>>` (managed state in `lib.rs`)
- `AcpAgentProcess includes role: AgentRole (Interactive or Task) acp_agent_spawn` command: takes role parameter, spawns agent binary as `tokio::process::Command` with stdio piped, creates `ClientSideConnection`, sends `initialize`, stores in `AcpState`
- Returns an instance`_id` (UUID)
- Accepts `env_vars` for passing API keys as environment variables
- Sets working directory to `working_directory` parameter
- `acp_agent_stop` command: sends shutdown, kills process, removes from state
- Error handling: binary not found, initialization failed, timeout
- Follow the subprocess pattern from `commands/watcher.rs` (managed state + Mutex)

**Complexity:** L **Category:** backend **Dependencies:** #11, #12 **Files:** `src-tauri/src/commands/acp.rs`, `src-tauri/src/lib.rs`

---

### #14 — Implement ACP authenticate command

**Description:** Add the `acp_agent_authenticate` Tauri command that sends the ACP `authenticate` method to the agent subprocess. For `agent_managed` connections, this triggers the agent's internal auth flow (e.g., browser popup for subscription login).

**Acceptance criteria:**

- `acp_agent_authenticate` command in `acp.rs`
- Takes `instance_id` and optional credentials
- For agent_managed: sends ACP `authenticate` with no credentials, agent handles it internally
- For api_key: sends ACP `authenticate` with the API key (or relies on env var set during spawn)
- Returns `AuthStatus { authenticated: bool, user_label: Option<String> }`
- Handles auth failure gracefully (returns error, doesn't crash the agent)

**Complexity:** M **Category:** backend **Dependencies:** #13 **Files:** `src-tauri/src/commands/acp.rs`

---

### #15 — Implement ACP session management and streaming

**Description:** Add Tauri commands for ACP session lifecycle (`session/new`, `session/load`, `session/cancel) and the core acp_session_prompt command that streams responses as Tauri events`.

**Acceptance criteria:**

- `acp_session_new(instance_id)` → sends ACP `session/new`, returns `session_id`
- `acp_session_load(instance_id, session_id)` → sends ACP `session/load`acp_session_cancel(instance_id, session_id) → sends ACP `session/cancel acp_session_prompt(window, instance_id, session_id, prompt, context): Sends ACP session/prompt with the user's message Listens for ACP session/update notifications and emits Tauri events: acp-text-delta, acp-tool-call, acp-plan-update On turn complete: emits acp-turn-complete Handles session/request_permission: emits acp-permission-request and waits for response acp_permission_respond(instance_id, request_id, decision) sends response back through ACP Session IDs tracked in AcpAgentProcess.sessions Follow the streaming pattern from commands/ai_streaming.rs (window.emit for events)`

**Complexity:** L **Category:** backend **Dependencies:** #13 **Files:** `src-tauri/src/commands/acp.rs`

---

### #16 — Register ACP commands and state in lib.rs

Description: Wire up all ACP commands and managed state in the Tauri builder. Ensure the module is exported from commands/mod.rs. Acceptance criteria: AcpState::new() added to .manage() in lib.rs All ACP commands registered in generate_handler!\[\]: acp_agent_spawn, acp_agent_authenticate, acp_agent_stop, acp_agent_check_availability, acp_session_new, acp_session_prompt, acp_session_cancel, acp_session_load, acp_permission_respond pub mod acp; and pub use acp::\*; added to commands/mod.rs cargo check passes App launches without errors Complexity: S Category: backend Dependencies: #13, #14, #15 Files: src-tauri/src/lib.rs, src-tauri/src/commands/mod.rs #17 — Route interactive operations through ACP for agent_managed connections Description: Update useAIOperations to transparently route chat and inline actions through ACP when the interactive connection is agent_managed. This is the key task that enables subscription-based chat/inline without API keys. Acceptance criteria: When routing.interactive points to an agent_managed connection: sendChatMessage sends the message via acp\_`session_prompt to the interactive agent instance Reuses the existing ACP session for multi-turn chat (creates new session if none exists) generateText (inline actions) creates a fresh ACP session per action Streaming events (acp-text-delta, acp-turn-complete) are translated to the existing chat store update flow When routing.interactive points to an api_key or local connection: existing direct API behavior (no change) Transparent to the rest of the app — chat panel, bubble menu, etc. work unchanged regardless of connection type Spawns the interactive agent on first use if not already running (lazy initialization) Complexity: L Category: frontend Dependencies: #5, #13, #14, #15 Files: src/hooks/useAIOperations.ts #18 — Add agent connection flow to ConnectionsSettings Description: Extend the ConnectionsSettings UI to support adding agent_managed connections (subscription-based). When user clicks "Connect Claude Code" or "Connect Codex", spawn the agent, trigger auth, and store the connection. Acceptance criteria: Subscription provider options now functional (replace "coming soon" placeholders from #8): "Claude Code (Subscription)": checks binary → spawns agent → triggers auth (browser popup) → stores connection "OpenAI Codex (Subscription)": same flow with Codex binary "GitHub Copilot": same flow with Copilot binary Flow: Checks binary availability (shows install instructions if missing) Shows "Connecting..." state with provider logo Spawns agent via acp_agent_spawn (role: interactive) Triggers acp_agent_authenticate (browser popup opens automatically) On success: creates Connection with agent_managed auth, auto-assigns, shows "Connected" On failure: shows error with retry option Connection card shows "Subscription" badge "Disconnect" stops the agent subprocess Complexity: L Category: frontend Dependencies: #8, #13, #14 Files: src/components/settings/ConnectionsSettings.tsx #19 — Build Agent Activity Panel Description: Create a collapsible right-side panel showing running agents and their status. Can be minimized to a thin strip. Acceptance criteria: New store src/stores/agent-activity-store.ts (non-persisted) New component src/components/agent/AgentActivityPanel.tsx Panel shows: Interactive agents: provider name, status (idle / processing / streaming) Task agents: task description, provider, status (working / waiting for permission / completed / error) Active tool indicator (e.g., "Reading src/auth.rs") Minimized strip shows: agent count + status summary (e.g., "● 1 idle ◉ 1 active") Click minimized strip → expands full panel Listens to ACP Tauri events (acp-text-delta, acp-tool-call, acp-turn-complete) to update agent statuses Panel positioned in right sidebar area (below or alongside chat panel) Follows design system: clean status indicators, hover transitions, both themes`

**Complexity:** L **Category:** frontend **Dependencies:** #15, #17 **Files:** `src/stores/agent-activity-store.ts (new), src/components/agent/AgentActivityPanel.tsx (new), src/App.tsx Phase 6c: Agent Tasks + Permission Bridge #20` — Create useAgentTaskOperations hook

**Description:** Create a frontend hook for delegated agent task operations. Handles spawning task agents, sending task prompts, and managing task lifecycle.

**Acceptance criteria:**

- Hook at `src/hooks/useAgentTaskOperations.ts`
- `startTask(taskDescription, workingDirectory): spawns a new task` agent instance via acp_agent_spawn (role: task), creates session, sends prompt cancelTask(instanceId): cancels the active session and stops the agent
- `respondToPermission(instanceId, requestId, decision)`: responds to permission requests Returns task state: `{ isRunning, textContent, activeTool, pendingPermission, plan }`
- Updates agent-activity-store with task status Cleans up event listeners and agent processes on unmount

**Complexity:** L **Category:** frontend **Dependencies:** #3, #13, #14, #15, #19 **Files:** `src/hooks/useAgentTaskOperations.ts` (new)

---

### #21 — Bridge ACP permission requests to inline diff review

**Description:** When an ACP task agent requests permission to edit a file, bridge this to the existing external change review infrastructure. Display proposed changes as inline diffs for user accept/reject.

**Acceptance criteria:**

- When `acp-permission-request` event arrives with tool `write_file` or `edit_file`:
  - Read current file content from disk (via `read_file` command)
  - Compute diff against proposed content
  - Create entries in `external-change-store` with the proposed changes
  - Show inline diff decorations in the editor (reuse existing `InlineDiff` plugin)
- User accepts → call `respondToPermission(instanceId, requestId, "allow_once")` → agent proceeds
- User rejects → call `respondToPermission(instanceId, requestId, "reject_once")` → agent receives rejection
- For non-file permissions (terminal commands): show accept/reject in Agent Activity Panel
- Integration point: `useAgentTaskOperations` + `external-change-store` + `Editor.tsx`

**Complexity:** L **Category:** both **Dependencies:** #20 **Files:** `src/hooks/useAgentTaskOperations.ts`, `src/components/editor/Editor.tsx`

---

### #22 — Agent Activity Panel: task controls and permission UI

Description: Extend the Agent Activity Panel with task-specific controls: start/cancel tasks, permission request inline controls, completed task summaries. Acceptance criteria: Task agents show: task description, progress text, active tool Permission requests show inline accept/reject buttons in the panel Clicking a file-change permission request navigates to the file and highlights the diff Completed tasks show summary with "Dismiss" button "Cancel" button on running tasks Status indicators: ◉ working, ⏳ waiting, ✓ completed, ✕ error Complexity: M Category: frontend Dependencies: #19, #20, #21 Files: src/components/agent/AgentActivityPanel.tsx Phase 6d: Additional ACP Agents & Polish #23 — Test and integrate Codex CLI ACP adapter Description: Verify the Codex CLI works as an ACP agent through Notesage's ACP client. Test spawn, authenticate (both API key and ChatGPT subscription), interactive chat, and agent task flows. Acceptance criteria: Codex CLI can be spawned via acp_agent_spawn with agent_id: "codex" API key auth works (pass CODEX_API_KEY env var) Subscription auth works (device flow opens browser) Interactive chat via ACP session/prompt streams text deltas correctly Task agent mode works with file change permission requests Document any Codex-specific quirks or ACP compatibility issues Complexity: M Category: both Dependencies: #15, #17, #18 Files: (testing/integration — may need minor adjustments to acp.rs) #24 — Test and integrate GitHub Copilot ACP agent Description: Verify GitHub Copilot works as an ACP agent through Notesage's ACP client. Test spawn, authenticate (subscription), interactive chat, and agent tasks. Test with both paid and free GitHub accounts.

**Acceptance criteria:**

- Copilot CLI can be spawned via `acp_agent_spawn` with `agent_id: "copilot"`
- OAuth device flow authentication works (opens browser for GitHub login)
- Interactive chat via ACP session/prompt works and streams responses Free tier: verify completions work within limits
- Document Copilot-specific limitations (premium request consumption, agent capability scope)
- Document any ACP compatibility issues

**Complexity:** M **Category:** both **Dependencies:** #15, #17, #18 Files: (testing/integration — may need minor adjustments to acp.rs) #25 — Add agent picker to routing settings Description: Extend UseCaseRoutingSettings to show which ACP agent is assigned to each use case, with dropdowns to switch between available agents. Show availability status and capability guidance. Acceptance criteria: Each routing row shows the connected agent with provider logo and auth badge Dropdown lists all connections that support the relevant capability Each option shows: provider logo, name, auth badge, availability status Incompatible connections filtered out Changing assignment: updates routing-store, takes effect on next operation "Not installed" agents shown greyed out with install instructions tooltip Free tier indicators where applicable (e.g., "GitHub Copilot (Free — 2,000/month)") Complexity: M Category: frontend Dependencies: #9, #18 Files: src/components/settings/UseCaseRoutingSettings.tsx #26 — Capability guidance and onboarding polish Description: Polish the capability guidance throughout the settings UI. Ensure new users without subscriptions get helpful guidance on which subscription to choose. Acceptance criteria: Provider picker shows clear capability comparison When user has no connections: show a helpful "Get started" state explaining the options When user connects first provider: show a "You're set!" confirmation with what's enabled and what they could add Free GitHub tier highlighted as a complement: "Add Copilot for free inline completions alongside your \[provider\] subscription" Subscription notes are accurate and up-to-date for all providers Empty routing slots show a friendly "Add a connection to enable this" message with link to add connection Complexity: S Category: frontend Dependencies: #8, #9, #10 Files: src/components/settings/ConnectionsSettings.tsx, `src/components/settings/UseCaseRoutingSettings.tsx`

---

## Summary Table

| \# | Title | Complexity | Category | Phase | Dependencies |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Define connection and routing types | S | frontend | 6a | — |  |  |  |  |  |  |
| 2 | Create connections-store | M | frontend | 6a | #1 |  |  |  |  |  |  |
| 3 | Create routing-store | M | frontend | 6a | #1, #2 |  |  |  |  |  |  |
| 4 |  | Migrate v1 ai-store to connections/routing | M | frontend | 6a | #2, #3 |  |  |  |  |  |
| 5 | Refactor useAIOperations (direct API path) | L | frontend | 6a | #1-4 |  |  |  |  |  |  |
| 6 | Update getAIProvider for connection-based resolution | S | frontend | 6a | #1 |  |  |  |  |  |  |
| 7 | Build ConnectionCard component | M | frontend | 6a | #1 |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |  |  |  |  |  |
| Build ConnectionsSettings with capability guidance |  |  |  |  |  |  |  |  |  |  |  |
| L |  |  |  |  |  |  |  |  |  |  |  |
| frontend |  |  |  |  |  |  |  |  |  |  |  |
| 6a |  |  |  |  |  |  |  |  |  |  |  |
| #2, #3, #7 |  |  |  |  |  |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |  |  |  |  |  |
| Build UseCaseRoutingSettings component |  |  |  |  |  |  |  |  |  |  |  |
| M |  |  |  |  |  |  |  |  |  |  |  |
| frontend |  |  |  |  |  |  |  |  |  |  |  |
| 6a |  |  |  |  |  |  |  |  |  |  |  |
| #3 |  |  |  |  |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |  |  |  |  |
| Integrate new settings into SettingsDialog |  |  |  |  |  |  |  |  |  |  |  |
| M | frontend | 6a | #8, #9 |  |  |  |  |  |  |  |  |
| 11 | Add agent-client-protocol crate dependency | S | backend | 6b | — |  |  |  |  |  |  |
| 12 | Add agent binary availability check command |  |  |  |  |  |  |  |  |  |  |
| M |  |  |  |  |  |  |  |  |  |  |  |
| backend |  |  |  |  |  |  |  |  |  |  |  |
| 6b |  |  |  |  |  |  |  |  |  |  |  |
| — |  |  |  |  |  |  |  |  |  |  |  |
| 13 |  |  |  |  |  |  |  |  |  |  |  |
| Implement ACP client state and subprocess spawning |  |  |  |  |  |  |  |  |  |  |  |
| L |  |  |  |  |  |  |  |  |  |  |  |
| backend |  |  |  |  |  |  |  |  |  |  |  |
| 6b |  |  |  |  |  |  |  |  |  |  |  |
| #11, #12 |  |  |  |  |  |  |  |  |  |  |  |
| 14 |  |  |  |  |  |  |  |  |  |  |  |
| Implement ACP authenticate command |  |  |  |  |  |  |  |  |  |  |  |
| M |  |  |  |  |  |  |  |  |  |  |  |
| backend |  |  |  |  |  |  |  |  |  |  |  |
| 6b |  |  |  |  |  |  |  |  |  |  |  |
| #13 |  |  |  |  |  |  |  |  |  |  |  |
| 15 |  |  |  |  |  |  |  |  |  |  |  |
| Implement ACP session management and streaming |  |  |  |  |  |  |  |  |  |  |  |
| L |  |  |  |  |  |  |  |  |  |  |  |
| backend |  |  |  |  |  |  |  |  |  |  |  |
| 6b |  |  |  |  |  |  |  |  |  |  |  |
| #13 |  |  |  |  |  |  |  |  |  |  |  |
| 16 |  |  |  |  |  |  |  |  |  |  |  |
| Register ACP commands and state in lib.rs |  |  |  |  |  |  |  |  |  |  |  |
| S |  |  |  |  |  |  |  |  |  |  |  |
| backend |  |  |  |  |  |  |  |  |  |  |  |
| 6b |  |  |  |  |  |  |  |  |  |  |  |
| #13-15 |  |  |  |  |  |  |  |  |  |  |  |
| 17 |  |  |  |  |  |  |  |  |  |  |  |
| Route interactive operations through ACP |  |  |  |  |  |  |  |  |  |  |  |
| L |  |  |  |  |  |  |  |  |  |  |  |
| frontend |  |  |  |  |  |  |  |  |  |  |  |
| 6b |  |  |  |  |  |  |  |  |  |  |  |
| #5, #13-15 |  |  |  |  |  |  |  |  |  |  |  |
| 18 |  |  |  |  |  |  |  |  |  |  |  |
| Add agent connection flow to ConnectionsSettings |  |  |  |  |  |  |  |  |  |  |  |
| L |  |  |  |  |  |  |  |  |  |  |  |
| frontend |  |  |  |  |  |  |  |  |  |  |  |
| 6b |  |  |  |  |  |  |  |  |  |  |  |
| #8, #13, #14 |  |  |  |  |  |  |  |  |  |  |  |
| 19 |  |  |  |  |  |  |  |  |  |  |  |
| Build Agent Activity Panel |  |  |  |  |  |  |  |  |  |  |  |
| L |  |  |  |  |  |  |  |  |  |  |  |
| frontend |  |  |  |  |  |  |  |  |  |  |  |
| 6b |  |  |  |  |  |  |  |  |  |  |  |
| #15, #17 |  |  |  |  |  |  |  |  |  |  |  |
| 20 |  |  |  |  |  |  |  |  |  |  |  |
| Create useAgentTaskOperations hook |  |  |  |  |  |  |  |  |  |  |  |
| L |  |  |  |  |  |  |  |  |  |  |  |
| frontend |  |  |  |  |  |  |  |  |  |  |  |
| 6c |  |  |  |  |  |  |  |  |  |  |  |
| #3, #13-15, #19 |  |  |  |  |  |  |  |  |  |  |  |
| 21 |  |  |  |  |  |  |  |  |  |  |  |
| Bridge ACP permission requests to inline diff review |  |  |  |  |  |  |  |  |  |  |  |
| L |  |  |  |  |  |  |  |  |  |  |  |
| both |  |  |  |  |  |  |  |  |  |  |  |
| 6c |  |  |  |  |  |  |  |  |  |  |  |
| #20 |  |  |  |  |  |  |  |  |  |  |  |
| 22 |  |  |  |  |  |  |  |  |  |  |  |
| Agent Activity Panel: task controls and permission UI |  |  |  |  |  |  |  |  |  |  |  |
| M |  |  |  |  |  |  |  |  |  |  |  |
| frontend |  |  |  |  |  |  |  |  |  |  |  |
| 6c |  |  |  |  |  |  |  |  |  |  |  |
| #19-21 |  |  |  |  |  |  |  |  |  |  |  |
| 23 | Test and integrate Codex CLI ACP adapter | M | both | 6d |  |  |  |  |  |  |  |
| #15, #17, #18 |  |  |  |  |  |  |  |  |  |  |  |
| 24 | Test and integrate GitHub Copilot ACP agent | M | both | 6d |  |  |  |  |  |  |  |
| #15, #17, #18 |  |  |  |  |  |  |  |  |  |  |  |
| 25 | Add agent picker to routing settings | M |  |  |  |  |  |  |  |  |  |
| frontend |  |  |  |  |  |  |  |  |  |  |  |
| 6d |  |  |  |  |  |  |  |  |  |  |  |
| #9, #18 |  |  |  |  |  |  |  |  |  |  |  |
| 26 |  |  |  |  |  |  |  |  |  |  |  |
| Capability guidance and onboarding polish |  |  |  |  |  |  |  |  |  |  |  |
| S |  |  |  |  |  |  |  |  |  |  |  |
| frontend |  |  |  |  |  |  |  |  |  |  |  |
| 6d |  |  |  |  |  |  |  |  |  |  |  |
| #8-10 |  |  |  |  |  |  |  |  |  |  |  |
| Complexity breakdown: 5S, 10M, 11L |  |  |  |  |  |  |  |  |  |  |  |
| Critical path: #1 → #2 → #3 → #4 → #5 (existing chat keeps working) and #11 → #13 → #15 → #17 (interactive ACP works) and #13 → #20 → #21 (agent tasks work) |  |  |  |  |  |  |  |  |  |  |  |
| High blast radius tasks: #5 (refactors the hook everything depends on), #10 (modifies SettingsDialog), #16 (modifies lib.rs), #17 (adds ACP routing to the main AI operations hook) |  |  |  |  |  |  |  |  |  |  |  |
