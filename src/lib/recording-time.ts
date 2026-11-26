/**
 * Pause-aware recorded-time math shared by every surface that shows a live
 * recording stopwatch (StatusTray MicButton via `useRecording`, the AgentOrb
 * badge, and the orb panel's RecordingCard).
 *
 * The recorded duration is wall-clock elapsed MINUS time spent paused. While
 * paused, the clock freezes at the instant the pause started.
 */

/**
 * Milliseconds of audio actually recorded.
 *
 * @param startTime      `recording-store.recordingStartTime` (epoch ms)
 * @param pausedTotalMs  accumulated duration of COMPLETED pause stretches
 * @param pauseStartedAt epoch ms of the current pause, or `null` when running
 * @param now            current epoch ms
 */
export function recordedElapsedMs(
  startTime: number,
  pausedTotalMs: number,
  pauseStartedAt: number | null,
  now: number,
): number {
  const end = pauseStartedAt ?? now;
  return Math.max(0, end - startTime - pausedTotalMs);
}

/**
 * THE recorded-time format, used by every surface that shows a recording's
 * length (indicator, orb, cards, toasts): `mm:ss`, and `h:mm:ss` from one
 * hour. Three surfaces used to render the same instant three ways
 * (`1:05:13`, `65:13`, `65:12`).
 */
export function formatRecordedTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return total >= 3600 ? `${Math.floor(total / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Stopwatch rendering of an elapsed duration in milliseconds (see `formatRecordedTime`). */
export function formatStopwatchMs(elapsedMs: number): string {
  return formatRecordedTime(Math.max(0, elapsedMs) / 1000);
}
