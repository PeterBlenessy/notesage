import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { handleRehydrateResult } from "@/lib/persist-rehydrate";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpConfigSource =
  | 'notesage-global'
  | 'notesage-project'
  | 'claude-desktop'
  | 'cursor'
  | 'vscode';


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

/** Keychain service name for a remote MCP server's secret header value. */
export function mcpHeaderSecretService(serverId: string, header: string): string {
  return mcpSecretService(serverId, header);
}

/** Keychain service name of a remote MCP server's OAuth token blob. */
export function mcpOAuthService(serverId: string): string {
  return `notesage:mcp:${serverId}:oauth`;
}

/**
 * A short, stable key for a project root (FNV-1a, 8 hex digits). Part of the
 * id of a project-scoped server, so two projects that both define a server
 * called `db` do not share an id, an enable override or keychain secrets.
 */
export function mcpProjectKey(projectRoot: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < projectRoot.length; i++) {
    hash ^= projectRoot.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Id of a server defined in `~/.notesage/mcp.json`. */
export function mcpGlobalServerId(name: string): string {
  return `global:${name}`;
}

/** The id every project's server of this name shared before ids carried the project. */
export function mcpLegacyProjectServerId(name: string): string {
  return `project:${name}`;
}

/** Id of a server defined in `<projectRoot>/.notesage/mcp.json`. */
export function mcpProjectServerId(projectRoot: string, name: string): string {
  return `project:${mcpProjectKey(projectRoot)}:${name}`;
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
  /** Arguments the Add form asks for before the server can start. */
  required_args?: McpCatalogRequiredArg[];
}

/**
 * An argument a catalog server needs that only the user can supply (a folder
 * to serve, a repository). The Add form asks for it and appends the answer to
 * the arguments, after `flag` when there is one.
 */
export interface McpCatalogRequiredArg {
  key: string;
  label: string;
  /** `path` gets a folder picker next to the field. */
  kind: 'path' | 'text';
  /** Flag the value follows, e.g. `--repository`. Absent: a bare argument. */
  flag?: string | null;
  /** When false the field may be left empty and nothing is appended. */
  required?: boolean;
}

/** An entry of an `mcp.json` the backend could not load. */
export interface McpConfigProblem {
  /** The entry's key in `mcpServers`; the file's path when the whole file is the problem. */
  name: string;
  /** Which kind of file it is in: `notesage_global` or `notesage_project`. */
  source: string;
  reason: string;
  /** The file itself, when it could be worked out. */
  file?: string | null;
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
   * Static HTTP headers sent to a remote server (an API key, a tenant id).
   * Same value shape as `env`: plaintext, or a keychain reference.
   */
  headers?: Record<string, McpEnvValue>;
  /** Working directory a stdio server is started in. Absent: the home directory. */
  cwd?: string | null;
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

  /** Config entries the backend could not load, from the last discovery pass. */
  configProblems: McpConfigProblem[];

  // --- Actions ---

  setServers(servers: McpServerEntry[]): void;
  setServerStatus(id: string, status: McpServerStatus, error?: string): void;
  setServerTools(id: string, tools: McpToolInfo[]): void;
  toggleServer(id: string): void;
  /** Set a server's enabled state explicitly (records a user override). */
  setServerEnabled(id: string, enabled: boolean): void;
  /**
   * Record that the user wants `id` on, for a server the next discovery pass
   * will find (one just written to `mcp.json`). The override survives passes
   * that do not list the server yet.
   */
  enableOnNextDiscovery(id: string): void;
  /** Carry a renamed server's enable override over to its new id. */
  moveEnabledOverride(fromId: string, toId: string): void;
  setConfigProblems(problems: McpConfigProblem[]): void;
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

/**
 * Ids whose override must survive a discovery pass that does not list them:
 * a server the dialog has just saved may be missing from a pass that read the
 * file a moment earlier. An id leaves the set the first time a pass lists it.
 */
const awaitedOverrideIds = new Set<string>();

export const useMcpStore = create<McpStore>()(
  persist(
    (set, get) => ({
      servers: [],
      enabledOverrides: {},
      rescanCounter: 0,
      configProblems: [],

      setServers(servers: McpServerEntry[]) {
        const overrides = { ...get().enabledOverrides };
        // A project-scoped server used to be `project:<name>` in every
        // project. Carry that override over to the per-project id of each
        // loaded project that has such a server, the first time it is seen.
        for (const s of servers) {
          if (s.projectRoot == null || overrides[s.id] !== undefined) continue;
          const legacy = overrides[mcpLegacyProjectServerId(s.name)];
          if (legacy !== undefined) overrides[s.id] = legacy;
        }
        // Apply persisted overrides and prune stale ones
        const activeIds = new Set(servers.map((s) => s.id));
        for (const id of activeIds) awaitedOverrideIds.delete(id);
        const prunedOverrides = Object.fromEntries(
          Object.entries(overrides).filter(([id]) => activeIds.has(id) || awaitedOverrideIds.has(id))
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

      setServerEnabled(id: string, enabled: boolean) {
        set((state) => ({
          servers: state.servers.map((s) => (s.id === id ? { ...s, enabled } : s)),
          enabledOverrides: { ...state.enabledOverrides, [id]: enabled },
        }));
      },

      enableOnNextDiscovery(id: string) {
        awaitedOverrideIds.add(id);
        get().setServerEnabled(id, true);
      },

      moveEnabledOverride(fromId: string, toId: string) {
        if (fromId === toId) return;
        const { [fromId]: previous, ...rest } = get().enabledOverrides;
        if (previous === undefined) return;
        awaitedOverrideIds.add(toId);
        set({ enabledOverrides: { ...rest, [toId]: previous } });
      },

      setConfigProblems(problems: McpConfigProblem[]) {
        set({ configProblems: problems });
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
      onRehydrateStorage: () => (_state, error) => handleRehydrateResult("mcp-store", error),
      partialize: (state) => ({
        enabledOverrides: state.enabledOverrides,
      }),
    }
  )
);
