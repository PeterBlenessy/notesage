// @vitest-environment jsdom

/**
 * Perf review F-1: MCP discovery must not ride on tree refreshes, and a
 * running server whose configuration did not change must not be restarted
 * (`mcp_start_server` kills and respawns a server with the same id).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  setMockInvokeHandler,
  clearMockInvokeHandlers,
  registerDefaultHandlers,
} from '@/test/tauri-mock';
import { useMcpDiscovery, useMcpOperations } from '../useMcpOperations';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useMcpStore } from '@/stores/mcp-store';
import type { FileEntry } from '@/lib/tauri';

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

function wire(id: string, overrides: Partial<WireConfig> = {}): WireConfig {
  return {
    id,
    name: id.split(':').pop() as string,
    command: 'node',
    args: ['server.js'],
    env: {},
    source: id.startsWith('global:') ? 'notesage_global' : 'notesage_project',
    enabled: true,
    ...overrides,
  };
}

/** What discovery returns, keyed by base dir ('' = the global pass). */
let configsByDir: Record<string, WireConfig[]>;
let discoverCalls: string[];
let startCalls: string[];

function tree(root: string, names: string[]): FileEntry[] {
  return names.map((name) => ({ name, path: `${root}/${name}`, is_directory: false, hidden: false }));
}

async function mountAndSettle() {
  const hook = renderHook(() => useMcpDiscovery());
  await waitFor(() => {
    const servers = useMcpStore.getState().servers;
    expect(servers.length).toBeGreaterThan(0);
    expect(servers.every((s) => !s.enabled || s.status === 'running')).toBe(true);
  });
  return hook;
}

/** Give a (wrongly) triggered discovery pass every chance to run. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  clearMockInvokeHandlers();
  registerDefaultHandlers();
  discoverCalls = [];
  startCalls = [];
  configsByDir = {
    '': [wire('global:files')],
    '/lib/Work': [wire('global:files'), wire('project:/lib/Work:db')],
  };
  setMockInvokeHandler('mcp_discover_configs', (args) => {
    const dir = ((args as { baseDirs: string[] }).baseDirs[0]) ?? '';
    discoverCalls.push(dir);
    return configsByDir[dir] ?? configsByDir[''];
  });
  setMockInvokeHandler('mcp_start_server', (args) => {
    const config = (args as { config: WireConfig }).config;
    startCalls.push(config.id);
    return { ...config, status: 'running', error: null, tools: [{ name: `tool-of-${config.id}`, description: null, input_schema: {}, server_id: config.id }] };
  });
  setMockInvokeHandler('mcp_stop_server', () => undefined);
  useMcpStore.setState({ servers: [], enabledOverrides: {}, rescanCounter: 0 });
  useWorkspaceStore.setState({
    projects: [{ path: '/lib/Work', fileTree: tree('/lib/Work', ['a.md']) }],
    explorerFolders: [],
  });
  useSettingsStore.setState({ startupReady: true });
});

describe('useMcpDiscovery — tree refreshes', () => {
  it('a tree refresh issues 0 mcp_discover_configs and 0 mcp_start_server calls', async () => {
    await mountAndSettle();
    expect(discoverCalls.sort()).toEqual(['', '/lib/Work']);
    expect(startCalls.sort()).toEqual(['global:files', 'project:/lib/Work:db']);
    discoverCalls = [];
    startCalls = [];

    act(() => {
      useWorkspaceStore.getState().updateProjectTree('/lib/Work', tree('/lib/Work', ['a.md', 'new.md']));
    });
    act(() => {
      useWorkspaceStore.getState().updateProjectTree('/lib/Work', tree('/lib/Work', ['a.md']));
    });
    await flush();

    expect(discoverCalls).toHaveLength(0);
    expect(startCalls).toHaveLength(0);
  });

  it('adding a project runs discovery once and starts only the new project\'s server', async () => {
    await mountAndSettle();
    discoverCalls = [];
    startCalls = [];
    configsByDir['/lib/Home'] = [wire('global:files'), wire('project:/lib/Home:mail')];

    act(() => {
      useWorkspaceStore.getState().addProject('/lib/Home', []);
    });
    await waitFor(() => {
      expect(useMcpStore.getState().getServer('project:/lib/Home:mail')?.status).toBe('running');
    });
    await flush();

    // One pass: the global scan plus one per project.
    expect(discoverCalls.sort()).toEqual(['', '/lib/Home', '/lib/Work']);
    // The two servers that were already running are left alone...
    expect(startCalls).toEqual(['project:/lib/Home:mail']);
    // ...and keep their status and tools, although discovery rebuilt the list.
    const files = useMcpStore.getState().getServer('global:files');
    expect(files?.status).toBe('running');
    expect(files?.tools.map((t) => t.name)).toEqual(['tool-of-global:files']);
  });
});

describe('useMcpDiscovery — config changes are still picked up', () => {
  it('a rescan restarts the server whose config changed and no other', async () => {
    await mountAndSettle();
    discoverCalls = [];
    startCalls = [];
    // `.notesage/mcp.json` of the project changed on disk: the file watcher
    // calls `requestRescan()` for it (see useFileWatcher.fanout.test.ts).
    configsByDir['/lib/Work'] = [
      wire('global:files'),
      wire('project:/lib/Work:db', { args: ['server.js', '--readonly'] }),
    ];

    act(() => {
      useMcpStore.getState().requestRescan();
    });
    await waitFor(() => expect(startCalls.length).toBeGreaterThan(0));
    await flush();

    expect(discoverCalls.sort()).toEqual(['', '/lib/Work']);
    expect(startCalls).toEqual(['project:/lib/Work:db']);
    expect(useMcpStore.getState().getServer('project:/lib/Work:db')?.args).toEqual(['server.js', '--readonly']);
  });

  it('a rescan that finds nothing changed restarts nothing', async () => {
    await mountAndSettle();
    startCalls = [];

    act(() => {
      useMcpStore.getState().requestRescan();
    });
    await flush();

    expect(startCalls).toHaveLength(0);
    expect(useMcpStore.getState().servers.every((s) => s.status === 'running')).toBe(true);
  });

  it('a requested rescan restarts a server whose secrets live in the keychain (the file cannot show the change)', async () => {
    configsByDir[''] = [wire('global:files'), wire('global:api', { env: { TOKEN: { secret: true } } })];
    configsByDir['/lib/Work'] = configsByDir[''];
    await mountAndSettle();
    startCalls = [];

    act(() => {
      useMcpStore.getState().requestRescan();
    });
    await waitFor(() => expect(startCalls).toContain('global:api'));
    await flush();

    expect(startCalls).toEqual(['global:api']);
  });

  it('but a project being added does not restart it', async () => {
    configsByDir[''] = [wire('global:files'), wire('global:api', { env: { TOKEN: { secret: true } } })];
    configsByDir['/lib/Work'] = configsByDir[''];
    await mountAndSettle();
    startCalls = [];

    act(() => {
      useWorkspaceStore.getState().addProject('/lib/Home', []);
    });
    await flush();

    expect(startCalls).toHaveLength(0);
  });

  it('a server that stopped (crashed, or stopped by hand) is started again by the next pass', async () => {
    await mountAndSettle();
    const { result } = renderHook(() => useMcpOperations());
    await act(async () => {
      await result.current.stopServer('global:files');
    });
    startCalls = [];

    act(() => {
      useMcpStore.getState().requestRescan();
    });
    await waitFor(() => expect(startCalls).toEqual(['global:files']));
  });

  it('two passes that overlap share one start per server instead of spawning it twice', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setMockInvokeHandler('mcp_start_server', async (args) => {
      const config = (args as { config: WireConfig }).config;
      startCalls.push(config.id);
      await gate;
      return { ...config, status: 'running', error: null, tools: [] };
    });

    renderHook(() => useMcpDiscovery());
    await waitFor(() => expect(startCalls).toHaveLength(2));
    // A second pass begins while the first pass's starts are still in flight.
    act(() => {
      useMcpStore.getState().requestRescan();
    });
    await flush();
    release?.();
    await waitFor(() => {
      expect(useMcpStore.getState().servers.every((s) => s.status === 'running')).toBe(true);
    });

    expect(startCalls.sort()).toEqual(['global:files', 'project:/lib/Work:db']);
  });
});
