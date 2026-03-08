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
}

interface McpStatusEvent {
  serverId: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  error?: string;
  tools?: McpToolInfo[];
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
      // Collect base dirs for config discovery
      const baseDirs: string[] = [];
      for (const project of projects) {
        baseDirs.push(project.path);
      }

      try {
        // Discover configs from Notesage config files
        const configs: McpServerConfig[] = await invoke('mcp_discover_configs', {
          baseDirs,
        });

        if (cancelled) return;

        const entries = configs.map(configToEntry);
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
    const unlisten = listen<McpStatusEvent>('mcp-server-status', (event) => {
      const { serverId, status, error, tools } = event.payload;
      const store = useMcpStore.getState();
      store.setServerStatus(serverId, status, error);
      if (tools) {
        store.setServerTools(serverId, tools);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
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

  return { startServer, stopServer, restartServer, callTool };
}
