import { create } from 'zustand';
import { detectSpeechLanguage } from '@/lib/transcription/languages';
import { persist } from 'zustand/middleware';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { handleRehydrateResult } from "@/lib/persist-rehydrate";
import { t } from '@/lib/i18n';
import type { RecordingWarningKind } from '@/lib/tauri';

export type RecordingSource = 'microphone' | 'system' | 'both';

export const RECORDING_SOURCES: readonly RecordingSource[] = ['microphone', 'system', 'both'];

/**
 * The life of one recording. Every surface that can start or stop a recording
 * goes through `useMeetingRecording`, which only moves along these edges:
 *
 *   idle → starting → recording ⇄ paused → stopping → idle
 *
 * `starting` and `stopping` are the two stretches where the backend is busy
 * (opening devices; compressing the audio, which can take tens of seconds)
 * and a second toggle must do nothing.
 */
export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

/** A non-fatal problem with the live capture, shown on the indicator until dismissed. */
export interface RecordingWarning {
  kind: RecordingWarningKind;
  /** Which source it is about, when known (a silent microphone vs. silent system audio). */
  source: 'microphone' | 'system' | null;
}

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
  /** Longer explanation, shown on demand rather than in the row. */
  detail?: string;
  /** Exactly where the file is fetched from, so the claim is checkable. */
  download_url?: string;
  /** On disk but no longer offered — still listed so it can be deleted. */
  retired?: boolean;
}

export interface DownloadState {
  /** Integer percent, 0 while the total size is unknown. */
  progress: number;
  downloadedBytes?: number;
  /** 0 when the server sent no length. */
  totalBytes?: number;
  bytesPerSec?: number;
  /** Seconds left, `null` when it cannot be estimated. */
  etaSecs?: number | null;
}

interface RecordingStore {
  // Runtime state (not persisted)
  phase: RecordingPhase;
  /** True while a capture exists on the backend (recording or paused). */
  isRecording: boolean;
  /** The source of the LIVE recording. */
  recordingSource: RecordingSource;
  recordingStartTime: number | null;
  /** True while the live capture is paused (stream alive, samples discarded). */
  isPaused: boolean;
  /** Epoch ms when the CURRENT pause began; `null` while running. */
  pauseStartedAt: number | null;
  /** Accumulated duration (ms) of completed pause stretches this recording. */
  pausedTotalMs: number;
  /**
   * Whole seconds of audio RECORDED (from the backend's count of samples
   * written, not the wall clock). The one number every timer shows.
   */
  recordedSeconds: number;
  /** Device names from the last preflight, for the "what is being recorded" hover. */
  inputDevice: string | null;
  outputDevice: string | null;
  /** Live, dismissible warnings (at most one per kind and source). */
  warnings: RecordingWarning[];
  /**
   * What the `role="status"` live region says. `seq` changes on every
   * announcement so the same sentence twice in a row is still announced.
   */
  announcement: { text: string; seq: number };
  /** The "Discard this recording?" dialog. */
  discardConfirmOpen: boolean;
  availableModels: ModelInfo[];
  /** False until the model list has been fetched once: "not downloaded" is only claimed after. */
  modelsLoaded: boolean;
  /** Map of model name → download progress (supports concurrent downloads) */
  activeDownloads: Record<string, DownloadState>;
  /** Map of model name → why its last download failed (cleared on retry). */
  downloadErrors: Record<string, string>;

  // Persisted state
  defaultModel: string;
  speechLanguage: string;
  /**
   * The source the NEXT recording uses: whatever was picked last, in the orb
   * panel or in Settings → Transcription. One field, so the two cannot disagree.
   */
  lastUsedSource: RecordingSource;

  // Actions
  setPhase: (phase: RecordingPhase) => void;
  startRecording: (source: RecordingSource) => void;
  stopRecording: () => void;
  /** Mark the capture paused (state only — the backend call lives in `useRecording`). */
  pauseRecording: () => void;
  /** Mark the capture resumed, folding the pause stretch into `pausedTotalMs`. */
  resumeRecording: () => void;
  setRecordedSeconds: (seconds: number) => void;
  setDevices: (input: string | null, output: string | null) => void;
  addWarning: (warning: RecordingWarning) => void;
  dismissWarning: (kind: RecordingWarningKind, source?: 'microphone' | 'system' | null) => void;
  announce: (text: string) => void;
  setDiscardConfirmOpen: (open: boolean) => void;
  setLastUsedSource: (source: RecordingSource) => void;
  setAvailableModels: (models: ModelInfo[]) => void;
  setDefaultModel: (model: string) => void;
  setSpeechLanguage: (language: string) => void;
  refreshModels: () => Promise<void>;
  downloadModel: (size: string) => void;
  cancelDownload: (size: string) => void;
  deleteModel: (size: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Live input levels: deliberately NOT store state.
//
// The backend emits `recording-level` up to ten times a second. Putting that
// in the store would re-render every subscriber at that rate (the reason the
// first meter was removed, audit 2026-11-22 §3). Instead the latest levels
// sit in a plain object, and a meter reads them from a `requestAnimationFrame`
// loop and writes a CSS transform: no React render is involved at all.
// ---------------------------------------------------------------------------

export interface RecordingLevels {
  /** Peak 0..1 since the last event; `null` when the source is not captured. */
  mic: number | null;
  system: number | null;
  /** `performance.now()`-style stamp of the last event, 0 before the first. */
  at: number;
}

const levels: RecordingLevels = { mic: null, system: null, at: 0 };

function clampLevel(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/** Record the latest levels. Called from the `recording-level` listener. */
export function publishRecordingLevels(next: { mic: number | null; system: number | null }): void {
  levels.mic = clampLevel(next.mic);
  levels.system = clampLevel(next.system);
  levels.at = Date.now();
}

/** The latest levels. The same object every time: read it, do not keep it. */
export function readRecordingLevels(): Readonly<RecordingLevels> {
  return levels;
}

export function resetRecordingLevels(): void {
  levels.mic = null;
  levels.system = null;
  levels.at = 0;
}

// ---------------------------------------------------------------------------
// Model download progress
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;

interface DownloadTracker {
  /** Integer percent (known total) or whole MB (unknown total) last written. */
  key: number;
  lastBytes: number;
  lastAt: number;
  bytesPerSec: number;
}

/**
 * Turn one `model-download-progress` event into the next stored state, or
 * `null` when nothing a person can see has changed.
 *
 * The store is only written when the integer percent changes (or, when the
 * server sent no length, when another whole megabyte has arrived): events
 * arrive ~10 a second and the page showing them should not re-render at that
 * rate. Speed is smoothed so the estimate does not jump around.
 */
export function nextDownloadState(
  tracker: DownloadTracker | undefined,
  downloaded: number,
  total: number,
  now: number,
): { tracker: DownloadTracker; state: DownloadState | null } {
  const known = total > 0;
  const percent = known ? Math.min(100, Math.floor((downloaded / total) * 100)) : 0;
  const key = known ? percent : Math.floor(downloaded / MB);
  if (!tracker) {
    return {
      tracker: { key, lastBytes: downloaded, lastAt: now, bytesPerSec: 0 },
      state: { progress: percent, downloadedBytes: downloaded, totalBytes: total, bytesPerSec: 0, etaSecs: null },
    };
  }
  if (key === tracker.key) return { tracker, state: null };
  const elapsedSecs = (now - tracker.lastAt) / 1000;
  const instant = elapsedSecs > 0 ? Math.max(0, downloaded - tracker.lastBytes) / elapsedSecs : 0;
  const bytesPerSec = tracker.bytesPerSec > 0 ? tracker.bytesPerSec * 0.7 + instant * 0.3 : instant;
  const etaSecs = known && bytesPerSec > 0 ? Math.max(0, Math.round((total - downloaded) / bytesPerSec)) : null;
  return {
    tracker: { key, lastBytes: downloaded, lastAt: now, bytesPerSec },
    state: { progress: percent, downloadedBytes: downloaded, totalBytes: total, bytesPerSec, etaSecs },
  };
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

export const useRecordingStore = create<RecordingStore>()(
  persist(
    (set, get) => ({
      // Runtime state
      phase: 'idle',
      isRecording: false,
      recordingSource: 'microphone',
      recordingStartTime: null,
      isPaused: false,
      pauseStartedAt: null,
      pausedTotalMs: 0,
      recordedSeconds: 0,
      inputDevice: null,
      outputDevice: null,
      warnings: [],
      announcement: { text: '', seq: 0 },
      discardConfirmOpen: false,
      availableModels: [],
      modelsLoaded: false,
      activeDownloads: {},
      downloadErrors: {},

      // Persisted state
      //
      // The quality model is the default rather than a small one: measured,
      // it needs LESS memory than `small` (0.6 GB vs 0.7 GB) while making
      // less than half the errors outside English.
      // See `docs/transcription-model-comparison.md`.
      defaultModel: 'large-v3-turbo-q5_0',
      // The device's language, not 'auto'. Auto-detect reads reliably for
      // English and poorly for everything else — on a Swedish corpus it cost
      // every model up to 10 points of word error, and once produced a fluent
      // Albanian transliteration of Swedish speech. A recording can still be
      // in any language: this is the starting point, changeable per
      // transcription — and the language picked for one recording becomes
      // the starting point for the next.
      speechLanguage: detectSpeechLanguage(),
      lastUsedSource: 'microphone',

      // Actions
      setPhase: (phase) => set({ phase }),

      startRecording: (source) =>
        set({
          phase: 'recording',
          isRecording: true,
          recordingSource: source,
          recordingStartTime: Date.now(),
          isPaused: false,
          pauseStartedAt: null,
          pausedTotalMs: 0,
          recordedSeconds: 0,
          warnings: [],
          lastUsedSource: source,
        }),

      stopRecording: () =>
        set({
          phase: 'idle',
          isRecording: false,
          recordingStartTime: null,
          isPaused: false,
          pauseStartedAt: null,
          pausedTotalMs: 0,
          recordedSeconds: 0,
          warnings: [],
          discardConfirmOpen: false,
        }),

      pauseRecording: () => {
        const s = get();
        if (!s.isRecording || s.isPaused) return;
        set({ phase: 'paused', isPaused: true, pauseStartedAt: Date.now() });
      },

      resumeRecording: () => {
        const s = get();
        if (!s.isPaused) return;
        const stretch = s.pauseStartedAt ? Date.now() - s.pauseStartedAt : 0;
        set({
          phase: 'recording',
          isPaused: false,
          pauseStartedAt: null,
          pausedTotalMs: s.pausedTotalMs + Math.max(0, stretch),
        });
      },

      setRecordedSeconds: (seconds) => {
        const whole = Math.max(0, Math.floor(seconds));
        if (whole !== get().recordedSeconds) set({ recordedSeconds: whole });
      },

      setDevices: (input, output) => {
        const s = get();
        if (s.inputDevice !== input || s.outputDevice !== output) {
          set({ inputDevice: input, outputDevice: output });
        }
      },

      addWarning: (warning) => {
        const { warnings } = get();
        if (warnings.some((w) => w.kind === warning.kind && w.source === warning.source)) return;
        set({ warnings: [...warnings, warning] });
      },

      dismissWarning: (kind, source) => {
        const { warnings } = get();
        const next = warnings.filter(
          (w) => !(w.kind === kind && (source === undefined || w.source === source)),
        );
        if (next.length !== warnings.length) set({ warnings: next });
      },

      announce: (text) => set({ announcement: { text, seq: get().announcement.seq + 1 } }),

      setDiscardConfirmOpen: (open) => set({ discardConfirmOpen: open }),


      setLastUsedSource: (source) => set({ lastUsedSource: source }),

      setAvailableModels: (models) =>
        set({ availableModels: models }),

      setDefaultModel: (model) =>
        set({ defaultModel: model }),

      setSpeechLanguage: (language) =>
        set({ speechLanguage: language }),

      refreshModels: async () => {
        try {
          const result = await invoke<ModelInfo[]>('list_whisper_models');
          set({ availableModels: result, modelsLoaded: true });
        } catch (err) {
          toast.error(t("settings.transcription.loadFailed", { error: String(err) }));
        }
      },

      downloadModel: (size: string) => {
        if (get().activeDownloads[size]) return;

        set({
          activeDownloads: {
            ...get().activeDownloads,
            [size]: { progress: 0, downloadedBytes: 0, totalBytes: 0, bytesPerSec: 0, etaSecs: null },
          },
          downloadErrors: withoutKey(get().downloadErrors, size),
        });

        // Fire-and-forget: the download runs in the Tauri backend,
        // progress arrives via events, completion updates store.
        (async () => {
          let tracker: DownloadTracker | undefined;
          let unlisten: (() => void) | null = null;
          try {
            unlisten = await listen<{ model: string; downloaded: number; total: number }>(
              'model-download-progress',
              (event) => {
                if (event.payload.model !== size) return;
                const next = nextDownloadState(
                  tracker,
                  event.payload.downloaded,
                  event.payload.total,
                  Date.now(),
                );
                tracker = next.tracker;
                if (next.state && get().activeDownloads[size]) {
                  set({ activeDownloads: { ...get().activeDownloads, [size]: next.state } });
                }
              },
            );
            await invoke('download_whisper_model', { size });
            toast.success(t("settings.transcription.downloadDone", { model: size }));
            await get().refreshModels();
          } catch (err) {
            const msg = String(err instanceof Error ? err.message : err);
            if (!msg.toLowerCase().includes('cancelled')) {
              set({ downloadErrors: { ...get().downloadErrors, [size]: msg } });
              toast.error(t("settings.transcription.downloadFailed", { model: size, error: msg }), {
                action: {
                  label: t("settings.transcription.retry"),
                  onClick: () => get().downloadModel(size),
                },
              });
            }
          } finally {
            unlisten?.();
            set({ activeDownloads: withoutKey(get().activeDownloads, size) });
          }
        })().catch(() => {
          // Everything above is caught; this only keeps a rejection from
          // ever surfacing as unhandled.
        });
      },

      cancelDownload: (size: string) => {
        invoke('cancel_model_download', { size }).catch(() => {
          // Already finished or not found — ignore
        });
      },

      deleteModel: async (size: string) => {
        try {
          await invoke('delete_whisper_model', { size });
          toast.success(t("settings.transcription.deleted", { model: size }));
          await get().refreshModels();
          // Deleting the SELECTED model would otherwise leave `defaultModel`
          // pointing at a file that no longer exists: the next recording
          // fails with "Model not downloaded". Newly reachable now that
          // retired models are listed with a delete control, which invites
          // exactly this.
          if (get().defaultModel === size) {
            const next = get().availableModels.find((m) => m.downloaded);
            if (next) set({ defaultModel: next.name });
          }
        } catch (err) {
          toast.error(t("settings.transcription.deleteFailed", { error: String(err) }));
        }
      },
    }),
    {
      name: 'notesage-recording',
      onRehydrateStorage: () => (_state, error) => handleRehydrateResult("notesage-recording", error),
      version: 1,
      migrate: (persisted: unknown, version: number) => {
        // Not just `?? {}`: a corrupted blob could deserialize to a
        // primitive, and assigning a property to one THROWS in strict mode
        // (module code always is), taking the whole store down on rehydrate.
        const state =
          persisted && typeof persisted === 'object'
            ? (persisted as Partial<RecordingStore>)
            : ({} as Partial<RecordingStore>);
        if (version >= 1) return state;

        // Move existing installs off auto-detect.
        //
        // 'auto' WAS the default, so a stored 'auto' is almost always "never
        // touched it" rather than a decision — and there is no way to tell the
        // two apart. Leaving it alone would mean the fix reaches only new
        // installs, while every existing user keeps the behaviour that turned
        // a Swedish clip into Albanian. Overriding it is visible (the card now
        // shows the language) and one click to undo; not overriding it is
        // invisible and permanent.
        if (!state.speechLanguage || state.speechLanguage === 'auto') {
          state.speechLanguage = detectSpeechLanguage();
        }

        // Deliberately NOT touching `defaultModel`. Switching someone from a
        // model they have on disk to one they do not would point transcription
        // at a missing file and fail their next recording — a working setup
        // broken by an upgrade. Their model still works; it is simply no
        // longer offered, and the mismatch note says when it is a poor fit.
        return state;
      },
      // A stored source from a build that knew other names must not reach
      // `start_recording`: fall back to the microphone.
      merge: (persisted, current) => {
        const stored =
          persisted && typeof persisted === 'object' ? (persisted as Partial<RecordingStore>) : {};
        const source = stored.lastUsedSource;
        return {
          ...current,
          ...stored,
          lastUsedSource:
            source && RECORDING_SOURCES.includes(source) ? source : current.lastUsedSource,
        };
      },
      partialize: (state) => ({
        defaultModel: state.defaultModel,
        speechLanguage: state.speechLanguage,
        lastUsedSource: state.lastUsedSource,
      }),
    },
  ),
);

/** True when the model list is known and the selected model is on disk. */
export function isDefaultModelDownloaded(state: Pick<RecordingStore, 'availableModels' | 'defaultModel'>): boolean {
  return state.availableModels.some((m) => m.name === state.defaultModel && m.downloaded);
}
