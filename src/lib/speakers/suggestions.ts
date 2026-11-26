import type { VoiceMatchCandidate } from '@/lib/tauri';
import type { Introduction } from '@/lib/speakers/introductions';
import { cleanName, sameName } from '@/lib/speakers/display-names';

/**
 * Name suggestions for one found voice, in the order they are offered.
 *
 * Everything here is a SUGGESTION. A voice match is a guess about a person
 * from biometric data; a name heard in the transcript may be somebody else's.
 * The dialog shows these as chips and fills the name field only when one is
 * clicked. Pure.
 */

export type SuggestionSource =
  /** A remembered voice the backend calls a likely match. */
  | 'voice-likely'
  /** A remembered voice that might be this one. */
  | 'voice-possible'
  /** A name this voice said about itself ("this is Anna"). */
  | 'transcript'
  /** Somebody on the participant list nobody has been named as yet. */
  | 'participant';

export interface NameSuggestion {
  name: string;
  source: SuggestionSource;
  /** The stored voice behind a voice suggestion: saving goes to this profile. */
  profileId?: string;
}

/** At most this many chips per voice. */
export const MAX_SUGGESTIONS = 5;
/** A transcript introduction at or above this is offered before "possible" voice matches. */
const STRONG_INTRODUCTION = 0.8;

/**
 * The participant field as a list of names: split on commas, semicolons and
 * new lines; trimmed; duplicates (ignoring case) dropped; order kept.
 */
export function parseParticipants(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,;\n\r]+/)) {
    const name = cleanName(part);
    if (name && !out.some((existing) => sameName(existing, name))) out.push(name);
  }
  return out;
}

export function formatParticipants(names: readonly string[]): string {
  return names.join(', ');
}

/**
 * "Anna" is "Anna Berg" on a list of full names, when exactly one person on
 * it has that first name: the same rule the backend uses for participants.
 */
function fullNameFor(name: string, fullNames: readonly string[]): string | null {
  const exact = fullNames.find((p) => sameName(p, name));
  if (exact) return exact;
  const firstNames = fullNames.filter((p) => sameName(p.split(' ')[0] ?? '', name));
  return firstNames.length === 1 ? firstNames[0] : null;
}

export interface RankInput {
  /** Voice-match candidates for this voice, best first (empty when voices are not remembered). */
  candidates?: readonly VoiceMatchCandidate[];
  /** Introductions spoken by THIS voice. */
  introductions?: readonly Introduction[];
  participants?: readonly string[];
  /** Names already in OTHER voices' name fields. */
  takenNames?: readonly string[];
  limit?: number;
}

/**
 * Order: likely voice matches, names the voice clearly said about itself,
 * possible voice matches, weaker introductions, then participants nobody has
 * been named as. One chip per name, at the first place it comes up; whichever
 * source that is, the chip carries the stored voice of the same name when the
 * voice match offered one, so saving adds to that voice.
 */
export function rankSuggestions(input: RankInput): NameSuggestion[] {
  const participants = input.participants ?? [];
  const taken = input.takenNames ?? [];
  const candidates = input.candidates ?? [];
  const introductions = [...(input.introductions ?? [])].sort((a, b) => b.confidence - a.confidence);
  const limit = input.limit ?? MAX_SUGGESTIONS;

  const out: NameSuggestion[] = [];
  const add = (suggestion: NameSuggestion) => {
    const name = cleanName(suggestion.name);
    if (!name || out.some((existing) => sameName(existing.name, name))) return;
    const stored = suggestion.profileId ?? candidates.find((c) => sameName(c.name, name))?.profile_id;
    out.push(stored ? { ...suggestion, name, profileId: stored } : { ...suggestion, name });
  };
  const fromVoice = (confidence: VoiceMatchCandidate['confidence']) => {
    for (const candidate of candidates) {
      if (candidate.confidence !== confidence) continue;
      add({
        name: candidate.name,
        source: confidence === 'likely' ? 'voice-likely' : 'voice-possible',
        profileId: candidate.profile_id,
      });
    }
  };
  const fromTranscript = (strong: boolean) => {
    for (const intro of introductions) {
      if (intro.confidence >= STRONG_INTRODUCTION !== strong) continue;
      // "Anna" said in the meeting is "Anna Berg" on the participant list, or
      // the "Anna Berg" whose remembered voice this one sounds like: one chip.
      const full =
        fullNameFor(intro.name, participants) ??
        fullNameFor(
          intro.name,
          candidates.map((c) => c.name),
        );
      add({ name: full ?? intro.name, source: 'transcript' });
    }
  };

  fromVoice('likely');
  fromTranscript(true);
  fromVoice('possible');
  fromTranscript(false);
  for (const participant of participants) {
    if (taken.some((name) => sameName(name, participant))) continue;
    add({ name: participant, source: 'participant' });
  }
  return out.slice(0, limit);
}
