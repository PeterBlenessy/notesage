import { DomainApprovalCard } from './DomainApprovalCard';
import { useDomainRequestStore } from '@/stores/domain-request-store';

/**
 * Always-mounted stack of pending network-domain approval cards. Rendered from
 * `QuietLayout` (not the command-bar stream) so domain prompts surface whether or
 * not the command bar is expanded — the fix for agents wedging on telemetry
 * requests when the bar is collapsed (see `useNetworkDomainApprovals`).
 *
 * Pinned bottom-centre, just above the floating command-bar pill. Renders
 * nothing when there are no pending requests.
 */
export function DomainApprovalStack() {
  const requests = useDomainRequestStore((s) => s.requests);
  const removeRequest = useDomainRequestStore((s) => s.removeRequest);

  if (requests.length === 0) return null;

  return (
    <div className="fixed bottom-28 left-1/2 z-50 flex w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
      {requests.map((req) => (
        <DomainApprovalCard
          key={req.requestId}
          request={req}
          onResolved={removeRequest}
        />
      ))}
    </div>
  );
}
