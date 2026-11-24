import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { invoke } from '@tauri-apps/api/core';
import { useMcpStore, type McpServerEntry } from '@/stores/mcp-store';
import { executeToolCall } from '@/lib/tool-executor';
import {
  callMcpTool,
  mapMcpToolResult,
  truncateMcpResultText,
  MCP_TOOL_CALL_TIMEOUT_MS,
  MCP_TOOL_RESULT_MAX_CHARS,
} from '../tool-call';
import type { McpToolTarget } from '../chat-tools';

const target: McpToolTarget = {
  exposedName: 'mcp__My_Server__files_read',
  serverId: 'global:My Server',
  serverName: 'My Server',
  toolName: 'files/read',
  projectRoot: null,
  status: 'running',
};

const callsTo = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd);

describe('mapMcpToolResult', () => {
  it('joins text items', () => {
    expect(mapMcpToolResult({ content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }], is_error: false }))
      .toEqual({ content: 'one\n\ntwo', isError: false });
  });

  it('maps isError in either spelling to a tool error, keeping the text', () => {
    expect(mapMcpToolResult({ content: [{ type: 'text', text: 'no such file' }], is_error: true }))
      .toEqual({ content: 'no such file', isError: true });
    expect(mapMcpToolResult({ content: [{ type: 'text', text: 'boom' }], isError: true }).isError).toBe(true);
    expect(mapMcpToolResult({ content: [], is_error: true }))
      .toEqual({ content: 'The MCP tool reported an error without a message.', isError: true });
  });

  it('replaces image and audio content with a note instead of the bytes', () => {
    const data = 'A'.repeat(4096);
    const mapped = mapMcpToolResult({
      content: [
        { type: 'text', text: 'Here is the chart' },
        { type: 'image', data, mimeType: 'image/png' },
        { type: 'audio', data: 'AAAA', mime_type: 'audio/wav' },
      ],
      is_error: false,
    });
    expect(mapped.isError).toBe(false);
    expect(mapped.content).toContain('Here is the chart');
    expect(mapped.content).toContain('[image omitted: image/png, about 3 KB.');
    expect(mapped.content).toContain('[audio omitted: audio/wav');
    expect(mapped.content).not.toContain(data);
  });

  it('includes embedded resource text and notes binary resources and links', () => {
    const mapped = mapMcpToolResult({
      content: [
        { type: 'resource', resource: { uri: 'file:///a.md', text: '# A' } },
        { type: 'resource', resource: { uri: 'file:///b.bin', blob: 'AAAA' } },
        { type: 'resource_link', uri: 'file:///c.md', name: 'c' },
      ],
    });
    expect(mapped.content).toBe(
      '[resource file:///a.md]\n# A\n\n[resource file:///b.bin: binary content omitted]\n\n[resource link c: file:///c.md]',
    );
  });

  it('falls back to structuredContent when there is no text', () => {
    expect(mapMcpToolResult({ content: [], structuredContent: { rows: 2 } }).content).toBe('{\n  "rows": 2\n}');
    expect(mapMcpToolResult({ content: [], structured_content: [1, 2] }).content).toBe('[\n  1,\n  2\n]');
    // Text wins: the spec has servers repeat structured output as text.
    expect(mapMcpToolResult({ content: [{ type: 'text', text: 't' }], structuredContent: { a: 1 } }).content).toBe('t');
  });

  it('says so when a tool returns nothing, and tolerates malformed results', () => {
    expect(mapMcpToolResult({ content: [], is_error: false }).content).toBe('(the tool returned no content)');
    expect(mapMcpToolResult(null)).toEqual({ content: 'The MCP server returned an empty result.', isError: false });
    expect(mapMcpToolResult({ content: 'nope' }).content).toBe('(the tool returned no content)');
    expect(mapMcpToolResult({ content: [null, 7, { type: 'text' }, { type: 'mystery', text: 'kept' }] }).content).toBe('kept');
  });

  it('truncates an oversized result with a marker saying how much was cut', () => {
    const big = 'z'.repeat(MCP_TOOL_RESULT_MAX_CHARS + 1234);
    const mapped = mapMcpToolResult({ content: [{ type: 'text', text: big }] });
    expect(mapped.content.startsWith('z'.repeat(MCP_TOOL_RESULT_MAX_CHARS))).toBe(true);
    expect(mapped.content.endsWith('[Result truncated: 1234 more characters were omitted.]')).toBe(true);
    expect(mapped.content.length).toBeLessThan(MCP_TOOL_RESULT_MAX_CHARS + 100);
    expect(truncateMcpResultText('short')).toBe('short');
  });
});

describe('callMcpTool', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it('calls mcp_call_tool with the server id, ORIGINAL tool name and arguments', async () => {
    setMockInvokeHandler('mcp_call_tool', async () => ({ content: [{ type: 'text', text: 'hello' }], is_error: false }));
    const outcome = await callMcpTool(target, { path: '/tmp/a' });
    expect(outcome).toEqual({ content: 'hello', isError: false });
    expect(callsTo('mcp_call_tool')).toEqual([
      ['mcp_call_tool', {
        serverId: 'global:My Server',
        toolName: 'files/read',
        arguments: { path: '/tmp/a' },
        timeoutMs: MCP_TOOL_CALL_TIMEOUT_MS,
      }],
    ]);
  });

  it('does not call a server that is not running and tells the model why', async () => {
    setMockInvokeHandler('mcp_call_tool', async () => ({ content: [], is_error: false }));
    const outcome = await callMcpTool({ ...target, status: 'error' }, {});
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain('MCP server "My Server" is not running (status: error)');
    expect(callsTo('mcp_call_tool')).toHaveLength(0);
  });

  it('turns a backend failure (server gone, transport error) into a readable tool error', async () => {
    setMockInvokeHandler('mcp_call_tool', async () => {
      throw "Server 'global:My Server' not found or not running";
    });
    const outcome = await callMcpTool(target, {});
    expect(outcome).toEqual({
      content: 'MCP server "My Server" could not run "files/read": Server \'global:My Server\' not found or not running',
      isError: true,
    });
  });

  it('resolves at once when stopped, and discards the late result', async () => {
    let release: (value: unknown) => void = () => {};
    setMockInvokeHandler('mcp_call_tool', () => new Promise((resolve) => { release = resolve; }));
    const controller = new AbortController();
    const pending = callMcpTool(target, {}, { signal: controller.signal });
    let settled: unknown;
    void pending.then((value) => { settled = value; });

    await Promise.resolve();
    expect(settled).toBeUndefined();
    controller.abort();
    await expect(pending).resolves.toEqual({ content: 'MCP tool call cancelled: files/read', isError: true });

    // The server answers afterwards: nothing changes, nothing rejects.
    release({ content: [{ type: 'text', text: 'late' }], is_error: false });
    await new Promise((r) => setTimeout(r, 0));
    await expect(pending).resolves.toEqual({ content: 'MCP tool call cancelled: files/read', isError: true });
  });

  it('does not call at all when the turn was already stopped', async () => {
    setMockInvokeHandler('mcp_call_tool', async () => ({ content: [], is_error: false }));
    const controller = new AbortController();
    controller.abort();
    const outcome = await callMcpTool(target, {}, { signal: controller.signal });
    expect(outcome.isError).toBe(true);
    expect(callsTo('mcp_call_tool')).toHaveLength(0);
  });

  it('gives up on its own when no reply ever comes back', async () => {
    vi.useFakeTimers();
    try {
      setMockInvokeHandler('mcp_call_tool', () => new Promise(() => {}));
      const pending = callMcpTool(target, {}, { timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000 + 10_000 + 1);
      await expect(pending).resolves.toEqual({
        content: 'MCP server "My Server" did not answer "files/read" within 1 seconds.',
        isError: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('executeToolCall — MCP dispatch', () => {
  function server(overrides: Partial<McpServerEntry> = {}): McpServerEntry {
    return {
      id: 'global:My Server',
      name: 'My Server',
      command: 'npx',
      args: [],
      env: {},
      source: 'notesage-global',
      enabled: true,
      status: 'running',
      tools: [{ name: 'files/read', description: 'Read', input_schema: { type: 'object' }, server_id: 'global:My Server' }],
      transport: 'stdio',
      projectRoot: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    useMcpStore.setState({ servers: [server()], enabledOverrides: {}, rescanCounter: 0 });
    setMockInvokeHandler('mcp_call_tool', async () => ({ content: [{ type: 'text', text: 'file body' }], is_error: false }));
    vi.mocked(invoke).mockClear();
  });

  it('routes an mcp__ name to mcp_call_tool and returns the mapped text', async () => {
    const result = await executeToolCall('call-1', 'mcp__My_Server__files_read', { path: '/x' }, undefined, {
      mcpProjectPaths: [],
    });
    expect(result).toEqual({ tool_call_id: 'call-1', content: 'file body', is_error: false });
    expect(callsTo('mcp_call_tool')[0][1]).toMatchObject({
      serverId: 'global:My Server',
      toolName: 'files/read',
      arguments: { path: '/x' },
    });
  });

  it('maps an isError result to a tool error', async () => {
    setMockInvokeHandler('mcp_call_tool', async () => ({ content: [{ type: 'text', text: 'denied by server' }], is_error: true }));
    const result = await executeToolCall('call-1', 'mcp__My_Server__files_read', {}, undefined, { mcpProjectPaths: [] });
    expect(result).toEqual({ tool_call_id: 'call-1', content: 'denied by server', is_error: true });
  });

  it('reports a server that stopped between listing and calling', async () => {
    useMcpStore.getState().setServerStatus('global:My Server', 'error', 'Server process exited');
    const result = await executeToolCall('call-1', 'mcp__My_Server__files_read', {}, undefined, { mcpProjectPaths: [] });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('is not running');
    expect(callsTo('mcp_call_tool')).toHaveLength(0);
  });

  it('reports an unknown MCP tool without calling anything', async () => {
    const result = await executeToolCall('call-1', 'mcp__ghost__tool', {}, undefined, { mcpProjectPaths: [] });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Unknown MCP tool: mcp__ghost__tool');
    expect(callsTo('mcp_call_tool')).toHaveLength(0);
  });

  it('does not reach a project server from a conversation outside that project', async () => {
    useMcpStore.setState({ servers: [server({ projectRoot: '/p/a' })] });
    const outside = await executeToolCall('c', 'mcp__My_Server__files_read', {}, { projectRoots: ['/p/b'], homeDir: '/h' });
    expect(outside.is_error).toBe(true);
    expect(callsTo('mcp_call_tool')).toHaveLength(0);
    const inside = await executeToolCall('c', 'mcp__My_Server__files_read', {}, { projectRoots: ['/p/a'], homeDir: '/h' });
    expect(inside.is_error).toBe(false);
  });
});
