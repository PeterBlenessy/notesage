import { t } from '@/lib/i18n';
import type { AgentTask } from '@/stores/activity-store';
import { coarseDuration, estimateRemainingMs, formatElapsed } from '@/lib/transcription/progress';

/**
 * The words for a transcription job that is queued or running, shared by the
 * card in the orb and the row in the Recordings view so both say the same
 * thing about the same job.
 */

/**
 * Is this job waiting behind another? The backend runs one transcription at a
 * time; a job it has not reported a stage for, while an earlier one is still
 * running, is in the queue.
 */
export function isQueuedJob(task: AgentTask, tasks: readonly AgentTask[]): boolean {
  if (task.status !== 'running' || task.transcriptionStage || (task.progress ?? 0) > 0) return false;
  const mine = task.runStartedAt ?? task.startedAt;
  return tasks.some(
    (other) =>
      other.id !== task.id &&
      other.kind === 'transcription' &&
      other.status === 'running' &&
      (other.runStartedAt ?? other.startedAt) < mine,
  );
}

export interface JobStatusInput {
  queued: boolean;
  stage?: AgentTask['transcriptionStage'];
  progress?: number;
}

/** "Queued", "Loading the model…", "Transcribing 42%", … */
export function jobStatusText({ queued, stage, progress }: JobStatusInput): string {
  if (queued) return t('transcription.statusQueued');
  const percent = Math.round(progress ?? 0);
  // A long file is read and transcribed part by part, so the backend's stage
  // goes back to "decoding" between parts. Once there is progress the honest
  // summary is the percent; flickering between two sentences every ten
  // minutes of audio says less.
  if (percent > 0 && (stage === 'loading' || stage === 'decoding')) {
    return t('transcription.statusTranscribingPercent', { percent });
  }
  switch (stage) {
    case 'loading':
      return t('transcription.stageLoading');
    case 'decoding':
      return t('transcription.stageDecoding');
    case 'finishing':
      return t('transcription.stageFinishing');
    case 'transcribing':
      return t('transcription.statusTranscribingPercent', { percent });
    default:
      // No stage yet: either nothing has been reported, or the backend is an
      // older one that only sends a percent.
      return percent > 0 ? t('transcription.statusTranscribingPercent', { percent }) : t('activity.starting');
  }
}

export interface JobTimingInput {
  runStartedAt?: number;
  progress?: number;
  progressAnchorAt?: number;
  progressAnchorPercent?: number;
  now: number;
}

/**
 * "2:14 elapsed · about 6 min left". The remaining part is left out until
 * there is enough progress to estimate from; the whole line is `null` before
 * the job has a start time.
 */
export function jobTimingText(input: JobTimingInput): string | null {
  if (input.runStartedAt === undefined) return null;
  const elapsed = t('transcription.elapsed', { time: formatElapsed(input.now - input.runStartedAt) });
  const remaining = estimateRemainingMs({
    percent: input.progress ?? 0,
    anchorAt: input.progressAnchorAt,
    anchorPercent: input.progressAnchorPercent,
    now: input.now,
  });
  if (remaining === null) return elapsed;
  const { unit, value } = coarseDuration(remaining);
  const left =
    unit === 'minutes'
      ? t('transcription.remainingMinutes', { count: value })
      : t('transcription.remainingSeconds', { count: value });
  return `${elapsed} · ${left}`;
}
