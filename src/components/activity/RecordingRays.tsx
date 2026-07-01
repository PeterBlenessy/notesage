import { cn } from '@/lib/utils';

/**
 * RecordingRays — a clock-style seconds indicator drawn just outside the orb's
 * border while a meeting recording is live. Up to 60 short rays ring the orb,
 * one per recorded second. The ring BUILDS UP: at second 0 a single ray shows,
 * and one more appears each second. The leading "comet" (the current second and
 * the previous 15) stays bright; once a ray ages past the comet it begins to
 * fade, so by the time the full minute is reached all 60 rays are present with
 * a gradient that decreases from the bright head around to the faint tail.
 *
 * Pure CSS/SVG: the parent re-renders this once per second (the same 1 Hz tick
 * that drives the elapsed-time text), so there is no smooth/continuous
 * animation — just a discrete step per second. Under reduced motion the sweep
 * is dropped for a static uniform ring; the elapsed-time text still conveys the
 * exact seconds, so no information is lost.
 */

export const TICK_COUNT = 60;
/** Current second + the 15 before it form the bright leading comet. */
export const COMET_LENGTH = 16;

const STATIC_OPACITY = 0.28;
const TAIL_FLOOR = 0.08;

/**
 * Opacity for the ray at `tickIndex` given total `elapsedSeconds` (may exceed
 * 60). Rays whose second has not been recorded yet are invisible (the first-
 * minute build-up). Reached rays use their `age` behind the head: the comet
 * window (age 0–15) fades gently from 1.0 → 0.6, then the tail decreases
 * gradually to the floor as age approaches 59.
 */
export function tickOpacity(tickIndex: number, elapsedSeconds: number): number {
  const elapsed = Math.max(0, Math.floor(elapsedSeconds));
  const head = elapsed % TICK_COUNT;
  const age = (((head - tickIndex) % TICK_COUNT) + TICK_COUNT) % TICK_COUNT;
  // Not yet reached during the first minute → not drawn.
  if (age > elapsed) return 0;
  // Bright comet window: head (1.0) fading to ~0.6 at the comet's trailing edge.
  if (age < COMET_LENGTH) {
    return 1 - (age / (COMET_LENGTH - 1)) * 0.4;
  }
  // Tail: continue from ~0.6 down to the floor across the remaining ages.
  const t = (age - (COMET_LENGTH - 1)) / (TICK_COUNT - (COMET_LENGTH - 1));
  return Math.max(TAIL_FLOOR, 0.6 - t * (0.6 - TAIL_FLOOR));
}

// SVG geometry — a 60-unit box (the orb is 46 px, the box extends 7 px past
// each edge via `-inset-[7px]`, so 1 viewBox unit ≈ 1 px). The orb body fills a
// ~23-unit radius; rays sit in the 25.5–29 ring just outside it.
const CENTER = 30;
const INNER_R = 25.5;
const OUTER_R = 29;

function tickLine(i: number) {
  // Start at 12 o'clock, sweep clockwise.
  const theta = (i / TICK_COUNT) * 2 * Math.PI - Math.PI / 2;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x1: CENTER + INNER_R * cos,
    y1: CENTER + INNER_R * sin,
    x2: CENTER + OUTER_R * cos,
    y2: CENTER + OUTER_R * sin,
  };
}

interface RecordingRaysProps {
  /** Recorded seconds (pause-aware, frozen while paused). */
  elapsedSeconds: number;
  /** Dim the whole ring while the recording is paused. */
  paused?: boolean;
  /** Drop the sweep for a static uniform ring. */
  reducedMotion?: boolean;
}

export function RecordingRays({ elapsedSeconds, paused, reducedMotion }: RecordingRaysProps) {
  return (
    <svg
      data-testid="recording-rays"
      // Explicit square size + translate-centering. Do NOT size via CSS insets:
      // WebKit (Tauri's renderer) doesn't reliably derive an <svg>'s box from
      // `inset`, so it falls back to a default size and the ring drifts off the
      // orb's centre (2026-06-07 regression). An explicit 60×60 box centred on
      // the parent keeps the viewBox 1:1 and concentric with the 46 px orb.
      width="60"
      height="60"
      className={cn(
        'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
        paused && 'opacity-50',
      )}
      viewBox="0 0 60 60"
      aria-hidden="true"
    >
      {Array.from({ length: TICK_COUNT }, (_, i) => {
        const { x1, y1, x2, y2 } = tickLine(i);
        const opacity = reducedMotion ? STATIC_OPACITY : tickOpacity(i, elapsedSeconds);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="var(--color-accent-primary)"
            strokeWidth={1.6}
            strokeLinecap="round"
            opacity={opacity}
          />
        );
      })}
    </svg>
  );
}

export default RecordingRays;
