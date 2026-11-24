import { useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useMcpStore, isSecretEnvValue, type McpServerEntry, type McpToolInfo, type McpEnvValue } from '@/stores/mcp-store';
import { filterValidMcpConfigs, type McpServerConfig } from '@/lib/mcp/config-guards';
import { toast } from 'sonner';
import { log } from '@/lib/logger';
import { tauriApi } from '@/lib/tauri';

// ---------------------------------------------------------------------------
// Types matching Rust backend
// ---------------------------------------------------------------------------
// `McpServerConfig` (the wire shape of `mcp_discover_configs` /
// `mcp_import_configs`, parsed by Rust from foreign config files) lives in
// `src/lib/mcp/config-guards.ts` together with its runtime validators.

interface McpServerInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, McpEnvValue>;
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
  /**
   * Prospective server id used to resolve an OAuth token from the keychain
   * during validation (so a just-authorized remote server tests with its
   * bearer token). Defaults to a throwaway id.
   */
  id?: string;
}

/** OAuth authorization status for a remote MCP server. */
export interface McpOAuthStatus {
  authorized: boolean;
  expires_at: number | null;
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
// Starting servers
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

/**
 * Everything that decides what process (or connection) a server is: two
 * entries with the same signature would be launched identically. The name,
 * the source and the enabled flag are not part of it.
 */
function launchSignature(entry: McpServerEntry): string {
  const env = Object.keys(entry.env)
    .sort()
    .map((key) => [key, entry.env[key]]);
  return JSON.stringify([
    entry.transport ?? 'stdio',
    entry.command,
    entry.args,
    env,
    entry.url ?? null,
  ]);
}

/**
 * Part of what this server is launched with lives in the keychain (a secret
 * env value, an OAuth token), where the signature cannot see it change.
 */
function hasKeychainInputs(entry: McpServerEntry): boolean {
  return (
    (entry.transport ?? 'stdio') === 'http' ||
    Object.values(entry.env).some((value) => isSecretEnvValue(value))
  );
}

/** The signature each server was last started with, by server id. */
const startedSignatures = new Map<string, string>();
/** Starts still in flight, so a second request for the same launch joins the first. */
const pendingStarts = new Map<string, { signature: string; promise: Promise<McpServerInfo> }>();

/**
 * `mcp_start_server` kills a running server with the same id and spawns it
 * again, so it must only be called when that is what is wanted. Every start
 * goes through here: the signature is remembered on success (discovery reads
 * it to leave an unchanged, running server alone) and a start already in
 * flight for the same launch is shared rather than issued twice.
 */
function startConfiguredServer(entry: McpServerEntry): Promise<McpServerInfo> {
  const signature = launchSignature(entry);
  const pending = pendingStarts.get(entry.id);
  if (pending && pending.signature === signature) return pending.promise;

  const promise: Promise<McpServerInfo> = invoke<McpServerInfo>('mcp_start_server', {
    config: {
      id: entry.id,
      name: entry.name,
      command: entry.command,
      args: entry.args,
      env: entry.env,
      source: sourceToRust(entry.source),
      enabled: entry.enabled,
      // Carry transport + url so http servers launch over HTTP, not
      // silently as stdio (they have no command/args).
      transport: entry.transport ?? 'stdio',
      url: entry.url ?? null,
    },
  }).then(
    (info) => {
      startedSignatures.set(entry.id, signature);
      return info;
    },
    (err: unknown) => {
      startedSignatures.delete(entry.id);
      throw err;
    },
  ).finally(() => {
    if (pendingStarts.get(entry.id)?.promise === promise) pendingStarts.delete(entry.id);
  });
  pendingStarts.set(entry.id, { signature, promise });
  return promise;
}

// ---------------------------------------------------------------------------
// useMcpDiscovery — mount in App.tsx
// ---------------------------------------------------------------------------

/** Separates project paths in the effect key. Cannot occur in a path. */
const PROJECT_KEY_SEPARATOR = '\n';

export function useMcpDiscovery() {
  const startupReady = useSettingsStore((s) => s.startupReady);
  // The SET of project roots, as one string: discovery reads each project's
  // `.notesage/mcp.json`, so it depends on which projects exist and on nothing
  // inside them. Subscribing to `projects` itself re-ran this effect on every
  // tree refresh (the array is replaced whenever a file is created or
  // deleted), which re-read every config and restarted every server. A config
  // file that changes on disk is picked up through `rescanCounter`, which the
  // file watcher bumps for any `mcp.json` event.
  const projectPathsKey = useWorkspaceStore((s) =>
    s.projects.map((p) => p.path).join(PROJECT_KEY_SEPARATOR),
  );
  const rescanCounter = useMcpStore((s) => s.rescanCounter);
  // A rescan somebody asked for (the Rescan button, saving a server, a config
  // file changing on disk), as opposed to the project set changing. It stays
  // pending until a discovery pass has acted on it.
  const lastRescanCounter = useRef(rescanCounter);
  const rescanRequested = useRef(false);

  useEffect(() => {
    if (lastRescanCounter.current !== rescanCounter) {
      lastRescanCounter.current = rescanCounter;
      rescanRequested.current = true;
    }
    if (!startupReady) return;

    let cancelled = false;
    const projectPaths = projectPathsKey === '' ? [] : projectPathsKey.split(PROJECT_KEY_SEPARATOR);

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
        // The command reads foreign, user-editable config files — validate the
        // wire shape at runtime and skip malformed entries instead of trusting
        // an `invoke<...>` type assertion (see config-guards.ts).
        const globalRaw = await invoke<unknown>('mcp_discover_configs', {
          baseDirs: [],
        });
        const { configs: globalConfigs } = filterValidMcpConfigs(
          globalRaw,
          'mcp_discover_configs (global)',
        );

        const perProjectResults = await Promise.all(
          projectPaths.map(async (projectPath) => {
            const raw = await invoke<unknown>('mcp_discover_configs', {
              baseDirs: [projectPath],
            });
            const { configs } = filterValidMcpConfigs(
              raw,
              `mcp_discover_configs (${projectPath})`,
            );
            return { projectPath, configs };
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

        // A server that is running with exactly this launch configuration is
        // left alone: starting it again would kill and respawn it, dropping
        // whatever a chat was doing with it. It keeps its status and tools
        // (a freshly discovered entry starts out as `stopped` with none).
        //
        // The exception is a requested rescan of a server whose secrets or
        // OAuth token live in the keychain: saving a new secret leaves
        // `mcp.json` byte-identical, so the rescan that follows is the only
        // thing that makes the server pick it up.
        const requested = rescanRequested.current;
        rescanRequested.current = false;
        const previous = new Map(useMcpStore.getState().servers.map((s) => [s.id, s]));
        const unchanged = new Set<string>();
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const before = previous.get(entry.id);
          if (
            before?.status === 'running' &&
            startedSignatures.get(entry.id) === launchSignature(entry) &&
            !(requested && hasKeychainInputs(entry))
          ) {
            unchanged.add(entry.id);
            entries[i] = { ...entry, status: 'running', tools: before.tools };
          }
        }

        useMcpStore.getState().setServers(entries);

        // Auto-start enabled servers concurrently
        const enabledEntries = entries.filter((e) => e.enabled && !unchanged.has(e.id));
        await Promise.allSettled(
          enabledEntries.map(async (entry) => {
            if (cancelled) return;
            try {
              const info = await startConfiguredServer(entry);
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
  }, [startupReady, projectPathsKey, rescanCounter]);

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

/**
 * Fetch the backend's server snapshot (`mcp_get_server_status`) and reconcile
 * the mcp-store: each known server takes the backend's status/error/tools;
 * servers the backend has no handle for (never started, or stopped and
 * removed) are marked stopped with no tools.
 *
 * Module-level (not hook-bound) so it is directly unit-testable and callable
 * from non-component code.
 */
export async function refreshMcpServerStatus(): Promise<void> {
  const infos = await tauriApi.mcpGetServerStatus();
  const store = useMcpStore.getState();
  const byId = new Map(infos.map((i) => [i.id, i]));

  for (const server of store.servers) {
    const info = byId.get(server.id);
    if (info) {
      store.setServerStatus(server.id, info.status, info.error ?? undefined);
      store.setServerTools(server.id, info.tools);
    } else {
      store.setServerStatus(server.id, 'stopped');
      store.setServerTools(server.id, []);
    }
  }
}

export function useMcpOperations() {
  const startServer = useCallback(async (entry: McpServerEntry) => {
    useMcpStore.getState().setServerStatus(entry.id, 'starting');
    try {
      const info = await startConfiguredServer(entry);
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
      startedSignatures.delete(id);
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
          id: input.id || '__validate__',
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

  /** Run the browser OAuth flow for a remote server; resolves when authorized. */
  const oauthAuthorize = useCallback(
    async (serverId: string, serverUrl: string, scope?: string): Promise<McpOAuthStatus> => {
      return invoke<McpOAuthStatus>('mcp_oauth_authorize', {
        serverId,
        serverUrl,
        scope: scope ?? null,
      });
    },
    []
  );

  const oauthStatus = useCallback(async (serverId: string): Promise<McpOAuthStatus> => {
    return invoke<McpOAuthStatus>('mcp_oauth_status', { serverId });
  }, []);

  const oauthLogout = useCallback(async (serverId: string): Promise<void> => {
    await invoke('mcp_oauth_logout', { serverId });
  }, []);

  return {
    startServer,
    stopServer,
    restartServer,
    callTool,
    validateServer,
    oauthAuthorize,
    oauthStatus,
    oauthLogout,
  };
}
