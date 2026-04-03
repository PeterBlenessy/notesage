import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';
import type { LocalModelInfo, SystemMemoryInfo, BinaryStatus } from '@/lib/tauri';

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'error';
export type BinaryState = 'unknown' | 'available' | 'not_found';
export type ModelCategory = 'all' | 'general' | 'code' | 'reasoning' | 'compact' | 'downloaded';

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
  serverStatusReason: string | null;
  serverPort: number | null;
  models: LocalModelInfo[];
  downloads: Record<string, DownloadState>;
  systemMemory: SystemMemoryInfo | null;
  binaryStatus: BinaryState;
  categoryFilter: ModelCategory;

  // Actions
  setActiveModel: (modelId: string) => void;
  setServerStatus: (status: ServerStatus, error?: string) => void;
  setServerStatusReason: (reason: string | null) => void;
  setServerPort: (port: number | null) => void;
  setModels: (models: LocalModelInfo[]) => void;
  setSystemMemory: (info: SystemMemoryInfo) => void;
  dismissFirstRun: () => void;
  setContextLength: (len: number) => void;
  setGpuLayers: (layers: number) => void;
  setCategoryFilter: (category: ModelCategory) => void;
  refreshModels: () => Promise<void>;
  downloadModel: (modelId: string) => void;
  cancelDownload: (modelId: string) => void;
  deleteModel: (modelId: string) => Promise<void>;
  addCustomModel: (name: string, url: string, capabilities?: {
    supportsToolCalling?: boolean;
    supportsThinking?: boolean;
    supportsVision?: boolean;
    multilingual?: boolean;
    supportsFim?: boolean;
  }) => Promise<void>;
  removeCustomModel: (modelId: string) => Promise<void>;
  checkBinary: () => Promise<BinaryStatus>;
  startServer: (modelId: string, contextLength: number, gpuLayers: number) => Promise<void>;
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
        serverStatusReason: null,
        serverPort: null,
        models: [],
        downloads: {},
        systemMemory: null,
        binaryStatus: 'unknown',
        categoryFilter: 'all',

        // Actions
        setActiveModel: (modelId) => set({ activeModelId: modelId }),
        setServerStatus: (status, error) => set({ serverStatus: status, serverError: error ?? null }),
        setServerStatusReason: (reason) => set({ serverStatusReason: reason }),
        setServerPort: (port) => set({ serverPort: port }),
        setModels: (models) => set({ models }),
        setSystemMemory: (info) => set({ systemMemory: info }),
        dismissFirstRun: () => set({ dismissedFirstRun: true }),
        setContextLength: (len) => set({ contextLength: len }),
        setGpuLayers: (layers) => set({ gpuLayers: layers }),
        setCategoryFilter: (category) => set({ categoryFilter: category }),

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
            let unlisten: (() => void) | undefined;
            try {
              unlisten = await listen<{ model: string; downloaded: number; total: number }>(
                'local-model-download-progress',
                (event) => {
                  if (event.payload.model === modelId && event.payload.total > 0) {
                    pendingProgress[modelId] = (event.payload.downloaded / event.payload.total) * 100;
                    scheduleProgressFlush();
                  }
                },
              ).catch((e) => {
                console.warn('[LocalAI] Failed to register listener for local-model-download-progress', e);
                return () => {}; // no-op unlisten
              });

              await tauriApi.downloadLocalModel(modelId);
              toast.success(`Model downloaded`);
              await get().refreshModels();
            } catch (err) {
              const msg = String(err);
              if (!msg.includes('cancelled')) {
                toast.error(`Download failed: ${err}`);
              }
            } finally {
              unlisten?.();
              delete pendingProgress[modelId];
              const { [modelId]: _, ...rest } = get().downloads;
              set({ downloads: rest });
            }
          })();
        },

        cancelDownload: (modelId: string) => {
          tauriApi.cancelLocalModelDownload(modelId).catch((e) => console.warn('Failed to cancel model download:', e));
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

        addCustomModel: async (name, url, capabilities) => {
          try {
            await tauriApi.addCustomLocalModel(name, url, capabilities);
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

        startServer: async (modelId: string, contextLength: number, gpuLayers: number) => {
          set({ serverStatus: 'starting', serverStatusReason: 'Starting...' });
          try {
            const port = await tauriApi.startLocalServer(modelId, contextLength, gpuLayers);
            set({ serverStatus: 'running', serverPort: port, serverStatusReason: null });
          } catch (err) {
            const errorMsg = String(err);
            set({ serverStatus: 'error', serverError: errorMsg, serverStatusReason: `Server failed to start: ${errorMsg}` });
            toast.error(`Failed to start Local AI: ${errorMsg}`);
          }
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
