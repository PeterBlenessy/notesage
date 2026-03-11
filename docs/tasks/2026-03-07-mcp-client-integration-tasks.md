# MCP Client Integration — Implementation Tasks

**Status:** ✅ Complete

PRD: `docs/prds/2026-03-07-mcp-client-integration.md`

## Task Overview

| # | Task | Depends On | Effort |
|---|------|-----------|--------|
| 1 | MCP JSON-RPC transport & protocol | — | Large |
| 2 | MCP managed state & Tauri commands | 1 | Medium |
| 3 | Config file parsing & import | — | Medium |
| 4 | MCP Zustand store | — | Small |
| 5 | Discovery hook & lifecycle | 2, 3, 4 | Medium |
| 6 | Settings UI — server cards | 4 | Medium |
| 7 | Settings UI — add/edit/import dialogs | 3, 6 | Medium |
| 8 | Tools popover integration | 2, 4 | Small |
| 9 | App lifecycle (startup/shutdown) | 2, 5 | Small |
| 10 | Testing & polish | All | Medium |

**Parallelizable:** Tasks 1, 3, and 4 can start simultaneously. Task 6 can start once 4 is done. Tasks 2 and 7 have hard dependencies.

---

## Task 1: MCP JSON-RPC Transport & Protocol ✅ DONE

**Goal:** Implement the MCP client protocol over stdio in Rust.

**What to build:**
- `src-tauri/src/commands/mcp.rs` — new file
- Reuse the `JsonRpcTransport` pattern from `copilot_lsp.rs`: Content-Length framing, async reader loop, pending request map with oneshot channels
- MCP-specific protocol handshake:
  1. `initialize` request — send client info + capabilities (`{ tools: {} }`)
  2. Receive server capabilities (parse `tools` support)
  3. `initialized` notification
- `tools/list` request → parse tool name, description, input schema
- `tools/call` request → send tool name + arguments, receive content array
- Graceful shutdown: send `close` notification, wait briefly, force kill

**Key types:**
```rust
struct McpTransport {
    stdin: ChildStdin,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
    next_id: AtomicU64,
}

struct McpToolInfo {
    name: String,
    description: Option<String>,
    input_schema: serde_json::Value,
}

struct McpToolResult {
    content: Vec<McpContent>,
    is_error: bool,
}
```

**Reference:** `src-tauri/src/commands/copilot_lsp.rs` lines 1-200 (JsonRpcTransport implementation)

**Done when:** Can spawn an MCP server subprocess, complete the initialize handshake, call `tools/list`, and call `tools/call` with a test server.

---

## Task 2: MCP Managed State & Tauri Commands ✅ DONE

**Goal:** Expose MCP operations to the frontend via Tauri IPC commands.

**Depends on:** Task 1

**What to build:**
- `McpState` struct with `Mutex<HashMap<String, McpServerHandle>>` — register in `lib.rs` alongside `AcpState`, `CopilotLspState`, `WatcherState`
- `McpServerHandle`: child process, transport, cached tools, config, status

**Tauri commands:**
```rust
mcp_start_server(config: McpServerConfig) -> Result<McpServerInfo, String>
mcp_stop_server(server_id: String) -> Result<(), String>
mcp_restart_server(server_id: String) -> Result<McpServerInfo, String>
mcp_list_tools(server_id: String) -> Result<Vec<McpToolInfo>, String>
mcp_call_tool(server_id: String, tool_name: String, arguments: Value) -> Result<McpToolResult, String>
mcp_get_server_status() -> Result<Vec<McpServerInfo>, String>
```

- Add commands to `generate_handler![]` in `lib.rs`
- Add `McpState::stop_all()` called from `RunEvent::Exit` hook
- Emit `mcp-server-status` Tauri events when server status changes (starting, running, error, stopped)

**Files to modify:**
- `src-tauri/src/commands/mcp.rs` (extend from Task 1)
- `src-tauri/src/commands/mod.rs` (add `pub mod mcp;`)
- `src-tauri/src/lib.rs` (register state, add commands to handler, add Exit hook)

**Done when:** Frontend can invoke all MCP commands via `@tauri-apps/api/core` invoke.

---

## Task 3: Config File Parsing & Import ✅ DONE

**Goal:** Read and write MCP server configurations from JSON files, import from other tools.

**What to build:**

**Rust commands:**
```rust
mcp_discover_configs(base_dirs: Vec<String>) -> Result<Vec<McpServerConfig>, String>
mcp_import_configs(source: String) -> Result<Vec<McpServerConfig>, String>
mcp_save_config(path: String, configs: HashMap<String, McpServerConfigEntry>) -> Result<(), String>
```

**Config format** (Claude Desktop-compatible):
```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      "env": { "KEY": "value" }
    }
  }
}
```

**Import sources:**
- Claude Desktop: `~/.claude/claude_desktop_config.json` → read `mcpServers` key
- Cursor: `~/.cursor/mcp.json` → same format
- VS Code: `~/Library/Application Support/Code/User/settings.json` → read `mcp.servers` key

**Hierarchy:**
- Project `.notesage/mcp.json` > Global `~/.notesage/mcp.json` > Imported (read-only)
- Same-named servers: highest priority wins (same pattern as skills)

**Done when:** Can read configs from all sources, merge with hierarchy, write back to Notesage config files.

---

## Task 4: MCP Zustand Store ✅ DONE

**Goal:** Frontend state management for MCP servers.

**What to build:**
- `src/stores/mcp-store.ts` — new file

```typescript
interface McpStore {
  servers: McpServerEntry[];
  enabledOverrides: Record<string, boolean>; // Persisted

  setServers(servers: McpServerEntry[]): void;
  setServerStatus(id: string, status: McpServerStatus, error?: string): void;
  setServerTools(id: string, tools: McpToolInfo[]): void;
  toggleServer(id: string): void;
  addServer(config: McpServerEntry): void;
  removeServer(id: string): void;
  updateServer(id: string, updates: Partial<McpServerEntry>): void;

  getActiveTools(): McpToolInfo[];

  rescanCounter: number;
  requestRescan(): void;
}
```

- Persist only `enabledOverrides` via Zustand persist middleware
- `McpServerEntry` includes: id, name, command, args, env, source, enabled, status, error, tools
- `getActiveTools()` returns all tools from enabled + running servers

**Reference:** `src/stores/skill-store.ts` for pattern

**Done when:** Store is importable, persists overrides, and provides computed tool list.

---

## Task 5: Discovery Hook & Lifecycle ✅ DONE

**Goal:** Automatic MCP server discovery and management on startup and config changes.

**Depends on:** Tasks 2, 3, 4

**What to build:**
- `src/hooks/useMcpOperations.ts` — new file with two exported hooks:

**`useMcpDiscovery()`** — mounted in `App.tsx`:
1. Wait for `startupReady` (same gate as `useSkillDiscovery`)
2. Scan config files: `~/.notesage/mcp.json`, all project `.notesage/mcp.json` paths
3. Populate `mcp-store` with discovered servers
4. Auto-start enabled servers (call `mcp_start_server` for each)
5. After start, call `mcp_list_tools` and update store
6. Observe `rescanCounter` for re-discovery on file watcher events

**`useMcpOperations()`** — used by components:
- `startServer(id)`, `stopServer(id)`, `restartServer(id)`
- `callTool(serverId, toolName, args)` — wraps `mcp_call_tool` invoke
- Status event listener: `listen('mcp-server-status', ...)` → update store

**Mount `useMcpDiscovery()` in `App.tsx`** alongside existing hooks.

**Files to modify:**
- `src/hooks/useMcpOperations.ts` (new)
- `src/App.tsx` (mount `useMcpDiscovery`)
- `src/hooks/useFileWatcher.ts` (trigger `mcp-store.requestRescan()` on `.notesage/mcp.json` changes)

**Done when:** MCP servers auto-discover and auto-start on app launch, re-scan on config file changes.

---

## Task 6: Settings UI — Server Cards ✅ DONE

**Goal:** Display MCP servers in the Settings dialog.

**Depends on:** Task 4

**What to build:**
- Add "MCP Servers" section to `SkillsSettings.tsx` (or create separate `McpServersSettings.tsx` if the file gets too large)
- Server card component showing:
  - Server name and command
  - Status badge (Running/Stopped/Starting/Error with appropriate colors)
  - Tool count
  - Source label (Global/Project/Claude Desktop/Cursor)
  - Enable/disable switch
  - Context menu: Start, Stop, Restart, Edit, Move (global↔project), Remove
- Expandable tool list within each card
- Rescan button (same pattern as skills rescan)
- Empty state: "No MCP servers configured. Add one or import from another tool."

**Design guidelines:**
- Follow existing `SkillCard` visual pattern
- Status dots: green (running), grey (stopped), yellow (starting), red (error)
- Use shadcn/ui Card, Switch, Badge, Collapsible, DropdownMenu
- Follow design-system.md: no chromatic colors, smooth transitions, both themes

**Done when:** All MCP servers render in Settings with correct status, enable/disable works, context menu actions work.

---

## Task 7: Settings UI — Add/Edit/Import Dialogs ✅ DONE

**Goal:** UI for adding new servers and importing from other tools.

**Depends on:** Tasks 3, 6

**What to build:**

**Add Server Dialog:**
- Command input (required, with placeholder: `npx -y @modelcontextprotocol/server-filesystem`)
- Arguments input (comma or space separated, converted to array)
- Environment variables (dynamic key-value pair list with add/remove)
- Display name (optional, auto-derived from command)
- Scope selector: Global / Project dropdown
- Save → writes to appropriate `mcp.json` file → triggers rescan

**Edit Server Dialog:**
- Same as Add but pre-populated with existing config
- Save → updates config file → restarts server if running

**Import Dialog:**
- "Import from" section with buttons for each source
- On click: scans source config, shows preview list with checkboxes
- Each preview item shows: server name, command, tool count (if detectable)
- "Import Selected" → copies to `~/.notesage/mcp.json` → triggers rescan
- Greyed-out buttons if source app not detected

**Done when:** Can add a new server, edit an existing one, and import from Claude Desktop/Cursor/VS Code.

---

## Task 8: Tools Popover Integration ✅ DONE

**Goal:** MCP tools appear in the chat footer Tools popover.

**Depends on:** Tasks 2, 4

**What to build:**
- Modify `ChatPanel.tsx` Tools popover to include MCP tools section
- MCP tools displayed under "MCP Tools" header, separated from "Agent Tools"
- Each tool shows: `[server-name] tool-name` with green dot for running servers
- Tool count badge on the Tools button includes MCP tools
- For direct API connections: MCP tool descriptions available for system prompt injection (future — note in code comment)

**Files to modify:**
- `src/components/chat/ChatPanel.tsx` — extend Tools popover
- Read from `mcp-store.getActiveTools()` for tool list

**Done when:** MCP tools appear in the Tools popover with server name prefix and status indicators.

---

## Task 9: App Lifecycle (Startup/Shutdown) ✅ DONE

**Goal:** Reliable MCP server startup and shutdown.

**Depends on:** Tasks 2, 5

**What to build:**

**Startup:**
- `useMcpDiscovery` auto-starts enabled servers after config scan
- Stagger startup: don't spawn all servers simultaneously (100ms delay between)
- Failed starts logged and shown as error status in store

**Shutdown:**
- `McpState::stop_all()` in Rust: iterate all servers, send close notification, wait 2s, force kill
- Called from `RunEvent::Exit` in `lib.rs`
- Frontend `beforeunload`: call `mcp_stop_server` for each running server (secondary defense)

**Crash recovery:**
- If a server process exits unexpectedly, emit `mcp-server-status` event with error
- Frontend updates store status to `error` with exit code/message
- Auto-restart: not in v1 (user can manually restart from Settings)

**Files to modify:**
- `src-tauri/src/lib.rs` — add `McpState::stop_all()` to Exit hook
- `src/hooks/useMcpOperations.ts` — startup sequencing, status event listener
- `src/App.tsx` — ensure cleanup on unmount

**Done when:** Servers start on app launch, shut down cleanly on exit, crash shows error status.

---

## Task 10: Testing & Polish ✅ DONE

**Goal:** End-to-end verification and UX polish.

**Depends on:** All previous tasks

**What to test:**
1. Install `@modelcontextprotocol/server-filesystem` and `@modelcontextprotocol/server-everything` for testing
2. Add via Settings UI → verify server starts and tools appear
3. Import from Claude Desktop config → verify servers discovered
4. Enable/disable toggle → verify server starts/stops
5. App restart → verify enabled servers auto-start
6. App quit → verify no orphaned processes (`ps aux | grep mcp`)
7. Remove server → verify stopped and config removed
8. Project-scoped server → verify only active when project is open
9. Server crash simulation → verify error status displayed
10. Light + dark mode → verify all UI states look correct

**Polish items:**
- Error messages are user-friendly (not raw stderr)
- Loading states during server startup
- Transition animations on status changes
- Tooltip on server status dots
- Tool list expand/collapse is smooth
- Empty state for "No tools discovered" per server

**Done when:** All quality gates from PRD pass, both themes look polished, no orphaned processes.

---

## Implementation Order

Recommended sequence:

```
Week 1:  Tasks 1, 3, 4 (parallel — transport, config, store)
Week 2:  Task 2 (commands depend on transport)
         Task 6 (UI depends on store)
Week 3:  Tasks 5, 7 (lifecycle + dialogs)
         Task 8 (tools popover)
Week 4:  Task 9 (lifecycle hardening)
         Task 10 (testing + polish)
```

Tasks 1+3+4 are fully independent and can be built in parallel. The critical path is Task 1 → Task 2 → Task 5 → Task 9.
