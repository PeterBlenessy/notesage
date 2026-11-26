import { describe, it, expect } from 'vitest';
import { recordedElapsedMs, formatRecordedTime, formatStopwatchMs } from '@/lib/recording-time';

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
    expect(formatStopwatchMs(3_599_000)).toBe('59:59');
  });

  it('floors sub-second remainders and clamps negatives', () => {
    expect(formatStopwatchMs(999)).toBe('00:00');
    expect(formatStopwatchMs(-5_000)).toBe('00:00');
  });

  it('is the same format as formatRecordedTime, to the second', () => {
    for (const ms of [0, 999, 65_000, 3_599_999, 3_600_000, 3_913_000, 36_000_000]) {
      expect(formatStopwatchMs(ms)).toBe(formatRecordedTime(ms / 1000));
    }
  });
});

// U9: the header said `1:05:13`, the card `65:13` and the orb `65:12` for the
// same recording. One function, one format.
describe('formatRecordedTime', () => {
  it('is mm:ss below an hour', () => {
    expect(formatRecordedTime(0)).toBe('00:00');
    expect(formatRecordedTime(75)).toBe('01:15');
    expect(formatRecordedTime(3599)).toBe('59:59');
  });

  it('is h:mm:ss from one hour, never minutes above 59', () => {
    expect(formatRecordedTime(3600)).toBe('1:00:00');
    expect(formatRecordedTime(3913)).toBe('1:05:13');
    expect(formatRecordedTime(4503)).toBe('1:15:03');
    expect(formatRecordedTime(36_000)).toBe('10:00:00');
  });

  it('floors fractions and survives nonsense', () => {
    expect(formatRecordedTime(59.9)).toBe('00:59');
    expect(formatRecordedTime(-3)).toBe('00:00');
    expect(formatRecordedTime(Number.NaN)).toBe('00:00');
  });
});
