import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';
import type { LocalModelInfo, SystemMemoryInfo, BinaryStatus } from '@/lib/tauri';

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'error';
export type BinaryState = 'unknown' | 'available' | 'downloading' | 'not_found';

export interface DownloadState {
  progress: number;
}

interface LocalAIStore {
  // Persisted
  activeModelId: string | null;
  contextLength: number;
  gpuLayers: number;
  dismissedFirstRun: boolean;

  // Runtime (non-persisted)
  serverStatus: ServerStatus;
  serverError: string | null;
  serverPort: number | null;
  models: LocalModelInfo[];
  downloads: Record<string, DownloadState>;
  systemMemory: SystemMemoryInfo | null;
  binaryStatus: BinaryState;
  binaryDownloadProgress: number;

  // Actions
  setActiveModel: (modelId: string) => void;
  setServerStatus: (status: ServerStatus, error?: string) => void;
  setServerPort: (port: number | null) => void;
  setModels: (models: LocalModelInfo[]) => void;
  setSystemMemory: (info: SystemMemoryInfo) => void;
  dismissFirstRun: () => void;
  setContextLength: (len: number) => void;
  setGpuLayers: (layers: number) => void;
  refreshModels: () => Promise<void>;
  downloadModel: (modelId: string) => void;
  cancelDownload: (modelId: string) => void;
  deleteModel: (modelId: string) => Promise<void>;
  addCustomModel: (name: string, url: string) => Promise<void>;
  removeCustomModel: (modelId: string) => Promise<void>;
  checkBinary: () => Promise<BinaryStatus>;
  downloadBinary: () => Promise<void>;
  cancelBinaryDownload: () => void;
}

// RAF-throttled progress updates to avoid render storms
const pendingProgress: Record<string, number> = {};
let progressRAF: number | null = null;
let storeSet: ((partial: Partial<LocalAIStore>) => void) | null = null;
let storeGet: (() => LocalAIStore) | null = null;

function scheduleProgressFlush() {
  if (progressRAF !== null) return;
  progressRAF = requestAnimationFrame(() => {
    progressRAF = null;
    if (!storeGet || !storeSet) return;
    const current = storeGet().downloads;
    const updated = { ...current };
    let changed = false;
    for (const [model, progress] of Object.entries(pendingProgress)) {
      if (updated[model] && updated[model].progress !== progress) {
        updated[model] = { progress };
        changed = true;
      }
    }
    if (changed) {
      storeSet({ downloads: updated });
    }
  });
}

export const useLocalAIStore = create<LocalAIStore>()(
  persist(
    (set, get) => {
      storeSet = set;
      storeGet = get;

      return {
        // Persisted defaults
        activeModelId: null,
        contextLength: 4096,
        gpuLayers: -1,
        dismissedFirstRun: false,

        // Runtime defaults
        serverStatus: 'stopped',
        serverError: null,
        serverPort: null,
        models: [],
        downloads: {},
        systemMemory: null,
        binaryStatus: 'unknown',
        binaryDownloadProgress: 0,

        // Actions
        setActiveModel: (modelId) => set({ activeModelId: modelId }),
        setServerStatus: (status, error) => set({ serverStatus: status, serverError: error ?? null }),
        setServerPort: (port) => set({ serverPort: port }),
        setModels: (models) => set({ models }),
        setSystemMemory: (info) => set({ systemMemory: info }),
        dismissFirstRun: () => set({ dismissedFirstRun: true }),
        setContextLength: (len) => set({ contextLength: len }),
        setGpuLayers: (layers) => set({ gpuLayers: layers }),

        refreshModels: async () => {
          try {
            const models = await tauriApi.listLocalModels();
            set({ models });
          } catch (e) {
            console.error('Failed to refresh local models:', e);
          }
        },

        downloadModel: (modelId: string) => {
          if (get().downloads[modelId]) return;

          set({
            downloads: {
              ...get().downloads,
              [modelId]: { progress: 0 },
            },
          });

          (async () => {
            const unlisten = await listen<{ model: string; downloaded: number; total: number }>(
              'local-model-download-progress',
              (event) => {
                if (event.payload.model === modelId && event.payload.total > 0) {
                  pendingProgress[modelId] = (event.payload.downloaded / event.payload.total) * 100;
                  scheduleProgressFlush();
                }
              },
            );

            try {
              await tauriApi.downloadLocalModel(modelId);
              toast.success(`Model downloaded`);
              await get().refreshModels();
            } catch (err) {
              const msg = String(err);
              if (!msg.includes('cancelled')) {
                toast.error(`Download failed: ${err}`);
              }
            } finally {
              unlisten();
              delete pendingProgress[modelId];
              const { [modelId]: _, ...rest } = get().downloads;
              set({ downloads: rest });
            }
          })();
        },

        cancelDownload: (modelId: string) => {
          tauriApi.cancelLocalModelDownload(modelId).catch(() => {});
        },

        deleteModel: async (modelId: string) => {
          try {
            await tauriApi.deleteLocalModel(modelId);
            toast.success('Model deleted');
            await get().refreshModels();
          } catch (err) {
            toast.error(`Failed to delete model: ${err}`);
          }
        },

        addCustomModel: async (name: string, url: string) => {
          try {
            await tauriApi.addCustomLocalModel(name, url);
            toast.success(`Added "${name}"`);
            await get().refreshModels();
          } catch (err) {
            toast.error(`Failed to add model: ${err}`);
          }
        },

        removeCustomModel: async (modelId: string) => {
          try {
            await tauriApi.removeCustomLocalModel(modelId);
            toast.success('Custom model removed');
            await get().refreshModels();
          } catch (err) {
            toast.error(`Failed to remove model: ${err}`);
          }
        },

        checkBinary: async () => {
          const status = await tauriApi.checkLlamaServerAvailable();
          set({ binaryStatus: status.available ? 'available' : 'not_found' });
          return status;
        },

        downloadBinary: async () => {
          set({ binaryStatus: 'downloading', binaryDownloadProgress: 0 });

          const unlisten = await listen<{ downloaded: number; total: number }>(
            'llama-binary-download-progress',
            (event) => {
              if (event.payload.total > 0) {
                set({ binaryDownloadProgress: (event.payload.downloaded / event.payload.total) * 100 });
              }
            },
          );

          try {
            await tauriApi.downloadLlamaServerBinary();
            set({ binaryStatus: 'available', binaryDownloadProgress: 100 });
            toast.success('AI engine downloaded');
          } catch (err) {
            const msg = String(err);
            if (!msg.includes('cancelled')) {
              toast.error(`Failed to download AI engine: ${err}`);
            }
            set({ binaryStatus: 'not_found', binaryDownloadProgress: 0 });
          } finally {
            unlisten();
          }
        },

        cancelBinaryDownload: () => {
          tauriApi.cancelLlamaServerDownload().catch(() => {});
        },
      };
    },
    {
      name: 'notesage-local-ai',
      partialize: (state) => ({
        activeModelId: state.activeModelId,
        contextLength: state.contextLength,
        gpuLayers: state.gpuLayers,
        dismissedFirstRun: state.dismissedFirstRun,
      }),
    },
  ),
);
