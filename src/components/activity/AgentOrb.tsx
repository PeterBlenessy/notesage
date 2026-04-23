import { useState } from 'react';
import { Bot } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useActivityStore } from '@/stores/activity-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/utils';
import { log, PERF } from '@/lib/logger';
import { AgentPanel } from './AgentPanel';

/**
 * AgentOrb (#29 + #79) — 46 px ambient indicator pinned to the bottom-right of
 * the QuietLayout. Signals background agent activity:
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
 * Renders as a `<button>` (via `PopoverTrigger asChild`) so Space/Enter
 * activation comes from the platform. Clicking (or Enter) opens the
 * `AgentPanel` inside a shadcn `Popover`, which provides focus trapping,
 * Esc-to-close, and focus restoration back to the orb on close (task #79).
 *
 * Reduced motion: when `useReducedMotion()` is true the `orb-pulsing` class is
 * omitted. The keyframe definition in globals.css also has a media-query
 * guard as defence-in-depth.
 */
export function AgentOrb() {
  const tasks = useActivityStore((s) => s.tasks);
  const cmdBarPinned = useSettingsStore((s) => s.cmdBarPinned);
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);

  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const isActive = runningCount > 0;
  const shouldPulse = isActive && !reducedMotion;

  const ariaLabel =
    runningCount === 1
      ? 'Agent — 1 task running'
      : `Agent — ${runningCount} tasks running`;

  // Log when the panel opens — keeps the perf:orb breadcrumb that existed on
  // the pre-#79 click stub. Only fires on the open transition, not on close.
  const handleOpenChange = (next: boolean) => {
    if (next && !open) {
      log.info(PERF.orb, 'orb clicked', { runningTasks: runningCount });
    }
    setOpen(next);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="agent-orb"
          data-running={isActive ? 'true' : 'false'}
          aria-label={ariaLabel}
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
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        aria-label="Agent activity"
        // Override the popover default (w-72 + p-4) — AgentPanel manages its
        // own width and padding so the list fills the popover cleanly.
        className="w-auto p-0"
      >
        <AgentPanel />
      </PopoverContent>
    </Popover>
  );
}

export default AgentOrb;
