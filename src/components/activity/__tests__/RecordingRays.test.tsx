// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from '@/test/component-harness';
import { RecordingRays, tickOpacity, TICK_COUNT } from '../RecordingRays';

describe('tickOpacity', () => {
  it('is brightest at the current second (age 0)', () => {
    // elapsed 30 → head at tick 30, age 0.
    expect(tickOpacity(30, 30)).toBe(1);
  });

  it('hides rays whose second has not been recorded yet (first-minute build-up)', () => {
    // At elapsed 0 only the head ray (tick 0) shows; everything else is unreached.
    expect(tickOpacity(0, 0)).toBe(1);
    expect(tickOpacity(1, 0)).toBe(0);
    expect(tickOpacity(59, 0)).toBe(0);

    // At elapsed 5, ticks 0–5 are reached; tick 6+ is still invisible.
    for (let i = 0; i <= 5; i++) expect(tickOpacity(i, 5)).toBeGreaterThan(0);
    expect(tickOpacity(6, 5)).toBe(0);
    expect(tickOpacity(30, 5)).toBe(0);
  });

  it('fades across the comet, then gradually down the tail to a floor', () => {
    // elapsed 120 → head at tick 0, every ray reached. Age = (60 - i) % 60.
    const head = tickOpacity(0, 120); // age 0
    const cometTail = tickOpacity(45, 120); // age 15
    const justPast = tickOpacity(44, 120); // age 16
    const oldest = tickOpacity(1, 120); // age 59

    expect(head).toBe(1);
    expect(head).toBeGreaterThan(cometTail);
    expect(cometTail).toBeGreaterThan(0.55); // comet stays bright
    expect(justPast).toBeLessThan(cometTail); // tail begins below the comet
    // Tail decreases monotonically toward the floor.
    expect(justPast).toBeGreaterThan(oldest);
    expect(oldest).toBeGreaterThanOrEqual(0.08);
    expect(oldest).toBeLessThan(0.12);
  });

  it('wraps around the minute once past 60s (comet crosses the 0/59 boundary)', () => {
    // elapsed 62 → head at tick 2; tick 59 is age 3 (inside the comet).
    expect(tickOpacity(2, 62)).toBe(1); // age 0
    expect(tickOpacity(59, 62)).toBeGreaterThan(0.6); // age 3 — comet
    // tick 3 is age 59 — the oldest ray, deep in the tail.
    expect(tickOpacity(3, 62)).toBeLessThan(0.2);
  });
});

describe('RecordingRays', () => {
  it('renders one line per second of the minute', () => {
    const { container } = renderWithProviders(<RecordingRays elapsedSeconds={12} />);
    expect(screen.getByTestId('recording-rays')).toBeTruthy();
    expect(container.querySelectorAll('line')).toHaveLength(TICK_COUNT);
  });

  it('dims the whole ring while paused', () => {
    renderWithProviders(<RecordingRays elapsedSeconds={5} paused />);
    expect(screen.getByTestId('recording-rays').getAttribute('class')).toContain('opacity-50');
  });

  it('uses a uniform static ring under reduced motion (no per-second comet)', () => {
    const { container } = renderWithProviders(
      <RecordingRays elapsedSeconds={5} reducedMotion />,
    );
    const opacities = Array.from(container.querySelectorAll('line')).map((l) =>
      l.getAttribute('opacity'),
    );
    // Every ray shares the same opacity — no bright comet head.
    expect(new Set(opacities).size).toBe(1);
  });
});
