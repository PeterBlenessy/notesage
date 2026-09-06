import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';
import type { LocalAgentEngine } from '@/lib/ai/local-agent-engines';
import type {
  LocalModelInfo,
  SystemMemoryInfo,
  BinaryStatus,
  HardwareProfile,
  ModelFitResult,
  GgufCapabilities,
} from '@/lib/tauri';

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'error';
export type BinaryState = 'unknown' | 'available' | 'not_found';
export type ModelCategory = 'all' | 'general' | 'code' | 'reasoning' | 'compact' | 'downloaded';

/**
 * Local Agent setup-flow stages (task #15). Linear path plus terminal `ready` /
 * `failed`. `idle` = the flow has never run (or was reset).
 */
export type LocalAgentSetupStage =
  | 'idle'
  | 'detecting'   // hardware-tier detection + model recommendation
  | 'downloading' // agent install + model download (parallel)
  | 'configuring' // local_agent_write_config + connection/routing setup
  | 'verifying'   // smoke test
  | 'ready'
  | 'failed';

/** The active (in-flight) stages a failure can be attributed to. */
export type LocalAgentActiveStage = Exclude<LocalAgentSetupStage, 'idle' | 'ready' | 'failed'>;

export interface LocalAgentSetupState {
  stage: LocalAgentSetupStage;
  /** When `stage === 'failed'`, the stage that was active when it failed. */
  failedStage?: LocalAgentActiveStage;
  /** Human-readable failure message. Transient — never persisted. */
  error?: string;
  /** Model chosen for the agent. Persisted so an interrupted flow can resume. */
  modelId?: string;
  /**
   * WHICH engine this flow belongs to.
   *
   * There is one setup flow at a time (one dialog), but there are two engines
   * and they coexist — so an untagged flow is ambiguous the moment the second
   * one is set up. It was: with Goose installed, `stage: 'ready'` persisted and
   * opening the pi dialog showed every step already complete, so nothing was
   * downloaded or configured and pi could never be added at all.
   *
   * Read it through `setupStateFor(state, engine)`, never directly — the whole
   * point is that state belonging to the other engine must read as `idle`.
   */
  engine?: LocalAgentEngine;
}

/**
 * This engine's setup state, or a fresh `idle` when the stored flow belongs to
 * the other one.
 *
 * The untagged case (`engine` undefined) is persisted state written before the
 * tag existed. It is treated as belonging to whichever engine asks, which
 * preserves resume-after-relaunch for the single-engine users who make up
 * everyone upgrading — and is harmless for the two-engine case, because the
 * first thing the dialog does on a mismatch is claim the flow.
 */
/**
 * The ONE idle snapshot handed back for a flow that belongs to the other
 * engine.
 *
 * It has to be a shared constant, not a fresh literal. `useLocalAgentSetup`
 * calls `setupStateFor` INSIDE a Zustand selector, so its return value is what
 * `useSyncExternalStore` compares between renders: a new object each call is a
 * snapshot that never equals itself, which React reports as "The result of
 * getSnapshot should be cached to avoid an infinite loop" and then escalates
 * to error #185 (maximum update depth) — an app that logs its startup and then
 * stops, with no window (Peter, 0.54.4, 2026-09-06). It only ever bit someone
 * whose persisted flow was tagged for the OTHER engine, which is why no test
 * and no clean install ever saw it.
 *
 * Frozen so a caller that tries to mutate the shared value says so loudly
 * instead of corrupting every later read.
 */
const IDLE_SETUP: LocalAgentSetupState = Object.freeze({ stage: 'idle' });

export function setupStateFor(
  setup: LocalAgentSetupState,
  engine: LocalAgentEngine,
): LocalAgentSetupState {
  if (setup.engine && setup.engine !== engine) return IDLE_SETUP;
  return setup;
}

export interface DownloadState {
  progress: number;
}

interface LocalAIStore {
  // Persisted
  activeModelId: string | null;
  contextLength: number;
  gpuLayers: number;
  dismissedFirstRun: boolean;
  hiddenModelIds: string[];
  /** Last completion-server model the user picked. Persisted so the panel
   *  remembers the choice across restarts even when the server isn't running. */
  completionModelId: string | null;

  // Runtime (non-persisted)
  serverStatus: ServerStatus;
  serverError: string | null;
  serverStatusReason: string | null;
  serverPort: number | null;
  /** Whether the Local Agent setup dialog (#17) is open. Single app-level flag so
   *  every entry point (#18 empty state, #19 Add Connection, #20 "Fix") opens the
   *  same dialog mounted once at the app root. Non-persisted UI state. */
  localAgentSetupDialogOpen: boolean;
  /** Which engine the setup dialog should configure. Chosen at the Add
   *  Connection menu — there are separate entries per engine — so the dialog
   *  itself no longer asks. Non-persisted UI state. */
  localAgentSetupEngine: LocalAgentEngine;
  /**
   * Local Agent setup-flow state machine (task #15). Persisted enough to resume
   * an interrupted flow after relaunch (stage + modelId; the transient `error`
   * is never persisted). Driven by `useLocalAgentSetup` (#16).
   */
  localAgentSetup: LocalAgentSetupState;
  /** Dedicated FIM server lifecycle (item #8 of the agentic stack).
   *  Mirrors the main server's status/port/error fields. */
  completionServerStatus: ServerStatus;
  completionServerPort: number | null;
  completionServerError: string | null;
  models: LocalModelInfo[];
  downloads: Record<string, DownloadState>;
  systemMemory: SystemMemoryInfo | null;
  binaryStatus: BinaryState;
  categoryFilter: ModelCategory;

  // Hardware-aware model-fit (runtime — recomputed per session, never persisted)
  hardwareProfile: HardwareProfile | null;
  fitById: Record<string, ModelFitResult>;
  capsById: Record<string, GgufCapabilities>;

  // Actions
  setActiveModel: (modelId: string) => void;
  setServerStatus: (status: ServerStatus, error?: string) => void;
  setServerStatusReason: (reason: string | null) => void;
  setServerPort: (port: number | null) => void;
  /** Advance the Local Agent setup state machine (task #15). */
  setLocalAgentSetup: (next: Partial<LocalAgentSetupState> & { stage: LocalAgentSetupStage }) => void;
  /** Reset the setup flow back to `idle` (e.g. user cancels / starts over). */
  resetLocalAgentSetup: () => void;
  /** Open/close the app-level Local Agent setup dialog (#17). Pass the engine
   *  when opening; it is chosen by which Add Connection entry was picked. */
  setLocalAgentSetupDialogOpen: (open: boolean, engine?: LocalAgentEngine) => void;
  setModels: (models: LocalModelInfo[]) => void;
  setSystemMemory: (info: SystemMemoryInfo) => void;
  setHardwareProfile: (profile: HardwareProfile | null) => void;
  setModelFits: (results: ModelFitResult[]) => void;
  setModelCaps: (modelId: string, caps: GgufCapabilities) => void;
  clearModelFits: () => void;
  dismissFirstRun: () => void;
  setContextLength: (len: number) => void;
  setGpuLayers: (layers: number) => void;
  setCategoryFilter: (category: ModelCategory) => void;
  refreshModels: () => Promise<void>;
  downloadModel: (modelId: string) => void;
  cancelDownload: (modelId: string) => void;
  deleteModel: (modelId: string) => Promise<void>;
  addCustomModel: (name: string, url: string, metadata?: {
    supportsToolCalling?: boolean;
    supportsThinking?: boolean;
    supportsVision?: boolean;
    multilingual?: boolean;
    supportsFim?: boolean;
    author?: string;
    architecture?: string;
    contextLength?: number;
    license?: string;
    baseModel?: string;
  }) => Promise<void>;
  removeCustomModel: (modelId: string) => Promise<void>;
  hideModel: (modelId: string) => void;
  unhideModel: (modelId: string) => void;
  restoreDefaults: () => void;
  checkBinary: () => Promise<BinaryStatus>;
  startServer: (modelId: string, contextLength: number, gpuLayers: number) => Promise<void>;
  // Completion-server lifecycle
  setCompletionModelId: (modelId: string | null) => void;
  startCompletionServer: (modelId: string, contextLength?: number, gpuLayers?: number) => Promise<void>;
  stopCompletionServer: () => Promise<void>;
  refreshCompletionServerStatus: () => Promise<void>;
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
        hiddenModelIds: [],
        completionModelId: null,

        // Runtime defaults
        serverStatus: 'stopped',
        serverError: null,
        serverStatusReason: null,
        serverPort: null,
        localAgentSetupDialogOpen: false,
        localAgentSetupEngine: 'goose',
        localAgentSetup: { stage: 'idle' },
        completionServerStatus: 'stopped',
        completionServerPort: null,
        completionServerError: null,
        models: [],
        downloads: {},
        systemMemory: null,
        binaryStatus: 'unknown',
        categoryFilter: 'all',
        hardwareProfile: null,
        fitById: {},
        capsById: {},

        // Actions
        setActiveModel: (modelId) => set({ activeModelId: modelId }),
        setHardwareProfile: (profile) => set({ hardwareProfile: profile }),
        setModelFits: (results) =>
          set((s) => {
            const next = { ...s.fitById };
            for (const r of results) next[r.id] = r;
            return { fitById: next };
          }),
        setModelCaps: (modelId, caps) =>
          set((s) => ({ capsById: { ...s.capsById, [modelId]: caps } })),
        clearModelFits: () => set({ fitById: {}, capsById: {} }),
        setServerStatus: (status, error) => set({ serverStatus: status, serverError: error ?? null }),
        setServerStatusReason: (reason) => set({ serverStatusReason: reason }),
        setServerPort: (port) => set({ serverPort: port }),
        setLocalAgentSetup: (next) =>
          set((s) => {
            // Carry the chosen model id forward across stage transitions unless a
            // call explicitly overrides it. Clear `error`/`failedStage` on any
            // non-failed stage so a recovered flow doesn't show a stale error.
            // Stamp the flow with the engine the dialog is configuring. The
            // caller never passes it — the flow is always for whichever engine
            // was picked in Add Connection, and taking it from one place keeps
            // the tag impossible to forget at a call site.
            //
            // Carrying `modelId` forward only makes sense WITHIN one engine's
            // flow; a stored model chosen for the other engine is not this
            // engine's choice, so it is dropped along with the rest.
            const own = setupStateFor(s.localAgentSetup, s.localAgentSetupEngine);
            const merged: LocalAgentSetupState = {
              modelId: own.modelId,
              ...next,
              engine: s.localAgentSetupEngine,
            };
            if (merged.stage !== 'failed') {
              delete merged.error;
              delete merged.failedStage;
            }
            return { localAgentSetup: merged };
          }),
        resetLocalAgentSetup: () => set({ localAgentSetup: { stage: 'idle' } }),
        setLocalAgentSetupDialogOpen: (open, engine) =>
          set((s) => {
            if (!engine) return { localAgentSetupDialogOpen: open };
            // Opening for a DIFFERENT engine than the stored flow means the
            // stored flow is not this one's. Clear it here, at the single
            // entry point every caller goes through, rather than leaving each
            // consumer to notice — that is how `stage: 'ready'` from Goose came
            // to be shown as pi's completed setup.
            const stale = s.localAgentSetup.engine && s.localAgentSetup.engine !== engine;
            return {
              localAgentSetupDialogOpen: open,
              localAgentSetupEngine: engine,
              ...(stale ? { localAgentSetup: { stage: 'idle' as const } } : {}),
            };
          }),
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

        addCustomModel: async (name, url, metadata) => {
          try {
            await tauriApi.addCustomLocalModel(name, url, metadata);
            toast.success(`Added "${name}" — downloading`);
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

        hideModel: (modelId) => {
          set((s) => ({
            hiddenModelIds: s.hiddenModelIds.includes(modelId) ? s.hiddenModelIds : [...s.hiddenModelIds, modelId],
          }));
        },

        unhideModel: (modelId) => {
          set((s) => ({
            hiddenModelIds: s.hiddenModelIds.filter((id) => id !== modelId),
          }));
        },

        restoreDefaults: () => {
          set({ hiddenModelIds: [] });
          toast.success('Default models restored');
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

        setCompletionModelId: (modelId) => set({ completionModelId: modelId }),

        startCompletionServer: async (modelId, contextLength, gpuLayers) => {
          set({ completionServerStatus: 'starting', completionServerError: null });
          try {
            const port = await tauriApi.startCompletionServer(modelId, contextLength, gpuLayers);
            set({
              completionServerStatus: 'running',
              completionServerPort: port,
              completionModelId: modelId,
              completionServerError: null,
            });
          } catch (err) {
            const errorMsg = String(err);
            set({
              completionServerStatus: 'error',
              completionServerPort: null,
              completionServerError: errorMsg,
            });
            toast.error(`Failed to start completion server: ${errorMsg}`);
          }
        },

        stopCompletionServer: async () => {
          try {
            await tauriApi.stopCompletionServer();
          } catch (err) {
            // Best-effort — even if the backend stop fails, surface the local
            // state as stopped so the UI doesn't get wedged.
            console.warn('[LocalAI] stop_completion_server errored:', err);
          }
          set({ completionServerStatus: 'stopped', completionServerPort: null, completionServerError: null });
        },

        refreshCompletionServerStatus: async () => {
          try {
            const status = await tauriApi.getCompletionServerStatus();
            set({
              completionServerStatus: status.running ? 'running' : 'stopped',
              completionServerPort: status.port,
              completionModelId: status.model ?? get().completionModelId,
            });
          } catch (err) {
            console.warn('[LocalAI] refreshCompletionServerStatus failed:', err);
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
        hiddenModelIds: state.hiddenModelIds,
        completionModelId: state.completionModelId,
        // Persist enough to resume an interrupted setup (stage + model), never
        // the transient `error`/`failedStage` (task #15).
        localAgentSetup: {
          stage: state.localAgentSetup.stage,
          modelId: state.localAgentSetup.modelId,
          // The tag persists with the flow. Without it, a relaunch reads the
          // stored stage as belonging to whichever engine asks first — which is
          // exactly the ambiguity the tag exists to remove.
          engine: state.localAgentSetup.engine,
        },
      }),
    },
  ),
);

// Listen for completion-server status events emitted by the Rust backend.
// Mirror of the main server's event listener pattern — the store stays in
// sync even when start/stop fires from somewhere else (e.g. RunEvent::Exit).
listen<{ running: boolean; port: number | null; model: string | null }>(
  'local-completion-server-status',
  (event) => {
    const { running, port, model } = event.payload;
    useLocalAIStore.setState((prev) => ({
      completionServerStatus: running ? 'running' : 'stopped',
      completionServerPort: port,
      // Only adopt the backend's model when running — a stop event would clear
      // the user's persisted choice otherwise.
      completionModelId: running && model ? model : prev.completionModelId,
    }));
  },
).catch((e) => {
  console.warn('[LocalAI] Failed to register local-completion-server-status listener:', e);
});
