# PRD: AI Provider Architecture v2

**Date:** 2026-02-21 **Status:** Draft **Phase:** 6 (Agentic AI Collaboration) — foundational architecture

## Problem

Notesage's current AI integration has a single provider abstraction that conflates authentication, capabilities, and use cases into one selection. Users must choose one provider for everything, authenticate only via API keys, and cannot leverage their existing subscriptions (GitHub Copilot, ChatGPT Plus/Pro, Claude Pro/Max). As we add agent capabilities (delegated tasks, inline completion), the architecture needs to support:

1. **Subscription-based auth** alongside API keys — users should not have to pay separately when they already have a subscription
2. **Per-use-case provider routing** — different providers for interactive AI (chat + inline actions), agent tasks, and inline completion ACP as the primary text generation path — not just for agent tasks, but for chat and inline actions

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

**Versatile prompting: session/prompt accepts any text prompt and streams back a response — this is not limited to agent tasks. Chat messages and inline actions (Improve, Summarize, Expand) are just shorter prompts sent to the same ACP session. Registered ACP agents (as of February 2026)**: Claude Agent (Anthropic), Codex CLI (OpenAI), GitHub Copilot, Gemini CLI (Google), Junie (JetBrains), Auggie CLI (Augment Code), Cline, Kimi CLI (Moonshot AI), Mistral Vibe, OpenCode, Qwen Code (Alibaba), Codebuddy Code (Tencent), Factory Droid, Corust Agent, Qoder CLI, Stakpak

**Why ACP instead of custom per-agent drivers**: Without ACP, supporting N agents requires N custom integrations with N different subprocess protocols. With ACP, Notesage implements the client once and gets all ACP-compatible agents for free. New agents (Gemini, Junie, etc.) work automatically.

Sources: [ACP Spec](https://agentclientprotocol.com/get-started/introduction), [ACP Registry](https://agentclientprotocol.com/get-started/registry), [Rust SDK](https://crates.io/crates/agent-client-protocol), [Zed + Claude Code via ACP](https://zed.dev/blog/claude-code-via-acp)

### Anthropic (Claude Code)

- **Subscription auth IS possible via Claude Code subprocess.** The ban (January 2026) applies to third-party apps calling the Anthropic Messages API directly with subscription OAuth tokens. However, running Claude Code as a subprocess — where Claude Code manages its own auth internally — is allowed. Zed editor proves this: users run `/login` inside a Claude Agent thread and choose "Log in with Claude Code" to authenticate with their Claude Pro/Max subscription. Notesage never touches the subscription token; Claude Code handles it.
- **ACP integration via adapter**: Zed's `@zed-industries/claude-agent-acp` (Apache 2.0) wraps the Claude Agent SDK and exposes it as an ACP-compatible agent. Notesage can use this same adapter. Anthropic declined to add native ACP support to Claude Code (GitHub issue #6686 closed as NOT_PLANNED), but the adapter approach is production-proven in Zed.
- **ACP handles ALL text generation: The Claude Code ACP agent accepts any prompt via session/prompt and streams back a response. This means chat messages and inline actions (Improve, Summarize, Expand) can be sent through the same ACP session — not just multi-step agent tasks. Users with a Claude Pro/Max subscription can use it for everything without an API key. Claude Code CLI also supports direct headless mode (-p flag, --output-format stream-json) as a fallback if ACP is not preferred. Direct API (fallback): The existing Messages API with API keys continues to work for users who prefer direct API access. GitHub Copilot ACP-compatible agent — registered in the ACP registry (v1.430.0). Through ACP, Copilot can handle chat, inline actions, and agent tasks — all with the user's** subscription.
- **Copilot Language Server** (`@github/copilot-language-server`, MIT-licensed) provides inline completions via LSP over stdio. Used by Neovim, Emacs, Helix. This is the integration path for inline completion (separate from ACP, optimized for keystroke-speed &lt;200ms latency).
- **No public direct API** for third-party apps. All Copilot AI capabilities for third-party integrations go through ACP (agent) or LSP (completions). Authentication uses OAuth device flow. Uses the subscription — no separate billing. Free tier available: Free GitHub accounts get 2,000 inline completions/month and limited agent interactions. This makes Copilot a great complement to another paid subscription (e.g., Claude Pro for interactive + free GitHub for completions).

### OpenAI Codex

- **ACP-compatible agent** — registered in the ACP registry (v0.9.4, adapter by Zed Industries). Through ACP, Codex can handle chat, inline actions, and agent tasks.
- **App-server mode** (`codex app-server`) provides a native JSON-RPC over stdio interface — purpose-built for third-party integration, with richer features than ACP (thread management, approval workflows, sandbox policies). Can be used as an alternative to ACP.
- **ChatGPT subscription auth** is supported via `chatgptAuthTokens` external auth mode (app-server) and via `codex login --device-auth` (CLI). Users authenticate with their existing ChatGPT Plus/Pro/Business subscription.
- **API key auth** also supported (standard per-token billing).
- **Direct API (fallback): The existing Responses API with API keys continues to work for chat**.

### Ollama

- **Local-only**, no auth required. Works for chat and inline actions via local HTTP. No agent capabilities, no ACP support.

### Provider Capability Matrix

The key insight: ACP agents can handle all text generation — not just multi-step agent tasks. Chat messages and inline actions are just prompts sent via session/prompt. This means subscription users can use their provider for everything. Capability Anthropic OpenAI GitHub Copilot Ollama Interactive (chat + i**nline actions**

\[table\]

1. **Progressive disclosure** — Connect one provider and everything works. Advanced routing is opt-in. Capability guidance helps new users choose the right subscription.

## Non-Goals

- Building a custom agent runtime (we use ACP-compatible agents as subprocesses)
- Reverse-engineering undocumented APIs (Copilot internal endpoints)
- Calling the Anthropic Messages API with subscription tokens (banned — we use Claude Code subprocess instead, which manages its own auth)
- Full agent task delegation UX (separate PRD — this PRD covers the provider/auth infrastructure)
- Inline completion UX (separate PRD — this PRD covers the Copilot LSP integration architecture)

## User Stories

**US-1:** As a GitHub Copilot subscriber, I want to use my existing subscription for inline completions and agent tasks, so that I don't pay twice for AI capabilities.

**US-2:** As a ChatGPT Plus subscriber, I want to use my subscription for chat, inline actions, and agent tasks via Codex, so that everything is included in what I already pay for.

**US-3:** As a Claude Pro subscriber, I want to use my subscription for chat, inline actions, and agent tasks via Claude Code, without needing an API key.

**US-4:** As a new user, I want to sign in with one provider and immediately start using all AI features, without having to understand the difference between providers, use cases, or auth methods.

**US-5:** As a power user, I want to assign specific providers to specific use cases (e.g., Claude for interactive, Copilot for completions, Codex for agent tasks), so each use case uses the best available tool.

**US-6:** As a user, I want to see which providers I've connected and what each one is being used for, so I understand my AI setup at a glance.

## US-7: As a new user without any AI subscription, I want to see which use cases each provider supports when I'm choosing what to connect, so I can pick the right subscription for my needs.

US-8: As a user with a paid subscription, I want to add a free GitHub account for inline completions (2,000/month), so I get the best of both worlds without extra cost. Technical Approach

### Core Abstractions

The architecture introduces three new concepts that layer on top of (not replace) the existing system:

#### 1. Connections (Auth Layer)

A **Connection** represents an authenticated link to a provider. A user can have multiple connections (e.g., Claude Code subscription + GitHub free + Ollama local).

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
  capabilities: AICapability[]; // What this connection can do (resolved from PROVIDER_CAPABILITIES)
  createdAt: number;
}

type ConnectionProvider =
  | 'anthropic'    // API key (direct API) or agent-managed subscription (Claude Code via ACP)
  | 'openai'       // API key (direct API) or agent-managed subscription (Codex via ACP)
  | 'github'       // Agent-managed subscription (Copilot via ACP + LSP)
  | 'ollama';      // Local, no auth

type ConnectionCredentials =
  | { type: 'api_key'; key: string }
  | { type: 'agent_managed'; agentBinary: string }  // e.g., "claude-agent-acp"
  | { type: 'local'; url: string };
```

Note: `agent_managed` connections do not store tokens. The agent subprocess handles authentication internally (subscription login, token refresh, etc.). Notesage only stores which binary to spawn and the connection status.

#### 2. Capabilities (What a Connection Can Do)

Each connection exposes specific capabilities based on the provider and auth method:

```typescript
type AICapability = 'interactive' | 'inline_completion' | 'agent_tasks';
// 'interactive' = chat + inline actions (Improve, Summarize, Expand)
// 'inline_completion' = ghost text / autocomplete
// 'agent_tasks' = delegated multi-step work

const PROVIDER_CAPABILITIES: Record<ConnectionProvider, Record<AuthMethod, AICapability[]>> = {
  anthropic: {
    api_key:       ['interactive', 'agent_tasks'],  // Direct API for interactive, agent via ANTHROPIC_API_KEY
    agent_managed: ['interactive', 'agent_tasks'],   // All via Claude Code ACP (subscription)
    local:         [],
  },
  openai: {
    api_key:       ['interactive', 'agent_tasks'],  // Direct API for interactive, agent via CODEX_API_KEY
    agent_managed: ['interactive', 'agent_tasks'],   // All via Codex ACP (subscription)
    local:         [],
  },
  github: {
    api_key:       [],
    agent_managed: ['interactive', 'inline_completion', 'agent_tasks'],  // All via subscription
    local:         [],
  },
  ollama: {
    api_key:       [],
    agent_managed: [],
    local:         ['interactive'],  // Chat + inline actions only
  },
};
```

Note: When an api_key connection is used for interactive, Notesage calls the provider's API directly (existing behavior). When an agent_managed connection is used for interactive, Notesage sends the prompt through the ACP agent session instead. The user doesn't need to know the difference — the routing layer handles it transparently.

#### 3. Use Case Routing (Assignment Layer)

The user assigns a connection to each use case slot. Smart defaults auto-assign when a connection is added.

```typescript
interface UseCaseRouting {
  interactive: string | null;        // Connection ID — handles chat + inline actions
  agent_tasks: string | null;        // Connection ID — handles delegated multi-step work
  inline_completion: string | null;  // Connection ID — handles ghost text (Copilot LSP)
}
Why 3 slots instead of 4: Chat and inline actions (Improve, Summarize, Expand) are the same kind of operation — send a prompt, get text back. They use the same underlying connection and benefit from the same long-lived agent process. Separating them would force users to configure two slots that almost always use the same provider.
```

### Default Behavior (Progressive Disclosure)

When a user connects their first provider, the system auto-assigns it to all compatible use case slots:

- **User connects Claude Code (subscription) → auto-assigned to interactive + agent_tasks User adds Anthropic API key → auto-assigned to interactive (if no interactive provider yet), agent_tasks (if no agent provider yet)**
- **User connects GitHub** Copilot → auto-assigned to `inline_completion` + `agent_tasks`
- **(if no agent provider yet). If the user has no interactive provider, also assigned to interactive**.nges (with user approval) Visible in the Agent Activity Panel with task status Stopped when the task completes (or kept for follow-ups) AcpState (Rust managed state) ├── Interactive agents: HashMap&lt;ConnectionId, AcpAgentProcess&gt; │ └── One per connected ACP provider, long-lived └── Task agents: HashMap&lt;TaskId, AcpAgentProcess&gt; └── One per active delegated task, short-lived Why separate instances: An interactive agent handling a chat conversation should not be blocked by a long-running agent task. Separate processes ensure isolation — the interactive agent responds instantly while a task agent works in the background.

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
  └── Emits: Tauri events to frontend (acp-text-delta, acp-file-change, acp-permission-request, etc.)
```

#### ACP Message Flow (Interactive Chat via ACP)

```
1. Client → Agent:  initialize { protocolVersion, clientInfo, capabilities }
2. Agent → Client:  initialize response { agentInfo, capabilities }
3. Client → Agent:  authenticate { ... }  (agent handles subscription login)
4. Client → Agent:  session/new {}
5. Agent → Client:  session/new response { sessionId }
6. Client → Agent:  session/prompt { sessionId, prompt: [{ type: "text", text: "Explain this code..." }] }
7. Agent → Client:  session/update { kind: "agent_message_chunk", content: "This code..." }
8. Agent → Client:  session/update { kind: "agent_message_chunk", content: " implements..." }
9. Client ← Agent:  session/prompt response { stopReason: "end_turn" }
--- Later, same session (multi-turn chat) ---
10. Client → Agent: session/prompt { sessionId, prompt: [{ type: "text", text: "Can you simplify it?" }] }
11. Agent → Client: session/update { kind: "agent_message_chunk", content: "Sure..." }
...
ACP Message Flow (Agent Task with File Changes)
1-5. [Same initialization as above, but using a task agent instance]
6. Client → Agent:  session/prompt { sessionId, prompt: [{ type: "text", text: "Fix the bug in auth.rs — login fails for users with special characters" }] }
7. Agent → Client:  session/update { kind: "agent_message_chunk", content: "I'll look at the auth module..." }
8. Agent → Client:  session/request_permission { tool: "read_file", path: "/src/auth.rs", ... }
9. Client → Agent:  session/request_permission response { decision: "allow_always" }
10. Agent → Client: session/request_permission { tool: "write_file", path: "/src/auth.rs", ... }
11. Client → Agent: [Shows inline diff to user] response { decision: "allow_once" }
12. Agent → Client: session/update { kind: "agent_message_chunk", content: "Done. I've escaped..." }
13. Client ← Agent: session/prompt response { stopReason: "end_turn" }
```

#### ACP Agent Adapters (Per Provider)

Each agent provider has an ACP adapter (most already exist):

**Claude Code (via** `@zed-industries/claude-agent-acp`**):**

- Apache 2.0 licensed adapter, production-proven in Zed
- Wraps the Claude Agent SDK, which in turn spawns the `claude` CLI
- Auth: users authenticate via the ACP authenticate flow (opens browser for subscription login), or the adapter picks up `ANTHROPIC_API_KEY` from environment
- Full capabilities: text generation (chat/inline), file read/write/edit, terminal commands, web search

**Codex CLI (via ACP adapter or native** `codex app-server`**):**

- ACP adapter available in the registry (v0.9.4, by Zed Industries)
- Alternatively, the native `codex app-server --transport stdio` provides a richer JSON-RPC interface that could be wrapped as an ACP-compatible connection
- Auth: ChatGPT subscription (device flow) or `CODEX_API_KEY`
- Full capabilities: text generation (chat/inline), file operations, sandbox policies

**GitHub Copilot (ACP-compatible, v1.430.0):**

- Registered in the ACP registry
- Auth: GitHub OAuth device flow, uses Copilot subscription
- Interactive requests and agent task prompts consume premium request

**Other ACP agents (bonus — work automatically):**

- Gemini CLI (Google) — free tier available
- Junie (JetBrains) — for JetBrains ecosystem users
- Cline, OpenCode, Mistral Vibe, etc.

#### Agent Auth: Subscription Passthrough via ACP

This is the key insight that enables subscription-based AI for everything:

**Notesage never handles subscription tokens directly.** The ACP `authenticate` method delegates to the agent subprocess, which manages its own auth flow. For Claude Code, the user authenticates in a browser popup — the subscription token stays inside Claude Code's process. For Codex, the `chatgptAuthTokens` flow works similarly. Notesage only needs to store a Connection record indicating "this agent is authenticated via subscription."

For API key connections, Notesage passes the key via environment variable when spawning the agent subprocess (e.g., `ANTHROPIC_API_KEY`, `CODEX_API_KEY`).

#### Permission Request → Inline Diff Review Bridge

When an ACP agent requests permission to edit a file (`session/request_permission` with tool `write_file`), Notesage:

1. Reads the current file content from disk
2. Computes the diff against the proposed content
3. Displays the diff using the existing inline diff review UI (Phase 5 infrastructure)
4. User accepts/rejects → response sent back through ACP
5. If accepted, the agent proceeds; file watcher detects the change and updates the editor

### Note: Permission requests only apply to agent tasks. Interactive operations (chat, inline actions) only generate text — they don't request file changes.

Inline Completion Architecture (Copilot LSP) Inline completion requires &lt;200ms latency — faster than ACP agent round-trips.

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
- **Uses subscription:** Inline completions count against the user's Copilot plan (unlimited on Pro+, 2,000/month on free tier)

### Agent Auth Flow (Delegated to Agent Subprocess)

Unlike direct API calls (which use API keys passed via Tauri commands), ACP agent authentication is **delegated to the agent subprocess**. Notesage does not implement OAuth flows — the agents handle their own auth.

**How it works (in-app experience):**

1. User clicks "Connect Claude Code" in settings
2. Notesage shows a brief "Connecting..." state with provider logo Behind the scenes: spawns the `claude-agent-acp` adapter subprocess
3. , sends ACP `initialize` + `authenticate`
4. The adapter internally triggers the login flow (opens browser popup for subscription login)
5. User authenticates with their Claude Pro/Max subscription in the browser Browser redirects back; adapter confirms authentication via ACP response
6. Notesage shows "Connected" with a green indicator and the user's subscription tier Connection stored: `{ provider: 'anthropic', authMethod: 'agent_managed', status: 'connected' }`

The user never sees a terminal, CLI command, or /login prompt. The entire auth flow is triggered from the settings UI and handled by the agent subprocess + browser popup. For API key connections, Notesage passes the key as an environment variable when spawning the subprocess, and the agent picks it up automatically.

**For GitHub Copilot:**

- The Copilot ACP agent uses its own OAuth device flow internally
- User authenticates with their GitHub account in a browser
- Works with both paid and free GitHub accounts Subscription-based — no API key needed

**For OpenAI Codex:**

- The Codex ACP adapter or native `codex app-server` handles ChatGPT subscription auth
- Device flow via `codex login --device-auth` or `chatgptAuthTokens` external auth mode
- Also supports `CODEX_API_KEY` env var for API key auth

### Migration from v1

The existing `ai-store` is preserved and continues to work. The new `connections-store` and `routing-store` are layered on top. A one-time migration converts existing settings:

- `ai-store.provider = 'anthropic'` + `ai-store.apiKeys.anthropic = 'sk-...'` → Creates an Anthropic Connection (api_key) and assigns it to `interactive`
- `ai-store.provider = 'openai'` + `ai-store.apiKeys.openai = 'sk-...'` → Creates an OpenAI Connection (api_key) and assigns it to `interactive`
- `ai-store.provider = 'ollama'` → Creates an Ollama Connection (local) and assigns it to `interactive`

After migration, the old `provider` and `apiKeys` fields are deprecated but not removed (for rollback safety).

## UI/UX

### Settings &gt; AI (Redesigned)

The AI settings page is reorganized into two sections:

**Section 1: Connections**

A card list showing all connected providers. Each card shows:

- Provider logo + name + auth type badge (API Key / Subscription)
- Connection status indicator (green dot = connected, yellow = expiring, red = error)
- Capability tags showing what this connection enables (e.g., "Chat", "Inline Actions", "Agent Tasks") "Configure" button to edit credentials
- "Disconnect" button

Below the list: "+ Add Connection" button opening a provider picker. Provider picker with capability guidance: When the user clicks "+ Add Connection", they see a list of providers. Each provider option shows: Provider logo + name Supported use cases as discrete badges: Interactive Agent Tasks Inline Completion Auth method: "Subscription" or "API Key" Brief note on what subscription is needed (e.g., "Requires Claude Pro or Max subscription", "Free GitHub account — 2,000 completions/month") This guides new users in choosing the right subscription. A user with no subscription sees immediately that a free GitHub account gives them inline completions, and a Claude Pro subscription gives them everything else. Adding a connection: Claude Code (Subscription): Click → spawns agent → opens browser for subscription login → "Connected" state Anthropic (API Key): Click → shows API key input field → saves OpenAI Codex (Subscription): Click → spawns agent → device auth flow → "Connected" state OpenAI (API Key): Click → shows API key input field → saves GitHub Copilot (Subscription): Click → spawns agent → GitHub OAuth → "Connected" state. Note: "Free GitHub account: 2,000 inline completions/month" Ollama (Local): Click → shows URL input → connects Section 2: Use Case Routing (collapsible, labeled "Advanced") A grid showing which connection handles each use case: Use Case Provider Status Interactive (Chat + Inline Actions) Claude Code (Subscription) Connected Agent Tasks Claude Code (Subscription) Connected Inline Completion GitHub Copilot (Free) Connected Each row has a dropdown to reassign to a different compatible connection. Smart defaults: When the user first opens settings and adds their first connection, everything auto-assigns. The "Advanced" section is collapsed by default. Most users never need to open it. Agent Activity Panel A collapsible right-side panel (separate from the chat panel) showing running agents and their status. Can be minimized to a thin strip showing just agent count and status indicators. Expanded view: ┌─ Agent Activity ──────────────┐ │ │ │ ● Claude Code (Interactive) │ │ Status: Idle │ │ │ │ ◉ Claude Code (Task) │ │ "Fix auth bug in login.rs" │ │ Status: Working... │ │ ▸ Reading src/auth.rs │ │ │ │ ◉ Codex (Task) │ │ "Add unit tests for utils" │ │ Status: Waiting for approval│ │ \[Accept\] \[Reject\] │ │ │ └────────────────────────────────┘ Minimized strip (default when no active tasks): ┌──────────────────────────────┐ │ Agents: ● 1 idle ◉ 2 active│ └──────────────────────────────┘ Status indicators: ● Green dot: agent idle (interactive agent, ready for requests) ◉ Pulsing dot: agent actively working on a task ⏳ Yellow: agent waiting for user permission ✓ Check: task completed ✕ Red: agent error Interaction: Click minimized strip → expands to full panel Click task → navigates to the relevant file/change Permission requests show inline accept/reject buttons Completed tasks show a summary with "Dismiss" button Connection Status Indicators Throughout the app (chat panel, status bar, agent activity panel), show which provider is active:

- Chat panel header: provider logo + name
- Inline completion ghost text: subtle "Copilot" indicator
- Agent task panel: provider logo + subscription/API badge

### Status bar: connected provider count and overall status

Error States

- **No provider for use case:** Toast with "Set up an AI provider in Settings" CTA
- **Agent not installed: Toast with installation instructions: "Install Claude Code: npm install -g @zed-industries/claude-agent-acp" OAuth token expired:** Notification with "Reconnect" CTA, auto-opens re-auth flow
- **Agent crashed: Notification with "Restart agent" CTA + error details Rate limit (Copilot free tier):** Toast: "Copilot free tier limit reached (2,000/month). Upgrade to Copilot Pro for unlimited completions."

## Data Model

### New Stores

`connections-store.ts` (Zustand, persisted):

```typescript
interface ConnectionsStore {
  connections: Connection[];

  addConnection: (conn: Omit<Connection, 'id' | 'createdAt' | 'capabilities'>) => string; // returns ID
  updateConnection: (id: string, updates: Partial<Connection>) => void;
  removeConnection: (id: string) => void;
  getConnection: (id: string) => Connection | undefined;
  getConnectionsByProvider: (provider: ConnectionProvider) => Connection[];
  getConnectionsByCapability: (capability: AICapability) => Connection[];
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

### agent-activity-store.ts (Zustand, non-persisted):

interface AgentInstance { id: string; connectionId: string; role: 'interactive' | 'task'; status: 'idle' | 'working' | 'waiting_permission' | 'completed' | 'error'; label: string; // e.g., "Claude Code (Interactive)" or task description activeTool?: string; // Current tool being used (e.g., "Reading src/auth.rs") sessionId?: string; startedAt: number; }

interface AgentActivityStore { agents: AgentInstance\[\]; panelExpanded: boolean;

addAgent: (agent: Omit&lt;AgentInstance, 'startedAt'&gt;) =&gt; void; updateAgent: (id: string, updates: Partial&lt;AgentInstance&gt;) =&gt; void; removeAgent: (id: string) =&gt; void; togglePanel: () =&gt; void; } Modified Stores

`ai-store.ts`: Personas, custom prompts, and `suggestionsEnabled` remain. The `provider`, `apiKeys`, and `ollamaUrl` fields are deprecated (kept for migration).

`chat-store.ts`: No changes needed — it already delegates provider selection to `useAIOperations`.

### New Tauri Commands

```rust
// ACP agent management
#[tauri::command]
pub async fn acp_agent_spawn(
    app: AppHandle,
    agent_id: String,        // e.g., "claude-agent-acp", "codex-cli", "copilot"
    role: String,            // "interactive" or "task"
    working_directory: String,
    env_vars: Option<HashMap<String, String>>,
) -> Result<String, String>; // returns instance_id

#[tauri::command]
pub async fn acp_agent_authenticate(instance_id: String) -> Result<AuthStatus, String>;

#[tauri::command]
pub async fn acp_session_new(instance_id: String) -> Result<String, String>; // returns session_id

#[tauri::command]
pub async fn acp_session_prompt(
    window: tauri::Window,
    instance_id: String,
    session_id: String,
    prompt: String,
    context: Option<String>,  // Project context, goals, etc.
) -> Result<(), String>;  // Streams events via Tauri window events

#[tauri::command]
pub async fn acp_session_cancel(instance_id: String, session_id: String) -> Result<(), String>;

#[tauri::command]
pub async fn acp_session_load(instance_id: String, session_id: String) -> Result<(), String>;

#[tauri::command]
pub async fn acp_permission_respond(
    instance_id: String,
    request_id: String,
    decision: String,  // "allow_once" | "allow_always" | "reject_once" | "reject_always"
) -> Result<(), String>;

#[tauri::command]
pub async fn acp_agent_stop(instance_id: String) -> Result<(), String>;

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

- `acp-text-delta` (`{ instanceId, sessionId, content }`) — streaming text from agent
- `acp-tool-call` (`{ instanceId, sessionId, tool, input }`) — agent is using a tool
- `acp-file-change` (`{ instanceId, sessionId, path, diff }`) — agent proposes a file edit
- `acp-permission-request` (`{ instanceId, sessionId, requestId, tool, description }`) — agent needs approval
- `acp-plan-update` (`{ instanceId, sessionId, plan }`) — agent's multi-step plan
- `acp-turn-complete` (`{ instanceId, sessionId, stopReason }`) — turn finished

### Rust Managed State

```rust
pub struct AcpState {
    /// All active ACP agent instances keyed by instance_id
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
    /// Role: interactive (long-lived) or task (per-delegation)
    role: AgentRole,
}

enum AgentRole {
    Interactive, // Long-lived, for chat + inline actions
    Task,        // Per-delegation, for background work
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
| `@zed-industries/claude-agent-acp` | Claude Code (ACP) | `npm install -g @zed-industries/claude-agent-acp` | Subscription (`browser login`) or `ANTHROPIC_API_KEY` env |
| `codex` | OpenAI Codex (ACP) | `npm install -g @openai/codex` or `brew install codex-cli` | Subscription (`device auth`) or `CODEX_API_KEY` env |
| `copilot` | GitHub Copilot (ACP) | `npm install -g @github/copilot` or `brew install copilot-cli` | Subscription (OAuth device flow) |
| `@github/copilot-language-server` | Inline completion (LSP) | Bundled with app or user-installed | Subscription (LSP `signIn` method) |

**Auto-detection**: Notesage checks for installed agent binaries at startup and on settings open, reporting availability per agent. Missing binaries show install instructions.

**Agent discovery**: The ACP registry can be queried for available agents. Future enhancement: let users install agents from a registry browser within settings.

### Prerequisite Work

- Phase 5 (Comments & Change Detection) — already completed. External change review infrastructure is needed for agent file change review via ACP permission requests.

## Implementation Phases

This PRD is large. It should be implemented in sub-phases:

### Phase 6a: Connections & Routing Infrastructure

- New types (connections.ts — Connection, AICapability, UseCaseRouting) New stores (`connections-store`, `routing-store`)
- Migration from v1 ai-store
- Redesigned AI settings UI (Connections list with capability guidance + Advanced routing grid)
- Update `useAIOperations` to resolve provider from routing store
- (direct API path for api_key connections — existing behavior through new abstraction
- Agent binary availability detection

### Existing chat/inline actions continue to work unchanged through new abstraction

Phase 6b: ACP Client + Interactive Agent

- Add `agent-client-protocol` Rust crate dependency
- Implement ACP client in Tauri backend (`AcpState`, spawn/initialize/authenticate)
- ACP session management Tauri commands (new, prompt, cancel, load)
- ACP streaming → Tauri event translation Interactive agent integration: route chat and inline actions through ACP for agent_managed connections Update useAIOperations to transparently route to ACP when the connection is agent-managed Agent Activity Panel (minimizable strip with agent status indicators) Claude Code as first ACP agent (subscription + API key auth) Phase 6c:
- Agent Tasks + Permission Bridge Task agent spawning (separate instance from interactive agent) ACP permission request → frontend event bridge Permission request → inline diff review bridge (reuse Phase 5 infrastructure) Agent task UI basics (start task, see progress, cancel) Agent Activity Panel: task status, permission request inline controls

### Phase 6d: Additional ACP Agents

- OpenAI Codex agent via ACP adapter
- GitHub Copilot agent via ACP
- Agent picker in settings (choose which ACP agent to use per use case) Capability guidance polish: free tier indicators, subscription recommendations
- Test with additional ACP agents (Gemini CLI, etc.)

### Phase 6e: Inline Completion (Copilot LSP)

- Copilot Language Server integration (separate from ACP — LSP protocol)
- Ghost text rendering in the editor (ProseMirror decorations)
- Tab-to-accept interaction
- Document sync with LSP

### Free tier indicator (completions remaining)

Phase 6f: Deep Codex Integration (Future Enhancement)

- Native Codex app-server integration (richer than ACP — thread management, approval workflows, sandbox policies)
- ChatGPT subscription auth via `chatgptAuthTokens` external auth mode
- Codex Cloud support for sandboxed execution

## Quality Gates

### Functional

- [ ] Existing API key auth works unchanged for Anthropic, OpenAI, Ollama

- [ ] Connections persist across app restarts

- [ ] Smart auto-assignment works: first connection fills all compatible use case slots

- [ ] Per-use-case routing: interactive, agent tasks, and inline completion can use different providers

- [ ] Changing a use case's provider takes effect immediately (no app restart)

- [ ] Migration from v1 ai-store preserves existing configuration

- [ ] Agent binary availability check reports which ACP agents are installed

- [ ] ACP interactive agent spawns, initializes, and authenticates (both API key and subscription)

- [ ] Chat messages route through ACP for agent_managed connections and stream back correctly Inline actions (Improve, Summarize, Expand) route through ACP for agent_managed connections ACP task agent spawns separately from interactive agent

- [ ] ACP permission requests surface in the UI and user can accept/reject

- [ ] Agent file changes trigger the existing external change review flow

- [ ] ACP session can be cancelled mid-turn

- [ ] ACP session can be resumed (load previous session)

- [ ] Claude Code subscription auth works via `browser popup (no terminal required) Multiple agents can run simultaneously (interactive + task) Agent Activity Panel shows running agents with correct status indicators Agent Activity Panel can be minimized to a strip Design Connections list looks polished (provider logos, status indicators, capability badges) Provider picker shows capability guidance (which use cases each provider supports) Free tier indicators are discrete but informative Auth flow is smooth (click → browser popup → connected indicator) Advanced routing section is discoverable but not overwhelming Agent Activity Panel fits the app's design language (minimizable, clean status indicators)`

- [ ] Error states have clear CTAs (not just error messages)

- [ ] Both light and dark mode look correct

- [ ] Consistent with existing settings dialog design language

## Out of Scope

- **Direct Anthropic API with subscription tokens** — Banned by Anthropic's ToS as of January 2026. Subscription auth works via Claude Code subprocess (which manages its own auth), not via direct API calls.
- 
- **Agent task delegation UX** — How users create, monitor, and review agent tasks in detail is a separate PRD. This PRD covers the infrastructure and the Agent Activity Panel shell.
- **Inline completion UX** — Ghost text rendering, Tab-to-accept, trigger heuristics are a separate PRD. This PRD covers the Copilot LSP plumbing.
- **Model selection** — Letting users choose specific models (e.g., Claude Opus vs Sonnet, GPT-4o vs GPT-5) within a provider. Deferred.
- **Cost tracking / usage dashboard** — Showing API costs or subscription usage. Deferred.
- **Cloud provider auth (AWS Bedrock, Google Vertex, Azure)** — Enterprise deployment options. Deferred.
- **Custom ACP agent registration** — Letting users add arbitrary ACP agents from the registry. Deferred (start with Claude Code, Codex, Copilot).
- **ACP agent teams** — Multi-agent orchestration. Not yet supported by the protocol adapters.
- **Native ACP in Claude Code** — Anthropic declined (issue #6686). We rely on Zed's adapter.