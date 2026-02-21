import { create } from 'zustand';

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

interface PermissionStore {
  /** Pending permission requests awaiting user decision. */
  requests: PermissionRequest[];

  addRequest: (request: PermissionRequest) => void;
  removeRequest: (requestId: string) => void;
  clearRequestsForInstance: (instanceId: string) => void;
}

export const usePermissionStore = create<PermissionStore>((set) => ({
  requests: [],

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
}));
