import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  pauseRecordingCapture,
  recordingErrorText,
  recordingSourceLabel,
  resumeRecordingCapture,
  startRecordedTimeTicker,
  stopRecordedTimeTicker,
  setBackendStoppedHandler,
  useRecording,
} from "@/hooks/useRecording";
import {
  isDefaultModelDownloaded,
  publishRecordingLevels,
  readRecordingLevels,
  resetRecordingLevels,
  RECORDING_SOURCES,
  useRecordingStore,
  type ModelInfo,
  type RecordingPhase,
  type RecordingSource,
} from "@/stores/recording-store";
import { useActivityStore } from "@/stores/activity-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useRecordingsStore } from "@/stores/recordings-store";
import { startTranscription, type StartTranscriptionDetail } from "@/hooks/useTranscriptionJob";
import {
  tauriApi,
  RECORDING_LEVEL_EVENT,
  RECORDING_WARNING_EVENT,
  type RecordingLevelEvent,
  type RecordingPreflight,
  type RecordingTrack,
  type RecordingWarningEvent,
} from "@/lib/tauri";
import { appVersion } from "@/lib/version";
import { basename, writeRecordingManifest } from "@/lib/transcription/bundle";
import { createMacRecordingManifest, type RecordingManifest } from "@/lib/transcription/manifest";
import { recordingsDir, resolveNotesRoot } from "@/lib/notes-root";
import { formatRecordedTime } from "@/lib/recording-time";
import { getFormatLocale, t } from "@/lib/i18n";
import { log } from "@/lib/logger";

/**
 * Single owner of the recording flow, shared by every surface that can start,
 * pause, stop or discard a recording (the always-visible indicator, the orb
 * panel, the toolbar microphone, the Recordings view, `⌘⇧R` / `⌘⇧U`).
 *
 *   START   preflight (is the chosen source available?) → model check (a
 *           warning, never a block: the audio is what matters) →
 *           `start_recording` → live.
 *   STOP    `stop_recording` (the backend compresses the audio; this can
 *           take tens of seconds) → write `recording.json` into the LOCAL
 *           staging bundle → `finalize_recording_bundle` moves it into the
 *           library's Recordings folder → queue the transcription.
 *   DISCARD `discard_recording`: the only path that deletes audio, and only
 *           ever after an explicit confirmation in the UI.
 *
 * Everything here is a plain function reading the stores lazily, so a caller
 * that only ACTS subscribes to nothing, and the guard below always sees the
 * current phase rather than the one a render closed over.
 *
 * The phase (`recording-store.phase`) is the re-entrancy guard:
 *
 *   idle → starting → recording ⇄ paused → stopping → idle
 *
 * It is moved SYNCHRONOUSLY, before the first `await`, so a double click, a
 * held key or two surfaces acting at once cannot start two recordings, stop
 * one twice (which used to toast a failure and drop the per-recording
 * language), or start a new one while the last is still being saved.
 *
 * The live recording activity-item id is MODULE-scoped, not component-scoped:
 * the surfaces that show a recording mount and unmount freely, and only one
 * recording can exist at a time (the backend enforces a single capture
 * owner).
 */
let liveRecordingItemId: string | null = null;
/** The markdown document that was open when the live recording started (U12). */
let liveDocumentId: string | undefined;

/** Test-only: reset the module-scoped state. */
export function __resetLiveRecordingItemId(): void {
  liveRecordingItemId = null;
  liveDocumentId = undefined;
  recoveryStarted = false;
}

const OPEN_SETTINGS_EVENT = "notesage:open-settings";
/** The settings panel id of Settings → Transcription. */
const TRANSCRIPTION_SETTINGS_TAB = "voice";
/** A sample rate for the manifest when the backend did not report one. */
const NOMINAL_SAMPLE_RATE = 48_000;
/** A level above this on a source means its "no sound" warning is over. */
const SOUND_PRESENT_LEVEL = 0.01;

export function openTranscriptionSettings(): void {
  window.dispatchEvent(
    new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { tab: TRANSCRIPTION_SETTINGS_TAB } }),
  );
}

function phase(): RecordingPhase {
  return useRecordingStore.getState().phase;
}

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `recording-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

/**
 * Why `source` cannot be recorded right now, as a sentence to show, or `null`
 * when it can (or when nothing is known: an undetermined permission is not a
 * refusal — macOS asks when the capture starts).
 */
export function sourceUnavailableReason(
  source: RecordingSource,
  preflight: RecordingPreflight | null,
): string | null {
  if (!preflight) return null;
  if (source !== "microphone") {
    if (preflight.system_audio === "unsupported") return t("recording.reason.systemUnsupported");
    if (preflight.system_audio === "denied") return t("recording.reason.systemDenied");
  }
  if (source !== "system" && preflight.microphone === "denied") {
    return t("recording.reason.microphoneDenied");
  }
  return null;
}

/**
 * Ask the backend what can be recorded. `null` when the command is not
 * there or fails: the caller then lets `start_recording` be the judge, which
 * fails clearly rather than recording less than asked.
 */
export async function preflightRecording(
  source: RecordingSource = "both",
): Promise<RecordingPreflight | null> {
  try {
    const result = await tauriApi.recordingPreflight(source);
    useRecordingStore.getState().setDevices(result.input_device ?? null, result.output_device ?? null);
    return result;
  } catch (err) {
    log.debug("recording", "recording_preflight unavailable", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Model check (U6)
// ---------------------------------------------------------------------------

/** `true`/`false` once the model list is known, `null` when it could not be read. */
async function selectedModelIsDownloaded(): Promise<boolean | null> {
  try {
    const models = await invoke<ModelInfo[]>("list_whisper_models");
    useRecordingStore.setState({ availableModels: models, modelsLoaded: true });
    return isDefaultModelDownloaded(useRecordingStore.getState());
  } catch (err) {
    log.debug("recording", "Could not list transcription models", err);
    return null;
  }
}

/**
 * Tell the user, at the START of a recording, that it cannot be transcribed
 * yet — while there is still an hour of meeting in which to download a model.
 * Never blocks the recording.
 */
async function warnIfNoModel(): Promise<void> {
  if ((await selectedModelIsDownloaded()) !== false) return;
  toast.warning(t("recording.model.missingAtStart"), {
    id: "recording-model-missing",
    duration: 12_000,
    action: { label: t("recording.model.download"), onClick: openTranscriptionSettings },
  });
}

// ---------------------------------------------------------------------------
// Where a finished recording goes
// ---------------------------------------------------------------------------

/**
 * The library's Recordings folder: the same expression the scanner and the
 * Recordings view use (`useRecordingsInbox`), so what is recorded here is
 * what they list.
 */
export function recordingsDestination(): string | null {
  const { icloudNotesagePath, notesRootPath, homeDir } = useSettingsStore.getState();
  const root = icloudNotesagePath ?? resolveNotesRoot(notesRootPath, homeDir);
  return root ? recordingsDir(root) : null;
}

interface BundleFacts {
  stagingDir: string;
  audioPath: string;
  tracks: RecordingTrack[];
  startedAtMs: number;
  durationSecs: number;
  sampleRate: number;
  source: RecordingSource;
  language: string | undefined;
  /** The bundle already has its `recording.json` (stop succeeded, the move did not). */
  hasManifest?: boolean;
}

/**
 * Write `recording.json` into the STAGING bundle, before it is moved: a
 * bundle must never appear in the library without its manifest (a
 * manifest-less bundle used to sit there as "Waiting to be transcribed"
 * forever).
 *
 * Returns false when it could not be written. The caller still moves the
 * bundle — audio in the library without a manifest beats audio stuck in a
 * folder nobody looks at.
 */
export async function writeMacRecordingManifest(facts: BundleFacts): Promise<boolean> {
  try {
    const [bytes, device] = await Promise.all([
      tauriApi.fileSize(facts.audioPath),
      tauriApi.getDeviceName().catch(() => "Mac"),
    ]);
    const base = createMacRecordingManifest({
      startedAtMs: facts.startedAtMs,
      durationSecs: facts.durationSecs,
      bytes,
      sampleRate: facts.sampleRate > 0 ? facts.sampleRate : NOMINAL_SAMPLE_RATE,
      audioFile: basename(facts.audioPath),
      device,
      appVersion: appVersion(),
      language: facts.language,
    });
    // The backend lists only the separate tracks (mic, system) and only for
    // a two-track recording; the manifest also names the mix, first. File
    // names, not paths: they must survive the move into the library.
    const separate = facts.tracks.filter((track) => track.role !== "mix");
    const tracks =
      separate.length > 0
        ? [
            { role: "mix", file: basename(facts.audioPath) },
            ...separate.map((track) => ({ role: track.role, file: basename(track.path) })),
          ]
        : [];
    const manifest = {
      ...base,
      source: facts.source,
      audio: { ...base.audio, codec: /\.m4a$/i.test(facts.audioPath) ? "aac" : "pcm" },
      ...(tracks.length > 0 ? { tracks } : {}),
    } as unknown as RecordingManifest;
    await writeRecordingManifest(facts.stagingDir, manifest);
    return true;
  } catch (err) {
    log.warn("recording", "Could not write recording.json for the finished bundle", err);
    return false;
  }
}

interface FiledRecording {
  audioPath: string;
  tracks: RecordingTrack[];
}

/**
 * Manifest, then move: the two steps every finished recording goes through,
 * whether it was stopped a moment ago or recovered from a crash.
 * Throws when the bundle could not be moved (it then stays in staging and is
 * offered again at the next start).
 */
async function fileBundleIntoLibrary(facts: BundleFacts): Promise<FiledRecording> {
  const destination = recordingsDestination();
  if (!destination) throw new Error(t("recording.error.noLibrary"));
  // A manifest that is already there was written at stop, with the language
  // and times of the real recording: never replace it with a reconstruction.
  if (!facts.hasManifest) await writeMacRecordingManifest(facts);
  const filed = await tauriApi.finalizeRecordingBundle(facts.stagingDir, destination);
  const recordings = useRecordingsStore.getState() as {
    refresh?: () => void;
    load?: () => unknown;
  };
  if (recordings.refresh) recordings.refresh();
  else void Promise.resolve(recordings.load?.()).catch(() => {});
  return { audioPath: filed.audio_path, tracks: filed.tracks ?? [] };
}

/** Mic and system tracks, when the recording has both: what speaker labels are made from. */
function speakerTracks(tracks: RecordingTrack[]): { role: "mic" | "system"; path: string }[] | undefined {
  const separate = tracks.filter(
    (track): track is { role: "mic" | "system"; path: string } =>
      track.role === "mic" || track.role === "system",
  );
  return separate.length === 2 ? separate : undefined;
}

interface QueueOptions {
  filed: FiledRecording;
  startedAtMs: number;
  stoppedAtMs: number;
  durationSecs: number;
  language: string | undefined;
  documentId: string | undefined;
}

function queueTranscription(options: QueueOptions): void {
  const detail: StartTranscriptionDetail & {
    tracks?: { role: "mic" | "system"; path: string }[];
  } = {
    audioPath: options.filed.audioPath,
    recordingStartedAt: options.startedAtMs,
    recordingStoppedAt: options.stoppedAtMs,
    recordingDurationSecs: options.durationSecs,
    language: options.language,
  };
  if (options.documentId) detail.documentId = options.documentId;
  const tracks = speakerTracks(options.filed.tracks);
  if (tracks) detail.tracks = tracks;
  startTranscription(detail);
}

function openRecordings(): void {
  useRecordingsStore.getState().openRecordings();
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function activeMarkdownDocument(): string | undefined {
  const { activeTabId, openDocuments } = useEditorStore.getState();
  const active = activeTabId ? openDocuments.find((tab) => tab.id === activeTabId) : undefined;
  return active && active.fileType === "markdown" && active.filePath ? active.filePath : undefined;
}

/**
 * Start a recording. Resolves `true` when capture began.
 *
 * Does nothing unless the phase is `idle`: a second call while one is
 * starting, live or being saved is ignored, silently.
 */
export async function startMeetingRecording(
  options: { source?: RecordingSource } = {},
): Promise<boolean> {
  const store = useRecordingStore.getState();
  if (store.phase !== "idle") return false;
  const requested = options.source ?? store.lastUsedSource;
  const source: RecordingSource = RECORDING_SOURCES.includes(requested) ? requested : "microphone";
  store.setPhase("starting");

  try {
    const preflight = await preflightRecording(source);
    const reason = sourceUnavailableReason(source, preflight);
    if (reason) {
      // Never record less than was asked for without saying so: offer the
      // microphone as an explicit choice instead of falling back to it.
      const micOnly =
        source !== "microphone" && !sourceUnavailableReason("microphone", preflight);
      toast.error(
        t("recording.error.sourceUnavailable", { source: recordingSourceLabel(source), reason }),
        micOnly
          ? {
              duration: 12_000,
              action: {
                label: t("recording.action.microphoneOnly"),
                onClick: () => void startMeetingRecording({ source: "microphone" }),
              },
            }
          : { duration: 12_000 },
      );
      useRecordingStore.getState().setPhase("idle");
      return false;
    }

    await tauriApi.startRecording(source);
  } catch (err) {
    toast.error(t("recording.error.start", { error: recordingErrorText(err) }));
    useRecordingStore.getState().setPhase("idle");
    return false;
  }

  const id = newId();
  liveRecordingItemId = id;
  liveDocumentId = activeMarkdownDocument();
  resetRecordingLevels();
  useRecordingStore.getState().startRecording(source);
  useActivityStore.getState().addRecordingItem({
    id,
    label: t("recording.itemLabel"),
    recordingStartedAt: Date.now(),
  });
  startRecordedTimeTicker();
  useRecordingStore
    .getState()
    .announce(t("recording.announce.started", { source: recordingSourceLabel(source) }));
  // After the capture is running, so it can never delay or prevent it.
  void warnIfNoModel().catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

function takeLiveItem(): { language: string | undefined; documentId: string | undefined } {
  const activity = useActivityStore.getState();
  const itemId = liveRecordingItemId;
  // The per-recording language override lives on the item: read it BEFORE
  // the item is removed.
  const language = itemId ? activity.tasks.find((task) => task.id === itemId)?.language : undefined;
  if (itemId) activity.removeRecordingItem(itemId);
  // Belt and braces: no recording item may outlive the recording.
  for (const task of useActivityStore.getState().tasks) {
    if (task.kind === "recording") useActivityStore.getState().removeRecordingItem(task.id);
  }
  const documentId = liveDocumentId;
  liveRecordingItemId = null;
  liveDocumentId = undefined;
  return { language, documentId };
}

/**
 * Which source, if any, recorded nothing but silence for the whole recording:
 * from the backend's `mic-silent` / `system-silent` warning codes, or — when
 * the whole file is silent — the recording's own source.
 */
function silentSource(
  stopped: { peak: number; duration_secs: number; warnings: string[] },
  source: RecordingSource,
): RecordingSource | null {
  const codes = stopped.warnings.map((warning) => warning.split(":")[0].trim());
  const mic = codes.includes("mic-silent");
  const system = codes.includes("system-silent");
  if (mic && system) return source;
  if (system) return "system";
  if (mic) return "microphone";
  return stopped.peak < 0.0001 && stopped.duration_secs > 0 ? source : null;
}

/**
 * Stop the recording and save it. Never asks: stopping keeps everything.
 *
 * `fatalReason` is set when the BACKEND stopped the capture (a
 * `recording-warning` with `fatal: true`): the same path runs, and the user
 * is told what happened and what was saved.
 */
export async function stopMeetingRecording(
  options: { fatalReason?: string } = {},
): Promise<void> {
  const store = useRecordingStore.getState();
  if (store.phase !== "recording" && store.phase !== "paused") return;
  const previousPhase = store.phase;
  const source = store.recordingSource;
  const startedAtMs = store.recordingStartTime ?? Date.now();
  store.setPhase("stopping");
  store.announce(t("recording.announce.saving"));

  let stopped;
  try {
    stopped = await tauriApi.stopRecording();
  } catch (err) {
    // Is the capture still running? Then nothing was lost and nothing has
    // changed: put the controls back so the user can try again.
    const state = await tauriApi.getRecordingState().catch(() => null);
    if (state?.recording && !state.fatal) {
      useRecordingStore.getState().setPhase(previousPhase);
      toast.error(t("recording.error.stop", { error: recordingErrorText(err) }));
      return;
    }
    stopRecordedTimeTicker();
    takeLiveItem();
    useRecordingStore.getState().stopRecording();
    toast.error(t("recording.error.stopKept", { error: recordingErrorText(err) }), {
      duration: 15_000,
    });
    return;
  }

  stopRecordedTimeTicker();
  const { language, documentId } = takeLiveItem();
  const stoppedAtMs = Date.now();
  const time = formatRecordedTime(stopped.duration_secs);

  if (!stopped.audio_path) {
    useRecordingStore.getState().stopRecording();
    toast.error(t("recording.error.nothingRecorded"));
    return;
  }

  // The language picked for this recording is the default for the next one.
  if (language && language !== useRecordingStore.getState().speechLanguage) {
    useRecordingStore.getState().setSpeechLanguage(language);
  }

  let filed: FiledRecording;
  try {
    filed = await fileBundleIntoLibrary({
      stagingDir: stopped.bundle_dir,
      audioPath: stopped.audio_path,
      tracks: stopped.tracks,
      startedAtMs,
      durationSecs: stopped.duration_secs,
      sampleRate: stopped.sample_rate,
      source,
      language,
    });
  } catch (err) {
    // The audio is safe in local staging; it is filed at the next start.
    useRecordingStore.getState().stopRecording();
    toast.error(t("recording.error.fileKept", { time, error: recordingErrorText(err) }), {
      duration: 15_000,
    });
    return;
  }

  useRecordingStore.getState().stopRecording();
  useRecordingStore.getState().announce(t("recording.announce.saved", { time }));

  const openAction = { label: t("recording.openRecordings"), onClick: openRecordings };
  if (options.fatalReason) {
    toast.error(t("recording.fatalSaved", { reason: options.fatalReason, time }), {
      duration: 20_000,
      action: openAction,
    });
  } else if (silentSource(stopped, source)) {
    // Saved, but a source was silent from start to end: say so instead of
    // "saved". For system audio this is the ONLY sign of a refused
    // permission — macOS has no way to ask whether it was granted.
    const silent = silentSource(stopped, source) as RecordingSource;
    const message = t("recording.savedSilent", { time, source: recordingSourceLabel(silent) });
    toast.warning(
      silent === "microphone" ? message : `${message} ${t("recording.savedSilentSystemHint")}`,
      { duration: 20_000, action: openAction },
    );
  } else {
    toast.success(t("recording.savedToast", { time }), { action: openAction });
  }

  const modelReady = await selectedModelIsDownloaded();
  if (modelReady === false) {
    // A job that is known to fail is noise. The recording is in the library
    // and can be transcribed from there once a model is on disk.
    toast.warning(t("recording.model.missingAfterStop"), {
      id: "recording-model-missing",
      duration: 20_000,
      action: { label: t("recording.model.download"), onClick: openTranscriptionSettings },
    });
    return;
  }
  queueTranscription({
    filed,
    startedAtMs,
    stoppedAtMs,
    durationSecs: stopped.duration_secs,
    language,
    documentId,
  });
}

/**
 * Start when idle, stop-and-save when a recording is live (paused or not).
 * Ignored while a recording is starting or being saved.
 */
export async function toggleMeetingRecording(): Promise<void> {
  const current = phase();
  if (current === "idle") {
    await startMeetingRecording();
  } else if (current === "recording" || current === "paused") {
    await stopMeetingRecording();
  }
}

/** Pause a running recording, resume a paused one. Nothing otherwise. */
export async function togglePauseMeetingRecording(): Promise<void> {
  const current = phase();
  if (current === "recording") await pauseRecordingCapture();
  else if (current === "paused") await resumeRecordingCapture();
}

// ---------------------------------------------------------------------------
// Discard
// ---------------------------------------------------------------------------

/** Open the "Discard this recording?" confirmation. The only way to `discardMeetingRecording` from the UI. */
export function requestDiscardMeetingRecording(): void {
  const current = phase();
  if (current !== "recording" && current !== "paused") return;
  useRecordingStore.getState().setDiscardConfirmOpen(true);
}

/**
 * Stop the recording and DELETE it. No confirmation here: callers go through
 * `requestDiscardMeetingRecording`, whose dialog calls this.
 */
export async function discardMeetingRecording(): Promise<void> {
  const store = useRecordingStore.getState();
  if (store.phase !== "recording" && store.phase !== "paused") return;
  const previousPhase = store.phase;
  store.setPhase("stopping");
  try {
    await tauriApi.discardRecording();
  } catch (err) {
    // Nothing was deleted and the capture is still what it was.
    useRecordingStore.getState().setPhase(previousPhase);
    toast.error(t("recording.error.discard", { error: recordingErrorText(err) }));
    return;
  }
  stopRecordedTimeTicker();
  takeLiveItem();
  useRecordingStore.getState().stopRecording();
  useRecordingStore.getState().announce(t("recording.announce.discarded"));
  toast.success(t("recording.discarded"));
}

// ---------------------------------------------------------------------------
// Warnings and levels from the backend
// ---------------------------------------------------------------------------

/** Which source a warning is about, for a recording that captures two. */
function warningSource(event: RecordingWarningEvent): "microphone" | "system" | null {
  if (event.source === "microphone" || event.source === "system") return event.source;
  const live = useRecordingStore.getState().recordingSource;
  if (live === "microphone") return "microphone";
  if (live === "system") return "system";
  // The backend prefixes its (English, for-the-log) message with the source.
  // Only the PREFIX is read: the microphone's own message goes on to mention
  // "System Settings", so searching for "system" would name the wrong one.
  const message = (event.message ?? "").trimStart().toLowerCase();
  if (message.startsWith("system:")) return "system";
  if (message.startsWith("mic:") || message.startsWith("microphone:")) return "microphone";
  return null;
}

/** The sentence for a warning, in the user's language. */
export function recordingWarningText(
  kind: RecordingWarningEvent["kind"],
  source: "microphone" | "system" | null,
): string {
  switch (kind) {
    case "silence":
      return source
        ? t("recording.warning.silenceSource", { source: recordingSourceLabel(source) })
        : t("recording.warning.silence");
    case "device-lost":
      return t("recording.warning.deviceLost");
    case "device-changed":
      return t("recording.warning.deviceChanged");
    case "write-error":
      return t("recording.warning.writeError");
    case "low-disk":
      return t("recording.warning.lowDisk");
    case "dropped-frames":
      return t("recording.warning.droppedFrames");
    default:
      return t("recording.warning.generic");
  }
}

const TOASTED_WARNINGS: readonly string[] = ["silence", "device-lost", "write-error", "low-disk"];

export function handleRecordingWarning(event: RecordingWarningEvent): void {
  const store = useRecordingStore.getState();
  if (!store.isRecording) return;
  const source = event.kind === "silence" ? warningSource(event) : null;
  const text = recordingWarningText(event.kind, source);

  if (event.fatal) {
    // The backend has already stopped and finalised what it had.
    void stopMeetingRecording({ fatalReason: text }).catch((err) => {
      log.warn("recording", "Stop after a fatal warning failed", err);
    });
    return;
  }

  if (event.kind === "device-changed") {
    // Capture resumed on another device: the "lost" warning is over.
    store.dismissWarning("device-lost");
    toast.info(text);
    store.announce(text);
    void preflightRecording(store.recordingSource);
    return;
  }

  store.addWarning({ kind: event.kind, source });
  store.announce(text);
  if (TOASTED_WARNINGS.includes(event.kind)) {
    toast.warning(text, { id: `recording-warning-${event.kind}-${source ?? "any"}`, duration: 10_000 });
  }
}

function handleRecordingLevel(event: RecordingLevelEvent): void {
  publishRecordingLevels(event);
  // Sound is arriving again: a "no sound" warning for that source is over.
  // A plain read: this runs ten times a second and must not write state
  // unless there is a warning to clear.
  const { warnings } = useRecordingStore.getState();
  if (warnings.length === 0) return;
  const now = readRecordingLevels();
  for (const warning of warnings) {
    if (warning.kind !== "silence") continue;
    const level =
      warning.source === "system"
        ? now.system
        : warning.source === "microphone"
          ? now.mic
          : Math.max(now.mic ?? 0, now.system ?? 0);
    if ((level ?? 0) > SOUND_PRESENT_LEVEL) {
      useRecordingStore.getState().dismissWarning("silence", warning.source);
    }
  }
}

// Closing or quitting mid-recording (U11): deliberately NO prompt here. The
// webview cannot veto a close without `core:window:allow-destroy`, cannot see
// ⌘Q at all, and a handler that holds a close back and then fails leaves an
// app that cannot be quit. The backend stops the capture and leaves a valid
// file on exit, and `recoverOrphanRecordings` files it at the next launch.

/**
 * Subscribe to the backend's recording events. Mounted once at the app root
 * (`useRecordingShortcut`). Returns the cleanup.
 */
export function initRecordingEvents(): () => void {
  // Registration is async, so a cleanup that races it must unlisten the
  // late-resolving registrations instead of leaking them.
  let mounted = true;
  const unlisteners: (() => void)[] = [];
  const keep = (unlisten: () => void) => {
    if (mounted) unlisteners.push(unlisten);
    else unlisten();
  };
  void Promise.all([
    listen<RecordingLevelEvent>(RECORDING_LEVEL_EVENT, (event) => handleRecordingLevel(event.payload)),
    listen<RecordingWarningEvent>(RECORDING_WARNING_EVENT, (event) =>
      handleRecordingWarning(event.payload),
    ),
  ])
    .then((registered) => registered.forEach(keep))
    .catch((err) => log.warn("recording", "Could not subscribe to recording events", err));
  return () => {
    mounted = false;
    unlisteners.forEach((unlisten) => unlisten());
  };
}

// ---------------------------------------------------------------------------
// Startup: adopt a live capture, recover what a crash left behind
// ---------------------------------------------------------------------------

let recoveryStarted = false;

function formatRecoveredDate(startedAt: string | null): string {
  const ms = startedAt ? Date.parse(startedAt) : NaN;
  const date = Number.isFinite(ms) ? new Date(ms) : new Date();
  return date.toLocaleString(getFormatLocale(), { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Run once after startup.
 *
 *  - If the backend is recording right now (the webview was reloaded under a
 *    live capture), take the controls back up instead of showing "idle" over
 *    a running microphone.
 *  - Otherwise ask for recordings a crash or quit left in staging, and put
 *    each through the normal manifest → library → transcription path.
 *
 * Returns how many recordings were recovered.
 */
export async function recoverOrphanRecordings(): Promise<number> {
  if (recoveryStarted) return 0;
  recoveryStarted = true;

  const state = await tauriApi.getRecordingState().catch(() => null);
  if (state?.recording) {
    if (phase() === "idle") {
      const source = RECORDING_SOURCES.find((s) => s === state.source) ?? "microphone";
      useRecordingStore.getState().startRecording(source);
      if (state.started_at_ms) {
        useRecordingStore.setState({ recordingStartTime: state.started_at_ms });
      }
      if (state.paused) useRecordingStore.getState().pauseRecording();
      const id = newId();
      liveRecordingItemId = id;
      useActivityStore.getState().addRecordingItem({
        id,
        label: t("recording.itemLabel"),
        recordingStartedAt: state.started_at_ms ?? Date.now(),
      });
      startRecordedTimeTicker();
    }
    return 0;
  }

  let orphans;
  try {
    orphans = await tauriApi.recoverOrphanRecordings();
  } catch (err) {
    log.debug("recording", "recover_orphan_recordings unavailable", err);
    return 0;
  }
  if (!Array.isArray(orphans) || orphans.length === 0) return 0;

  const modelReady = await selectedModelIsDownloaded();
  const { speechLanguage } = useRecordingStore.getState();
  let recovered = 0;
  for (const orphan of orphans) {
    const parsed = orphan.started_at ? Date.parse(orphan.started_at) : NaN;
    const startedAtMs = Number.isFinite(parsed)
      ? parsed
      : Date.now() - orphan.duration_secs * 1000;
    const tracks = orphan.tracks ?? [];
    const roles = new Set(tracks.map((track) => track.role));
    // The backend's own record of the source when it has one; otherwise what
    // the files say.
    const source: RecordingSource =
      RECORDING_SOURCES.find((s) => s === orphan.source) ??
      (roles.has("mic") && roles.has("system") ? "both" : roles.has("system") ? "system" : "microphone");
    try {
      const filed = await fileBundleIntoLibrary({
        stagingDir: orphan.bundle_dir,
        audioPath: orphan.audio_path,
        tracks,
        startedAtMs,
        durationSecs: orphan.duration_secs,
        sampleRate: 0,
        source,
        language: speechLanguage,
        hasManifest: orphan.has_manifest === true,
      });
      recovered += 1;
      toast.info(t("recording.recovered", { date: formatRecoveredDate(orphan.started_at) }), {
        duration: 15_000,
        action: { label: t("recording.openRecordings"), onClick: openRecordings },
      });
      if (modelReady !== false) {
        queueTranscription({
          filed,
          startedAtMs,
          stoppedAtMs: startedAtMs + orphan.duration_secs * 1000,
          durationSecs: orphan.duration_secs,
          language: speechLanguage,
          documentId: undefined,
        });
      }
    } catch (err) {
      // It stays in staging and is offered again at the next start.
      log.warn("recording", "Could not file a recovered recording", err);
    }
  }
  return recovered;
}

// ---------------------------------------------------------------------------
// Reactive view
// ---------------------------------------------------------------------------

export interface MeetingRecordingHook {
  /** Toggle recording: start when idle, stop when recording (paused or not). */
  toggleRecording: () => Promise<void>;
  /** Pause the live capture (stream stays alive, samples discarded). */
  pauseRecording: () => Promise<void>;
  /** Resume a paused capture. */
  resumeRecording: () => Promise<void>;
  isRecording: boolean;
  isPaused: boolean;
  /** Recorded seconds — from samples written, frozen while paused. */
  elapsedTime: number;
  phase: RecordingPhase;
  /** The live recording's source. */
  source: RecordingSource;
}

/**
 * Reactive view of the recording for surfaces that DISPLAY its state
 * (`phase`, `isPaused`, the once-a-second `elapsedTime`). Mount it in a leaf;
 * the app root uses the plain functions above.
 */
export function useMeetingRecording(): MeetingRecordingHook {
  const { pauseRecording, resumeRecording, isRecording, isPaused, elapsedTime, source } =
    useRecording();
  const currentPhase = useRecordingStore((s) => s.phase);

  return {
    toggleRecording: toggleMeetingRecording,
    pauseRecording,
    resumeRecording,
    isRecording,
    isPaused,
    elapsedTime,
    phase: currentPhase,
    source,
  };
}

// The recorded-time clock asks the backend twice a second; if it finds the
// capture has ended by itself and no warning event said so (a reloaded
// webview), save what there is. `stopMeetingRecording` ignores the call
// unless a recording is live, so a repeat while saving does nothing.
setBackendStoppedHandler(() => {
  void stopMeetingRecording({ fatalReason: t("recording.warning.generic") }).catch((err) => {
    log.warn("recording", "Stop after the backend ended the capture failed", err);
  });
});
