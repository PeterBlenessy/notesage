import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PermissionRequest {
  id: string;
  instanceId: string;
  sessionId: string;
  requestId: string;
  toolKind: string;
  toolTitle: string;
  toolInput: string;
  options: { optionId: string; kind: string; name: string }[];
  timestamp: number;
}

export type PermissionTier = 'none' | 'session' | 'always';

interface PermissionStore {
  /** Pending permission requests awaiting user decision. */
  requests: PermissionRequest[];

  /** Tool kinds allowed for the current session (non-persisted). */
  sessionAllowed: Set<string>;

  /** Tool kinds always allowed (persisted across restarts). */
  alwaysAllowed: string[];

  addRequest: (request: PermissionRequest) => void;
  removeRequest: (requestId: string) => void;
  clearRequestsForInstance: (instanceId: string) => void;
  clearAll: () => void;

  /** Add a tool kind to session allow-list. */
  allowSession: (toolKind: string) => void;

  /** Remove a tool kind from session allow-list. */
  removeSession: (toolKind: string) => void;

  /** Add a tool kind to persistent always-allow list. */
  allowAlways: (toolKind: string) => void;

  /** Remove a tool kind from persistent always-allow list. */
  removeAlways: (toolKind: string) => void;

  /** Check if a tool kind is auto-allowed (session or always). */
  isAutoAllowed: (toolKind: string) => boolean;

  /** Get the current permission tier for a tool kind. */
  getToolTier: (toolKind: string) => PermissionTier;
}

export const usePermissionStore = create<PermissionStore>()(
  persist(
    (set, get) => ({
      requests: [],
      sessionAllowed: new Set<string>(),
      alwaysAllowed: [],

      addRequest: (request) =>
        set((state) => ({
          requests: [...state.requests, request],
        })),

      removeRequest: (requestId) =>
        set((state) => ({
          requests: state.requests.filter((r) => r.requestId !== requestId),
        })),

      clearRequestsForInstance: (instanceId) =>
        set((state) => ({
          requests: state.requests.filter((r) => r.instanceId !== instanceId),
        })),

      clearAll: () => set({ requests: [], sessionAllowed: new Set<string>() }),

      allowSession: (toolKind) =>
        set((state) => {
          const next = new Set(state.sessionAllowed);
          next.add(toolKind);
          return { sessionAllowed: next };
        }),

      removeSession: (toolKind) =>
        set((state) => {
          const next = new Set(state.sessionAllowed);
          next.delete(toolKind);
          return { sessionAllowed: next };
        }),

      allowAlways: (toolKind) =>
        set((state) => {
          if (state.alwaysAllowed.includes(toolKind)) return state;
          return { alwaysAllowed: [...state.alwaysAllowed, toolKind] };
        }),

      removeAlways: (toolKind) =>
        set((state) => ({
          alwaysAllowed: state.alwaysAllowed.filter((k) => k !== toolKind),
        })),

      isAutoAllowed: (toolKind) => {
        const state = get();
        return state.sessionAllowed.has(toolKind) || state.alwaysAllowed.includes(toolKind);
      },

      getToolTier: (toolKind) => {
        const state = get();
        if (state.alwaysAllowed.includes(toolKind)) return 'always';
        if (state.sessionAllowed.has(toolKind)) return 'session';
        return 'none';
      },
    }),
    {
      name: 'notesage-permissions',
      partialize: (state) => ({ alwaysAllowed: state.alwaysAllowed }),
    }
  )
);
