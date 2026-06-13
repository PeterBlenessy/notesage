import { describe, it, expect, beforeEach } from 'vitest';
import { buildAcpMcpServerInputs } from '../acp-mcp';
import { hasMcpCapability, type AcpAgentCapabilities } from '../acp-utils';
import { useMcpStore, type McpServerEntry } from '@/stores/mcp-store';

function server(overrides: Partial<McpServerEntry> = {}): McpServerEntry {
  return {
    id: 'srv',
    name: 'Server',
    command: '/usr/bin/mcp',
    args: [],
    env: {},
    source: 'notesage-global',
    enabled: true,
    status: 'stopped',
    tools: [],
    transport: 'stdio',
    projectRoot: null,
    ...overrides,
  };
}

function resetStore() {
  useMcpStore.setState({ servers: [], enabledOverrides: {}, rescanCounter: 0 });
}

const stdioCaps: AcpAgentCapabilities = { mcp: { stdio: {} } };
const httpCaps: AcpAgentCapabilities = { mcp: { http: {} } };
const bothCaps: AcpAgentCapabilities = { mcp: { stdio: {}, http: {} } };

describe('hasMcpCapability', () => {
  it('reports a transport supported only when its capability object is present', () => {
    expect(hasMcpCapability(stdioCaps, 'stdio')).toBe(true);
    expect(hasMcpCapability(stdioCaps, 'http')).toBe(false);
    expect(hasMcpCapability(httpCaps, 'http')).toBe(true);
    expect(hasMcpCapability(httpCaps, 'stdio')).toBe(false);
  });

  it('treats absent mcp / null capabilities as unsupported (back-compat)', () => {
    expect(hasMcpCapability(undefined, 'stdio')).toBe(false);
    expect(hasMcpCapability(null, 'stdio')).toBe(false);
    expect(hasMcpCapability({}, 'stdio')).toBe(false);
    expect(hasMcpCapability({ mcp: { stdio: null } }, 'stdio')).toBe(false);
  });
});

describe('buildAcpMcpServerInputs', () => {
  beforeEach(resetStore);

  it('returns enabled servers whose transport the agent advertises', () => {
    useMcpStore.setState({
      servers: [
        server({ id: 'a', name: 'stdio-srv', transport: 'stdio' }),
        server({ id: 'b', name: 'http-srv', transport: 'http', command: '', url: 'https://x' }),
      ],
    });

    const stdioOnly = buildAcpMcpServerInputs(stdioCaps, []);
    expect(stdioOnly.map((s) => s.id)).toEqual(['a']);

    const httpOnly = buildAcpMcpServerInputs(httpCaps, []);
    expect(httpOnly.map((s) => s.id)).toEqual(['b']);

    const both = buildAcpMcpServerInputs(bothCaps, []);
    expect(both.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('returns nothing when the agent advertises no MCP capability', () => {
    useMcpStore.setState({ servers: [server({ id: 'a' })] });
    expect(buildAcpMcpServerInputs(null, [])).toEqual([]);
    expect(buildAcpMcpServerInputs({}, [])).toEqual([]);
  });

  it('honors project scope via getActiveServers (global + selected only)', () => {
    useMcpStore.setState({
      servers: [
        server({ id: 'g', name: 'global', projectRoot: null }),
        server({ id: 'pa', name: 'proj-a', projectRoot: '/p/a' }),
        server({ id: 'pb', name: 'proj-b', projectRoot: '/p/b' }),
      ],
    });
    // No projects selected → global only.
    expect(buildAcpMcpServerInputs(stdioCaps, []).map((s) => s.id)).toEqual(['g']);
    // Project A selected → global + A, not B.
    expect(buildAcpMcpServerInputs(stdioCaps, ['/p/a']).map((s) => s.id).sort()).toEqual(['g', 'pa']);
  });

  it('maps the store entry to the minimal IPC shape', () => {
    useMcpStore.setState({
      servers: [
        server({
          id: 'fs',
          name: 'Filesystem',
          command: '/usr/bin/mcp-fs',
          args: ['--root', '/tmp'],
          env: { TOKEN: 'abc', SECRET: { secret: true } },
          transport: 'stdio',
          url: null,
        }),
      ],
    });
    const [s] = buildAcpMcpServerInputs(stdioCaps, []);
    expect(s).toEqual({
      id: 'fs',
      name: 'Filesystem',
      transport: 'stdio',
      command: '/usr/bin/mcp-fs',
      args: ['--root', '/tmp'],
      env: { TOKEN: 'abc', SECRET: { secret: true } },
      url: null,
    });
  });

  it('excludes disabled servers (getActiveServers filters them)', () => {
    useMcpStore.setState({ servers: [server({ id: 'on' }), server({ id: 'off', enabled: false })] });
    expect(buildAcpMcpServerInputs(stdioCaps, []).map((s) => s.id)).toEqual(['on']);
  });
});
