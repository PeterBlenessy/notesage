import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { listen } from '@tauri-apps/api/event';

import { handleRehydrateResult } from '@/lib/persist-rehydrate';
import {
  SPEAKER_MODEL_DOWNLOAD_PROGRESS_EVENT,
  tauriApi,
  type SpeakerAnalysisProgressEvent,
  type SpeakerModelDownloadProgressEvent,
  type SpeakerModelsStatus,
  type VoiceProfileSummary,
} from '@/lib/tauri';
import { clearAllPreparedAnalyses, clearPreparedAnalysis } from '@/lib/speakers/analysis-cache';
import { nextDownloadState, type DownloadState } from '@/stores/recording-store';

/**
 * Speaker identification: the three opt-in settings, and the transient state
 * around the voice model, the stored voices and running analyses.
 *
 * WHAT IS PERSISTED is the three booleans below and nothing else (see
 * `partialize`). In particular no voiceprint is ever in this store at all:
 * analysis results live in `analysis-cache.ts`, in memory, and the stored
 * voices arrive from the backend as summaries without their embeddings.
 *
 * `rememberVoices` is the user's consent to keeping and comparing voiceprints.
 * Every backend call that creates or matches one is passed this value, and
 * the backend refuses the call when it is not `true`.
 */

/** A voice analysis that is waiting its turn or running, for one recording. */
export interface SpeakerJob {
  jobId: string;
  /**
   * `waiting`: a transcription (or another analysis) is ahead of it in the
   * backend's one-at-a-time queue. `starting`: nothing is ahead, no progress
   * has been reported yet. `running`: the backend has reported progress.
   */
  phase: 'waiting' | 'starting' | 'running';
  stage: SpeakerAnalysisProgressEvent['stage'] | null;
  /** Integer 0..100. */
  percent: number;
  /** Started by the "automatically after transcription" setting, not by the user. */
  automatic: boolean;
}

/** What a finished analysis left for the row to say. */
export interface PreparedSummary {
  voices: number;
  /** At least one voice has a name suggestion (a remembered voice or an introduction). */
  hasSuggestions: boolean;
}

interface SpeakersStore {
  // ── Persisted ────────────────────────────────────────────────────────────
  /** The opt-in: keep voiceprints on this Mac and compare new voices with them. */
  rememberVoices: boolean;
  /** Only meaningful while `rememberVoices` is on. */
  learnFromTeams: boolean;
  /** Run the analysis by itself when a transcription finishes. Suggests only. */
  autoIdentify: boolean;

  // ── Transient ────────────────────────────────────────────────────────────
  models: SpeakerModelsStatus | null;
  /** `null` until asked; then whether every voice model is installed. */
  modelsInstalled: boolean | null;
  download: DownloadState | null;
  downloadError: string | null;
  profiles: VoiceProfileSummary[];
  profilesLoaded: boolean;
  quarantined: number;
  /** Bundle directory → the analysis in progress for it. */
  jobs: Record<string, SpeakerJob>;
  /** Bundle directory → why its last analysis failed (cleared on the next run). */
  jobErrors: Record<string, string>;
  /** Bundle directory → a finished analysis waiting for the user to confirm names. */
  prepared: Record<string, PreparedSummary>;
  /** Settings should scroll its Speakers section into view when it next mounts. */
  focusSettingsSection: boolean;

  setRememberVoices: (on: boolean) => void;
  setLearnFromTeams: (on: boolean) => void;
  setAutoIdentify: (on: boolean) => void;
  refreshModels: () => Promise<boolean>;
  downloadModels: () => void;
  cancelDownload: () => void;
  deleteModels: () => Promise<void>;
  refreshProfiles: () => Promise<void>;
  /** Remove every stored voice, and every analysis result held in memory. */
  deleteAllProfiles: () => Promise<number>;
  setJob: (bundleDir: string, job: SpeakerJob | null) => void;
  setJobError: (bundleDir: string, error: string | null) => void;
  setPrepared: (bundleDir: string, summary: PreparedSummary | null) => void;
  setFocusSettingsSection: (on: boolean) => void;
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function message(err: unknown): string {
  return String(err instanceof Error ? err.message : err).replace(/^Error:\s*/, '');
}

export const useSpeakersStore = create<SpeakersStore>()(
  persist(
    (set, get) => ({
      rememberVoices: false,
      learnFromTeams: false,
      autoIdentify: false,

      models: null,
      modelsInstalled: null,
      download: null,
      downloadError: null,
      profiles: [],
      profilesLoaded: false,
      quarantined: 0,
      jobs: {},
      jobErrors: {},
      prepared: {},
      focusSettingsSection: false,

      setRememberVoices: (on) =>
        // Learning from Teams is part of remembering: it cannot stay on alone.
        set(on ? { rememberVoices: true } : { rememberVoices: false, learnFromTeams: false }),
      setLearnFromTeams: (on) => set({ learnFromTeams: on && get().rememberVoices }),
      setAutoIdentify: (on) => set({ autoIdentify: on }),

      refreshModels: async () => {
        try {
          const models = await tauriApi.speakerModelsStatus();
          set({ models, modelsInstalled: models.installed });
          return models.installed;
        } catch {
          // A backend without the speaker commands (iOS, an older build): the
          // feature is simply not available, which is what "not installed" shows.
          set({ models: null, modelsInstalled: false });
          return false;
        }
      },

      downloadModels: () => {
        if (get().download) return;
        set({
          download: { progress: 0, downloadedBytes: 0, totalBytes: 0, bytesPerSec: 0, etaSecs: null },
          downloadError: null,
        });
        // Fire and forget: progress arrives as events, the end updates the store.
        (async () => {
          let tracker: Parameters<typeof nextDownloadState>[0] = undefined;
          let unlisten: (() => void) | null = null;
          try {
            unlisten = await listen<SpeakerModelDownloadProgressEvent>(
              SPEAKER_MODEL_DOWNLOAD_PROGRESS_EVENT,
              (event) => {
                const next = nextDownloadState(tracker, event.payload.downloaded, event.payload.total, Date.now());
                tracker = next.tracker;
                if (next.state && get().download) set({ download: next.state });
              },
            );
            await tauriApi.downloadSpeakerModels();
          } catch (err) {
            const text = message(err);
            if (!/cancelled/i.test(text)) set({ downloadError: text });
          } finally {
            unlisten?.();
            set({ download: null });
            await get().refreshModels();
          }
        })().catch(() => {
          // Everything above is caught; this keeps a rejection from ever
          // surfacing as unhandled.
        });
      },

      cancelDownload: () => {
        tauriApi.cancelSpeakerModelsDownload().catch(() => {
          // Already finished: nothing to cancel.
        });
      },

      deleteModels: async () => {
        await tauriApi.deleteSpeakerModels();
        await get().refreshModels();
      },

      refreshProfiles: async () => {
        try {
          const list = await tauriApi.voiceProfilesList();
          set({ profiles: list.profiles, quarantined: list.quarantined, profilesLoaded: true });
        } catch {
          set({ profiles: [], quarantined: 0, profilesLoaded: true });
        }
      },

      deleteAllProfiles: async () => {
        const removed = await tauriApi.voiceProfilesDeleteAll();
        // Held analysis results carry voiceprints and voice-match suggestions
        // made from the voices that were just deleted.
        clearAllPreparedAnalyses();
        set({ profiles: [], quarantined: 0, prepared: {} });
        return removed;
      },

      setJob: (bundleDir, job) =>
        set({ jobs: job ? { ...get().jobs, [bundleDir]: job } : without(get().jobs, bundleDir) }),
      setJobError: (bundleDir, error) =>
        set({
          jobErrors: error ? { ...get().jobErrors, [bundleDir]: error } : without(get().jobErrors, bundleDir),
        }),
      setPrepared: (bundleDir, summary) => {
        if (!summary) clearPreparedAnalysis(bundleDir);
        set({ prepared: summary ? { ...get().prepared, [bundleDir]: summary } : without(get().prepared, bundleDir) });
      },
      setFocusSettingsSection: (on) => set({ focusSettingsSection: on }),
    }),
    {
      name: 'notesage-speakers',
      version: 1,
      onRehydrateStorage: () => (_state, error) => handleRehydrateResult('notesage-speakers', error),
      // The three settings, and only them. Nothing about a voice is saved here.
      partialize: (state) => ({
        rememberVoices: state.rememberVoices,
        learnFromTeams: state.learnFromTeams,
        autoIdentify: state.autoIdentify,
      }),
      merge: (persisted, current) => {
        const stored =
          persisted && typeof persisted === 'object' ? (persisted as Partial<Record<string, unknown>>) : {};
        const rememberVoices = stored.rememberVoices === true;
        return {
          ...current,
          rememberVoices,
          // Anything but an explicit `true` is "off": consent is never assumed.
          learnFromTeams: rememberVoices && stored.learnFromTeams === true,
          autoIdentify: stored.autoIdentify === true,
        };
      },
    },
  ),
);

/** The ids of the settings page and of its Speakers section. */
export const SPEAKERS_SETTINGS_SECTION_ID = 'settings-speakers';

/** Open Settings → Transcription, scrolled to the Speakers section. */
export function openSpeakerSettings(): void {
  useSpeakersStore.getState().setFocusSettingsSection(true);
  window.dispatchEvent(new CustomEvent('notesage:open-settings', { detail: { tab: 'voice' } }));
}
