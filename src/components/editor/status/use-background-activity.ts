import { useEffect, useState } from "react";
import { useRecordingStore } from "@/stores/recording-store";

/**
 * Combined background-activity progress for the status strip's dual-indicator
 * dot (issue #415). Two transient signals share one progress ring:
 *
 *   - SQLite document indexing (`index-progress` / `index-ready` Tauri events)
 *   - Whisper transcription-model downloads (`recording-store.activeDownloads`)
 *
 * Indexing is rendered as an INDETERMINATE spinner: at startup it runs as a
 * burst of separate passes (global index + one per project), each with its own
 * `current/total`, so a determinate arc would jump backwards and flash off
 * between passes. A spinner reads as one continuous "working" state. Downloads
 * stay DETERMINATE (a real 0–100% the user watches). Indexing wins when both
 * are live (it is the more disruptive startup "wait").
 *
 * The visible state is debounced on its falling edge (`HIDE_GRACE_MS`) so the
 * gaps between index passes don't unmount/remount the indicator — the spinner
 * stays continuous across the whole burst, then hides once everything settles.
 */
export interface BackgroundActivity {
  active: boolean;
  /** Progress fraction 0–1, or `null` when idle. Meaningful only when `!indeterminate`. */
  fraction: number | null;
  /** Human-readable label for the dot tooltip, or `null` when idle. */
  label: string | null;
  /** Indeterminate (spinner) vs determinate (fill). Indexing spins; downloads fill. */
  indeterminate: boolean;
}

const IDLE: BackgroundActivity = {
  active: false,
  fraction: null,
  label: null,
  indeterminate: false,
};

/**
 * Grace period (ms) the indicator lingers after activity stops, so the rapid
 * burst of separate index passes at startup reads as ONE continuous spinner
 * instead of flashing off and on between passes.
 */
const HIDE_GRACE_MS = 700;

export function useBackgroundActivity(): BackgroundActivity {
  const [indexing, setIndexing] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenReady: (() => void) | undefined;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ current: number; total: number }>("index-progress", (event) => {
        setIndexing(event.payload);
      }).then((fn) => { unlistenProgress = fn; });

      listen("index-ready", () => {
        setIndexing(null);
      }).then((fn) => { unlistenReady = fn; });
    });

    return () => { unlistenProgress?.(); unlistenReady?.(); };
  }, []);

  const activeDownloads = useRecordingStore((s) => s.activeDownloads);
  const downloadEntries = Object.entries(activeDownloads);

  // Raw (instantaneous) activity. Indexing takes precedence — it is the startup
  // "wait" users watch for.
  let raw: BackgroundActivity = IDLE;
  if (indexing && indexing.total > 0) {
    raw = {
      active: true,
      fraction: Math.min(1, indexing.current / indexing.total),
      label: `Indexing ${indexing.current}/${indexing.total}`,
      indeterminate: true,
    };
  } else if (downloadEntries.length > 0) {
    // Average percent across active downloads (0–100 → 0–1).
    const avg =
      downloadEntries.reduce((sum, [, s]) => sum + (s.progress ?? 0), 0) /
      downloadEntries.length /
      100;
    const label =
      downloadEntries.length === 1
        ? `Downloading model ${Math.round(avg * 100)}%`
        : `Downloading ${downloadEntries.length} models ${Math.round(avg * 100)}%`;
    raw = { active: true, fraction: Math.min(1, avg), label, indeterminate: false };
  }

  // Debounced view: reflect activity immediately when live, but linger for
  // HIDE_GRACE_MS after it stops so brief gaps between index passes don't flash
  // the indicator off. Re-activating within the window cancels the pending hide.
  const [shown, setShown] = useState<BackgroundActivity>(raw);
  useEffect(() => {
    if (raw.active) {
      setShown(raw);
      return;
    }
    const t = setTimeout(() => setShown(IDLE), HIDE_GRACE_MS);
    return () => clearTimeout(t);
    // Primitive deps — `raw` is rebuilt each render, so depend on its fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw.active, raw.fraction, raw.label, raw.indeterminate]);

  return shown;
}
