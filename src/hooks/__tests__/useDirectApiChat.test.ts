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
import type { ResolvedCredentials } from '@/lib/ai/credentials';

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

    setMockInvokeHandler('ai_chat_stream', async () => {
      setTimeout(() => emitMockEvent('ai-stream-done', null), 0);
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
    setMockInvokeHandler('ai_chat_stream', async () => {
      setTimeout(() => emitMockEvent('ai-stream-done', null), 0);
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
    expect(getListenerCount('ai-stream-chunk')).toBe(0);
    expect(getListenerCount('ai-stream-thinking-chunk')).toBe(0);
    expect(getListenerCount('ai-stream-done')).toBe(0);
    expect(getListenerCount('ai-tool-use')).toBe(0);
    expect(getListenerCount('ai-citation')).toBe(0);
    expect(getListenerCount('ai-tool-call')).toBe(0);
    expect(getListenerCount('ai-tool-calls-done')).toBe(0);
  });

  it('ignores stream events after cancel (#15)', async () => {
    // Stream that never auto-completes — we'll cancel manually
    setMockInvokeHandler('ai_chat_stream', async () => {});

    const { result } = renderDirectApiChat();

    await act(async () => {
      void result.current.sendChatMessage('hello', []);
    });

    // Cancel immediately
    act(() => {
      result.current.cancelDirectChat();
    });

    // Now emit events — they should be ignored (cancelled flag)
    emitMockEvent('ai-stream-chunk', 'late chunk');
    emitMockEvent('ai-stream-thinking-chunk', 'late thinking');

    // All listeners should be cleaned up
    expect(getListenerCount('ai-stream-chunk')).toBe(0);
    expect(getListenerCount('ai-stream-done')).toBe(0);
  });

  it('ai-stream-done is registered atomically with other listeners (#9)', async () => {
    // Emit done synchronously inside ai_chat_stream to simulate race
    setMockInvokeHandler('ai_chat_stream', async () => {
      emitMockEvent('ai-stream-done', null);
    });

    const { result } = renderDirectApiChat();

    await act(async () => {
      await result.current.sendChatMessage('hello', []);
    });

    // Done fired synchronously with invoke — should still clean up
    expect(getListenerCount('ai-stream-chunk')).toBe(0);
    expect(getListenerCount('ai-stream-done')).toBe(0);
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
    setMockInvokeHandler('ai_chat_stream', async () => {
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
    setMockInvokeHandler('ai_chat_stream', async () => {});

    const { result } = renderDirectApiChat();

    // Send first message (will hang open)
    await act(async () => {
      await result.current.sendChatMessage('first message', []);
    });

    // Listeners should be active for the first stream
    expect(getListenerCount('ai-stream-chunk')).toBeGreaterThan(0);

    // Cancel the first stream explicitly
    act(() => {
      result.current.cancelDirectChat();
    });

    // First stream's listeners should be cleaned up
    expect(getListenerCount('ai-stream-chunk')).toBe(0);
    expect(getListenerCount('ai-stream-done')).toBe(0);

    // Now send a second message with a completing stream
    const invokeCountBefore = vi.mocked(invoke).mock.calls.length;
    setMockInvokeHandler('ai_chat_stream', async () => {
      emitMockEvent('ai-stream-done', null);
    });

    await act(async () => {
      await result.current.sendChatMessage('second message', []);
    });

    // Verify invoke was actually called for the second message
    const invokeCountAfter = vi.mocked(invoke).mock.calls.length;
    expect(invokeCountAfter).toBeGreaterThan(invokeCountBefore);

    // Second stream also cleaned up after done (emitted synchronously)
    expect(getListenerCount('ai-stream-chunk')).toBe(0);
    expect(getListenerCount('ai-stream-done')).toBe(0);
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
    setMockInvokeHandler('ai_chat_stream', async () => {});

    const { result } = renderDirectApiChat();

    await act(async () => {
      void result.current.sendChatMessage('hello', []);
    });

    // Emit a few chunks before cancelling
    act(() => {
      emitMockEvent('ai-stream-chunk', 'chunk1 ');
      emitMockEvent('ai-stream-chunk', 'chunk2 ');
    });

    // Cancel mid-stream
    act(() => {
      result.current.cancelDirectChat();
    });

    // All listeners should be cleaned up
    expect(getListenerCount('ai-stream-chunk')).toBe(0);
    expect(getListenerCount('ai-stream-done')).toBe(0);
    expect(getListenerCount('ai-stream-thinking-chunk')).toBe(0);
    expect(getListenerCount('ai-tool-call')).toBe(0);

    // Late chunks should be no-ops (no crash, no state update)
    act(() => {
      emitMockEvent('ai-stream-chunk', 'late chunk after cancel');
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
    useToolPermissionStore.getState().setPending(null);
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
    setMockInvokeHandler('ai_chat_stream', async () => {
      invokeCount++;
      if (invokeCount === 1) {
        setTimeout(() => {
          emitMockEvent('ai-tool-call', {
            id: 'call-1',
            name: 'web_search',
            arguments: { query: 'cats' },
          });
          emitMockEvent('ai-tool-calls-done', null);
        }, 0);
      } else {
        // Continuation turn — just end the stream.
        setTimeout(() => emitMockEvent('ai-stream-done', null), 0);
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
    setMockInvokeHandler('ai_chat_stream', async () => {
      setTimeout(() => {
        emitMockEvent('ai-tool-call', {
          id: 'call-1',
          name: 'web_search',
          arguments: { query: 'cats' },
        });
        emitMockEvent('ai-tool-calls-done', null);
      }, 0);
    });

    const { result } = renderDirectApiChat();
    // Send without awaiting — pending permission never resolves in this test.
    await act(async () => {
      void result.current.sendChatMessage('search for cats', []);
    });
    // Allow the tool_call event and microtasks to settle so setPending fires.
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    const pending = useToolPermissionStore.getState().pending;
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
    setMockInvokeHandler('ai_chat_stream', async () => {
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
    expect(getListenerCount('ai-stream-chunk')).toBe(0);
    expect(getListenerCount('ai-stream-done')).toBe(0);
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
    setMockInvokeHandler('ai_chat_stream', async () => {
      setTimeout(() => emitMockEvent('ai-stream-done', null), 0);
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

    setMockInvokeHandler('ai_chat_stream', async () => {
      setTimeout(() => emitMockEvent('ai-stream-done', null), 0);
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
