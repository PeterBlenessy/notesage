import { useState, useEffect, useRef } from 'react';
import { Wrench } from 'lucide-react';
import type { PendingToolPermission } from '@/stores/tool-permission-store';
import { useIsRequestForeground } from '@/hooks/useSessionManager';
import { resolveDirectPermission, type ApprovalTier } from '@/lib/ai/permission-resolve';
import { TieredApprovalButtons } from '@/components/chat/TieredApprovalButtons';
import { formatToolArgsPreview } from '@/lib/ai/tool-args';

interface ToolCallPermissionCardProps {
  request: PendingToolPermission;
  onResolved?: (id: string) => void;
}

/**
 * Permission card for local AI tool calls (direct API path).
 * Follows the same pattern as PermissionCard (ACP) and DomainApprovalCard.
 * Rendered inline in the chat stream when the tool execution loop
 * (useDirectApiChat) encounters a tool call that needs user approval.
 *
 * Resolves through the shared `resolveDirectPermission` + `TieredApprovalButtons`
 * (review #6/#7) so the in-stream and history-inline approval forms never drift.
 */
export function ToolCallPermissionCard({ request, onResolved }: ToolCallPermissionCardProps) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(30);
  const resolvedRef = useRef(false);
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  // Foreground-aware auto-deny (task #7): only count down while this request's
  // session is the one being watched. A backgrounded request never auto-denies
  // — the desktop notification (task #15) is its time-sensitive signal.
  const isForeground = useIsRequestForeground(request.conversationId);

  const TIER_LABEL: Record<ApprovalTier, string> = {
    allow: `Allowed "${request.name}" once`,
    session: `Allowed "${request.name}" for session`,
    always: `Allowed "${request.name}" always`,
    deny: `Denied "${request.name}"`,
  };

  const decide = (tier: ApprovalTier) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    resolveDirectPermission(request, tier);
    setResolved(TIER_LABEL[tier]);
    setTimeout(() => onResolvedRef.current?.(request.id), 1500);
  };

  // Auto-deny after 30 seconds — only while foreground.
  useEffect(() => {
    if (!isForeground) {
      setCountdown(30); // frozen while backgrounded; restarts on foreground
      return;
    }
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (!resolvedRef.current) {
            resolvedRef.current = true;
            resolveDirectPermission(request, 'deny');
            setResolved(`Tool call "${request.name}" timed out — denied.`);
            setTimeout(() => onResolvedRef.current?.(request.id), 1500);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id, isForeground]);

  if (resolved) {
    return (
      <div className="rounded-lg border border-border bg-card/50 px-3 py-2 flex items-center gap-2.5">
        <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <p className="text-[11px] text-muted-foreground">{resolved}</p>
      </div>
    );
  }

  const formattedArgs = formatToolArgsPreview(request.arguments);

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <Wrench className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground">Tool call: {request.name}</p>
          {formattedArgs && (
            <pre className="mt-1 text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all font-mono">
              {formattedArgs}
            </pre>
          )}
        </div>
      </div>
      <div className="mt-2 ml-[26px]">
        <TieredApprovalButtons
          onDecide={decide}
          denySuffix={countdown < 30 ? ` (${countdown}s)` : ''}
        />
      </div>
    </div>
  );
}
