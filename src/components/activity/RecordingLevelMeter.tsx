import { useEffect, useRef } from 'react';
import { readRecordingLevels, type RecordingSource } from '@/stores/recording-store';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Levels older than this are treated as silence: the capture has gone quiet or stalled. */
const STALE_MS = 1500;
/** Per-frame fall-off, so a peak is visible for longer than the 100 ms it was measured over. */
const DECAY = 0.86;
/** The quietest level the meter shows anything for. */
const FLOOR_DB = -54;

/**
 * Peak 0..1 → bar length 0..1 on a decibel scale. Speech peaks sit between
 * roughly -30 and -6 dB; drawn linearly they would barely leave the left edge.
 */
export function levelToMeter(peak: number | null): number {
  if (peak === null || !(peak > 0)) return 0;
  const db = 20 * Math.log10(Math.min(1, peak));
  return Math.min(1, Math.max(0, 1 - db / FLOOR_DB));
}

function captures(source: RecordingSource): { mic: boolean; system: boolean } {
  return { mic: source !== 'system', system: source !== 'microphone' };
}

/**
 * Proof that sound is reaching the recording: one bar per captured source.
 *
 * Driven entirely outside React. The backend's `recording-level` events land
 * in a plain object (`readRecordingLevels`); this component reads it from a
 * `requestAnimationFrame` loop and writes a `transform` on the bars. After
 * mount it never renders again because of a level — a test counts.
 */
export function RecordingLevelMeter({
  source,
  paused = false,
  className,
}: {
  source: RecordingSource;
  /** While paused nothing is captured: the bars rest at zero and the loop stops. */
  paused?: boolean;
  className?: string;
}) {
  const micRef = useRef<HTMLSpanElement>(null);
  const systemRef = useRef<HTMLSpanElement>(null);
  const { mic, system } = captures(source);

  useEffect(() => {
    const shown = { mic: 0, system: 0 };
    const paint = (el: HTMLSpanElement | null, value: number) => {
      if (el) el.style.transform = `scaleX(${value.toFixed(3)})`;
    };
    if (paused) {
      paint(micRef.current, 0);
      paint(systemRef.current, 0);
      return;
    }
    let raf = 0;
    const frame = () => {
      const now = readRecordingLevels();
      const fresh = Date.now() - now.at < STALE_MS;
      shown.mic = Math.max(fresh ? levelToMeter(now.mic) : 0, shown.mic * DECAY);
      shown.system = Math.max(fresh ? levelToMeter(now.system) : 0, shown.system * DECAY);
      paint(micRef.current, shown.mic);
      paint(systemRef.current, shown.system);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [paused, source]);

  const bar = (ref: React.RefObject<HTMLSpanElement | null>, name: 'mic' | 'system') => (
    <span
      data-level-track={name}
      className="block h-[3px] w-full overflow-hidden rounded-full bg-foreground/15"
    >
      <span
        ref={ref}
        data-level-bar={name}
        className="block h-full w-full origin-left rounded-full bg-foreground/70"
        style={{ transform: 'scaleX(0)' }}
      />
    </span>
  );

  return (
    <span
      role="img"
      aria-label={
        source === 'both'
          ? t("recording.meter.both")
          : source === 'system'
            ? t("recording.meter.system")
            : t("recording.meter.microphone")
      }
      data-recording-meter
      className={cn('inline-flex w-7 shrink-0 flex-col justify-center gap-[2px]', className)}
    >
      {mic ? bar(micRef, 'mic') : null}
      {system ? bar(systemRef, 'system') : null}
    </span>
  );
}
