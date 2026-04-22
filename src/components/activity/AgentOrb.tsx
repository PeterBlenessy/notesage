import { Bot } from 'lucide-react';
import { useActivityStore } from '@/stores/activity-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/utils';
import { log, PERF } from '@/lib/logger';

/**
 * AgentOrb (#29) — 46 px ambient indicator pinned to the bottom-right of the
 * QuietLayout. Signals background agent activity:
 *
 * - When `activity-store.tasks.filter(t => t.status === 'running').length > 0`:
 *   pulses (subtle CSS keyframe, ~1.4 s ease-in-out scale + opacity) and shows
 *   a small count badge. The pulse is CSS-only — zero JS frame cost.
 * - Otherwise: static neutral circle with a subtle Bot glyph so the affordance
 *   is intentional rather than a stray dot.
 *
 * Hidden via `display: none` when `settings.cmdBarPinned` is true (#28) — the
 * pinned-panel mode covers the same screen real estate at the right edge.
 *
 * Renders as a `<button>` so Space/Enter activation comes from the platform.
 * The click handler is currently a placeholder (logs through `perf:orb`); the
 * actual orb panel arrives in tasks #79+.
 *
 * Reduced motion: when `useReducedMotion()` is true the `orb-pulsing` class is
 * omitted. The keyframe definition in globals.css also has a media-query
 * guard as defence-in-depth.
 */
export function AgentOrb() {
  const tasks = useActivityStore((s) => s.tasks);
  const cmdBarPinned = useSettingsStore((s) => s.cmdBarPinned);
  const reducedMotion = useReducedMotion();

  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const isActive = runningCount > 0;
  const shouldPulse = isActive && !reducedMotion;

  const ariaLabel =
    runningCount === 1
      ? 'Agent — 1 task running'
      : `Agent — ${runningCount} tasks running`;

  const handleClick = () => {
    log.info(PERF.orb, 'orb clicked', { runningTasks: runningCount });
  };

  return (
    <button
      type="button"
      data-testid="agent-orb"
      data-running={isActive ? 'true' : 'false'}
      aria-label={ariaLabel}
      onClick={handleClick}
      style={cmdBarPinned ? { display: 'none' } : undefined}
      className={cn(
        // Layout & position — fixed bottom-right with breathing room.
        'fixed bottom-6 right-6 z-40',
        'flex items-center justify-center',
        'h-[46px] w-[46px] rounded-full',
        // Surface — neutral dark surface in both themes, subtle elevation.
        'bg-foreground/85 text-background',
        'shadow-md ring-1 ring-border/50',
        // Hover/focus polish — gentle scale + ring tint, no chromatic accent.
        'transition-transform duration-150 ease-in-out',
        'hover:scale-105',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        // CSS-driven pulse while activity is in flight.
        shouldPulse && 'orb-pulsing',
      )}
    >
      {isActive ? (
        <span
          data-testid="agent-orb-badge"
          className="font-mono text-[10px] font-medium leading-none tabular-nums"
        >
          {runningCount}
        </span>
      ) : (
        // Idle: subtle Bot glyph — keeps the orb feeling intentional rather
        // than a stray dot. Muted opacity so it reads as ambient.
        <Bot
          className="h-4 w-4 opacity-60"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

export default AgentOrb;
