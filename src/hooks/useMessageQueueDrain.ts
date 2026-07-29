import { useEffect, useRef } from 'react';
import {
  useChatStore,
  selectMessages,
  selectPendingProjectSwitch,
  selectPendingAgentSwitch,
} from '@/stores/chat-store';
import { useSessionRunStore, selectIsInFlight } from '@/stores/session-run-store';
import { useMessageQueueStore, type QueuedSendOpts } from '@/stores/message-queue-store';
import { isSendQueued } from '@/lib/ai/session-run';
import type { ChatMessage } from '@/lib/ai/types';

/**
 * Drain side of message queueing (queue-during-agent-work). Counterpart of the
 * enqueue in `useAIOperations.sendChatMessage`: messages sent while a
 * conversation's run was in flight are parked in `message-queue-store`; this
 * hook dispatches them — one at a time, FIFO — once the run reaches a terminal
 * state.
 *
 * Mounted from `FloatingCommandBar` (always-mounted in QuietLayout), which owns
 * the `sendChatMessage` pipeline the dispatch reuses — so a queued message gets
 * provider routing, lock enforcement, the concurrency cap, and streaming
 * exactly like a hand-typed send.
 *
 * Dispatch rules:
 *  - Only the FOREGROUND conversation drains. The send pipeline appends to the
 *    active conversation, so auto-dispatching a backgrounded queue would either
 *    land messages in the wrong chat or yank the user's view. A backgrounded
 *    conversation's queue drains when the user switches back to it (the
 *    active-conversation subscription below).
 *  - One message per idle transition: the dispatched send flips the run back
 *    to in-flight synchronously, so the next queued message waits for THAT run
 *    to finish — preserving turn-by-turn conversation order.
 *  - Never while a provider/project switch prompt is pending — manual sends
 *    are disabled for the same reason (racing the resolver could land the
 *    message on the wrong segment).
 */

type SendChatFn = (
  content: string,
  messages: ChatMessage[],
  opts?: QueuedSendOpts,
) => Promise<unknown> | unknown;

/**
 * Attempt to dispatch the next queued message for the foreground conversation.
 * Exported for unit tests; production use goes through `useMessageQueueDrain`.
 */
export function tryDrainMessageQueue(send: SendChatFn): void {
  const chatState = useChatStore.getState();
  const conversationId = chatState.activeConversationId;
  if (!conversationId) return;
  if (selectPendingProjectSwitch(chatState) || selectPendingAgentSwitch(chatState)) return;
  if (selectIsInFlight(useSessionRunStore.getState(), conversationId)) return;
  if (isSendQueued(conversationId)) return;

  const next = useMessageQueueStore.getState().dequeueNext(conversationId);
  if (!next) return;

  // Recompute the thread NOW — the run that just finished appended its
  // user/assistant messages after this one was queued, and the queued send
  // must include them as history.
  const messages = selectMessages(useChatStore.getState());
  // Errors surface through the send pipeline's own toast/message handling —
  // swallow the rejection here so a failed dispatch can't become an unhandled
  // promise rejection.
  void Promise.resolve(send(next.content, messages, next.opts)).catch(() => {});
}

export function useMessageQueueDrain(sendChatMessage: SendChatFn): void {
  // Ref so the subscriptions are installed once but always dispatch through
  // the latest send callback (it re-materializes on routing/store changes).
  const sendRef = useRef(sendChatMessage);
  sendRef.current = sendChatMessage;

  useEffect(() => {
    const drain = () =>
      tryDrainMessageQueue((content, messages, opts) => sendRef.current(content, messages, opts));

    // A run finishing (or being cancelled) frees the conversation → drain.
    const unsubRuns = useSessionRunStore.subscribe(drain);
    // Switching to a conversation with a parked queue (or a switch prompt
    // resolving) can also unblock a drain.
    const unsubChat = useChatStore.subscribe((state, prev) => {
      if (
        state.activeConversationId !== prev.activeConversationId ||
        selectPendingProjectSwitch(state) !== selectPendingProjectSwitch(prev) ||
        selectPendingAgentSwitch(state) !== selectPendingAgentSwitch(prev)
      ) {
        drain();
      }
    });
    drain(); // anything already drainable at mount
    return () => {
      unsubRuns();
      unsubChat();
    };
  }, []);
}
