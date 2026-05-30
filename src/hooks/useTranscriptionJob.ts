import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';
import { useActivityStore } from '@/stores/activity-store';
import { useRecordingStore } from '@/stores/recording-store';
import { renderTranscript } from '@/lib/transcription/render-transcript';
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
  // audioPath = .../Meeting 2026-05-30 14-02/audio.wav → "Meeting 2026-05-30 14-02"
  const parts = audioPath.replace(/\/+$/, '').split('/');
  const folder = parts.length >= 2 ? parts[parts.length - 2] : '';
  return folder || 'Meeting recording';
}

/**
 * Lifecycle hook that runs the capture → transcribe → render → file pipeline as
 * a background job. MUST be mounted in `App.tsx` (a hook defined but never
 * mounted never runs — see the auto-memory "Startup Hooks in App.tsx" rule).
 *
 * On a `notesage:start-transcription` event it:
 *   1. mints a job id, reads the configured model + language from recording-store,
 *   2. adds a `transcription` activity item,
 *   3. streams `transcription-progress` (filtered by job id) into the store,
 *   4. runs the whole-file transcription command,
 *   5. on success: renders the note → writes it into the bundle → marks done,
 *   6. on error: marks the job errored + toasts (failed jobs are re-runnable).
 */
export function useTranscriptionJob(): void {
  useEffect(() => {
    const activeUnlisteners = new Set<UnlistenFn>();
    let disposed = false;

    async function runJob(detail: StartTranscriptionDetail): Promise<void> {
      const { audioPath, documentId } = detail;
      if (!audioPath) return;

      const jobId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `transcription-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const { defaultModel, speechLanguage } = useRecordingStore.getState();
      const label = deriveLabel(audioPath);

      const activity = useActivityStore.getState();
      activity.addTranscriptionJob({ id: jobId, label, audioPath, documentId });

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
        const result = await tauriApi.transcribeFile(
          jobId,
          audioPath,
          defaultModel,
          speechLanguage || undefined,
        );

        const markdown = renderTranscript(result.segments, {
          title: label,
          durationSecs: result.duration_secs,
          language: result.language,
        });
        const transcriptPath = await writeTranscriptToBundle(audioPath, markdown);

        useActivityStore.getState().setTranscriptionDone(jobId, transcriptPath);
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
