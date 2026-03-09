import { useState, useCallback, useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriApi, type TranscriptionResultData, type WhisperModelInfo } from '@/lib/tauri';
import { useRecordingStore } from '@/stores/recording-store';
import { toast } from 'sonner';

interface TranscriptionHook {
  transcribe: (model: string) => Promise<TranscriptionResultData | null>;
  isTranscribing: boolean;
  progress: number;
  progressSegment: string;
  result: TranscriptionResultData | null;
  availableModels: WhisperModelInfo[];
  refreshModels: () => Promise<void>;
}

export function useTranscription(): TranscriptionHook {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressSegment, setProgressSegment] = useState('');
  const [result, setResult] = useState<TranscriptionResultData | null>(null);
  const { availableModels, setAvailableModels } = useRecordingStore();
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const refreshModels = useCallback(async () => {
    try {
      const models = await tauriApi.listWhisperModels();
      setAvailableModels(models);
    } catch (err) {
      toast.error(`Failed to list models: ${err}`);
    }
  }, [setAvailableModels]);

  // Load models on mount
  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  const { speechLanguage } = useRecordingStore();

  const transcribe = useCallback(async (model: string): Promise<TranscriptionResultData | null> => {
    setIsTranscribing(true);
    setProgress(0);
    setProgressSegment('');
    setResult(null);

    try {
      // Listen for progress events
      const unlisten = await listen<{ percent: number; segment?: string }>(
        'transcription-progress',
        (event) => {
          setProgress(event.payload.percent);
          if (event.payload.segment) {
            setProgressSegment(event.payload.segment);
          }
        }
      );
      unlistenRef.current = unlisten;

      const transcriptionResult = await tauriApi.transcribe(model, speechLanguage);
      setResult(transcriptionResult);
      return transcriptionResult;
    } catch (err) {
      toast.error(`Transcription failed: ${err}`);
      return null;
    } finally {
      setIsTranscribing(false);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
  }, [speechLanguage]);

  return {
    transcribe,
    isTranscribing,
    progress,
    progressSegment,
    result,
    availableModels,
    refreshModels,
  };
}
