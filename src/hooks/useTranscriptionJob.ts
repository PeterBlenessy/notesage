import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';
import { useActivityStore } from '@/stores/activity-store';
import { useRecordingStore } from '@/stores/recording-store';
import { isFlagEnabled } from '@/stores/flag-store';
import { trackLabsFeatureUsed } from '@/lib/telemetry';
import { renderTranscript } from '@/lib/transcription/render-transcript';
import { emitWorkflowEvent } from '@/lib/automations/event-bus';
import { writeTranscriptToBundle } from '@/lib/transcription/bundle';

/**
 * Event name and detail shape for the decoupled transcription trigger.
 *
 * Anywhere in the app can kick off a background transcription job by firing:
 *
 *   window.dispatchEvent(
 *     new CustomEvent(START_TRANSCRIPTION_EVENT, {
 *       detail: { audioPath, documentId } satisfies StartTranscriptionDetail,
 *     }),
 *   );
 *
 * This mirrors the `notesage:*` CustomEvent bus used across the app
 * (see `src/App.tsx`, `src/components/cmd/FloatingCommandBar.tsx`).
 */
export const START_TRANSCRIPTION_EVENT = 'notesage:start-transcription';

export interface StartTranscriptionDetail {
  /** Finalized WAV path inside the recording bundle. */
  audioPath: string;
  /** Optional originating document id (carried onto the activity item). */
  documentId?: string;
  /** ms-epoch the recording started (for the start–stop · length info row). */
  recordingStartedAt?: number;
  /** ms-epoch the recording stopped. */
  recordingStoppedAt?: number;
  /** Recorded length in seconds (pause-aware, from the backend). */
  recordingDurationSecs?: number;
  /**
   * Explicit per-recording language choice — a forward-compatible seam for
   * #698 (the per-recording language picker, not yet built). When present it
   * always wins over the `transcription-autodetect-language` Labs flag and
   * the Settings-configured default: a deliberate per-recording choice must
   * never be silently overridden by the flag.
   */
  languageOverride?: string;
}

/** Convenience dispatcher so callers don't hand-build the CustomEvent. */
export function startTranscription(detail: StartTranscriptionDetail): void {
  window.dispatchEvent(
    new CustomEvent<StartTranscriptionDetail>(START_TRANSCRIPTION_EVENT, { detail }),
  );
}

interface TranscriptionProgressPayload {
  jobId: string;
  percent: number;
  segment?: string;
}

/** Derive a human-readable job label from the audio path's bundle folder. */
function deriveLabel(audioPath: string): string {
  // audioPath = .../Recording 2026-05-30 14-02/audio.wav → "Recording 2026-05-30 14-02"
  const parts = audioPath.replace(/\/+$/, '').split('/');
  const folder = parts.length >= 2 ? parts[parts.length - 2] : '';
  return folder || 'Recording';
}

/**
 * Lifecycle hook that runs the capture → transcribe → render → file pipeline as
 * a background job. MUST be mounted in `App.tsx` (a hook defined but never
 * mounted never runs — see the auto-memory "Startup Hooks in App.tsx" rule).
 *
 * On a `notesage:start-transcription` event it:
 *   1. mints a job id, resolves the language to transcribe with (explicit
 *      per-recording override > the `transcription-autodetect-language` Labs
 *      flag > the Settings-configured default) and the configured model,
 *   2. adds a `transcription` activity item,
 *   3. streams `transcription-progress` (filtered by job id) into the store,
 *   4. runs the whole-file transcription command,
 *   5. on success: renders the note → writes it into the bundle → marks done
 *      (recording the language Whisper actually used),
 *   6. on error: marks the job errored + toasts (failed jobs are re-runnable).
 */
export function useTranscriptionJob(): void {
  useEffect(() => {
    const activeUnlisteners = new Set<UnlistenFn>();
    let disposed = false;

    async function runJob(detail: StartTranscriptionDetail): Promise<void> {
      const {
        audioPath,
        documentId,
        recordingStartedAt,
        recordingStoppedAt,
        recordingDurationSecs,
        languageOverride,
      } = detail;
      if (!audioPath) return;

      const jobId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `transcription-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const { defaultModel, speechLanguage } = useRecordingStore.getState();
      const label = deriveLabel(audioPath);

      // Precedence: an explicit per-recording choice always wins (a
      // deliberate choice must never be silently overridden); otherwise the
      // Labs flag overrides the Settings default with auto-detect
      // (`language: undefined`, which the backend treats as "auto").
      const autoDetect = !languageOverride && isFlagEnabled('transcription-autodetect-language');
      const language = languageOverride ?? (autoDetect ? undefined : speechLanguage || undefined);
      if (autoDetect) {
        trackLabsFeatureUsed('transcription-autodetect-language');
      }

      const activity = useActivityStore.getState();
      activity.addTranscriptionJob({
        id: jobId,
        label,
        audioPath,
        documentId,
        recordingStartedAt,
        recordingStoppedAt,
        recordingDurationSecs,
      });

      // Stream progress events scoped to this job id.
      let unlistenProgress: UnlistenFn | null = null;
      try {
        unlistenProgress = await listen<TranscriptionProgressPayload>(
          'transcription-progress',
          (event) => {
            if (event.payload.jobId !== jobId) return;
            useActivityStore.getState().setTranscriptionProgress(jobId, event.payload.percent);
          },
        );
        if (disposed) {
          // Hook unmounted while we were registering — clean up immediately.
          unlistenProgress();
          return;
        }
        activeUnlisteners.add(unlistenProgress);
      } catch {
        // Progress is best-effort; transcription can still proceed without it.
        unlistenProgress = null;
      }

      try {
        const result = await tauriApi.transcribeFile(jobId, audioPath, defaultModel, language);

        const markdown = renderTranscript(result.segments, {
          title: label,
          durationSecs: result.duration_secs,
          language: result.language,
        });
        const transcriptPath = await writeTranscriptToBundle(audioPath, markdown);

        useActivityStore.getState().setTranscriptionDone(jobId, transcriptPath, result.language);
        // Phase 3: surface a transcription-done workflow event for automations.
        emitWorkflowEvent({ event: 'transcription-done', transcriptPath });
      } catch (err) {
        useActivityStore.getState().setTranscriptionError(jobId);
        toast.error(`Transcription failed: ${err}`);
      } finally {
        if (unlistenProgress) {
          unlistenProgress();
          activeUnlisteners.delete(unlistenProgress);
        }
      }
    }

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<StartTranscriptionDetail>).detail;
      if (!detail) return;
      void runJob(detail);
    };

    window.addEventListener(START_TRANSCRIPTION_EVENT, handler);

    return () => {
      disposed = true;
      window.removeEventListener(START_TRANSCRIPTION_EVENT, handler);
      // Tear down any in-flight progress listeners.
      for (const unlisten of activeUnlisteners) {
        unlisten();
      }
      activeUnlisteners.clear();
    };
  }, []);
}
