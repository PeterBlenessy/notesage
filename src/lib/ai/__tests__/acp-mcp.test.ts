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

// ---------------------------------------------------------------------------
// Capability payloads as the app actually receives them.
//
// The Rust side deserialises the agent's `initialize` response with the ACP
// **v1** schema (`agent-client-protocol-schema` 0.13.6, `unstable_protocol_v2`
// off) and forwards `serde_json::to_value(&resp.agent_capabilities)`. In v1
// the key is `mcpCapabilities: { http: bool, sse: bool }`; stdio has no field
// because every agent must accept stdio servers.
// ---------------------------------------------------------------------------

/** An agent that accepts stdio and Streamable HTTP servers. */
const v1Http: AcpAgentCapabilities = {
  loadSession: true,
  promptCapabilities: { image: true },
  mcpCapabilities: { http: true, sse: false },
  sessionCapabilities: {},
};
/** An agent that also accepts legacy SSE servers. */
const v1HttpAndSse: AcpAgentCapabilities = {
  loadSession: true,
  promptCapabilities: { image: true },
  mcpCapabilities: { http: true, sse: true },
  sessionCapabilities: {},
};
/** What an agent that sent no `mcpCapabilities` re-serialises to (both default to false). */
const v1StdioOnly: AcpAgentCapabilities = {
  loadSession: false,
  promptCapabilities: { image: false },
  mcpCapabilities: { http: false, sse: false },
  sessionCapabilities: {},
};
/** Capabilities present, but no `mcpCapabilities` object at all. */
const v1NoMcpObject: AcpAgentCapabilities = { loadSession: true, promptCapabilities: { image: false } };

// The v2 schema shape (`mcp.<transport>` objects), accepted for forward compatibility.
const v2Stdio: AcpAgentCapabilities = { mcp: { stdio: {} } };
const v2Http: AcpAgentCapabilities = { mcp: { http: {} } };
const v2Both: AcpAgentCapabilities = { mcp: { stdio: {}, http: {} } };

describe('hasMcpCapability — ACP v1 (what the app negotiates)', () => {
  it('stdio is supported by every agent that sent capabilities', () => {
    for (const caps of [v1Http, v1HttpAndSse, v1StdioOnly, v1NoMcpObject, {}]) {
      expect(hasMcpCapability(caps, 'stdio')).toBe(true);
    }
  });

  it('http and sse are supported only when their flag is true', () => {
    expect(hasMcpCapability(v1Http, 'http')).toBe(true);
    expect(hasMcpCapability(v1Http, 'sse')).toBe(false);
    expect(hasMcpCapability(v1HttpAndSse, 'sse')).toBe(true);
    expect(hasMcpCapability(v1StdioOnly, 'http')).toBe(false);
    expect(hasMcpCapability(v1StdioOnly, 'sse')).toBe(false);
    expect(hasMcpCapability(v1NoMcpObject, 'http')).toBe(false);
    expect(hasMcpCapability({}, 'http')).toBe(false);
  });

  it('a truthy non-boolean flag is not support', () => {
    const odd = { mcpCapabilities: { http: 'yes', sse: 1 } } as unknown as AcpAgentCapabilities;
    expect(hasMcpCapability(odd, 'http')).toBe(false);
    expect(hasMcpCapability(odd, 'sse')).toBe(false);
  });

  it('tolerates the snake_case spelling', () => {
    expect(hasMcpCapability({ mcp_capabilities: { http: true } }, 'http')).toBe(true);
  });

  it('nothing is supported when the agent sent no capabilities at all', () => {
    for (const transport of ['stdio', 'http', 'sse'] as const) {
      expect(hasMcpCapability(null, transport)).toBe(false);
      expect(hasMcpCapability(undefined, transport)).toBe(false);
    }
  });
});

describe('hasMcpCapability — ACP v2 shape', () => {
  it('reports a transport supported only when its capability object is present', () => {
    expect(hasMcpCapability(v2Stdio, 'stdio')).toBe(true);
    expect(hasMcpCapability(v2Stdio, 'http')).toBe(false);
    expect(hasMcpCapability(v2Http, 'http')).toBe(true);
    expect(hasMcpCapability(v2Http, 'stdio')).toBe(false);
    expect(hasMcpCapability(v2Both, 'sse')).toBe(false);
    expect(hasMcpCapability({ mcp: { stdio: null } }, 'stdio')).toBe(false);
  });
});

describe('buildAcpMcpServerInputs', () => {
  beforeEach(resetStore);

  const stdioAndHttp = () => [
    server({ id: 'a', name: 'stdio-srv', transport: 'stdio' }),
    server({ id: 'b', name: 'http-srv', transport: 'http', command: '', url: 'https://x' }),
  ];
  const ids = (caps: AcpAgentCapabilities | null | undefined, paths: string[] = []) =>
    buildAcpMcpServerInputs(caps, paths).map((s) => s.id).sort();

  it('{ mcpCapabilities: { http: true, sse: false } } gets stdio and http servers', () => {
    useMcpStore.setState({ servers: stdioAndHttp() });
    expect(ids(v1Http)).toEqual(['a', 'b']);
  });

  it('{ mcpCapabilities: { http: false, sse: false } } gets stdio servers only', () => {
    useMcpStore.setState({ servers: stdioAndHttp() });
    expect(ids(v1StdioOnly)).toEqual(['a']);
  });

  it('capabilities without mcpCapabilities get stdio servers only', () => {
    useMcpStore.setState({ servers: stdioAndHttp() });
    expect(ids(v1NoMcpObject)).toEqual(['a']);
    expect(ids({})).toEqual(['a']);
  });

  it('absent capabilities get no servers', () => {
    useMcpStore.setState({ servers: stdioAndHttp() });
    expect(buildAcpMcpServerInputs(null, [])).toEqual([]);
    expect(buildAcpMcpServerInputs(undefined, [])).toEqual([]);
  });

  it('the v2 shape gates each transport on its own entry', () => {
    useMcpStore.setState({ servers: stdioAndHttp() });
    expect(ids(v2Stdio)).toEqual(['a']);
    expect(ids(v2Http)).toEqual(['b']);
    expect(ids(v2Both)).toEqual(['a', 'b']);
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
    expect(ids(v1StdioOnly, [])).toEqual(['g']);
    // Project A selected → global + A, not B.
    expect(ids(v1StdioOnly, ['/p/a'])).toEqual(['g', 'pa']);
  });

  it('excludes disabled servers (getActiveServers filters them)', () => {
    useMcpStore.setState({ servers: [server({ id: 'on' }), server({ id: 'off', enabled: false })] });
    expect(ids(v1StdioOnly)).toEqual(['on']);
  });

  it('includes an enabled server whatever its status in the app: the agent starts its own copy', () => {
    useMcpStore.setState({
      servers: [server({ id: 'run', status: 'running' }), server({ id: 'err', status: 'error' })],
    });
    expect(ids(v1StdioOnly)).toEqual(['err', 'run']);
  });

  // The IPC input the backend turns into the ACP wire shape
  // (`build_acp_mcp_servers`): stdio → { name, command, args, env: [{ name,
  // value }] }, http → { type: "http", name, url, headers: [{ name, value }] }.
  // The wire shape itself is pinned on the Rust side
  // (`build_mcp_servers_serialise_to_the_acp_wire_shape`).
  it('maps a stdio entry to the exact IPC input, passing secret env as references only', () => {
    useMcpStore.setState({
      servers: [
        server({
          id: 'fs',
          name: 'Filesystem',
          command: '~/bin/mcp-fs',
          args: ['--root', '~/notes'],
          env: { TOKEN: 'abc', SECRET: { secret: true } },
          transport: 'stdio',
          url: null,
        }),
      ],
    });
    expect(buildAcpMcpServerInputs(v1StdioOnly, [])).toEqual([
      {
        id: 'fs',
        name: 'Filesystem',
        transport: 'stdio',
        command: '~/bin/mcp-fs',
        args: ['--root', '~/notes'],
        env: { TOKEN: 'abc', SECRET: { secret: true } },
        url: null,
      },
    ]);
  });

  it('maps an http entry to the exact IPC input, with static headers when the entry has them', () => {
    const remote = {
      ...server({ id: 'remote', name: 'Remote', transport: 'http', command: '', url: 'https://mcp.example.com/mcp' }),
      headers: { 'X-Api-Key': { secret: true }, 'X-Team': 'docs', bogus: 7 },
    } as unknown as McpServerEntry;
    useMcpStore.setState({ servers: [remote, server({ id: 'plain', name: 'Plain', transport: 'http', command: '', url: 'https://plain.example' })] });

    expect(buildAcpMcpServerInputs(v1Http, [])).toEqual([
      {
        id: 'remote',
        name: 'Remote',
        transport: 'http',
        command: '',
        args: [],
        env: {},
        url: 'https://mcp.example.com/mcp',
        headers: { 'X-Api-Key': { secret: true }, 'X-Team': 'docs' },
      },
      {
        id: 'plain',
        name: 'Plain',
        transport: 'http',
        command: '',
        args: [],
        env: {},
        url: 'https://plain.example',
      },
    ]);
  });

  it('defaults a legacy entry with no transport to stdio', () => {
    const legacy = server({ id: 'old' });
    delete legacy.transport;
    useMcpStore.setState({ servers: [legacy] });
    expect(buildAcpMcpServerInputs(v1StdioOnly, [])[0].transport).toBe('stdio');
  });
});
