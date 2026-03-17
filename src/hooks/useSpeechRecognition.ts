import { useState, useCallback, useRef, useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriApi } from '@/lib/tauri';
import { useRecordingStore } from '@/stores/recording-store';
import { toast } from 'sonner';

interface SpeechRecognitionHook {
  startDictation: () => Promise<void>;
  stopDictation: () => Promise<void>;
  isDictating: boolean;
  interimText: string;
  finalText: string;
  isWebSpeechAvailable: boolean;
}

export function useSpeechRecognition(): SpeechRecognitionHook {
  const [isDictating, setIsDictating] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [finalText, setFinalText] = useState('');
  // Track whether Web Speech API actually works (WKWebView has the constructor but blocks the service)
  const [webSpeechWorks, setWebSpeechWorks] = useState(true);

  const recognitionRef = useRef<unknown>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const { speechLanguage, startDictating: storeStartDictating, stopDictating: storeStopDictating } = useRecordingStore();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  const startWhisperDictation = useCallback(async () => {
    try {
      // Ensure the base Whisper model is downloaded before starting dictation
      const models = await tauriApi.listWhisperModels();
      const baseModel = models.find((m: { name: string; downloaded: boolean }) => m.name === 'base');
      if (!baseModel?.downloaded) {
        toast.info('Downloading speech recognition model...');
        await tauriApi.downloadWhisperModel('base');
        toast.success('Speech model ready');
      }

      const unlisten = await listen<{ text: string; is_final: boolean; error?: string }>(
        'dictation-result',
        (event) => {
          if (event.payload.error) {
            toast.error(event.payload.error);
            setIsDictating(false);
            storeStopDictating();
            return;
          }
          if (event.payload.is_final) {
            setIsDictating(false);
            storeStopDictating();
          } else if (event.payload.text) {
            setFinalText((prev) => prev + ' ' + event.payload.text);
          }
        }
      );
      unlistenRef.current = unlisten;

      await tauriApi.startDictation(speechLanguage);
      setIsDictating(true);
      storeStartDictating();
    } catch (err) {
      toast.error(`Failed to start dictation: ${err}`);
    }
  }, [speechLanguage, storeStartDictating, storeStopDictating]);

  const startDictation = useCallback(async () => {
    if (isDictating) return;

    setInterimText('');
    setFinalText('');

    // Try Web Speech API first (works in browsers, not in WKWebView)
    const SpeechRecognitionClass =
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition ||
      (window as unknown as Record<string, unknown>).SpeechRecognition;

    if (SpeechRecognitionClass && webSpeechWorks) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const recognition = new (SpeechRecognitionClass as any)();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = speechLanguage || 'en-US';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recognition.onresult = (event: any) => {
          let interim = '';
          let final_ = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              final_ += transcript;
            } else {
              interim += transcript;
            }
          }
          if (interim) setInterimText(interim);
          if (final_) {
            setFinalText((prev) => prev + final_);
            setInterimText('');
          }
        };

        recognition.onerror = (event: { error: string }) => {
          if (event.error === 'service-not-allowed' || event.error === 'not-allowed') {
            // Web Speech API not available in this webview — permanently fall back to whisper-rs
            setWebSpeechWorks(false);
            recognition.stop();
            recognitionRef.current = null;
            // Retry immediately with whisper-rs
            startWhisperDictation();
            return;
          }
          if (event.error !== 'aborted') {
            toast.error(`Speech recognition error: ${event.error}`);
          }
          setIsDictating(false);
          storeStopDictating();
        };

        recognition.onend = () => {
          setIsDictating(false);
          storeStopDictating();
          recognitionRef.current = null;
        };

        recognition.start();
        recognitionRef.current = recognition;
        setIsDictating(true);
        storeStartDictating();
      } catch {
        // Constructor exists but start() threw — fall back to whisper-rs
        setWebSpeechWorks(false);
        await startWhisperDictation();
      }
    } else {
      // No Web Speech API or it's known to not work — use whisper-rs
      await startWhisperDictation();
    }
  }, [isDictating, webSpeechWorks, speechLanguage, storeStartDictating, storeStopDictating, startWhisperDictation]);

  const stopDictation = useCallback(async () => {
    if (!isDictating) return;

    if (recognitionRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (recognitionRef.current as any).stop();
      recognitionRef.current = null;
    } else {
      try {
        await tauriApi.stopDictation();
      } catch (err) {
        toast.error(`Failed to stop dictation: ${err}`);
      }
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }

    setIsDictating(false);
    storeStopDictating();
  }, [isDictating, storeStopDictating]);

  return {
    startDictation,
    stopDictation,
    isDictating,
    interimText,
    finalText,
    isWebSpeechAvailable: webSpeechWorks,
  };
}
