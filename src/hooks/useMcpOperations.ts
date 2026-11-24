import { useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import {
  useMcpStore,
  isSecretEnvValue,
  mcpLegacyProjectServerId,
  mcpProjectServerId,
  type McpConfigProblem,
  type McpServerEntry,
  type McpToolInfo,
  type McpEnvValue,
} from '@/stores/mcp-store';
import { filterValidMcpConfigs, type McpServerConfig } from '@/lib/mcp/config-guards';
import { toast } from 'sonner';
import { log } from '@/lib/logger';
import { tauriApi } from '@/lib/tauri';
import { t } from '@/lib/i18n';

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
  headers?: Record<string, McpEnvValue> | null;
  cwd?: string | null;
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
  /** Static headers for a remote server (plaintext values for the dry run). */
  headers?: Record<string, string>;
  /** Working directory for a stdio server. */
  cwd?: string | null;
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
    headers: config.headers ?? {},
    cwd: config.cwd ?? null,
  };
}

/**
 * The backend names every project's server `project:<name>`, so two projects
 * with a server of the same name would share one id (and with it one enable
 * override, one keychain namespace and one running process). The project is
 * made part of the id here. An id that is already something else is kept, so
 * a backend that starts sending unique ids is not second-guessed.
 */
function projectScopedId(config: McpServerConfig, projectPath: string): string {
  return config.id === mcpLegacyProjectServerId(config.name)
    ? mcpProjectServerId(projectPath, config.name)
    : config.id;
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
  const sorted = (record: Record<string, McpEnvValue>) =>
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]);
  return JSON.stringify([
    entry.transport ?? 'stdio',
    entry.command,
    entry.args,
    sorted(entry.env),
    entry.url ?? null,
    sorted(entry.headers ?? {}),
    entry.cwd ?? null,
  ]);
}

/**
 * Part of what this server is launched with lives in the keychain (a secret
 * env value, an OAuth token), where the signature cannot see it change.
 */
function hasKeychainInputs(entry: McpServerEntry): boolean {
  return (
    (entry.transport ?? 'stdio') === 'http' ||
    Object.values(entry.env).some((value) => isSecretEnvValue(value)) ||
    Object.values(entry.headers ?? {}).some((value) => isSecretEnvValue(value))
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
  stoppedByUser.delete(entry.id);
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
      headers: entry.headers ?? {},
      cwd: entry.cwd ?? null,
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
// Lifecycle: failures, exits and automatic retries
// ---------------------------------------------------------------------------

/**
 * How long to wait before each automatic retry of a server that failed to
 * start or exited. After the last one the server stays in its error state
 * until the user, or a change to its configuration, starts it again.
 */
export const MCP_RETRY_DELAYS_MS: readonly number[] = [5_000, 30_000, 120_000];

/**
 * A server that stays up this long is considered healthy again, and gets the
 * full set of retries the next time it fails. Shorter than that, a start that
 * "succeeds" and then dies would be retried every five seconds for ever.
 */
export const MCP_RETRY_SETTLE_MS = 60_000;

interface RetryState {
  /** Retries already made for this launch configuration. */
  attempts: number;
  /** The retry that is waiting to run, if any. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Clears this state once the server has stayed up. */
  settle: ReturnType<typeof setTimeout> | null;
  signature: string;
}

const retries = new Map<string, RetryState>();
/** Servers the user stopped: the exit that follows is not a crash. */
const stoppedByUser = new Set<string>();
/** Servers with a restart in flight, whose old process is expected to go. */
const busy = new Set<string>();
/** Servers a failure toast was already shown for in this launch. */
const notifiedFailures = new Set<string>();

function clearRetry(id: string): void {
  const state = retries.get(id);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  if (state.settle) clearTimeout(state.settle);
  retries.delete(id);
}

/** One toast per server per launch, however often it fails. */
function notifyOnce(
  entry: McpServerEntry,
  message: 'mcp.autoStartFailed' | 'mcp.serverExited',
): void {
  if (notifiedFailures.has(entry.id)) return;
  notifiedFailures.add(entry.id);
  toast.error(t(message, { name: entry.name }), {
    description: t('mcp.seeSettingsHint', { section: t('settings.skillsAgents') }),
  });
}

/**
 * Queue the next automatic retry for a server that failed to start or exited.
 * Does nothing for a server that is switched off, already has a retry
 * waiting, or has used its retries up.
 */
function scheduleRetry(id: string): void {
  const entry = useMcpStore.getState().getServer(id);
  if (!entry || !entry.enabled) {
    clearRetry(id);
    return;
  }
  const signature = launchSignature(entry);
  let state = retries.get(id);
  if (state && state.signature !== signature) {
    clearRetry(id);
    state = undefined;
  }
  if (state?.timer) return;
  if (state?.settle) {
    clearTimeout(state.settle);
    state.settle = null;
  }
  const attempts = state?.attempts ?? 0;
  if (attempts >= MCP_RETRY_DELAYS_MS.length) return;
  const timer = setTimeout(() => {
    void runRetry(id).catch(() => {});
  }, MCP_RETRY_DELAYS_MS[attempts]);
  retries.set(id, { attempts, timer, settle: null, signature });
}

async function runRetry(id: string): Promise<void> {
  const state = retries.get(id);
  if (!state) return;
  state.timer = null;
  const entry = useMcpStore.getState().getServer(id);
  // Never while disabled, and never for a configuration other than the one
  // that failed (discovery starts a changed server itself).
  if (!entry || !entry.enabled || launchSignature(entry) !== state.signature) {
    clearRetry(id);
    return;
  }
  if (entry.status === 'running' || pendingStarts.has(id) || busy.has(id)) return;

  state.attempts += 1;
  useMcpStore.getState().setServerStatus(id, 'starting');
  try {
    const info = await startConfiguredServer(entry);
    noteStartSucceeded(id);
    const store = useMcpStore.getState();
    store.setServerStatus(id, 'running');
    store.setServerTools(id, info.tools);
  } catch (err) {
    useMcpStore.getState().setServerStatus(id, 'error', String(err));
    scheduleRetry(id);
  }
}

/** A start succeeded: forget the retries once the server has stayed up. */
function noteStartSucceeded(id: string): void {
  const state = retries.get(id);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  if (state.settle) clearTimeout(state.settle);
  state.settle = setTimeout(() => {
    if (retries.get(id) === state) retries.delete(id);
  }, MCP_RETRY_SETTLE_MS);
}

/**
 * The backend said a server is in error. For a server this app believes is up
 * that normally means its process exited, but the same event is also the last
 * word of a process that was replaced by a restart or stopped on purpose, and
 * acting on that one would restart a healthy server. So: ignore it while a
 * start, restart or deliberate stop accounts for it, and otherwise ask the
 * backend whether the server is really down before marking it so.
 */
async function handleServerErrorEvent(serverId: string, error: string | undefined): Promise<void> {
  const accountedFor = () =>
    pendingStarts.has(serverId) || busy.has(serverId) || stoppedByUser.has(serverId);
  const before = useMcpStore.getState().getServer(serverId);
  if (!before || accountedFor()) return;

  if (before.status === 'error') {
    // Already down; the backend may know more about why.
    if (error) useMcpStore.getState().setServerStatus(serverId, 'error', error);
    return;
  }
  if (before.status === 'stopped') return;

  try {
    const infos = await tauriApi.mcpGetServerStatus();
    if (infos.some((info) => info.id === serverId && info.status === 'running')) return;
  } catch {
    // Cannot ask: take the event at its word.
  }
  if (accountedFor()) return;

  startedSignatures.delete(serverId);
  const store = useMcpStore.getState();
  store.setServerStatus(serverId, 'error', error);
  store.setServerTools(serverId, []);
  const entry = store.getServer(serverId);
  if (entry?.enabled) {
    notifyOnce(entry, 'mcp.serverExited');
    scheduleRetry(serverId);
  }
}

function isConfigProblem(value: unknown): value is McpConfigProblem {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === 'string' && typeof v.source === 'string' && typeof v.reason === 'string';
}

async function fetchConfigProblems(projectPaths: string[]): Promise<McpConfigProblem[]> {
  const raw: unknown = await tauriApi.mcpConfigProblems(projectPaths);
  return Array.isArray(raw) ? raw.filter(isConfigProblem) : [];
}

const MCP_CONFIG_RELATIVE_PATH = '.notesage/mcp.json';

/**
 * Config entries the backend could not load; none when it cannot say.
 *
 * The backend names the kind of file (global or project), not the file. The
 * global one is known; a project one is known when there is a single project,
 * and otherwise found by asking again per project, which only happens when a
 * project file actually has a problem.
 */
async function loadConfigProblems(projectPaths: string[]): Promise<McpConfigProblem[]> {
  try {
    const all = await fetchConfigProblems(projectPaths);
    if (all.length === 0) return [];

    // A problem with a whole file is named by that file's path.
    const withOwnPath = (problem: McpConfigProblem): McpConfigProblem =>
      problem.name.startsWith('/') ? { ...problem, file: problem.name } : problem;

    let globalFile: string | null = null;
    try {
      globalFile = `${await tauriApi.getHomeDir()}/${MCP_CONFIG_RELATIVE_PATH}`;
    } catch {
      // Shown without a file to open.
    }
    const out: McpConfigProblem[] = all
      .filter((problem) => problem.source !== 'notesage_project')
      .map((problem) => withOwnPath({ ...problem, file: globalFile }));

    const inProjects = all.filter((problem) => problem.source === 'notesage_project');
    if (inProjects.length === 0) return out;
    if (projectPaths.length === 1) {
      const file = `${projectPaths[0]}/${MCP_CONFIG_RELATIVE_PATH}`;
      return [...out, ...inProjects.map((problem) => withOwnPath({ ...problem, file }))];
    }
    const perProject = await Promise.all(
      projectPaths.map(async (projectPath) => {
        const file = `${projectPath}/${MCP_CONFIG_RELATIVE_PATH}`;
        try {
          return (await fetchConfigProblems([projectPath]))
            .filter((problem) => problem.source === 'notesage_project')
            .map((problem) => withOwnPath({ ...problem, file }));
        } catch {
          return [];
        }
      }),
    );
    const attributed = perProject.flat();
    // Never lose a problem because it could not be attributed to a file.
    return [...out, ...(attributed.length > 0 ? attributed : inProjects.map(withOwnPath))];
  } catch {
    return [];
  }
}

/** Forget every retry, notification and start record. For tests only. */
export function resetMcpLifecycleForTests(): void {
  for (const id of [...retries.keys()]) clearRetry(id);
  stoppedByUser.clear();
  busy.clear();
  notifiedFailures.clear();
  startedSignatures.clear();
  pendingStarts.clear();
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
            entries.push({
              ...configToEntry(c),
              id: projectScopedId(c, projectPath),
              projectRoot: projectPath,
            });
          }
        }

        // Entries the backend could not load are shown in Settings. A backend
        // without the command simply has none to report.
        void loadConfigProblems(projectPaths).then((problems) => {
          if (!cancelled) useMcpStore.getState().setConfigProblems(problems);
        });

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
        // Automatic retries belong to one launch configuration: a server that
        // is gone, or changed, starts over, and so does everything when the
        // pass was asked for (the Rescan button, a saved server, an edited
        // config file).
        const discovered = new Map(entries.map((e) => [e.id, e]));
        for (const [id, retry] of [...retries]) {
          const entry = discovered.get(id);
          if (requested || !entry || launchSignature(entry) !== retry.signature) clearRetry(id);
        }
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

        // Auto-start enabled servers concurrently. "Enabled" is read back
        // from the store, where `setServers` has just applied the user's
        // overrides: the backend reports every discovered server as switched
        // off (its security default), so the discovered list alone would
        // never start a server the user switched on.
        const enabledEntries = useMcpStore
          .getState()
          .servers.filter((e) => e.enabled && !unchanged.has(e.id));
        await Promise.allSettled(
          enabledEntries.map(async (entry) => {
            if (cancelled) return;
            try {
              const info = await startConfiguredServer(entry);
              noteStartSucceeded(entry.id);
              if (cancelled) return;
              const store = useMcpStore.getState();
              store.setServerStatus(entry.id, 'running');
              store.setServerTools(entry.id, info.tools);
            } catch (err) {
              if (cancelled) return;
              useMcpStore.getState().setServerStatus(entry.id, 'error', String(err));
              notifyOnce(entry, 'mcp.autoStartFailed');
              scheduleRetry(entry.id);
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
      if (status === 'error') {
        // A process that exited, or the last word of one that was replaced
        // or stopped on purpose: decided in one place.
        void handleServerErrorEvent(serverId, error).catch(() => {});
        return;
      }
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
      // Nothing may start a server after the app's MCP lifecycle is gone.
      for (const id of [...retries.keys()]) clearRetry(id);
    };
  }, []);
}

// ---------------------------------------------------------------------------
// useMcpOperations — used by components
// ---------------------------------------------------------------------------

/**
 * Fetch the backend's server snapshot (`mcp_get_server_status`) and reconcile
 * the mcp-store: each known server takes the backend's status/error, and its
 * tools only while the backend reports it running; servers the backend has no
 * handle for (never started, or stopped and removed) are marked stopped with
 * no tools, unless the card is showing why a start failed.
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
    // A start or restart in flight reports its own outcome.
    if (pendingStarts.has(server.id) || busy.has(server.id)) continue;
    if (info) {
      store.setServerStatus(server.id, info.status, info.error ?? undefined);
      // Only a running server has tools to offer: a dead one must not keep
      // the list it had while it was alive.
      store.setServerTools(server.id, info.status === 'running' ? info.tools : []);
      if (info.status !== 'running') startedSignatures.delete(server.id);
    } else if (server.status === 'error') {
      // The backend keeps no record of a server that failed to start. The
      // error the card shows is the only account of why; keep it.
      store.setServerTools(server.id, []);
      startedSignatures.delete(server.id);
    } else {
      store.setServerStatus(server.id, 'stopped');
      store.setServerTools(server.id, []);
      startedSignatures.delete(server.id);
    }
  }
}

export function useMcpOperations() {
  const startServer = useCallback(async (entry: McpServerEntry) => {
    // A manual start begins a fresh round: no retry left over from before.
    clearRetry(entry.id);
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
    clearRetry(id);
    // The process's exit after this is expected, not a crash.
    stoppedByUser.add(id);
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

  /**
   * Restart a server, whatever state it is in. A running one is restarted by
   * the backend; one that failed or was stopped is not registered there
   * (older backends answer "not found"), so it is started from its config.
   * Restarting a server that is switched off also switches it on, or it would
   * run without its tools being offered to any chat.
   */
  const restartServer = useCallback(async (id: string) => {
    clearRetry(id);
    const before = useMcpStore.getState().getServer(id);
    if (before && !before.enabled) useMcpStore.getState().setServerEnabled(id, true);
    const entry = useMcpStore.getState().getServer(id);
    const wasRunning = before?.status === 'running';
    if (entry) useMcpStore.getState().setServerStatus(id, 'starting');
    busy.add(id);
    try {
      let info: McpServerInfo;
      if (entry && !wasRunning) {
        info = await startConfiguredServer(entry);
      } else {
        try {
          stoppedByUser.delete(id);
          info = await invoke<McpServerInfo>('mcp_restart_server', { serverId: id });
          if (entry) startedSignatures.set(id, launchSignature(entry));
        } catch (err) {
          // The backend does not know this server (it was never started in
          // this session, or an older backend dropped it when it failed).
          if (!entry || !/not found|has not been started/i.test(String(err))) throw err;
          info = await startConfiguredServer(entry);
        }
      }
      const store = useMcpStore.getState();
      store.setServerStatus(id, 'running');
      store.setServerTools(id, info.tools);
    } catch (err) {
      if (entry) {
        startedSignatures.delete(id);
        useMcpStore.getState().setServerStatus(id, 'error', String(err));
        useMcpStore.getState().setServerTools(id, []);
      }
      toast.error(`Failed to restart MCP server: ${err}`);
    } finally {
      busy.delete(id);
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
          headers: input.headers ?? {},
          cwd: input.cwd ?? null,
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
