import { useEffect, useState } from 'react';
import { Bot, Mic } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useActivityStore } from '@/stores/activity-store';
import { useRecordingStore } from '@/stores/recording-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { recordedElapsedMs, formatStopwatchMs } from '@/lib/recording-time';
import { cn } from '@/lib/utils';
import { log, PERF } from '@/lib/logger';
import { subscribeToAgentOrbEvents } from '@/lib/agent-orb-events';
import type { AgentTask } from '@/stores/activity-store';
import { AgentPanel } from './AgentPanel';
import { RecordingRays } from './RecordingRays';

export interface AgentOrbProps {
  /**
   * Cancel a running agent task. Forwarded to `AgentPanel` so the cancel
   * affordance on each task row terminates the task. Without this the
   * tasks render but cannot be cancelled (#130 gap).
   */
  onCancelTask?: (taskId: string) => void | Promise<void>;
  /**
   * Click-to-navigate on a completed task. Forwarded to `AgentPanel` so
   * task rows jump back to the source comment / document. Without this
   * the tasks render but do not navigate (#130 gap).
   */
  onClickTask?: (task: AgentTask) => void;
}

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
 *
 * CSS-cascade note (#119): the pulse keyframe writes raw `transform: scale(X)`
 * values. Tailwind's `hover:scale-105` utility engages the composed-transform
 * chain (`translate(...) rotate(...) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))`),
 * which resolves to `scale(1)` when not hovered and overrides the keyframe's
 * `scale(1.05)` frame. To keep both affordances live without interference,
 * the hover-scale + transition sit on the `<button>` (user interaction), and
 * the ambient pulse sits on an inner absolutely-positioned wrapper that has no
 * transform utilities — the keyframe wins on that element.
 */
export function AgentOrb({ onCancelTask, onClickTask }: AgentOrbProps = {}) {
  const tasks = useActivityStore((s) => s.tasks);
  const cmdBarPinned = useSettingsStore((s) => s.cmdBarPinned);
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);

  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const isActive = runningCount > 0;
  // The box-shadow PULSE is reserved for agent activity. A live recording gets
  // its own visual language — the seconds-ray ring (RecordingRays) — so the two
  // states never read alike. Pulse therefore keys off NON-recording running
  // tasks only; a recording alone shows rays, not a pulse.
  const runningNonRecordingCount = tasks.filter(
    (t) => t.status === 'running' && t.kind !== 'recording',
  ).length;
  const recordingPausedStore = useRecordingStore((s) => s.isPaused);
  const shouldPulse = runningNonRecordingCount > 0 && !reducedMotion;

  // Recording state — the orb narrates the live-capture leg of the
  // Recording → Transcribing → Ready story. We surface the EARLIEST active
  // recording's elapsed time (there is normally just one) as an `MM:SS`
  // stopwatch driven by a 1 s text tick. This is plain text, not an
  // animation, so it does not interact with the reduced-motion gate on the
  // CSS pulse — it stays correct regardless of the motion preference.
  // Pause state comes from recording-store (the live-capture source of
  // truth): while paused the stopwatch freezes and the resumed time
  // excludes the paused stretch.
  const activeRecordingStart = tasks
    .filter((t) => t.kind === 'recording' && t.status === 'running')
    .map((t) => t.recordingStartedAt ?? t.startedAt)
    .sort((a, b) => a - b)[0];
  const isRecording = activeRecordingStart !== undefined;
  const isPaused = recordingPausedStore;
  const pauseStartedAt = useRecordingStore((s) => s.pauseStartedAt);
  const pausedTotalMs = useRecordingStore((s) => s.pausedTotalMs);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRecording) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  const recordingElapsedMs = isRecording
    ? recordedElapsedMs(activeRecordingStart!, pausedTotalMs, pauseStartedAt, now)
    : 0;
  const recordingElapsed = isRecording ? formatStopwatchMs(recordingElapsedMs) : null;

  const ariaLabel = isRecording
    ? isPaused
      ? `Recording paused — ${recordingElapsed}`
      : `Recording — ${recordingElapsed}`
    : runningCount === 1
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

  // ⌘⇧A handler (#121) — the keyboard hook emits `{ type: 'toggle' }` on the
  // agent-orb bus under Quiet Composer. We flip the popover's open state,
  // reusing `handleOpenChange` so the perf:orb breadcrumb still fires when
  // the chord opens the panel (matching the click path). Radix handles focus
  // trapping and focus restoration automatically via the PopoverContent.
  useEffect(() => {
    return subscribeToAgentOrbEvents((event) => {
      if (event.type === 'toggle') {
        handleOpenChange(!open);
      }
    });
    // `handleOpenChange` closes over `open` + `runningCount`; re-subscribe
    // when `open` flips so the toggle reads the current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runningCount]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <TooltipProvider delayDuration={500}>
        <Tooltip>
          <TooltipTrigger asChild>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="agent-orb"
          data-running={isActive ? 'true' : 'false'}
          // Test hook (#121) — exposes the popover's open state on the DOM so
          // the composition tests can assert toggle behaviour without having
          // to introspect Radix's portal structure under jsdom. Production
          // code does not read this attribute; it's purely for observability.
          data-orb-open={open ? 'true' : 'false'}
          aria-label={ariaLabel}
          style={cmdBarPinned ? { display: 'none' } : undefined}
          className={cn(
            // Layout & position — fixed bottom-right. The bottom offset
            // matches FloatingCommandBar's `bottom-10` so both sit on the
            // same vertical baseline (orb and bar share the bottom edge).
            // `fixed` also establishes the positioning context for the
            // inner pulse wrapper's `absolute inset-0` — NO explicit
            // `relative` utility (it would win the cascade over `fixed`
            // and drop the orb into document flow; 2026-04-24 regression).
            'group fixed bottom-10 right-6 z-40',
            'h-[46px] w-[46px] rounded-full',
            // #106 hover/focus polish — gentle scale + soft shadow glow
            // so the orb reads as interactive without being loud. The
            // shadow lives on the outer button so it expands outward;
            // the pulse ring on the inner wrapper is unaffected. Scale
            // stays subtle (1.05) — the tooltip + shadow carry the
            // hover signal now, so the scale alone doesn't have to.
            // Live-test 2026-04-26 — slower, more pronounced hover so
            // the orb reads as a real "I'm interactive" affordance:
            // 150 ms → 220 ms, scale 1.05 → 1.10, plus a slight
            // brightness lift via shadow.
            'transition-[transform,box-shadow] duration-[220ms] ease-out',
            'hover:scale-[1.10] hover:shadow-xl',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <span
            // Inner wrapper carries the ambient pulse. It has NO transform
            // utilities (no `hover:scale-*`, no `transform`) so the keyframe's
            // raw `transform: scale(1.05)` frame lands without Tailwind's
            // composed-transform chain resolving to `scale(1)` and overriding.
            data-testid="agent-orb-pulse"
            className={cn(
              'absolute inset-0',
              'flex items-center justify-center',
              'rounded-full',
              // Surface — neutral ambient chrome. The orb body matches other
              // popover surfaces (bg-popover + border-border) so it doesn't
              // shout for attention while idle. The accent now lives ONLY in
              // the pulsing ring (box-shadow keyframe driven by `.orb-pulsing`)
              // so the "I'm running" signal still pops without painting the
              // whole orb body.
              'bg-popover text-popover-foreground',
              'shadow-md border border-border',
              // CSS-driven pulse while activity is in flight — paints the
              // accent ring around the orb. See `@keyframes orb-pulse` in
              // globals.css for the box-shadow chain.
              shouldPulse && 'orb-pulsing',
            )}
          >
            {/* Recording seconds-ray ring — sits just outside the orb body,
                distinct from the agent-activity pulse. */}
            {isRecording && (
              <RecordingRays
                elapsedSeconds={recordingElapsedMs / 1000}
                paused={isPaused}
                reducedMotion={reducedMotion}
              />
            )}
            {isRecording ? (
              // Recording leg — a mic glyph + the live elapsed time so the orb
              // reads as "I'm capturing" rather than a generic running count.
              <span
                data-testid="agent-orb-recording"
                className="flex flex-col items-center justify-center gap-0.5 leading-none"
              >
                <Mic
                  className="h-3.5 w-3.5 text-[var(--color-accent-primary)]"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <span className="font-mono text-[8px] font-medium tabular-nums text-[var(--color-accent-primary)]">
                  {recordingElapsed}
                </span>
              </span>
            ) : isActive ? (
              <span
                data-testid="agent-orb-badge"
                className="font-mono text-[10px] font-medium leading-none tabular-nums"
              >
                {runningCount}
              </span>
            ) : (
              // Idle: subtle Bot glyph — keeps the orb feeling intentional rather
              // than a stray dot. Muted opacity so it reads as ambient.
              // Live-test 2026-04-26 — bumped to h-5 w-5 (~25% larger) so the
              // glyph reads more clearly inside the 46 px orb without crowding,
              // and flips to white on hover (paired with `group` on the outer
              // button) so the affordance has a stronger interactive lift.
              <Bot
                className="h-5 w-5 opacity-60 transition-colors duration-[220ms] ease-out group-hover:text-popover-foreground group-hover:opacity-100"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            )}
          </span>
        </button>
      </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={10}>
            {ariaLabel}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        aria-label="Agent activity"
        // Override the popover default (w-72 + p-4) — AgentPanel manages its
        // own width and padding so the list fills the popover cleanly.
        className="w-auto p-0"
        // Don't auto-focus the first button inside the panel on open — Radix's
        // default lands focus on e.g. the recording card's pause button, which
        // paints the accent focus ring (and would auto-open its focus-triggered
        // tooltip). Focus stays on the orb; Tab still reaches the controls.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <AgentPanel onCancelTask={onCancelTask} onClickTask={onClickTask} />
      </PopoverContent>
    </Popover>
  );
}

export default AgentOrb;
