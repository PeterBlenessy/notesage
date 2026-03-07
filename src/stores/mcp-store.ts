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

export type McpServerStatus = 'stopped' | 'starting' | 'running' | 'error';

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
  env: Record<string, string>;
  source: McpConfigSource;
  enabled: boolean;
  status: McpServerStatus;
  error?: string;
  tools: McpToolInfo[];
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
    }),
    {
      name: 'mcp-store',
      partialize: (state) => ({
        enabledOverrides: state.enabledOverrides,
      }),
    }
  )
);
