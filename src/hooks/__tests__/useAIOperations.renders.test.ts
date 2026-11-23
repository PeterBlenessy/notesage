// @vitest-environment jsdom
/**
 * Regression test for audit 2026-11-22 §3 (HIGH): `useAIOperations` must not
 * subscribe its caller to the whole chat store.
 *
 * `useAcpLifecycle`, `useDirectApiChat` and `useCopilotChat` each destructured
 * their actions from a bare `useChatStore()`, and `useAIOperations` did the
 * same with `useAIStore()`. The chat store is written once per streamed chunk,
 * so every component calling `useAIOperations()` — Editor, the command bar,
 * both bubble menus — re-rendered once per token.
 *
 * Runs the REAL sub-hooks (nothing here is mocked but the logger): the
 * subscriptions under test live inside them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { registerDefaultHandlers } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useAIOperations } from '@/hooks/useAIOperations';
import { useAcpLifecycle } from '@/hooks/useAcpLifecycle';
import { useDirectApiChat } from '@/hooks/useDirectApiChat';
import { useCopilotChat } from '@/hooks/useCopilotChat';
import { useChatStore, type Conversation } from '@/stores/chat-store';
import { useAIStore } from '@/stores/ai-store';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), perf: vi.fn() },
}));

const ASSISTANT_TS = 1_000_001;

function makeConv(id: string): Conversation {
  const now = Date.now();
  return {
    id,
    title: id,
    messages: [
      { id: `${id}-u`, role: 'user', content: 'hi', timestamp: 1_000_000, parentId: null },
      { id: `${id}-a`, role: 'assistant', content: '', timestamp: ASSISTANT_TS, parentId: `${id}-u` },
    ],
    createdAt: now,
    updatedAt: now,
    projectPaths: [],
    segments: [{ projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false }],
    activeSegmentIndex: 0,
    pendingProjectSwitch: null,
    activeLeafId: `${id}-a`,
  };
}

/** What a streaming turn does to the chat store, in the foreground conversation
 *  and in a background one. */
function streamTokens(): void {
  const chat = useChatStore.getState();
  chat.setLoading(true);
  for (const convId of ['conv-fg', 'conv-bg']) {
    for (let i = 0; i < 20; i++) {
      chat.appendTextSegment(ASSISTANT_TS, `tok${i} `, convId);
    }
    chat.pushSegment(
      ASSISTANT_TS,
      { type: 'tool_call', kind: 'read', label: 'Read file', status: 'running', timestamp: Date.now() },
      convId,
    );
    chat.updateMessage(ASSISTANT_TS, 'streamed so far', undefined, convId);
  }
  chat.setActiveTool('read');
  chat.setActiveTool(null);
  chat.setLoading(false);
}

function assistantSegmentCount(convId: string): number {
  const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
  return conv?.messages.find((m) => m.timestamp === ASSISTANT_TS)?.segments?.length ?? 0;
}

/** Render `useHook` behind a render counter and settle its mount effects. */
async function renderCounted(useHook: () => unknown): Promise<{ renders: () => number }> {
  let count = 0;
  renderHook(() => {
    count++;
    return useHook();
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { renders: () => count };
}

describe('chat-store writes do not re-render useAIOperations callers', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    useAIStore.setState({ provider: null });
    useChatStore.setState({
      conversations: [makeConv('conv-fg'), makeConv('conv-bg')],
      activeConversationId: 'conv-fg',
      isLoading: false,
      activeTool: null,
    });
  });

  const subHookParams = {
    effectiveConnection: null,
    buildComposedSystemMessage: () => 'system',
    composedSystemMessage: 'system',
  };

  const cases: Array<[string, () => unknown]> = [
    ['useAIOperations', () => useAIOperations()],
    [
      'useAcpLifecycle',
      () => useAcpLifecycle({ effectiveConnection: null, acpSystemMessage: 'system' }),
    ],
    [
      'useDirectApiChat',
      () => useDirectApiChat({ ...subHookParams, resolved: null, localSystemMessage: 'system' }),
    ],
    ['useCopilotChat', () => useCopilotChat(subHookParams)],
  ];

  it.each(cases)('%s: streaming segments into the store renders nothing', async (_name, useHook) => {
    const { renders } = await renderCounted(useHook);
    const before = renders();

    act(() => {
      streamTokens();
    });

    // The writes really happened …
    expect(assistantSegmentCount('conv-fg')).toBeGreaterThan(0);
    expect(assistantSegmentCount('conv-bg')).toBeGreaterThan(0);
    // … and the hook's host did not render for any of them.
    expect(renders()).toBe(before);
  });

  it('useAIOperations: unrelated ai-store writes render nothing', async () => {
    const { renders } = await renderCounted(() => useAIOperations());
    const before = renders();

    act(() => {
      useAIStore.setState({ customPrompts: [] });
      useAIStore.setState({ activePersonaId: 'another-persona' });
    });

    expect(renders()).toBe(before);
  });

  it('useAIOperations: still re-renders for state it genuinely depends on', async () => {
    const { renders } = await renderCounted(() => useAIOperations());
    const before = renders();

    // The provider feeds credential resolution; the active conversation's
    // project selection feeds the project-lock check and the system prompt.
    act(() => {
      useAIStore.setState({ provider: 'openai' });
    });
    expect(renders()).toBeGreaterThan(before);

    const afterProvider = renders();
    act(() => {
      useChatStore.getState().setSelectedProjectPaths(['/workspace/project-a']);
    });
    expect(renders()).toBeGreaterThan(afterProvider);
  });
});
