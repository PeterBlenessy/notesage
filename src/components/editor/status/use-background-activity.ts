import { useEffect, useState } from "react";
import { useRecordingStore } from "@/stores/recording-store";
import { useIndexProgressStore } from "@/stores/index-progress-store";
import { useFormatLocale } from "@/lib/useLocale";
import { t } from "@/lib/i18n";
import { indexingLabel } from "@/lib/indexing-label";

/**
 * The one background activity worth an ambient indicator right now (the bar
 * along the sidebar footer, the line in the status tray). Two sources:
 *
 *   - Indexing the library (`index-progress-store`, which adds the per-scope
 *     passes up into one total and owns its own show delay and hide grace).
 *   - Whisper transcription-model downloads (`recording-store.activeDownloads`).
 *
 * Indexing wins when both are live: it is what makes search, tags, mentions
 * and tasks incomplete, so it is the one the user needs to know about.
 *
 * This hook registers no Tauri listeners. `useIndexProgressListener`, mounted
 * once in App.tsx, feeds the store; any number of components can call this.
 */
export interface BackgroundActivity {
  active: boolean;
  /** Which source `label` describes, or `null` when idle. */
  kind: "indexing" | "download" | null;
  /** Progress fraction 0–1, or `null` when idle or indeterminate. */
  fraction: number | null;
  /** Human-readable, translated label, or `null` when idle. */
  label: string | null;
  /** No meaningful fraction yet (indexing before its totals are known). */
  indeterminate: boolean;
}

const IDLE: BackgroundActivity = {
  active: false,
  kind: null,
  fraction: null,
  label: null,
  indeterminate: false,
};

/**
 * Grace period (ms) the download indicator lingers after the last download
 * ends, so one model finishing just before the next starts does not flash it
 * off and on. Indexing has the same grace, applied in its store.
 */
const HIDE_GRACE_MS = 700;

export function useBackgroundActivity(): BackgroundActivity {
  // Labels hold formatted numbers: re-render when the language changes.
  useFormatLocale();
  const indexing = useIndexProgressStore((s) => s.status);

  const activeDownloads = useRecordingStore((s) => s.activeDownloads);
  const downloadEntries = Object.entries(activeDownloads);

  let download: BackgroundActivity = IDLE;
  if (downloadEntries.length > 0) {
    // Average percent across active downloads (0–100 → 0–1).
    const avg =
      downloadEntries.reduce((sum, [, s]) => sum + (s.progress ?? 0), 0) /
      downloadEntries.length /
      100;
    const percent = Math.round(avg * 100);
    const label =
      downloadEntries.length === 1
        ? t("activity.downloadingModel", { percent })
        : t("activity.downloadingModels", { models: downloadEntries.length, percent });
    download = {
      active: true,
      kind: "download",
      fraction: Math.min(1, avg),
      label,
      indeterminate: false,
    };
  }

  // Debounced view of the downloads: live at once, lingering HIDE_GRACE_MS
  // after they stop. Re-activating within the window cancels the pending hide.
  const [shownDownload, setShownDownload] = useState<BackgroundActivity>(download);
  useEffect(() => {
    if (download.active) {
      setShownDownload(download);
      return;
    }
    const timer = setTimeout(() => setShownDownload(IDLE), HIDE_GRACE_MS);
    return () => clearTimeout(timer);
    // Primitive deps — `download` is rebuilt each render, so depend on its fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [download.active, download.fraction, download.label]);

  if (indexing.active) {
    return {
      active: true,
      kind: "indexing",
      fraction: indexing.fraction,
      label: indexingLabel(indexing),
      indeterminate: indexing.fraction === null,
    };
  }
  return shownDownload;
}
