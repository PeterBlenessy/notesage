import { describe, it, expect } from 'vitest';
import { recordedElapsedMs, formatStopwatchMs } from '@/lib/recording-time';

describe('recordedElapsedMs', () => {
  const start = 1_000_000;

  it('is plain wall-clock elapsed when never paused', () => {
    expect(recordedElapsedMs(start, 0, null, start + 65_000)).toBe(65_000);
  });

  it('excludes completed pause stretches', () => {
    // 60 s wall clock, 20 s of it paused → 40 s recorded.
    expect(recordedElapsedMs(start, 20_000, null, start + 60_000)).toBe(40_000);
  });

  it('freezes at the pause instant while currently paused', () => {
    // Paused at +10 s; clock now at +50 s → still 10 s recorded.
    expect(recordedElapsedMs(start, 0, start + 10_000, start + 50_000)).toBe(10_000);
    // A prior completed 5 s pause is also excluded.
    expect(recordedElapsedMs(start, 5_000, start + 10_000, start + 50_000)).toBe(5_000);
  });

  it('never goes negative', () => {
    expect(recordedElapsedMs(start, 999_999, null, start + 1_000)).toBe(0);
  });
});

describe('formatStopwatchMs', () => {
  it('renders MM:SS with zero padding', () => {
    expect(formatStopwatchMs(0)).toBe('00:00');
    expect(formatStopwatchMs(65_000)).toBe('01:05');
    expect(formatStopwatchMs(599_000)).toBe('09:59');
    expect(formatStopwatchMs(3_600_000)).toBe('60:00');
  });

  it('floors sub-second remainders and clamps negatives', () => {
    expect(formatStopwatchMs(999)).toBe('00:00');
    expect(formatStopwatchMs(-5_000)).toBe('00:00');
  });
});
