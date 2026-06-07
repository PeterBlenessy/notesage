import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpConfigSource =
  | 'notesage-global'
  | 'notesage-project'
  | 'claude-desktop'
  | 'cursor'
  | 'vscode';

/**
 * Collapse an MCP config source to the low-cardinality telemetry `ItemSource`
 * (`bundled | user | project`). Project-scoped servers report `project`; every
 * other source (global Notesage config, imported external configs) is `user`.
 * Pure — no PII.
 */
export function mcpSourceToItemSource(
  source: McpConfigSource,
): 'user' | 'project' {
  return source === 'notesage-project' ? 'project' : 'user';
}

export type McpServerStatus = 'stopped' | 'starting' | 'running' | 'error';

/** Transport an MCP server speaks. `http` (remote) is added by later tasks. */
export type McpTransport = 'stdio' | 'http';

/**
 * An MCP env var value as stored in `mcp.json`. A bare string is an inline
 * plaintext value; `{ secret: true }` is a reference to a value kept in the OS
 * keychain (under `notesage:mcp:<serverId>:<KEY>`). Secret values never appear
 * in this shape — only the reference does.
 */
export type McpEnvValue = string | { secret: boolean };

/** True when an env value is a keychain secret reference rather than plaintext. */
export function isSecretEnvValue(v: McpEnvValue): v is { secret: boolean } {
  return typeof v === 'object' && v !== null && 'secret' in v;
}

/** Keychain service name for an MCP server's secret env var. */
export function mcpSecretService(serverId: string, key: string): string {
  return `notesage:mcp:${serverId}:${key}`;
}

/** A required env var / secret a catalog server needs (rendered in the Add form). */
export interface McpCatalogRequiredEnv {
  key: string;
  label: string;
  secret: boolean;
  help_url?: string | null;
}

/**
 * One curated catalog entry — a template the "Add" flow pre-fills. Mirrors the
 * Rust `McpCatalogItem` from `mcp_catalog_list`. The catalog ships empty for now
 * (PRD 2026-06-03); populate `src-tauri/mcp-catalog.json` to surface entries.
 */
export interface McpCatalogItem {
  id: string;
  name: string;
  description: string;
  category?: string | null;
  homepage?: string | null;
  /** True for curated entries from a trusted source (drives the "Official" badge). */
  official?: boolean;
  transport: McpTransport;
  url?: string | null;
  command?: string | null;
  args: string[];
  required_env: McpCatalogRequiredEnv[];
}

export interface McpToolInfo {
  name: string;
  description: string | null;
  input_schema: Record<string, unknown>;
  server_id: string;
}

export interface McpServerEntry {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, McpEnvValue>;
  source: McpConfigSource;
  enabled: boolean;
  status: McpServerStatus;
  error?: string;
  tools: McpToolInfo[];
  /** Transport this server speaks. Missing/`stdio` for local command servers. */
  transport?: McpTransport;
  /** Endpoint URL for `http` (remote) servers. Absent for stdio. */
  url?: string | null;
  /**
   * Project root this server was discovered under. `null` (or missing) means
   * the server is global — either from `~/.notesage/mcp.json` or imported from
   * a system-wide external source (Claude Desktop, Cursor, VS Code).
   *
   * Scoped getters (`getActiveServers`, `getActiveTools`) use this field to
   * enforce per-project isolation (Task #20) — a server discovered under
   * Project A must not expose its tools to a chat scoped to Project B.
   */
  projectRoot?: string | null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface McpStore {
  /** All known MCP servers (rebuilt from config scan, not persisted). */
  servers: McpServerEntry[];

  /** User overrides for server enabled state (server id -> enabled). Persisted. */
  enabledOverrides: Record<string, boolean>;

  /** Counter bumped to trigger a rescan from external events. */
  rescanCounter: number;

  // --- Actions ---

  setServers(servers: McpServerEntry[]): void;
  setServerStatus(id: string, status: McpServerStatus, error?: string): void;
  setServerTools(id: string, tools: McpToolInfo[]): void;
  toggleServer(id: string): void;
  addServer(server: McpServerEntry): void;
  removeServer(id: string): void;
  updateServer(id: string, updates: Partial<McpServerEntry>): void;
  requestRescan(): void;

  /** Get a server by ID. */
  getServer(id: string): McpServerEntry | undefined;

  /**
   * Active (enabled) servers, filtered by project scope (Task #20).
   *
   * - Servers with `projectRoot == null` (or missing — legacy) are treated as
   *   global and always included.
   * - Servers with a `projectRoot` string are included only if that root is in
   *   `selectedProjectPaths`.
   * - When `selectedProjectPaths` is `undefined` (back-compat for unscoped UI
   *   callers), no scoping is applied and all enabled servers are returned.
   *   Tool-composition callers must pass an explicit (possibly empty) array
   *   to opt into isolation.
   */
  getActiveServers(selectedProjectPaths?: string[]): McpServerEntry[];

  /**
   * Flattened list of MCP tools available in the current scope. Only includes
   * tools from servers that are (a) enabled, (b) running, and (c) either
   * global or attached to a selected project.
   *
   * This is the scope-gated source of truth for the chat tool registry —
   * future tool-composition sites that wire MCP tools into `ai_chat_stream`
   * should read from here rather than iterating `state.servers` directly.
   */
  getActiveTools(selectedProjectPaths?: string[]): McpToolInfo[];
}

/**
 * Filter servers by project scope for Task #20 isolation.
 *
 * See `getActiveServers` doc for semantics. Split out so both `getActiveServers`
 * and `getActiveTools` use the same filter rule.
 */
function filterByScope(
  entries: McpServerEntry[],
  selectedProjectPaths: string[] | undefined,
): McpServerEntry[] {
  if (selectedProjectPaths === undefined) return entries;
  const selected = new Set(selectedProjectPaths);
  return entries.filter((s) => {
    if (s.projectRoot == null) return true; // global (including legacy)
    return selected.has(s.projectRoot);
  });
}

export const useMcpStore = create<McpStore>()(
  persist(
    (set, get) => ({
      servers: [],
      enabledOverrides: {},
      rescanCounter: 0,

      setServers(servers: McpServerEntry[]) {
        const overrides = get().enabledOverrides;
        // Apply persisted overrides and prune stale ones
        const activeIds = new Set(servers.map((s) => s.id));
        const prunedOverrides = Object.fromEntries(
          Object.entries(overrides).filter(([id]) => activeIds.has(id))
        );
        const merged = servers.map((s) => ({
          ...s,
          enabled: prunedOverrides[s.id] !== undefined ? prunedOverrides[s.id] : s.enabled,
        }));
        set({ servers: merged, enabledOverrides: prunedOverrides });
      },

      setServerStatus(id: string, status: McpServerStatus, error?: string) {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id ? { ...s, status, error } : s
          ),
        }));
      },

      setServerTools(id: string, tools: McpToolInfo[]) {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id ? { ...s, tools } : s
          ),
        }));
      },

      toggleServer(id: string) {
        set((state) => {
          const server = state.servers.find((s) => s.id === id);
          if (!server) return state;
          const newEnabled = !server.enabled;
          return {
            servers: state.servers.map((s) =>
              s.id === id ? { ...s, enabled: newEnabled } : s
            ),
            enabledOverrides: {
              ...state.enabledOverrides,
              [id]: newEnabled,
            },
          };
        });
      },

      addServer(server: McpServerEntry) {
        set((state) => ({
          servers: [...state.servers, server],
        }));
      },

      removeServer(id: string) {
        set((state) => {
          const { [id]: _, ...rest } = state.enabledOverrides;
          return {
            servers: state.servers.filter((s) => s.id !== id),
            enabledOverrides: rest,
          };
        });
      },

      updateServer(id: string, updates: Partial<McpServerEntry>) {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        }));
      },

      requestRescan() {
        set((state) => ({ rescanCounter: state.rescanCounter + 1 }));
      },

      getServer(id: string) {
        return get().servers.find((s) => s.id === id);
      },

      getActiveServers(selectedProjectPaths) {
        const scoped = filterByScope(get().servers, selectedProjectPaths);
        return scoped.filter((s) => s.enabled);
      },

      getActiveTools(selectedProjectPaths) {
        const scoped = filterByScope(get().servers, selectedProjectPaths);
        const out: McpToolInfo[] = [];
        for (const s of scoped) {
          if (!s.enabled) continue;
          if (s.status !== 'running') continue;
          for (const t of s.tools) out.push(t);
        }
        return out;
      },
    }),
    {
      name: 'mcp-store',
      partialize: (state) => ({
        enabledOverrides: state.enabledOverrides,
      }),
    }
  )
);
