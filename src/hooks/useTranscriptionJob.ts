import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { tauriApi, type TranscriptionProgressEvent, type TranscriptionTrack } from '@/lib/tauri';
import { t } from '@/lib/i18n';
import { log } from '@/lib/logger';
import { notify } from '@/lib/notifications';
import { useActivityStore, type AgentTask } from '@/stores/activity-store';
import { useRecordingStore } from '@/stores/recording-store';
import { emitWorkflowEvent } from '@/lib/automations/event-bus';
import { basename, dirname, joinPath, readRecordingManifest, recordingTitle } from '@/lib/transcription/bundle';
import { describeTranscriptionError, isCancellation } from '@/lib/transcription/errors';
import { pickModelForLanguage } from '@/lib/transcription/languages';
import { segmentsFromBackend } from '@/lib/transcription/segments';
import { writeTranscript, type TranscriptWriteMode } from '@/lib/transcription/transcript-files';

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

/**
 * Fired when a job is asked for an audio file that already has one queued or
 * running. `detail.taskId` is the existing job, for a surface that wants to
 * bring it into view.
 */
export const FOCUS_TRANSCRIPTION_EVENT = 'notesage:focus-transcription';

/** A finished job longer than this earns a notification when the window is not focused. */
export const LONG_JOB_NOTIFY_MS = 60_000;

export interface StartTranscriptionDetail {
  /** Finalized audio path inside the recording bundle (`audio.wav` here, `audio.m4a` from the phone). */
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
  /**
   * Device label of the recorder when the bundle came from another device
   * (the phone's `createdBy.device` in `recording.json`). Shown on the card
   * as *from Peter's iPhone*. Omitted for the Mac's own recordings.
   */
  sourceDevice?: string;
  /**
   * The separately recorded microphone and system-audio files of a two-track
   * recording (absolute paths). With them the backend transcribes each track
   * and labels the segments `me` / `others`. When omitted, the bundle's
   * manifest is consulted, so a re-run or the scanner need not know.
   */
  tracks?: TranscriptionTrack[];
  /** The recording's name, for the card. Defaults to the manifest's title, then the folder name. */
  title?: string;
  /**
   * What to do if the bundle already has a transcript: the answer the user
   * gave to "Replace / Keep both". Omitted means nobody was asked, and then
   * nothing is overwritten (a second file is written beside the first).
   */
  transcriptMode?: TranscriptWriteMode;
}

/** Convenience dispatcher so callers don't hand-build the CustomEvent. */
export function startTranscription(detail: StartTranscriptionDetail): void {
  window.dispatchEvent(
    new CustomEvent<StartTranscriptionDetail>(START_TRANSCRIPTION_EVENT, { detail }),
  );
}

/** Derive a human-readable job label from the audio path's bundle folder. */
function deriveLabel(audioPath: string): string {
  // audioPath = .../Recording 2026-05-30 14-02/audio.wav → "Recording 2026-05-30 14-02"
  return basename(dirname(audioPath)) || t('transcription.untitled');
}

function transcriptionTasks(): AgentTask[] {
  return useActivityStore.getState().tasks.filter((task) => task.kind === 'transcription');
}

/** The job (in any state) for an audio file, if the activity list has one. */
export function findTranscriptionTask(audioPath: string): AgentTask | undefined {
  return transcriptionTasks().find((task) => task.audioPath === audioPath);
}

/** Jobs cancelled to make way for another device, which must not clear that device's claim. */
const yielded = new Set<string>();

/** Did this job stop because another device holds the recording? Read once by the scanner. */
export function takeYielded(taskId: string): boolean {
  return yielded.delete(taskId);
}

/**
 * Ask the backend to stop a queued or running job. The job's own promise then
 * rejects with `Transcription cancelled`, and that is where the card changes:
 * a cancel the backend never honoured must not show as cancelled.
 *
 * `yieldToOtherDevice` marks a cancel the scanner made because another Mac
 * claimed the recording.
 */
export async function cancelTranscriptionJob(
  taskId: string,
  options: { yieldToOtherDevice?: boolean } = {},
): Promise<void> {
  const task = transcriptionTasks().find((candidate) => candidate.id === taskId);
  if (!task || task.status !== 'running') return;
  if (options.yieldToOtherDevice) yielded.add(taskId);
  try {
    const found = await tauriApi.cancelTranscription(taskId, task.audioPath ?? null);
    // Nothing was running under that id: the promise that would have flipped
    // the card is not coming, so flip it here.
    if (!found) useActivityStore.getState().setTranscriptionCancelled(taskId);
  } catch (err) {
    yielded.delete(taskId);
    log.warn('transcription', 'Could not cancel the transcription', err);
    toast.error(t('transcription.cancelFailed', { error: String(err) }));
  }
}

function openTranscript(path: string): void {
  // The app root routes this to `useFileOperations.openFile`.
  window.dispatchEvent(
    new CustomEvent('notesage:open-file', { detail: { filePath: path, fileName: basename(path) } }),
  );
}

/** `manifest.tracks` (basenames) as the absolute paths `transcribe_file` wants; only mic + system count. */
function tracksFromManifest(
  bundleDir: string,
  tracks: ReadonlyArray<{ role: string; file: string }> | undefined,
): TranscriptionTrack[] | undefined {
  if (!tracks) return undefined;
  const out: TranscriptionTrack[] = [];
  for (const track of tracks) {
    if (track.role === 'mic' || track.role === 'system') {
      out.push({ role: track.role, path: joinPath(bundleDir, track.file) });
    }
  }
  // One track alone tells nobody apart; that is an ordinary job.
  return out.some((x) => x.role === 'mic') && out.some((x) => x.role === 'system') ? out : undefined;
}

/**
 * Lifecycle hook that runs the capture → transcribe → render → file pipeline as
 * a background job. MUST be mounted in `App.tsx` (a hook defined but never
 * mounted never runs — see the auto-memory "Startup Hooks in App.tsx" rule).
 *
 * On a `notesage:start-transcription` event it:
 *   1. refuses a second job for an audio file that already has one running,
 *   2. reuses that file's finished card if there is one, else adds a new one,
 *   3. runs the whole-file transcription command (with the two tracks of a
 *      microphone + system-audio recording when the bundle has them),
 *   4. on success: writes `segments.json` and the transcript note → marks done,
 *   5. on cancel: marks the job cancelled (the recording is "Not transcribed"),
 *   6. on error: marks the job errored + toasts why.
 *
 * Progress comes from ONE `transcription-progress` listener for the hook's
 * lifetime, matched to jobs by `job_id`.
 */
export function useTranscriptionJob(): void {
  useEffect(() => {
    let disposed = false;
    let unlistenProgress: UnlistenFn | null = null;

    void listen<TranscriptionProgressEvent>('transcription-progress', (event) => {
      const payload = event.payload;
      if (!payload || typeof payload.percent !== 'number') return;
      const id =
        payload.job_id ??
        // A backend that does not echo the id still names the file.
        transcriptionTasks().find((task) => task.status === 'running' && task.audioPath === payload.audio_path)?.id;
      if (!id) return;
      useActivityStore.getState().setTranscriptionProgress(id, payload.percent, payload.stage);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlistenProgress = fn;
      })
      .catch(() => {
        // Progress is best-effort; transcription can still proceed without it.
      });

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
        sourceDevice,
      } = detail;
      if (!audioPath) return;

      const activity = useActivityStore.getState();
      const existing =
        (reuseJobId ? transcriptionTasks().find((task) => task.id === reuseJobId) : undefined) ??
        findTranscriptionTask(audioPath);

      // One job per audio file. A double click, the scanner and a row button
      // racing, a re-run on a card that is already running: all of them land
      // here, and none may start a second pass over the same file.
      if (existing?.status === 'running') {
        window.dispatchEvent(new CustomEvent(FOCUS_TRANSCRIPTION_EVENT, { detail: { taskId: existing.id } }));
        toast.info(t('transcription.alreadyRunning'));
        return;
      }

      const jobId =
        existing?.id ??
        reuseJobId ??
        (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `transcription-${Date.now()}-${Math.random().toString(36).slice(2)}`);

      const { defaultModel, speechLanguage, availableModels } = useRecordingStore.getState();
      const effectiveLanguage = language ?? existing?.language ?? speechLanguage;
      // The default model is only a preference. When it is not downloaded and
      // another one is, use that one rather than fail on a model the user
      // never had (the shipped default is not downloaded on a fresh install).
      const downloaded = availableModels.filter((m) => m.downloaded).map((m) => m.name);
      const effectiveModel =
        model ??
        (downloaded.length > 0 && !downloaded.includes(defaultModel)
          ? pickModelForLanguage(downloaded[0], effectiveLanguage, downloaded)
          : defaultModel);
      const bundleDir = dirname(audioPath);

      if (existing) {
        // Re-run: update the existing card in place instead of prepending a
        // duplicate list entry.
        activity.resetTranscriptionForRerun(jobId);
      } else {
        activity.addTranscriptionJob({
          id: jobId,
          label: detail.title ?? deriveLabel(audioPath),
          audioPath,
          documentId,
          recordingStartedAt,
          recordingStoppedAt,
          recordingDurationSecs,
          language: effectiveLanguage,
          sourceDevice,
          tracks: detail.tracks,
        });
      }
      const startedAt = Date.now();

      try {
        // After the card exists (callers rely on it appearing synchronously):
        // the manifest knows the recording's name and its tracks.
        const manifest = await readRecordingManifest(bundleDir);
        const title = detail.title ?? recordingTitle(bundleDir, manifest);
        useActivityStore.getState().setTranscriptionLabel(jobId, title);
        const tracks = detail.tracks ?? existing?.tracks ?? tracksFromManifest(bundleDir, manifest?.tracks);

        const result = await tauriApi.transcribeFile(
          jobId,
          audioPath,
          effectiveModel,
          effectiveLanguage || undefined,
          tracks,
        );

        const written = await writeTranscript({
          bundleDir,
          segments: segmentsFromBackend(result.segments),
          language: result.language,
          model: effectiveModel,
          durationSecs: result.duration_secs,
          mode: detail.transcriptMode,
        });

        useActivityStore.getState().setTranscriptionDone(jobId, written.path, result.language);
        // Phase 3: surface a transcription-done workflow event for automations.
        emitWorkflowEvent({ event: 'transcription-done', transcriptPath: written.path });

        // A long job finishes while the user is elsewhere: say so, once, and
        // make the transcript one click away when they come back.
        const unfocused = typeof document !== 'undefined' && !document.hasFocus();
        if (Date.now() - startedAt >= LONG_JOB_NOTIFY_MS && unfocused) {
          void notify('agent_completion', t('transcription.doneNotifyTitle'), title).catch(() => {});
          toast.success(t('transcription.doneToast', { title }), {
            duration: Number.POSITIVE_INFINITY,
            action: { label: t('recordings.openTranscript'), onClick: () => openTranscript(written.path) },
          });
        }
      } catch (err) {
        if (isCancellation(err)) {
          useActivityStore.getState().setTranscriptionCancelled(jobId);
          return;
        }
        const message = String(err).replace(/^Error:\s*/, '');
        useActivityStore.getState().setTranscriptionError(jobId, message);
        toast.error(t('transcription.failedToast', { error: describeTranscriptionError(message) }));
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
      unlistenProgress?.();
      unlistenProgress = null;
    };
  }, []);
}
