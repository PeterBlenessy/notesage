import { useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useMcpStore, type McpServerEntry, type McpToolInfo } from '@/stores/mcp-store';
import { toast } from 'sonner';
import { log } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types matching Rust backend
// ---------------------------------------------------------------------------

interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  source: 'notesage_global' | 'notesage_project' | 'claude_desktop' | 'cursor' | 'vscode';
  enabled: boolean;
  transport?: 'stdio' | 'http';
  url?: string | null;
}

interface McpServerInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  source: 'notesage_global' | 'notesage_project' | 'claude_desktop' | 'cursor' | 'vscode';
  enabled: boolean;
  status: 'stopped' | 'starting' | 'running' | 'error';
  error: string | null;
  tools: McpToolInfo[];
  transport?: 'stdio' | 'http';
  url?: string | null;
}

interface McpStatusEvent {
  serverId: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  error?: string;
  tools?: McpToolInfo[];
}

/** Result of a `mcp_validate_server` dry run (mirrors the Rust struct). */
export interface McpValidationResult {
  ok: boolean;
  tools: McpToolInfo[];
  server_info: unknown | null;
  error: string | null;
  /** "binary_not_found" | "spawn_failed" | "init_failed" | "timeout" */
  error_kind: string | null;
  stderr_tail: string | null;
}

/** Candidate config for validation, before it has a real id/source. */
export interface McpValidateInput {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Defaults to `stdio` when omitted. */
  transport?: 'stdio' | 'http';
  /** Required when `transport` is `http`. */
  url?: string | null;
}

// Map Rust snake_case source to frontend kebab-case
function mapSource(source: string): McpServerEntry['source'] {
  const mapping: Record<string, McpServerEntry['source']> = {
    notesage_global: 'notesage-global',
    notesage_project: 'notesage-project',
    claude_desktop: 'claude-desktop',
    cursor: 'cursor',
    vscode: 'vscode',
  };
  return mapping[source] ?? 'notesage-global';
}

function configToEntry(config: McpServerConfig): McpServerEntry {
  return {
    id: config.id,
    name: config.name,
    command: config.command,
    args: config.args,
    env: config.env,
    source: mapSource(config.source),
    enabled: config.enabled,
    status: 'stopped',
    tools: [],
    transport: config.transport ?? 'stdio',
    url: config.url ?? null,
  };
}

// ---------------------------------------------------------------------------
// useMcpDiscovery — mount in App.tsx
// ---------------------------------------------------------------------------

export function useMcpDiscovery() {
  const startupReady = useSettingsStore((s) => s.startupReady);
  const projects = useWorkspaceStore((s) => s.projects);
  const rescanCounter = useMcpStore((s) => s.rescanCounter);

  useEffect(() => {
    if (!startupReady) return;

    let cancelled = false;

    const run = async () => {
      try {
        // Task #20: scan per project so each server can be tagged with its
        // `projectRoot`. The Rust `mcp_discover_configs` includes the global
        // ~/.notesage/mcp.json in every call, so:
        //  1. Call once with `baseDirs: []` to pick up global entries — tag
        //     these with `projectRoot: null`.
        //  2. Call once per project and take only the project-sourced entries
        //     from each result, tagging them with that project's path.
        //
        // Running scans in parallel keeps startup latency bounded by the
        // slowest single scan rather than summing across all projects.
        const globalConfigs: McpServerConfig[] = await invoke('mcp_discover_configs', {
          baseDirs: [],
        });

        const perProjectResults = await Promise.all(
          projects.map(async (p) => {
            const configs: McpServerConfig[] = await invoke('mcp_discover_configs', {
              baseDirs: [p.path],
            });
            return { projectPath: p.path, configs };
          }),
        );

        if (cancelled) return;

        const entries: McpServerEntry[] = [];
        for (const c of globalConfigs) {
          entries.push({ ...configToEntry(c), projectRoot: null });
        }
        for (const { projectPath, configs } of perProjectResults) {
          for (const c of configs) {
            // `mcp_discover_configs` echoes the global entries in every call.
            // We already captured them in the global pass above; filter to
            // project-sourced entries only so we don't double-count.
            if (c.source !== 'notesage_project') continue;
            entries.push({ ...configToEntry(c), projectRoot: projectPath });
          }
        }

        useMcpStore.getState().setServers(entries);

        // Auto-start enabled servers concurrently
        const enabledEntries = entries.filter((e) => e.enabled);
        await Promise.allSettled(
          enabledEntries.map(async (entry) => {
            if (cancelled) return;
            try {
              const info: McpServerInfo = await invoke('mcp_start_server', {
                config: {
                  id: entry.id,
                  name: entry.name,
                  command: entry.command,
                  args: entry.args,
                  env: entry.env,
                  source: sourceToRust(entry.source),
                  enabled: entry.enabled,
                },
              });
              if (cancelled) return;
              const store = useMcpStore.getState();
              store.setServerStatus(entry.id, 'running');
              store.setServerTools(entry.id, info.tools);
            } catch (err) {
              if (!cancelled) {
                useMcpStore.getState().setServerStatus(entry.id, 'error', String(err));
              }
            }
          })
        );
      } catch (err) {
        log.error('mcp', 'MCP config discovery failed', err);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [startupReady, projects, rescanCounter]);

  // Listen for server status events from backend
  useEffect(() => {
    let mounted = true;
    let unlistenFn: (() => void) | null = null;

    listen<McpStatusEvent>('mcp-server-status', (event) => {
      if (!mounted) return;
      const { serverId, status, error, tools } = event.payload;
      const store = useMcpStore.getState();
      store.setServerStatus(serverId, status, error);
      if (tools) {
        store.setServerTools(serverId, tools);
      }
    }).then((fn) => {
      if (mounted) {
        unlistenFn = fn;
      } else {
        fn();
      }
    });

    return () => {
      mounted = false;
      unlistenFn?.();
    };
  }, []);
}

// ---------------------------------------------------------------------------
// useMcpOperations — used by components
// ---------------------------------------------------------------------------

function sourceToRust(source: McpServerEntry['source']): string {
  const mapping: Record<string, string> = {
    'notesage-global': 'notesage_global',
    'notesage-project': 'notesage_project',
    'claude-desktop': 'claude_desktop',
    cursor: 'cursor',
    vscode: 'vscode',
  };
  return mapping[source] ?? 'notesage_global';
}

export function useMcpOperations() {
  const startServer = useCallback(async (entry: McpServerEntry) => {
    useMcpStore.getState().setServerStatus(entry.id, 'starting');
    try {
      const info: McpServerInfo = await invoke('mcp_start_server', {
        config: {
          id: entry.id,
          name: entry.name,
          command: entry.command,
          args: entry.args,
          env: entry.env,
          source: sourceToRust(entry.source),
          enabled: entry.enabled,
          transport: entry.transport ?? 'stdio',
          url: entry.url ?? null,
        },
      });
      const store = useMcpStore.getState();
      store.setServerStatus(entry.id, 'running');
      store.setServerTools(entry.id, info.tools);
    } catch (err) {
      useMcpStore.getState().setServerStatus(entry.id, 'error', String(err));
      toast.error(`Failed to start MCP server "${entry.name}": ${err}`);
    }
  }, []);

  const stopServer = useCallback(async (id: string) => {
    try {
      await invoke('mcp_stop_server', { serverId: id });
      const store = useMcpStore.getState();
      store.setServerStatus(id, 'stopped');
      store.setServerTools(id, []);
    } catch (err) {
      toast.error(`Failed to stop MCP server: ${err}`);
    }
  }, []);

  const restartServer = useCallback(async (id: string) => {
    try {
      const info: McpServerInfo = await invoke('mcp_restart_server', { serverId: id });
      const store = useMcpStore.getState();
      store.setServerStatus(info.id, 'running');
      store.setServerTools(info.id, info.tools);
    } catch (err) {
      toast.error(`Failed to restart MCP server: ${err}`);
    }
  }, []);

  const callTool = useCallback(
    async (serverId: string, toolName: string, args: Record<string, unknown>) => {
      return invoke('mcp_call_tool', {
        serverId,
        toolName,
        arguments: args,
      });
    },
    []
  );

  /**
   * Dry-run a candidate config (spawn → initialize → tools/list → stop) without
   * registering it. Used by the Add/Edit dialog to preview tools and surface
   * actionable errors before the config is written to disk.
   */
  const validateServer = useCallback(
    async (input: McpValidateInput): Promise<McpValidationResult> => {
      return invoke<McpValidationResult>('mcp_validate_server', {
        config: {
          id: '__validate__',
          name: input.name || input.command || input.url || 'server',
          command: input.command,
          args: input.args,
          env: input.env,
          source: 'notesage_global',
          enabled: true,
          transport: input.transport ?? 'stdio',
          url: input.url ?? null,
        },
      });
    },
    []
  );

  return { startServer, stopServer, restartServer, callTool, validateServer };
}
