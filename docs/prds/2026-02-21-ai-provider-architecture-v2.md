# PRD: AI Provider Architecture v2

**Date:** 2026-02-21 **Status:** Draft **Phase:** 6 (Agentic AI Collaboration) — foundational architecture

## Problem

Notesage's current AI integration has a single provider abstraction that conflates authentication, capabilities, and use cases into one selection. Users must choose one provider for everything, authenticate only via API keys, and cannot leverage their existing subscriptions (GitHub Copilot, ChatGPT Plus/Pro). As we add agent capabilities (delegated tasks, inline completion), the architecture needs to support:

1. **Subscription-based auth** alongside API keys — users should not have to pay separately when they already have a subscription
2. **Per-use-case provider routing** — different providers for chat, inline actions, inline completion, and agent tasks
3. **Agent execution** — a fundamentally different capability from chat that requires new abstractions

The current single-provider, single-auth-method model cannot support this.

## Research Findings (Critical Constraints)

Thorough research of all provider ecosystems reveals hard constraints and a key protocol discovery that shape this architecture.

### Agent Client Protocol (ACP) — The Unifying Standard

**ACP is an open standard (Apache 2.0) that standardizes communication between editors and AI coding agents** — analogous to how LSP standardized language server integration. Created by Zed Industries in 2025, it has been adopted by major editors (Zed, JetBrains, Neovim, Kiro) and 16+ agents.

Key facts:

- **Official Rust SDK**: `agent-client-protocol` crate on crates.io (v0.9.4) — perfect for Tauri integration
- **Transport**: JSON-RPC 2.0 over stdio (client spawns agent as subprocess)
- **Lifecycle**: `initialize` → `authenticate` → `session/new` → `session/prompt` → streaming `session/update` notifications
- **Permission model**: Agents request permission via `session/request_permission` before executing tool calls (file edits, terminal commands) — maps directly to Notesage's existing inline diff review UI
- **Session management**: Create, load, resume sessions — enables multi-turn agent collaboration
- **MCP tunneling**: ACP supports MCP-over-ACP, letting agents access editor-provided tools through the same stdio channel

**Registered ACP agents (as of February 2026)**:Claude Agent (Anthropic), Codex CLI (OpenAI), GitHub Copilot, Gemini CLI (Google), Junie (JetBrains), Auggie CLI (Augment Code), Cline, Kimi CLI (Moonshot AI), Mistral Vibe, OpenCode, Qwen Code (Alibaba), Codebuddy Code (Tencent), Factory Droid, Corust Agent, Qoder CLI, Stakpak

**Why ACP instead of custom per-agent drivers**: Without ACP, supporting N agents requires N custom integrations with N different subprocess protocols. With ACP, Notesage implements the client once and gets all ACP-compatible agents for free. New agents (Gemini, Junie, etc.) work automatically.

Sources: [ACP Spec](https://agentclientprotocol.com/get-started/introduction), [ACP Registry](https://agentclientprotocol.com/get-started/registry), [Rust SDK](https://crates.io/crates/agent-client-protocol), [Zed + Claude Code via ACP](https://zed.dev/blog/claude-code-via-acp)

### Anthropic (Claude Code)

- **Subscription auth IS possible via Claude Code subprocess.** The ban (January 2026) applies to third-party apps calling the Anthropic Messages API directly with subscription OAuth tokens. However, running Claude Code as a subprocess — where Claude Code manages its own auth internally — is allowed. Zed editor proves this: users run `/login` inside a Claude Agent thread and choose "Log in with Claude Code" to authenticate with their Claude Pro/Max subscription. Notesage never touches the subscription token; Claude Code handles it.
- **ACP integration via adapter**: Zed's `@zed-industries/claude-agent-acp` (Apache 2.0) wraps the Claude Agent SDK and exposes it as an ACP-compatible agent. Notesage can use this same adapter. Anthropic declined to add native ACP support to Claude Code (GitHub issue #6686 closed as NOT_PLANNED), but the adapter approach is production-proven in Zed.
- **Claude Code CLI** also supports direct headless mode (`-p` flag, `--output-format stream-json`) as a fallback if ACP is not preferred.
- **Chat/inline actions** continue to work via the existing Messages API with API keys (no change to current behavior).

### GitHub Copilot

- **ACP-compatible agent** — registered in the ACP registry (v1.430.0). Agent tasks work through ACP with subscription auth.
- **Copilot Language Server** (`@github/copilot-language-server`, MIT-licensed) provides inline completions via LSP over stdio. Used by Neovim, Emacs, Helix. This is the integration path for inline completion (separate from ACP).
- **No public API** for chat or completions for third-party apps. The `copilot_internal` endpoints are undocumented and restricted to official clients.
- **Authentication** uses OAuth device flow. Uses the subscription — no separate billing.
- **No chat API** — Copilot cannot be used for the chat panel or inline actions (Improve/Summarize/Expand).

### OpenAI Codex

- **ACP-compatible agent** — registered in the ACP registry (v0.9.4, adapter by Zed Industries). Agent tasks work through ACP.
- **App-server mode** (`codex app-server`) provides a native JSON-RPC over stdio interface — purpose-built for third-party integration, with richer features than ACP (thread management, approval workflows, sandbox policies). Can be used as an alternative to ACP.
- **ChatGPT subscription auth** is supported via `chatgptAuthTokens` external auth mode (app-server) and via `codex login --device-auth` (CLI). Users authenticate with their existing ChatGPT Plus/Pro/Business subscription.
- **API key auth** also supported (standard per-token billing).
- **Chat** works via existing Responses API (already implemented in Notesage).

### Ollama

- **Local-only**, no auth required. Works for chat, inline actions. No agent capabilities, no ACP support.

### Provider Capability Matrix (Revised)

| Capability | Anthropic | OpenAI | GitHub Copilot | Ollama |
| --- | --- | --- | --- | --- |
| **Chat** | API key (Messages API) | API key (Responses API) | Not available | Local HTTP |
| **Inline actions** | API key (Messages API) | API key (Responses API) | Not available | Local HTTP |
| **Inline completion** | Not available | Not available | Subscription (LSP) | Not available |
| **Agent tasks (ACP)** | Subscription or API key (Claude Code) | Subscription or API key (Codex CLI) | Subscription (Copilot) | Not available |
| **Subscription auth** | Yes (via Claude Code subprocess) | Yes (Codex) | Yes (LSP + CLI) | N/A |
| **API key auth** | Yes | Yes | No | N/A |

## Goals

1. **Subscription-first agent mode** — Users with GitHub Copilot or ChatGPT subscriptions can use agent features without API keys
2. **Per-use-case provider routing** — Independent provider selection for chat, inline actions, inline completion, and agent tasks, with smart defaults so setup is not a hurdle
3. **Backward compatible** — Existing API key-based providers continue to work unchanged for chat and inline actions
4. **Extensible** — Adding new providers or auth methods requires minimal changes to the core abstractions
5. **Progressive disclosure** — Basic setup is one click; advanced per-use-case routing is opt-in

## Non-Goals

- Building a custom agent runtime (we use ACP-compatible agents as subprocesses)
- Reverse-engineering undocumented APIs (Copilot internal endpoints)
- Calling the Anthropic Messages API with subscription tokens (banned — we use Claude Code subprocess instead, which manages its own auth)
- Full agent task delegation UX (separate PRD — this PRD covers the provider/auth infrastructure)
- Inline completion UX (separate PRD — this PRD covers the Copilot LSP integration architecture)

## User Stories

**US-1:** As a GitHub Copilot subscriber, I want to use my existing subscription for agent tasks and inline completions, so that I don't pay twice for AI capabilities.

**US-2:** As a ChatGPT Plus subscriber, I want to use my subscription for agent tasks via Codex, so that agent mode is included in what I already pay for.

**US-3:** As an Anthropic API user, I want to continue using my API key for chat and inline actions, while using Copilot for agent tasks, so I get the best of both worlds.

**US-4:** As a new user, I want to sign in with GitHub and immediately start using AI features, without having to understand the difference between providers, use cases, or auth methods.

**US-5:** As a power user, I want to assign specific providers to specific use cases (e.g., Anthropic for chat, Copilot for completions, Codex for agent tasks), so each use case uses the best available tool.

**US-6:** As a user, I want to see which providers I've connected and what each one is being used for, so I understand my AI setup at a glance.

## Technical Approach

### Core Abstractions

The architecture introduces three new concepts that layer on top of (not replace) the existing system:

#### 1. Connections (Auth Layer)

A **Connection** represents an authenticated link to a provider. A user can have multiple connections (e.g., Anthropic API key + GitHub OAuth + OpenAI API key).

```typescript
type AuthMethod =
  | 'api_key'         // User provides an API key (Anthropic, OpenAI)
  | 'agent_managed'   // Agent subprocess handles its own auth (subscription via ACP)
  | 'local';          // No auth needed (Ollama)

interface Connection {
  id: string;
  provider: ConnectionProvider;
  authMethod: AuthMethod;
  status: 'connected' | 'expired' | 'error' | 'not_installed';
  label: string; // User-facing label, e.g., "Claude Code (Pro subscription)"
  credentials: ConnectionCredentials;
  createdAt: number;
}

type ConnectionProvider =
  | 'anthropic'    // API key (chat) or agent-managed subscription (Claude Code via ACP)
  | 'openai'       // API key (chat) or agent-managed subscription (Codex via ACP)
  | 'github'       // Agent-managed subscription (Copilot via ACP + LSP)
  | 'ollama';      // Local, no auth

type ConnectionCredentials =
  | { type: 'api_key'; key: string }
  | { type: 'agent_managed'; agentBinary: string }  // e.g., "claude-agent-acp"
  | { type: 'local'; url: string };
```

Note: `agent_managed` connections do not store tokens. The agent subprocess handles authentication internally (subscription login, token refresh, etc.). Notesage only stores which binary to spawn and the connection status.

#### 2. Capabilities (What a Connection Can Do)

Each connection exposes specific capabilities based on the provider:

```typescript
type AICapability = 'chat' | 'inline_actions' | 'inline_completion' | 'agent_tasks';

// Capability map varies by auth method — subscription unlocks agent capabilities
const PROVIDER_CAPABILITIES: Record<ConnectionProvider, Record<AuthMethod, AICapability[]>> = {
  anthropic: {
    api_key:       ['chat', 'inline_actions', 'agent_tasks'],  // Agent via ANTHROPIC_API_KEY env
    agent_managed: ['agent_tasks'],                             // Agent via Claude Code subscription
    local:         [],
  },
  openai: {
    api_key:       ['chat', 'inline_actions', 'agent_tasks'],  // Agent via CODEX_API_KEY env
    agent_managed: ['agent_tasks'],                             // Agent via ChatGPT subscription
    local:         [],
  },
  github: {
    api_key:       [],
    agent_managed: ['inline_completion', 'agent_tasks'],        // All via subscription
    local:         [],
  },
  ollama: {
    api_key:       [],
    agent_managed: [],
    local:         ['chat', 'inline_actions'],
  },
};
```

Note: An Anthropic API key connection provides chat + inline actions + agent tasks (the API key is passed to the Claude Code subprocess as `ANTHROPIC_API_KEY`). A separate Anthropic `agent_managed` connection provides agent tasks via Claude Pro/Max subscription. A user can have both — API key for chat, subscription for agent tasks.

#### 3. Use Case Routing (Assignment Layer)

The user assigns a connection to each use case. Smart defaults auto-assign when a connection is added.

```typescript
interface UseCaseRouting {
  chat: string | null;               // Connection ID
  inline_actions: string | null;     // Connection ID
  inline_completion: string | null;  // Connection ID
  agent_tasks: string | null;        // Connection ID
}
```

### Default Behavior (Progressive Disclosure)

When a user connects their first provider, the system auto-assigns it to all compatible use cases:

- **User adds Anthropic API key** → auto-assigned to `chat` + `inline_actions`
- **User connects GitHub** → auto-assigned to `inline_completion` + `agent_tasks`
- **User adds OpenAI API key** → auto-assigned to `chat` + `inline_actions` (doesn't override existing)
- **User connects OpenAI (ChatGPT subscription)** → auto-assigned to `agent_tasks` (if no agent provider yet)

The "Advanced" section in settings reveals the per-use-case routing grid for power users.

### Agent Execution Architecture — ACP Client

**Notesage implements the ACP Client trait once.** All agent communication goes through the standardized ACP protocol. This is the core architectural decision — no custom per-agent drivers.

The Tauri Rust backend uses the `agent-client-protocol` crate to:

1. Spawn an ACP-compatible agent as a subprocess (stdio transport)
2. Initialize the connection and negotiate capabilities
3. Authenticate (delegates to the agent's own auth — subscription or API key)
4. Create sessions, send prompts, receive streaming updates
5. Handle permission requests (file edits, terminal commands) by forwarding to the frontend

```
Tauri Rust Backend (ACP Client)
  ├── Uses: agent-client-protocol crate (ClientSideConnection)
  ├── Spawns: agent subprocess over stdio
  ├── Sends: initialize, authenticate, session/new, session/prompt
  ├── Receives: session/update (text chunks, tool calls, file changes, plans)
  ├── Handles: session/request_permission → forwards to frontend for user approval
  └── Emits: Tauri events to frontend (agent-text-delta, agent-file-change, agent-permission-request, etc.)
```

#### ACP Message Flow (Typical Agent Task)

```
1. Client → Agent:  initialize { protocolVersion, clientInfo, capabilities }
2. Agent → Client:  initialize response { agentInfo, capabilities }
3. Client → Agent:  authenticate { ... }  (if agent requires it)
4. Client → Agent:  session/new {}
5. Agent → Client:  session/new response { sessionId }
6. Client → Agent:  session/prompt { sessionId, prompt: [{ type: "text", text: "Fix the bug in..." }] }
7. Agent → Client:  session/update { kind: "agent_message_chunk", content: "I'll look at..." }
8. Agent → Client:  session/request_permission { tool: "write_file", path: "/src/main.rs", ... }
9. Client → Agent:  session/request_permission response { decision: "allow_once" }
10. Agent → Client: session/update { kind: "agent_message_chunk", content: "Done. I've fixed..." }
11. Client ← Agent: session/prompt response { stopReason: "end_turn" }
```

#### ACP Agent Adapters (Per Provider)

Each agent provider has an ACP adapter (most already exist):

**Claude Code (via** `@zed-industries/claude-agent-acp`**):**

- Apache 2.0 licensed adapter, production-proven in Zed
- Wraps the Claude Agent SDK, which in turn spawns the `claude` CLI
- Auth: users run `/login` within the ACP session to authenticate with Claude Pro/Max subscription, or the adapter picks up `ANTHROPIC_API_KEY` from environment
- Full agent capabilities: file read/write/edit, terminal commands, web search

**Codex CLI (via ACP adapter or native** `codex app-server`**):**

- ACP adapter available in the registry (v0.9.4, by Zed Industries)
- Alternatively, the native `codex app-server --transport stdio` provides a richer JSON-RPC interface that could be wrapped as an ACP-compatible connection
- Auth: ChatGPT subscription (device flow) or `CODEX_API_KEY`
- Full agent capabilities with sandbox policies

**GitHub Copilot (ACP-compatible, v1.430.0):**

- Registered in the ACP registry
- Auth: GitHub OAuth device flow, uses Copilot subscription
- Each prompt consumes a premium request

**Other ACP agents (bonus — work automatically):**

- Gemini CLI (Google) — free tier available
- Junie (JetBrains) — for JetBrains ecosystem users
- Cline, OpenCode, Mistral Vibe, etc.

#### Agent Auth: Subscription Passthrough via ACP

This is the key insight that enables subscription-based agent mode:

**Notesage never handles subscription tokens directly.** The ACP `authenticate` method delegates to the agent subprocess, which manages its own auth flow. For Claude Code, the user runs `/login` and authenticates in a browser popup — the subscription token stays inside Claude Code's process. For Codex, the `chatgptAuthTokens` flow works similarly. Notesage only needs to store a Connection record indicating "this agent is authenticated via subscription."

For API key connections, Notesage passes the key via environment variable when spawning the agent subprocess (e.g., `ANTHROPIC_API_KEY`, `CODEX_API_KEY`).

#### Permission Request → Inline Diff Review Bridge

When an ACP agent requests permission to edit a file (`session/request_permission` with tool `write_file`), Notesage:

1. Reads the current file content from disk
2. Computes the diff against the proposed content
3. Displays the diff using the existing inline diff review UI (Phase 5 infrastructure)
4. User accepts/rejects → response sent back through ACP
5. If accepted, the agent proceeds; file watcher detects the change and updates the editor

### Inline Completion Architecture (Copilot LSP)

The Copilot Language Server is spawned as a long-lived subprocess and communicated with via JSON-RPC (LSP protocol) over stdio.

```
Tauri Rust Backend
  ├── Spawns: @github/copilot-language-server --stdio
  ├── Sends: textDocument/didOpen, textDocument/didChange
  ├── Requests: textDocument/inlineCompletion
  └── Receives: InlineCompletionItem[] → emits to frontend as ghost text
```

- **Auth:** OAuth device flow via the LSP's `signIn` method (opens browser for GitHub login)
- **Document sync:** Editor content pushed to the LSP on every change (debounced)
- **Completion trigger:** Requested on cursor position change (debounced, configurable delay)
- **Uses subscription:** Inline completions count against the user's Copilot plan (unlimited on Pro+)

### Agent Auth Flow (Delegated to Agent Subprocess)

Unlike the chat providers (which use API keys passed via Tauri commands), agent authentication is **delegated to the agent subprocess** via ACP's `authenticate` method. Notesage does not implement OAuth flows for agent providers — the agents handle their own auth.

**How it works:**

1. User clicks "Connect Claude Code" in settings
2. Notesage spawns the `claude-agent-acp` adapter subprocess
3. Sends ACP `initialize` + `authenticate`
4. The adapter internally triggers Claude Code's login flow (browser popup)
5. User authenticates with Claude Pro/Max subscription (or enters API key)
6. Adapter confirms authentication via ACP response
7. Notesage stores a Connection record: `{ provider: 'anthropic', authMethod: 'agent_managed', status: 'connected' }`

For API key connections, Notesage passes the key as an environment variable when spawning the subprocess, and the agent picks it up automatically.

**For GitHub Copilot:**

- The Copilot ACP agent uses its own OAuth device flow internally
- User authenticates with their GitHub account in a browser
- Subscription-based — no API key needed

**For OpenAI Codex:**

- The Codex ACP adapter or native `codex app-server` handles ChatGPT subscription auth
- Device flow via `codex login --device-auth` or `chatgptAuthTokens` external auth mode
- Also supports `CODEX_API_KEY` env var for API key auth

### Migration from v1

The existing `ai-store` is preserved and continues to work. The new `connections-store` and `routing-store` are layered on top. A one-time migration converts existing settings:

- `ai-store.provider = 'anthropic'` + `ai-store.apiKeys.anthropic = 'sk-...'` → Creates an Anthropic Connection and assigns it to `chat` + `inline_actions`
- `ai-store.provider = 'openai'` + `ai-store.apiKeys.openai = 'sk-...'` → Creates an OpenAI Connection and assigns it to `chat` + `inline_actions`
- `ai-store.provider = 'ollama'` → Creates an Ollama Connection and assigns it to `chat` + `inline_actions`

After migration, the old `provider` and `apiKeys` fields are deprecated but not removed (for rollback safety).

## UI/UX

### Settings &gt; AI (Redesigned)

The AI settings page is reorganized into two sections:

**Section 1: Connections**

A card list showing all connected providers. Each card shows:

- Provider logo + name + auth type badge (API Key / Subscription)
- Connection status indicator (green dot = connected, yellow = expiring, red = error)
- "Configure" button to edit credentials
- "Disconnect" button

Below the list: "+ Add Connection" button opening a provider picker (Anthropic, OpenAI, GitHub, Ollama).

Adding Anthropic/OpenAI (API key): shows API key input field (same as today). Adding GitHub: initiates OAuth device flow, shows code + verification URL. Adding OpenAI (ChatGPT subscription): initiates OAuth device flow for ChatGPT auth. Adding Ollama: shows URL input (same as today).

**Section 2: Use Case Routing (collapsible, labeled "Advanced")**

A grid showing which connection handles each use case:

| Use Case | Provider | Status |
| --- | --- | --- |
| Chat | Anthropic (API Key) | Connected |
| Inline Actions | Anthropic (API Key) | Connected |
| Inline Completion | GitHub Copilot | Connected |
| Agent Tasks | OpenAI Codex (ChatGPT) | Connected |

Each row has a dropdown to reassign to a different compatible connection.

**Smart defaults:** When the user first opens settings and adds their first connection, everything auto-assigns. The "Advanced" section is collapsed by default. Most users never need to open it.

### Connection Status Indicators

Throughout the app (chat panel, status bar, agent task UI), show which provider is active for the current operation:

- Chat panel header: provider logo + name
- Inline completion ghost text: subtle provider indicator
- Agent task panel: provider logo + subscription/API badge

### Error States

- **No provider for use case:** Toast with "Set up an AI provider in Settings" CTA
- **OAuth token expired:** Toast with "Reconnect to GitHub" CTA, auto-opens re-auth flow
- **Agent binary not found:** Toast with installation instructions for the relevant CLI
- **Rate limit exceeded:** Toast with "Copilot premium requests used. Switch to API key?" CTA

## Data Model

### New Stores

`connections-store.ts` (Zustand, persisted):

```typescript
interface ConnectionsStore {
  connections: Connection[];

  addConnection: (conn: Omit<Connection, 'id' | 'createdAt'>) => string; // returns ID
  updateConnection: (id: string, updates: Partial<Connection>) => void;
  removeConnection: (id: string) => void;
  getConnection: (id: string) => Connection | undefined;
  getConnectionsByProvider: (provider: ConnectionProvider) => Connection[];
}
```

`routing-store.ts` (Zustand, persisted):

```typescript
interface RoutingStore {
  routing: UseCaseRouting;

  setRouting: (useCase: AICapability, connectionId: string | null) => void;
  getConnectionForUseCase: (useCase: AICapability) => Connection | null;
  autoAssign: (connectionId: string) => void; // Smart default assignment
}
```

### Modified Stores

`ai-store.ts`: Personas, custom prompts, and `suggestionsEnabled` remain. The `provider`, `apiKeys`, and `ollamaUrl` fields are deprecated (kept for migration).

`chat-store.ts`: No changes needed — it already delegates provider selection to `useAIOperations`.

### New Tauri Commands

```rust
// ACP agent management
#[tauri::command]
pub async fn acp_agent_spawn(
    app: AppHandle,
    agent_id: String,        // e.g., "claude-agent-acp", "codex-cli", "copilot"
    working_directory: String,
    env_vars: Option<HashMap<String, String>>,  // e.g., { "ANTHROPIC_API_KEY": "sk-..." }
) -> Result<String, String>; // returns connection_id

#[tauri::command]
pub async fn acp_agent_authenticate(connection_id: String) -> Result<AuthStatus, String>;

#[tauri::command]
pub async fn acp_session_new(connection_id: String) -> Result<String, String>; // returns session_id

#[tauri::command]
pub async fn acp_session_prompt(
    window: tauri::Window,
    connection_id: String,
    session_id: String,
    prompt: String,
    context: Option<String>,  // Project context, goals, etc.
) -> Result<(), String>;  // Streams events via Tauri window events

#[tauri::command]
pub async fn acp_session_cancel(connection_id: String, session_id: String) -> Result<(), String>;

#[tauri::command]
pub async fn acp_session_load(connection_id: String, session_id: String) -> Result<(), String>;

#[tauri::command]
pub async fn acp_permission_respond(
    connection_id: String,
    request_id: String,
    decision: String,  // "allow_once" | "allow_always" | "reject_once" | "reject_always"
) -> Result<(), String>;

#[tauri::command]
pub async fn acp_agent_stop(connection_id: String) -> Result<(), String>;

#[tauri::command]
pub async fn acp_agent_check_availability(agent_id: String) -> Result<AgentAvailability, String>;

// Copilot LSP management (separate from ACP — LSP is for inline completions)
#[tauri::command]
pub async fn copilot_lsp_start(app: AppHandle) -> Result<(), String>;

#[tauri::command]
pub async fn copilot_lsp_stop(app: AppHandle) -> Result<(), String>;

#[tauri::command]
pub async fn copilot_lsp_request_completion(
    file_path: String,
    content: String,
    cursor_line: u32,
    cursor_character: u32,
) -> Result<Vec<InlineCompletion>, String>;
```

**Tauri events emitted during** `acp_session_prompt`**:**

- `acp-text-delta` (`{ sessionId, content }`) — streaming text from agent
- `acp-tool-call` (`{ sessionId, tool, input }`) — agent is using a tool
- `acp-file-change` (`{ sessionId, path, diff }`) — agent proposes a file edit
- `acp-permission-request` (`{ sessionId, requestId, tool, description }`) — agent needs approval
- `acp-plan-update` (`{ sessionId, plan }`) — agent's multi-step plan
- `acp-turn-complete` (`{ sessionId, stopReason }`) — turn finished

### Rust Managed State

```rust
pub struct AcpState {
    /// Active ACP agent connections keyed by connection_id
    agents: Mutex<HashMap<String, AcpAgentProcess>>,
}

struct AcpAgentProcess {
    /// The ClientSideConnection from the agent-client-protocol crate
    connection: ClientSideConnection,
    /// Child process handle for lifecycle management
    process: tokio::process::Child,
    /// Agent info from initialization
    agent_info: AgentInfo,
    /// Active sessions
    sessions: HashSet<String>,
}

pub struct CopilotLspState {
    /// Copilot Language Server subprocess + JSON-RPC transport
    process: Mutex<Option<LspProcess>>,
    /// Whether the user is authenticated
    authenticated: Mutex<bool>,
}
```

## Dependencies

### New Rust Dependencies

| Crate | Version | Purpose |
| --- | --- | --- |
| `agent-client-protocol` | 0.9.4 | ACP client implementation (JSON-RPC, session management, streaming) |
| `agent-client-protocol-schema` | 0.6.x | ACP type definitions (auto-generated from spec) |
| `lsp-types` | latest | LSP message serialization (Copilot Language Server integration) |

Existing deps (`tokio`, `serde`, `serde_json`, `futures`, `reqwest`) already cover async runtime, serialization, and HTTP.

### External Binaries (User-Installed, for Agent Mode)

| Binary / Package | Required For | Install | Auth |
| --- | --- | --- | --- |
| `@zed-industries/claude-agent-acp` | Claude Code agent (ACP) | `npm install -g @zed-industries/claude-agent-acp` | Subscription (`/login`) or `ANTHROPIC_API_KEY` env |
| `codex` | OpenAI Codex agent (ACP or native) | `npm install -g @openai/codex` or `brew install codex-cli` | Subscription (`codex login`) or `CODEX_API_KEY` env |
| `copilot` | GitHub Copilot agent (ACP) | `npm install -g @github/copilot` or `brew install copilot-cli` | Subscription (OAuth device flow) |
| `@github/copilot-language-server` | Inline completion (LSP) | Bundled with app or user-installed | Subscription (LSP `signIn` method) |

**Auto-detection**: Notesage checks for installed agent binaries at startup and on settings open, reporting availability per agent. Missing binaries show install instructions.

**Agent discovery**: The ACP registry can be queried for available agents. Future enhancement: let users install agents from a registry browser within settings.

### Prerequisite Work

- Phase 5 (Comments & Change Detection) — already completed. External change review infrastructure is needed for agent file change review via ACP permission requests.

## Implementation Phases

This PRD is large. It should be implemented in sub-phases:

### Phase 6a: Connections & Routing Infrastructure

- New stores (`connections-store`, `routing-store`)
- Migration from v1 ai-store
- Redesigned AI settings UI (Connections + Advanced routing)
- Update `useAIOperations` to resolve provider from routing store
- Existing chat/inline actions continue to work through new abstraction
- Agent binary availability detection

### Phase 6b: ACP Client + First Agent (Claude Code)

- Add `agent-client-protocol` Rust crate dependency
- Implement ACP client in Tauri backend (`AcpState`, spawn/initialize/authenticate)
- ACP session management Tauri commands (new, prompt, cancel, load)
- ACP permission request → frontend event bridge
- ACP streaming → Tauri event translation
- Claude Code agent integration via `claude-agent-acp` adapter
- Agent task UI (separate PRD for UX details)
- Permission request → inline diff review bridge (reuse Phase 5 infrastructure)

### Phase 6c: Additional ACP Agents

- OpenAI Codex agent via ACP adapter
- GitHub Copilot agent via ACP
- Agent picker in settings (choose which ACP agent to use for agent tasks)
- Test with additional ACP agents (Gemini CLI, etc.)

### Phase 6d: Inline Completion (Copilot LSP)

- Copilot Language Server integration (separate from ACP — LSP protocol)
- Ghost text rendering in the editor (ProseMirror decorations)
- Tab-to-accept interaction
- Document sync with LSP

### Phase 6e: Deep Codex Integration (Future Enhancement)

- Native Codex app-server integration (richer than ACP — thread management, approval workflows, sandbox policies)
- ChatGPT subscription auth via `chatgptAuthTokens` external auth mode
- Codex Cloud support for sandboxed execution

## Quality Gates

### Functional

- [ ] Existing API key auth works unchanged for Anthropic, OpenAI, Ollama

- [ ] Connections persist across app restarts

- [ ] Smart auto-assignment works: first connection fills all compatible use cases

- [ ] Per-use-case routing: chat, inline actions, inline completion, and agent tasks can use different providers

- [ ] Changing a use case's provider takes effect immediately (no app restart)

- [ ] Migration from v1 ai-store preserves existing configuration

- [ ] Agent binary availability check reports which ACP agents are installed

- [ ] ACP agent spawns, initializes, and authenticates (both API key and subscription)

- [ ] ACP session prompt streams text, tool calls, and file changes to frontend

- [ ] ACP permission requests surface in the UI and user can accept/reject

- [ ] Agent file changes trigger the existing external change review flow

- [ ] ACP session can be cancelled mid-turn

- [ ] ACP session can be resumed (load previous session)

- [ ] Claude Code subscription auth works via `/login` in ACP session

- [ ] OpenAI Codex subscription auth works via device flow in ACP session

- [ ] GitHub Copilot subscription auth works via OAuth in ACP session

### Design

- [ ] Connections list looks polished (provider logos, status indicators, clean layout)

- [ ] OAuth flow dialog is clear and guides the user through the browser step

- [ ] Advanced routing section is discoverable but not overwhelming

- [ ] Error states have clear CTAs (not just error messages)

- [ ] Both light and dark mode look correct

- [ ] Consistent with existing settings dialog design language

## Out of Scope

- **Direct Anthropic API with subscription tokens** — Banned by Anthropic's ToS as of January 2026. Subscription auth works via Claude Code subprocess (which manages its own auth), not via direct API calls.
- **Copilot chat** — No public API available. If GitHub releases one, it can be added as a new capability.
- **Agent task delegation UX** — How users create, monitor, and review agent tasks is a separate PRD. This PRD covers the infrastructure.
- **Inline completion UX** — Ghost text rendering, Tab-to-accept, trigger heuristics are a separate PRD. This PRD covers the Copilot LSP plumbing.
- **Model selection** — Letting users choose specific models (e.g., Claude Opus vs Sonnet, GPT-4o vs GPT-5) within a provider. Deferred.
- **Cost tracking / usage dashboard** — Showing API costs or subscription usage. Deferred.
- **Cloud provider auth (AWS Bedrock, Google Vertex, Azure)** — Enterprise deployment options. Deferred.
- **Custom ACP agent registration** — Letting users add arbitrary ACP agents from the registry. Deferred (start with Claude Code, Codex, Copilot).
- **ACP agent teams** — Multi-agent orchestration. Not yet supported by the protocol adapters.
- **Native ACP in Claude Code** — Anthropic declined (issue #6686). We rely on Zed's adapter.