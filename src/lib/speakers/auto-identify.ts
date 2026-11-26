import { log } from '@/lib/logger';
import { readRecordingManifest, transcriptFileOf } from '@/lib/transcription/bundle';
import { readSegments, readSpeakersExtras } from '@/lib/transcription/transcript-files';
import { isAnalysisCancellation, runSpeakerAnalysis } from '@/lib/speakers/run-analysis';
import { useSpeakersStore } from '@/stores/speakers-store';

/**
 * "Identify speakers automatically after transcription" (off by default).
 *
 * When it is on and the voice model is installed, a finished transcription is
 * followed by a voice analysis of the same recording. That is ALL it does: the
 * result is held in memory and the recording's row says "Speaker names
 * suggested". No file in the bundle changes, no name is applied and no voice
 * is saved until the user opens "Identify speakers" and confirms.
 *
 * It is off by default because the analysis costs minutes of CPU on a long
 * meeting.
 */

export interface FinishedRecording {
  dir: string;
  audioPath: string | null;
  transcriptPath: string | null;
  hasTeamsTranscript: boolean;
  tracks: Array<{ role: 'mic' | 'system'; path: string }> | null;
}

/** Should this recording be analysed by itself right now? Pure but for the store read. */
export function shouldAutoIdentify(bundle: FinishedRecording): boolean {
  const state = useSpeakersStore.getState();
  if (!state.autoIdentify) return false;
  // Teams already names the speakers; there is nothing to find out.
  if (bundle.hasTeamsTranscript) return false;
  if (!bundle.audioPath || !bundle.transcriptPath) return false;
  if (state.jobs[bundle.dir] || state.prepared[bundle.dir]) return false;
  return true;
}

/**
 * Analyse a recording whose transcription just finished, if the setting asks
 * for it. Resolves `true` when suggestions were prepared. Never throws, never
 * toasts: it was not asked for by a click, so a failure is only logged.
 */
export async function autoIdentifySpeakers(bundle: FinishedRecording): Promise<boolean> {
  if (!shouldAutoIdentify(bundle) || !bundle.audioPath) return false;
  try {
    const store = useSpeakersStore.getState();
    const installed = store.modelsInstalled ?? (await store.refreshModels());
    if (!installed) return false;

    const manifest = await readRecordingManifest(bundle.dir);
    const [{ segments }, extras] = await Promise.all([
      readSegments(bundle.dir, transcriptFileOf(manifest)),
      readSpeakersExtras(bundle.dir),
    ]);
    if (segments.length === 0) return false;
    await runSpeakerAnalysis({
      bundleDir: bundle.dir,
      audioPath: bundle.audioPath,
      tracks: bundle.tracks,
      segments,
      participants: extras.participants,
      expectedSpeakers: null,
      sharedMicrophone: false,
      automatic: true,
    });
    return true;
  } catch (err) {
    if (!isAnalysisCancellation(err)) log.warn('speakers', 'Automatic speaker identification failed', String(err));
    // A background failure must not leave an error on the row nobody asked about.
    useSpeakersStore.getState().setJobError(bundle.dir, null);
    return false;
  }
}
