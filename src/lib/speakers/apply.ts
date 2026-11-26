import { tauriApi, type AnalyzedSpeaker, type SpeakerSegment, type VoiceProfileSummary } from '@/lib/tauri';
import { parseFrontmatter } from '@/lib/frontmatter';
import { readRecordingManifest, transcriptFileOf } from '@/lib/transcription/bundle';
import {
  SPEAKER_ME,
  speakerDisplayName,
  speakerLabels,
  type Segment,
  type SpeakerNames,
} from '@/lib/transcription/segments';
import {
  defaultSpeakerNames,
  inspectTranscript,
  readSegments,
  readSpeakersFile,
  renameSpeakers,
  replaceNamesInTranscript,
  writeSpeakers,
  writeTranscript,
  type ExistingTranscript,
  type TranscriptWriteMode,
  type WrittenTranscript,
} from '@/lib/transcription/transcript-files';
import { cleanName, compareLabels, sameName } from '@/lib/speakers/display-names';
import { keptNames, matchLabels } from '@/lib/speakers/match-labels';
import { useSpeakersStore } from '@/stores/speakers-store';

/**
 * The part of "Identify speakers" that touches the disk and the voice store:
 * what a recording holds before the analysis, and what is written once the
 * user has confirmed who is who.
 *
 * Two rules run through it:
 *  - nothing in the bundle changes until the user confirms, and an edited
 *    transcript is never replaced without the user saying so;
 *  - a voiceprint goes to exactly one place, `voice_profile_save`, and only
 *    for a voice the user ticked, and only while voices are remembered. It is
 *    never written to the bundle.
 */

export interface IdentifyContext {
  /** The transcript's timed segments as they are now (labels from tracks, an earlier analysis, or none). */
  segments: Segment[];
  /** Names the user has given labels so far. */
  names: SpeakerNames;
  participants: string[];
  /** The transcript on disk, and whether it has been edited by hand. */
  transcript: ExistingTranscript | null;
}

export async function loadIdentifyContext(bundleDir: string): Promise<IdentifyContext> {
  const manifest = await readRecordingManifest(bundleDir);
  const [{ segments }, file, transcript] = await Promise.all([
    readSegments(bundleDir, transcriptFileOf(manifest)),
    readSpeakersFile(bundleDir),
    inspectTranscript(bundleDir, manifest),
  ]);
  return { segments, names: file.names, participants: file.participants, transcript };
}

/** The segments an analysis returned, as the sidecar stores them. */
export function segmentsFromAnalysis(segments: readonly SpeakerSegment[]): Segment[] {
  return segments.map((s) => {
    const out: Segment = { start: s.start, end: s.end, text: s.text };
    const speaker = typeof s.speaker === 'string' ? s.speaker.trim() : '';
    if (speaker) out.speaker = speaker;
    return out;
  });
}

/**
 * The names an earlier naming gave the voices found now: the old and the new
 * labels are matched by when they spoke, so a name follows the voice even if
 * the analysis numbered it differently this time.
 */
export function namesKeptFromBefore(
  previous: readonly Segment[],
  next: readonly Segment[],
  previousNames: SpeakerNames,
): { matches: Record<string, string>; names: SpeakerNames } {
  const matches = matchLabels(previous, next);
  return { matches, names: keptNames(matches, previousNames) };
}

export interface ConfirmOptions {
  bundleDir: string;
  /** The analysis' segments, labelled `speaker-N` / `me`. */
  segments: readonly Segment[];
  /** Label → the name the user confirmed. Unnamed labels are absent. */
  names: SpeakerNames;
  participants: readonly string[];
  /** What to do with the existing transcript. Omitted when there is none. */
  mode?: TranscriptWriteMode;
}

/**
 * Write the confirmed identification: `speakers.json` (names, the labels
 * found, the participants), then `segments.json` and the transcript through
 * the ordinary writer. Keeps the language and model the transcript was made
 * with, since the words are the same words.
 */
export async function confirmIdentification(options: ConfirmOptions): Promise<WrittenTranscript> {
  const { bundleDir, segments, names } = options;
  const manifest = await readRecordingManifest(bundleDir);
  const existing = await inspectTranscript(bundleDir, manifest);
  const previous = existing ? (parseFrontmatter(existing.content).frontmatter ?? {}) : {};
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

  const labels = speakerLabels(segments).sort(compareLabels);
  await writeSpeakers(bundleDir, names, { labels, participants: options.participants });
  return writeTranscript({
    bundleDir,
    segments,
    speakers: names,
    language: text(previous.language) ?? manifest?.transcription?.language ?? manifest?.language,
    model: text(previous.model) ?? manifest?.transcription?.model,
    mode: options.mode,
  });
}

export interface NameChange {
  from: string;
  to: string;
}

/**
 * For a transcript that has been edited by hand: the name changes that can be
 * made safely WITHOUT regenerating it.
 *
 * Only a found voice that is one of the transcript's existing speakers (the
 * same stretches of speech, one to one) qualifies: its old display name can
 * be swapped for the new one where its turns begin. A voice the old
 * transcript did not tell apart (three people inside "Others") cannot be
 * named by replacing text, and is left out.
 */
export function safeNameChanges(
  matches: Readonly<Record<string, string>>,
  previousNames: SpeakerNames,
  nextNames: SpeakerNames,
): { names: SpeakerNames; changes: NameChange[] } {
  const defaults = defaultSpeakerNames();
  const names: SpeakerNames = { ...previousNames };
  const changes: NameChange[] = [];
  for (const [nextLabel, previousLabel] of Object.entries(matches)) {
    const to = cleanName(nextNames[nextLabel] ?? '');
    if (!to) continue;
    const from = speakerDisplayName(previousLabel, previousNames, defaults);
    if (from === to) continue;
    names[previousLabel] = to;
    changes.push({ from, to });
  }
  return { names, changes };
}

/**
 * The fallback for an edited transcript: keep its text and its segments, save
 * the new names under the labels it already has, and swap them in where each
 * turn begins. Resolves with how many turn headers changed.
 */
export async function applyNamesOnly(
  bundleDir: string,
  names: SpeakerNames,
  changes: readonly NameChange[],
  participants: readonly string[],
): Promise<number> {
  await writeSpeakers(bundleDir, names, { participants });
  // `renameSpeakers` regenerates only an untouched transcript; for the edited
  // one this path exists for, it saves the names and leaves the text alone.
  const result = await renameSpeakers(bundleDir, names);
  if (result.rewritten) return changes.length;
  return replaceNamesInTranscript(bundleDir, changes);
}

export interface VoiceToRemember {
  speaker: AnalyzedSpeaker;
  /** The confirmed name. For `me` it may be blank: the profile keeps its name. */
  name: string;
  /** The stored voice the user confirmed a suggestion for, when they did. */
  profileId?: string;
}

export interface RememberResult {
  saved: VoiceProfileSummary[];
  failed: Array<{ name: string; error: string }>;
}

/**
 * Save the ticked voices as profiles. Does nothing at all unless voices are
 * remembered; passes the setting itself as `consent`, so a call made while it
 * is off would be refused by the backend rather than slipping through.
 */
export async function rememberVoices(
  voices: readonly VoiceToRemember[],
  context: { bundleDir: string; model: string; knownProfiles: readonly VoiceProfileSummary[] },
): Promise<RememberResult> {
  const result: RememberResult = { saved: [], failed: [] };
  const consent = useSpeakersStore.getState().rememberVoices;
  if (!consent) return result;
  const mine = context.knownProfiles.find((profile) => profile.is_me);
  for (const voice of voices) {
    if (voice.speaker.embedding.length === 0) continue;
    const isMe = voice.speaker.label === SPEAKER_ME;
    // The user's own profile keeps the name it has unless a new one was typed.
    const name = cleanName(voice.name) || (isMe ? (mine?.name ?? defaultSpeakerNames()[SPEAKER_ME]) : '');
    if (!name) continue;
    // A suggestion's profile is only the right one while the name is still its name.
    const confirmed = voice.profileId
      ? context.knownProfiles.find((profile) => profile.id === voice.profileId && sameName(profile.name, name))
      : undefined;
    try {
      const saved = await tauriApi.voiceProfileSave({
        consent,
        name,
        embedding: voice.speaker.embedding,
        source: { kind: 'manual', recording: context.bundleDir },
        profileId: confirmed?.id ?? null,
        isMe: isMe ? true : null,
        model: context.model,
      });
      result.saved.push(saved.profile);
    } catch (err) {
      result.failed.push({ name, error: String(err instanceof Error ? err.message : err).replace(/^Error:\s*/, '') });
    }
  }
  return result;
}
