// Connection usage detail (provider-usage-display #10, Phase 2).
//
// An Info affordance on the ConnectionCard opening a popover with the latest
// `ProviderUsageSnapshot` for the connection — context, cost, rate-limit
// state, per-turn tokens — plus a provenance + freshness footer.
//
// Refresh is passive: the popover reads the usage-store, which is written by
// live events (ACP listener) and local estimation. NO polling, no timers —
// countdown/freshness labels are computed once per render, which is the moment
// the popover opens (hard PRD constraint).
//
// Rows follow the Settings v2 `SettingsRow` visual pattern (13px medium label,
// 12px muted values) but deliberately do not reuse the component — SettingsRow
// self-hides on active settings-search queries, which would silently blank
// this popover while the user has a ⌘F filter typed.

import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useUsageStore } from '@/stores/usage-store';
import { formatSavedShort } from '@/lib/saved-ago';
import {
  formatTokenCount,
  formatRateLimitType,
  formatRateLimitStatus,
  formatResetCountdown,
  isWarningStatus,
} from '@/components/chat/UsagePopover';
import type { Connection } from '@/lib/ai/connections';

function DetailRow({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-[13px] font-medium text-foreground">{label}</span>
      <span className={`text-[12px] text-right ${valueClassName ?? 'text-muted-foreground'}`}>{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider pt-2">
      {children}
    </p>
  );
}

export function ConnectionUsageDetail({ connection }: { connection: Connection }) {
  const snapshot = useUsageStore((s) => s.snapshots[connection.id]);
  const now = Date.now();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          title="Usage details"
          aria-label={`Usage details for ${connection.label}`}
        >
          <Info className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-72 p-3">
        {!snapshot ? (
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            No usage reported yet — data appears after chatting with this provider.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {/* Context */}
            {snapshot.contextSize !== undefined && snapshot.contextUsed !== undefined && (
              <div className="pb-1">
                <DetailRow
                  label="Context"
                  value={`${snapshot.confidence === 'estimated' ? '≈' : ''}${formatTokenCount(snapshot.contextUsed)} / ${formatTokenCount(snapshot.contextSize)} (${Math.round(
                    Math.min(snapshot.contextUsed / Math.max(snapshot.contextSize, 1), 1) * 100,
                  )}%)`}
                />
              </div>
            )}

            {/* Cost */}
            {snapshot.cost && (
              <div className="py-1">
                <DetailRow
                  label="Session cost"
                  value={`${snapshot.cost.currency === 'USD' ? '$' : snapshot.cost.currency + ' '}${snapshot.cost.amount.toFixed(2)}`}
                />
              </div>
            )}

            {/* Rate limit */}
            {snapshot.rateLimit && (
              <div className="pb-1">
                <SectionLabel>Rate limit</SectionLabel>
                {snapshot.rateLimit.rateLimitType && (
                  <DetailRow label="Window" value={formatRateLimitType(snapshot.rateLimit.rateLimitType)} />
                )}
                {snapshot.rateLimit.status && (
                  <DetailRow
                    label="Status"
                    value={formatRateLimitStatus(snapshot.rateLimit.status)}
                    // Same urgency cue as the chat popover — destructive at/above warning.
                    valueClassName={isWarningStatus(snapshot.rateLimit.status) ? 'text-destructive' : undefined}
                  />
                )}
                {snapshot.rateLimit.utilization !== undefined && (
                  <DetailRow label="Used" value={`${Math.round(snapshot.rateLimit.utilization)}%`} />
                )}
                {snapshot.rateLimit.resetsAt !== undefined && (
                  <DetailRow label="Reset" value={formatResetCountdown(snapshot.rateLimit.resetsAt, now)} />
                )}
              </div>
            )}

            {/* Per-turn tokens */}
            {snapshot.lastTurnUsage && (
              <div className="pb-1">
                <SectionLabel>Last turn</SectionLabel>
                <DetailRow label="Input" value={formatTokenCount(snapshot.lastTurnUsage.inputTokens)} />
                <DetailRow label="Output" value={formatTokenCount(snapshot.lastTurnUsage.outputTokens)} />
                {snapshot.lastTurnUsage.thoughtTokens !== undefined && (
                  <DetailRow label="Thinking" value={formatTokenCount(snapshot.lastTurnUsage.thoughtTokens)} />
                )}
                {snapshot.lastTurnUsage.cachedReadTokens !== undefined && (
                  <DetailRow label="Cache read" value={formatTokenCount(snapshot.lastTurnUsage.cachedReadTokens)} />
                )}
                {snapshot.lastTurnUsage.cachedWriteTokens !== undefined && (
                  <DetailRow label="Cache write" value={formatTokenCount(snapshot.lastTurnUsage.cachedWriteTokens)} />
                )}
              </div>
            )}

            {/* Provenance + freshness footer */}
            <p className="text-[12px] text-muted-foreground pt-2">
              {snapshot.source === 'acp' ? 'Reported by agent' : 'Estimated locally'}
              {` · ${formatSavedShort(now - snapshot.updatedAt)} ago`}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
