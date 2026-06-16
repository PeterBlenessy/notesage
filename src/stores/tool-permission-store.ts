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

interface ToolPermissionStore {
  /** Currently pending tool permission request (at most one at a time). */
  pending: PendingToolPermission | null;
  /** Set a pending request. */
  setPending: (request: PendingToolPermission | null) => void;
}

export const useToolPermissionStore = create<ToolPermissionStore>()((set) => ({
  pending: null,
  setPending: (request) => set({ pending: request }),
}));
