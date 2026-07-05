// Usage popover (provider-usage-display #9) — promotes the usage pill from
// tooltip-only to click-to-open. The pill is unchanged at rest (ring only);
// the tooltip keeps the one-line summary; the popover carries the detail rows:
// context, per-turn tokens, cost, rate-limit state, provenance footer.
//
// Countdown / relative labels are computed at render time — NO timers, no
// polling (hard PRD constraint). The label is fresh each time the popover
// opens, which is the moment it's read.

import { memo } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { formatSavedShort } from '@/lib/saved-ago';
import type { ProviderRateLimitInfo, TurnUsage } from '@/lib/ai/usage';

// ---------------------------------------------------------------------------
// Shared formatting + ring (used by the pill trigger and the popover rows)
// ---------------------------------------------------------------------------

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Threshold ring coloring per the design-system mapping (75/90 bands within
 * the strict-neutral palette): `<75%` inherit (today's muted look), `75–90%`
 * foreground, `≥90%` destructive — the only chromatic use. Below 75% the
 * render is pixel-identical to the pre-threshold indicator.
 */
export function ringThreshold(ratio: number): { className?: string; opacity: number } {
  if (ratio >= 0.9) return { className: 'text-destructive', opacity: 1 };
  if (ratio >= 0.75) return { className: 'text-foreground', opacity: 1 };
  return { opacity: 0.7 };
}

/** Threshold caption per the PRD bands; undefined below 75%. */
export function thresholdCaption(ratio: number): string | undefined {
  if (ratio >= 0.9) return 'Start a new session soon';
  if (ratio >= 0.75) return 'Context filling up';
  return undefined;
}

export function ContextUsageIcon({ used, size }: { used: number; size: number }) {
  const ratio = size > 0 ? Math.min(used / size, 1) : 0;
  const r = 6;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - ratio);
  const threshold = ringThreshold(ratio);

  // Decorative — the values live in the trigger's aria-label / row text.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0" aria-hidden="true">
      {/* Background circle */}
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      {/* Progress arc */}
      <circle
        cx="8" cy="8" r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 8 8)"
        opacity={threshold.opacity}
        className={threshold.className}
      />
    </svg>
  );
}

/** "five_hour" → "5-hour limit", "seven_day" → "Weekly limit"; unknown → humanized. */
export function formatRateLimitType(type: string): string {
  switch (type) {
    case 'five_hour': return '5-hour limit';
    case 'seven_day': return 'Weekly limit';
    default: return `${type.replace(/_/g, ' ')} limit`;
  }
}

/** Known Claude statuses → friendly labels; unknown → humanized passthrough. */
export function formatRateLimitStatus(status: string): string {
  switch (status) {
    case 'allowed': return 'OK';
    case 'allowed_warning': return 'Approaching limit';
    case 'rejected': return 'Limit reached';
    default: return status.replace(/_/g, ' ');
  }
}

/** Countdown to a unix-seconds reset timestamp, computed once at render. */
export function formatResetCountdown(resetsAtUnixSec: number, nowMs: number): string {
  const deltaMs = resetsAtUnixSec * 1000 - nowMs;
  if (deltaMs <= 60_000) return 'resets soon';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `resets in ${hours}h ${minutes % 60}m`;
  return `resets in ${Math.floor(hours / 24)}d`;
}

/** True when the rate-limit status is at/above warning (drives destructive text). */
export function isWarningStatus(status: string | undefined): boolean {
  return status === 'allowed_warning' || status === 'rejected';
}

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------

export interface UsagePopoverData {
  contextUsed: number;
  contextSize: number;
  /** Estimated locally (chars/4) vs reported exactly by the agent. */
  isEstimated: boolean;
  cost?: { amount: number; currency: string };
  rateLimit?: ProviderRateLimitInfo;
  lastTurnUsage?: TurnUsage | null;
  /** Timestamp of the latest usage-store write for the freshness footer. */
  updatedAt?: number;
}

function formatCost(cost: { amount: number; currency: string }): string {
  return `${cost.currency === 'USD' ? '$' : cost.currency + ' '}${cost.amount.toFixed(2)}`;
}

function Row({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={valueClassName ?? 'text-foreground'}>{value}</span>
    </div>
  );
}

/**
 * The usage pill (ring at rest, one-line tooltip) that opens a detail popover
 * on click. Rows in PRD order: context → per-turn tokens → cost → rate limit
 * → provenance footer.
 */
export const UsagePopover = memo(function UsagePopover({ data }: { data: UsagePopoverData }) {
  const { contextUsed, contextSize, isEstimated, cost, rateLimit, lastTurnUsage, updatedAt } = data;
  const ratio = contextSize > 0 ? Math.min(contextUsed / contextSize, 1) : 0;
  const approx = isEstimated ? '≈' : '';
  const summary = contextSize > 0
    ? `${approx}${formatTokenCount(contextUsed)} / ${formatTokenCount(contextSize)}`
    : `${approx}${formatTokenCount(contextUsed)}`;
  const percent = contextSize > 0 ? `${Math.round(ratio * 100)}%` : '';
  const caption = thresholdCaption(ratio);
  const now = Date.now();

  const provenance = isEstimated ? 'Estimated locally' : 'Reported by agent';
  const freshness = updatedAt ? ` · ${formatSavedShort(now - updatedAt)} ago` : '';

  return (
    <Popover>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Context usage: ${summary}${percent ? ` (${percent})` : ''}${isEstimated ? ', estimated locally' : ''}`}
                className="inline-flex items-center h-7 px-2 rounded-md text-muted-foreground/60 transition-colors duration-150 border border-transparent hover:text-foreground hover:bg-muted hover:border-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <ContextUsageIcon used={contextUsed} size={contextSize} />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <p>{summary}</p>
            {cost && <p className="text-muted-foreground">{formatCost(cost)}</p>}
            {isEstimated && <p className="text-muted-foreground">Estimated locally</p>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent side="top" align="end" className="w-64 p-3 space-y-2">
        {/* Context row */}
        <div className="flex items-center gap-2">
          <ContextUsageIcon used={contextUsed} size={contextSize} />
          <span className="text-sm text-foreground">{summary}</span>
          {percent && <span className="text-xs text-muted-foreground ml-auto">{percent}</span>}
        </div>
        {caption && (
          <p className={`text-xs ${ratio >= 0.9 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {caption}
          </p>
        )}

        {/* Per-turn token breakdown */}
        {lastTurnUsage && (
          <div className="space-y-1 border-t border-border pt-2">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Last turn</p>
            <Row label="Input" value={formatTokenCount(lastTurnUsage.inputTokens)} />
            <Row label="Output" value={formatTokenCount(lastTurnUsage.outputTokens)} />
            {lastTurnUsage.thoughtTokens !== undefined && (
              <Row label="Thinking" value={formatTokenCount(lastTurnUsage.thoughtTokens)} />
            )}
            {lastTurnUsage.cachedReadTokens !== undefined && (
              <Row label="Cache read" value={formatTokenCount(lastTurnUsage.cachedReadTokens)} />
            )}
            {lastTurnUsage.cachedWriteTokens !== undefined && (
              <Row label="Cache write" value={formatTokenCount(lastTurnUsage.cachedWriteTokens)} />
            )}
          </div>
        )}

        {/* Cumulative cost */}
        {cost && (
          <div className="border-t border-border pt-2">
            <Row label="Session cost" value={formatCost(cost)} />
          </div>
        )}

        {/* Rate-limit rows */}
        {rateLimit && (rateLimit.status || rateLimit.rateLimitType || rateLimit.resetsAt !== undefined || rateLimit.utilization !== undefined) && (
          <div className="space-y-1 border-t border-border pt-2">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Rate limit</p>
            {rateLimit.rateLimitType && (
              <Row label="Window" value={formatRateLimitType(rateLimit.rateLimitType)} />
            )}
            {rateLimit.status && (
              <Row
                label="Status"
                value={formatRateLimitStatus(rateLimit.status)}
                valueClassName={isWarningStatus(rateLimit.status) ? 'text-destructive' : 'text-foreground'}
              />
            )}
            {rateLimit.utilization !== undefined && (
              <Row label="Used" value={`${Math.round(rateLimit.utilization)}%`} />
            )}
            {rateLimit.resetsAt !== undefined && (
              <Row label="Reset" value={formatResetCountdown(rateLimit.resetsAt, now)} />
            )}
          </div>
        )}

        {/* Provenance footer */}
        <p className="text-xs text-muted-foreground border-t border-border pt-2">
          {provenance}
          {freshness}
        </p>
      </PopoverContent>
    </Popover>
  );
});
