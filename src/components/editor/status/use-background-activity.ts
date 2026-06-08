import { useEffect, useState } from "react";
import { useRecordingStore } from "@/stores/recording-store";

/**
 * Combined background-activity progress for the status strip's dual-indicator
 * dot (issue #415). Two transient signals share one progress ring:
 *
 *   - SQLite document indexing (`index-progress` / `index-ready` Tauri events)
 *   - Whisper transcription-model downloads (`recording-store.activeDownloads`)
 *
 * Both are determinate, so the ring fills as a fraction (0–1). Indexing wins
 * when both are live (it is the more disruptive "wait" the user is watching).
 * Returns `active: false` with a `null` fraction when nothing is in flight.
 */
export interface BackgroundActivity {
  active: boolean;
  /** Progress fraction 0–1, or `null` when idle. */
  fraction: number | null;
  /** Human-readable label for the dot tooltip, or `null` when idle. */
  label: string | null;
}

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

  // Indexing takes precedence — it is the startup "wait" users watch for.
  if (indexing && indexing.total > 0) {
    return {
      active: true,
      fraction: Math.min(1, indexing.current / indexing.total),
      label: `Indexing ${indexing.current}/${indexing.total}`,
    };
  }

  if (downloadEntries.length > 0) {
    // Average percent across active downloads (0–100 → 0–1).
    const avg =
      downloadEntries.reduce((sum, [, s]) => sum + (s.progress ?? 0), 0) /
      downloadEntries.length /
      100;
    const label =
      downloadEntries.length === 1
        ? `Downloading model ${Math.round(avg * 100)}%`
        : `Downloading ${downloadEntries.length} models ${Math.round(avg * 100)}%`;
    return { active: true, fraction: Math.min(1, avg), label };
  }

  return { active: false, fraction: null, label: null };
}
