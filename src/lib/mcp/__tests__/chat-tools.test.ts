import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { useMcpStore, type McpServerEntry, type McpToolInfo } from '@/stores/mcp-store';
import { useSkillStore } from '@/stores/skill-store';
import { usePermissionStore } from '@/stores/permission-store';
import { log } from '@/lib/logger';
import {
  getMcpToolDefinitions,
  resolveMcpTool,
  mcpPermissionKey,
  MCP_MAX_TOOLS_OFFERED,
  MCP_MAX_TOOL_DEFINITION_CHARS,
  MCP_TOOL_DESCRIPTION_MAX_CHARS,
} from '../chat-tools';

function mcpTool(serverId: string, name: string, overrides: Partial<McpToolInfo> = {}): McpToolInfo {
  return {
    name,
    description: `Does ${name}`,
    input_schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    server_id: serverId,
    ...overrides,
  };
}

function server(id: string, name: string, toolNames: string[], overrides: Partial<McpServerEntry> = {}): McpServerEntry {
  return {
    id,
    name,
    command: 'npx',
    args: [],
    env: {},
    source: 'notesage-global',
    enabled: true,
    status: 'running',
    tools: toolNames.map((t) => mcpTool(id, t)),
    transport: 'stdio',
    projectRoot: null,
    ...overrides,
  };
}

function setServers(servers: McpServerEntry[]) {
  useMcpStore.setState({ servers, enabledOverrides: {}, rescanCounter: 0 });
}

const names = (paths: string[]) => getMcpToolDefinitions(paths).map((t) => t.name);

describe('getMcpToolDefinitions', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setServers([]);
    warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('offers nothing when no server is configured', () => {
    expect(getMcpToolDefinitions([])).toEqual([]);
  });

  it('offers tools of enabled, running servers only', () => {
    setServers([
      server('global:run', 'run', ['a']),
      server('global:off', 'off', ['b'], { enabled: false }),
      server('global:stopped', 'stopped', ['c'], { status: 'stopped' }),
      server('global:starting', 'starting', ['d'], { status: 'starting' }),
      server('global:failed', 'failed', ['e'], { status: 'error' }),
    ]);
    expect(names([])).toEqual(['mcp__run__a']);
  });

  it('offers a project server only to a conversation scoped to that project', () => {
    setServers([
      server('global:g', 'g', ['a']),
      server('project:pa', 'pa', ['b'], { projectRoot: '/p/a', source: 'notesage-project' }),
      server('project:pb', 'pb', ['c'], { projectRoot: '/p/b', source: 'notesage-project' }),
    ]);
    expect(names([])).toEqual(['mcp__g__a']);
    expect(names(['/p/a']).sort()).toEqual(['mcp__g__a', 'mcp__pa__b']);
    expect(names(['/p/a', '/p/b']).sort()).toEqual(['mcp__g__a', 'mcp__pa__b', 'mcp__pb__c']);
  });

  it('builds a provider-ready definition from the server tool', () => {
    setServers([
      server('global:github', 'github', [], {
        tools: [
          mcpTool('global:github', 'create_issue', {
            description: 'Open an issue',
            input_schema: {
              $schema: 'http://json-schema.org/draft-07/schema#',
              type: 'object',
              additionalProperties: false,
              properties: { title: { type: 'string', format: 'x' }, labels: { type: 'array' } },
              required: ['title'],
            },
          }),
        ],
      }),
    ]);
    expect(getMcpToolDefinitions([])).toEqual([
      {
        name: 'mcp__github__create_issue',
        description: 'Open an issue',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'format: x' },
            labels: { type: 'array', items: {} },
          },
          required: ['title'],
        },
      },
    ]);
  });

  it('caps a long description and replaces a missing one', () => {
    setServers([
      server('global:s', 's', [], {
        tools: [
          mcpTool('global:s', 'long', { description: 'x'.repeat(5000) }),
          mcpTool('global:s', 'none', { description: null }),
          mcpTool('global:s', 'ctrl', { description: 'a\u0000b\u0007c' }),
        ],
      }),
    ]);
    const defs = getMcpToolDefinitions([]);
    expect(defs[0].description.length).toBe(MCP_TOOL_DESCRIPTION_MAX_CHARS);
    expect(defs[1].description).toBe('Tool "none" from the MCP server "s".');
    expect(defs[2].description).toBe('abc');
  });

  it('skips a tool whose schema no provider accepts, with a warning, and keeps the rest', () => {
    setServers([
      server('global:s', 's', [], {
        tools: [
          mcpTool('global:s', 'good'),
          mcpTool('global:s', 'bad', { input_schema: { type: 'string' } }),
          mcpTool('global:s', 'also_good'),
        ],
      }),
    ]);
    expect(names([])).toEqual(['mcp__s__good', 'mcp__s__also_good']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][1])).toContain('"bad"');
  });

  it(`offers at most ${MCP_MAX_TOOLS_OFFERED} tools and logs what was dropped`, () => {
    const many = Array.from({ length: MCP_MAX_TOOLS_OFFERED + 7 }, (_, i) => `tool_${i}`);
    setServers([server('global:big', 'big', many)]);
    const defs = getMcpToolDefinitions([]);
    expect(defs).toHaveLength(MCP_MAX_TOOLS_OFFERED);
    expect(warn).toHaveBeenCalledTimes(1);
    const data = warn.mock.calls[0][2] as { offered: number; dropped: string[] };
    expect(data.offered).toBe(MCP_MAX_TOOLS_OFFERED);
    expect(data.dropped).toHaveLength(7);
    expect(data.dropped[0]).toBe(`mcp__big__tool_${MCP_MAX_TOOLS_OFFERED}`);
  });

  it('caps the total size of the definitions', () => {
    // 20 tools of ~9K characters each: far over the total, well under the count.
    const bigSchema = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [`f${i}`, { type: 'string', description: 'y'.repeat(430) }]),
      ),
    };
    setServers([
      server('global:fat', 'fat', [], {
        tools: Array.from({ length: 20 }, (_, i) => mcpTool('global:fat', `t${i}`, { input_schema: bigSchema })),
      }),
    ]);
    const defs = getMcpToolDefinitions([]);
    const total = defs.reduce(
      (sum, d) => sum + d.name.length + d.description.length + JSON.stringify(d.input_schema).length,
      0,
    );
    expect(defs.length).toBeGreaterThan(0);
    expect(defs.length).toBeLessThan(20);
    expect(total).toBeLessThanOrEqual(MCP_MAX_TOOL_DEFINITION_CHARS);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not log when nothing is dropped', () => {
    setServers([server('global:s', 's', ['a', 'b'])]);
    getMcpToolDefinitions([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('resolveMcpTool', () => {
  beforeEach(() => setServers([]));

  it('routes a name to the server id and the ORIGINAL tool name', () => {
    setServers([server('global:My Server', 'My Server', ['files/read'])]);
    const [def] = getMcpToolDefinitions([]);
    expect(def.name).toBe('mcp__My_Server__files_read');
    expect(resolveMcpTool(def.name, [])).toEqual({
      exposedName: 'mcp__My_Server__files_read',
      serverId: 'global:My Server',
      serverName: 'My Server',
      toolName: 'files/read',
      projectRoot: null,
      status: 'running',
    });
  });

  it('keeps resolving a tool whose server stopped, reporting the status', () => {
    setServers([server('global:s', 's', ['a'])]);
    const [def] = getMcpToolDefinitions([]);
    useMcpStore.getState().setServerStatus('global:s', 'error', 'Server process exited');
    expect(resolveMcpTool(def.name, [])?.status).toBe('error');
  });

  it('does not change another tool\'s name when a colliding server goes down', () => {
    setServers([
      server('global:notes', 'notes', ['search']),
      server('project:notes', 'notes', ['search'], { projectRoot: '/p/a' }),
    ]);
    const before = names(['/p/a']).sort();
    expect(before).toHaveLength(2);
    useMcpStore.getState().setServerStatus('project:notes', 'stopped');
    const after = names(['/p/a']);
    expect(after).toHaveLength(1);
    expect(before).toContain(after[0]);
    expect(resolveMcpTool(after[0], ['/p/a'])?.serverId).toBe('global:notes');
  });

  it('returns null for unknown names, disabled servers and servers out of scope', () => {
    setServers([
      server('global:off', 'off', ['a'], { enabled: false }),
      server('project:pb', 'pb', ['c'], { projectRoot: '/p/b' }),
    ]);
    expect(resolveMcpTool('mcp__nope__x', [])).toBeNull();
    expect(resolveMcpTool('mcp__off__a', [])).toBeNull();
    expect(resolveMcpTool('mcp__pb__c', ['/p/a'])).toBeNull();
    expect(resolveMcpTool('mcp__pb__c', ['/p/b'])?.projectRoot).toBe('/p/b');
    expect(resolveMcpTool('read_file', [])).toBeNull();
  });
});

describe('mcpPermissionKey', () => {
  it('is built from the server id and original tool name, plus the project of a project server', () => {
    expect(mcpPermissionKey({ serverId: 'global:github', toolName: 'create_issue', projectRoot: null }))
      .toBe('mcp:global:github:create_issue');
    expect(mcpPermissionKey({ serverId: 'project:db', toolName: 'query', projectRoot: '/p/a' }))
      .toBe('mcp:project:db@/p/a:query');
  });

  it('is never on the built-in auto-allow list, whatever the tool is called', () => {
    const store = usePermissionStore.getState();
    for (const toolName of ['read_file', 'list_directory', 'web_search', 'list_comments', 'read_skill_content']) {
      const key = mcpPermissionKey({ serverId: 'global:x', toolName, projectRoot: null });
      expect(store.isToolAutoAllowed(key)).toBe(false);
      expect(store.isToolAllowed(key, 'conn', null)).toBe('none');
    }
  });

  it('keeps two projects\' servers with the same id apart', () => {
    usePermissionStore.setState({ toolCallSession: new Set(), toolCallAlways: [] });
    const inA = { serverId: 'project:db', toolName: 'query', projectRoot: '/p/a' };
    const inB = { serverId: 'project:db', toolName: 'query', projectRoot: '/p/b' };
    usePermissionStore.getState().allowToolAlways(mcpPermissionKey(inA), 'conn', inA.projectRoot);
    usePermissionStore.getState().allowToolSession(mcpPermissionKey(inA));
    const store = usePermissionStore.getState();
    expect(store.isToolAllowed(mcpPermissionKey(inA), 'conn', inA.projectRoot)).toBe('always');
    expect(store.isToolAllowed(mcpPermissionKey(inB), 'conn', inB.projectRoot)).toBe('none');
    // Scoped to the connection it was granted under.
    usePermissionStore.setState({ toolCallSession: new Set() });
    expect(usePermissionStore.getState().isToolAllowed(mcpPermissionKey(inA), 'other-conn', inA.projectRoot)).toBe('none');
  });
});

describe('skill-store getToolDefinitions with MCP tools', () => {
  beforeEach(() => {
    useSkillStore.setState({ skillTools: [] });
    setServers([
      server('global:github', 'github', ['create_issue', 'list_issues']),
      server('global:fs', 'fs', ['read']),
      server('project:pa', 'pa', ['b'], { projectRoot: '/p/a' }),
    ]);
  });

  it('leaves the list unchanged for callers that name no project scope', () => {
    const tools = useSkillStore.getState().getToolDefinitions();
    expect(tools.some((t) => t.name.startsWith('mcp__'))).toBe(false);
    expect(tools).toHaveLength(10);
  });

  it('appends the MCP tools in scope after the built-in tools', () => {
    const tools = useSkillStore.getState().getToolDefinitions(undefined, { mcpProjectPaths: [] });
    expect(tools.slice(0, 10).every((t) => !t.name.startsWith('mcp__'))).toBe(true);
    expect(tools.slice(10).map((t) => t.name)).toEqual([
      'mcp__github__create_issue',
      'mcp__github__list_issues',
      'mcp__fs__read',
    ]);
    const scoped = useSkillStore.getState().getToolDefinitions(undefined, { mcpProjectPaths: ['/p/a'] });
    expect(scoped.map((t) => t.name)).toContain('mcp__pa__b');
  });

  it('filters MCP tools by exact name or by server prefix in allowedTools', () => {
    const get = (allowed: string[]) =>
      useSkillStore.getState().getToolDefinitions(allowed, { mcpProjectPaths: [] }).map((t) => t.name);
    expect(get(['mcp__github__list_issues'])).toEqual(['mcp__github__list_issues']);
    expect(get(['mcp__github', 'read_file'])).toEqual([
      'read_file',
      'mcp__github__create_issue',
      'mcp__github__list_issues',
    ]);
    expect(get(['read_file'])).toEqual(['read_file']);
  });
});
