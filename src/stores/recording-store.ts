import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

export type RecordingSource = 'microphone' | 'system' | 'both';

export interface ModelInfo {
  name: string;
  size_bytes: number;
  downloaded: boolean;
  path?: string;
  author?: string;
  license?: string;
  parameters?: string;
  description?: string;
  languages_count?: number;
  hf_repo_id?: string;
}

export interface DownloadState {
  progress: number;
}

interface RecordingStore {
  // Runtime state (not persisted)
  isRecording: boolean;
  recordingSource: RecordingSource;
  recordingStartTime: number | null;
  /** True while the live capture is paused (stream alive, samples discarded). */
  isPaused: boolean;
  /** Epoch ms when the CURRENT pause began; `null` while running. */
  pauseStartedAt: number | null;
  /** Accumulated duration (ms) of completed pause stretches this recording. */
  pausedTotalMs: number;
  transcriptionProgress: number;
  availableModels: ModelInfo[];
  /** Map of model name → download progress (supports concurrent downloads) */
  activeDownloads: Record<string, DownloadState>;

  // Persisted state
  defaultModel: string;
  speechLanguage: string;
  lastUsedSource: RecordingSource;

  // Actions
  startRecording: (source: RecordingSource) => void;
  stopRecording: () => void;
  /** Mark the capture paused (state only — the backend call lives in `useRecording`). */
  pauseRecording: () => void;
  /** Mark the capture resumed, folding the pause stretch into `pausedTotalMs`. */
  resumeRecording: () => void;
  setTranscriptionProgress: (progress: number) => void;
  setAvailableModels: (models: ModelInfo[]) => void;
  setDefaultModel: (model: string) => void;
  setSpeechLanguage: (language: string) => void;
  refreshModels: () => Promise<void>;
  downloadModel: (size: string) => void;
  cancelDownload: (size: string) => void;
  deleteModel: (size: string) => Promise<void>;
}

// RAF-throttled progress updates per model to avoid render storms
const pendingProgress: Record<string, number> = {};
let progressRAF: number | null = null;
let storeSet: ((partial: Partial<RecordingStore>) => void) | null = null;
let storeGet: (() => RecordingStore) | null = null;

function scheduleProgressFlush() {
  if (progressRAF !== null) return;
  progressRAF = requestAnimationFrame(() => {
    progressRAF = null;
    if (!storeGet || !storeSet) return;
    const current = storeGet().activeDownloads;
    const updated = { ...current };
    let changed = false;
    for (const [model, progress] of Object.entries(pendingProgress)) {
      if (updated[model] && updated[model].progress !== progress) {
        updated[model] = { progress };
        changed = true;
      }
    }
    if (changed) {
      storeSet({ activeDownloads: updated });
    }
  });
}

export const useRecordingStore = create<RecordingStore>()(
  persist(
    (set, get) => {
      // Capture set/get for the RAF callback
      storeSet = set as (partial: Partial<RecordingStore>) => void;
      storeGet = get;

      return {
        // Runtime state
        isRecording: false,
        recordingSource: 'microphone',
        recordingStartTime: null,
        isPaused: false,
        pauseStartedAt: null,
        pausedTotalMs: 0,
        transcriptionProgress: 0,
        availableModels: [],
        activeDownloads: {},

        // Persisted state
        defaultModel: 'base',
        // 'auto' lets Whisper detect the spoken language (all 99 it supports)
        // instead of forcing English and mistranscribing other languages.
        speechLanguage: 'auto',
        lastUsedSource: 'microphone',

        // Actions
        startRecording: (source) =>
          set({
            isRecording: true,
            recordingSource: source,
            recordingStartTime: Date.now(),
            isPaused: false,
            pauseStartedAt: null,
            pausedTotalMs: 0,
            lastUsedSource: source,
            transcriptionProgress: 0,
          }),

        stopRecording: () =>
          set({
            isRecording: false,
            recordingStartTime: null,
            isPaused: false,
            pauseStartedAt: null,
            pausedTotalMs: 0,
          }),

        pauseRecording: () => {
          const s = get();
          if (!s.isRecording || s.isPaused) return;
          set({ isPaused: true, pauseStartedAt: Date.now() });
        },

        resumeRecording: () => {
          const s = get();
          if (!s.isPaused) return;
          const stretch = s.pauseStartedAt ? Date.now() - s.pauseStartedAt : 0;
          set({
            isPaused: false,
            pauseStartedAt: null,
            pausedTotalMs: s.pausedTotalMs + Math.max(0, stretch),
          });
        },

        setTranscriptionProgress: (progress) =>
          set({ transcriptionProgress: progress }),

        setAvailableModels: (models) =>
          set({ availableModels: models }),

        setDefaultModel: (model) =>
          set({ defaultModel: model }),

        setSpeechLanguage: (language) =>
          set({ speechLanguage: language }),

        refreshModels: async () => {
          try {
            const result = await invoke<ModelInfo[]>('list_whisper_models');
            set({ availableModels: result });
          } catch (err) {
            toast.error(`Failed to load models: ${err}`);
          }
        },

        downloadModel: (size: string) => {
          if (get().activeDownloads[size]) return;

          set({
            activeDownloads: {
              ...get().activeDownloads,
              [size]: { progress: 0 },
            },
          });

          // Fire-and-forget: the download runs in the Tauri backend,
          // progress arrives via events, completion updates store.
          (async () => {
            const unlisten = await listen<{ model: string; downloaded: number; total: number }>(
              'model-download-progress',
              (event) => {
                if (event.payload.model === size && event.payload.total > 0) {
                  pendingProgress[size] = (event.payload.downloaded / event.payload.total) * 100;
                  scheduleProgressFlush();
                }
              },
            );

            try {
              await invoke('download_whisper_model', { size });
              toast.success(`Model '${size}' downloaded`);
              await get().refreshModels();
            } catch (err) {
              const msg = String(err);
              if (!msg.includes('cancelled')) {
                toast.error(`Download failed: ${err}`);
              }
            } finally {
              unlisten();
              delete pendingProgress[size];
              const { [size]: _, ...rest } = get().activeDownloads;
              set({ activeDownloads: rest });
            }
          })();
        },

        cancelDownload: (size: string) => {
          invoke('cancel_model_download', { size }).catch(() => {
            // Already finished or not found — ignore
          });
        },

        deleteModel: async (size: string) => {
          try {
            await invoke('delete_whisper_model', { size });
            toast.success(`Model '${size}' deleted`);
            await get().refreshModels();
          } catch (err) {
            toast.error(`Failed to delete model: ${err}`);
          }
        },
      };
    },
    {
      name: 'notesage-recording',
      partialize: (state) => ({
        defaultModel: state.defaultModel,
        speechLanguage: state.speechLanguage,
        lastUsedSource: state.lastUsedSource,
      }),
    },
  ),
);
