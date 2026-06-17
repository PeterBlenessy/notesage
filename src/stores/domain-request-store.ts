import { create } from 'zustand';
import type { DomainApprovalRequest } from '@/components/chat/DomainApprovalCard';

/**
 * Pending network-domain approval requests from the agent network proxy.
 *
 * These used to live in `ChatMessageList`'s local state with the listener in the
 * same component — but `ChatMessageList` only mounts while the command bar is
 * EXPANDED (Quiet Composer). When the bar was collapsed, the proxy's
 * `network-domain-request` events hit no handler, the agent's connection blocked
 * for the proxy's full 30 s timeout, and a Claude-Code-style agent that phones
 * telemetry at startup would wedge ("AI not responding"). Hoisting the pending
 * set into an always-mounted store (driven by `useNetworkDomainApprovals`) makes
 * domain approval work regardless of the command bar's expand state.
 */
interface DomainRequestStore {
  requests: DomainApprovalRequest[];
  /** Add a pending request (idempotent on `requestId`). */
  addRequest: (req: DomainApprovalRequest) => void;
  /** Remove a request once resolved (approved / denied / timed out). */
  removeRequest: (requestId: string) => void;
}

export const useDomainRequestStore = create<DomainRequestStore>((set) => ({
  requests: [],
  addRequest: (req) =>
    set((s) =>
      s.requests.some((r) => r.requestId === req.requestId)
        ? s
        : { requests: [...s.requests, req] },
    ),
  removeRequest: (requestId) =>
    set((s) => ({ requests: s.requests.filter((r) => r.requestId !== requestId) })),
}));
