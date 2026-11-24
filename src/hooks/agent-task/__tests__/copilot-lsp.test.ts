// @vitest-environment jsdom

/**
 * Copilot LSP background-task backend: tool permissions, event correlation
 * and cancel (audit 2026-11-22 §2 and §6).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, emitMockEvent } from '@/test/tauri-mock';
import { startCopilotLspTask, cancelCopilotLspTask } from '@/hooks/agent-task/copilot-lsp';
import { agentTaskRegistry, resetAgentTaskRegistry } from '@/hooks/agent-task/task-registry';
import type { TaskActivityEvent } from '@/hooks/agent-task/run-task';
import { openCopilotStream, resetCopilotStreams } from '@/lib/ai/copilot-correlation';
import { usePermissionStore } from '@/stores/permission-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useActivityStore } from '@/stores/activity-store';
import { useMcpStore, type McpServerEntry } from '@/stores/mcp-store';
import { executeToolCall } from '@/lib/tool-executor';
import type { Connection } from '@/lib/ai/connections';

vi.mock('@/lib/tool-executor', () => ({
  executeToolCall: vi.fn(async () => ({ tool_call_id: 'x', content: 'file body', is_error: false })),
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const connection: Connection = {
  id: 'conn-copilot-lsp',
  provider: 'github',
  authMethod: 'agent_managed',
  status: 'connected',
  label: 'Copilot LSP',
  credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
  capabilities: ['interactive', 'inline_completion', 'agent_tasks'],
  createdAt: 0,
};

interface InvokeCall {
  command: string;
  args: Record<string, unknown>;
}

describe('Copilot LSP agent task', () => {
  let calls: InvokeCall[];
  let activities: TaskActivityEvent[];
  let errors: string[];
  /** Settle the in-flight `conversation/create`. */
  let finishCreate: (conversationId: string) => void;
  let failCreate: (error: Error) => void;
  /** The workDoneToken the task sent with its create. */
  let token: string;

  beforeEach(() => {
    resetAgentTaskRegistry();
    resetCopilotStreams();
    useActivityStore.setState({ tasks: [] });
    usePermissionStore.setState({ toolCallSession: new Set(), toolCallAlways: [] });
    useSettingsStore.setState({ requireAllToolConfirmations: false });
    useMcpStore.setState({ servers: [], enabledOverrides: {}, rescanCounter: 0 });
    vi.mocked(executeToolCall).mockClear();

    calls = [];
    activities = [];
    errors = [];
    token = '';
    const record = (command: string) => (args?: Record<string, unknown>) => {
      calls.push({ command, args: args ?? {} });
      return undefined;
    };
    setMockInvokeHandler('copilot_lsp_tool_result', record('copilot_lsp_tool_result'));
    setMockInvokeHandler('copilot_lsp_tool_confirmation_response', record('copilot_lsp_tool_confirmation_response'));
    setMockInvokeHandler('copilot_lsp_context_response', record('copilot_lsp_context_response'));
    setMockInvokeHandler('copilot_lsp_conversation_destroy', record('copilot_lsp_conversation_destroy'));
    setMockInvokeHandler('get_home_dir', () => '/Users/test');
    setMockInvokeHandler('copilot_lsp_conversation_create', (args) => {
      token = String(args?.workDoneToken);
      // Like the real command, create resolves only when the turn is over.
      return new Promise((resolve, reject) => {
        finishCreate = (conversationId) => resolve({ conversationId, turnId: 't1' });
        failCreate = reject;
      });
    });
  });

  async function start(projectRoot = '/proj'): Promise<string> {
    const taskId = await startCopilotLspTask(
      'do the thing',
      {
        onActivity: (a) => activities.push(a),
        onError: (e) => errors.push(e),
      },
      { type: 'chat', label: 'Task', projectRoot },
      connection,
    );
    await tick();
    return taskId;
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  async function emit(event: string, payload: Record<string, unknown>) {
    emitMockEvent(event, payload);
    await tick();
    await tick();
  }

  const callsTo = (command: string) => calls.filter((c) => c.command === command);

  /** Start a task and bind it to conversation `cop-task`, as `begin` does. */
  async function startBound(): Promise<string> {
    const taskId = await start();
    await emit('copilot-chat-begin', { token, conversationId: 'cop-task' });
    return taskId;
  }

  const toolCall = (name: string, conversationId = 'cop-task') => ({
    requestId: `tool-${name}`,
    id: `tc-${name}`,
    name,
    arguments: { path: '/proj/a.md' },
    conversationId,
  });

  // --- tool permissions --------------------------------------------------

  it('does not run a write tool the user has not already allowed', async () => {
    await startBound();
    await emit('copilot-tool-call', toolCall('write_file'));

    expect(executeToolCall).not.toHaveBeenCalled();
    const results = callsTo('copilot_lsp_tool_result');
    expect(results).toHaveLength(1);
    expect(results[0].args.requestId).toBe('tool-write_file');
    expect(results[0].args.result).toMatchObject({ status: 'error' });
    expect(JSON.stringify(results[0].args.result)).toContain('Permission denied');
    expect(activities.some((a) => a.event === 'tool_denied' && a.label.includes('write_file'))).toBe(true);
  });

  it('does not run a skill script without prior approval', async () => {
    await startBound();
    await emit('copilot-tool-call', toolCall('execute_skill_script'));
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it('runs a built-in read-only tool, scoped to the task project', async () => {
    await startBound();
    await emit('copilot-tool-call', toolCall('read_file'));

    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executeToolCall).mock.calls[0][3]).toEqual({
      projectRoots: ['/proj'],
      homeDir: '/Users/test',
    });
    expect(callsTo('copilot_lsp_tool_result')[0].args.result).toMatchObject({ status: 'success' });
  });

  it('runs a tool the user allowed for this session', async () => {
    usePermissionStore.getState().allowToolSession('write_file');
    await startBound();
    await emit('copilot-tool-call', toolCall('write_file'));
    expect(executeToolCall).toHaveBeenCalledTimes(1);
  });

  it('honours an "always allow" only for the project it was given for', async () => {
    usePermissionStore.getState().allowToolAlways('write_file', connection.id, '/other-project');
    await startBound();
    await emit('copilot-tool-call', toolCall('write_file'));
    expect(executeToolCall).not.toHaveBeenCalled();

    usePermissionStore.getState().allowToolAlways('write_file', connection.id, '/proj');
    await emit('copilot-tool-call', toolCall('write_file'));
    expect(executeToolCall).toHaveBeenCalledTimes(1);
  });

  // --- MCP tools -----------------------------------------------------------
  // An MCP tool is approved per server + tool (`mcp:<serverId>:<tool>`), is
  // never on the built-in read-only list, and a background task has nobody
  // to ask: it runs one only when the user already allowed it in chat.

  const MCP_TOOL = 'mcp__files__read_file';
  const mcpServer = (overrides: Partial<McpServerEntry> = {}): McpServerEntry => ({
    id: 'global:files',
    name: 'files',
    command: 'npx',
    args: [],
    env: {},
    source: 'notesage-global',
    enabled: true,
    status: 'running',
    // Named like a built-in read-only tool on purpose.
    tools: [{ name: 'read_file', description: null, input_schema: { type: 'object' }, server_id: 'global:files' }],
    transport: 'stdio',
    projectRoot: null,
    ...overrides,
  });

  it('does not run an MCP tool the user has not already allowed', async () => {
    useMcpStore.setState({ servers: [mcpServer()] });
    await startBound();
    await emit('copilot-tool-call', toolCall(MCP_TOOL));

    expect(executeToolCall).not.toHaveBeenCalled();
    const results = callsTo('copilot_lsp_tool_result');
    expect(results).toHaveLength(1);
    expect(results[0].args.result).toMatchObject({ status: 'error' });
    expect(JSON.stringify(results[0].args.result)).toContain('Permission denied');
    expect(activities.some((a) => a.event === 'tool_denied' && a.label.includes(MCP_TOOL))).toBe(true);
  });

  it('does not run an MCP tool on an approval stored under its model-facing name', async () => {
    useMcpStore.setState({ servers: [mcpServer()] });
    usePermissionStore.getState().allowToolSession(MCP_TOOL);
    usePermissionStore.getState().allowToolAlways(MCP_TOOL, null, null);
    await startBound();
    await emit('copilot-tool-call', toolCall(MCP_TOOL));
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it('runs an MCP tool the user always-allowed for this server, tool and connection', async () => {
    useMcpStore.setState({ servers: [mcpServer()] });
    usePermissionStore.getState().allowToolAlways('mcp:global:files:read_file', 'another-connection', null);
    await startBound();
    await emit('copilot-tool-call', toolCall(MCP_TOOL));
    expect(executeToolCall).not.toHaveBeenCalled();

    usePermissionStore.getState().allowToolAlways('mcp:global:files:read_file', connection.id, null);
    await emit('copilot-tool-call', toolCall(MCP_TOOL));
    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executeToolCall).mock.calls[0][1]).toBe(MCP_TOOL);
  });

  it('does not run an MCP tool of another project or of an unknown server', async () => {
    useMcpStore.setState({ servers: [mcpServer({ id: 'project:files', projectRoot: '/other-project' })] });
    usePermissionStore.getState().allowToolAlways('mcp:project:files@/other-project:read_file', connection.id, '/other-project');
    await startBound();
    await emit('copilot-tool-call', toolCall(MCP_TOOL));
    await emit('copilot-tool-call', toolCall('mcp__ghost__tool'));
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it('runs no MCP tool when every tool call needs confirmation', async () => {
    useMcpStore.setState({ servers: [mcpServer()] });
    usePermissionStore.getState().allowToolAlways('mcp:global:files:read_file', connection.id, null);
    useSettingsStore.setState({ requireAllToolConfirmations: true });
    await startBound();
    await emit('copilot-tool-call', toolCall(MCP_TOOL));
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it('runs nothing when every tool call needs confirmation', async () => {
    useSettingsStore.setState({ requireAllToolConfirmations: true });
    await startBound();
    await emit('copilot-tool-call', toolCall('read_file'));
    expect(executeToolCall).not.toHaveBeenCalled();
    expect(callsTo('copilot_lsp_tool_result')[0].args.result).toMatchObject({ status: 'error' });
  });

  it('dismisses a tool confirmation instead of auto-approving it', async () => {
    await startBound();
    await emit('copilot-tool-confirmation', { requestId: 'confirm-1', name: 'run_in_terminal', conversationId: 'cop-task' });

    const responses = callsTo('copilot_lsp_tool_confirmation_response');
    expect(responses).toHaveLength(1);
    expect(responses[0].args).toEqual({ requestId: 'confirm-1', accepted: false });
    expect(activities.some((a) => a.event === 'permission_auto_approved')).toBe(false);
    expect(activities.some((a) => a.event === 'tool_denied')).toBe(true);
  });

  it('confirms a tool the user has already allowed', async () => {
    usePermissionStore.getState().allowToolSession('write_file');
    await startBound();
    await emit('copilot-tool-confirmation', { requestId: 'confirm-2', name: 'write_file', conversationId: 'cop-task' });

    expect(callsTo('copilot_lsp_tool_confirmation_response')[0].args).toEqual({ requestId: 'confirm-2', accepted: true });
    expect(activities.some((a) => a.event === 'permission_auto_approved')).toBe(true);
  });

  // --- correlation -------------------------------------------------------

  it("ignores another stream's chunks and completion", async () => {
    const taskId = await start();
    expect(token.startsWith('copilot-chat-')).toBe(true);

    await emit('copilot-chat-chunk', { token: 'copilot-chat-someone-else', conversationId: 'cop-chat', text: 'CHAT' });
    await emit('copilot-chat-chunk', { conversationId: '', text: 'stray' });
    await emit('copilot-chat-done', { token: 'copilot-chat-someone-else', conversationId: 'cop-chat' });
    expect(agentTaskRegistry.getTask(taskId)?.output).toBe('');
    expect(agentTaskRegistry.getTask(taskId)?.status).toBe('running');

    await emit('copilot-chat-chunk', { token, conversationId: 'cop-task', text: 'mine' });
    await emit('copilot-chat-done', { token, conversationId: 'cop-task' });
    expect(agentTaskRegistry.getTask(taskId)?.output).toBe('mine');
    expect(agentTaskRegistry.getTask(taskId)?.status).toBe('completed');
  });

  it("does not answer a confirmation addressed to a chat's conversation, or to nobody", async () => {
    await startBound();
    // A chat turn is streaming at the same time.
    openCopilotStream('cop-chat');

    await emit('copilot-tool-confirmation', { requestId: 'confirm-chat', name: 'read_file', conversationId: 'cop-chat' });
    await emit('copilot-tool-confirmation', { requestId: 'confirm-anon', name: 'read_file', conversationId: '' });
    await emit('copilot-tool-call', toolCall('read_file', 'cop-chat'));
    await emit('copilot-context-request', { requestId: 'ctx-anon', conversationId: '' });

    expect(callsTo('copilot_lsp_tool_confirmation_response')).toHaveLength(0);
    expect(callsTo('copilot_lsp_context_response')).toHaveLength(0);
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  // --- cancel ------------------------------------------------------------

  it('cancel destroys the LSP conversation, and a late failure is not reported', async () => {
    const taskId = await startBound();

    const task = agentTaskRegistry.getTask(taskId)!;
    task.status = 'cancelled';
    expect(await cancelCopilotLspTask(taskId)).toBe(true);
    expect(callsTo('copilot_lsp_conversation_destroy').map((c) => c.args.conversationId)).toEqual(['cop-task']);

    // Destroying the conversation makes the pending create fail.
    failCreate(new Error('conversation destroyed'));
    await tick();
    await tick();
    expect(errors).toEqual([]);
    expect(task.status).toBe('cancelled');
    // Cleanup ran: the task is no longer cancellable, and nothing is destroyed twice.
    expect(await cancelCopilotLspTask(taskId)).toBe(false);
    expect(callsTo('copilot_lsp_conversation_destroy')).toHaveLength(1);
  });

  it('a cancel before the conversation id is known destroys it once create returns', async () => {
    const taskId = await start();

    agentTaskRegistry.getTask(taskId)!.status = 'cancelled';
    expect(await cancelCopilotLspTask(taskId)).toBe(true);
    expect(callsTo('copilot_lsp_conversation_destroy')).toHaveLength(0);

    finishCreate('cop-late');
    await tick();
    await tick();
    expect(callsTo('copilot_lsp_conversation_destroy').map((c) => c.args.conversationId)).toEqual(['cop-late']);
  });

  it('a create that fails on its own still fails the task', async () => {
    const taskId = await start();
    failCreate(new Error('LSP not running'));
    await tick();
    await tick();
    expect(errors).toEqual(['LSP not running']);
    expect(agentTaskRegistry.getTask(taskId)?.status).toBe('failed');
  });

  it('reports false for a task it does not know', async () => {
    expect(await cancelCopilotLspTask('task-unknown')).toBe(false);
  });
});
