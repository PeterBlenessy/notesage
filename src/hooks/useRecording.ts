import { useState, useCallback, useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriApi, type RecordingResult } from '@/lib/tauri';
import { useRecordingStore, type RecordingSource } from '@/stores/recording-store';
import { toast } from 'sonner';

interface RecordingHook {
  startRecording: (source: RecordingSource) => Promise<void>;
  stopRecording: () => Promise<RecordingResult | null>;
  isRecording: boolean;
  elapsedTime: number;
  source: RecordingSource;
  micLevel: number;
  systemLevel: number;
}

export function useRecording(): RecordingHook {
  const {
    isRecording,
    recordingSource,
    recordingStartTime,
    startRecording: storeStart,
    stopRecording: storeStop,
  } = useRecordingStore();

  const [elapsedTime, setElapsedTime] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [systemLevel, setSystemLevel] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Elapsed time counter
  useEffect(() => {
    if (isRecording && recordingStartTime) {
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - recordingStartTime) / 1000));
      }, 1000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    } else {
      setElapsedTime(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [isRecording, recordingStartTime]);

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
    isRecording,
    elapsedTime,
    source: recordingSource,
    micLevel,
    systemLevel,
  };
}
