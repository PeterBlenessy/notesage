// @vitest-environment jsdom

/**
 * MCP server lifecycle: which servers are started at launch, what the user is
 * told when one fails, the bounded automatic retries, the reaction to a
 * server process exiting, per-project server ids and config problems.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  setMockInvokeHandler,
  clearMockInvokeHandlers,
  registerDefaultHandlers,
  emitMockEvent,
} from '@/test/tauri-mock';
import { toast } from 'sonner';
import {
  useMcpDiscovery,
  useMcpOperations,
  refreshMcpServerStatus,
  resetMcpLifecycleForTests,
  MCP_RETRY_DELAYS_MS,
  MCP_RETRY_SETTLE_MS,
} from '../useMcpOperations';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useMcpStore, mcpProjectServerId } from '@/stores/mcp-store';

interface WireConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string | { secret: boolean }>;
  source: string;
  enabled: boolean;
  transport?: string;
  url?: string | null;
}

/** A config as the backend reports it: always switched off. */
function wire(id: string, overrides: Partial<WireConfig> = {}): WireConfig {
  return {
    id,
    name: id.split(':').pop() as string,
    command: 'node',
    args: ['server.js'],
    env: {},
    source: id.startsWith('global:') ? 'notesage_global' : 'notesage_project',
    enabled: false,
    ...overrides,
  };
}

/** What discovery returns, keyed by base dir ('' = the global pass). */
let configsByDir: Record<string, WireConfig[]>;
let startCalls: string[];
/** Ids whose start fails, with the error. */
let failing: Map<string, string>;
/** What `mcp_get_server_status` reports. */
let backendStatus: Array<{ id: string; name: string; status: string; error: string | null; tools: unknown[] }>;

const TOOL = (id: string) => ({ name: `tool-of-${id}`, description: null, input_schema: {}, server_id: id });

/** Let every pending promise and zero-delay timer run. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

async function mount() {
  const hook = renderHook(() => useMcpDiscovery());
  await settle();
  return hook;
}

async function rescan() {
  act(() => {
    useMcpStore.getState().requestRescan();
  });
  await settle();
}

const status = (id: string) => useMcpStore.getState().getServer(id)?.status;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  clearMockInvokeHandlers();
  registerDefaultHandlers();
  resetMcpLifecycleForTests();
  startCalls = [];
  failing = new Map();
  backendStatus = [];
  configsByDir = { '': [wire('global:files')] };
  setMockInvokeHandler('mcp_discover_configs', (args) => {
    const dir = ((args as { baseDirs: string[] }).baseDirs[0]) ?? '';
    return configsByDir[dir] ?? configsByDir[''];
  });
  setMockInvokeHandler('mcp_start_server', (args) => {
    const config = (args as { config: WireConfig }).config;
    startCalls.push(config.id);
    const error = failing.get(config.id);
    if (error) throw new Error(error);
    return { ...config, status: 'running', error: null, tools: [TOOL(config.id)] };
  });
  setMockInvokeHandler('mcp_stop_server', () => undefined);
  setMockInvokeHandler('mcp_get_server_status', () => backendStatus);
  useMcpStore.setState({
    servers: [],
    enabledOverrides: { 'global:files': true },
    rescanCounter: 0,
    configProblems: [],
  });
  useWorkspaceStore.setState({ projects: [], explorerFolders: [] });
  useSettingsStore.setState({ startupReady: true });
});

afterEach(() => {
  resetMcpLifecycleForTests();
  vi.useRealTimers();
});

describe('auto-start at launch', () => {
  it('starts a server the user switched on, although the backend reports every server as off', async () => {
    configsByDir[''] = [wire('global:files'), wire('global:never-enabled')];
    await mount();

    expect(startCalls).toEqual(['global:files']);
    expect(status('global:files')).toBe('running');
    expect(status('global:never-enabled')).toBe('stopped');
  });

  it('passes headers and cwd to the backend when starting', async () => {
    const seen: Array<Record<string, unknown>> = [];
    setMockInvokeHandler('mcp_start_server', (args) => {
      const config = (args as { config: Record<string, unknown> }).config;
      seen.push(config);
      return { ...config, status: 'running', error: null, tools: [] };
    });
    configsByDir[''] = [
      { ...wire('global:files'), cwd: '~/work' } as WireConfig,
      {
        ...wire('global:api', { command: '', args: [], transport: 'http', url: 'https://x.test/mcp' }),
        headers: { Authorization: { secret: true }, 'X-Tenant': 'acme' },
      } as WireConfig,
    ];
    useMcpStore.setState({ enabledOverrides: { 'global:files': true, 'global:api': true } });
    await mount();

    expect(seen.find((c) => c.id === 'global:files')).toMatchObject({ cwd: '~/work', headers: {} });
    expect(seen.find((c) => c.id === 'global:api')).toMatchObject({
      transport: 'http',
      url: 'https://x.test/mcp',
      headers: { Authorization: { secret: true }, 'X-Tenant': 'acme' },
      cwd: null,
    });
  });
});

describe('a server that fails to auto-start', () => {
  it('toasts once per server per launch, naming the server and pointing to Settings', async () => {
    failing.set('global:files', 'Failed to spawn MCP server');
    await mount();

    expect(status('global:files')).toBe('error');
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      'MCP server “files” could not start',
      { description: expect.stringMatching(/Settings → .* → MCP Servers/) },
    );

    // It keeps failing: on a rescan, and on every automatic retry.
    await rescan();
    await advance(MCP_RETRY_DELAYS_MS[0]);
    await advance(MCP_RETRY_DELAYS_MS[1]);
    expect(startCalls.length).toBeGreaterThan(2);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('toasts separately for each server that fails', async () => {
    configsByDir[''] = [wire('global:files'), wire('global:git')];
    useMcpStore.setState({ enabledOverrides: { 'global:files': true, 'global:git': true } });
    failing.set('global:files', 'boom');
    failing.set('global:git', 'boom');
    await mount();

    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it('retries 3 times with backoff (5 s, 30 s, 2 min) and then stops', async () => {
    failing.set('global:files', 'boom');
    await mount();
    expect(startCalls).toHaveLength(1);

    await advance(MCP_RETRY_DELAYS_MS[0] - 1);
    expect(startCalls).toHaveLength(1);
    await advance(1);
    expect(startCalls).toHaveLength(2);

    await advance(MCP_RETRY_DELAYS_MS[1] - 1);
    expect(startCalls).toHaveLength(2);
    await advance(1);
    expect(startCalls).toHaveLength(3);

    await advance(MCP_RETRY_DELAYS_MS[2] - 1);
    expect(startCalls).toHaveLength(3);
    await advance(1);
    expect(startCalls).toHaveLength(4);

    // Out of retries: nothing more, however long it waits.
    await advance(60 * 60 * 1000);
    expect(startCalls).toHaveLength(4);
    expect(status('global:files')).toBe('error');
    expect(MCP_RETRY_DELAYS_MS).toEqual([5_000, 30_000, 120_000]);
  });

  it('a retry that succeeds leaves the server running and ends the retries', async () => {
    failing.set('global:files', 'still downloading');
    await mount();
    failing.clear();

    await advance(MCP_RETRY_DELAYS_MS[0]);

    expect(startCalls).toHaveLength(2);
    expect(status('global:files')).toBe('running');
    expect(useMcpStore.getState().getServer('global:files')?.tools).toHaveLength(1);
    await advance(60 * 60 * 1000);
    expect(startCalls).toHaveLength(2);
  });

  it('does not retry once the server is switched off', async () => {
    failing.set('global:files', 'boom');
    await mount();

    act(() => {
      useMcpStore.getState().toggleServer('global:files');
    });
    await advance(60 * 60 * 1000);

    expect(startCalls).toHaveLength(1);
  });

  it('a config change cancels the pending retry and gives the new config a full set of retries', async () => {
    failing.set('global:files', 'boom');
    await mount();
    await advance(MCP_RETRY_DELAYS_MS[0]);
    await advance(MCP_RETRY_DELAYS_MS[1]);
    // Original start + two retries; the third (2 min) is pending.
    expect(startCalls).toHaveLength(3);

    configsByDir[''] = [wire('global:files', { args: ['server.js', '--fixed'] })];
    await rescan();
    // The rescan starts the changed server itself...
    expect(startCalls).toHaveLength(4);

    // ...and the old 2-minute retry is gone: the next attempt is the new
    // config's first retry, 5 s later, followed by the rest of a full set.
    await advance(MCP_RETRY_DELAYS_MS[0]);
    expect(startCalls).toHaveLength(5);
    await advance(MCP_RETRY_DELAYS_MS[1]);
    expect(startCalls).toHaveLength(6);
    await advance(MCP_RETRY_DELAYS_MS[2]);
    expect(startCalls).toHaveLength(7);
    await advance(60 * 60 * 1000);
    expect(startCalls).toHaveLength(7);
  });

  it('a manual start cancels the pending retry', async () => {
    failing.set('global:files', 'boom');
    await mount();
    const { result } = renderHook(() => useMcpOperations());
    failing.clear();

    await act(async () => {
      await result.current.startServer(useMcpStore.getState().getServer('global:files')!);
    });
    expect(startCalls).toHaveLength(2);
    expect(status('global:files')).toBe('running');

    await advance(60 * 60 * 1000);
    expect(startCalls).toHaveLength(2);
  });

  it('unmounting cancels pending retries', async () => {
    failing.set('global:files', 'boom');
    const hook = await mount();
    hook.unmount();

    await advance(60 * 60 * 1000);
    expect(startCalls).toHaveLength(1);
  });
});

describe('a running server whose process exits', () => {
  const exited = 'Server process exited (exit code 1)\n\nServer output:\nError: EADDRINUSE';

  it('is shown as failed with the backend\'s reason, loses its tools, toasts once and is restarted after 5 s', async () => {
    await mount();
    expect(status('global:files')).toBe('running');
    startCalls = [];
    // The backend marks it failed before it emits the event.
    backendStatus = [{ id: 'global:files', name: 'files', status: 'error', error: exited, tools: [] }];

    act(() => {
      emitMockEvent('mcp-server-status', { serverId: 'global:files', status: 'error', error: exited });
    });
    await settle();

    const server = useMcpStore.getState().getServer('global:files');
    expect(server?.status).toBe('error');
    expect(server?.error).toBe(exited);
    expect(server?.tools).toEqual([]);
    expect(useMcpStore.getState().getActiveTools()).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith('MCP server “files” stopped unexpectedly', expect.anything());

    await advance(MCP_RETRY_DELAYS_MS[0]);
    expect(startCalls).toEqual(['global:files']);
    expect(status('global:files')).toBe('running');
  });

  it('a server that keeps dying shortly after it starts is not restarted for ever', async () => {
    await mount();
    startCalls = [];
    const die = async () => {
      backendStatus = [{ id: 'global:files', name: 'files', status: 'error', error: exited, tools: [] }];
      act(() => {
        emitMockEvent('mcp-server-status', { serverId: 'global:files', status: 'error', error: exited });
      });
      await settle();
    };

    await die();
    await advance(MCP_RETRY_DELAYS_MS[0]);
    await die();
    await advance(MCP_RETRY_DELAYS_MS[1]);
    await die();
    await advance(MCP_RETRY_DELAYS_MS[2]);
    expect(startCalls).toHaveLength(3);
    await die();

    await advance(60 * 60 * 1000);
    expect(startCalls).toHaveLength(3);
    expect(status('global:files')).toBe('error');
  });

  it('a server that stayed up gets a full set of retries the next time it exits', async () => {
    await mount();
    startCalls = [];
    const die = async () => {
      backendStatus = [{ id: 'global:files', name: 'files', status: 'error', error: exited, tools: [] }];
      act(() => {
        emitMockEvent('mcp-server-status', { serverId: 'global:files', status: 'error', error: exited });
      });
      await settle();
    };

    await die();
    await advance(MCP_RETRY_DELAYS_MS[0]);
    expect(startCalls).toHaveLength(1);
    await advance(MCP_RETRY_SETTLE_MS);

    await die();
    // The first delay again, not the second.
    await advance(MCP_RETRY_DELAYS_MS[0]);
    expect(startCalls).toHaveLength(2);
  });

  it('ignores an exit event the backend contradicts (the old process of a restarted server)', async () => {
    await mount();
    startCalls = [];
    backendStatus = [{ id: 'global:files', name: 'files', status: 'running', error: null, tools: [TOOL('global:files')] }];

    act(() => {
      emitMockEvent('mcp-server-status', { serverId: 'global:files', status: 'error', error: exited });
    });
    await settle();
    await advance(60 * 60 * 1000);

    expect(status('global:files')).toBe('running');
    expect(useMcpStore.getState().getServer('global:files')?.tools).toHaveLength(1);
    expect(startCalls).toHaveLength(0);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not turn a deliberate stop into an error, and does not restart it', async () => {
    await mount();
    const { result } = renderHook(() => useMcpOperations());
    await act(async () => {
      await result.current.stopServer('global:files');
    });
    startCalls = [];

    // An older backend's reader reports the EOF after the stop.
    act(() => {
      emitMockEvent('mcp-server-status', { serverId: 'global:files', status: 'error', error: 'Server process exited' });
    });
    await settle();
    await advance(60 * 60 * 1000);

    expect(status('global:files')).toBe('stopped');
    expect(startCalls).toHaveLength(0);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not restart a server that is switched off', async () => {
    await mount();
    act(() => {
      useMcpStore.getState().setServerEnabled('global:files', false);
    });
    startCalls = [];
    backendStatus = [];

    act(() => {
      emitMockEvent('mcp-server-status', { serverId: 'global:files', status: 'error', error: exited });
    });
    await settle();
    await advance(60 * 60 * 1000);

    expect(status('global:files')).toBe('error');
    expect(startCalls).toHaveLength(0);
  });
});

describe('restart', () => {
  it('starts a failed server from its config instead of asking the backend to restart one it does not have', async () => {
    failing.set('global:files', 'boom');
    await mount();
    const restartCalls: string[] = [];
    setMockInvokeHandler('mcp_restart_server', (args) => {
      restartCalls.push((args as { serverId: string }).serverId);
      throw new Error("Server 'global:files' not found");
    });
    const { result } = renderHook(() => useMcpOperations());
    failing.clear();
    startCalls = [];

    await act(async () => {
      await result.current.restartServer('global:files');
    });

    expect(startCalls).toEqual(['global:files']);
    expect(status('global:files')).toBe('running');
    expect(useMcpStore.getState().getServer('global:files')?.error).toBeUndefined();
    // Only the auto-start failure toasted; the restart did not.
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(restartCalls).toHaveLength(0);
  });

  it('falls back to starting from config when the backend says a running server is not found', async () => {
    await mount();
    setMockInvokeHandler('mcp_restart_server', () => {
      throw new Error("Server 'global:files' not found");
    });
    const { result } = renderHook(() => useMcpOperations());
    startCalls = [];

    await act(async () => {
      await result.current.restartServer('global:files');
    });

    expect(startCalls).toEqual(['global:files']);
    expect(status('global:files')).toBe('running');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('restarting a stopped server that is switched off switches it on', async () => {
    useMcpStore.setState({ enabledOverrides: {} });
    await mount();
    expect(startCalls).toHaveLength(0);
    const { result } = renderHook(() => useMcpOperations());

    await act(async () => {
      await result.current.restartServer('global:files');
    });

    expect(startCalls).toEqual(['global:files']);
    expect(useMcpStore.getState().getServer('global:files')?.enabled).toBe(true);
    expect(useMcpStore.getState().getActiveTools()).toHaveLength(1);
  });

  it('a restart that fails shows the error on the card', async () => {
    await mount();
    setMockInvokeHandler('mcp_restart_server', () => {
      throw new Error('MCP initialization failed');
    });
    const { result } = renderHook(() => useMcpOperations());

    await act(async () => {
      await result.current.restartServer('global:files');
    });

    const server = useMcpStore.getState().getServer('global:files');
    expect(server?.status).toBe('error');
    expect(server?.error).toMatch(/MCP initialization failed/);
    expect(server?.tools).toEqual([]);
  });
});

describe('refreshMcpServerStatus', () => {
  it('does not show a dead server as running with the tools it had', async () => {
    await mount();
    expect(useMcpStore.getState().getServer('global:files')?.tools).toHaveLength(1);
    // The backend still holds the tools it cached while the server was alive.
    backendStatus = [
      { id: 'global:files', name: 'files', status: 'error', error: 'Server process exited', tools: [TOOL('global:files')] },
    ];

    await act(async () => {
      await refreshMcpServerStatus();
    });

    const server = useMcpStore.getState().getServer('global:files');
    expect(server?.status).toBe('error');
    expect(server?.error).toBe('Server process exited');
    expect(server?.tools).toEqual([]);
  });

  it('keeps the reason a start failed when the backend has no record of the server', async () => {
    failing.set('global:files', 'Command not found: npx');
    await mount();
    backendStatus = [];

    await act(async () => {
      await refreshMcpServerStatus();
    });

    const server = useMcpStore.getState().getServer('global:files');
    expect(server?.status).toBe('error');
    expect(server?.error).toMatch(/Command not found/);
  });
});

describe('project-scoped servers', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      projects: [
        { path: '/lib/Work', fileTree: [] },
        { path: '/lib/Home', fileTree: [] },
      ],
      explorerFolders: [],
    });
    // The backend gives the same id to both projects' `db`.
    configsByDir['/lib/Work'] = [wire('global:files'), wire('project:db')];
    configsByDir['/lib/Home'] = [wire('global:files'), wire('project:db', { args: ['other.js'] })];
  });

  it('two projects with a server of the same name get separate ids, overrides and processes', async () => {
    const work = mcpProjectServerId('/lib/Work', 'db');
    const home = mcpProjectServerId('/lib/Home', 'db');
    expect(work).not.toBe(home);
    useMcpStore.setState({ enabledOverrides: { [work]: true } });
    await mount();

    const servers = useMcpStore.getState().servers;
    expect(servers.map((s) => s.id).sort()).toEqual(['global:files', home, work].sort());
    expect(servers.find((s) => s.id === work)?.projectRoot).toBe('/lib/Work');
    expect(servers.find((s) => s.id === home)?.projectRoot).toBe('/lib/Home');
    // Only the one that was switched on runs.
    expect(startCalls).toEqual([work]);
    expect(status(work)).toBe('running');
    expect(status(home)).toBe('stopped');
    // Tools carry the id the server was started with, and stay in their project.
    expect(useMcpStore.getState().getActiveTools(['/lib/Work']).map((t) => t.server_id)).toEqual([work]);
    expect(useMcpStore.getState().getActiveTools(['/lib/Home'])).toEqual([]);

    act(() => {
      useMcpStore.getState().toggleServer(home);
    });
    expect(useMcpStore.getState().enabledOverrides).toEqual({ [work]: true, [home]: true });
  });

  it('carries an override stored under the old shared id over to each project', async () => {
    useMcpStore.setState({ enabledOverrides: { 'project:db': true } });
    await mount();

    const work = mcpProjectServerId('/lib/Work', 'db');
    const home = mcpProjectServerId('/lib/Home', 'db');
    expect(useMcpStore.getState().enabledOverrides).toEqual({ [work]: true, [home]: true });
    expect(startCalls.sort()).toEqual([work, home].sort());
  });

  it('keeps an id the backend already made unique', async () => {
    configsByDir['/lib/Work'] = [wire('project:/lib/Work:db')];
    configsByDir['/lib/Home'] = [];
    await mount();

    expect(useMcpStore.getState().getServer('project:/lib/Work:db')).toBeDefined();
  });
});

describe('config problems', () => {
  it('stores the entries the backend could not load, with the file each one is in', async () => {
    useWorkspaceStore.setState({
      projects: [
        { path: '/lib/Work', fileTree: [] },
        { path: '/lib/Home', fileTree: [] },
      ],
      explorerFolders: [],
    });
    setMockInvokeHandler('get_home_dir', () => '/Users/me');
    const globalProblem = { name: 'broken', source: 'notesage_global', reason: 'Unknown transport "websocket".' };
    const workProblem = { name: 'db', source: 'notesage_project', reason: 'env value for PORT must be a string.' };
    const homeProblem = {
      name: '/lib/Home/.notesage/mcp.json',
      source: 'notesage_project',
      reason: 'The file is not valid JSON.',
    };
    const calls: string[][] = [];
    setMockInvokeHandler('mcp_config_problems', (args) => {
      const paths = (args as { projectPaths: string[] }).projectPaths;
      calls.push(paths);
      return [
        globalProblem,
        ...(paths.includes('/lib/Work') ? [workProblem] : []),
        ...(paths.includes('/lib/Home') ? [homeProblem] : []),
      ];
    });
    await mount();

    expect(calls[0]).toEqual(['/lib/Work', '/lib/Home']);
    expect(useMcpStore.getState().configProblems).toEqual([
      { ...globalProblem, file: '/Users/me/.notesage/mcp.json' },
      { ...workProblem, file: '/lib/Work/.notesage/mcp.json' },
      { ...homeProblem, file: '/lib/Home/.notesage/mcp.json' },
    ]);
  });

  it('asks once when nothing is wrong', async () => {
    const calls: string[][] = [];
    setMockInvokeHandler('mcp_config_problems', (args) => {
      calls.push((args as { projectPaths: string[] }).projectPaths);
      return [];
    });
    await mount();

    expect(calls).toEqual([[]]);
    expect(useMcpStore.getState().configProblems).toEqual([]);
  });

  it('works against a backend that has no such command', async () => {
    setMockInvokeHandler('mcp_config_problems', () => {
      throw new Error('Command mcp_config_problems not found');
    });
    await mount();

    expect(useMcpStore.getState().configProblems).toEqual([]);
    expect(status('global:files')).toBe('running');
  });
});
