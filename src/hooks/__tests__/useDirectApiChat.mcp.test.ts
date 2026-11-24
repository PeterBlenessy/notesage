// @vitest-environment jsdom

/**
 * MCP tools in the direct-API chat loop (also the bundled local-AI path, which
 * is the same hook with `provider: 'local_bundled'`).
 *
 * Pins: the tools of enabled, running servers in scope reach `ai_chat_stream`
 * as `mcp__<server>__<tool>`; a call asks permission (never auto-allowed),
 * runs `mcp_call_tool` with the ORIGINAL server id / tool name / arguments,
 * and its mapped text goes back to the model; approvals are stored per server
 * + tool; Stop does not wait for a slow server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, emitMockEvent } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useDirectApiChat } from '@/hooks/useDirectApiChat';
import { useSettingsStore } from '@/stores/settings-store';
import { useSkillStore } from '@/stores/skill-store';
import { useChatStore } from '@/stores/chat-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useToolPermissionStore } from '@/stores/tool-permission-store';
import { useSessionRunStore } from '@/stores/session-run-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useMcpStore, type McpServerEntry } from '@/stores/mcp-store';
import { invoke } from '@tauri-apps/api/core';
import { streamEvent } from '@/lib/ai/stream-events';
import { MCP_TOOL_RESULT_MAX_CHARS } from '@/lib/mcp/tool-call';
import type { ResolvedCredentials } from '@/lib/ai/credentials';

vi.mock('@/lib/ai', () => ({
  getAIProvider: vi.fn(() => ({
    name: 'anthropic',
    generateText: vi.fn(async () => 'mock response'),
    chat: vi.fn(async () => 'mock response'),
  })),
}));

vi.mock('@/lib/ai/errors', () => ({
  friendlyAIError: vi.fn((e: unknown) => String(e)),
}));

const sidOf = (args: unknown): string => String((args as { streamId?: string })?.streamId ?? '');
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

const TOOL = 'mcp__My_Server__files_read';
const PERMISSION_KEY = 'mcp:global:My Server:files/read';

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
    tools: [
      {
        name: 'files/read',
        description: 'Read a file',
        input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        server_id: 'global:My Server',
      },
    ],
    transport: 'stdio',
    projectRoot: null,
    ...overrides,
  };
}

function renderDirectApiChat(overrides: Partial<ResolvedCredentials> = {}) {
  return renderHook(() =>
    useDirectApiChat({
      resolved: { provider: 'anthropic', connectionId: 'conn-test', ollamaUrl: undefined, config: undefined, ...overrides },
      effectiveConnection: null,
      buildComposedSystemMessage: () => 'system',
      composedSystemMessage: 'system',
      localSystemMessage: 'local system',
    }),
  );
}

type StreamArgs = {
  messages: Array<{ role: string; content: string; tool_call_id?: string }>;
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> | null;
};
const streamCalls = () =>
  vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'ai_chat_stream').map(([, args]) => args as StreamArgs);
const mcpCalls = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'mcp_call_tool');
const pendingRequest = () => Object.values(useToolPermissionStore.getState().pending)[0] ?? null;
/** The tool-result message the continuation sent back to the model. */
const toolResultSent = () => streamCalls()[1]?.messages.find((m) => m.role === 'tool');
const assistantSegments = () =>
  useChatStore.getState().conversations[0]?.messages.find((m) => m.role === 'assistant')?.segments ?? [];

describe('useDirectApiChat — MCP tools', () => {
  let toolCall: { id: string; name: string; arguments: Record<string, unknown> };
  let emitToolCall = true;

  beforeEach(() => {
    toolCall = { id: 'call-1', name: TOOL, arguments: { path: '/notes/a.md' } };
    emitToolCall = true;
    useSettingsStore.setState({ toolCallingEnabled: true, chatHistoryLimit: 0, requireAllToolConfirmations: false });
    useSkillStore.setState({ skills: [], skillTools: [], enabledOverrides: {}, agents: [], activeAgentName: 'general-assistant', agentEnabledOverrides: {} });
    useChatStore.setState({ conversations: [], activeConversationId: null });
    useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
    useMcpStore.setState({ servers: [server()], enabledOverrides: {}, rescanCounter: 0 });
    usePermissionStore.setState({
      requests: [],
      sessionAllowed: new Set(),
      alwaysAllowed: [],
      domainSessionAllowed: {},
      domainAlwaysAllowed: {},
      skillScriptSession: new Set(),
      skillScriptAlways: [],
      toolCallSession: new Set(),
      toolCallAlways: [],
    });
    useToolPermissionStore.setState({ pending: {} });
    setMockInvokeHandler('ai_chat_stream_cancel', async () => {});
    setMockInvokeHandler('mcp_call_tool', async () => ({ content: [{ type: 'text', text: 'file body' }], is_error: false }));
    // First invoke of a turn emits the tool call; the continuation ends it.
    setMockInvokeHandler('ai_chat_stream', async (args) => {
      const sid = sidOf(args);
      if (emitToolCall) {
        emitToolCall = false;
        setTimeout(() => {
          emitMockEvent(streamEvent('ai-tool-call', sid), toolCall);
          emitMockEvent(streamEvent('ai-tool-calls-done', sid), null);
        }, 0);
      } else {
        setTimeout(() => emitMockEvent(streamEvent('ai-stream-done', sid), null), 0);
      }
    });
    vi.mocked(invoke).mockClear();
  });

  async function runTurn(hook: ReturnType<typeof renderDirectApiChat>, opts?: { sandboxPaths?: string[] }) {
    emitToolCall = true;
    await act(async () => { void hook.result.current.sendChatMessage('read it', [], opts); });
    await wait(80);
  }

  // --- the tool list ---------------------------------------------------

  it('offers the tools of an enabled, running server to the model', async () => {
    emitToolCall = false;
    const hook = renderDirectApiChat();
    await act(async () => { await hook.result.current.sendChatMessage('hello', []); });

    const tools = streamCalls()[0].tools!;
    expect(tools).toHaveLength(11);
    expect(tools[10]).toEqual({
      name: TOOL,
      description: 'Read a file',
      input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    });
  });

  it('offers no MCP tools from stopped, disabled or out-of-scope servers', async () => {
    useMcpStore.setState({
      servers: [
        server({ id: 'global:a', name: 'a', status: 'stopped' }),
        server({ id: 'global:b', name: 'b', enabled: false }),
        server({ id: 'project:c', name: 'c', projectRoot: '/p/other' }),
        server({ id: 'project:d', name: 'd', projectRoot: '/p/mine' }),
      ],
    });
    emitToolCall = false;
    const hook = renderDirectApiChat();
    await act(async () => { await hook.result.current.sendChatMessage('hello', [], { sandboxPaths: ['/p/mine'] }); });

    const mcpNames = streamCalls()[0].tools!.map((t) => t.name).filter((n) => n.startsWith('mcp__'));
    expect(mcpNames).toEqual(['mcp__d__files_read']);
  });

  it('offers MCP tools to the bundled local model too', async () => {
    useLocalAIStore.setState({ contextLength: 32768 });
    emitToolCall = false;
    const hook = renderDirectApiChat({ provider: 'local_bundled' });
    await act(async () => { await hook.result.current.sendChatMessage('hello', []); });
    expect(streamCalls()[0].tools!.map((t) => t.name)).toContain(TOOL);
  });

  it('does not put the server name or tool description into the system prompt', async () => {
    emitToolCall = false;
    const hook = renderDirectApiChat();
    await act(async () => { await hook.result.current.sendChatMessage('hello', []); });
    const system = streamCalls()[0].messages.find((m) => m.role === 'system');
    expect(system?.content).toBe('system');
  });

  // --- permission, dispatch, result -------------------------------------

  it('asks permission, then calls mcp_call_tool with the original server id, tool name and arguments', async () => {
    const hook = renderDirectApiChat();
    await runTurn(hook);

    // Never auto-allowed: the card is up and nothing has run.
    const pending = pendingRequest();
    expect(pending).toMatchObject({
      name: TOOL,
      arguments: { path: '/notes/a.md' },
      mcp: { serverName: 'My Server', toolName: 'files/read' },
    });
    expect(mcpCalls()).toHaveLength(0);

    await act(async () => { pending!.resolve('allow'); });
    await wait(80);

    expect(mcpCalls()).toHaveLength(1);
    expect(mcpCalls()[0][1]).toMatchObject({
      serverId: 'global:My Server',
      toolName: 'files/read',
      arguments: { path: '/notes/a.md' },
    });
    // The mapped text is what the model gets back, on the right call id.
    expect(toolResultSent()).toMatchObject({ role: 'tool', content: 'file body', tool_call_id: 'call-1' });
    // And the user sees which server acted.
    const call = assistantSegments().find((s) => s.type === 'tool_call');
    expect(call).toMatchObject({ label: 'My Server: files/read', status: 'done' });
    // "Allow once" stores nothing.
    expect(usePermissionStore.getState().toolCallSession.size).toBe(0);
    expect(usePermissionStore.getState().toolCallAlways).toEqual([]);
  });

  it('a denied call returns a denial to the model without calling the server', async () => {
    const hook = renderDirectApiChat();
    await runTurn(hook);
    await act(async () => { pendingRequest()!.resolve('deny'); });
    await wait(80);

    expect(mcpCalls()).toHaveLength(0);
    expect(toolResultSent()?.content).toContain(`Permission denied for tool: ${TOOL}`);
  });

  it('does not auto-approve on annotations the server attaches to its tool', async () => {
    const annotated = {
      ...server().tools[0],
      annotations: { readOnlyHint: true, destructiveHint: false, title: 'Totally safe' },
    };
    useMcpStore.setState({ servers: [server({ tools: [annotated] })] });
    const hook = renderDirectApiChat();
    await runTurn(hook);
    expect(pendingRequest()).not.toBeNull();
    expect(mcpCalls()).toHaveLength(0);
  });

  it('is not covered by the built-in read-only allow list, even with a built-in tool name', async () => {
    const readFile = { ...server().tools[0], name: 'read_file' };
    useMcpStore.setState({ servers: [server({ tools: [readFile] })] });
    toolCall = { id: 'call-1', name: 'mcp__My_Server__read_file', arguments: { path: '/etc/passwd' } };
    const hook = renderDirectApiChat();
    await runTurn(hook);
    expect(pendingRequest()?.mcp).toEqual({ serverName: 'My Server', toolName: 'read_file' });
    expect(mcpCalls()).toHaveLength(0);
  });

  it('"Always allow" is stored per server + tool, scoped to the connection, and then runs silently', async () => {
    const hook = renderDirectApiChat();
    await runTurn(hook);
    await act(async () => { pendingRequest()!.resolve('always'); });
    await wait(80);

    expect(usePermissionStore.getState().toolCallAlways).toEqual([
      expect.objectContaining({ toolName: PERMISSION_KEY, connectionId: 'conn-test', projectRoot: null }),
    ]);
    // Nothing is stored under the model-facing name.
    expect(usePermissionStore.getState().isToolAllowed(TOOL, null, null)).toBe('none');

    await runTurn(hook);
    expect(pendingRequest()).toBeNull();
    expect(mcpCalls()).toHaveLength(2);

    // Another tool of the same server still asks.
    useMcpStore.setState({
      servers: [server({ tools: [...server().tools, { ...server().tools[0], name: 'files/write' }] })],
    });
    toolCall = { id: 'call-2', name: 'mcp__My_Server__files_write', arguments: {} };
    await runTurn(hook);
    expect(pendingRequest()?.mcp).toEqual({ serverName: 'My Server', toolName: 'files/write' });
    expect(mcpCalls()).toHaveLength(2);
  });

  it('an approval for one server does not cover a different server with the same tool', async () => {
    usePermissionStore.getState().allowToolAlways(PERMISSION_KEY, 'conn-test', null);
    useMcpStore.setState({ servers: [server({ id: 'global:Other', name: 'Other' })] });
    toolCall = { id: 'call-1', name: 'mcp__Other__files_read', arguments: {} };
    const hook = renderDirectApiChat();
    await runTurn(hook);
    expect(pendingRequest()?.mcp).toEqual({ serverName: 'Other', toolName: 'files/read' });
    expect(mcpCalls()).toHaveLength(0);
  });

  it('"confirm every tool call" asks even for an always-allowed MCP tool', async () => {
    usePermissionStore.getState().allowToolAlways(PERMISSION_KEY, 'conn-test', null);
    useSettingsStore.setState({ requireAllToolConfirmations: true });
    const hook = renderDirectApiChat();
    await runTurn(hook);
    expect(pendingRequest()).not.toBeNull();
    expect(mcpCalls()).toHaveLength(0);
  });

  it('"Allow for session" stores the server + tool key for the session only', async () => {
    const hook = renderDirectApiChat();
    await runTurn(hook);
    await act(async () => { pendingRequest()!.resolve('session'); });
    await wait(80);
    expect([...usePermissionStore.getState().toolCallSession]).toEqual([PERMISSION_KEY]);
    expect(usePermissionStore.getState().toolCallAlways).toEqual([]);
  });

  // --- results ---------------------------------------------------------

  it('maps isError to a tool error the model can read', async () => {
    setMockInvokeHandler('mcp_call_tool', async () => ({ content: [{ type: 'text', text: 'ENOENT: no such file' }], is_error: true }));
    usePermissionStore.getState().allowToolAlways(PERMISSION_KEY, 'conn-test', null);
    const hook = renderDirectApiChat();
    await runTurn(hook);

    expect(toolResultSent()?.content).toContain('ENOENT: no such file');
    expect(toolResultSent()?.content).toContain(`Tool '${TOOL}' failed`);
    expect(assistantSegments().find((s) => s.type === 'tool_call')).toMatchObject({ status: 'error' });
  });

  it('omits image content with a note', async () => {
    setMockInvokeHandler('mcp_call_tool', async () => ({
      content: [{ type: 'text', text: 'chart:' }, { type: 'image', data: 'QUJD'.repeat(500), mimeType: 'image/png' }],
      is_error: false,
    }));
    usePermissionStore.getState().allowToolAlways(PERMISSION_KEY, 'conn-test', null);
    const hook = renderDirectApiChat();
    await runTurn(hook);

    const content = toolResultSent()!.content;
    expect(content).toContain('chart:');
    expect(content).toContain('[image omitted: image/png');
    expect(content).not.toContain('QUJDQUJD');
  });

  it('truncates an oversized result with a marker', async () => {
    setMockInvokeHandler('mcp_call_tool', async () => ({
      content: [{ type: 'text', text: 'x'.repeat(MCP_TOOL_RESULT_MAX_CHARS * 3) }],
      is_error: false,
    }));
    usePermissionStore.getState().allowToolAlways(PERMISSION_KEY, 'conn-test', null);
    const hook = renderDirectApiChat();
    await runTurn(hook);

    const content = toolResultSent()!.content;
    expect(content.length).toBeLessThan(MCP_TOOL_RESULT_MAX_CHARS + 200);
    expect(content).toContain(`[Result truncated: ${MCP_TOOL_RESULT_MAX_CHARS * 2} more characters were omitted.]`);
  });

  it('a server that stopped between listing and calling yields a readable error, with no card', async () => {
    usePermissionStore.getState().allowToolAlways(PERMISSION_KEY, 'conn-test', null);
    const hook = renderDirectApiChat();
    // The tool list goes out with the server running; it dies before the call.
    setMockInvokeHandler('ai_chat_stream', async (args) => {
      const sid = sidOf(args);
      if (emitToolCall) {
        emitToolCall = false;
        useMcpStore.getState().setServerStatus('global:My Server', 'error', 'Server process exited');
        setTimeout(() => {
          emitMockEvent(streamEvent('ai-tool-call', sid), toolCall);
          emitMockEvent(streamEvent('ai-tool-calls-done', sid), null);
        }, 0);
      } else {
        setTimeout(() => emitMockEvent(streamEvent('ai-stream-done', sid), null), 0);
      }
    });
    await runTurn(hook);

    expect(streamCalls()[0].tools!.map((t) => t.name)).toContain(TOOL);
    expect(mcpCalls()).toHaveLength(0);
    expect(toolResultSent()?.content).toContain('MCP server "My Server" is not running (status: error)');
  });

  it('an mcp__ name that matches no server errors without a permission card', async () => {
    toolCall = { id: 'call-1', name: 'mcp__ghost__tool', arguments: {} };
    const hook = renderDirectApiChat();
    await runTurn(hook);
    expect(pendingRequest()).toBeNull();
    expect(mcpCalls()).toHaveLength(0);
    expect(toolResultSent()?.content).toContain('Unknown MCP tool: mcp__ghost__tool');
  });

  // --- Stop ------------------------------------------------------------

  it('Stop during a pending MCP call settles the turn and discards the late result', async () => {
    let release: (value: unknown) => void = () => {};
    setMockInvokeHandler('mcp_call_tool', () => new Promise((resolve) => { release = resolve; }));
    usePermissionStore.getState().allowToolAlways(PERMISSION_KEY, 'conn-test', null);
    const hook = renderDirectApiChat();
    await runTurn(hook);
    expect(mcpCalls()).toHaveLength(1);
    expect(streamCalls()).toHaveLength(1);
    const convId = useChatStore.getState().conversations[0].id;
    expect(useSessionRunStore.getState().runs[convId]).toBeDefined();

    act(() => { hook.result.current.cancelDirectChat(); });
    await wait(20);

    // The turn is over although the server has not answered.
    expect(useSessionRunStore.getState().runs[convId]).toBeUndefined();
    expect(useChatStore.getState().isLoading).toBe(false);
    expect(assistantSegments().some((s) => s.type === 'tool_call' && s.status === 'running')).toBe(false);
    const segmentsAfterStop = JSON.stringify(assistantSegments());

    // The server answers late: no continuation, nothing written.
    release({ content: [{ type: 'text', text: 'late body' }], is_error: false });
    await wait(40);
    expect(streamCalls()).toHaveLength(1);
    expect(JSON.stringify(assistantSegments())).toBe(segmentsAfterStop);
    expect(segmentsAfterStop).not.toContain('late body');
  });
});
