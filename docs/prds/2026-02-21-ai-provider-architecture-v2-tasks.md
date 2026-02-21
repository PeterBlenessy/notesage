# Task Breakdown: AI Provider Architecture v2

**PRD:** `docs/prds/2026-02-21-ai-provider-architecture-v2.md`**Total tasks:** 22 (7S, 9M, 6L) **Estimated phases:** 6a (tasks 1-10), 6b (tasks 11-18), 6c (tasks 19-22)

## Summary

**Suggested implementation order:**

1. **Types & stores first** (#1-4) — Foundation that everything depends on
2. **Migration & hook refactor** (#5-7) — Existing functionality continues to work through new abstractions
3. **Settings UI** (#8-10) — User-facing connections management
4. **ACP backend** (#11-15) — Rust ACP client, Tauri commands, event bridge
5. **ACP frontend** (#16-18) — Agent UI integration, permission handling
6. **Additional agents** (#19-22) — Codex, Copilot, agent picker

**Risks & open questions:**

- The `agent-client-protocol` Rust crate (v0.9.4) is relatively new — may encounter API gaps or breaking changes. Mitigated by pinning version.
- `@zed-industries/claude-agent-acp` adapter must be installed globally by the user. Consider bundling or auto-installing in a future iteration.
- ACP permission request flow may not map 1:1 to Notesage's existing inline diff review. Task #17 may need adaptation.
- Copilot and Codex ACP adapters are maintained by Zed Industries, not by the agent providers themselves — watch for version drift.

---

## Phase 6a: Connections & Routing Infrastructure

### #1 — Define connection and routing types

**Description:** Create the TypeScript type definitions for the new connection/routing system: `Connection`, `ConnectionProvider`, `AuthMethod`, `ConnectionCredentials`, `AICapability`, `UseCaseRouting`, and the `PROVIDER_CAPABILITIES` map. These are the foundational types used by all subsequent tasks.

**Acceptance criteria:**

- Types defined in a new file `src/lib/ai/connections.ts`
- `PROVIDER_CAPABILITIES` map correctly reflects the capability matrix from the PRD (varies by auth method)
- Exported from `src/lib/ai/index.ts`
- No runtime code yet — types only

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `src/lib/ai/connections.ts` (new), `src/lib/ai/index.ts`

---

### #2 — Create connections-store

**Description:** Create a Zustand store for managing provider connections. Follows the same pattern as existing stores (`ai-store.ts`, `chat-store.ts`) with `persist` middleware.

**Acceptance criteria:**

- Store at `src/stores/connections-store.ts`
- Implements `ConnectionsStore` interface from PRD: `connections[]`, `addConnection`, `updateConnection`, `removeConnection`, `getConnection`, `getConnectionsByProvider`
- `addConnection` auto-generates ID (UUID or timestamp) and sets `createdAt`
- Persisted to localStorage key `notesage-connections`
- Unit-testable: store actions produce correct state

**Complexity:** M **Category:** frontend **Dependencies:** #1 **Files:** `src/stores/connections-store.ts` (new)

---

### #3 — Create routing-store

**Description:** Create a Zustand store for use-case-to-connection routing. Includes the smart auto-assignment logic.

**Acceptance criteria:**

- Store at `src/stores/routing-store.ts`
- Implements `RoutingStore` interface: `routing` (UseCaseRouting), `setRouting`, `getConnectionForUseCase`, `autoAssign`
- `autoAssign(connectionId)` fills empty slots with compatible capabilities (uses `PROVIDER_CAPABILITIES` map)
- `autoAssign` does NOT override existing assignments (only fills `null` slots)
- `getConnectionForUseCase` resolves connection ID → Connection object (reads from connections-store)
- Persisted to localStorage key `notesage-routing`

**Complexity:** M **Category:** frontend **Dependencies:** #1, #2 **Files:** `src/stores/routing-store.ts` (new)

---

### #4 — Add agent binary availability check Tauri command

**Description:** Add a Rust command that checks whether ACP agent binaries are installed on the system. Uses `which` (Unix) or `where` (Windows) to locate executables.

**Acceptance criteria:**

- New command `acp_agent_check_availability` in `src-tauri/src/commands/acp.rs` (new module)
- Takes `agent_id: String` (e.g., `"claude-agent-acp"`, `"codex"`, `"copilot"`)
- Returns `AgentAvailability { installed: bool, path: Option<String>, version: Option<String> }`
- Tries to run `<binary> --version` to get version string
- Registered in `lib.rs` handler and exported from `commands/mod.rs`
- Follow the pattern in `commands/git.rs` for subprocess execution

**Complexity:** M **Category:** backend **Dependencies:** None **Files:** `src-tauri/src/commands/acp.rs` (new), `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

---

### #5 — Migrate v1 ai-store to connections/routing on first load

**Description:** Write a one-time migration that reads existing `ai-store` settings (provider, apiKeys, ollamaUrl) and creates equivalent Connection + Routing entries in the new stores. Runs on app startup if connections-store is empty.

**Acceptance criteria:**

- Migration function in `src/lib/ai/migration.ts` (new)
- Called from `App.tsx` or a top-level hook on mount
- Reads `ai-store`: if `provider` is set and `connections-store` is empty, creates a Connection:
  - `anthropic` + `apiKeys.anthropic` → Connection with `api_key` auth, auto-assign to `chat` + `inline_actions`
  - `openai` + `apiKeys.openai` → Connection with `api_key` auth, auto-assign to `chat` + `inline_actions`
  - `ollama` → Connection with `local` auth + `ollamaUrl`, auto-assign to `chat` + `inline_actions`
- Does NOT delete old ai-store fields (rollback safety)
- Idempotent: running twice produces the same result
- Migration logged to console for debugging

**Complexity:** M **Category:** frontend **Dependencies:** #2, #3 **Files:** `src/lib/ai/migration.ts` (new), `src/App.tsx`

---

### #6 — Refactor useAIOperations to use routing-store

**Description:** Update the `useAIOperations` hook to resolve provider/credentials from the new routing-store instead of directly from ai-store. This is the critical backward-compatibility task — existing chat and inline actions must continue to work.

**Acceptance criteria:**

- `useAIOperations` reads `chat` connection from routing-store for `sendChatMessage`
- `useAIOperations` reads `inline_actions` connection from routing-store for `generateText`
- Falls back to ai-store if routing-store has no assignment (graceful degradation during migration)
- Resolves API key / Ollama URL from the Connection's credentials
- All existing chat and inline action functionality works unchanged
- Project-scoped overrides (project-metadata-store) still apply

**Complexity:** L **Category:** frontend **Dependencies:** #1, #2, #3, #5 **Files:** `src/hooks/useAIOperations.ts`

---

### #7 — Update getAIProvider factory for connection-based resolution

**Description:** Extend the `getAIProvider` factory to accept a `Connection` object instead of loose parameters. Keep the old signature as a deprecated overload for backward compatibility.

**Acceptance criteria:**

- New overload: `getAIProvider(connection: Connection): AIProvider`
- Resolves provider type, API key, and Ollama URL from the Connection
- Old signature `getAIProvider(provider, apiKey, ollamaUrl)` still works (marked `@deprecated`)
- No changes to individual provider implementations (AnthropicProvider, OpenAIProvider, OllamaProvider)

**Complexity:** S **Category:** frontend **Dependencies:** #1 **Files:** `src/lib/ai/index.ts`

---

### #8 — Build ConnectionCard component

**Description:** Create a reusable card component for displaying a single connection in the settings UI. Shows provider logo, name, auth type badge, status indicator, and action buttons.

**Acceptance criteria:**

- Component at `src/components/settings/ConnectionCard.tsx`
- Props: `connection: Connection`, `onConfigure`, `onDisconnect`
- Displays: provider logo (from `/logos/`), provider name, auth badge ("API Key" / "Subscription"), status dot (green/yellow/red/grey)
- "Configure" and "Disconnect" buttons
- Follows design system: shadcn/ui components, neutral palette, hover transitions, both themes
- No standalone functionality — pure presentational component

**Complexity:** M **Category:** frontend **Dependencies:** #1 **Files:** `src/components/settings/ConnectionCard.tsx` (new)

---

### #9 — Build ConnectionsSettings component (replaces AISettings provider section)

**Description:** Create the new Connections section for the AI settings page. Shows existing connections as cards, "Add Connection" button with provider picker, and handles adding API key / Ollama URL connections.

**Acceptance criteria:**

- Component at `src/components/settings/ConnectionsSettings.tsx`
- Lists all connections from connections-store as `ConnectionCard` components
- "+ Add Connection" button opens a popover/dropdown with provider options (Anthropic, OpenAI, GitHub, Ollama)
- Selecting Anthropic/OpenAI shows API key input (reuse existing input pattern from AISettings)
- Selecting Ollama shows URL input
- Selecting GitHub shows "coming soon" placeholder (ACP agent auth is Phase 6b)
- On save: creates Connection via connections-store, triggers auto-assign via routing-store
- "Disconnect" removes connection and clears routing assignments that used it

**Complexity:** L **Category:** frontend **Dependencies:** #2, #3, #8 **Files:** `src/components/settings/ConnectionsSettings.tsx` (new)

---

### #10 — Build UseCaseRoutingSettings component and integrate into SettingsDialog

**Description:** Create the "Advanced" collapsible section showing the use-case-to-connection routing grid. Integrate both new components into the existing SettingsDialog, replacing the old AISettings provider/key section.

**Acceptance criteria:**

- Component at `src/components/settings/UseCaseRoutingSettings.tsx`
- Collapsible section labeled "Advanced" (collapsed by default)
- Grid/table showing 4 rows: Chat, Inline Actions, Inline Completion, Agent Tasks
- Each row: use case label, dropdown of compatible connections (filtered by capability), status indicator
- Dropdown shows "Not configured" when no connection assigned
- Incompatible connections are not shown in dropdowns (e.g., Ollama not shown for Agent Tasks)
- Integrate into `SettingsDialog.tsx`: replace the AI tab content with ConnectionsSettings + UseCaseRoutingSettings
- Existing PersonasSettings and PromptsSettings tabs remain unchanged
- Old AISettings component kept but no longer rendered (can be removed in a follow-up)

**Complexity:** L **Category:** frontend **Dependencies:** #3, #9 **Files:** `src/components/settings/UseCaseRoutingSettings.tsx` (new), `src/components/settings/SettingsDialog.tsx`

---

## Phase 6b: ACP Client + First Agent (Claude Code)

### #11 — Add agent-client-protocol crate dependency

**Description:** Add the `agent-client-protocol` and `agent-client-protocol-schema` crates to `Cargo.toml`. Verify the crate compiles and the key types (`ClientSideConnection`, `AgentInfo`, `SessionId`, etc.) are accessible.

**Acceptance criteria:**

- `agent-client-protocol = "0.9"` and `agent-client-protocol-schema = "0.6"` added to `Cargo.toml` under `[dependencies]`
- Section comment: `# ACP - Agent Client Protocol (Phase 6)`
- `cargo check` passes
- Can import key types in a test module

**Complexity:** S **Category:** backend **Dependencies:** None **Files:** `src-tauri/Cargo.toml`

---

### #12 — Implement ACP client state and subprocess spawning

**Description:** Create the core ACP client infrastructure in Rust: `AcpState` managed state, subprocess spawning, and the `initialize` handshake. This is the foundation for all agent communication.

**Acceptance criteria:**

- New module `src-tauri/src/commands/acp.rs` (extends from #4)
- `AcpState` struct with `Mutex<HashMap<String, AcpAgentProcess>>` (managed state in `lib.rs`)
- `acp_agent_spawn` command: spawns agent binary as `tokio::process::Command` with stdio piped, creates `ClientSideConnection`, sends `initialize`, stores in `AcpState`
- Returns a `connection_id` (UUID)
- Accepts `env_vars` for passing API keys as environment variables
- Sets working directory to `working_directory` parameter
- `acp_agent_stop` command: sends shutdown, kills process, removes from state
- Error handling: binary not found, initialization failed, timeout
- Follow the subprocess pattern from `commands/watcher.rs` (managed state + Mutex)

**Complexity:** L **Category:** backend **Dependencies:** #4, #11 **Files:** `src-tauri/src/commands/acp.rs`, `src-tauri/src/lib.rs`

---

### #13 — Implement ACP authenticate command

**Description:** Add the `acp_agent_authenticate` Tauri command that sends the ACP `authenticate` method to the agent subprocess. For `agent_managed` connections, this triggers the agent's internal auth flow (e.g., browser popup for subscription login).

**Acceptance criteria:**

- `acp_agent_authenticate` command in `acp.rs`
- Takes `connection_id` and optional credentials (API key for api_key auth, nothing for agent_managed)
- For agent_managed: sends ACP `authenticate` with no credentials, agent handles it internally
- For api_key: sends ACP `authenticate` with the API key (or relies on env var set during spawn)
- Returns `AuthStatus { authenticated: bool, user_label: Option<String> }`
- Handles auth failure gracefully (returns error, doesn't crash the agent)

**Complexity:** M **Category:** backend **Dependencies:** #12 **Files:** `src-tauri/src/commands/acp.rs`

---

### #14 — Implement ACP session management commands

**Description:** Add Tauri commands for ACP session lifecycle: `session/new`, `session/load`, `session/cancel`.

**Acceptance criteria:**

- `acp_session_new(connection_id)` → sends ACP `session/new`, returns `session_id`
- `acp_session_load(connection_id, session_id)` → sends ACP `session/load` to resume a previous session
- `acp_session_cancel(connection_id, session_id)` → sends ACP `session/cancel` notification
- Session IDs tracked in `AcpAgentProcess.sessions`
- Errors: agent not found, agent not authenticated, session not found

**Complexity:** M **Category:** backend **Dependencies:** #12 **Files:** `src-tauri/src/commands/acp.rs`

---

### #15 — Implement ACP session/prompt with streaming events

**Description:** Implement the core `acp_session_prompt` Tauri command that sends a prompt to the agent and translates ACP `session/update` notifications into Tauri window events for the frontend.

**Acceptance criteria:**

- `acp_session_prompt(window, connection_id, session_id, prompt, context)` command
- Sends ACP `session/prompt` with the user's message
- Listens for ACP `session/update` notifications and emits Tauri events:
  - `agent_message_chunk` → `acp-text-delta { sessionId, content }`
  - `tool_call` → `acp-tool-call { sessionId, tool, input }`
  - `plan` → `acp-plan-update { sessionId, plan }`
- On `session/prompt` response (turn complete): emits `acp-turn-complete { sessionId, stopReason }`
- Handles `session/request_permission` from agent: emits `acp-permission-request { sessionId, requestId, tool, description }` and waits for `acp_permission_respond` command
- `acp_permission_respond(connection_id, request_id, decision)` sends the response back through ACP
- Follow the streaming pattern from `commands/ai_streaming.rs` (window.emit for events)

**Complexity:** L **Category:** backend **Dependencies:** #12, #14 **Files:** `src-tauri/src/commands/acp.rs`

---

### #16 — Create useAgentOperations hook

**Description:** Create a frontend hook for agent task operations, analogous to `useAIOperations` for chat. Handles spawning agents, sending prompts, and managing event listeners.

**Acceptance criteria:**

- Hook at `src/hooks/useAgentOperations.ts`
- `startAgent(workingDirectory)`: invokes `acp_agent_spawn` with the agent binary from the `agent_tasks` routing, passes API key as env var if applicable
- `authenticate()`: invokes `acp_agent_authenticate`
- `sendPrompt(sessionId, prompt)`: invokes `acp_session_prompt`, listens for `acp-*` Tauri events
- `cancelTask(sessionId)`: invokes `acp_session_cancel`
- `respondToPermission(requestId, decision)`: invokes `acp_permission_respond`
- Returns streaming state: `{ isRunning, textContent, activeTool, pendingPermission, plan }`
- Cleans up event listeners on unmount or new prompt

**Complexity:** L **Category:** frontend **Dependencies:** #3, #12, #13, #14, #15 **Files:** `src/hooks/useAgentOperations.ts` (new)

---

### #17 — Bridge ACP permission requests to inline diff review

**Description:** When an ACP agent requests permission to edit a file, bridge this to the existing external change review infrastructure. Display the proposed changes as inline diffs so the user can accept/reject.

**Acceptance criteria:**

- When `acp-permission-request` event arrives with tool `write_file` or `edit_file`:
  - Read current file content from disk (via `read_file` command)
  - Compute diff against proposed content
  - Create entries in `external-change-store` with the proposed changes
  - Show inline diff decorations in the editor (reuse existing `InlineDiff` plugin)
- User accepts → call `respondToPermission(requestId, "allow_once")` → agent proceeds
- User rejects → call `respondToPermission(requestId, "reject_once")` → agent receives rejection
- For non-file permissions (terminal commands): show a simple accept/reject dialog
- Integration point: `useAgentOperations` + `external-change-store` + `Editor.tsx`

**Complexity:** L **Category:** both **Dependencies:** #16 **Files:** `src/hooks/useAgentOperations.ts`, `src/components/editor/Editor.tsx`

---

### #18 — Register ACP commands and state in lib.rs

**Description:** Wire up all ACP commands and managed state in the Tauri builder. Ensure the module is exported from `commands/mod.rs`.

**Acceptance criteria:**

- `AcpState::new()` added to `.manage()` in `lib.rs`
- All ACP commands registered in `generate_handler![]`: `acp_agent_spawn`, `acp_agent_authenticate`, `acp_agent_stop`, `acp_agent_check_availability`, `acp_session_new`, `acp_session_prompt`, `acp_session_cancel`, `acp_session_load`, `acp_permission_respond`
- `pub mod acp;` and `pub use acp::*;` added to `commands/mod.rs`
- `cargo check` passes
- App launches without errors

**Complexity:** S **Category:** backend **Dependencies:** #12, #13, #14, #15 **Files:** `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`

---

## Phase 6c: Additional ACP Agents & Polish

### #19 — Add agent connection flow to ConnectionsSettings

**Description:** Extend the ConnectionsSettings UI to support adding `agent_managed` connections (subscription-based). When user clicks "Connect Claude Code" or "Connect Codex", spawn the agent, trigger auth, and store the connection.

**Acceptance criteria:**

- Provider picker includes agent options: "Claude Code (Subscription)", "OpenAI Codex (Subscription)", "GitHub Copilot (Subscription)"
- Selecting an agent option:
  1. Checks binary availability (shows install instructions if missing)
  2. Spawns agent via `acp_agent_spawn`
  3. Triggers `acp_agent_authenticate` (shows "Authenticating..." spinner)
  4. On success: creates Connection with `agent_managed` auth, auto-assigns to `agent_tasks` (and `inline_completion` for Copilot)
  5. On failure: shows error with retry option
- Connection card shows "Subscription" badge and agent binary name
- "Disconnect" stops the agent subprocess

**Complexity:** L **Category:** frontend **Dependencies:** #4, #9, #16 **Files:** `src/components/settings/ConnectionsSettings.tsx`

---

### #20 — Test and integrate Codex CLI ACP adapter

**Description:** Verify the Codex CLI works as an ACP agent through Notesage's ACP client. Test spawn, authenticate (both API key and ChatGPT subscription), session prompt, and file change flow.

**Acceptance criteria:**

- Codex CLI can be spawned via `acp_agent_spawn` with `agent_id: "codex"`
- API key auth works (pass `CODEX_API_KEY` env var)
- Subscription auth works (device flow opens browser)
- Session prompt streams text deltas back to frontend
- File change permission requests surface in Notesage
- Document any Codex-specific quirks or ACP compatibility issues

**Complexity:** M **Category:** both **Dependencies:** #15, #16, #19 **Files:** (testing/integration — no new files, may need minor adjustments to `acp.rs`)

---

### #21 — Test and integrate GitHub Copilot ACP agent

**Description:** Verify GitHub Copilot works as an ACP agent through Notesage's ACP client. Test spawn, authenticate (subscription), and session prompt.

**Acceptance criteria:**

- Copilot CLI can be spawned via `acp_agent_spawn` with `agent_id: "copilot"`
- OAuth device flow authentication works (opens browser for GitHub login)
- Session prompt works and streams responses
- Document Copilot-specific limitations (premium request consumption, agent capability scope)
- Document any ACP compatibility issues

**Complexity:** M **Category:** both **Dependencies:** #15, #16, #19 **Files:** (testing/integration — no new files, may need minor adjustments to `acp.rs`)

---

### #22 — Add agent picker to routing settings

**Description:** Extend UseCaseRoutingSettings to show which ACP agent is assigned to the `agent_tasks` use case, with a dropdown to switch between available agents. Show availability status.

**Acceptance criteria:**

- Agent Tasks row in the routing grid shows the connected agent (Claude Code, Codex, Copilot)
- Dropdown lists all `agent_managed` + `api_key` connections that support `agent_tasks`
- Each option shows: provider logo, name, auth badge, availability status
- Changing agent: updates routing-store, stops old agent, starts new agent on next use
- "Not installed" agents shown greyed out with install instructions tooltip

**Complexity:** S **Category:** frontend **Dependencies:** #10, #19 **Files:** `src/components/settings/UseCaseRoutingSettings.tsx`

---

## Summary Table

| \# | Title | Complexity | Category | Phase | Dependencies |
| --- | --- | --- | --- | --- | --- |
| 1 | Define connection and routing types | S | frontend | 6a | — |
| 2 | Create connections-store | M | frontend | 6a | #1 |
| 3 | Create routing-store | M | frontend | 6a | #1, #2 |
| 4 | Add agent binary availability check command | M | backend | 6a | — |
| 5 | Migrate v1 ai-store to connections/routing | M | frontend | 6a | #2, #3 |
| 6 | Refactor useAIOperations to use routing-store | L | frontend | 6a | #1-3, #5 |
| 7 | Update getAIProvider for connection-based resolution | S | frontend | 6a | #1 |
| 8 | Build ConnectionCard component | M | frontend | 6a | #1 |
| 9 | Build ConnectionsSettings component | L | frontend | 6a | #2, #3, #8 |
| 10 | Build UseCaseRoutingSettings + integrate into SettingsDialog | L | frontend | 6a | #3, #9 |
| 11 | Add agent-client-protocol crate dependency | S | backend | 6b | — |
| 12 | Implement ACP client state and subprocess spawning | L | backend | 6b | #4, #11 |
| 13 | Implement ACP authenticate command | M | backend | 6b | #12 |
| 14 | Implement ACP session management commands | M | backend | 6b | #12 |
| 15 | Implement ACP session/prompt with streaming events | L | backend | 6b | #12, #14 |
| 16 | Create useAgentOperations hook | L | frontend | 6b | #3, #12-15 |
| 17 | Bridge ACP permission requests to inline diff review | L | both | 6b | #16 |
| 18 | Register ACP commands and state in lib.rs | S | backend | 6b | #12-15 |
| 19 | Add agent connection flow to ConnectionsSettings | L | frontend | 6c | #4, #9, #16 |
| 20 | Test and integrate Codex CLI ACP adapter | M | both | 6c | #15, #16, #19 |
| 21 | Test and integrate GitHub Copilot ACP agent | M | both | 6c | #15, #16, #19 |
| 22 | Add agent picker to routing settings | S | frontend | 6c | #10, #19 |

**Complexity breakdown:** 5S, 9M, 8L

**Critical path:** #1 → #2 → #3 → #5 → #6 (chat keeps working) and #11 → #12 → #15 → #16 → #17 (first agent works end-to-end)

**High blast radius tasks:** #6 (refactors the hook everything depends on), #10 (modifies SettingsDialog), #18 (modifies lib.rs)