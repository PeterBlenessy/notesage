import { useState, useCallback, useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
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
  micLevel: number;
  systemLevel: number;
}

export function useRecording(): RecordingHook {
  const {
    isRecording,
    isPaused,
    pauseStartedAt,
    pausedTotalMs,
    recordingSource,
    recordingStartTime,
    startRecording: storeStart,
    stopRecording: storeStop,
    pauseRecording: storePause,
    resumeRecording: storeResume,
  } = useRecordingStore();

  const [elapsedTime, setElapsedTime] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [systemLevel, setSystemLevel] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Elapsed time counter — pause-aware: while paused the displayed time
  // freezes at the pause instant; resumed time excludes the paused stretch.
  useEffect(() => {
    if (isRecording && recordingStartTime) {
      const compute = () =>
        setElapsedTime(
          Math.floor(
            recordedElapsedMs(recordingStartTime, pausedTotalMs, pauseStartedAt, Date.now()) /
              1000,
          ),
        );
      compute();
      timerRef.current = setInterval(compute, 1000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    } else {
      setElapsedTime(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [isRecording, recordingStartTime, pausedTotalMs, pauseStartedAt]);

  // Listen for recording level events
  useEffect(() => {
    if (!isRecording) {
      setMicLevel(0);
      setSystemLevel(0);
      return;
    }

    let mounted = true;
    listen<{ mic: number; system: number }>('recording-level', (event) => {
      if (!mounted) return;
      setMicLevel(event.payload.mic);
      setSystemLevel(event.payload.system);
    }).then((unlisten) => {
      if (!mounted) {
        unlisten();
      } else {
        unlistenRef.current = unlisten;
      }
    });

    return () => {
      mounted = false;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [isRecording]);

  const startRecording = useCallback(async (source: RecordingSource) => {
    try {
      await tauriApi.startRecording(source);
      storeStart(source);
    } catch (err) {
      toast.error(`Failed to start recording: ${err}`);
    }
  }, [storeStart]);

  const pauseRecording = useCallback(async () => {
    try {
      await tauriApi.pauseRecording();
      storePause();
    } catch (err) {
      toast.error(`Failed to pause recording: ${err}`);
    }
  }, [storePause]);

  const resumeRecording = useCallback(async () => {
    try {
      await tauriApi.resumeRecording();
      storeResume();
    } catch (err) {
      toast.error(`Failed to resume recording: ${err}`);
    }
  }, [storeResume]);

  const stopRecording = useCallback(async (): Promise<RecordingResult | null> => {
    try {
      const info = await tauriApi.stopRecording();
      storeStop();
      // Warn if recording appears to be silence (microphone may be blocked)
      if (info.peak < 0.0001 && info.duration_secs > 0) {
        toast.warning('No audio detected — check that Notesage has microphone permission in System Settings > Privacy & Security > Microphone.', {
          duration: 8000,
        });
      }
      return info;
    } catch (err) {
      toast.error(`Failed to stop recording: ${err}`);
      storeStop();
      return null;
    }
  }, [storeStop]);

  return {
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    isRecording,
    isPaused,
    elapsedTime,
    source: recordingSource,
    micLevel,
    systemLevel,
  };
}
