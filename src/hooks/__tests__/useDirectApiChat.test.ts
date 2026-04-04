// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, emitMockEvent, getListenerCount } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useDirectApiChat } from '@/hooks/useDirectApiChat';
import { useSettingsStore } from '@/stores/settings-store';
import { useSkillStore } from '@/stores/skill-store';
import { useChatStore } from '@/stores/chat-store';
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
    // 6 built-in tools always present
    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.name)).toContain('read_file');
    expect(tools.map((t) => t.name)).toContain('write_file');
    expect(tools.map((t) => t.name)).toContain('read_skill_content');
    expect(tools.map((t) => t.name)).toContain('execute_skill_script');
    expect(tools.map((t) => t.name)).toContain('list_directory');
    expect(tools.map((t) => t.name)).toContain('web_search');
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

  it('filters tools by active agent allowed_tools', async () => {
    useSkillStore.setState({
      skills: [],
      agents: [
        {
          name: 'restricted-agent',
          description: 'An agent with restricted tools',
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
    // Only the allowed tool
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('read_file');
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
