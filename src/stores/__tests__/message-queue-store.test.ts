import { describe, it, expect, beforeEach } from 'vitest';
import {
  useMessageQueueStore,
  selectQueuedMessages,
} from '@/stores/message-queue-store';

describe('message-queue-store', () => {
  beforeEach(() => {
    useMessageQueueStore.setState({ queues: {} });
  });

  it('enqueues FIFO per conversation and dequeues oldest first', () => {
    const store = useMessageQueueStore.getState();
    store.enqueue('conv-A', { content: 'first' });
    store.enqueue('conv-A', { content: 'second' });
    store.enqueue('conv-B', { content: 'other-conv' });

    expect(selectQueuedMessages(useMessageQueueStore.getState(), 'conv-A').map((m) => m.content))
      .toEqual(['first', 'second']);

    const next = useMessageQueueStore.getState().dequeueNext('conv-A');
    expect(next?.content).toBe('first');
    expect(selectQueuedMessages(useMessageQueueStore.getState(), 'conv-A').map((m) => m.content))
      .toEqual(['second']);
    // Other conversation's queue untouched.
    expect(selectQueuedMessages(useMessageQueueStore.getState(), 'conv-B')).toHaveLength(1);
  });

  it('dequeueNext returns undefined for an empty or unknown queue', () => {
    expect(useMessageQueueStore.getState().dequeueNext('conv-none')).toBeUndefined();
  });

  it('preserves send opts through the queue', () => {
    const opts = { displayContent: '/summarize doc', skillName: 'summarize' };
    useMessageQueueStore.getState().enqueue('conv-A', { content: 'expanded body', opts });
    const next = useMessageQueueStore.getState().dequeueNext('conv-A');
    expect(next?.opts).toEqual(opts);
  });

  it('removeQueued drops a single entry by id', () => {
    const store = useMessageQueueStore.getState();
    const id1 = store.enqueue('conv-A', { content: 'keep-me-not' });
    store.enqueue('conv-A', { content: 'keep-me' });

    useMessageQueueStore.getState().removeQueued('conv-A', id1);
    const remaining = selectQueuedMessages(useMessageQueueStore.getState(), 'conv-A');
    expect(remaining.map((m) => m.content)).toEqual(['keep-me']);

    // Unknown id / conversation is a no-op.
    const before = useMessageQueueStore.getState().queues;
    useMessageQueueStore.getState().removeQueued('conv-A', 'nope');
    useMessageQueueStore.getState().removeQueued('conv-Z', 'nope');
    expect(useMessageQueueStore.getState().queues).toBe(before);
  });

  it('clearQueue removes the whole queue and returns the removed messages', () => {
    const store = useMessageQueueStore.getState();
    store.enqueue('conv-A', { content: 'one' });
    store.enqueue('conv-A', { content: 'two' });

    const drained = useMessageQueueStore.getState().clearQueue('conv-A');
    expect(drained.map((m) => m.content)).toEqual(['one', 'two']);
    expect(selectQueuedMessages(useMessageQueueStore.getState(), 'conv-A')).toHaveLength(0);
    expect(useMessageQueueStore.getState().queues['conv-A']).toBeUndefined();

    // Clearing an empty queue returns [] without a state write.
    const before = useMessageQueueStore.getState().queues;
    expect(useMessageQueueStore.getState().clearQueue('conv-A')).toEqual([]);
    expect(useMessageQueueStore.getState().queues).toBe(before);
  });

  it('selectQueuedMessages returns a stable empty reference', () => {
    const a = selectQueuedMessages(useMessageQueueStore.getState(), 'conv-A');
    const b = selectQueuedMessages(useMessageQueueStore.getState(), null);
    expect(a).toBe(b);
    expect(a).toEqual([]);
  });
});
