import { useState, useCallback, useRef, useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriApi } from '@/lib/tauri';
import { useRecordingStore } from '@/stores/recording-store';
import { toast } from 'sonner';
import { log } from '@/lib/logger';

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
  const { speechLanguage, defaultModel, startDictating: storeStartDictating, stopDictating: storeStopDictating } = useRecordingStore();

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
      log.info('transcription', 'Starting Whisper dictation', { language: speechLanguage, defaultModel });

      // Ensure a Whisper model is downloaded before starting dictation
      const models = await tauriApi.listWhisperModels();
      const downloadedModels = models.filter((m: { downloaded: boolean }) => m.downloaded);
      const preferredModel = models.find((m: { name: string; downloaded: boolean }) => m.name === defaultModel);
      log.info('transcription', 'Whisper models check', {
        totalModels: models.length,
        preferredModel: defaultModel,
        preferredDownloaded: preferredModel?.downloaded ?? false,
        downloadedModels: downloadedModels.map((m: { name: string }) => m.name),
      });

      if (downloadedModels.length === 0) {
        // No models at all — download the default (or base as fallback)
        const modelToDownload = preferredModel ? defaultModel : 'base';
        log.info('transcription', `Auto-downloading '${modelToDownload}' Whisper model for dictation`);
        toast.info('Downloading speech recognition model...');
        await tauriApi.downloadWhisperModel(modelToDownload);
        toast.success('Speech model ready');
        log.info('transcription', `Model '${modelToDownload}' download complete`);
      }

      const unlisten = await listen<{ text: string; is_final: boolean; error?: string }>(
        'dictation-result',
        (event) => {
          if (event.payload.error) {
            log.error('transcription', 'Dictation error event', { error: event.payload.error });
            toast.error(event.payload.error);
            setIsDictating(false);
            storeStopDictating();
            return;
          }
          if (event.payload.is_final) {
            log.info('transcription', 'Dictation finished');
            setIsDictating(false);
            storeStopDictating();
          } else if (event.payload.text) {
            setFinalText((prev) => prev + ' ' + event.payload.text);
          }
        }
      );
      unlistenRef.current = unlisten;

      await tauriApi.startDictation(speechLanguage, defaultModel);
      log.info('transcription', 'Whisper dictation started successfully', { model: defaultModel });
      setIsDictating(true);
      storeStartDictating();
    } catch (err) {
      log.error('transcription', 'Failed to start Whisper dictation', err);
      toast.error(`Failed to start dictation: ${err}`);
    }
  }, [speechLanguage, defaultModel, storeStartDictating, storeStopDictating]);

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
            log.info('transcription', `Web Speech API unavailable (${event.error}), falling back to Whisper`);
            setWebSpeechWorks(false);
            recognition.stop();
            recognitionRef.current = null;
            // Retry immediately with whisper-rs
            startWhisperDictation();
            return;
          }
          if (event.error !== 'aborted') {
            log.error('transcription', `Web Speech API error: ${event.error}`);
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
        log.info('transcription', 'Web Speech API start() threw, falling back to Whisper');
        setWebSpeechWorks(false);
        await startWhisperDictation();
      }
    } else {
      // No Web Speech API or it's known to not work — use whisper-rs
      log.info('transcription', `Using Whisper dictation (webSpeechWorks=${webSpeechWorks}, hasSpeechRecognition=${!!SpeechRecognitionClass})`);
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
