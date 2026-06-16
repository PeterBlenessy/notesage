import { useEffect } from 'react';
import { onAction } from '@tauri-apps/plugin-notification';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSessionRunStore, ACTIVE_STATUSES, type SessionRunStatus } from '@/stores/session-run-store';
import { processSendQueue, dropQueuedSend } from '@/lib/ai/session-run';
import { notifyBackgroundSession } from '@/lib/notifications';

const isActiveStatus = (s: SessionRunStatus | undefined): boolean =>
  s !== undefined && ACTIVE_STATUSES.includes(s);

function conversationTitle(conversationId: string): string {
  return (
    useChatStore.getState().conversations.find((c) => c.id === conversationId)?.title ||
    'Chat'
  );
}

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
 * Whether a permission request's conversation is the one currently watched in
 * the command bar (task #7). Drives the foreground-aware auto-deny timeout: a
 * request from a backgrounded session must NOT count down on the old 30 s timer
 * (the desktop notification is the time-sensitive signal). A request with no
 * conversation attribution (legacy) is treated as foreground so behavior is
 * unchanged.
 */
export function useIsRequestForeground(conversationId: string | null | undefined): boolean {
  const foreground = useSessionRunStore((s) => s.foregroundConversationId);
  if (conversationId == null) return true;
  return conversationId === foreground;
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

  // 2. Drain the concurrency queue (task #5): whenever run-state changes (a
  //    session completed / errored / was cancelled, freeing a slot), start as
  //    many parked sends as the cap now allows. `processSendQueue` is FIFO and
  //    re-entrancy-safe.
  useEffect(() => {
    const drain = () => processSendQueue(useSettingsStore.getState().maxConcurrentSessions);
    drain(); // in case runs already have free capacity at mount
    return useSessionRunStore.subscribe(drain);
  }, []);

  // 3. Prune run entries whose conversation has been deleted. Subscribe to the
  //    chat store directly (not via a render selector) so a delete anywhere
  //    reconciles without coupling this hook to conversation-list renders.
  useEffect(() => {
    const reconcile = (conversations: { id: string }[]) => {
      const live = new Set(conversations.map((c) => c.id));
      const runStore = useSessionRunStore.getState();
      for (const id of Object.keys(runStore.runs)) {
        if (!live.has(id)) {
          dropQueuedSend(id); // also drop a parked send for a deleted conversation
          runStore.clearRun(id);
        }
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

  // 4. Desktop notifications for BACKGROUNDED sessions (task #15). Diff each
  //    run-state change: a non-foreground session that BECOMES awaiting-permission,
  //    or that finishes (active → terminal), fires a notification (gated on the
  //    matching setting). The foreground session never notifies — its card /
  //    stream is already visible. `subscribe` hands us prev + next state.
  useEffect(() => {
    return useSessionRunStore.subscribe((state, prev) => {
      const foreground = state.foregroundConversationId;
      const ids = new Set([...Object.keys(prev.runs), ...Object.keys(state.runs)]);
      for (const id of ids) {
        if (id === foreground) continue; // foreground is watched — no notification
        const before = prev.runs[id]?.status;
        const after = state.runs[id]?.status;
        if (before === after) continue;

        // Newly blocked on a permission decision.
        if (after === 'awaiting_permission' && before !== 'awaiting_permission') {
          void notifyBackgroundSession(
            'permission',
            conversationTitle(id),
            'A background session needs your approval to continue.',
            id,
          );
          continue;
        }
        // Finished: was actively working, now terminal (idle/cleared/error).
        if (isActiveStatus(before) && !isActiveStatus(after)) {
          void notifyBackgroundSession(
            'completion',
            conversationTitle(id),
            after === 'error' ? 'A background session ended with an error.' : 'A background session finished.',
            id,
          );
        }
      }
    });
  }, []);

  // 5. Clicking a session notification foregrounds that conversation and focuses
  //    the window (task #15). Defensive — the notification plugin / window API
  //    may be unavailable (headless/tests); failures are swallowed.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    onAction((notification) => {
      const convId = notification.extra?.conversationId;
      if (typeof convId === 'string') {
        useChatStore.getState().setActiveConversation(convId);
        getCurrentWindow().setFocus().catch(() => {});
      }
    })
      .then((handle) => {
        cleanup = () => handle.unregister();
      })
      .catch(() => {
        // Plugin unavailable — no click-to-foreground, notifications still fire.
      });
    return () => cleanup?.();
  }, []);
}
