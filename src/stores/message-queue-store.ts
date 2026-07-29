import { create } from 'zustand';
import type { ImageAttachment } from '@/lib/ai/types';

/**
 * Message-queue store — per-conversation FIFO of user messages sent while
 * that conversation's AI run was still in flight.
 *
 * Before this store existed, sending into a conversation with an active run
 * INTERRUPTED the ongoing work: both streaming paths tear down the previous
 * same-conversation stream on send (`streamsRef…cleanup()` in
 * `useDirectApiChat`, `runConvCleanup` in `useAcpLifecycle`). Now
 * `useAIOperations.sendChatMessage` parks the message here instead and
 * `useMessageQueueDrain` dispatches it — with a freshly recomputed thread —
 * once the run reaches a terminal state.
 *
 * Deliberately NOT persisted: a run that was in flight when the app closed is
 * marked `error` on rehydrate (see `session-run-store`), and auto-firing a
 * stale follow-up against that dead context on next launch would be worse
 * than losing the draft. Mirrors the transient-handles rationale there.
 */

/** The opts a queued send carries through to `sendChatMessage` at dispatch. */
export interface QueuedSendOpts {
  displayContent?: string;
  skillName?: string;
  attachedFilePaths?: string[];
  sandboxPaths?: string[];
  parentId?: string | null;
  attachments?: ImageAttachment[];
}

export interface QueuedMessage {
  id: string;
  conversationId: string;
  /** Fully expanded content (post `@agent` / `/skill` expansion) ready to send. */
  content: string;
  opts?: QueuedSendOpts;
  queuedAt: number;
}

interface MessageQueueStore {
  /** FIFO queues keyed by conversation id. Absent key ⇔ empty queue. */
  queues: Record<string, QueuedMessage[]>;

  /** Append a message to a conversation's queue. Returns the queued id. */
  enqueue: (
    conversationId: string,
    message: { content: string; opts?: QueuedSendOpts },
  ) => string;
  /** Pop the oldest queued message for a conversation (undefined when empty). */
  dequeueNext: (conversationId: string) => QueuedMessage | undefined;
  /** Remove one queued message by id (the strip's × button). */
  removeQueued: (conversationId: string, id: string) => void;
  /** Drop a conversation's whole queue, returning what was removed so the
   *  caller can restore the text (Stop drains the queue into the composer). */
  clearQueue: (conversationId: string) => QueuedMessage[];
}

export const useMessageQueueStore = create<MessageQueueStore>()((set, get) => ({
  queues: {},

  enqueue: (conversationId, message) => {
    const queued: QueuedMessage = {
      id: crypto.randomUUID(),
      conversationId,
      content: message.content,
      opts: message.opts,
      queuedAt: Date.now(),
    };
    set((s) => ({
      queues: {
        ...s.queues,
        [conversationId]: [...(s.queues[conversationId] ?? []), queued],
      },
    }));
    return queued.id;
  },

  dequeueNext: (conversationId) => {
    const queue = get().queues[conversationId];
    if (!queue || queue.length === 0) return undefined;
    const [next, ...rest] = queue;
    set((s) => {
      const queues = { ...s.queues };
      if (rest.length > 0) queues[conversationId] = rest;
      else delete queues[conversationId];
      return { queues };
    });
    return next;
  },

  removeQueued: (conversationId, id) =>
    set((s) => {
      const queue = s.queues[conversationId];
      if (!queue) return s;
      const rest = queue.filter((m) => m.id !== id);
      if (rest.length === queue.length) return s;
      const queues = { ...s.queues };
      if (rest.length > 0) queues[conversationId] = rest;
      else delete queues[conversationId];
      return { queues };
    }),

  clearQueue: (conversationId) => {
    const queue = get().queues[conversationId] ?? [];
    if (queue.length > 0) {
      set((s) => {
        const queues = { ...s.queues };
        delete queues[conversationId];
        return { queues };
      });
    }
    return queue;
  },
}));

// ---------------------------------------------------------------------------
// Pure selectors — usable with the live store or a plain state object in tests.
// ---------------------------------------------------------------------------

const EMPTY_QUEUE: QueuedMessage[] = [];

/** Queued messages for a conversation; stable empty reference when none. */
export function selectQueuedMessages(
  state: Pick<MessageQueueStore, 'queues'>,
  conversationId: string | null | undefined,
): QueuedMessage[] {
  if (!conversationId) return EMPTY_QUEUE;
  return state.queues[conversationId] ?? EMPTY_QUEUE;
}
