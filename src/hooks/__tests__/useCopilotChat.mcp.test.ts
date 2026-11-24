// @vitest-environment jsdom

/**
 * MCP tools in the Copilot language-server chat path. The equivalent of
 * `useDirectApiChat.mcp.test.ts`: the tools reach `conversation/create`, a
 * call asks permission and runs `mcp_call_tool` with the original server id
 * and tool name, the mapped text goes back to the LSP, and Stop does not wait
 * for a slow server. Tool execution is NOT stubbed here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, emitMockEvent } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useCopilotChat } from '@/hooks/useCopilotChat';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useChatStore, type Conversation } from '@/stores/chat-store';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSkillStore } from '@/stores/skill-store';
import { useMcpStore, type McpServerEntry } from '@/stores/mcp-store';
import { useToolPermissionStore } from '@/stores/tool-permission-store';
import { usePermissionStore } from '@/stores/permission-store';
import { tauriApi } from '@/lib/tauri';
import { resetCopilotStreams } from '@/lib/ai/copilot-correlation';
import type { Connection } from '@/lib/ai/connections';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), perf: vi.fn() },
  PERF: {},
}));

const TOOL = 'mcp__My_Server__files_read';
const PERMISSION_KEY = 'mcp:global:My Server:files/read';
const CONNECTION_ID = 'conn-copilot-lsp';

function connection(): Connection {
  return {
    id: CONNECTION_ID,
    provider: 'github',
    authMethod: 'agent_managed',
    status: 'connected',
    label: 'Copilot LSP',
    credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
    capabilities: ['interactive', 'inline_completion', 'agent_tasks'],
    createdAt: Date.now(),
  };
}

function conversation(id: string, projectPaths: string[]): Conversation {
  const now = Date.now();
  return {
    id,
    title: id,
    messages: [],
    createdAt: now,
    updatedAt: now,
    projectPaths,
    segments: [{ projectPaths, sessionId: null, startMessageIndex: 0, historyIncluded: false }],
    activeSegmentIndex: 0,
    pendingProjectSwitch: null,
    activeLeafId: null,
  };
}

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
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
        server_id: 'global:My Server',
      },
    ],
    transport: 'stdio',
    projectRoot: null,
    ...overrides,
  };
}

describe('useCopilotChat — MCP tools', () => {
  let createSpy: ReturnType<typeof vi.spyOn>;
  let toolResultSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetCopilotStreams();
    useWorkspaceStore.setState({ explorerFolders: [], projects: [] });
    useChatStore.setState({ conversations: [conversation('note-A', [])], activeConversationId: 'note-A' });
    useEditorStore.setState({ openDocuments: [], activeTabId: null });
    useSettingsStore.setState({
      homeDir: '/Users/tester',
      notesRootPath: '/Users/tester/Notesage',
      toolCallingEnabled: true,
      requireAllToolConfirmations: false,
    });
    useSkillStore.setState({ skillTools: [] });
    useMcpStore.setState({ servers: [server()], enabledOverrides: {}, rescanCounter: 0 });
    usePermissionStore.setState({ toolCallSession: new Set(), toolCallAlways: [] });
    useToolPermissionStore.setState({ pending: {} });

    vi.spyOn(tauriApi, 'copilotLspStart').mockResolvedValue(undefined);
    vi.spyOn(tauriApi, 'copilotLspDidOpen').mockResolvedValue(undefined);
    vi.spyOn(tauriApi, 'copilotLspConversationDestroy').mockResolvedValue(undefined);
    vi.spyOn(tauriApi, 'copilotLspContextResponse').mockResolvedValue(undefined);
    createSpy = vi.spyOn(tauriApi, 'copilotLspConversationCreate');
    createSpy.mockReset();
    // Like the real command, create resolves only when the turn is over.
    createSpy.mockImplementation(() => new Promise(() => {}));
    toolResultSpy = vi.spyOn(tauriApi, 'copilotLspToolResult');
    toolResultSpy.mockReset();
    toolResultSpy.mockResolvedValue(undefined);

    setMockInvokeHandler('mcp_call_tool', async () => ({ content: [{ type: 'text', text: 'file body' }], is_error: false }));
    vi.mocked(invoke).mockClear();
  });

  function renderCopilot() {
    return renderHook(() =>
      useCopilotChat({
        effectiveConnection: connection(),
        buildComposedSystemMessage: () => 'system',
        composedSystemMessage: 'system',
      }),
    );
  }

  type Hook = ReturnType<typeof renderCopilot>['result'];

  /** Start a turn, bind it to its Copilot conversation, return nothing. */
  async function startTurn(result: Hook) {
    await act(async () => {
      void result.current.copilotSendChatMessage('hello', [], {});
      await new Promise((r) => setTimeout(r, 0));
    });
    const calls = createSpy.mock.calls;
    const token = String(calls[calls.length - 1]?.[5]);
    await emit('copilot-chat-begin', { token, conversationId: 'cop-1' });
  }

  async function emit(event: string, payload: Record<string, unknown>) {
    await act(async () => {
      emitMockEvent(event, payload);
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  const emitToolCall = (name = TOOL, args: Record<string, unknown> = { path: '/notes/a.md' }) =>
    emit('copilot-tool-call', { requestId: 'req-1', id: 'tc-1', name, arguments: args, conversationId: 'cop-1' });

  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  const mcpCalls = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'mcp_call_tool');
  const pendingCard = () => useToolPermissionStore.getState().pending['note-A'] ?? null;
  const assistantSegments = () =>
    useChatStore.getState().conversations.find((c) => c.id === 'note-A')
      ?.messages.find((m) => m.role === 'assistant')?.segments ?? [];

  it('registers the MCP tools of running servers in scope with the LSP', async () => {
    useMcpStore.setState({
      servers: [
        server(),
        server({ id: 'global:off', name: 'off', enabled: false }),
        server({ id: 'global:down', name: 'down', status: 'error' }),
        server({ id: 'project:other', name: 'other', projectRoot: '/p/other' }),
      ],
    });
    const { result } = renderCopilot();
    await startTurn(result);

    const lspTools = createSpy.mock.calls[0][2] as Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
    const mcpTools = lspTools.filter((t) => t.name.startsWith('mcp__'));
    expect(mcpTools).toEqual([
      {
        name: TOOL,
        description: 'Read a file',
        // The LSP needs `required` to be an array.
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: [] },
      },
    ]);
    expect(lspTools.some((t) => t.name === 'read_file')).toBe(true);
  });

  it('asks permission, calls mcp_call_tool with the original names, and returns the mapped text', async () => {
    const { result } = renderCopilot();
    await startTurn(result);
    await emitToolCall();

    const card = pendingCard();
    expect(card).toMatchObject({
      name: TOOL,
      arguments: { path: '/notes/a.md' },
      mcp: { serverName: 'My Server', toolName: 'files/read' },
    });
    expect(mcpCalls()).toHaveLength(0);

    await act(async () => { card!.resolve('allow'); });
    await settle();

    expect(mcpCalls()).toHaveLength(1);
    expect(mcpCalls()[0][1]).toMatchObject({
      serverId: 'global:My Server',
      toolName: 'files/read',
      arguments: { path: '/notes/a.md' },
    });
    expect(toolResultSpy).toHaveBeenCalledWith('req-1', { content: 'file body', is_error: false });
    expect(assistantSegments().find((s) => s.type === 'tool_call'))
      .toMatchObject({ label: 'My Server: files/read', status: 'done' });
    expect(usePermissionStore.getState().toolCallAlways).toEqual([]);
  });

  it('a denied call answers the LSP with a denial and never calls the server', async () => {
    const { result } = renderCopilot();
    await startTurn(result);
    await emitToolCall();
    await act(async () => { pendingCard()!.resolve('deny'); });
    await settle();

    expect(mcpCalls()).toHaveLength(0);
    expect(toolResultSpy).toHaveBeenCalledWith('req-1', {
      content: `Permission denied for tool: ${TOOL}`,
      is_error: true,
    });
  });

  it('"Always allow" is stored per server + tool for this connection and then runs silently', async () => {
    const { result } = renderCopilot();
    await startTurn(result);
    await emitToolCall();
    await act(async () => { pendingCard()!.resolve('always'); });
    await settle();

    expect(usePermissionStore.getState().toolCallAlways).toEqual([
      expect.objectContaining({ toolName: PERMISSION_KEY, connectionId: CONNECTION_ID, projectRoot: null }),
    ]);
    expect(usePermissionStore.getState().isToolAllowed(TOOL, null, null)).toBe('none');

    await emit('copilot-tool-call', { requestId: 'req-2', id: 'tc-2', name: TOOL, arguments: {}, conversationId: 'cop-1' });
    await settle();
    expect(pendingCard()).toBeNull();
    expect(mcpCalls()).toHaveLength(2);
  });

  it('"confirm every tool call" asks even for an always-allowed MCP tool', async () => {
    usePermissionStore.getState().allowToolAlways(PERMISSION_KEY, CONNECTION_ID, null);
    useSettingsStore.setState({ requireAllToolConfirmations: true });
    const { result } = renderCopilot();
    await startTurn(result);
    await emitToolCall();
    expect(pendingCard()).not.toBeNull();
    expect(mcpCalls()).toHaveLength(0);
  });

  it('maps isError to an error result for the LSP', async () => {
    setMockInvokeHandler('mcp_call_tool', async () => ({ content: [{ type: 'text', text: 'ENOENT' }], is_error: true }));
    usePermissionStore.getState().allowToolAlways(PERMISSION_KEY, CONNECTION_ID, null);
    const { result } = renderCopilot();
    await startTurn(result);
    await emitToolCall();
    await settle();
    expect(toolResultSpy).toHaveBeenCalledWith('req-1', { content: 'ENOENT', is_error: true });
  });

  it('an mcp__ name that matches no server errors without a permission card', async () => {
    const { result } = renderCopilot();
    await startTurn(result);
    await emitToolCall('mcp__ghost__tool', {});
    await settle();
    expect(pendingCard()).toBeNull();
    expect(mcpCalls()).toHaveLength(0);
    expect(toolResultSpy.mock.calls[0][1]).toMatchObject({ is_error: true });
    expect(String((toolResultSpy.mock.calls[0][1] as { content: string }).content)).toContain('Unknown MCP tool');
  });

  it('Stop during a pending MCP call settles the turn and discards the late result', async () => {
    let release: (value: unknown) => void = () => {};
    setMockInvokeHandler('mcp_call_tool', () => new Promise((resolve) => { release = resolve; }));
    usePermissionStore.getState().allowToolAlways(PERMISSION_KEY, CONNECTION_ID, null);
    const { result } = renderCopilot();
    await startTurn(result);
    await emitToolCall();
    expect(mcpCalls()).toHaveLength(1);

    await act(async () => {
      result.current.cancelCopilotChat();
      await new Promise((r) => setTimeout(r, 10));
    });

    // The LSP's request is answered although the server has not replied.
    expect(toolResultSpy).toHaveBeenCalledTimes(1);
    expect(toolResultSpy.mock.calls[0][1]).toMatchObject({ is_error: true });
    expect(assistantSegments().some((s) => s.type === 'tool_call' && s.status === 'running')).toBe(false);
    const segmentsAfterStop = JSON.stringify(assistantSegments());

    release({ content: [{ type: 'text', text: 'late body' }], is_error: false });
    await settle();
    expect(toolResultSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(assistantSegments())).toBe(segmentsAfterStop);
  });
});
