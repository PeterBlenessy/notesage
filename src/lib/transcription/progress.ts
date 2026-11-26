/**
 * Time estimates for a running transcription. Pure.
 *
 * The backend reports an integer percent. The rate is measured from the first
 * real progress (the "anchor"), not from when the job was queued: loading the
 * model and decoding the audio take time during which the percent does not
 * move, and counting them would make every estimate start absurdly high.
 */

export interface ProgressSample {
  /** Current integer percent, 0..100. */
  percent: number;
  /** ms-epoch of the first percent above zero. */
  anchorAt?: number;
  /** The percent at that moment. */
  anchorPercent?: number;
  now: number;
}

/** Below this much observed progress the rate is noise. */
const MIN_PERCENT_OBSERVED = 3;
/** And below this much time, likewise. */
const MIN_ELAPSED_MS = 10_000;

/**
 * Milliseconds left at the rate seen so far, or `null` while there is not yet
 * enough progress to say anything honest.
 */
export function estimateRemainingMs(sample: ProgressSample): number | null {
  const { percent, anchorAt, anchorPercent, now } = sample;
  if (anchorAt === undefined || anchorPercent === undefined) return null;
  if (!Number.isFinite(percent) || percent >= 100) return null;
  const done = percent - anchorPercent;
  const elapsed = now - anchorAt;
  if (done < MIN_PERCENT_OBSERVED || elapsed < MIN_ELAPSED_MS) return null;
  return Math.max(0, Math.round((elapsed / done) * (100 - percent)));
}

/**
 * A duration as the coarse parts a person reads in a status line: whole
 * minutes from a minute up (to the nearest; it is prefixed "about"), else
 * seconds rounded to five.
 */
export function coarseDuration(ms: number): { unit: 'minutes' | 'seconds'; value: number } {
  const secs = Math.max(0, ms) / 1000;
  if (secs >= 60) return { unit: 'minutes', value: Math.max(1, Math.round(secs / 60)) };
  return { unit: 'seconds', value: Math.max(5, Math.round(secs / 5) * 5) };
}

/** Elapsed time as `m:ss` / `h:mm:ss`, for the running job's clock. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
