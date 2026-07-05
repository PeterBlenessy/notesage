// ---------------------------------------------------------------------------
// Per-conversation ACP stream-cleanup registry (review #3).
//
// Pure map-semantics helpers extracted from `useAcpLifecycle` — the hook owns
// the actual `CleanupMap` instance (one per mounted hook, in a ref); these
// functions are unit-testable without React (see
// `useAcpLifecycle-cleanup-map.test.ts`).
// ---------------------------------------------------------------------------

import { DEFAULT_AGENT_KEY } from '@/lib/ai/acp-agent-state';

/**
 * Registry key for a conversation's stream-cleanup closure. Mirrors the ACP
 * agent registry's own key (`conversationId ?? DEFAULT_AGENT_KEY`) so the
 * cleanup map and the agent map share keys — the agent-exited handler can map an
 * exited instance back to its registry key and clean up the matching stream.
 *
 * A single `cleanupRef` previously let a second conversation's send overwrite
 * the first's cleanup: the first's listeners leaked, and the first's completion
 * ran the second's cleanup, tearing down the second's live stream. A
 * per-conversation map keyed by this fixes it (review #3).
 */
export function cleanupKeyFor(conversationId: string | null | undefined): string {
  return conversationId ?? DEFAULT_AGENT_KEY;
}

export type CleanupMap = Map<string, (cancelled?: boolean) => void>;

/** Run + deregister the cleanup for one conversation (no-op if none registered). */
export function runConvCleanup(map: CleanupMap, conversationId: string | null | undefined, cancelled?: boolean): void {
  const key = cleanupKeyFor(conversationId);
  const fn = map.get(key);
  if (fn) {
    map.delete(key);
    fn(cancelled);
  }
}

/** Run + deregister every conversation's cleanup (unmount / agent-stop-all). */
export function runAllConvCleanups(map: CleanupMap, cancelled?: boolean): void {
  const fns = [...map.values()];
  map.clear();
  for (const fn of fns) fn(cancelled);
}

/**
 * Register a conversation's stream cleanup, running any STALE entry for the
 * same conversation first. A plain `map.set` overwrite leaked the previous
 * closure — its listeners stayed live alongside the new registration and both
 * passed the instanceId gate, double-writing stream events (deep-review
 * finding #4b). The stale closure only tears down ITS OWN listeners/state;
 * the new cleanup being registered is untouched.
 *
 * Returns whether a stale cleanup ran, so the caller can re-assert per-send
 * state the stale closure cleared as a side effect (loading flag, run entry).
 */
export function registerConvCleanup(
  map: CleanupMap,
  conversationId: string | null | undefined,
  cleanup: (cancelled?: boolean) => void,
): boolean {
  const key = cleanupKeyFor(conversationId);
  const stale = map.get(key);
  if (stale) {
    map.delete(key);
    stale();
  }
  map.set(key, cleanup);
  return stale !== undefined;
}
