// Run-state transition helpers (PRD `2026-06-14-command-bar-session-multitasking`,
// task #4). The streaming lifecycle (direct-API + ACP) calls these to record a
// conversation's live run state in `session-run-store` INDEPENDENTLY of the
// command-bar view, so the orb / history / foreground-loading can all read it.
//
// Every helper is a no-op when `conversationId` is null — callers without a
// resolved conversation (e.g. a send before a conversation exists) simply don't
// participate in run tracking, which is harmless.

import { useSessionRunStore, type SessionRunPath } from '@/stores/session-run-store';

/** Mark a conversation's run as actively streaming. Records the send path and
 *  the transient runtime handle (`streamId` for direct, `instanceId` for ACP). */
export function runStarted(
  conversationId: string | null | undefined,
  path: SessionRunPath,
  handles?: { streamId?: string; instanceId?: string },
): void {
  if (!conversationId) return;
  useSessionRunStore.getState().setRun(conversationId, {
    status: 'running',
    path,
    startedAt: Date.now(),
    ...handles,
  });
}

/** Attach the ACP agent instance id to an already-started run, without
 *  resetting `startedAt`. Lets the run be marked active synchronously (before the
 *  agent spawn await) and the handle filled in once the spawn resolves. */
export function runAttachInstance(
  conversationId: string | null | undefined,
  instanceId: string,
): void {
  if (!conversationId) return;
  const store = useSessionRunStore.getState();
  if (store.runs[conversationId]) store.setRun(conversationId, { instanceId });
}

/** Move a run back to `running` from `awaiting_permission` (e.g. the agent
 *  continued after a permission decision). Only writes on that transition so it
 *  is safe to call on every stream event without churning the store. */
export function runRunning(conversationId: string | null | undefined): void {
  if (!conversationId) return;
  const store = useSessionRunStore.getState();
  if (store.runs[conversationId]?.status === 'awaiting_permission') {
    store.setStatus(conversationId, 'running');
  }
}

/** Mark a run as blocked on a permission request (drives the orb's "needs you"
 *  pulse in #13 and the foreground-aware auto-deny timeout in #7). */
export function runAwaitingPermission(
  conversationId: string | null | undefined,
  pendingPermissionId?: string,
): void {
  if (!conversationId) return;
  useSessionRunStore.getState().setRun(conversationId, {
    status: 'awaiting_permission',
    pendingPermissionId,
  });
}

/** Clear a run on clean completion or cancellation (back to no active run). */
export function runIdle(conversationId: string | null | undefined): void {
  if (!conversationId) return;
  useSessionRunStore.getState().clearRun(conversationId);
}

/** Mark a run as failed — kept so the history row can show an error badge (#9). */
export function runError(conversationId: string | null | undefined): void {
  if (!conversationId) return;
  useSessionRunStore.getState().setStatus(conversationId, 'error');
}
