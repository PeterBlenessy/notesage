import { create } from "zustand";

import { tauriApi } from "@/lib/tauri";
import { log } from "@/lib/logger";
import { RECORDINGS_FOLDER_NAME, recordingsDir, resolveNotesRoot } from "@/lib/notes-root";
import {
  TRANSCRIPT_FILENAME,
  basename,
  joinPath,
  readRecordingManifest,
} from "@/lib/transcription/bundle";
import { isRecordingBundleName } from "@/hooks/useRecordingsInbox";
import type { RecordingManifest } from "@/lib/transcription/manifest";
import { useSettingsStore } from "@/stores/settings-store";
import { useInboxStore } from "@/stores/inbox-store";

/**
 * The Recordings place (Peter, 2026-09-07: *"I think inbox and recordings
 * should be visible also when empty"*).
 *
 * Recordings had no desktop surface at all — a bundle only ever appeared as a
 * card in the agent orb while its transcription was running, and once that
 * card aged out there was no way back to it short of Finder. A bundle that
 * FAILED was therefore invisible and unrecoverable in the app, even though
 * the manifest records the failure and the card offers a re-run.
 *
 * This store is deliberately read-only over the folder: the scanner
 * (`useRecordingsInbox`) owns dispatch, claiming and status writes, and two
 * writers on one manifest is exactly the race that file has spent its life
 * avoiding. Everything here lists and reads; the actions the view offers are
 * the existing ones (`startTranscription`, `moveBundleToProject`).
 */

/** What a bundle is doing, as far as its manifest and the folder can say. */
export type RecordingStatus = "pending" | "running" | "done" | "failed";

export interface RecordingBundle {
  /** Absolute path of the bundle folder. */
  dir: string;
  /** `Recording 2026-09-05 14-02-11` — the folder name. */
  name: string;
  status: RecordingStatus;
  /** RFC3339 with offset, from the manifest. */
  startedAt: string | null;
  /** Pause-aware length in seconds, from the manifest. */
  durationSecs: number | null;
  /** The recorder's label — *from Peter's iPhone*. Absent for this Mac's own. */
  device: string | null;
  /** Which device claimed or finished the transcription, when one did. */
  transcribedOn: string | null;
  /** The failure the manifest recorded, if the run failed. */
  error: string | null;
  /** Present once a transcript has been rendered into the bundle. */
  transcriptPath: string | null;
  audioPath: string | null;
  language: string | null;
}

interface RecordingsStore {
  open: boolean;
  /** Absolute path of `<library root>/Recordings`, once the root is known. */
  dir: string | null;
  /** A library root that wins over settings. Tests only; `null` in production. */
  rootOverride: string | null;
  bundles: RecordingBundle[];
  loading: boolean;
  error: string | null;

  openRecordings: () => void;
  closeRecordings: () => void;
  toggleRecordings: () => void;
  /** (Re)read the folder. Safe to call repeatedly. */
  load: () => Promise<void>;
  /** Bundles whose last run failed — the ones that want a decision. */
  failedCount: () => number;
}

function statusOf(manifest: RecordingManifest | null, transcriptExists: boolean): RecordingStatus {
  // The transcript on disk is the truth about "done": a manifest can say
  // `running` for ever if the app died mid-run, and the scanner's own
  // eligibility rule already treats the transcript as the completion mark.
  if (transcriptExists) return "done";
  const status = manifest?.transcription?.status;
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  return "pending";
}

/** Newest first — a recording you just made is the one you want. */
function byNewest(a: RecordingBundle, b: RecordingBundle): number {
  const at = a.startedAt ?? a.name;
  const bt = b.startedAt ?? b.name;
  return bt.localeCompare(at);
}

let loadSeq = 0;

export const useRecordingsStore = create<RecordingsStore>((set, get) => ({
  open: false,
  dir: null,
  rootOverride: null,
  bundles: [],
  loading: false,
  error: null,

  openRecordings: () => {
    // Both are modes of the document column and the column shows one thing.
    useInboxStore.getState().closeInbox();
    set({ open: true });
    void get().load();
  },
  closeRecordings: () => set({ open: false }),
  toggleRecordings: () => (get().open ? get().closeRecordings() : get().openRecordings()),

  load: async () => {
    const seq = ++loadSeq;
    const stale = () => seq !== loadSeq;
    const settings = useSettingsStore.getState();
    // Same root rule as the Inbox: the library the phone shares into is the
    // iCloud one when sync is on.
    const root =
      get().rootOverride ??
      settings.icloudNotesagePath ??
      resolveNotesRoot(settings.notesRootPath, settings.homeDir);
    if (!root) {
      set({ error: "library-root-unknown", loading: false });
      return;
    }
    const dir = recordingsDir(root);
    set({ dir, loading: true, error: null });

    try {
      const entries = await tauriApi.listFilesShallow(dir).catch(() => []);
      const dirs = entries
        .filter((e) => e.is_directory && isRecordingBundleName(e.name))
        .map((e) => e.path);

      const bundles = await Promise.all(
        dirs.map(async (bundleDir): Promise<RecordingBundle> => {
          const manifest = await readRecordingManifest(bundleDir).catch(() => null);
          const transcriptPath = joinPath(bundleDir, TRANSCRIPT_FILENAME);
          const transcriptExists = await tauriApi.pathExists(transcriptPath).catch(() => false);
          return {
            dir: bundleDir,
            name: basename(bundleDir),
            status: statusOf(manifest, transcriptExists),
            startedAt: manifest?.startedAt ?? null,
            durationSecs: manifest?.durationSecs ?? null,
            device: manifest?.createdBy?.device ?? null,
            transcribedOn: manifest?.transcription?.device ?? null,
            error: manifest?.transcription?.error ?? null,
            transcriptPath: transcriptExists ? transcriptPath : null,
            audioPath: manifest ? joinPath(bundleDir, manifest.audio.file) : null,
            language: manifest?.language ?? null,
          };
        }),
      );

      if (stale()) return;
      set({ bundles: bundles.sort(byNewest), loading: false });
    } catch (err) {
      if (stale()) return;
      log.warn("recordings", `Could not list ${RECORDINGS_FOLDER_NAME}`, err);
      set({ bundles: [], loading: false, error: String(err) });
    }
  },

  failedCount: () => get().bundles.filter((b) => b.status === "failed").length,
}));

/**
 * The other direction, as a subscription rather than an import.
 *
 * `openInbox` has several callers — the sidebar row, ⌘⇧I, a notification tap
 * — so closing Recordings inside each of them would be four places to forget.
 * Doing it from inbox-store instead would need it to import this module,
 * which imports inbox-store: a cycle. Watching the flag has neither problem.
 */
useInboxStore.subscribe((state, prev) => {
  if (state.open && !prev.open) useRecordingsStore.setState({ open: false });
});
