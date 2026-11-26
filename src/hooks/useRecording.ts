import { tauriApi } from '@/lib/tauri';
import { useRecordingStore, type RecordingSource } from '@/stores/recording-store';
import { recordedElapsedMs } from '@/lib/recording-time';
import { t } from '@/lib/i18n';
import { toast } from 'sonner';

interface RecordingHook {
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  isRecording: boolean;
  isPaused: boolean;
  /** Recorded seconds — from samples written, frozen while paused. */
  elapsedTime: number;
  source: RecordingSource;
}

/** "Microphone", "System audio" or "Microphone + system audio". */
export function recordingSourceLabel(source: RecordingSource): string {
  if (source === 'system') return t("recording.source.system");
  if (source === 'both') return t("recording.source.both");
  return t("recording.source.microphone");
}

/**
 * A sentence for a failed recording command. Known backend conditions are
 * translated; anything else keeps the backend's own words so nothing is
 * hidden.
 */
export function recordingErrorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  // Matched on the backend's own strings (`commands/recording`), narrowly: a
  // loose match would put the wrong sentence over an unrelated failure.
  if (lower.includes('requires macos 14.2') || lower.includes('system audio recording is not available')) {
    return t("recording.reason.systemUnsupported");
  }
  if (lower.includes('system audio') && (lower.includes('denied') || lower.includes('permission'))) {
    return t("recording.reason.systemDenied");
  }
  if (lower.includes('microphone') && (lower.includes('denied') || lower.includes('permission'))) {
    return t("recording.reason.microphoneDenied");
  }
  if (lower.includes('free disk space')) return t("recording.reason.lowDisk");
  if (lower.includes('already in progress') || lower.includes('already recording')) {
    return t("recording.reason.alreadyRecording");
  }
  if (lower.includes('no microphone available') || lower.includes('no input device')) {
    return t("recording.reason.noInputDevice");
  }
  return raw;
}

// The capture commands are plain functions, not hook callbacks: they read the
// store lazily, so a caller that only needs to ACT on the recording (the
// app-root shortcuts) can do so without subscribing to anything. Starting and
// stopping live in `useMeetingRecording`, which owns the whole flow.

/** Pause the live capture. Toasts on failure. */
export async function pauseRecordingCapture(): Promise<void> {
  const store = useRecordingStore.getState();
  if (store.phase !== 'recording') return;
  try {
    await tauriApi.pauseRecording();
    useRecordingStore.getState().pauseRecording();
    useRecordingStore.getState().announce(t("recording.announce.paused"));
  } catch (err) {
    toast.error(t("recording.error.pause", { error: recordingErrorText(err) }));
  }
}

/** Resume a paused capture. Toasts on failure. */
export async function resumeRecordingCapture(): Promise<void> {
  const store = useRecordingStore.getState();
  if (store.phase !== 'paused') return;
  try {
    await tauriApi.resumeRecording();
    useRecordingStore.getState().resumeRecording();
    useRecordingStore.getState().announce(t("recording.announce.resumed"));
  } catch (err) {
    toast.error(t("recording.error.resume", { error: recordingErrorText(err) }));
  }
}

// ---------------------------------------------------------------------------
// The recorded-time clock
//
// ONE ticker for the whole app, started with the recording and stopped with
// it, writing whole seconds into the store. It asks the backend how much has
// actually been written (`get_recording_state`), so the timer shows recorded
// time: it does not advance while paused, or while a lost device delivers
// nothing. If that command is not there (an older backend), it falls back to
// the pause-aware wall clock.
//
// Surfaces read `recordedSeconds` with a selector, so they re-render once a
// second and only while a recording is live.
// ---------------------------------------------------------------------------

const TICK_MS = 500;
let ticker: ReturnType<typeof setInterval> | null = null;
let backendClock = true;
let onBackendStopped: (() => void) | null = null;

/**
 * Called when the clock finds the backend has stopped capturing by itself
 * (`get_recording_state().fatal`). The `recording-warning` event normally
 * says so first; this catches the case where that event was missed (a
 * reloaded webview). Registered by the flow, which owns stopping.
 */
export function setBackendStoppedHandler(handler: (() => void) | null): void {
  onBackendStopped = handler;
}

async function tick(): Promise<void> {
  const before = useRecordingStore.getState();
  if (!before.isRecording) return;
  if (backendClock) {
    try {
      const state = await tauriApi.getRecordingState();
      const now = useRecordingStore.getState();
      if (!now.isRecording) return;
      if (state.fatal) {
        now.setRecordedSeconds(state.elapsed_recorded_ms / 1000);
        onBackendStopped?.();
        return;
      }
      if (state.recording) {
        now.setRecordedSeconds(state.elapsed_recorded_ms / 1000);
        return;
      }
    } catch {
      backendClock = false;
    }
  }
  const s = useRecordingStore.getState();
  if (!s.isRecording || !s.recordingStartTime) return;
  s.setRecordedSeconds(
    recordedElapsedMs(s.recordingStartTime, s.pausedTotalMs, s.pauseStartedAt, Date.now()) / 1000,
  );
}

export function startRecordedTimeTicker(): void {
  stopRecordedTimeTicker();
  backendClock = true;
  void tick();
  ticker = setInterval(() => void tick(), TICK_MS);
}

export function stopRecordedTimeTicker(): void {
  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

/**
 * Reactive view of the live recording for surfaces that DISPLAY it.
 *
 * `elapsedTime` changes once a second while recording, so mount it in a
 * leaf — never at the app root, where each tick re-renders the whole tree.
 * To only act, call the plain functions instead.
 *
 * The level meter is not here on purpose: levels arrive ten times a second
 * and live outside React (`readRecordingLevels` in `recording-store`).
 */
export function useRecording(): RecordingHook {
  // One selector per field: a bare `useRecordingStore()` also re-rendered on
  // model-download writes.
  const isRecording = useRecordingStore((s) => s.isRecording);
  const isPaused = useRecordingStore((s) => s.isPaused);
  const recordingSource = useRecordingStore((s) => s.recordingSource);
  const recordedSeconds = useRecordingStore((s) => s.recordedSeconds);

  return {
    pauseRecording: pauseRecordingCapture,
    resumeRecording: resumeRecordingCapture,
    isRecording,
    isPaused,
    elapsedTime: isRecording ? recordedSeconds : 0,
    source: recordingSource,
  };
}
