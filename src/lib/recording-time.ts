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

/** `MM:SS` stopwatch rendering of an elapsed duration in milliseconds. */
export function formatStopwatchMs(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
