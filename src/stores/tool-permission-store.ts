import { create } from 'zustand';

export type ToolCallDecision = 'allow' | 'session' | 'always' | 'deny';

export interface PendingToolPermission {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  resolve: (decision: ToolCallDecision) => void;
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
