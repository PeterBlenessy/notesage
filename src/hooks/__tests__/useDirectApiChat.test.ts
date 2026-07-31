// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, emitMockEvent, getListenerCount } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useDirectApiChat } from '@/hooks/useDirectApiChat';
import { useSettingsStore } from '@/stores/settings-store';
import { useSkillStore } from '@/stores/skill-store';
import { useChatStore } from '@/stores/chat-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useToolPermissionStore } from '@/stores/tool-permission-store';
import { invoke } from '@tauri-apps/api/core';
import { streamEvent } from '@/lib/ai/stream-events';
import { useSessionRunStore } from '@/stores/session-run-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import type { ChatMessage } from '@/lib/ai/types';
import type { ResolvedCredentials } from '@/lib/ai/credentials';

// The hook generates a unique per-request streamId and emits/listens on
// `<event>:<streamId>`. Each ai_chat_stream mock captures it so emits and
// listener-count assertions target the matching channel.
let lastStreamId = '';
const sidOf = (args: unknown): string => String((args as { streamId?: string })?.streamId ?? '');

// ---------------------------------------------------------------------------
// Mock AI provider
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultResolved: ResolvedCredentials = {
  provider: 'anthropic',
  connectionId: 'conn-test',
  ollamaUrl: undefined,
  config: undefined,
};

function renderDirectApiChat(overrides: Partial<ResolvedCredentials> = {}) {
  return renderHook(() =>
    useDirectApiChat({
      resolved: { ...defaultResolved, ...overrides },
      effectiveConnection: null,
      buildComposedSystemMessage: () => 'system',
      composedSystemMessage: 'system',
      localSystemMessage: 'local system',
    })
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDirectApiChat — tool calling', () => {
  beforeEach(() => {
    useSettingsStore.setState({ toolCallingEnabled: true, chatHistoryLimit: 0 });
    useSkillStore.setState({ skills: [], enabledOverrides: {}, agents: [], activeAgentName: 'general-assistant', agentEnabledOverrides: {} });
    useChatStore.getState().clearMessages();

    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args);
      setTimeout(() => emitMockEvent(streamEvent('ai-stream-done', lastStreamId), null), 0);
    });
    vi.mocked(invoke).mockClear();
  });

  it('passes built-in tools when toolCallingEnabled is true', async () => {
    const { result } = renderDirectApiChat();

    await act(async () => {
      await result.current.sendChatMessage('hello', []);
    });

    const invokeCall = vi.mocked(invoke).mock.calls.find(
      ([cmd]) => cmd === 'ai_chat_stream'
    );
    expect(invokeCall).toBeDefined();
    const args = invokeCall![1] as Record<string, unknown>;
    expect(args.tools).toBeDefined();
    expect(args.tools).not.toBeNull();

    const tools = args.tools as Array<{ name: string }>;
    // 10 built-in tools always present (6 original + 4 document tools)
    expect(tools).toHaveLength(10);
    expect(tools.map((t) => t.name)).toContain('read_file');
    expect(tools.map((t) => t.name)).toContain('write_file');
    expect(tools.map((t) => t.name)).toContain('read_skill_content');
    expect(tools.map((t) => t.name)).toContain('execute_skill_script');
    expect(tools.map((t) => t.name)).toContain('list_directory');
    expect(tools.map((t) => t.name)).toContain('web_search');
    expect(tools.map((t) => t.name)).toContain('add_comments');
    expect(tools.map((t) => t.name)).toContain('list_comments');
    expect(tools.map((t) => t.name)).toContain('resolve_comments');
    expect(tools.map((t) => t.name)).toContain('generate_pptx');
  });

  it('does not pass tools when toolCallingEnabled is false', async () => {
    useSettingsStore.setState({ toolCallingEnabled: false });

    const { result } = renderDirectApiChat();

    await act(async () => {
      await result.current.sendChatMessage('hello', []);
    });

    const invokeCall = vi.mocked(invoke).mock.calls.find(
      ([cmd]) => cmd === 'ai_chat_stream'
    );
    expect(invokeCall).toBeDefined();
    const args = invokeCall![1] as Record<string, unknown>;
    expect(args.tools).toBeNull();
  });

  it('sends all tools regardless of agent allowed_tools', async () => {
    useSkillStore.setState({
      skills: [],
      agents: [
        {
          name: 'restricted-agent',
          description: 'An agent with allowed_tools set',
          path: '/agents/restricted',
          source: 'notesage-global',
          allowed_tools: ['read_file'],
        },
      ],
      activeAgentName: 'restricted-agent',
    });

    const { result } = renderDirectApiChat();

    await act(async () => {
      await result.current.sendChatMessage('hello', []);
    });

    const invokeCall = vi.mocked(invoke).mock.calls.find(
      ([cmd]) => cmd === 'ai_chat_stream'
    );
    expect(invokeCall).toBeDefined();
    const args = invokeCall![1] as Record<string, unknown>;
    const tools = args.tools as Array<{ name: string }>;
    // All built-in tools available — user controls access via permission system
    expect(tools.length).toBeGreaterThanOrEqual(6);
    expect(tools.some((t) => t.name === 'read_file')).toBe(true);
    expect(tools.some((t) => t.name === 'web_search')).toBe(true);
  });
});

describe('useDirectApiChat — listener lifecycle (#9, #15)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ toolCallingEnabled: false, chatHistoryLimit: 0 });
    useSkillStore.setState({ skills: [], enabledOverrides: {}, agents: [], activeAgentName: 'general-assistant', agentEnabledOverrides: {} });
    useChatStore.getState().clearMessages();
    vi.mocked(invoke).mockClear();
  });

  it('cleans up all listeners when ai-stream-done fires', async () => {
    // ai_chat_stream resolves immediately; done event fires in the next tick
    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args);
      setTimeout(() => emitMockEvent(streamEvent('ai-stream-done', lastStreamId), null), 0);
    });

    const { result } = renderDirectApiChat();

    await act(async () => {
      await result.current.sendChatMessage('hello', []);
    });

    // Allow any pending microtasks/timers to flush
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // All listeners should be cleaned up after done
    expect(getListenerCount(streamEvent('ai-stream-chunk', lastStreamId))).toBe(0);
    expect(getListenerCount(streamEvent('ai-stream-thinking-chunk', lastStreamId))).toBe(0);
    expect(getListenerCount(streamEvent('ai-stream-done', lastStreamId))).toBe(0);
    expect(getListenerCount(streamEvent('ai-tool-use', lastStreamId))).toBe(0);
    expect(getListenerCount(streamEvent('ai-citation', lastStreamId))).toBe(0);
    expect(getListenerCount(streamEvent('ai-tool-call', lastStreamId))).toBe(0);
    expect(getListenerCount(streamEvent('ai-tool-calls-done', lastStreamId))).toBe(0);
  });

  it('ignores stream events after cancel (#15)', async () => {
    // Stream that never auto-completes — we'll cancel manually
    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args); });

    const { result } = renderDirectApiChat();

    await act(async () => {
      void result.current.sendChatMessage('hello', []);
    });

    // Cancel immediately
    act(() => {
      result.current.cancelDirectChat();
    });

    // Now emit events — they should be ignored (cancelled flag)
    emitMockEvent(streamEvent('ai-stream-chunk', lastStreamId), 'late chunk');
    emitMockEvent(streamEvent('ai-stream-thinking-chunk', lastStreamId), 'late thinking');

    // All listeners should be cleaned up
    expect(getListenerCount(streamEvent('ai-stream-chunk', lastStreamId))).toBe(0);
    expect(getListenerCount(streamEvent('ai-stream-done', lastStreamId))).toBe(0);
  });

  it('ai-stream-done is registered atomically with other listeners (#9)', async () => {
    // Emit done synchronously inside ai_chat_stream to simulate race
    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args);
      emitMockEvent(streamEvent('ai-stream-done', lastStreamId), null);
    });

    const { result } = renderDirectApiChat();

    await act(async () => {
      await result.current.sendChatMessage('hello', []);
    });

    // Done fired synchronously with invoke — should still clean up
    expect(getListenerCount(streamEvent('ai-stream-chunk', lastStreamId))).toBe(0);
    expect(getListenerCount(streamEvent('ai-stream-done', lastStreamId))).toBe(0);
  });
});

describe('useDirectApiChat — error handling (#17)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ toolCallingEnabled: false, chatHistoryLimit: 0 });
    useSkillStore.setState({ skills: [], enabledOverrides: {}, agents: [], activeAgentName: 'general-assistant', agentEnabledOverrides: {} });
    useChatStore.getState().clearMessages();
    vi.mocked(invoke).mockClear();
  });

  it('sets isError on assistant message when stream fails', async () => {
    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args);
      throw new Error('Network timeout');
    });

    const { result } = renderDirectApiChat();

    await act(async () => {
      await result.current.sendChatMessage('hello', []);
    });

    const conv = useChatStore.getState().conversations[0];
    const assistantMsg = conv?.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.isError).toBe(true);
    expect(assistantMsg!.content).toBeTruthy();
  });
});

describe('useDirectApiChat — concurrent streams', () => {
  beforeEach(() => {
    useSettingsStore.setState({ toolCallingEnabled: false, chatHistoryLimit: 0 });
    useSkillStore.setState({ skills: [], enabledOverrides: {}, agents: [], activeAgentName: 'general-assistant', agentEnabledOverrides: {} });
    useChatStore.getState().clearMessages();
    vi.mocked(invoke).mockClear();
  });

  it('cancel then re-send cleans up first stream before starting second', async () => {
    // First stream that never auto-completes
    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args); });

    const { result } = renderDirectApiChat();

    // Send first message (will hang open)
    await act(async () => {
      await result.current.sendChatMessage('first message', []);
    });

    // Listeners should be active for the first stream
    expect(getListenerCount(streamEvent('ai-stream-chunk', lastStreamId))).toBeGreaterThan(0);

    // Cancel the first stream explicitly
    act(() => {
      result.current.cancelDirectChat();
    });

    // First stream's listeners should be cleaned up
    expect(getListenerCount(streamEvent('ai-stream-chunk', lastStreamId))).toBe(0);
    expect(getListenerCount(streamEvent('ai-stream-done', lastStreamId))).toBe(0);

    // Now send a second message with a completing stream
    const invokeCountBefore = vi.mocked(invoke).mock.calls.length;
    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args);
      emitMockEvent(streamEvent('ai-stream-done', lastStreamId), null);
    });

    await act(async () => {
      await result.current.sendChatMessage('second message', []);
    });

    // Verify invoke was actually called for the second message
    const invokeCountAfter = vi.mocked(invoke).mock.calls.length;
    expect(invokeCountAfter).toBeGreaterThan(invokeCountBefore);

    // Second stream also cleaned up after done (emitted synchronously)
    expect(getListenerCount(streamEvent('ai-stream-chunk', lastStreamId))).toBe(0);
    expect(getListenerCount(streamEvent('ai-stream-done', lastStreamId))).toBe(0);
  });

  it('two conversations stream concurrently without cross-contamination (task #3)', async () => {
    // Both streams hang open; capture each send's streamId in order.
    const streamIds: string[] = [];
    setMockInvokeHandler('ai_chat_stream', async (args) => { streamIds.push(sidOf(args)); });

    const { result } = renderDirectApiChat();
    const assistantTs = (convId: string): number =>
      useChatStore.getState().conversations.find((c) => c.id === convId)!
        .messages.find((m) => m.role === 'assistant')!.timestamp ?? 0;
    const textOf = (convId: string, ts: number) => {
      const msg = useChatStore.getState().conversations.find((c) => c.id === convId)!
        .messages.find((m) => m.timestamp === ts)!;
      return (msg.segments ?? []).filter((s) => s.type === 'text')
        .map((s) => (s as { content: string }).content).join('');
    };

    // Conversation A — send, then it becomes the BACKGROUND once B opens.
    const a = useChatStore.getState().createConversation({ title: 'A' });
    await act(async () => { await result.current.sendChatMessage('a-msg', []); });
    const aTs = assistantTs(a);

    // Conversation B — now the foreground.
    const b = useChatStore.getState().createConversation({ title: 'B' });
    await act(async () => { await result.current.sendChatMessage('b-msg', []); });
    const bTs = assistantTs(b);

    // Interleave chunks for both streams while B is foreground. A's chunk must
    // land on A's message (segments update synchronously), not on the active B.
    act(() => {
      emitMockEvent(streamEvent('ai-stream-chunk', streamIds[0]), 'alpha');
      emitMockEvent(streamEvent('ai-stream-chunk', streamIds[1]), 'beta');
      emitMockEvent(streamEvent('ai-stream-chunk', streamIds[0]), '-A');
      emitMockEvent(streamEvent('ai-stream-chunk', streamIds[1]), '-B');
    });

    expect(textOf(a, aTs)).toBe('alpha-A');
    expect(textOf(b, bTs)).toBe('beta-B');

    // Cancelling the foreground (B) leaves A's stream intact.
    act(() => { result.current.cancelDirectChat(b); });
    expect(getListenerCount(streamEvent('ai-stream-chunk', streamIds[0]))).toBeGreaterThan(0);
    expect(getListenerCount(streamEvent('ai-stream-chunk', streamIds[1]))).toBe(0);

    act(() => { result.current.cancelDirectChat(a); });
  });

  it('writes per-conversation run-state to session-run-store (task #4)', async () => {
    useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
    // Stream that completes on demand.
    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args); });

    const { result } = renderDirectApiChat();
    const a = useChatStore.getState().createConversation({ title: 'A' });

    await act(async () => { await result.current.sendChatMessage('hi', []); });
    // Running while the stream is open, with the direct path recorded.
    expect(useSessionRunStore.getState().runs[a]?.status).toBe('running');
    expect(useSessionRunStore.getState().runs[a]?.path).toBe('direct');
    expect(useSessionRunStore.getState().runs[a]?.streamId).toBe(lastStreamId);

    // Completion clears the run.
    act(() => { emitMockEvent(streamEvent('ai-stream-done', lastStreamId), null); });
    expect(useSessionRunStore.getState().runs[a]).toBeUndefined();
  });

  it('marks the run errored when the stream invoke rejects (task #4)', async () => {
    useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
    setMockInvokeHandler('ai_chat_stream', async () => { throw new Error('boom'); });

    const { result } = renderDirectApiChat();
    const a = useChatStore.getState().createConversation({ title: 'A' });

    await act(async () => { await result.current.sendChatMessage('hi', []); });
    expect(useSessionRunStore.getState().runs[a]?.status).toBe('error');
  });
});

describe('useDirectApiChat — abort mid-stream', () => {
  beforeEach(() => {
    useSettingsStore.setState({ toolCallingEnabled: false, chatHistoryLimit: 0 });
    useSkillStore.setState({ skills: [], enabledOverrides: {}, agents: [], activeAgentName: 'general-assistant', agentEnabledOverrides: {} });
    useChatStore.getState().clearMessages();
    vi.mocked(invoke).mockClear();
  });

  it('stops processing chunks after cancelDirectChat is called', async () => {
    // Stream that never auto-completes
    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args); });

    const { result } = renderDirectApiChat();

    await act(async () => {
      void result.current.sendChatMessage('hello', []);
    });

    // Emit a few chunks before cancelling
    act(() => {
      emitMockEvent(streamEvent('ai-stream-chunk', lastStreamId), 'chunk1 ');
      emitMockEvent(streamEvent('ai-stream-chunk', lastStreamId), 'chunk2 ');
    });

    // Cancel mid-stream
    act(() => {
      result.current.cancelDirectChat();
    });

    // All listeners should be cleaned up
    expect(getListenerCount(streamEvent('ai-stream-chunk', lastStreamId))).toBe(0);
    expect(getListenerCount(streamEvent('ai-stream-done', lastStreamId))).toBe(0);
    expect(getListenerCount(streamEvent('ai-stream-thinking-chunk', lastStreamId))).toBe(0);
    expect(getListenerCount(streamEvent('ai-tool-call', lastStreamId))).toBe(0);

    // Late chunks should be no-ops (no crash, no state update)
    act(() => {
      emitMockEvent(streamEvent('ai-stream-chunk', lastStreamId), 'late chunk after cancel');
    });
  });
});

describe('useDirectApiChat — approvalMode on activities (task #22)', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      toolCallingEnabled: true,
      chatHistoryLimit: 0,
      requireAllToolConfirmations: false,
    });
    useSkillStore.setState({ skills: [], enabledOverrides: {}, agents: [], activeAgentName: 'general-assistant', agentEnabledOverrides: {} });
    useChatStore.getState().clearMessages();
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
    vi.mocked(invoke).mockClear();

    // Mock web_search tool call emit + result
    setMockInvokeHandler('web_search', async () => [
      { title: 'r1', url: 'https://example.com', snippet: 's1' },
    ]);
  });

  it('tags an auto-allowed tool activity with approvalMode="auto"', async () => {
    // Stream that emits a single tool_call on the FIRST invoke only, then done
    // on the continuation invoke — otherwise handleToolCalls re-invokes forever.
    let invokeCount = 0;
    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args);
      invokeCount++;
      if (invokeCount === 1) {
        setTimeout(() => {
          emitMockEvent(streamEvent('ai-tool-call', lastStreamId), {
            id: 'call-1',
            name: 'web_search',
            arguments: { query: 'cats' },
          });
          emitMockEvent(streamEvent('ai-tool-calls-done', lastStreamId), null);
        }, 0);
      } else {
        // Continuation turn — just end the stream.
        setTimeout(() => emitMockEvent(streamEvent('ai-stream-done', lastStreamId), null), 0);
      }
    });

    const { result } = renderDirectApiChat();
    await act(async () => {
      await result.current.sendChatMessage('search for cats', []);
    });
    // Allow microtasks + permission-store promise resolution
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });

    const conv = useChatStore.getState().conversations[0];
    const assistantMsg = conv?.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    const toolActs = (assistantMsg!.activities ?? []).filter((a) => a.kind === 'tool_call');
    expect(toolActs.length).toBeGreaterThan(0);
    // Every auto-allowed activity row must be tagged 'auto'
    expect(toolActs.every((a) => a.approvalMode === 'auto')).toBe(true);
  });

  it('with requireAllToolConfirmations=true, previously auto-allowed tools hit the permission prompt', async () => {
    useSettingsStore.setState({ requireAllToolConfirmations: true });

    // The stream emits a single web_search tool_call. Because requireAllToolConfirmations
    // forces tier='none', the hook should await the permission promise — we detect this
    // by observing the pending state on useToolPermissionStore.
    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args);
      setTimeout(() => {
        emitMockEvent(streamEvent('ai-tool-call', lastStreamId), {
          id: 'call-1',
          name: 'web_search',
          arguments: { query: 'cats' },
        });
        emitMockEvent(streamEvent('ai-tool-calls-done', lastStreamId), null);
      }, 0);
    });

    const { result } = renderDirectApiChat();
    // Send without awaiting — pending permission never resolves in this test.
    await act(async () => {
      void result.current.sendChatMessage('search for cats', []);
    });
    // Allow the tool_call event and microtasks to settle so setPending fires.
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    // Per-conversation map (review #4) — exactly one request pending here.
    const pendingMap = useToolPermissionStore.getState().pending;
    const pending = Object.values(pendingMap)[0] ?? null;
    expect(pending).not.toBeNull();
    expect(pending!.name).toBe('web_search');

    // Clean up — cancel so the pending promise doesn't leak across tests.
    act(() => {
      result.current.cancelDirectChat();
    });
  });
});

describe('useDirectApiChat — network timeout error', () => {
  beforeEach(() => {
    useSettingsStore.setState({ toolCallingEnabled: false, chatHistoryLimit: 0 });
    useSkillStore.setState({ skills: [], enabledOverrides: {}, agents: [], activeAgentName: 'general-assistant', agentEnabledOverrides: {} });
    useChatStore.getState().clearMessages();
    vi.mocked(invoke).mockClear();
  });

  it('surfaces network timeout on assistant message with isError', async () => {
    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args);
      throw new Error('Network timeout');
    });

    const { result } = renderDirectApiChat();

    await act(async () => {
      await result.current.sendChatMessage('hello', []);
    });

    const conv = useChatStore.getState().conversations[0];
    const assistantMsg = conv?.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.isError).toBe(true);
    expect(assistantMsg!.content).toContain('Network timeout');

    // Listeners should be cleaned up even after error
    expect(getListenerCount(streamEvent('ai-stream-chunk', lastStreamId))).toBe(0);
    expect(getListenerCount(streamEvent('ai-stream-done', lastStreamId))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Regression lock — task #10 resend/edit dialog needs message.connectionId
//
// Without connectionId on USER messages (not just assistant messages), the
// ChatPanel resend dialog never fires because the mismatch check short-
// circuits on the legacy-compat branch. Discovered 2026-04-20 in user
// testing: resend of a Codex-era message from a local-AI session sent
// silently with no dialog.
// ---------------------------------------------------------------------------

describe('useDirectApiChat — stamps connectionId on user messages (#10)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ toolCallingEnabled: false, chatHistoryLimit: 0 });
    useSkillStore.setState({ skills: [], enabledOverrides: {}, agents: [], activeAgentName: 'general-assistant', agentEnabledOverrides: {} });
    useChatStore.getState().clearMessages();
    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args);
      setTimeout(() => emitMockEvent(streamEvent('ai-stream-done', lastStreamId), null), 0);
    });
  });

  it('stamps effectiveConnection.id on the user message', async () => {
    const { result } = renderHook(() =>
      useDirectApiChat({
        resolved: defaultResolved,
        effectiveConnection: {
          id: 'conn-openai-123',
          label: 'OpenAI',
          provider: 'openai',
          capabilities: ['interactive'],
        } as unknown as Parameters<typeof useDirectApiChat>[0]['effectiveConnection'],
        buildComposedSystemMessage: () => 'system',
        composedSystemMessage: 'system',
        localSystemMessage: 'local system',
      })
    );

    await act(async () => {
      await result.current.sendChatMessage('hello', []);
    });

    const conv = useChatStore.getState().conversations.find(
      (c) => c.id === useChatStore.getState().activeConversationId
    );
    const userMsg = conv?.messages.find((m) => m.role === 'user');
    expect(userMsg?.connectionId).toBe('conn-openai-123');
  });
});

describe('useDirectApiChat — attachment activity log (task #30)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ toolCallingEnabled: false, chatHistoryLimit: 0 });
    useSkillStore.setState({ skills: [], enabledOverrides: {}, agents: [], activeAgentName: 'general-assistant', agentEnabledOverrides: {} });
    useChatStore.getState().clearMessages();

    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args);
      setTimeout(() => emitMockEvent(streamEvent('ai-stream-done', lastStreamId), null), 0);
    });
    vi.mocked(invoke).mockClear();
  });

  it('logs one attachment activity per attachedFilePath on the user message', async () => {
    const { result } = renderDirectApiChat();

    await act(async () => {
      await result.current.sendChatMessage('hello', [], {
        attachedFilePaths: [
          '/workspace/project-A/notes.md',
          '/workspace/project-A/research.md',
        ],
      });
    });

    const conv = useChatStore.getState().conversations.find(
      (c) => c.id === useChatStore.getState().activeConversationId
    );
    const userMsg = conv?.messages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    const attachments = (userMsg!.activities ?? []).filter((a) => a.kind === 'attachment');
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      kind: 'attachment',
      label: 'notes.md',
      detail: '/workspace/project-A/notes.md',
      status: 'done',
    });
    expect(attachments[1]).toMatchObject({
      kind: 'attachment',
      label: 'research.md',
      detail: '/workspace/project-A/research.md',
      status: 'done',
    });
  });

  it('logs no attachments when attachedFilePaths is missing', async () => {
    const { result } = renderDirectApiChat();

    await act(async () => {
      await result.current.sendChatMessage('hello', []);
    });

    const conv = useChatStore.getState().conversations.find(
      (c) => c.id === useChatStore.getState().activeConversationId
    );
    const userMsg = conv?.messages.find((m) => m.role === 'user');
    expect(userMsg?.activities ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Deep-review batch1 finding #1 — Stop during a tool call must not spawn a
// zombie backend stream. `handleToolCalls` re-invoked `ai_chat_stream` after
// its awaits without checking the `cancelled` flag, and a pending tool-
// permission promise was orphaned by cleanup (a later click on the still-
// visible card resumed the loop and spawned an invisible provider stream).
// ---------------------------------------------------------------------------

describe('useDirectApiChat — cancel during tool loop (deep-review #1)', () => {
  const streamInvokeCount = () =>
    vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'ai_chat_stream').length;

  beforeEach(() => {
    useSettingsStore.setState({
      toolCallingEnabled: true,
      chatHistoryLimit: 0,
      requireAllToolConfirmations: false,
    });
    useSkillStore.setState({ skills: [], enabledOverrides: {}, agents: [], activeAgentName: 'general-assistant', agentEnabledOverrides: {} });
    useChatStore.getState().clearMessages();
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
    vi.mocked(invoke).mockClear();
  });

  it('cancel during a pending tool permission clears the request and blocks the continuation', async () => {
    // First invoke emits a write_file tool call (requires approval → the loop
    // blocks on the permission promise). Any continuation invoke would be the
    // zombie stream this test locks out. Intentionally does NOT touch the
    // shared `lastStreamId`: a stray done-emit timer leaked from a prior test
    // reads that global at fire time and would land on THIS stream's channel,
    // cancelling it mid-test (same flake the audit-C2 test documents).
    let sid = '';
    setMockInvokeHandler('ai_chat_stream', async (args) => { sid = sidOf(args);
      setTimeout(() => {
        emitMockEvent(streamEvent('ai-tool-call', sid), {
          id: 'call-1',
          name: 'write_file',
          arguments: { path: '/tmp/out.txt', content: 'x' },
        });
        emitMockEvent(streamEvent('ai-tool-calls-done', sid), null);
      }, 0);
    });

    const { result } = renderDirectApiChat();
    await act(async () => {
      void result.current.sendChatMessage('write a file', []);
    });
    // Let the tool_call event land and the permission card go pending.
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    const pendingMap = useToolPermissionStore.getState().pending;
    const pending = Object.values(pendingMap)[0] ?? null;
    expect(pending).not.toBeNull();
    // Capture the resolve as the orphaned card's click handler would hold it.
    const orphanedResolve = pending!.resolve;

    const invokesBeforeCancel = streamInvokeCount();
    expect(invokesBeforeCancel).toBe(1);

    act(() => {
      result.current.cancelDirectChat();
    });

    // Cancel must clear the pending permission (no dead card left behind).
    expect(Object.values(useToolPermissionStore.getState().pending)).toHaveLength(0);

    // A late click on the (formerly visible) card must NOT resume the loop —
    // cleanup already resolved the promise, so this is a settled-promise no-op.
    orphanedResolve('allow');
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    // No continuation ai_chat_stream (the zombie) and no tool execution.
    expect(streamInvokeCount()).toBe(invokesBeforeCancel);
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === 'write_file')).toBe(false);
  });

  it('cancel while a tool executes blocks the continuation invoke and finalizes segments', async () => {
    // Auto-allowed web_search whose execution we control — cancel lands while
    // `executeToolCall` is awaiting the backend.
    let resolveWebSearch: (v: unknown) => void = () => {};
    const webSearchPending = new Promise((resolve) => { resolveWebSearch = resolve; });
    setMockInvokeHandler('web_search', () => webSearchPending);
    // Local stream id — see the note in the previous test about the shared
    // `lastStreamId` flake.
    let sid = '';
    setMockInvokeHandler('ai_chat_stream', async (args) => { sid = sidOf(args);
      setTimeout(() => {
        emitMockEvent(streamEvent('ai-tool-call', sid), {
          id: 'call-1',
          name: 'web_search',
          arguments: { query: 'cats' },
        });
        emitMockEvent(streamEvent('ai-tool-calls-done', sid), null);
      }, 0);
    });

    const { result } = renderDirectApiChat();
    await act(async () => {
      void result.current.sendChatMessage('search for cats', []);
    });
    // Wait until the tool call is in flight (web_search invoked, unresolved).
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === 'web_search')).toBe(true);
    expect(streamInvokeCount()).toBe(1);

    act(() => {
      result.current.cancelDirectChat();
    });

    // The tool result arrives AFTER cancel — the loop must bail, not continue.
    resolveWebSearch([{ title: 'r1', url: 'https://example.com', snippet: 's1' }]);
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    expect(streamInvokeCount()).toBe(1);

    // The cancel path left the message in a sane final state — no tool_call
    // segment stuck in 'running' (cleanup's finalizeSegments handled it).
    const conv = useChatStore.getState().conversations[0];
    const assistantMsg = conv?.messages.find((m) => m.role === 'assistant');
    const runningToolSegs = (assistantMsg?.segments ?? []).filter(
      (s) => s.type === 'tool_call' && s.status === 'running',
    );
    expect(runningToolSegs).toHaveLength(0);
  });
});

describe('useDirectApiChat — backend cancel (audit C2)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ toolCallingEnabled: false, chatHistoryLimit: 0 });
    useSkillStore.setState({ skills: [], enabledOverrides: {}, agents: [], activeAgentName: 'general-assistant', agentEnabledOverrides: {} });
    useChatStore.getState().clearMessages();
    vi.mocked(invoke).mockClear();
  });

  it('cancelDirectChat invokes ai_chat_stream_cancel with the active streamId', async () => {
    // Stream stays open until cancelled. Intentionally does NOT touch the shared
    // lastStreamId: this test reads the id from the invoke args, and leaving the
    // global untouched means a stray `ai-stream-done` timer leaked from a prior
    // test can't land on THIS stream's channel and trip cleanup mid-test (the
    // CI flake this test originally hit).
    setMockInvokeHandler('ai_chat_stream', async () => {});
    setMockInvokeHandler('ai_chat_stream_cancel', async () => {});

    const { result } = renderDirectApiChat();

    await act(async () => {
      void result.current.sendChatMessage('hello', []);
    });

    // The streamId the hook generated and passed to ai_chat_stream.
    const streamCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'ai_chat_stream');
    const sid = (streamCall![1] as { streamId?: string }).streamId;
    expect(sid).toBeTruthy();

    act(() => {
      result.current.cancelDirectChat();
    });

    // Cancel must reach the backend with the SAME streamId so it aborts the
    // right in-flight stream (not just tear down frontend listeners).
    const cancelCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'ai_chat_stream_cancel');
    expect(cancelCall).toBeDefined();
    expect((cancelCall![1] as { streamId?: string }).streamId).toBe(sid);
  });
});


describe('useDirectApiChat — context compaction at the turn boundary', () => {
  // Trimming deletes the oldest rounds outright; compaction summarizes them
  // first so the agent keeps the narrative instead of rediscovering it. The
  // compaction call must happen at the START of a turn — never inside the tool
  // loop, which is mid-task and where compaction is known to do harm.

  /** History long enough that the budget forces a compaction. Passed to
   *  sendChatMessage directly — it takes prior turns as an argument. */
  function longHistory(rounds: number): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = 0; i < rounds; i++) {
      out.push({ role: 'user', content: `question ${i} ${'x'.repeat(3000)}`, timestamp: Date.now() + i * 2 } as ChatMessage);
      out.push({ role: 'assistant', content: `answer ${i} ${'y'.repeat(3000)}`, timestamp: Date.now() + i * 2 + 1 } as ChatMessage);
    }
    return out;
  }

  beforeEach(() => {
    useSettingsStore.setState({ toolCallingEnabled: false, chatHistoryLimit: 0 });
    useChatStore.getState().clearMessages();
    // A small window is what makes compaction necessary at all.
    useLocalAIStore.setState({ contextLength: 4096 });
    setMockInvokeHandler('ai_chat_stream', async (args) => { lastStreamId = sidOf(args);
      setTimeout(() => emitMockEvent(streamEvent('ai-stream-done', lastStreamId), null), 0);
    });
    setMockInvokeHandler('ai_chat', async () => 'Earlier: edited parser.ts; the null-deref was fixed.');
    vi.mocked(invoke).mockClear();
  });

  it('summarizes the overflow and sends the summary instead of dropping it', async () => {
    const { result } = renderDirectApiChat({ provider: 'local_bundled' });

    await act(async () => {
      await result.current.sendChatMessage('what did we decide?', longHistory(8));
    });

    const compactionCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'ai_chat');
    expect(compactionCall).toBeDefined();

    const streamCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'ai_chat_stream');
    const sent = (streamCall![1] as { messages: Array<{ role: string; content: string }> }).messages;
    // The summary survives as context the model can still see.
    expect(sent.some((m) => m.content?.includes('edited parser.ts'))).toBe(true);
  });

  it('does not compact a short conversation — that would spend a call for nothing', async () => {
    useChatStore.getState().clearMessages();
    const { result } = renderDirectApiChat({ provider: 'local_bundled' });

    await act(async () => {
      await result.current.sendChatMessage('hi', []);
    });

    expect(vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'ai_chat')).toBeUndefined();
  });

  it('leaves cloud providers alone — their windows do not need it', async () => {
    const { result } = renderDirectApiChat({ provider: 'anthropic' });

    await act(async () => {
      await result.current.sendChatMessage('what did we decide?', longHistory(8));
    });

    expect(vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'ai_chat')).toBeUndefined();
  });

  it('still sends the turn when the summarizer fails', async () => {
    // A failed summarization must degrade to a plain trim, never cost the turn.
    setMockInvokeHandler('ai_chat', async () => { throw new Error('model unavailable'); });
    const { result } = renderDirectApiChat({ provider: 'local_bundled' });

    await act(async () => {
      await result.current.sendChatMessage('what did we decide?', longHistory(8));
    });

    const streamCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'ai_chat_stream');
    expect(streamCall).toBeDefined();
  });
});
