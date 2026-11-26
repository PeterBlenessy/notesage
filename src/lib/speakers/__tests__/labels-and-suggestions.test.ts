import { describe, it, expect } from 'vitest';
import {
  cleanName,
  compareLabels,
  isAnalysisLabel,
  isGenericLabel,
  namesToStore,
  sameName,
  speakerNumber,
  unnamedSpeakerName,
} from '@/lib/speakers/display-names';
import {
  MIN_OVERLAP_SHARE,
  SAME_SPEAKER_SHARE,
  keptNames,
  matchLabels,
  overlapSeconds,
  type LabelledInterval,
} from '@/lib/speakers/match-labels';
import {
  MAX_SUGGESTIONS,
  formatParticipants,
  parseParticipants,
  rankSuggestions,
} from '@/lib/speakers/suggestions';
import type { Introduction } from '@/lib/speakers/introductions';
import type { VoiceMatchCandidate } from '@/lib/tauri';
import {
  SPEAKER_NUMBERED,
  parseSpeakersExtras,
  parseSpeakersFile,
  renderTranscriptBody,
  serializeSpeakersFile,
  speakerDisplayName,
} from '@/lib/transcription/segments';

const EN = { me: 'Me', others: 'Others', [SPEAKER_NUMBERED]: 'Speaker {n}' };
const SV = { me: 'Jag', others: 'Övriga', [SPEAKER_NUMBERED]: 'Talare {n}' };

// ===========================================================================
// Display names
// ===========================================================================

describe('speaker labels and what they are called', () => {
  it('recognises the labels voice analysis makes', () => {
    expect(speakerNumber('speaker-1')).toBe(1);
    expect(speakerNumber('speaker-12')).toBe(12);
    for (const label of ['speaker-0', 'speaker-', 'speaker-1a', 'Speaker-1', 'speaker 1', 'me', 'others', 'Anna', SPEAKER_NUMBERED]) {
      expect(speakerNumber(label), label).toBeNull();
    }
    expect(isAnalysisLabel('speaker-3')).toBe(true);
    expect(isAnalysisLabel('Anna Berg')).toBe(false);
  });

  it('tells a generic label from a name', () => {
    for (const label of ['me', 'others', 'speaker-2']) expect(isGenericLabel(label)).toBe(true);
    for (const label of ['Anna', 'Speaker 2', 'Me', 'speaker']) expect(isGenericLabel(label)).toBe(false);
  });

  it('shows speaker-N as "Speaker N" in English and "Talare N" in Swedish until it is named', () => {
    expect(unnamedSpeakerName('speaker-1', EN)).toBe('Speaker 1');
    expect(unnamedSpeakerName('speaker-10', SV)).toBe('Talare 10');
    expect(unnamedSpeakerName('me', SV)).toBe('Jag');
    expect(unnamedSpeakerName('Anna Berg', EN)).toBe('Anna Berg');
    // Without the template there is nothing better than the label.
    expect(unnamedSpeakerName('speaker-1', { me: 'Me' })).toBe('speaker-1');
    // The template key is not a label.
    expect(unnamedSpeakerName(SPEAKER_NUMBERED, EN)).toBe(SPEAKER_NUMBERED);
  });

  it('the shared display function gives a name, then the default, then "Speaker N", then the label', () => {
    expect(speakerDisplayName('speaker-2', { 'speaker-2': 'Anna' }, EN)).toBe('Anna');
    expect(speakerDisplayName('speaker-2', {}, EN)).toBe('Speaker 2');
    expect(speakerDisplayName('speaker-2', {}, SV)).toBe('Talare 2');
    expect(speakerDisplayName('speaker-2', {})).toBe('speaker-2');
    expect(speakerDisplayName('me', {}, SV)).toBe('Jag');
    expect(speakerDisplayName('Erik Lund', {}, EN)).toBe('Erik Lund');
    expect(speakerDisplayName('speaker-0', {}, EN)).toBe('speaker-0');
  });

  it('the transcript body writes "Speaker 1" for an unnamed voice and the name once it has one', () => {
    const segments = [
      { start: 0, end: 4, text: 'Hello.', speaker: 'speaker-1' },
      { start: 5, end: 9, text: 'Hi there.', speaker: 'speaker-2' },
      { start: 10, end: 12, text: 'Shall we start?', speaker: 'me' },
    ];
    const unnamed = renderTranscriptBody(segments, {}, { defaultNames: SV });
    expect(unnamed).toContain('**Talare 1** [00:00:00] Hello.');
    expect(unnamed).toContain('**Talare 2** [00:00:05] Hi there.');
    expect(unnamed).toContain('**Jag** [00:00:10] Shall we start?');
    const named = renderTranscriptBody(segments, { 'speaker-2': 'Anna' }, { defaultNames: EN });
    expect(named).toContain('**Speaker 1** [00:00:00]');
    expect(named).toContain('**Anna** [00:00:05]');
  });

  it('does not store a name that is blank or still the built-in default', () => {
    const stored = namesToStore(
      [
        { label: 'me', value: 'Me' },
        { label: 'speaker-1', value: '  Anna   Berg ' },
        { label: 'speaker-2', value: 'Speaker 2' },
        { label: 'speaker-3', value: '   ' },
        { label: 'speaker-4', value: 'Speaker 2' },
      ],
      EN,
    );
    // speaker-4 called "Speaker 2" is a real choice (it is not ITS default).
    expect(stored).toEqual({ 'speaker-1': 'Anna Berg', 'speaker-4': 'Speaker 2' });
  });

  it('cleans and compares names without regard to case and spacing', () => {
    expect(cleanName('  Anna \t Berg\n')).toBe('Anna Berg');
    expect(sameName('anna  berg', 'Anna Berg')).toBe(true);
    expect(sameName('Åsa', 'åsa')).toBe(true);
    expect(sameName('Anna', 'Anna B')).toBe(false);
  });

  it('orders labels me, speaker-1 … speaker-10, then names', () => {
    const labels = ['speaker-10', 'Erik', 'speaker-2', 'me', 'Anna', 'speaker-1'];
    expect([...labels].sort(compareLabels)).toEqual(['me', 'speaker-1', 'speaker-2', 'speaker-10', 'Anna', 'Erik']);
  });
});

// ===========================================================================
// speakers.json: names, labels, participants
// ===========================================================================

describe('speakers.json extras', () => {
  it('a file with only names is byte for byte what it was before the extras existed', () => {
    expect(serializeSpeakersFile({ me: 'Peter' })).toBe('{\n  "version": 1,\n  "names": {\n    "me": "Peter"\n  }\n}\n');
    expect(serializeSpeakersFile({ me: 'Peter' }, { participants: [], labels: [] })).toBe(
      serializeSpeakersFile({ me: 'Peter' }),
    );
  });

  it('round-trips participants and labels, and never an embedding-shaped key', () => {
    const json = serializeSpeakersFile(
      { 'speaker-1': 'Anna' },
      { participants: ['Anna Berg', 'Erik Lund'], labels: ['speaker-1', 'speaker-2'] },
    );
    expect(parseSpeakersFile(json)).toEqual({ 'speaker-1': 'Anna' });
    expect(parseSpeakersExtras(json)).toEqual({
      participants: ['Anna Berg', 'Erik Lund'],
      labels: ['speaker-1', 'speaker-2'],
    });
    expect(Object.keys(JSON.parse(json))).toEqual(['version', 'names', 'labels', 'participants']);
  });

  it('reads damaged or old files as "nothing listed"', () => {
    expect(parseSpeakersExtras('not json')).toEqual({ participants: [], labels: [] });
    expect(parseSpeakersExtras('{"version":1,"names":{}}')).toEqual({ participants: [], labels: [] });
    expect(parseSpeakersExtras('{"participants":"Anna","labels":[1,"speaker-1"," ","speaker-1"]}')).toEqual({
      participants: [],
      labels: ['speaker-1'],
    });
  });
});

// ===========================================================================
// Matching labels across two analyses
// ===========================================================================

/** `n` back-to-back intervals of `each` seconds for a speaker, starting at `from`. */
function talk(speaker: string, from: number, n: number, each = 10, gap = 0): LabelledInterval[] {
  return Array.from({ length: n }, (_, i) => ({
    start: from + i * (each + gap),
    end: from + i * (each + gap) + each,
    speaker,
  }));
}

describe('matchLabels — keeping names when a recording is analysed again', () => {
  it('follows the voice, not the number, when the analysis renumbers', () => {
    const before = [...talk('speaker-1', 0, 6), ...talk('speaker-2', 60, 6), ...talk('speaker-3', 120, 3)];
    // The same three voices, numbered in another order, boundaries a little off.
    const after = [
      ...talk('speaker-2', 1, 6).map((i) => ({ ...i, end: i.end - 1 })),
      ...talk('speaker-3', 61, 6),
      ...talk('speaker-1', 121, 3),
    ];
    const matches = matchLabels(before, after);
    expect(matches).toEqual({ 'speaker-2': 'speaker-1', 'speaker-3': 'speaker-2', 'speaker-1': 'speaker-3' });
    expect(keptNames(matches, { 'speaker-1': 'Anna', 'speaker-3': 'Erik' })).toEqual({
      'speaker-2': 'Anna',
      'speaker-1': 'Erik',
    });
  });

  it('is one to one: two new voices cannot both be the same old one', () => {
    const before = talk('speaker-1', 0, 10);
    const after = [...talk('speaker-1', 0, 6), ...talk('speaker-2', 60, 4)];
    const matches = matchLabels(before, after);
    expect(matches).toEqual({ 'speaker-1': 'speaker-1' });
  });

  it('does not call one of three voices inside "Others" the same speaker as "Others"', () => {
    const before = [...talk('me', 0, 3), ...talk('others', 30, 9)];
    const after = [...talk('me', 0, 3), ...talk('speaker-1', 30, 3), ...talk('speaker-2', 60, 3), ...talk('speaker-3', 90, 3)];
    expect(matchLabels(before, after)).toEqual({ me: 'me' });
  });

  it('matches a voice that is most of the old speaker, and refuses it at the strict bar', () => {
    const before = talk('others', 0, 10); // 100 s
    const after = [...talk('speaker-1', 0, 7), ...talk('speaker-2', 70, 3)]; // 70 s + 30 s
    expect(matchLabels(before, after, MIN_OVERLAP_SHARE)).toEqual({ 'speaker-1': 'others' });
    expect(matchLabels(before, after, SAME_SPEAKER_SHARE)).toEqual({});
  });

  it('ignores crosstalk: a little overlap is not identity', () => {
    const before = talk('speaker-1', 0, 10);
    const after = [{ start: 95, end: 200, speaker: 'speaker-1' }];
    expect(matchLabels(before, after)).toEqual({});
  });

  it('handles speakers who talk at the same time on two tracks', () => {
    const before = [{ start: 0, end: 100, speaker: 'me' }, { start: 0, end: 100, speaker: 'others' }];
    const after = [{ start: 0, end: 100, speaker: 'me' }, { start: 0, end: 100, speaker: 'speaker-1' }];
    // Both pairs overlap fully; ties are settled by label order, deterministically.
    const matches = matchLabels(before, after);
    expect(Object.keys(matches).sort()).toEqual(['me', 'speaker-1']);
    expect(new Set(Object.values(matches))).toEqual(new Set(['me', 'others']));
    expect(matchLabels(before, after)).toEqual(matches);
  });

  it('ignores unlabelled and empty intervals, and returns nothing for nothing', () => {
    expect(matchLabels([], talk('speaker-1', 0, 3))).toEqual({});
    expect(matchLabels(talk('speaker-1', 0, 3), [])).toEqual({});
    expect(
      matchLabels(
        [{ start: 0, end: 10 }, { start: 5, end: 5, speaker: 'x' }, { start: 0, end: 10, speaker: null }],
        talk('speaker-1', 0, 1),
      ),
    ).toEqual({});
  });

  it('adds up overlap correctly whatever order the intervals come in', () => {
    const before = [...talk('a', 0, 5), ...talk('b', 50, 5)];
    const after = [...talk('y', 50, 5), ...talk('x', 0, 5)].reverse();
    const overlaps = overlapSeconds(before, after);
    expect(overlaps.get('x')?.get('a')).toBe(50);
    expect(overlaps.get('y')?.get('b')).toBe(50);
    expect(overlaps.get('x')?.get('b')).toBeUndefined();
  });

  it('keeps a Teams name (the label itself) and drops a generic label nobody named', () => {
    expect(keptNames({ 'speaker-1': 'Anna Berg', 'speaker-2': 'others', me: 'me' }, {})).toEqual({
      'speaker-1': 'Anna Berg',
    });
    expect(keptNames({ me: 'me' }, { me: 'Peter' })).toEqual({ me: 'Peter' });
  });

  it('is quick on an hour-long meeting', () => {
    const before = Array.from({ length: 3000 }, (_, i) => ({ start: i * 1.2, end: i * 1.2 + 1.1, speaker: `speaker-${(i % 5) + 1}` }));
    const after = before.map((i) => ({ ...i, speaker: `speaker-${6 - Number(i.speaker.slice(8))}` }));
    const started = Date.now();
    const matches = matchLabels(before, after);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(matches['speaker-5']).toBe('speaker-1');
    expect(Object.keys(matches)).toHaveLength(5);
  });
});

// ===========================================================================
// Participants and suggestion ranking
// ===========================================================================

function candidate(name: string, confidence: 'likely' | 'possible', id = `vp-${name}`): VoiceMatchCandidate {
  return { profile_id: id, name, is_me: false, score: confidence === 'likely' ? 0.7 : 0.45, confidence, participant: false };
}
function intro(name: string, confidence: number, speaker = 'speaker-1'): Introduction {
  return { speaker, name, segmentIndex: 0, confidence };
}

describe('parseParticipants', () => {
  it('splits on commas, semicolons and new lines, trims, and drops duplicates ignoring case', () => {
    expect(parseParticipants(' Anna Berg, erik lund;Åsa\n\nAnna  Berg\r\nERIK LUND , ')).toEqual([
      'Anna Berg',
      'erik lund',
      'Åsa',
    ]);
    expect(parseParticipants('')).toEqual([]);
    expect(parseParticipants(' , ;\n')).toEqual([]);
  });

  it('round-trips through the text field', () => {
    const names = ['Anna Berg', 'Erik Lund'];
    expect(parseParticipants(formatParticipants(names))).toEqual(names);
  });
});

describe('rankSuggestions', () => {
  it('offers nothing when there is nothing to go on', () => {
    expect(rankSuggestions({})).toEqual([]);
  });

  it('orders likely voice, a clear introduction, possible voice, a weak introduction, then participants', () => {
    const ranked = rankSuggestions({
      candidates: [candidate('Possible Pia', 'possible'), candidate('Likely Lena', 'likely')],
      introductions: [intro('Weak Wille', 0.55), intro('Strong Stina', 0.9)],
      participants: ['Peter Participant'],
    });
    expect(ranked.map((s) => [s.name, s.source])).toEqual([
      ['Likely Lena', 'voice-likely'],
      ['Strong Stina', 'transcript'],
      ['Possible Pia', 'voice-possible'],
      ['Weak Wille', 'transcript'],
      ['Peter Participant', 'participant'],
    ]);
  });

  it('offers one chip per name, and it carries the stored voice of that name whichever source came first', () => {
    const ranked = rankSuggestions({
      candidates: [candidate('Anna Berg', 'possible', 'vp-7')],
      introductions: [intro('anna berg', 0.9)],
      participants: ['Anna Berg'],
    });
    // The clear introduction is offered before a "possible" voice match, so
    // the chip is the transcript's; saving must still add to voice vp-7.
    expect(ranked).toEqual([{ name: 'Anna Berg', source: 'transcript', profileId: 'vp-7' }]);
  });

  it('keeps the profile id on a voice suggestion and has none on the others', () => {
    const ranked = rankSuggestions({
      candidates: [candidate('Anna', 'likely', 'vp-1')],
      introductions: [intro('Erik', 0.9)],
      participants: ['Sara'],
    });
    expect(ranked).toEqual([
      { name: 'Anna', source: 'voice-likely', profileId: 'vp-1' },
      { name: 'Erik', source: 'transcript' },
      { name: 'Sara', source: 'participant' },
    ]);
  });

  it('turns a first name heard in the meeting into the full name on the participant list', () => {
    const ranked = rankSuggestions({ introductions: [intro('Anna', 0.9)], participants: ['Erik Lund', 'Anna Berg'] });
    expect(ranked[0]).toEqual({ name: 'Anna Berg', source: 'transcript' });
    // …and "Anna Berg" is then not offered a second time as a participant.
    expect(ranked.map((s) => s.name)).toEqual(['Anna Berg', 'Erik Lund']);
  });

  it('folds a first name heard in the meeting into the remembered voice of that person', () => {
    const ranked = rankSuggestions({
      candidates: [candidate('Anna Berg', 'likely', 'vp-1'), candidate('Sara Ek', 'possible', 'vp-2')],
      introductions: [intro('Anna', 0.8)],
    });
    expect(ranked).toEqual([
      { name: 'Anna Berg', source: 'voice-likely', profileId: 'vp-1' },
      { name: 'Sara Ek', source: 'voice-possible', profileId: 'vp-2' },
    ]);
  });

  it('does not guess between two participants with the same first name', () => {
    const ranked = rankSuggestions({ introductions: [intro('Anna', 0.9)], participants: ['Anna Berg', 'Anna Ek'] });
    expect(ranked[0]).toEqual({ name: 'Anna', source: 'transcript' });
  });

  it('leaves out participants already named as another voice, but keeps voice and transcript suggestions', () => {
    const ranked = rankSuggestions({
      candidates: [candidate('Anna Berg', 'likely')],
      introductions: [intro('Erik', 0.9)],
      participants: ['Anna Berg', 'Erik Lund', 'Sara Ek'],
      takenNames: ['anna berg', 'Erik Lund'],
    });
    expect(ranked.map((s) => [s.name, s.source])).toEqual([
      ['Anna Berg', 'voice-likely'],
      // "Erik" said in the meeting is "Erik Lund" on the list.
      ['Erik Lund', 'transcript'],
      ['Sara Ek', 'participant'],
    ]);
  });

  it('caps the number of chips', () => {
    const participants = Array.from({ length: 12 }, (_, i) => `Person ${i + 1}`);
    expect(rankSuggestions({ participants })).toHaveLength(MAX_SUGGESTIONS);
    expect(rankSuggestions({ participants, limit: 2 }).map((s) => s.name)).toEqual(['Person 1', 'Person 2']);
  });

  it('ignores blank names', () => {
    expect(rankSuggestions({ candidates: [candidate('  ', 'likely')], participants: [' '] })).toEqual([]);
  });
});
