import { useState, useEffect } from 'react';
import { tauriApi, type RecordingResult } from '@/lib/tauri';
import { useRecordingStore, type RecordingSource } from '@/stores/recording-store';
import { recordedElapsedMs } from '@/lib/recording-time';
import { toast } from 'sonner';

interface RecordingHook {
  startRecording: (source: RecordingSource) => Promise<void>;
  stopRecording: () => Promise<RecordingResult | null>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  isRecording: boolean;
  isPaused: boolean;
  /** Recorded seconds — pause-aware (frozen while paused). */
  elapsedTime: number;
  source: RecordingSource;
}

// The capture commands are plain functions, not hook callbacks: they read the
// store lazily, so a caller that only needs to ACT on the recording (the
// app-root ⌘⇧R shortcut) can do so without subscribing to anything. Store
// actions have stable identity, so `getState()` at call time is equivalent to
// the selector the hook used to hold.

/** Start capture on the backend, then mark the store recording. Toasts on failure. */
export async function startRecordingCapture(source: RecordingSource): Promise<void> {
  try {
    await tauriApi.startRecording(source);
    useRecordingStore.getState().startRecording(source);
  } catch (err) {
    toast.error(`Failed to start recording: ${err}`);
  }
}

export async function pauseRecordingCapture(): Promise<void> {
  try {
    await tauriApi.pauseRecording();
    useRecordingStore.getState().pauseRecording();
  } catch (err) {
    toast.error(`Failed to pause recording: ${err}`);
  }
}

export async function resumeRecordingCapture(): Promise<void> {
  try {
    await tauriApi.resumeRecording();
    useRecordingStore.getState().resumeRecording();
  } catch (err) {
    toast.error(`Failed to resume recording: ${err}`);
  }
}

/** Stop capture and return the finalized recording, or `null` on failure. */
export async function stopRecordingCapture(): Promise<RecordingResult | null> {
  try {
    const info = await tauriApi.stopRecording();
    useRecordingStore.getState().stopRecording();
    // Warn if recording appears to be silence (microphone may be blocked)
    if (info.peak < 0.0001 && info.duration_secs > 0) {
      toast.warning('No audio detected — check that Notesage has microphone permission in System Settings > Privacy & Security > Microphone.', {
        duration: 8000,
      });
    }
    return info;
  } catch (err) {
    toast.error(`Failed to stop recording: ${err}`);
    useRecordingStore.getState().stopRecording();
    return null;
  }
}

/**
 * Reactive view of the live recording for surfaces that DISPLAY it.
 *
 * Holds a once-a-second `elapsedTime` tick while recording, so mount it in a
 * leaf — never at the app root, where each tick re-renders the whole tree.
 * To only start/stop, call the `*RecordingCapture` functions above instead.
 *
 * There is deliberately no level meter here. The backend emits
 * `recording-level` once per audio callback (~50–100/s); this hook used to
 * mirror it into state nobody read, re-rendering every consumer at that rate
 * (audit 2026-11-22 §3). A future meter belongs in its own leaf component.
 */
export function useRecording(): RecordingHook {
  // One selector per field: a bare `useRecordingStore()` also re-rendered on
  // model-download and transcription-progress writes.
  const isRecording = useRecordingStore((s) => s.isRecording);
  const isPaused = useRecordingStore((s) => s.isPaused);
  const pauseStartedAt = useRecordingStore((s) => s.pauseStartedAt);
  const pausedTotalMs = useRecordingStore((s) => s.pausedTotalMs);
  const recordingSource = useRecordingStore((s) => s.recordingSource);
  const recordingStartTime = useRecordingStore((s) => s.recordingStartTime);

  const [elapsedTime, setElapsedTime] = useState(0);

  // Elapsed time counter — pause-aware: while paused the displayed time
  // freezes at the pause instant; resumed time excludes the paused stretch.
  useEffect(() => {
    if (!isRecording || !recordingStartTime) {
      setElapsedTime(0);
      return;
    }
    const compute = () =>
      setElapsedTime(
        Math.floor(
          recordedElapsedMs(recordingStartTime, pausedTotalMs, pauseStartedAt, Date.now()) /
            1000,
        ),
      );
    compute();
    const timer = setInterval(compute, 1000);
    return () => clearInterval(timer);
  }, [isRecording, recordingStartTime, pausedTotalMs, pauseStartedAt]);

  return {
    startRecording: startRecordingCapture,
    stopRecording: stopRecordingCapture,
    pauseRecording: pauseRecordingCapture,
    resumeRecording: resumeRecordingCapture,
    isRecording,
    isPaused,
    elapsedTime,
    source: recordingSource,
  };
}
