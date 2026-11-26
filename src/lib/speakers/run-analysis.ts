import { listen } from '@tauri-apps/api/event';

import {
  SPEAKER_ANALYSIS_CANCELLED,
  SPEAKER_ANALYSIS_PROGRESS_EVENT,
  tauriApi,
  type SpeakerAnalysisProgressEvent,
  type SpeakerAnalysisResult,
  type SpeakerSegment,
  type TranscriptionTrack,
  type VoiceMatch,
} from '@/lib/tauri';
import { log } from '@/lib/logger';
import { t } from '@/lib/i18n';
import { findIntroductions } from '@/lib/speakers/introductions';
import {
  getPreparedAnalysis,
  preparedAnalysisDirs,
  segmentsFingerprint,
  setPreparedAnalysis,
  type PreparedAnalysis,
} from '@/lib/speakers/analysis-cache';
import { useActivityStore } from '@/stores/activity-store';
import { useSpeakersStore } from '@/stores/speakers-store';

/**
 * Running `analyze_speakers` as a job: one per recording, with progress, a
 * cancel, and honest bookkeeping about waiting in line.
 *
 * The backend runs one job at a time and shares that queue with
 * transcription. A queued analysis emits nothing, so "is it waiting?" is
 * worked out here: it is waiting when, at the moment it was started, a
 * transcription or another analysis was already going, and it stays "waiting"
 * until its own first progress event arrives.
 *
 * The result (which carries voiceprints) goes into the in-memory cache and
 * nowhere else. Only a summary reaches the store.
 */

export interface AnalysisRequest {
  bundleDir: string;
  audioPath: string;
  /** The two tracks of a microphone + system-audio recording, else `null`. */
  tracks: TranscriptionTrack[] | null;
  segments: SpeakerSegment[];
  participants: string[];
  expectedSpeakers: number | null;
  sharedMicrophone: boolean;
  /** Started by the "automatically after transcription" setting. */
  automatic?: boolean;
}

export function isAnalysisCancellation(error: unknown): boolean {
  return String(error).includes(SPEAKER_ANALYSIS_CANCELLED);
}

let nextJob = 0;
function newJobId(): string {
  nextJob += 1;
  return `speakers-${Date.now().toString(36)}-${nextJob}`;
}

/** Is the backend's queue busy with something else right now? */
function queueBusy(exceptDir: string): boolean {
  const transcribing = useActivityStore
    .getState()
    .tasks.some((task) => task.kind === 'transcription' && task.status === 'running');
  const analysing = Object.keys(useSpeakersStore.getState().jobs).some((dir) => dir !== exceptDir);
  return transcribing || analysing;
}

/**
 * Ask which remembered voices the found voices might be.
 *
 * Only ever called with the user's opt-in on, and passes that setting as
 * `consent` (never a literal). Resolves `null` when voices are not remembered:
 * the question is not asked at all. A failure is "no suggestions", not an
 * error the user has to deal with.
 */
export async function matchRememberedVoices(
  result: SpeakerAnalysisResult,
  participants: readonly string[],
): Promise<VoiceMatch[] | null> {
  const consent = useSpeakersStore.getState().rememberVoices;
  if (!consent) return null;
  const speakers = result.speakers
    .filter((speaker) => speaker.embedding.length > 0)
    .map((speaker) => ({ label: speaker.label, embedding: speaker.embedding }));
  if (speakers.length === 0) return [];
  try {
    return await tauriApi.voiceProfilesMatch({
      consent,
      speakers,
      participants: [...participants],
      model: result.model,
    });
  } catch (err) {
    log.warn('speakers', 'Could not compare with remembered voices', String(err));
    return [];
  }
}

/** Does this analysis offer a name for any voice (a remembered voice, or an introduction)? */
export function hasNameSuggestions(analysis: PreparedAnalysis): boolean {
  if (analysis.matches?.some((match) => match.candidates.length > 0)) return true;
  if (analysis.participants.length > 0) return true;
  return findIntroductions(analysis.result.segments ?? []).length > 0;
}

/**
 * Analyse one recording. Resolves with the prepared analysis (also cached);
 * rejects with the backend's error, including `Speaker analysis cancelled`.
 * A second call for a recording that is already being analysed is refused.
 */
export async function runSpeakerAnalysis(request: AnalysisRequest): Promise<PreparedAnalysis> {
  const store = useSpeakersStore.getState();
  if (store.jobs[request.bundleDir]) throw new Error(t('speakers.alreadyAnalysing'));

  const jobId = newJobId();
  store.setJobError(request.bundleDir, null);
  store.setJob(request.bundleDir, {
    jobId,
    phase: queueBusy(request.bundleDir) ? 'waiting' : 'starting',
    stage: null,
    percent: 0,
    automatic: request.automatic === true,
  });

  let unlisten: (() => void) | null = null;
  try {
    unlisten = await listen<SpeakerAnalysisProgressEvent>(SPEAKER_ANALYSIS_PROGRESS_EVENT, (event) => {
      const payload = event.payload;
      if (!payload || payload.job_id !== jobId) return;
      const current = useSpeakersStore.getState().jobs[request.bundleDir];
      if (!current || current.jobId !== jobId) return;
      const percent = Math.max(0, Math.min(100, Math.round(payload.percent)));
      if (current.phase === 'running' && current.percent === percent && current.stage === payload.stage) return;
      useSpeakersStore.getState().setJob(request.bundleDir, { ...current, phase: 'running', stage: payload.stage, percent });
    });

    const twoTrack = request.tracks !== null && request.tracks.length === 2;
    const result = await tauriApi.analyzeSpeakers({
      jobId,
      audioPath: request.audioPath,
      tracks: twoTrack ? request.tracks : null,
      expectedSpeakers: request.expectedSpeakers,
      segments: request.segments,
      // Only meaningful (and only sent) for a two-track recording.
      sharedMicrophone: twoTrack ? request.sharedMicrophone : null,
    });
    const matches = await matchRememberedVoices(result, request.participants);
    const analysis: PreparedAnalysis = {
      result,
      source: segmentsFingerprint(request.segments),
      matches,
      participants: [...request.participants],
      expectedSpeakers: request.expectedSpeakers,
      sharedMicrophone: twoTrack && request.sharedMicrophone,
      at: Date.now(),
    };
    setPreparedAnalysis(request.bundleDir, analysis);
    // The cache is bounded: a summary whose result was pushed out must not go
    // on promising suggestions that are no longer there.
    const held = new Set(preparedAnalysisDirs());
    for (const dir of Object.keys(useSpeakersStore.getState().prepared)) {
      if (!held.has(dir)) useSpeakersStore.getState().setPrepared(dir, null);
    }
    useSpeakersStore.getState().setPrepared(request.bundleDir, {
      voices: result.speakers.length,
      hasSuggestions: hasNameSuggestions(analysis),
    });
    return analysis;
  } catch (err) {
    if (!isAnalysisCancellation(err)) {
      useSpeakersStore
        .getState()
        .setJobError(request.bundleDir, String(err instanceof Error ? err.message : err).replace(/^Error:\s*/, ''));
    }
    throw err;
  } finally {
    unlisten?.();
    const current = useSpeakersStore.getState().jobs[request.bundleDir];
    if (current?.jobId === jobId) useSpeakersStore.getState().setJob(request.bundleDir, null);
  }
}

/**
 * Cancel the analysis of a recording. By job id, never by path: a path-only
 * cancel would also stop a transcription of the same file.
 */
export async function cancelSpeakerAnalysis(bundleDir: string): Promise<boolean> {
  const job = useSpeakersStore.getState().jobs[bundleDir];
  if (!job) return false;
  return await tauriApi.cancelTranscription(job.jobId, null);
}

/** Forget a finished analysis (the user confirmed names, or asked to analyse again). */
export function discardPreparedAnalysis(bundleDir: string): void {
  if (getPreparedAnalysis(bundleDir) || useSpeakersStore.getState().prepared[bundleDir]) {
    useSpeakersStore.getState().setPrepared(bundleDir, null);
  }
}
