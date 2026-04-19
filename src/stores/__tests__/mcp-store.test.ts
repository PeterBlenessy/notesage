import { describe, it, expect, beforeEach } from 'vitest';
import { useMcpStore, type McpServerEntry, type McpToolInfo } from '../mcp-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tool(name: string, server_id: string): McpToolInfo {
  return { name, description: null, input_schema: {}, server_id };
}

function server(
  overrides: Partial<McpServerEntry> & { id: string; name: string }
): McpServerEntry {
  return {
    command: 'node',
    args: [],
    env: {},
    source: 'notesage-global',
    enabled: true,
    status: 'running',
    tools: [],
    ...overrides,
  };
}

function resetStore() {
  useMcpStore.setState({
    servers: [],
    enabledOverrides: {},
    rescanCounter: 0,
  });
}

// ---------------------------------------------------------------------------
// Tests — Task #20: Per-project MCP server registry isolation
// ---------------------------------------------------------------------------

describe('mcp-store — project isolation (Task #20)', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('getActiveServers', () => {
    it('returns only global servers when no projects selected', () => {
      useMcpStore.setState({
        servers: [
          server({ id: 'g1', name: 'global-one', projectRoot: null }),
          server({ id: 'g2', name: 'global-two', projectRoot: null }),
          server({ id: 'p:a:srv', name: 'proj-a', projectRoot: '/p/a' }),
          server({ id: 'p:b:srv', name: 'proj-b', projectRoot: '/p/b' }),
        ],
      });

      const active = useMcpStore.getState().getActiveServers([]);
      expect(active.map((s) => s.id).sort()).toEqual(['g1', 'g2']);
    });

    it('returns global + project A servers when only A is selected', () => {
      useMcpStore.setState({
        servers: [
          server({ id: 'g1', name: 'global', projectRoot: null }),
          server({ id: 'a1', name: 'proj-a', projectRoot: '/p/a' }),
          server({ id: 'b1', name: 'proj-b', projectRoot: '/p/b' }),
        ],
      });

      const active = useMcpStore.getState().getActiveServers(['/p/a']);
      expect(active.map((s) => s.id).sort()).toEqual(['a1', 'g1']);
    });

    it('returns global + project B servers when only B is selected', () => {
      useMcpStore.setState({
        servers: [
          server({ id: 'g1', name: 'global', projectRoot: null }),
          server({ id: 'a1', name: 'proj-a', projectRoot: '/p/a' }),
          server({ id: 'b1', name: 'proj-b', projectRoot: '/p/b' }),
        ],
      });

      const active = useMcpStore.getState().getActiveServers(['/p/b']);
      expect(active.map((s) => s.id).sort()).toEqual(['b1', 'g1']);
    });

    it('returns global + A + B when both projects are selected', () => {
      useMcpStore.setState({
        servers: [
          server({ id: 'g1', name: 'global', projectRoot: null }),
          server({ id: 'a1', name: 'proj-a', projectRoot: '/p/a' }),
          server({ id: 'b1', name: 'proj-b', projectRoot: '/p/b' }),
        ],
      });

      const active = useMcpStore.getState().getActiveServers(['/p/a', '/p/b']);
      expect(active.map((s) => s.id).sort()).toEqual(['a1', 'b1', 'g1']);
    });

    it('excludes disabled servers from active list', () => {
      useMcpStore.setState({
        servers: [
          server({ id: 'g1', name: 'global-on', projectRoot: null, enabled: true }),
          server({ id: 'g2', name: 'global-off', projectRoot: null, enabled: false }),
          server({ id: 'a1', name: 'proj-a-on', projectRoot: '/p/a', enabled: true }),
          server({ id: 'a2', name: 'proj-a-off', projectRoot: '/p/a', enabled: false }),
        ],
      });

      const active = useMcpStore.getState().getActiveServers(['/p/a']);
      expect(active.map((s) => s.id).sort()).toEqual(['a1', 'g1']);
    });

    it('treats legacy servers without projectRoot as global', () => {
      // Entries persisted/created before #20 have no `projectRoot` field.
      // These must continue to be treated as global so upgrades don't lose
      // access to user-configured MCP servers.
      useMcpStore.setState({
        servers: [
          server({ id: 'legacy', name: 'legacy' }), // projectRoot omitted
          server({ id: 'a1', name: 'proj-a', projectRoot: '/p/a' }),
        ],
      });

      const active = useMcpStore.getState().getActiveServers(['/p/b']);
      expect(active.map((s) => s.id).sort()).toEqual(['legacy']);
    });

    it('returns all (unscoped) when selectedProjectPaths is undefined — back-compat for UI', () => {
      useMcpStore.setState({
        servers: [
          server({ id: 'g1', name: 'global', projectRoot: null }),
          server({ id: 'a1', name: 'proj-a', projectRoot: '/p/a' }),
          server({ id: 'b1', name: 'proj-b', projectRoot: '/p/b' }),
        ],
      });

      const active = useMcpStore.getState().getActiveServers();
      expect(active.map((s) => s.id).sort()).toEqual(['a1', 'b1', 'g1']);
    });
  });

  describe('getActiveTools', () => {
    // Attack test codifying the leak: when only Project A is selected, tools
    // from Project B's servers must NOT be exposed to the chat tool list.
    it('scopes MCP tools to selected project — Project B tools hidden when A selected', () => {
      useMcpStore.setState({
        servers: [
          server({
            id: 'a1', name: 'proj-a', projectRoot: '/p/a',
            tools: [tool('search_a', 'a1')],
          }),
          server({
            id: 'b1', name: 'proj-b', projectRoot: '/p/b',
            tools: [tool('search_b', 'b1'), tool('write_b', 'b1')],
          }),
        ],
      });

      const tools = useMcpStore.getState().getActiveTools(['/p/a']);
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(['search_a']);
      // Explicit negative assertion — Project B tools must not leak
      expect(names).not.toContain('search_b');
      expect(names).not.toContain('write_b');
    });

    it('includes global tools regardless of project selection', () => {
      useMcpStore.setState({
        servers: [
          server({
            id: 'g1', name: 'global', projectRoot: null,
            tools: [tool('global_tool', 'g1')],
          }),
          server({
            id: 'a1', name: 'proj-a', projectRoot: '/p/a',
            tools: [tool('proj_a_tool', 'a1')],
          }),
        ],
      });

      expect(
        useMcpStore.getState().getActiveTools(['/p/a']).map((t) => t.name).sort(),
      ).toEqual(['global_tool', 'proj_a_tool']);
      expect(
        useMcpStore.getState().getActiveTools([]).map((t) => t.name).sort(),
      ).toEqual(['global_tool']);
    });

    it('swapping projects swaps which MCP tools are available', () => {
      useMcpStore.setState({
        servers: [
          server({
            id: 'a1', name: 'proj-a', projectRoot: '/p/a',
            tools: [tool('t_a', 'a1')],
          }),
          server({
            id: 'b1', name: 'proj-b', projectRoot: '/p/b',
            tools: [tool('t_b', 'b1')],
          }),
        ],
      });

      const store = useMcpStore.getState();
      expect(store.getActiveTools(['/p/a']).map((t) => t.name)).toEqual(['t_a']);
      expect(store.getActiveTools(['/p/b']).map((t) => t.name)).toEqual(['t_b']);
      expect(store.getActiveTools(['/p/a', '/p/b']).map((t) => t.name).sort()).toEqual([
        't_a',
        't_b',
      ]);
    });

    it('omits tools from disabled servers', () => {
      useMcpStore.setState({
        servers: [
          server({
            id: 'a-on', name: 'on', projectRoot: '/p/a', enabled: true,
            tools: [tool('enabled_tool', 'a-on')],
          }),
          server({
            id: 'a-off', name: 'off', projectRoot: '/p/a', enabled: false,
            tools: [tool('disabled_tool', 'a-off')],
          }),
        ],
      });

      const names = useMcpStore.getState().getActiveTools(['/p/a']).map((t) => t.name);
      expect(names).toEqual(['enabled_tool']);
    });

    it('omits tools from non-running servers', () => {
      useMcpStore.setState({
        servers: [
          server({
            id: 'running', name: 'running', projectRoot: null, status: 'running',
            tools: [tool('t1', 'running')],
          }),
          server({
            id: 'stopped', name: 'stopped', projectRoot: null, status: 'stopped',
            tools: [tool('t2', 'stopped')],
          }),
          server({
            id: 'errored', name: 'errored', projectRoot: null, status: 'error',
            tools: [tool('t3', 'errored')],
          }),
        ],
      });

      const names = useMcpStore.getState().getActiveTools([]).map((t) => t.name);
      expect(names).toEqual(['t1']);
    });
  });
});
