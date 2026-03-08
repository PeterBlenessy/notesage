# PRD: MCP Client Integration (Phase 7 Step B)

## Problem

Notesage's AI agents can only use tools that are either hardcoded (ACP agent built-ins like bash, edit, read) or implemented as skill scripts (Phase 7 Step A). Users cannot connect external tool servers — databases, APIs, filesystems, web scrapers, or any of the 5,800+ MCP servers available in the ecosystem — without leaving the app.

MCP (Model Context Protocol) is the industry standard for connecting AI tools to external capabilities. Every major AI tool supports it: Claude Desktop, Cursor, VS Code Copilot, Windsurf, and others. Users who already have MCP servers configured in these tools expect to reuse them in Notesage without re-configuration.

## Goals

1. **Spawn and manage MCP servers** as child processes over stdio transport, with reliable lifecycle management (start, health check, restart, cleanup on app exit)
2. **Discover tools** from connected MCP servers and merge them into the existing skill/tool registry so agents can use them
3. **Import existing MCP configurations** from Claude Desktop, Cursor, and VS Code so users don't need to re-configure
4. **Provide settings UI** for viewing, adding, editing, enabling/disabling, and removing MCP server configurations
5. **Support project-scoped and global MCP configs** via `.notesage/mcp.json` (project) and `~/.notesage/mcp.json` (global)

## Non-Goals

- **SSE/Streamable HTTP transport** — stdio only for v1. HTTP transports deferred to future work.
- **MCP Resources and Prompts** — only the `tools` primitive is supported initially. Resources (context injection) and prompts (prompt templates) are deferred.
- **MCP server marketplace or auto-install** — users must install server binaries themselves. Discovery and install wizard deferred.
- **MCP sampling** — server-initiated LLM requests (the `sampling` capability) are not supported in v1.
- **Custom permission UI per MCP tool** — MCP tools use the existing permission system. No per-tool granular approval beyond what already exists.

## User Stories

1. **As a user with existing MCP servers**, I want to import my Claude Desktop or Cursor MCP config so I can use the same tools in Notesage without re-setup.
2. **As a user**, I want to add an MCP server by specifying a command and arguments (e.g., `npx @modelcontextprotocol/server-filesystem /path`) so I can extend my AI agents with new capabilities.
3. **As a user**, I want to see which MCP servers are running and what tools they provide, so I can understand what my agents can do.
4. **As a user**, I want to enable/disable MCP servers per project, so different projects can have different tool sets.
5. **As a user**, I want MCP servers to start automatically when needed and shut down cleanly when the app closes, without manual management.
6. **As a developer**, I want MCP tools to appear in the same Tools popover as existing ACP tools, so the experience is unified.

## Technical Approach

### Architecture Overview

MCP integration follows the same three-layer pattern as the Copilot LSP and ACP implementations:

```
Frontend (React)          Tauri IPC           Backend (Rust)
┌──────────────┐      ┌──────────────┐     ┌──────────────────┐
│ mcp-store.ts │◄────►│ Tauri cmds   │◄───►│ commands/mcp.rs  │
│              │      │              │     │                  │
│ Settings UI  │      │ mcp_start    │     │ McpState         │
│ Tools popov. │      │ mcp_stop     │     │  ├─ servers map  │
│              │      │ mcp_list_    │     │  ├─ JsonRpc      │
│ useMcpOps()  │      │   tools      │     │  └─ cleanup      │
└──────────────┘      │ mcp_call_    │     │                  │
                      │   tool       │     │ MCP JSON-RPC 2.0 │
                      │ mcp_discover │     │ over stdio        │
                      └──────────────┘     └──────────────────┘
```

### Rust Backend (`src-tauri/src/commands/mcp.rs`)

**Reuse the** `JsonRpcTransport` **pattern** from `copilot_lsp.rs` for MCP's JSON-RPC 2.0 over stdio:

```rust
pub struct McpState {
    servers: Mutex<HashMap<String, McpServerHandle>>,
}

struct McpServerHandle {
    config: McpServerConfig,
    child: Child,
    transport: JsonRpcTransport,
    tools: Vec<McpToolInfo>,
    status: McpServerStatus,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct McpServerConfig {
    pub id: String,           // Unique identifier
    pub name: String,         // Display name
    pub command: String,      // Binary to execute
    pub args: Vec<String>,    // Command arguments
    pub env: HashMap<String, String>, // Environment variables
    pub source: McpConfigSource,      // Where this config came from
    pub enabled: bool,
}

enum McpConfigSource {
    NotesageGlobal,    // ~/.notesage/mcp.json
    NotesageProject,   // <project>/.notesage/mcp.json
    ClaudeDesktop,     // ~/.claude/claude_desktop_config.json
    Cursor,            // ~/.cursor/mcp.json
    VsCode,            // VS Code settings
}

enum McpServerStatus {
    Stopped,
    Starting,
    Running,
    Error(String),
}
```

**MCP Protocol Flow:**

1. Spawn child process with `kill_on_drop(true)`
2. Send `initialize` request with client capabilities (tools supported)
3. Receive server capabilities (tools, resources, prompts — we only use tools)
4. Send `initialized` notification
5. Call `tools/list` to discover available tools
6. On tool call: `tools/call` with tool name and arguments → return result
7. On shutdown: send `close` notification → kill process

**Tauri Commands:**

```rust
#[tauri::command]
async fn mcp_start_server(state: State<'_, McpState>, config: McpServerConfig) -> Result<McpServerInfo, String>

#[tauri::command]
async fn mcp_stop_server(state: State<'_, McpState>, server_id: String) -> Result<(), String>

#[tauri::command]
async fn mcp_restart_server(state: State<'_, McpState>, server_id: String) -> Result<McpServerInfo, String>

#[tauri::command]
async fn mcp_list_tools(state: State<'_, McpState>, server_id: String) -> Result<Vec<McpToolInfo>, String>

#[tauri::command]
async fn mcp_call_tool(state: State<'_, McpState>, server_id: String, tool_name: String, arguments: serde_json::Value) -> Result<McpToolResult, String>

#[tauri::command]
async fn mcp_discover_configs(base_dirs: Vec<String>) -> Result<Vec<McpServerConfig>, String>

#[tauri::command]
async fn mcp_get_server_status(state: State<'_, McpState>) -> Result<Vec<McpServerInfo>, String>

#[tauri::command]
async fn mcp_import_configs(source: String) -> Result<Vec<McpServerConfig>, String>
```

**Tool Result Type:**

```rust
#[derive(Serialize, Deserialize)]
pub struct McpToolInfo {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: serde_json::Value, // JSON Schema
    pub server_id: String,
}

#[derive(Serialize, Deserialize)]
pub struct McpToolResult {
    pub content: Vec<McpContent>,
    pub is_error: bool,
}

#[derive(Serialize, Deserialize)]
pub struct McpContent {
    pub content_type: String,  // "text", "image", "resource"
    pub text: Option<String>,
    pub data: Option<String>,  // base64 for images
    pub mime_type: Option<String>,
}
```

**Cleanup:** `McpState::stop_all()` called from `RunEvent::Exit` hook alongside `AcpState::stop_all_sync()`.

### Config File Format

`~/.notesage/mcp.json` and `<project>/.notesage/mcp.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      "env": {}
    },
    "sqlite": {
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "./data.db"],
      "env": {}
    }
  }
}
```

This format is intentionally compatible with Claude Desktop's `claude_desktop_config.json` so configs can be copy-pasted or imported directly.

### Config Import Sources

**Claude Desktop:** `~/.claude/claude_desktop_config.json` → read `mcpServers` key **Cursor:** `~/.cursor/mcp.json` → same format **VS Code:** `~/Library/Application Support/Code/User/settings.json` → read `mcp.servers` key (macOS path)

### Frontend State (`src/stores/mcp-store.ts`)

```typescript
interface McpServerEntry {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  source: 'notesage-global' | 'notesage-project' | 'claude-desktop' | 'cursor' | 'vscode';
  enabled: boolean;
  status: 'stopped' | 'starting' | 'running' | 'error';
  error?: string;
  tools: McpToolInfo[];
}

interface McpStore {
  // State
  servers: McpServerEntry[];
  enabledOverrides: Record<string, boolean>; // Persisted

  // Actions
  setServers(servers: McpServerEntry[]): void;
  setServerStatus(id: string, status: string, error?: string): void;
  setServerTools(id: string, tools: McpToolInfo[]): void;
  toggleServer(id: string): void;
  addServer(config: Partial<McpServerEntry>): void;
  removeServer(id: string): void;
  updateServer(id: string, updates: Partial<McpServerEntry>): void;

  // Computed
  getActiveTools(): McpToolInfo[];  // All tools from enabled, running servers
  rescanCounter: number;
  requestRescan(): void;
}
```

### Frontend Hook (`src/hooks/useMcpOperations.ts`)

```typescript
function useMcpDiscovery() {
  // Mounted in App.tsx — gates on startupReady
  // 1. Scan config files: ~/.notesage/mcp.json, project .notesage/mcp.json
  // 2. Optionally scan imported configs (Claude Desktop, Cursor, VS Code)
  // 3. Populate mcp-store with discovered servers
  // 4. Auto-start enabled servers
  // 5. Observe rescanCounter for re-discovery on file changes
}

function useMcpOperations() {
  // Used by chat/agent hooks
  // Provides: startServer, stopServer, callTool, listTools
  // Integrates with useAIOperations for tool routing
}
```

### Integration with Existing Tool System

MCP tools merge into the Tools popover in the chat footer:

1. `ChatPanel.tsx` Tools popover reads from both `permission-store` (ACP tools) and `mcp-store` (MCP tools)
2. MCP tools display with server name prefix: `[filesystem] read_file`, `[sqlite] query`
3. When an agent requests a tool call that matches an MCP tool, the frontend routes it through `mcp_call_tool`
4. For direct API connections: MCP tools are injected into the system prompt as available tool descriptions
5. For ACP connections: MCP tools are listed but actual execution happens through the agent's own tool system — MCP tools are primarily useful for direct API connections where Notesage orchestrates tool calls

### Hierarchy Resolution

Same pattern as skills:

- **Project** `.notesage/mcp.json` overrides **Global** `~/.notesage/mcp.json`
- Same-named servers: project wins
- Imported configs (Claude Desktop, Cursor, VS Code) are read-only references — user can "adopt" them into global/project config

## UI/UX

### Settings &gt; Skills & Agents &gt; MCP Servers

New section in the existing Skills & Agents settings tab:

```
┌─────────────────────────────────────────────┐
│ MCP Servers                    [+ Add] [↻]  │
├─────────────────────────────────────────────┤
│                                             │
│ ┌─ filesystem          ● Running    [···] ──┤
│ │  npx @mcp/server-filesystem /path         │
│ │  3 tools · Global                         │
│ │  ☑ Enabled                                │
│ └───────────────────────────────────────────┤
│                                             │
│ ┌─ sqlite              ○ Stopped    [···] ──┤
│ │  uvx mcp-server-sqlite --db data.db       │
│ │  5 tools · Project                        │
│ │  ☐ Disabled                               │
│ └───────────────────────────────────────────┤
│                                             │
│ Import from: [Claude Desktop] [Cursor]      │
│                                             │
└─────────────────────────────────────────────┘
```

**Server card states:**

- **Running** — green dot, tools count, expandable tool list
- **Starting** — spinner, "Connecting..."
- **Stopped** — grey dot, enable to start
- **Error** — red dot, error message, retry button

**Add Server dialog:**

- Command input (required)
- Arguments input (space-separated or JSON array)
- Environment variables (key-value pairs)
- Name (auto-derived from command if not specified)
- Scope selector: Global / Project

**Import flow:**

- "Import from Claude Desktop" button scans `~/.claude/claude_desktop_config.json`
- Shows preview of discovered servers with checkboxes
- Selected servers copied to `~/.notesage/mcp.json`

**Server context menu (···):**

- Start / Stop / Restart
- View tools (expand inline)
- Edit configuration
- Move to Global / Move to Project
- Remove

### Tools Popover Enhancement

The existing Tools popover in the chat footer extends to show MCP tools:

```
┌──────────────────────────────┐
│ Agent Tools                  │
│  bash          [always ✓]    │
│  edit          [session ✓]   │
│  read          [always ✓]    │
│                              │
│ MCP Tools                    │
│  filesystem/read_file    ●   │
│  filesystem/write_file   ●   │
│  sqlite/query            ●   │
│  sqlite/list_tables      ●   │
└──────────────────────────────┘
```

MCP tools shown with server name prefix and green dot for running servers.

## Data Model

### Config File Schema

```typescript
// ~/.notesage/mcp.json and <project>/.notesage/mcp.json
interface McpConfigFile {
  mcpServers: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    disabled?: boolean;
  }>;
}
```

### Zustand Store

See `McpStore` interface in Technical Approach above. Persisted fields: `enabledOverrides` only. Server list rebuilt from config scan on each startup.

### Tauri Managed State

See `McpState` struct in Technical Approach above. Registered in `lib.rs` alongside `AcpState`, `CopilotLspState`, `WatcherState`.

## Dependencies

### Rust Crates

- **No new crates required** — the JSON-RPC transport is hand-rolled (reusing the pattern from `copilot_lsp.rs`). MCP's protocol is simple enough that a dedicated crate isn't needed.
- `serde_json` (already used) for JSON-RPC message serialization
- `tokio` (already used) for async process management
- `dirs` (already used) for home directory resolution

### Frontend

- No new npm packages required
- Uses existing shadcn/ui components (Card, Button, Switch, Popover, Dialog, Input, Badge)

### External

- Users must install MCP server binaries themselves (e.g., `npm install -g @modelcontextprotocol/server-filesystem`)
- Config import requires the source tool to be installed (Claude Desktop, Cursor, or VS Code)

## Quality Gates

### Functional

- [x] Can add an MCP server via Settings UI with command, args, and env

- [x] MCP server starts on enable and stops on disable

- [x] Tools are discovered from running servers via `tools/list`

- [x] MCP tools appear in the Tools popover alongside ACP tools

- [x] `mcp_call_tool` successfully invokes a tool and returns results

- [x] Config persists in `~/.notesage/mcp.json` (global) or `<project>/.notesage/mcp.json` (project)

- [x] Import from Claude Desktop discovers and copies server configs

- [x] Import from Cursor discovers and copies server configs

- [x] Servers auto-start on app launch for enabled servers

- [x] Servers shut down cleanly on app exit (no orphaned processes)

- [x] Server crash/error shows clear status in Settings UI with retry option

- [x] Project-scoped servers override global servers with same name

- [x] Removing a server stops it and removes config

- [x] App functions normally with zero MCP servers configured (graceful degradation)

### Design

- [x] Server cards follow the same visual pattern as skill cards in Settings

- [x] Status indicators (running/stopped/error) are clear and use consistent iconography

- [x] Add Server dialog is clean, follows existing dialog patterns

- [x] Import flow shows clear preview before committing

- [x] MCP tools section in Tools popover is visually separated from ACP tools

- [x] All states (empty, loading, error) are handled with appropriate UI

### Performance

- [x] Server startup does not block the app UI

- [x] Tool discovery completes within 5 seconds per server

- [x] Tool calls do not freeze the UI (async with loading indicators)

- [x] Multiple servers can run concurrently without issues

## Out of Scope

- **SSE/HTTP transport** — only stdio in v1; HTTP transport for remote MCP servers deferred
- **MCP Resources** — context injection from MCP servers (e.g., file contents, database schemas) deferred
- **MCP Prompts** — prompt templates from MCP servers deferred
- **MCP Sampling** — server-initiated LLM calls deferred
- **Server auto-install** — no npm/pip install from within the app; users install binaries manually
- **MCP server marketplace** — no browsing/discovering new servers from within the app
- **Tool-level permissions** — MCP tools inherit the existing permission system; no per-tool granular approval
- **Direct API tool calling** — for v1, MCP tools are only usable via ACP agents that support external tool injection; direct API tool calling orchestration deferred
- **Notifications** — MCP server-to-client notifications (`notifications/tools/list_changed`, etc.) deferred; users can manually rescan