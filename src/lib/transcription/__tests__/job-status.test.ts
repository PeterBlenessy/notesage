import { describe, it, expect, afterEach } from 'vitest';
import { setLocale } from '@/lib/i18n';
import type { AgentTask } from '@/stores/activity-store';
import { coarseDuration, estimateRemainingMs, formatElapsed } from '@/lib/transcription/progress';
import { isQueuedJob, jobStatusText, jobTimingText } from '@/lib/transcription/job-status';
import {
  describeTranscriptionError,
  isCancellation,
  isModelMissingError,
  modelNameFromError,
} from '@/lib/transcription/errors';
import { formatBytes } from '@/lib/transcription/format';

afterEach(() => setLocale(null));

function task(over: Partial<AgentTask>): AgentTask {
  return {
    id: 'a',
    kind: 'transcription',
    type: 'workflow',
    label: 'Recording',
    status: 'running',
    startedAt: 1000,
    activities: [],
    ...over,
  };
}

describe('estimateRemainingMs (U16)', () => {
  const base = { anchorAt: 0, anchorPercent: 10 };
  it('extrapolates from the first real progress, not from when the job was queued', () => {
    // 40 points in 4 minutes; 50 points left → 5 minutes.
    expect(estimateRemainingMs({ ...base, percent: 50, now: 240_000 })).toBe(300_000);
  });
  it('says nothing until there is enough progress and enough time to measure a rate', () => {
    expect(estimateRemainingMs({ percent: 50, now: 240_000 })).toBeNull();
    expect(estimateRemainingMs({ ...base, percent: 11, now: 240_000 })).toBeNull();
    expect(estimateRemainingMs({ ...base, percent: 50, now: 5_000 })).toBeNull();
    expect(estimateRemainingMs({ ...base, percent: 100, now: 240_000 })).toBeNull();
    expect(estimateRemainingMs({ ...base, percent: Number.NaN, now: 240_000 })).toBeNull();
  });
  it('never goes negative', () => {
    expect(estimateRemainingMs({ ...base, percent: 99, now: 600_000 })).toBeGreaterThanOrEqual(0);
  });
});

describe('coarseDuration / formatElapsed', () => {
  it('reads as minutes from a minute up, seconds in fives below', () => {
    expect(coarseDuration(300_000)).toEqual({ unit: 'minutes', value: 5 });
    expect(coarseDuration(61_000)).toEqual({ unit: 'minutes', value: 1 });
    expect(coarseDuration(42_000)).toEqual({ unit: 'seconds', value: 40 });
    expect(coarseDuration(1_000)).toEqual({ unit: 'seconds', value: 5 });
    expect(coarseDuration(-5)).toEqual({ unit: 'seconds', value: 5 });
  });
  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(134_000)).toBe('2:14');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });
});

describe('job status words', () => {
  it('a job with nothing reported while an earlier one runs is queued', () => {
    const first = task({ id: 'first', runStartedAt: 1000 });
    const second = task({ id: 'second', runStartedAt: 2000 });
    expect(isQueuedJob(second, [first, second])).toBe(true);
    expect(isQueuedJob(first, [first, second])).toBe(false);
    // Once the backend reports on it, it is not waiting any more.
    expect(isQueuedJob({ ...second, transcriptionStage: 'loading' }, [first, second])).toBe(false);
    expect(isQueuedJob({ ...second, progress: 3 }, [first, second])).toBe(false);
    // A finished earlier job, or an agent task, holds nobody up.
    expect(isQueuedJob(second, [{ ...first, status: 'done' }, second])).toBe(false);
    expect(isQueuedJob(second, [{ ...first, kind: 'agent' }, second])).toBe(false);
  });

  it('names each stage, in English and in Swedish', () => {
    expect(jobStatusText({ queued: true })).toBe('Queued');
    expect(jobStatusText({ queued: false, stage: 'loading' })).toBe('Loading the model…');
    expect(jobStatusText({ queued: false, stage: 'decoding' })).toBe('Reading the audio…');
    expect(jobStatusText({ queued: false, stage: 'transcribing', progress: 42 })).toBe('Transcribing 42%');
    expect(jobStatusText({ queued: false, stage: 'finishing', progress: 100 })).toBe('Finishing…');
    expect(jobStatusText({ queued: false, progress: 7 })).toBe('Transcribing 7%');
    expect(jobStatusText({ queued: false })).toBe('Starting…');
    setLocale('sv');
    expect(jobStatusText({ queued: true })).toBe('I kö');
    expect(jobStatusText({ queued: false, stage: 'transcribing', progress: 42 })).toBe('Transkriberar 42 %');
  });

  it('elapsed, then elapsed and remaining once it can be estimated', () => {
    expect(jobTimingText({ now: 5000 })).toBeNull();
    expect(jobTimingText({ runStartedAt: 0, now: 20_000, progress: 0 })).toBe('0:20 elapsed');
    expect(
      jobTimingText({ runStartedAt: 0, now: 300_000, progress: 50, progressAnchorAt: 60_000, progressAnchorPercent: 10 }),
    ).toBe('5:00 elapsed · about 5 min left');
    expect(
      jobTimingText({ runStartedAt: 0, now: 100_000, progress: 90, progressAnchorAt: 10_000, progressAnchorPercent: 0 }),
    ).toBe('1:40 elapsed · about 10 s left');
  });
});

describe('transcription errors (U19, U33)', () => {
  it('recognises a cancel by the exact text the backend rejects with', () => {
    expect(isCancellation('Transcription cancelled')).toBe(true);
    expect(isCancellation(new Error('Transcription cancelled'))).toBe(true);
    expect(isCancellation('Transcription failed: cancelled by signal')).toBe(false);
  });

  it('recognises a missing model however the backend words it', () => {
    const today = "Model 'large-v3-turbo-q5_0' not downloaded. Download it from Settings > Transcription.";
    expect(isModelMissingError(today)).toBe(true);
    expect(modelNameFromError(today)).toBe('large-v3-turbo-q5_0');
    expect(isModelMissingError('Failed to load Whisper model: file is truncated')).toBe(true);
    expect(isModelMissingError('Audio file not found: /x/audio.wav')).toBe(false);
    expect(isModelMissingError(undefined)).toBe(false);
  });

  it('puts the errors a person can act on in the app language and passes the rest through', () => {
    expect(describeTranscriptionError("Model 'small' not downloaded. Download it from Settings > Transcription.")).toBe(
      'The model “small” is not downloaded.',
    );
    expect(describeTranscriptionError('interrupted')).toBe('Interrupted when Notesage quit');
    expect(describeTranscriptionError('Audio file not found: /x/audio.wav')).toBe('The audio file is missing.');
    expect(describeTranscriptionError('Audio file contains no samples')).toBe('The file has no audio to transcribe.');
    expect(describeTranscriptionError('Error: Whisper state exploded')).toBe('Whisper state exploded');
    expect(describeTranscriptionError('')).toBe('Something went wrong.');
    setLocale('sv');
    expect(describeTranscriptionError('interrupted')).toBe('Avbröts när Notesage avslutades');
    expect(describeTranscriptionError('Audio file contains no samples')).toBe('Filen innehåller inget ljud att transkribera.');
  });
});

describe('formatBytes (U27)', () => {
  it('writes sizes the way Finder does', () => {
    expect(formatBytes(34_000_000, 'en')).toBe('34 MB');
    expect(formatBytes(3_400_000, 'en')).toBe('3.4 MB');
    expect(formatBytes(1_200_000_000, 'en')).toBe('1.2 GB');
    expect(formatBytes(512, 'en')).toBe('512 B');
    expect(formatBytes(3_400_000, 'sv')).toBe('3,4 MB');
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(-1)).toBeNull();
  });
});
