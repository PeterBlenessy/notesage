// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  setMockInvokeHandler,
  clearMockInvokeHandlers,
  registerDefaultHandlers,
} from '@/test/tauri-mock';
import { useMcpOperations, useMcpDiscovery, refreshMcpServerStatus, type McpValidationResult } from '../useMcpOperations';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useMcpStore, type McpServerEntry } from '@/stores/mcp-store';
import { tauriApi } from '@/lib/tauri';

// The hook is mocked at the @tauri-apps boundary by src/test/tauri-mock.ts
// (wired globally in vitest setup). We register per-test invoke handlers.

describe('useMcpOperations.validateServer', () => {
  beforeEach(() => {
    clearMockInvokeHandlers();
    registerDefaultHandlers();
  });

  it('invokes mcp_validate_server with a snake_case source and ephemeral id', async () => {
    const captured: { config?: Record<string, unknown> } = {};
    const okResult: McpValidationResult = {
      ok: true,
      tools: [{ name: 'read_file', description: null, input_schema: {}, server_id: '__validate__' }],
      server_info: { name: 'demo', version: '1.0.0' },
      error: null,
      error_kind: null,
      stderr_tail: null,
    };
    setMockInvokeHandler('mcp_validate_server', (args) => {
      captured.config = (args as { config: Record<string, unknown> }).config;
      return okResult;
    });

    const { result } = renderHook(() => useMcpOperations());
    const res = await result.current.validateServer({
      name: 'Filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { TOKEN: 'abc' },
    });

    expect(res.ok).toBe(true);
    expect(res.tools).toHaveLength(1);
    expect(captured.config).toMatchObject({
      id: '__validate__',
      name: 'Filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { TOKEN: 'abc' },
      source: 'notesage_global',
      enabled: true,
    });
  });

  it('forwards transport + url for remote (http) configs', async () => {
    const captured: { config?: Record<string, unknown> } = {};
    setMockInvokeHandler('mcp_validate_server', (args) => {
      captured.config = (args as { config: Record<string, unknown> }).config;
      return { ok: true, tools: [], server_info: null, error: null, error_kind: null, stderr_tail: null };
    });

    const { result } = renderHook(() => useMcpOperations());
    await result.current.validateServer({
      name: 'Remote',
      command: '',
      args: [],
      env: {},
      transport: 'http',
      url: 'https://example.com/mcp',
    });

    expect(captured.config).toMatchObject({
      transport: 'http',
      url: 'https://example.com/mcp',
      command: '',
    });
  });

  it('defaults transport to stdio and url to null when omitted', async () => {
    const captured: { config?: Record<string, unknown> } = {};
    setMockInvokeHandler('mcp_validate_server', (args) => {
      captured.config = (args as { config: Record<string, unknown> }).config;
      return { ok: true, tools: [], server_info: null, error: null, error_kind: null, stderr_tail: null };
    });

    const { result } = renderHook(() => useMcpOperations());
    await result.current.validateServer({ name: 'x', command: 'node', args: [], env: {} });

    expect(captured.config?.transport).toBe('stdio');
    expect(captured.config?.url).toBeNull();
  });

  it('falls back to the command as the name when none is provided', async () => {
    const captured: { config?: Record<string, unknown> } = {};
    setMockInvokeHandler('mcp_validate_server', (args) => {
      captured.config = (args as { config: Record<string, unknown> }).config;
      return { ok: true, tools: [], server_info: null, error: null, error_kind: null, stderr_tail: null };
    });

    const { result } = renderHook(() => useMcpOperations());
    await result.current.validateServer({ name: '', command: 'uvx', args: ['mcp-server-git'], env: {} });

    expect(captured.config?.name).toBe('uvx');
  });

  it('passes a prospective id into validation so the OAuth token resolves', async () => {
    const captured: { config?: Record<string, unknown> } = {};
    setMockInvokeHandler('mcp_validate_server', (args) => {
      captured.config = (args as { config: Record<string, unknown> }).config;
      return { ok: true, tools: [], server_info: null, error: null, error_kind: null, stderr_tail: null };
    });

    const { result } = renderHook(() => useMcpOperations());
    await result.current.validateServer({
      name: 'r',
      command: '',
      args: [],
      env: {},
      transport: 'http',
      url: 'https://x/mcp',
      id: 'global:r',
    });
    expect(captured.config?.id).toBe('global:r');
  });

  it('oauthAuthorize forwards server id, url, and scope', async () => {
    const captured: Record<string, unknown> = {};
    setMockInvokeHandler('mcp_oauth_authorize', (args) => {
      Object.assign(captured, args as Record<string, unknown>);
      return { authorized: true, expires_at: 123 };
    });

    const { result } = renderHook(() => useMcpOperations());
    const status = await result.current.oauthAuthorize('global:r', 'https://x/mcp', 'mcp');

    expect(status.authorized).toBe(true);
    expect(captured).toMatchObject({ serverId: 'global:r', serverUrl: 'https://x/mcp', scope: 'mcp' });
  });

  it('oauthStatus and oauthLogout call the right commands', async () => {
    let loggedOut: unknown = null;
    setMockInvokeHandler('mcp_oauth_status', () => ({ authorized: false, expires_at: null }));
    setMockInvokeHandler('mcp_oauth_logout', (args) => {
      loggedOut = args;
      return undefined;
    });

    const { result } = renderHook(() => useMcpOperations());
    const status = await result.current.oauthStatus('global:r');
    expect(status.authorized).toBe(false);
    await result.current.oauthLogout('global:r');
    expect(loggedOut).toMatchObject({ serverId: 'global:r' });
  });

  it('startServer forwards transport + url so http servers launch over HTTP', async () => {
    const captured: { config?: Record<string, unknown> } = {};
    setMockInvokeHandler('mcp_start_server', (args) => {
      captured.config = (args as { config: Record<string, unknown> }).config;
      return { id: 'global:r', name: 'r', command: '', args: [], env: {}, source: 'notesage_global', enabled: true, status: 'running', error: null, tools: [], transport: 'http', url: 'https://x/mcp' };
    });

    const { result } = renderHook(() => useMcpOperations());
    await result.current.startServer({
      id: 'global:r',
      name: 'r',
      command: '',
      args: [],
      env: {},
      source: 'notesage-global',
      enabled: true,
      status: 'stopped',
      tools: [],
      transport: 'http',
      url: 'https://x/mcp',
    });

    expect(captured.config).toMatchObject({ transport: 'http', url: 'https://x/mcp' });
  });

  it('propagates a failed validation result (mapped error) to the caller', async () => {
    const failResult: McpValidationResult = {
      ok: false,
      tools: [],
      server_info: null,
      error: "Command not found: 'nope'. Make sure it is installed and on your PATH.",
      error_kind: 'binary_not_found',
      stderr_tail: null,
    };
    setMockInvokeHandler('mcp_validate_server', () => failResult);

    const { result } = renderHook(() => useMcpOperations());
    const res = await result.current.validateServer({ name: 'x', command: 'nope', args: [], env: {} });

    expect(res.ok).toBe(false);
    expect(res.error_kind).toBe('binary_not_found');
    expect(res.error).toContain('PATH');
  });
});

describe('refreshMcpServerStatus', () => {
  const entry = (overrides: Partial<McpServerEntry>): McpServerEntry => ({
    id: 'global:demo',
    name: 'demo',
    command: 'npx',
    args: [],
    env: {},
    source: 'notesage-global',
    enabled: true,
    status: 'stopped',
    tools: [],
    ...overrides,
  });

  beforeEach(() => {
    clearMockInvokeHandlers();
    registerDefaultHandlers();
    useMcpStore.setState({ servers: [], enabledOverrides: {} });
  });

  it('reconciles status, error, and tools from the backend snapshot', async () => {
    useMcpStore.setState({
      servers: [
        entry({ id: 'global:a', name: 'a', status: 'stopped', tools: [] }),
        entry({ id: 'global:b', name: 'b', status: 'running', error: 'stale error' }),
      ],
    });

    setMockInvokeHandler('mcp_get_server_status', () => [
      {
        id: 'global:a', name: 'a', command: 'npx', args: [], env: {},
        source: 'notesage_global', enabled: true, status: 'running', error: null,
        tools: [{ name: 'read_file', description: null, input_schema: {}, server_id: 'global:a' }],
        transport: 'stdio', url: null,
      },
      {
        id: 'global:b', name: 'b', command: 'npx', args: [], env: {},
        source: 'notesage_global', enabled: true, status: 'error', error: 'spawn failed',
        tools: [], transport: 'stdio', url: null,
      },
    ]);

    await refreshMcpServerStatus();

    const servers = useMcpStore.getState().servers;
    const a = servers.find((s) => s.id === 'global:a');
    const b = servers.find((s) => s.id === 'global:b');
    expect(a?.status).toBe('running');
    expect(a?.tools).toHaveLength(1);
    expect(b?.status).toBe('error');
    expect(b?.error).toBe('spawn failed');
  });

  it('marks servers absent from the snapshot as stopped with no tools', async () => {
    useMcpStore.setState({
      servers: [
        entry({
          id: 'global:gone',
          name: 'gone',
          status: 'running',
          tools: [{ name: 'x', description: null, input_schema: {}, server_id: 'global:gone' }],
        }),
      ],
    });
    setMockInvokeHandler('mcp_get_server_status', () => []);

    await refreshMcpServerStatus();

    const gone = useMcpStore.getState().servers[0];
    expect(gone.status).toBe('stopped');
    expect(gone.tools).toHaveLength(0);
    expect(gone.error).toBeUndefined();
  });

  it('propagates backend errors to the caller (button shows a toast)', async () => {
    setMockInvokeHandler('mcp_get_server_status', () => {
      throw new Error('backend gone');
    });
    await expect(refreshMcpServerStatus()).rejects.toThrow('backend gone');
  });
});

describe('tauriApi.mcpListTools (cache-first wrapper)', () => {
  beforeEach(() => {
    clearMockInvokeHandlers();
  });

  it('passes refresh: false by default', async () => {
    const captured: Record<string, unknown> = {};
    setMockInvokeHandler('mcp_list_tools', (args) => {
      Object.assign(captured, args as Record<string, unknown>);
      return [];
    });

    await tauriApi.mcpListTools('global:demo');
    expect(captured).toMatchObject({ serverId: 'global:demo', refresh: false });
  });

  it('forwards refresh: true to force a live query', async () => {
    const captured: Record<string, unknown> = {};
    setMockInvokeHandler('mcp_list_tools', (args) => {
      Object.assign(captured, args as Record<string, unknown>);
      return [{ name: 't', description: null, input_schema: {}, server_id: 'global:demo' }];
    });

    const tools = await tauriApi.mcpListTools('global:demo', true);
    expect(captured).toMatchObject({ serverId: 'global:demo', refresh: true });
    expect(tools).toHaveLength(1);
  });
});

describe('useMcpDiscovery auto-start', () => {
  beforeEach(() => {
    clearMockInvokeHandlers();
    registerDefaultHandlers();
    useWorkspaceStore.setState({ projects: [] });
    useSettingsStore.setState({ startupReady: false });
  });

  it('includes transport + url in the launch-time auto-start payload', async () => {
    const httpServer = {
      id: 'global:Remote',
      name: 'Remote',
      command: '',
      args: [],
      env: {},
      source: 'notesage_global',
      enabled: true,
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
    };

    setMockInvokeHandler('mcp_discover_configs', () => [httpServer]);

    const captured: { config?: Record<string, unknown> } = {};
    setMockInvokeHandler('mcp_start_server', (args) => {
      captured.config = (args as { config: Record<string, unknown> }).config;
      return {
        id: 'global:Remote', name: 'Remote', command: '', args: [], env: {},
        source: 'notesage_global', enabled: true, status: 'running', error: null,
        tools: [], transport: 'http', url: 'https://mcp.example.com/mcp',
      };
    });

    renderHook(() => useMcpDiscovery());
    // Discovery is gated on startupReady — flip it to trigger the effect.
    useSettingsStore.setState({ startupReady: true });

    await waitFor(() => {
      expect(captured.config).toBeDefined();
    });
    expect(captured.config).toMatchObject({
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
    });
  });
});

describe('useMcpDiscovery runtime validation (foreign config boundary)', () => {
  beforeEach(() => {
    clearMockInvokeHandlers();
    registerDefaultHandlers();
    useWorkspaceStore.setState({ projects: [] });
    useSettingsStore.setState({ startupReady: false });
    useMcpStore.getState().setServers([]);
  });

  it('skips malformed discovery entries without throwing and keeps valid ones', async () => {
    const valid = {
      id: 'global:good',
      name: 'good',
      command: 'npx',
      args: ['-y', 'good-server'],
      env: {},
      source: 'notesage_global',
      enabled: false, // disabled so no auto-start is attempted
    };
    setMockInvokeHandler('mcp_discover_configs', () => [
      valid,
      { id: 'global:bad', name: 'bad' }, // missing most fields
      { ...valid, id: 'global:bad-enabled', enabled: 'yes' }, // wrong-typed field
      42, // junk primitive
      null,
    ]);

    renderHook(() => useMcpDiscovery());
    useSettingsStore.setState({ startupReady: true });

    await waitFor(() => {
      expect(useMcpStore.getState().servers).toHaveLength(1);
    });
    expect(useMcpStore.getState().servers[0]).toMatchObject({
      id: 'global:good',
      name: 'good',
      source: 'notesage-global',
    });
  });

  it('degrades to an empty registry when the command returns a non-array payload', async () => {
    let discoverCalled = false;
    setMockInvokeHandler('mcp_discover_configs', () => {
      discoverCalled = true;
      return { totally: 'wrong' };
    });

    renderHook(() => useMcpDiscovery());
    useSettingsStore.setState({ startupReady: true });

    // The discovery effect must settle without throwing and register nothing.
    await waitFor(() => {
      expect(discoverCalled).toBe(true);
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(useMcpStore.getState().servers).toHaveLength(0);
  });
});
