import { describe, it, expect } from 'vitest';
import {
  formatRecordingLength,
  formatTimestamp,
  freeTranscriptFileName,
  hashTranscript,
  parseSegmentsFile,
  parseSpeakersFile,
  renderTranscriptBody,
  renderTranscriptNote,
  replaceSpeakerNameInText,
  sanitizeFileStem,
  segmentsFromBackend,
  serializeSegmentsFile,
  serializeSpeakersFile,
  speakerDisplayName,
  speakerLabels,
  type Segment,
} from '@/lib/transcription/segments';
import { parseFrontmatter } from '@/lib/frontmatter';

const seg = (start: number, end: number, text: string, speaker?: string): Segment =>
  speaker ? { start, end, text, speaker } : { start, end, text };

describe('segments.json', () => {
  it('round-trips, omitting `speaker` when there is none', () => {
    const segments = [seg(0, 2.5, 'Hello.', 'me'), seg(3, 5, 'Hi.')];
    const json = serializeSegmentsFile(segments);
    expect(JSON.parse(json)).toEqual({
      version: 1,
      segments: [
        { start: 0, end: 2.5, text: 'Hello.', speaker: 'me' },
        { start: 3, end: 5, text: 'Hi.' },
      ],
    });
    expect(json.endsWith('\n')).toBe(true);
    expect(parseSegmentsFile(json)).toEqual(segments);
  });

  it('is null for anything that is not a version-1 segments file', () => {
    expect(parseSegmentsFile('not json')).toBeNull();
    expect(parseSegmentsFile('{"version":2,"segments":[]}')).toBeNull();
    expect(parseSegmentsFile('{"version":1}')).toBeNull();
    expect(parseSegmentsFile('[]')).toBeNull();
  });

  it('drops malformed entries instead of failing the whole file', () => {
    const json = JSON.stringify({
      version: 1,
      segments: [{ start: 0, end: 1, text: 'ok' }, { start: 'x', end: 1, text: 'no' }, null, { start: 1, end: Infinity, text: 'no' }],
    });
    expect(parseSegmentsFile(json)).toEqual([{ start: 0, end: 1, text: 'ok' }]);
  });

  it("reads the backend's `speaker`, and the legacy `speaker_id` as a fallback", () => {
    expect(
      segmentsFromBackend([
        { start: 0, end: 1, text: 'a', speaker: 'me' },
        { start: 1, end: 2, text: 'b', speaker_id: 'others', speaker_name: null },
        { start: 2, end: 3, text: 'c', speaker: null, speaker_id: null, speaker_name: null },
      ]),
    ).toEqual([seg(0, 1, 'a', 'me'), seg(1, 2, 'b', 'others'), seg(2, 3, 'c')]);
  });
});

describe('speakers.json', () => {
  it('round-trips and tolerates a missing or broken file', () => {
    const names = { me: 'Peter', 'Anna Svensson': 'Anna' };
    expect(parseSpeakersFile(serializeSpeakersFile(names))).toEqual(names);
    expect(parseSpeakersFile('')).toEqual({});
    expect(parseSpeakersFile('{"version":1,"names":[]}')).toEqual({});
    expect(parseSpeakersFile('{"version":1,"names":{"me":"  ","others":7,"x":" Xi "}}')).toEqual({ x: 'Xi' });
  });

  it('resolves a display name: the user\'s, then the translated default, then the label', () => {
    const defaults = { me: 'Jag', others: 'Övriga' };
    expect(speakerDisplayName('me', { me: 'Peter' }, defaults)).toBe('Peter');
    expect(speakerDisplayName('me', {}, defaults)).toBe('Jag');
    expect(speakerDisplayName('Anna Svensson', {}, defaults)).toBe('Anna Svensson');
  });

  it('lists labels in order of first appearance', () => {
    expect(speakerLabels([seg(0, 1, 'a', 'others'), seg(1, 2, 'b'), seg(2, 3, 'c', 'me'), seg(3, 4, 'd', 'others')])).toEqual([
      'others',
      'me',
    ]);
  });
});

describe('time formats', () => {
  it('formatTimestamp is always hh:mm:ss', () => {
    expect(formatTimestamp(0)).toBe('00:00:00');
    expect(formatTimestamp(75.9)).toBe('00:01:15');
    expect(formatTimestamp(3 * 3600 + 5)).toBe('03:00:05');
    expect(formatTimestamp(-4)).toBe('00:00:00');
    expect(formatTimestamp(Number.NaN)).toBe('00:00:00');
  });

  // U27: the list read "75 min 03 s"; U9: three formats for one length.
  it('formatRecordingLength is the one h:mm:ss format, null when unknown', () => {
    expect(formatRecordingLength(4503)).toBe('1:15:03');
    expect(formatRecordingLength(313)).toBe('0:05:13');
    expect(formatRecordingLength(9)).toBe('0:00:09');
    expect(formatRecordingLength(0)).toBeNull();
    expect(formatRecordingLength(null)).toBeNull();
    expect(formatRecordingLength(Number.NaN)).toBeNull();
  });
});

describe('renderTranscriptBody', () => {
  it('without speakers: paragraphs, with a timestamp marker about every minute', () => {
    const segments: Segment[] = [];
    // Five minutes of continuous speech in 10-second segments, no pauses.
    for (let t = 0; t < 300; t += 10) segments.push(seg(t, t + 10, `Sentence at ${t}.`));
    const body = renderTranscriptBody(segments);
    const paragraphs = body.trimEnd().split('\n\n');
    expect(paragraphs).toHaveLength(5);
    expect(paragraphs.map((p) => p.slice(0, 10))).toEqual([
      '[00:00:00]',
      '[00:01:00]',
      '[00:02:00]',
      '[00:03:00]',
      '[00:04:00]',
    ]);
    // Every word is still there, in order, and no marker is inside a sentence.
    expect(body.replace(/\[\d\d:\d\d:\d\d\] /g, '').replace(/\n\n/g, ' ').trim()).toBe(
      segments.map((s) => s.text).join(' '),
    );
  });

  it('without speakers: a pause starts a new paragraph, with no marker until one is due', () => {
    const body = renderTranscriptBody([seg(0, 4, 'One.'), seg(4.5, 8, 'Two.'), seg(15, 20, 'After a pause.')]);
    expect(body).toBe('[00:00:00] One. Two.\n\nAfter a pause.\n');
  });

  it('with speakers: turns start with the name and the time, and a change of speaker starts a turn', () => {
    const body = renderTranscriptBody(
      [
        seg(12, 18, 'Shall we start?', 'me'),
        seg(18.5, 24, 'I think everyone is here.', 'me'),
        seg(25, 31, 'Yes, go ahead.', 'others'),
        seg(32, 36, 'Good.', 'me'),
      ],
      { me: 'Peter' },
      { defaultNames: { me: 'Me', others: 'Others' } },
    );
    expect(body).toBe(
      [
        '**Peter** [00:00:12] Shall we start? I think everyone is here.',
        '**Others** [00:00:25] Yes, go ahead.',
        '**Peter** [00:00:32] Good.',
      ].join('\n\n') + '\n',
    );
  });

  it('with speakers: a long turn gets its own time markers so an hour of one voice still has references', () => {
    const segments: Segment[] = [];
    for (let t = 0; t < 180; t += 20) segments.push(seg(t, t + 20, `Part ${t}.`, 'me'));
    const paragraphs = renderTranscriptBody(segments, {}, { defaultNames: { me: 'Me' } }).trimEnd().split('\n\n');
    expect(paragraphs.map((p) => p.split(' Part')[0])).toEqual(['**Me** [00:00:00]', '[00:01:00]', '[00:02:00]']);
  });

  it('a stretch with no speaker between named turns keeps its time and gets no name', () => {
    const body = renderTranscriptBody([seg(0, 5, 'Hello.', 'Anna'), seg(6, 9, 'Unattributed.'), seg(10, 12, 'Back.', 'Anna')]);
    expect(body).toBe('**Anna** [00:00:00] Hello.\n\n[00:00:06] Unattributed.\n\n**Anna** [00:00:10] Back.\n');
  });

  it('drops blank segments and strips markup characters from names', () => {
    const body = renderTranscriptBody([seg(0, 1, '   ', 'a'), seg(1, 2, 'Real.', 'a')], { a: '**Bold** [x]_' });
    expect(body).toBe('**Bold x** [00:00:01] Real.\n');
  });

  it('is empty for no speech, and deterministic', () => {
    expect(renderTranscriptBody([])).toBe('');
    const segments = [seg(0, 1, 'a', 'me'), seg(2, 3, 'b', 'others')];
    expect(renderTranscriptBody(segments, {})).toBe(renderTranscriptBody(segments, {}));
  });
});

describe('renderTranscriptNote (U24)', () => {
  it('has a small frontmatter and no segments in it', () => {
    const body = renderTranscriptBody([seg(0, 1, 'Hello.', 'me')], {}, { defaultNames: { me: 'Me' } });
    const note = renderTranscriptNote(
      {
        title: 'Weekly sync',
        date: '2026-09-05T14:02:11+02:00',
        durationSecs: 4503,
        language: 'sv',
        model: 'large-v3-turbo-q5_0',
        source: 'both',
        speakers: ['Me', 'Others'],
      },
      body,
    );
    const { frontmatter, content } = parseFrontmatter(note);
    expect(frontmatter).toEqual({
      type: 'meeting-transcript',
      title: 'Weekly sync',
      date: '2026-09-05T14:02:11+02:00',
      duration: '1:15:03',
      language: 'sv',
      model: 'large-v3-turbo-q5_0',
      source: 'both',
      speakers: ['Me', 'Others'],
    });
    expect(frontmatter).not.toHaveProperty('segments');
    expect(content).toBe('# Weekly sync\n\n**Me** [00:00:00] Hello.\n');
  });

  it('an hour of segments costs a few hundred bytes of frontmatter, not hundreds of kilobytes', () => {
    const segments: Segment[] = [];
    for (let t = 0; t < 3600; t += 4) segments.push(seg(t, t + 4, 'Some words that were said here.'));
    const note = renderTranscriptNote({ title: 'Long', durationSecs: 3600, language: 'en' }, renderTranscriptBody(segments));
    const frontmatterBytes = note.indexOf('\n---\n', 4) + 5;
    expect(frontmatterBytes).toBeLessThan(200);
  });
});

describe('hashTranscript', () => {
  const note = '---\ntype: meeting-transcript\ntitle: A\n---\n\n# A\n\n**Me** [00:00:01] Hello there.\n';

  it('is stable, and changes when the words change', () => {
    expect(hashTranscript(note)).toBe(hashTranscript(note));
    expect(hashTranscript(note)).not.toBe(hashTranscript(note.replace('Hello', 'Hallo')));
  });

  it('ignores what opening and saving a note in the editor does to it', () => {
    // A document id added to the frontmatter, brackets escaped, CRLF, trailing blank lines.
    const saved = '---\ntype: meeting-transcript\ntitle: A\nid: 3f2a\n---\n\n# A\r\n\r\n**Me** \\[00:00:01\\] Hello there.\n\n\n';
    expect(hashTranscript(saved)).toBe(hashTranscript(note));
  });
});

describe('replaceSpeakerNameInText', () => {
  const text = [
    '# Meeting',
    '',
    '**Anna** [00:00:01] I asked Anna about it, and **Anna** agreed.',
    '',
    '**Peter** [00:00:09] Anna said so.',
    '',
    '**Anna** \\[00:00:15\\] Yes.',
    '',
  ].join('\n');

  it('renames only at the start of turns, in either bracket spelling', () => {
    const { text: out, count } = replaceSpeakerNameInText(text, 'Anna', 'Anna Svensson');
    expect(count).toBe(2);
    expect(out).toContain('**Anna Svensson** [00:00:01] I asked Anna about it, and **Anna** agreed.');
    expect(out).toContain('**Peter** [00:00:09] Anna said so.');
    expect(out).toContain('**Anna Svensson** \\[00:00:15\\] Yes.');
  });

  it('treats the old name literally and changes nothing when there is nothing to do', () => {
    expect(replaceSpeakerNameInText('**A.B** [00:00:01] x\n**AxB** [00:00:02] y\n', 'A.B', 'C').text).toBe(
      '**C** [00:00:01] x\n**AxB** [00:00:02] y\n',
    );
    expect(replaceSpeakerNameInText(text, 'Anna', 'Anna')).toEqual({ text, count: 0 });
    expect(replaceSpeakerNameInText(text, 'Nobody', 'X').count).toBe(0);
  });
});

describe('transcript file names (U21)', () => {
  it('sanitizes a title into a file stem', () => {
    expect(sanitizeFileStem('Weekly sync: Q3 / planning?')).toBe('Weekly sync Q3 planning');
    expect(sanitizeFileStem('  ..hidden  ')).toBe('hidden');
    expect(sanitizeFileStem('Möte med Åsa')).toBe('Möte med Åsa');
    expect(sanitizeFileStem('///')).toBe('Transcript');
    expect(sanitizeFileStem('x'.repeat(300)).length).toBe(120);
  });

  it('picks a free name, counting from (2), ignoring case, never a reserved file', () => {
    expect(freeTranscriptFileName('Weekly sync', ['audio.m4a', 'recording.json'])).toBe('Weekly sync.md');
    expect(freeTranscriptFileName('Weekly sync', ['weekly SYNC.md'])).toBe('Weekly sync (2).md');
    expect(freeTranscriptFileName('Weekly sync', ['Weekly sync.md', 'Weekly sync (2).md'])).toBe('Weekly sync (3).md');
    expect(freeTranscriptFileName('transcript', ['transcript.md'])).toBe('transcript (2).md');
  });
});
