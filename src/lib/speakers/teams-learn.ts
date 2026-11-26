import { toast } from 'sonner';

import { tauriApi, type NamedSpeakerTurn } from '@/lib/tauri';
import { t } from '@/lib/i18n';
import { readRecordingManifest, transcriptFileOf } from '@/lib/transcription/bundle';
import { SPEAKER_ME, speakerLabels, type Segment } from '@/lib/transcription/segments';
import { readSegments, readSpeakers } from '@/lib/transcription/transcript-files';
import { isGenericLabel } from '@/lib/speakers/display-names';
import { matchLabels } from '@/lib/speakers/match-labels';
import { useSpeakersStore } from '@/stores/speakers-store';

/**
 * Learning voices from a Teams transcript.
 *
 * A Teams transcript says who spoke when, by name. With the user's two
 * opt-ins on ("Remember voices" and "Learn voices from Teams transcripts"),
 * merging one is followed by an OFFER, a toast with one action, never a
 * dialog and never done by itself: "Remember these 4 voices". Accepting sends
 * the named turns to the backend, which makes one voiceprint per person from
 * the stretches where nobody else is talking, and each is saved as a profile
 * with source `teams`. People with too little clear speech are skipped, and
 * the user is told who.
 */

export interface TeamsLearnRequest {
  bundleDir: string;
  title: string;
  /** The recording's mixed/primary audio. */
  audioPath: string | null;
  /** The two tracks of a microphone + system-audio recording, else `null`. */
  tracks: ReadonlyArray<{ role: 'mic' | 'system'; path: string }> | null;
  /** Our own segments from BEFORE the merge: they say which stretches were the microphone (`me`). */
  previousSegments: readonly Segment[];
}

export interface TeamsLearnPlan {
  audioPath: string;
  turns: NamedSpeakerTurn[];
  /** The people who would be learnt, in order of first appearance. */
  names: string[];
  /** The user's own name in Teams, left out of a two-track recording (their voice is on the other track). */
  ownName: string | null;
}

/**
 * Who can be learnt from the merged segments, and from which audio file.
 *
 * In a two-track recording the remote participants are on the system track
 * and the user is on the microphone track. The person whose Teams turns are
 * the microphone's (`me`) stretches is the user: they are left out, because
 * their turns point at silence on the system track, and their own voice is
 * enrolled under "My voice" instead.
 */
export function planTeamsLearning(
  merged: readonly Segment[],
  names: Readonly<Record<string, string>>,
  request: Pick<TeamsLearnRequest, 'audioPath' | 'tracks' | 'previousSegments'>,
): TeamsLearnPlan | null {
  const system = request.tracks?.find((track) => track.role === 'system')?.path ?? null;
  const audioPath = system ?? request.audioPath;
  if (!audioPath) return null;

  let ownLabel: string | null = null;
  if (system) {
    const matches = matchLabels(request.previousSegments, merged);
    ownLabel = Object.entries(matches).find(([, previous]) => previous === SPEAKER_ME)?.[0] ?? null;
  }

  const labels = speakerLabels(merged).filter((label) => !isGenericLabel(label) && label !== ownLabel);
  if (labels.length === 0) return null;
  const nameOf = (label: string) => (names[label] ?? label).replace(/\s+/g, ' ').trim();
  const wanted = new Set(labels);
  const turns: NamedSpeakerTurn[] = [];
  for (const segment of merged) {
    if (!segment.speaker || !wanted.has(segment.speaker) || !(segment.end > segment.start)) continue;
    turns.push({ start: segment.start, end: segment.end, speaker: nameOf(segment.speaker) });
  }
  const learnt = [...new Set(labels.map(nameOf))].filter(Boolean);
  if (turns.length === 0 || learnt.length === 0) return null;
  return { audioPath, turns, names: learnt, ownName: ownLabel ? nameOf(ownLabel) : null };
}

export interface TeamsLearnOutcome {
  saved: string[];
  skipped: Array<{ name: string; reason: string }>;
  failed: Array<{ name: string; error: string }>;
}

/** "Too little clean speech: 3.2 s …" in the app's language; anything else as the backend wrote it. */
export function describeSkipReason(reason: string): string {
  return /^too little clean speech/i.test(reason) ? t('speakers.teams.tooLittleSpeech') : reason;
}

/**
 * Make and save the voiceprints. Refuses unless both opt-ins are on at the
 * moment it runs, and passes the "remember" setting itself as `consent`.
 */
export async function learnTeamsVoices(plan: TeamsLearnPlan, bundleDir: string): Promise<TeamsLearnOutcome> {
  const outcome: TeamsLearnOutcome = { saved: [], skipped: [], failed: [] };
  const settings = useSpeakersStore.getState();
  const consent = settings.rememberVoices;
  if (!consent || !settings.learnFromTeams) return outcome;

  const embedded = await tauriApi.embedSpeakerTurns(plan.audioPath, plan.turns);
  for (const skipped of embedded.skipped) outcome.skipped.push({ name: skipped.speaker, reason: skipped.reason });
  for (const speaker of embedded.speakers) {
    if (speaker.embedding.length === 0) {
      outcome.skipped.push({ name: speaker.speaker, reason: 'Too little clean speech' });
      continue;
    }
    try {
      await tauriApi.voiceProfileSave({
        consent,
        name: speaker.speaker,
        embedding: speaker.embedding,
        source: { kind: 'teams', recording: bundleDir },
        model: embedded.model,
      });
      outcome.saved.push(speaker.speaker);
    } catch (err) {
      outcome.failed.push({
        name: speaker.speaker,
        error: String(err instanceof Error ? err.message : err).replace(/^Error:\s*/, ''),
      });
    }
  }
  return outcome;
}

/** One plain sentence per thing that happened. */
export function describeOutcome(outcome: TeamsLearnOutcome): string {
  const parts: string[] = [];
  if (outcome.saved.length > 0) {
    parts.push(t('speakers.teams.saved', { count: outcome.saved.length, names: outcome.saved.join(', ') }));
  }
  if (outcome.skipped.length > 0) {
    parts.push(
      t('speakers.teams.skipped', {
        count: outcome.skipped.length,
        names: outcome.skipped.map((s) => `${s.name} (${describeSkipReason(s.reason)})`).join(', '),
      }),
    );
  }
  for (const failure of outcome.failed) {
    parts.push(t('speakers.teams.failedOne', { name: failure.name, error: failure.error }));
  }
  return parts.length > 0 ? parts.join(' ') : t('speakers.teams.nothing');
}

/**
 * After a Teams merge: offer to remember the named voices, when the user has
 * opted in to that and the voice model is installed. A toast with an action;
 * nothing happens unless the action is clicked. Never throws.
 */
export async function offerTeamsVoiceLearning(request: TeamsLearnRequest): Promise<boolean> {
  try {
    const settings = useSpeakersStore.getState();
    if (!settings.rememberVoices || !settings.learnFromTeams) return false;
    const installed = settings.modelsInstalled ?? (await settings.refreshModels());
    if (!installed) return false;

    const manifest = await readRecordingManifest(request.bundleDir);
    const [{ segments }, names] = await Promise.all([
      readSegments(request.bundleDir, transcriptFileOf(manifest)),
      readSpeakers(request.bundleDir),
    ]);
    const plan = planTeamsLearning(segments, names, request);
    if (!plan) return false;

    toast.info(t('speakers.teams.offer', { title: request.title }), {
      description: plan.ownName
        ? t('speakers.teams.offerDetailOwn', { names: plan.names.join(', '), own: plan.ownName })
        : t('speakers.teams.offerDetail', { names: plan.names.join(', ') }),
      duration: 30_000,
      action: {
        label: t('speakers.teams.remember', { count: plan.names.length }),
        onClick: () => {
          const working = toast.loading(t('speakers.teams.working'));
          void learnTeamsVoices(plan, request.bundleDir)
            .then((outcome) => {
              toast.dismiss(working);
              const text = describeOutcome(outcome);
              if (outcome.saved.length > 0) toast.success(text);
              else toast.warning(text);
              void useSpeakersStore.getState().refreshProfiles();
            })
            .catch((err) => {
              toast.dismiss(working);
              toast.error(
                t('speakers.teams.failed', {
                  error: String(err instanceof Error ? err.message : err).replace(/^Error:\s*/, ''),
                }),
              );
            });
        },
      },
    });
    return true;
  } catch {
    // An offer that cannot be made is not an error worth interrupting for.
    return false;
  }
}
