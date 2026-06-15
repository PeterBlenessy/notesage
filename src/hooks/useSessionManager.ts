import { useEffect } from 'react';
import { useChatStore } from '@/stores/chat-store';
import { useSessionRunStore, ACTIVE_STATUSES } from '@/stores/session-run-store';

/**
 * Whether the WATCHED (foreground) conversation is actively streaming —
 * `running` or `awaiting_permission`. Replaces the global `chat-store.isLoading`
 * for the foreground-conversation views (command bar, message list) so that
 * switching to an idle conversation while another streams in the background no
 * longer shows a stray "loading" state (task #4). Reads per-conversation run
 * state, so it's correct under concurrency.
 */
export function useForegroundLoading(): boolean {
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  return useSessionRunStore((s) => {
    const status = activeConversationId ? s.runs[activeConversationId]?.status : undefined;
    return status !== undefined && ACTIVE_STATUSES.includes(status);
  });
}

/**
 * Always-mounted owner of cross-conversation session run-state (PRD
 * `2026-06-14-command-bar-session-multitasking`, task #4).
 *
 * The streaming hooks (`useDirectApiChat`, `useAcpLifecycle`) write each
 * conversation's run status into `session-run-store` keyed by conversation id,
 * independently of the command-bar view. This hook, mounted at the `App.tsx`
 * root (per the "mount lifecycle hooks in App.tsx" rule), owns the two pieces of
 * bookkeeping that belong to the app shell rather than to any one send:
 *
 *  1. **Foreground tracking** — mirrors `chat-store.activeConversationId` into
 *     `session-run-store.foregroundConversationId` so the orb's "running and
 *     unwatched" set (#12) and the foreground-aware permission timeout (#7) know
 *     which session the user is currently watching.
 *  2. **Orphan pruning** — drops run entries for conversations that no longer
 *     exist (deleted from history), keeping the store from accumulating stale
 *     rows. Runs are otherwise long-lived (they survive view changes by design).
 *
 * It deliberately does NOT own the streaming itself: `FloatingCommandBar` stays
 * always-mounted in `QuietLayout`, so the listeners already survive collapse /
 * Settings / conversation switch. This hook makes the *state* view-independent.
 */
export function useSessionManager(): void {
  const activeConversationId = useChatStore((s) => s.activeConversationId);

  // 1. Keep the foreground pointer in sync with the watched conversation.
  useEffect(() => {
    useSessionRunStore.getState().setForeground(activeConversationId);
  }, [activeConversationId]);

  // 2. Prune run entries whose conversation has been deleted. Subscribe to the
  //    chat store directly (not via a render selector) so a delete anywhere
  //    reconciles without coupling this hook to conversation-list renders.
  useEffect(() => {
    const reconcile = (conversations: { id: string }[]) => {
      const live = new Set(conversations.map((c) => c.id));
      const runStore = useSessionRunStore.getState();
      for (const id of Object.keys(runStore.runs)) {
        if (!live.has(id)) runStore.clearRun(id);
      }
    };
    // Reconcile once on mount, then only when a conversation is removed — a
    // deletion is the sole source of orphaned runs. Gating on a length DECREASE
    // (rather than the array ref) avoids re-running on every streaming chunk,
    // which mutates `conversations` immutably on each segment write.
    reconcile(useChatStore.getState().conversations);
    const unsub = useChatStore.subscribe((state, prev) => {
      if (state.conversations.length < prev.conversations.length) {
        reconcile(state.conversations);
      }
    });
    return unsub;
  }, []);
}
