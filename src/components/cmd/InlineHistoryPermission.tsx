import { Shield } from 'lucide-react';
import { usePermissionStore } from '@/stores/permission-store';
import { useToolPermissionStore, selectPendingForConversation } from '@/stores/tool-permission-store';
import { formatAcpToolName } from '@/lib/ai/acp-utils';
import {
  resolveAcpPermission,
  resolveDirectPermission,
  type ApprovalTier,
} from '@/lib/ai/permission-resolve';
import { TieredApprovalButtons } from '@/components/chat/TieredApprovalButtons';
import { formatToolArgsPreview } from '@/lib/ai/tool-args';

/**
 * Inline permission approval for an awaiting-permission history row (PRD
 * `2026-06-14-command-bar-session-multitasking`, task #10). Expands in place so
 * the user can resolve a backgrounded session's tool-call request WITHOUT
 * opening the full conversation. Handles both ACP (permission-store) and
 * direct-API (tool-permission-store) requests, resolving through the shared
 * `permission-resolve` helpers. Renders nothing when the conversation has no
 * pending request — callers can mount it unconditionally per row.
 */
export function InlineHistoryPermission({ conversationId }: { conversationId: string }) {
  // ACP request owned by this conversation (first pending of any).
  const acpRequest = usePermissionStore((s) =>
    s.requests.find((r) => r.conversationId === conversationId),
  );
  // Direct-API request owned by this conversation (review #4 — per-conversation
  // map; no foreground fallback so a row only shows its own pending).
  const directPending = useToolPermissionStore(selectPendingForConversation(conversationId));

  if (acpRequest) {
    const label = formatAcpToolName(acpRequest.toolKind, acpRequest.toolTitle);
    const onDecide = (tier: ApprovalTier) => resolveAcpPermission(acpRequest, tier, label);
    return (
      <Shell label={label} preview={acpRequest.toolInput || null} onDecide={onDecide} />
    );
  }

  if (directPending) {
    const label = `Tool call: ${directPending.name}`;
    const onDecide = (tier: ApprovalTier) => resolveDirectPermission(directPending, tier);
    return (
      <Shell label={label} preview={formatToolArgsPreview(directPending.arguments)} onDecide={onDecide} />
    );
  }

  return null;
}

function Shell({
  label,
  preview,
  onDecide,
}: {
  label: string;
  preview: string | null;
  onDecide: (tier: ApprovalTier) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Permission request"
      data-testid="inline-history-permission"
      className="mx-2 mb-2 rounded-lg border border-[var(--color-accent-primary)]/40 bg-card px-3 py-2.5"
    >
      <div className="flex items-start gap-2.5">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent-primary)]" strokeWidth={1.5} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">{label}</p>
          {preview && (
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground">
              {preview}
            </pre>
          )}
        </div>
      </div>
      <div className="mt-2 ml-[26px]">
        <TieredApprovalButtons onDecide={onDecide} />
      </div>
    </div>
  );
}
