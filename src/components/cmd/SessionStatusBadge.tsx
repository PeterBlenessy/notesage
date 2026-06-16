import { Pause, Hourglass, AlertTriangle, MessageSquare } from 'lucide-react';
import { useSessionRunStore } from '@/stores/session-run-store';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface SessionStatusBadgeProps {
  conversationId: string;
}

/**
 * Leading status indicator for a conversation's live AI run (PRD
 * `2026-06-14-command-bar-session-multitasking`, task #9), read from
 * `session-run-store`:
 *
 *   ● running — subtle neutral pulse
 *   ⏸ awaiting permission — accent (needs you)
 *   ⧗ queued — muted
 *   ⚠ error — destructive
 *   idle / no run — nothing (the caller renders its default icon)
 *
 * Neutral / accent / destructive tokens only. The running pulse is CSS-only and
 * stripped under `prefers-reduced-motion` (both via the media query in
 * globals.css and by omitting the class here).
 */
export function SessionStatusBadge({ conversationId }: SessionStatusBadgeProps) {
  const status = useSessionRunStore((s) => s.runs[conversationId]?.status);
  const reducedMotion = useReducedMotion();

  switch (status) {
    case 'running':
      return (
        <span
          role="img"
          aria-label="Running"
          data-testid="session-status-running"
          className={`mt-0.5 h-2 w-2 shrink-0 rounded-full bg-muted-foreground ${reducedMotion ? '' : 'session-status-pulse'}`}
        />
      );
    case 'awaiting_permission':
      return (
        <Pause
          role="img"
          aria-label="Awaiting permission"
          data-testid="session-status-awaiting"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-accent-primary)]"
          strokeWidth={2}
        />
      );
    case 'queued':
      return (
        <Hourglass
          role="img"
          aria-label="Queued"
          data-testid="session-status-queued"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
        />
      );
    case 'error':
      return (
        <AlertTriangle
          role="img"
          aria-label="Error"
          data-testid="session-status-error"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
          strokeWidth={1.5}
        />
      );
    default:
      return null;
  }
}

/** Whether a conversation has a non-idle run — lets callers swap their default
 *  leading icon for the {@link SessionStatusBadge}. */
export function useHasSessionStatus(conversationId: string): boolean {
  return useSessionRunStore((s) => {
    const status = s.runs[conversationId]?.status;
    return status !== undefined && status !== 'idle';
  });
}

/**
 * Leading icon for a history row (`CommandBarHistory`, `ChatHistoryView`): the
 * live run-state badge when the conversation has an active/errored run,
 * otherwise the default chat glyph. A fixed slot keeps the title baseline
 * aligned across both states. Extracted so the per-row hook isn't called inside
 * a `.map()`.
 */
export function HistoryRowLeadingIcon({ conversationId }: { conversationId: string }) {
  const hasStatus = useHasSessionStatus(conversationId);
  if (hasStatus) {
    return (
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <SessionStatusBadge conversationId={conversationId} />
      </span>
    );
  }
  return <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />;
}
