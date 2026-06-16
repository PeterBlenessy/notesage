// Run-state transition helpers (PRD `2026-06-14-command-bar-session-multitasking`,
// task #4). The streaming lifecycle (direct-API + ACP) calls these to record a
// conversation's live run state in `session-run-store` INDEPENDENTLY of the
// command-bar view, so the orb / history / foreground-loading can all read it.
//
// Every helper is a no-op when `conversationId` is null — callers without a
// resolved conversation (e.g. a send before a conversation exists) simply don't
// participate in run tracking, which is harmless.

import { useSessionRunStore, selectLiveCount, type SessionRunPath } from '@/stores/session-run-store';

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

// ---------------------------------------------------------------------------
// Concurrency cap + FIFO queue (task #5)
//
// When the live-session count is at the cap, a new send is deferred: its run is
// marked `queued` and a start-thunk is parked here (module-level, so it survives
// command-bar re-renders). `processSendQueue` drains the queue FIFO whenever a
// slot frees — driven by `useSessionManager`'s subscription to run-state. The
// start-thunk, not the store, holds the deferred work (thunks aren't
// serializable); the store's `queued` status is what the UI badges read.
// ---------------------------------------------------------------------------

interface QueuedSend {
  conversationId: string;
  /** Resumes the deferred send (sets it active + routes the actual stream). */
  start: () => void;
}

const sendQueue: QueuedSend[] = [];
let draining = false;

/** True when another live session may start without exceeding the cap. */
export function hasSessionCapacity(maxConcurrent: number): boolean {
  return selectLiveCount(useSessionRunStore.getState()) < maxConcurrent;
}

/** Park a send behind the cap: mark its run `queued` (FIFO). Replaces any prior
 *  queued thunk for the same conversation (a re-send supersedes). */
export function enqueueSend(conversationId: string, start: () => void): void {
  const existing = sendQueue.findIndex((q) => q.conversationId === conversationId);
  if (existing !== -1) sendQueue.splice(existing, 1);
  sendQueue.push({ conversationId, start });
  useSessionRunStore.getState().setStatus(conversationId, 'queued');
}

/** Drop a conversation's queued send without starting it (cancel / delete). */
export function dropQueuedSend(conversationId: string): boolean {
  const idx = sendQueue.findIndex((q) => q.conversationId === conversationId);
  if (idx === -1) return false;
  sendQueue.splice(idx, 1);
  return true;
}

/** Whether a conversation currently has a parked (queued) send. */
export function isSendQueued(conversationId: string): boolean {
  return sendQueue.some((q) => q.conversationId === conversationId);
}

/** Start as many queued sends as the cap allows, oldest first. Re-entrancy-safe:
 *  starting a send flips it to `running` and re-notifies the subscription, but
 *  the `draining` guard collapses the nested calls into the running loop. */
export function processSendQueue(maxConcurrent: number): void {
  if (draining) return;
  draining = true;
  try {
    while (sendQueue.length > 0 && hasSessionCapacity(maxConcurrent)) {
      const next = sendQueue.shift()!;
      // `start` synchronously marks the run `running` (via the send path's
      // `runStarted`), so the next capacity check sees the new live session.
      // Guard so one bad start can't wedge the whole queue — clear its run so it
      // doesn't linger as a phantom `queued` entry.
      try {
        next.start();
      } catch {
        useSessionRunStore.getState().clearRun(next.conversationId);
      }
    }
  } finally {
    draining = false;
  }
}

/** Test-only: clear the module-level queue between cases. */
export function __resetSendQueue(): void {
  sendQueue.length = 0;
  draining = false;
}
