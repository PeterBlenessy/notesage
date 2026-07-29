// @vitest-environment jsdom
//
// Drain side of message queueing (queue-during-agent-work): messages sent
// while a conversation's run was in flight are parked in `message-queue-store`
// (enqueue tested in useAIOperations.test.ts); this file verifies the
// always-mounted drain dispatches them at the right moments — run end,
// conversation foregrounding, switch-prompt resolution — with a FRESH thread.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useChatStore } from '@/stores/chat-store';
import { useSessionRunStore } from '@/stores/session-run-store';
import { useMessageQueueStore } from '@/stores/message-queue-store';
import { __resetSendQueue } from '@/lib/ai/session-run';
import { useMessageQueueDrain } from '@/hooks/useMessageQueueDrain';
import type { ChatMessage } from '@/lib/ai/types';

type ConvSeed = {
  id: string;
  messages?: ChatMessage[];
  pendingAgentSwitch?: { newAgent: string; previousAgent: string | null } | null;
};

function seedConversations(convs: ConvSeed[], active: string | null) {
  useChatStore.setState({
    conversations: convs.map((c) => ({
      id: c.id,
      title: '',
      messages: c.messages ?? [],
      createdAt: 0,
      updatedAt: 1,
      projectPaths: [],
      segments: [],
      activeSegmentIndex: 0,
      activeLeafId: null,
      pendingAgentSwitch: c.pendingAgentSwitch ?? null,
    })) as never,
    activeConversationId: active,
  });
}

describe('useMessageQueueDrain', () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockClear();
    useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
    useMessageQueueStore.setState({ queues: {} });
    __resetSendQueue();
  });

  it('holds while the run is in flight, then dispatches with a fresh thread when it ends', () => {
    seedConversations(
      [{ id: 'A', messages: [{ role: 'user', content: 'earlier', timestamp: 1 }] }],
      'A',
    );
    useSessionRunStore.getState().setRun('A', { status: 'running' });
    const opts = { displayContent: 'queued (display)' };
    useMessageQueueStore.getState().enqueue('A', { content: 'queued follow-up', opts });

    renderHook(() => useMessageQueueDrain(send));
    expect(send).not.toHaveBeenCalled();

    // The finishing run appends its assistant message, THEN the run clears —
    // the dispatched send must include the newly appended history.
    act(() => {
      const conv = useChatStore.getState().conversations[0];
      useChatStore.setState({
        conversations: [{
          ...conv,
          messages: [...conv.messages, { role: 'assistant', content: 'run result', timestamp: 2 }],
          updatedAt: 2,
        }] as never,
      });
      useSessionRunStore.getState().clearRun('A');
    });

    expect(send).toHaveBeenCalledTimes(1);
    const [content, messages, sentOpts] = send.mock.calls[0];
    expect(content).toBe('queued follow-up');
    expect((messages as ChatMessage[]).map((m) => m.content)).toEqual(['earlier', 'run result']);
    expect(sentOpts).toEqual(opts);
    // Dispatched message left the queue.
    expect(useMessageQueueStore.getState().queues['A']).toBeUndefined();
  });

  it('dispatches one message per idle transition, preserving FIFO order', () => {
    seedConversations([{ id: 'A' }], 'A');
    useSessionRunStore.getState().setRun('A', { status: 'running' });
    useMessageQueueStore.getState().enqueue('A', { content: 'first' });
    useMessageQueueStore.getState().enqueue('A', { content: 'second' });

    renderHook(() => useMessageQueueDrain(send));

    act(() => {
      useSessionRunStore.getState().clearRun('A');
    });
    // Only the first dispatches — the second waits for the run it starts.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('first');

    // The dispatched send's run goes in flight, then finishes → second fires.
    act(() => {
      useSessionRunStore.getState().setRun('A', { status: 'running' });
    });
    expect(send).toHaveBeenCalledTimes(1);
    act(() => {
      useSessionRunStore.getState().clearRun('A');
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toBe('second');
  });

  it('does not dispatch a backgrounded conversation until it is foregrounded', () => {
    seedConversations([{ id: 'A' }, { id: 'B' }], 'A');
    useMessageQueueStore.getState().enqueue('B', { content: 'for B' });

    renderHook(() => useMessageQueueDrain(send));
    // B is idle but backgrounded — its queue waits (the send pipeline appends
    // to the ACTIVE conversation, so a background dispatch would misroute).
    expect(send).not.toHaveBeenCalled();

    act(() => {
      useChatStore.setState({ activeConversationId: 'B' });
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('for B');
  });

  it('holds while a provider-switch prompt is pending, dispatches when it resolves', () => {
    seedConversations(
      [{ id: 'A', pendingAgentSwitch: { newAgent: 'conn-new', previousAgent: 'conn-old' } }],
      'A',
    );
    useMessageQueueStore.getState().enqueue('A', { content: 'blocked by prompt' });

    renderHook(() => useMessageQueueDrain(send));
    expect(send).not.toHaveBeenCalled();

    act(() => {
      const conv = useChatStore.getState().conversations[0];
      useChatStore.setState({
        conversations: [{ ...conv, pendingAgentSwitch: null }] as never,
      });
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('blocked by prompt');
  });

  it('does not dispatch anything when the queue is empty at run end', () => {
    seedConversations([{ id: 'A' }], 'A');
    useSessionRunStore.getState().setRun('A', { status: 'running' });
    renderHook(() => useMessageQueueDrain(send));
    act(() => {
      useSessionRunStore.getState().clearRun('A');
    });
    expect(send).not.toHaveBeenCalled();
  });
});
