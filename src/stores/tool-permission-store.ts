import { create } from 'zustand';

export type ToolCallDecision = 'allow' | 'session' | 'always' | 'deny';

export interface PendingToolPermission {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  resolve: (decision: ToolCallDecision) => void;
  /**
   * Conversation that owns this request (task #6) — lets the permission card
   * tell whether it belongs to the watched session, which drives the
   * foreground-aware auto-deny timeout (task #7). `null`/absent for legacy
   * callers (treated as foreground).
   */
  conversationId?: string | null;
}

/**
 * Bucket for requests with no conversation id (legacy callers / the foreground
 * chat before its conversation is known). The foreground chat list also reads
 * this bucket as a fallback so such requests still surface somewhere.
 */
export const FOREGROUND_PENDING_KEY = '__foreground__';

function keyFor(conversationId: string | null | undefined): string {
  return conversationId ?? FOREGROUND_PENDING_KEY;
}

interface ToolPermissionStore {
  /**
   * Pending tool permission requests, keyed by owning conversation id (review
   * #4). Each conversation can have at most one in-flight request — its turn
   * blocks on the `resolve` — so a map prevents a second concurrent turn from
   * clobbering the first's pending request (which would strand the first turn
   * forever, its `resolve` never called).
   */
  pending: Record<string, PendingToolPermission>;
  /**
   * Set the pending request (keyed by its own `conversationId`), or — when
   * `request` is `null` — clear the pending request for `conversationId`.
   */
  setPending: (request: PendingToolPermission | null, conversationId?: string | null) => void;
}

export const useToolPermissionStore = create<ToolPermissionStore>()((set) => ({
  pending: {},
  setPending: (request, conversationId) =>
    set((state) => {
      const key = keyFor(request ? request.conversationId : conversationId);
      const next = { ...state.pending };
      if (request) next[key] = request;
      else delete next[key];
      return { pending: next };
    }),
}));

/**
 * Selector: the pending request for `conversationId`, or `null`. Returns the
 * stored object ref (or `null`) — stable across renders, safe as a zustand
 * selector. Does NOT fall back to the foreground bucket; use for per-row
 * surfaces (history) that must show only their own conversation's request.
 */
export function selectPendingForConversation(conversationId: string | null | undefined) {
  return (state: ToolPermissionStore): PendingToolPermission | null =>
    state.pending[keyFor(conversationId)] ?? null;
}

/**
 * Selector: the pending request for `conversationId`, falling back to the
 * foreground bucket (legacy/no-conversation requests). Use for the foreground
 * chat list so such requests still surface.
 */
export function selectForegroundPending(conversationId: string | null | undefined) {
  return (state: ToolPermissionStore): PendingToolPermission | null =>
    state.pending[keyFor(conversationId)] ?? state.pending[FOREGROUND_PENDING_KEY] ?? null;
}
