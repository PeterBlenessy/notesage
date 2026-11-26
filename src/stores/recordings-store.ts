import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";

import { tauriApi, type FileEntry, type ImportProgressEvent } from "@/lib/tauri";
import { log } from "@/lib/logger";
import { t } from "@/lib/i18n";
import { appVersion } from "@/lib/version";
import { RECORDINGS_FOLDER_NAME, recordingsDir, resolveNotesRoot } from "@/lib/notes-root";
import {
  basename,
  dirname,
  findAudioFile,
  joinPath,
  moveBundleToProject,
  readRecordingManifest,
  recordingTitle,
  transcriptFileOf,
  writeRecordingManifest,
} from "@/lib/transcription/bundle";
import {
  RUNNING_CLAIM_TTL_MS,
  isRecordingBundleName,
} from "@/hooks/useRecordingsInbox";
import { findTranscriptionTask, startTranscription } from "@/hooks/useTranscriptionJob";
import {
  RECORDING_MANIFEST,
  createMacRecordingManifest,
  type RecordingManifest,
  type RecordingSource,
} from "@/lib/transcription/manifest";
import { isImportCancellation } from "@/lib/transcription/errors";
import { SPEAKERS_FILENAME, SPEAKER_ME, SPEAKER_OTHERS, speakerDisplayName } from "@/lib/transcription/segments";
import {
  TEAMS_TRANSCRIPT_STEM,
  adoptOrphanBundle,
  defaultSpeakerNames,
  listBundleFiles,
  readSpeakersFile,
  renameRecording,
  startFromBundleName,
  type TranscriptWriteMode,
} from "@/lib/transcription/transcript-files";
import { useSettingsStore } from "@/stores/settings-store";
import { useInboxStore } from "@/stores/inbox-store";
import { useEditorStore } from "@/stores/editor-store";
import { useActivityStore } from "@/stores/activity-store";
import { useSpeakersStore } from "@/stores/speakers-store";

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
 * The LIST is read-only over the folder: one listing, one manifest read per
 * bundle. The scanner (`useRecordingsInbox`) owns dispatch, claiming and
 * status writes. What this store adds are the things a person does to a
 * recording — name it, transcribe it again, move it, delete it, import one —
 * and every write those make to a manifest goes through the same per-bundle
 * chain the scanner uses (`updateRecordingManifest`), so the two never undo
 * each other.
 *
 * The list keeps itself current: it reloads (debounced) when the watcher
 * reports a change under the Recordings folder and when a transcription job
 * starts or ends. `refresh()` is the same reload for a caller that knows it
 * just changed something.
 */

/**
 * What a bundle is doing, as far as its manifest and the folder can say.
 * A job running on THIS Mac is not in here: the row reads that live from the
 * activity store, so progress does not re-render the list.
 */
export type RecordingStatus =
  /** Has audio, has no transcript, nobody is working on it. */
  | "not-transcribed"
  /** Another device has claimed it and is transcribing. */
  | "running"
  | "done"
  | "failed"
  /** The audio is in iCloud and not on this disk yet; a download was requested. */
  | "downloading";

export interface RecordingBundle {
  /** Absolute path of the bundle folder. */
  dir: string;
  /** `Recording 2026-09-05 14-02-11` — the folder name. */
  name: string;
  /** What to call it: the user's title, else the folder name. */
  title: string;
  /** `false` for a bundle with audio and no `recording.json`. */
  hasManifest: boolean;
  status: RecordingStatus;
  /** RFC3339 with offset, from the manifest (or the folder name's stamp). */
  startedAt: string | null;
  /** Pause-aware length in seconds, from the manifest. */
  durationSecs: number | null;
  /** Audio size on disk in bytes, when known. */
  sizeBytes: number | null;
  source: RecordingSource | null;
  /** The imported file's own name, for `source: "import"`. */
  originalName: string | null;
  /** The recorder's label — *from Peter's iPhone*. Absent for this Mac's own. */
  device: string | null;
  /** Which device claimed or finished the transcription, when one did. */
  transcribedOn: string | null;
  /** The failure the manifest recorded, if the run failed. */
  error: string | null;
  /** Present once a transcript has been rendered into the bundle. */
  transcriptPath: string | null;
  audioPath: string | null;
  /** The language of the transcript, else the one the recording was made in. */
  language: string | null;
  /** The model the transcript was made with, when the manifest says. */
  model: string | null;
  /** Display names of the speakers, when the bundle names any. */
  speakers: string[];
  /** A Teams transcript has been attached. */
  hasTeamsTranscript: boolean;
  /** The two tracks of a microphone + system-audio recording, as absolute paths. */
  tracks: Array<{ role: "mic" | "system"; path: string }> | null;
}

export interface ImportInProgress {
  sourcePath: string;
  name: string;
  /** Integer 0..100; `null` until the first progress event. */
  percent: number | null;
}

export interface TranscribeOptions {
  model?: string;
  language?: string;
  /** The user's answer when a transcript already exists. */
  mode?: TranscriptWriteMode;
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
  imports: ImportInProgress[];

  openRecordings: () => void;
  closeRecordings: () => void;
  toggleRecordings: () => void;
  /** (Re)read the folder now. Safe to call repeatedly. */
  load: () => Promise<void>;
  /** Reload soon; many calls in a burst are one reload. */
  refresh: () => void;
  /** Bundles whose last run failed — the ones that want a decision. */
  failedCount: () => number;

  /** Start (or restart) a transcription. Adopts a manifest-less bundle first. */
  transcribe: (dir: string, options?: TranscribeOptions) => Promise<void>;
  rename: (dir: string, title: string) => Promise<void>;
  /** Move the bundle to the Trash. Refused while it is being transcribed. */
  remove: (dir: string) => Promise<void>;
  moveToProject: (dir: string, projectPath: string) => Promise<void>;
  /** Import a video or audio file as a new recording, then transcribe it. */
  importFile: (sourcePath: string) => Promise<void>;
  /** Stop an import in progress. The backend leaves nothing behind. */
  cancelImport: (sourcePath: string) => Promise<void>;
}

/** How long a burst of change notifications is allowed to settle before one reload. */
export const RECORDINGS_REFRESH_DEBOUNCE_MS = 400;

/**
 * Extensions offered by "Import recording…" and accepted on drop: what the
 * backend's decoders read. WebM and Matroska are NOT among them (the build
 * has no Opus / Matroska reader), so they are not offered, and a dropped one
 * is refused with a message that says what to do instead.
 */
export const IMPORT_EXTENSIONS = ["mp4", "mov", "m4a", "mp3", "wav", "flac"] as const;

/** A meeting-recording container people will try, that cannot be imported. */
export function isUnsupportedContainer(name: string): boolean {
  return /\.(webm|mkv)$/i.test(name);
}

export function isImportableFile(name: string): boolean {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext !== undefined && (IMPORT_EXTENSIONS as readonly string[]).includes(ext);
}

/** Newest first — a recording you just made is the one you want. */
function byNewest(a: RecordingBundle, b: RecordingBundle): number {
  const at = a.startedAt ?? a.name;
  const bt = b.startedAt ?? b.name;
  return bt.localeCompare(at);
}

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

let loadSeq = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let deviceName: Promise<string> | null = null;
/** Audio files a download has been requested for this session; asking twice changes nothing. */
const downloadRequested = new Set<string>();

function thisDevice(): Promise<string> {
  deviceName ??= tauriApi.getDeviceName().catch(() => "Mac");
  return deviceName;
}

/**
 * Test-only: forget per-session memory (the device name, requested downloads,
 * a pending reload, the event subscriptions the test harness discards).
 */
export function __resetRecordingsStoreMemory(): void {
  deviceName = null;
  downloadRequested.clear();
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  watching = false;
  watchingImports = false;
}

/**
 * One bundle from what the listing already told us (`files`) plus as few
 * further calls as its state needs: the manifest always; the audio's status
 * only while there is no transcript; `speakers.json` only when it exists.
 */
async function describeBundle(
  entry: FileEntry,
  files: readonly string[],
  device: string,
): Promise<RecordingBundle | null> {
  const dir = entry.path;
  const hasManifestFile = files.includes(RECORDING_MANIFEST);
  const manifest: RecordingManifest | null = hasManifestFile
    ? await readRecordingManifest(dir).catch(() => null)
    : null;
  const audioFile = manifest?.audio.file ?? findAudioFile(files);
  // A folder with neither a manifest nor audio is not a recording, unless its
  // name says it is one that has not finished arriving.
  if (!manifest && !audioFile && !isRecordingBundleName(entry.name)) return null;

  const audioPath = audioFile ? joinPath(dir, audioFile) : null;
  const transcriptFile = transcriptFileOf(manifest);
  const transcriptExists = files.some((f) => f.toLowerCase() === transcriptFile.toLowerCase());
  const claim = manifest?.transcription ?? null;

  let status: RecordingStatus = "not-transcribed";
  let error: string | null = null;
  let sizeBytes: number | null = manifest?.audio.bytes ?? null;

  if (transcriptExists) {
    // The transcript on disk is the truth about "done": a manifest can say
    // `running` for ever if the app died mid-run.
    status = "done";
  } else {
    if (claim?.status === "failed") {
      status = "failed";
      error = claim.error ?? null;
    } else if (claim?.status === "running") {
      const fresh = Date.now() - Date.parse(claim.updatedAt) < RUNNING_CLAIM_TTL_MS;
      // Our own claim with no job behind it is a job the app quit under; the
      // row overlays a live job when there is one, so what is left is this.
      if (claim.device === device) {
        status = "failed";
        error = "interrupted";
      } else if (fresh) {
        status = "running";
      }
    }
    // Only an untranscribed recording needs its audio here and now.
    if (audioPath && status !== "running") {
      const file = await tauriApi.audioFileStatus(audioPath).catch(() => null);
      if (file && file.exists) sizeBytes = file.size || sizeBytes;
      if (file && (!file.exists || !file.local)) {
        status = "downloading";
        if (!downloadRequested.has(audioPath)) {
          downloadRequested.add(audioPath);
          void tauriApi.icloudEnsureDownloaded(audioPath).catch(() => {
            downloadRequested.delete(audioPath);
          });
        }
      } else if (file) {
        downloadRequested.delete(audioPath);
      }
    }
  }

  let speakers: string[] = [];
  if (files.includes(SPEAKERS_FILENAME)) {
    // One read for the names and for the labels voice analysis found, so a
    // voice nobody has named yet is still listed ("Anna, Speaker 2").
    const { names, labels: found } = await readSpeakersFile(dir);
    const defaults = defaultSpeakerNames();
    const labels = [...new Set([...found, ...Object.keys(names)])];
    speakers = [...new Set(labels.map((label) => speakerDisplayName(label, names, defaults)))];
  } else if (manifest?.source === "both" && transcriptExists) {
    const defaults = defaultSpeakerNames();
    speakers = [defaults[SPEAKER_ME], defaults[SPEAKER_OTHERS]];
  }

  const tracks: RecordingBundle["tracks"] = [];
  for (const track of manifest?.tracks ?? []) {
    if (track.role === "mic" || track.role === "system") {
      tracks.push({ role: track.role, path: joinPath(dir, track.file) });
    }
  }

  return {
    dir,
    name: entry.name,
    title: recordingTitle(dir, manifest),
    hasManifest: manifest !== null,
    status,
    startedAt: manifest?.startedAt ?? isoOrNull(startFromBundleName(entry.name)),
    durationSecs: manifest && manifest.durationSecs > 0 ? manifest.durationSecs : null,
    sizeBytes,
    source: manifest?.source ?? null,
    originalName: manifest?.originalFile?.name ?? null,
    device: manifest && manifest.createdBy.device !== device ? manifest.createdBy.device : null,
    transcribedOn: claim?.device ?? null,
    error,
    transcriptPath: transcriptExists ? joinPath(dir, transcriptFile) : null,
    audioPath,
    language: claim?.language ?? manifest?.language ?? null,
    model: claim?.model ?? null,
    speakers,
    hasTeamsTranscript: files.some((f) => f.startsWith(`${TEAMS_TRANSCRIPT_STEM}.`)),
    tracks: tracks.length === 2 ? tracks : null,
  };
}

export const useRecordingsStore = create<RecordingsStore>((set, get) => ({
  open: false,
  dir: null,
  rootOverride: null,
  bundles: [],
  loading: false,
  error: null,
  imports: [],

  openRecordings: () => {
    // Both are modes of the document column and the column shows one thing.
    useInboxStore.getState().closeInbox();
    set({ open: true });
    void get().load();
  },
  closeRecordings: () => {
    if (get().open) set({ open: false });
  },
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
    watchFolder();

    try {
      // `listFilesShallow` omits directories, and a bundle IS a directory —
      // it can never return one. `listDirectory` one level deep returns the
      // bundle folders and the file names inside each in a single call, and
      // goes no further. Those names answer "is there a transcript, an audio
      // file, a manifest" without an existence check per bundle.
      let entries: FileEntry[];
      try {
        entries = await tauriApi.listDirectory(dir, false, 1);
      } catch (err) {
        // No Recordings folder is the ordinary state before the first
        // recording. Anything else is a failed read, and must not be shown
        // as "No recordings yet". If the check itself fails, assume the
        // folder is there: an error is the safer thing to show.
        const folderExists = await tauriApi.pathExists(dir).catch(() => true);
        if (folderExists) throw err;
        entries = [];
      }
      const device = await thisDevice();
      const described = await Promise.all(
        entries
          .filter((e) => e.is_directory && !e.hidden)
          .map(async (entry) => {
            // A folder the listing could not read (or did not descend into)
            // has no names to offer; ask for that one folder.
            const files =
              entry.unreadable || entry.truncated || !entry.children
                ? await listBundleFiles(entry.path).catch((): string[] => [])
                : entry.children.filter((c) => !c.is_directory).map((c) => c.name);
            return describeBundle(entry, files, device).catch((err) => {
              log.warn("recordings", `Could not read ${entry.name}`, err);
              return null;
            });
          }),
      );

      if (stale()) return;
      const bundles = described.filter((b): b is RecordingBundle => b !== null).sort(byNewest);
      set({ bundles, loading: false });
    } catch (err) {
      if (stale()) return;
      log.warn("recordings", `Could not list ${RECORDINGS_FOLDER_NAME}`, err);
      set({ bundles: [], loading: false, error: String(err) });
    }
  },

  refresh: () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void get().load();
    }, RECORDINGS_REFRESH_DEBOUNCE_MS);
  },

  failedCount: () => get().bundles.filter((b) => b.status === "failed").length,

  transcribe: async (dir, options = {}) => {
    const bundle = get().bundles.find((b) => b.dir === dir);
    let audioPath = bundle?.audioPath ?? null;
    let manifest = bundle?.hasManifest ? await readRecordingManifest(dir) : null;
    if (!manifest) {
      // A bundle the app quit on before its manifest was written: adopt it.
      const adopted = await adoptOrphanBundle(dir);
      manifest = adopted.manifest;
      audioPath = adopted.audioPath;
      get().refresh();
    }
    if (!audioPath) throw new Error(t("recordings.noAudio"));
    const startedMs = Date.parse(manifest.startedAt);
    const duration = manifest.durationSecs > 0 ? manifest.durationSecs : undefined;
    startTranscription({
      audioPath,
      // ms-epoch, not the manifest's RFC3339 string.
      recordingStartedAt: Number.isNaN(startedMs) ? undefined : startedMs,
      recordingStoppedAt: Number.isNaN(startedMs) || !duration ? undefined : startedMs + duration * 1000,
      recordingDurationSecs: duration,
      language: options.language ?? bundle?.language ?? undefined,
      model: options.model,
      sourceDevice: bundle?.device ?? undefined,
      title: recordingTitle(dir, manifest),
      tracks: bundle?.tracks ?? undefined,
      transcriptMode: options.mode,
    });
  },

  rename: async (dir, title) => {
    const openPaths = new Set(useEditorStore.getState().openDocuments.map((tab) => tab.filePath));
    await renameRecording(dir, title, { isOpen: (path) => openPaths.has(path) });
    const bundle = get().bundles.find((b) => b.dir === dir);
    const task = bundle?.audioPath ? findTranscriptionTask(bundle.audioPath) : undefined;
    if (task) {
      useActivityStore.getState().setTranscriptionLabel(task.id, title.trim() || basename(dir));
    }
    await get().load();
  },

  remove: async (dir) => {
    const bundle = get().bundles.find((b) => b.dir === dir);
    const task = bundle?.audioPath ? findTranscriptionTask(bundle.audioPath) : undefined;
    if (task?.status === "running") throw new Error(t("recordings.deleteWhileTranscribing"));
    await tauriApi.trashPath(dir);
    // The card would point at files that are in the Trash now.
    if (task) useActivityStore.getState().removeTask(task.id);
    // And so would a voice analysis held for it.
    if (useSpeakersStore.getState().prepared[dir]) useSpeakersStore.getState().setPrepared(dir, null);
    set({ bundles: get().bundles.filter((b) => b.dir !== dir) });
    get().refresh();
  },

  moveToProject: async (dir, projectPath) => {
    const bundle = get().bundles.find((b) => b.dir === dir);
    const task = bundle?.audioPath ? findTranscriptionTask(bundle.audioPath) : undefined;
    if (task?.status === "running") throw new Error(t("recordings.moveWhileTranscribing"));
    const newDir = await moveBundleToProject(dir, projectPath);
    // A voice analysis held for the old place points at audio that moved.
    if (useSpeakersStore.getState().prepared[dir]) useSpeakersStore.getState().setPrepared(dir, null);
    if (task && bundle?.audioPath) {
      // The card's paths moved with the folder; without this its "Open" and
      // "Transcribe again" point at a place that no longer exists.
      const newAudio = joinPath(newDir, basename(bundle.audioPath));
      const newTranscript = bundle.transcriptPath ? joinPath(newDir, basename(bundle.transcriptPath)) : undefined;
      if (newTranscript) useActivityStore.getState().setTranscriptionMoved(task.id, newTranscript, newAudio);
      else useActivityStore.getState().removeTask(task.id);
    }
    await get().load();
  },

  importFile: async (sourcePath) => {
    const dir = get().dir;
    if (!dir) throw new Error(t("recordings.rootUnknown"));
    const name = basename(sourcePath);
    if (get().imports.some((i) => i.sourcePath === sourcePath)) return;
    set({ imports: [...get().imports, { sourcePath, name, percent: null }] });
    watchImports();
    try {
      const result = await tauriApi.importMedia(sourcePath, dir);
      const [file, device] = await Promise.all([tauriApi.audioFileStatus(result.audio_path), thisDevice()]);
      const originalName = result.original_name || name;
      const manifest = createMacRecordingManifest({
        startedAtMs: Date.now(),
        durationSecs: result.duration_secs,
        bytes: file.size,
        // Nominal: the extracted WAV is 16 kHz mono by contract; an AAC copy
        // keeps the source's rate, which only the decoder knows.
        sampleRate: /\.wav$/i.test(result.audio_path) ? 16_000 : 48_000,
        audioFile: basename(result.audio_path),
        device,
        appVersion: appVersion(),
        source: "import",
        originalFile: { name: originalName, path: sourcePath },
        title: originalName.replace(/\.[^.]+$/, "") || originalName,
      });
      await writeRecordingManifest(result.bundle_dir, manifest);
      await get().load();
      await get().transcribe(result.bundle_dir);
    } catch (err) {
      // The user's own cancel is not a failure to report.
      if (!isImportCancellation(err)) throw err;
    } finally {
      set({ imports: get().imports.filter((i) => i.sourcePath !== sourcePath) });
    }
  },

  cancelImport: async (sourcePath) => {
    // `import_media` registers its job under the source path; the pending
    // `importFile` then rejects with "Import cancelled" and clears the row.
    await tauriApi.cancelTranscription(null, sourcePath);
  },
}));

// ── Keeping the list current ───────────────────────────────────────────────

let watching = false;
/** One watcher subscription for the app's lifetime; it reads the current folder each time. */
function watchFolder(): void {
  if (watching) return;
  watching = true;
  void listen<Array<{ path: string }>>("file-changed-batch", (event) => {
    const dir = useRecordingsStore.getState().dir;
    if (!dir) return;
    const prefix = `${dir.replace(/\/+$/, "")}/`;
    const root = dir.replace(/\/+$/, "");
    for (const change of event.payload ?? []) {
      if (change.path === root || change.path.startsWith(prefix)) {
        useRecordingsStore.getState().refresh();
        return;
      }
    }
  }).catch((err) => {
    watching = false;
    log.warn("recordings", "Could not subscribe to file-changed-batch", err);
  });
}

let watchingImports = false;
function watchImports(): void {
  if (watchingImports) return;
  watchingImports = true;
  void listen<ImportProgressEvent>("import-progress", (event) => {
    const { source_path: sourcePath, percent } = event.payload ?? { source_path: "", percent: 0 };
    const rounded = Math.max(0, Math.min(100, Math.round(percent)));
    const { imports } = useRecordingsStore.getState();
    const current = imports.find((i) => i.sourcePath === sourcePath);
    if (!current || current.percent === rounded) return;
    useRecordingsStore.setState({
      imports: imports.map((i) => (i.sourcePath === sourcePath ? { ...i, percent: rounded } : i)),
    });
  }).catch((err) => {
    watchingImports = false;
    log.warn("recordings", "Could not subscribe to import-progress", err);
  });
}

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

// Any document becoming active takes the column, exactly as it does from the
// Inbox (`inbox-store` has the same subscription, and cannot close this view
// for the reason above): the recent-document cycle, the command bar, ⌘N, a
// wikilink, "Open transcript".
//
// Re-opening the document that was ALREADY active behind the list leaves
// `activeTabId` as it was. `useFileOperations.openFile` closes the view for
// that case, but not every caller goes through it: the sidebar's Projects
// section calls `openTab` itself. What every `openTab` does change is the
// access order (the document moves to the front, in a new array), so a new
// order with the active document at its head is "a document was just shown"
// whichever path showed it.
//
// Guarded because this runs at import: a suite that mocks the editor store
// with a bare `getState` would otherwise fail to load this module.
if (typeof useEditorStore.subscribe === "function") {
  useEditorStore.subscribe((state, previous) => {
    const switched = state.activeTabId !== previous.activeTabId;
    const reopened =
      state.activeTabId !== null &&
      state.documentAccessOrder !== previous.documentAccessOrder &&
      state.documentAccessOrder?.[0] === state.activeTabId;
    if (switched || reopened) useRecordingsStore.getState().closeRecordings();
  });
}

// A transcription starting, finishing, failing or being cancelled changes
// what a row should say. Progress does not, and is not listened to here: the
// signature below ignores it.
if (typeof useActivityStore.subscribe === "function") {
  let lastSignature = "";
  useActivityStore.subscribe((state) => {
    let signature = "";
    for (const task of state.tasks) {
      if (task.kind === "transcription") signature += `${task.id}:${task.status}|`;
    }
    if (signature === lastSignature) return;
    lastSignature = signature;
    if (useRecordingsStore.getState().dir) useRecordingsStore.getState().refresh();
  });

  // "Identify speakers automatically after transcription" (off by default):
  // a transcription that goes from running to done on this Mac is followed by
  // a voice analysis that only PREPARES suggestions. The module is loaded on
  // demand, and only when the setting is on.
  const lastStatus = new Map<string, string>();
  useActivityStore.subscribe((state) => {
    for (const task of state.tasks) {
      if (task.kind !== "transcription") continue;
      const before = lastStatus.get(task.id);
      lastStatus.set(task.id, task.status);
      // A new transcription replaces the segments an earlier voice analysis
      // was made for: what it prepared no longer applies.
      if (before !== "running" && task.status === "running" && task.audioPath) {
        const dir = dirname(task.audioPath);
        if (useSpeakersStore.getState().prepared[dir]) useSpeakersStore.getState().setPrepared(dir, null);
      }
      if (before !== "running" || task.status !== "done" || !task.audioPath) continue;
      if (!useSpeakersStore.getState().autoIdentify) continue;
      const audioPath = task.audioPath;
      void (async () => {
        // The list as it is AFTER the transcript was written.
        await useRecordingsStore.getState().load();
        const bundle = useRecordingsStore.getState().bundles.find((b) => b.audioPath === audioPath);
        if (!bundle) return;
        const { autoIdentifySpeakers } = await import("@/lib/speakers/auto-identify");
        await autoIdentifySpeakers(bundle);
      })().catch(() => {
        // Background work nobody clicked for: a failure here is not reported.
      });
    }
  });
}
