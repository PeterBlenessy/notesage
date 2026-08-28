import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';
import { useActivityStore } from '@/stores/activity-store';
import { useRecordingStore } from '@/stores/recording-store';
import { renderTranscript } from '@/lib/transcription/render-transcript';
import { emitWorkflowEvent } from '@/lib/automations/event-bus';
import { writeTranscriptToBundle } from '@/lib/transcription/bundle';
import { track, type AudioContainer } from '@/lib/telemetry';

/**
 * Bucket a path's extension into the low-cardinality set the telemetry event
 * accepts. Never the filename — the container is the whole signal, and a
 * recording's name is the user's business.
 */
export function audioContainerOf(path: string): AudioContainer {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "wav":
    case "mp3":
    case "m4a":
    case "flac":
    case "ogg":
    case "caf":
      return ext;
    case "aif":
    case "aiff":
      return "aiff";
    default:
      return "other";
  }
}

/**
 * Did this fail at the DECODE step, as opposed to anywhere else in the job?
 *
 * Matched against the messages `decode_audio_f32` produces. A missing Whisper
 * model or a transcription error also lands in the same catch, and reporting
 * those as `decoder: "failed"` would poison exactly the number this event
 * exists to measure — the rate at which a container defeats both decoders.
 */
export function isDecodeFailure(err: unknown): boolean {
  const message = String(err);
  return (
    message.includes("Unrecognised audio format") ||
    message.includes("Unsupported audio codec") ||
    message.includes("no audio track") ||
    message.includes("decoded to no samples") ||
    message.includes("CoreAudio")
  );
}

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
   * Per-recording language override (picked on the live `RecordingCard`).
   * Falls back to `recording-store.speechLanguage` when omitted.
   */
  language?: string;
  /**
   * Reuse an existing (finished) transcription job's id instead of creating a
   * new one — the "re-run transcription with a different model" action.
   * When set, the existing card flips back to `running` in place rather than
   * a new list entry being added.
   */
  jobId?: string;
  /**
   * Model override for this run. Falls back to `recording-store.defaultModel`
   * when omitted.
   */
  model?: string;
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
      const {
        audioPath,
        documentId,
        recordingStartedAt,
        recordingStoppedAt,
        recordingDurationSecs,
        language,
        jobId: reuseJobId,
        model,
      } = detail;
      if (!audioPath) return;

      const jobId =
        reuseJobId ??
        (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `transcription-${Date.now()}-${Math.random().toString(36).slice(2)}`);

      const { defaultModel, speechLanguage } = useRecordingStore.getState();
      const effectiveModel = model ?? defaultModel;
      const effectiveLanguage = language ?? speechLanguage;
      const label = deriveLabel(audioPath);

      const activity = useActivityStore.getState();
      if (reuseJobId) {
        // Re-run: update the existing card in place instead of prepending a
        // duplicate list entry.
        activity.resetTranscriptionForRerun(jobId);
      } else {
        activity.addTranscriptionJob({
          id: jobId,
          label,
          audioPath,
          documentId,
          recordingStartedAt,
          recordingStoppedAt,
          recordingDurationSecs,
          language: effectiveLanguage,
        });
      }

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
          effectiveModel,
          effectiveLanguage || undefined,
        );

        // Which decoder read it (#803). The CoreAudio fallback covers two
        // known symphonia gaps (Opus, and AAC it rejects); this is how we find
        // out whether either actually bites, rather than assuming. No-ops
        // entirely when usage telemetry is off.
        track("audio_decoded", {
          container: audioContainerOf(audioPath),
          decoder: result.decoder === "coreaudio" ? "coreaudio" : "symphonia",
        });

        const markdown = renderTranscript(result.segments, {
          title: label,
          durationSecs: result.duration_secs,
          language: result.language,
        });
        const transcriptPath = await writeTranscriptToBundle(audioPath, markdown);

        useActivityStore
          .getState()
          .setTranscriptionDone(jobId, transcriptPath, result.language);
        // Phase 3: surface a transcription-done workflow event for automations.
        emitWorkflowEvent({ event: 'transcription-done', transcriptPath });
      } catch (err) {
        // The most valuable half of this signal: a container NEITHER decoder
        // could read. Only reported when the failure is a decode failure —
        // a missing model or a Whisper error says nothing about the format.
        if (isDecodeFailure(err)) {
          track("audio_decoded", {
            container: audioContainerOf(audioPath),
            decoder: "failed",
          });
        }
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
