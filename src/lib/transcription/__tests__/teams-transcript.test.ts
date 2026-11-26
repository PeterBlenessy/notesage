import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_CUE_SECS,
  assignSpeakers,
  cueSpeakers,
  cuesToSegments,
  decodeEntities,
  estimateOffset,
  normaliseTokens,
  parseTeamsDocxText,
  parseTeamsVtt,
  parseTimestamp,
  previewAlignment,
  type Cue,
} from '@/lib/transcription/teams-transcript';
import { parseSegmentsFile, type Segment } from '@/lib/transcription/segments';

const FIXTURES = join(__dirname, 'fixtures');
const VTT = readFileSync(join(FIXTURES, 'teams-meeting.vtt'), 'utf8');
const OURS = parseSegmentsFile(readFileSync(join(FIXTURES, 'teams-meeting.segments.json'), 'utf8'))!;

const cue = (start: number, end: number, speaker: string | null, text: string): Cue => ({ start, end, speaker, text });
const seg = (start: number, end: number, text: string, speaker?: string): Segment =>
  speaker ? { start, end, text, speaker } : { start, end, text };

// ── parseTimestamp ──────────────────────────────────────────────────────────

describe('parseTimestamp', () => {
  it('reads hours present or absent, and both millisecond separators', () => {
    expect(parseTimestamp('00:00:23.120')).toBeCloseTo(23.12);
    expect(parseTimestamp('01:02:03.500')).toBeCloseTo(3723.5);
    expect(parseTimestamp('02:03,500')).toBeCloseTo(123.5);
    expect(parseTimestamp('2:03')).toBe(123);
    // Teams' Word export writes unpadded fields.
    expect(parseTimestamp('0:0:3.53')).toBeCloseTo(3.53);
    expect(parseTimestamp('0:1:5.7')).toBeCloseTo(65.7);
  });
  it('is null for anything else', () => {
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('soon')).toBeNull();
    expect(parseTimestamp('12')).toBeNull();
    expect(parseTimestamp('00:00:01 extra')).toBeNull();
  });
});

describe('decodeEntities', () => {
  it('decodes the named and numeric entities WebVTT uses, and leaves unknown ones alone', () => {
    expect(decodeEntities('R&amp;D &lt;3 &gt; &quot;x&quot; &#39;y&#39; &#xE5;&nbsp;z')).toBe('R&D <3 > "x" \'y\' å z');
    expect(decodeEntities('&unknown; &#0; &#x110000; & alone')).toBe('&unknown; &#0; &#x110000; & alone');
  });
});

// ── parseTeamsVtt ───────────────────────────────────────────────────────────

describe('parseTeamsVtt', () => {
  it('reads the hand-written Teams fixture: cue ids, NOTE block, multi-line cue, voices, an entity', () => {
    const cues = parseTeamsVtt(VTT);
    expect(cues).toHaveLength(18);
    expect(cueSpeakers(cues)).toEqual(['Anna Svensson', 'Peter Lindberg', 'James Carter']);
    expect(cues[0]).toEqual({
      start: 23.12,
      end: 27.48,
      speaker: 'Anna Svensson',
      // Two payload lines become one line of text.
      text: 'Okej, då har jag startat transkriberingen också.',
    });
    expect(cues[17].text).toBe('Perfekt. Då sammanfattar jag besluten & skickar ut dem efter mötet.');
    // No cue id, NOTE text or tag leaked into any text.
    for (const c of cues) expect(c.text).not.toMatch(/3f0e6c1a|NOTE|<|>/);
  });

  it('accepts timestamps without hours, comma separators, cue settings and CRLF', () => {
    const cues = parseTeamsVtt(
      'WEBVTT - some title\r\n\r\n1\r\n00:01,500 --> 00:04,000 align:start position:10%\r\n<v Ann>Hello</v>\r\n\r\n00:05.000 --> 00:06.000\r\n<v Bo>Hi</v>\r\n',
    );
    expect(cues).toEqual([cue(1.5, 4, 'Ann', 'Hello'), cue(5, 6, 'Bo', 'Hi')]);
  });

  it('reads cues with no blank line between them, and does not mistake a cue id for text', () => {
    const cues = parseTeamsVtt(
      'WEBVTT\n\nid-1\n00:00:01.000 --> 00:00:02.000\n<v A>one</v>\nid-2\n00:00:03.000 --> 00:00:04.000\n<v B>two</v>\n',
    );
    expect(cues).toEqual([cue(1, 2, 'A', 'one'), cue(3, 4, 'B', 'two')]);
  });

  it('splits a cue with several voices, and handles an unclosed voice tag and voice classes', () => {
    const cues = parseTeamsVtt(
      'WEBVTT\n\n00:00:01.000 --> 00:00:05.000\n<v Anna>Shall we?</v> <v.loud Bo Ek>Yes!\n\n00:00:06.000 --> 00:00:07.000\n<v Anna>Good.\n',
    );
    expect(cues).toEqual([cue(1, 5, 'Anna', 'Shall we?'), cue(1, 5, 'Bo Ek', 'Yes!'), cue(6, 7, 'Anna', 'Good.')]);
  });

  it('keeps cues without voice tags, with no speaker', () => {
    const cues = parseTeamsVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nPlain subtitle text\n');
    expect(cues).toEqual([cue(1, 2, null, 'Plain subtitle text')]);
    expect(cueSpeakers(cues)).toEqual([]);
  });

  it('strips inline tags and decodes entities in text and names', () => {
    const cues = parseTeamsVtt(
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v O&#39;Brien &amp; Co>That is <i>very</i> <c.yellow>R&amp;D</c> &lt;script&gt;alert(1)&lt;/script&gt;</v>\n',
    );
    expect(cues).toEqual([cue(1, 2, "O'Brien & Co", 'That is very R&D <script>alert(1)</script>')]);
  });

  it('skips NOTE, STYLE and REGION blocks wherever they are', () => {
    const cues = parseTeamsVtt(
      'WEBVTT\n\nSTYLE\n::cue { color: red }\n\nNOTE one line\n\n00:00:01.000 --> 00:00:02.000\n<v A>x</v>\n\nNOTE\nmulti\n00:00:09.000 --> 00:00:10.000\nnot a cue\n\nREGION\nid:r\n',
    );
    expect(cues).toEqual([cue(1, 2, 'A', 'x')]);
  });

  describe('adversarial input', () => {
    it('gives [] for an empty file, whitespace, a header only, or something that is not VTT', () => {
      expect(parseTeamsVtt('')).toEqual([]);
      expect(parseTeamsVtt('   \n\n  ')).toEqual([]);
      expect(parseTeamsVtt('WEBVTT\n')).toEqual([]);
      expect(parseTeamsVtt('{"json": true}')).toEqual([]);
      expect(parseTeamsVtt('PK\u0003\u0004\u0000\u0000binary\u0000docx')).toEqual([]);
    });

    it('drops cues with unreadable or absurd timestamps and repairs the ones it can', () => {
      const cues = parseTeamsVtt(
        [
          'WEBVTT',
          '',
          '99:99:99.999 --> 99:99:99.999',
          '<v A>beyond any meeting</v>',
          '',
          'aa:bb --> cc:dd',
          '<v A>not a time</v>',
          '',
          '00:00:10.000 --> 00:00:05.000',
          '<v A>end before start</v>',
          '',
          '00:00:20.000 --> 05:00:00.000',
          '<v A>five-hour cue</v>',
          '',
          '00:00:30.000 --> 00:00:31.000',
          '',
          '00:00:40.000 --> 00:00:41.000',
          '<v A></v>',
        ].join('\n'),
      );
      expect(cues).toEqual([cue(10, 10, 'A', 'end before start'), cue(20, 20 + MAX_CUE_SECS, 'A', 'five-hour cue')]);
    });

    it('sorts out-of-order and overlapping cues by start, keeping both', () => {
      const cues = parseTeamsVtt(
        'WEBVTT\n\n00:00:05.000 --> 00:00:09.000\n<v B>second</v>\n\n00:00:01.000 --> 00:00:07.000\n<v A>first</v>\n',
      );
      expect(cues.map((c) => c.text)).toEqual(['first', 'second']);
    });

    it('never throws on garbage', () => {
      const garbage = ['-->', '--> -->', '<v', '<v >', '00:00:01.000 -->', '\u0000\u0001', '<v A><v B><v C>', '&#xZZ;'];
      for (const g of garbage) expect(() => parseTeamsVtt(`WEBVTT\n\n${g}\n${g}\n\n${g}`)).not.toThrow();
    });
  });
});

describe('parseTeamsDocxText', () => {
  it('reads the arrow layout of Teams\' Word export', () => {
    const cues = parseTeamsDocxText(
      '0:0:0.0 --> 0:0:3.530\nAnna Svensson\nDå börjar vi.\n\n0:0:4.0 --> 0:0:9.120\nJames Carter\nSounds good.\nLet us start.\n',
    );
    expect(cues).toEqual([
      cue(0, 3.53, 'Anna Svensson', 'Då börjar vi.'),
      cue(4, 9.12, 'James Carter', 'Sounds good. Let us start.'),
    ]);
  });
  it('reads the name-and-time layout, ending each cue where the next begins', () => {
    const cues = parseTeamsDocxText('Anna Svensson   0:03\nDå börjar vi.\n\nJames Carter\t0:09\nSounds good.\n');
    expect(cues).toEqual([cue(3, 9, 'Anna Svensson', 'Då börjar vi.'), cue(9, 14, 'James Carter', 'Sounds good.')]);
  });
  it('gives [] for ordinary prose', () => {
    expect(parseTeamsDocxText('Meeting notes\n\nWe talked about things.\n')).toEqual([]);
  });
});

// ── estimateOffset ──────────────────────────────────────────────────────────

describe('normaliseTokens', () => {
  it('folds case, punctuation and diacritics, for Swedish and English alike', () => {
    expect(normaliseTokens('Välkomna, allihopa — till VECKOMÖTET!')).toEqual(['valkomna', 'allihopa', 'till', 'veckomotet']);
    expect(normaliseTokens("It's 80% done; café.")).toEqual(['it', 's', '80', 'done', 'cafe']);
    expect(normaliseTokens('  ')).toEqual([]);
  });
});

describe('estimateOffset', () => {
  const cues = parseTeamsVtt(VTT);

  it('finds the 37-second offset of the fixture, with confidence', () => {
    const { offsetSecs, confidence } = estimateOffset(OURS, cues);
    expect(Math.abs(offsetSecs - 37)).toBeLessThanOrEqual(0.6);
    expect(confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('is to a tenth of a second', () => {
    const { offsetSecs } = estimateOffset(OURS, cues);
    expect(Math.round(offsetSecs * 10)).toBeCloseTo(offsetSecs * 10, 6);
  });

  it('finds a negative offset: our audio starts later than the Teams transcript (a trimmed import)', () => {
    const later = cues.map((c) => ({ ...c, start: c.start + 200, end: c.end + 200 }));
    const { offsetSecs, confidence } = estimateOffset(OURS, later);
    expect(Math.abs(offsetSecs - (37 - 200))).toBeLessThanOrEqual(0.6);
    expect(confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('finds zero when the two already line up', () => {
    const aligned = cues.map((c) => ({ ...c, start: c.start + 37, end: c.end + 37 }));
    expect(Math.abs(estimateOffset(OURS, aligned).offsetSecs)).toBeLessThanOrEqual(0.6);
  });

  it('has low confidence for two unrelated transcripts', () => {
    const other = [
      cue(0, 5, 'X', 'The quarterly budget review is postponed until further notice.'),
      cue(6, 11, 'Y', 'Please remember to water the plants in the lobby.'),
      cue(12, 18, 'X', 'Our new coffee machine arrives on Friday morning.'),
    ];
    expect(estimateOffset(OURS, other).confidence).toBeLessThan(0.3);
  });

  it('has low confidence when only a couple of words agree', () => {
    const thin = [cue(100, 104, 'X', 'Wednesday afternoon then.')];
    expect(estimateOffset(OURS, thin).confidence).toBeLessThan(0.5);
  });

  it('is { 0, 0 } when there is nothing to compare', () => {
    expect(estimateOffset([], cues)).toEqual({ offsetSecs: 0, confidence: 0 });
    expect(estimateOffset(OURS, [])).toEqual({ offsetSecs: 0, confidence: 0 });
    expect(estimateOffset([seg(0, 1, '...')], [cue(0, 1, null, '???')])).toEqual({ offsetSecs: 0, confidence: 0 });
  });

  it('ignores an offset outside the search range rather than inventing one', () => {
    const far = cues.map((c) => ({ ...c, start: c.start + 5000, end: c.end + 5000 }));
    expect(estimateOffset(OURS, far).confidence).toBe(0);
    expect(Math.abs(estimateOffset(OURS, far, { maxOffsetSecs: 6000 }).offsetSecs - (37 - 5000))).toBeLessThanOrEqual(0.6);
  });

  it('is not fooled by a phrase everyone keeps repeating', () => {
    // "okay thank you" forty times on both sides votes for every difference
    // between two occurrences; the one real sentence decides.
    const ours: Segment[] = [];
    const theirs: Cue[] = [];
    for (let i = 0; i < 40; i++) {
      ours.push(seg(i * 10, i * 10 + 3, 'Okay thank you.'));
      theirs.push(cue(i * 10 + 4, i * 10 + 7, 'A', 'Okay thank you.'));
    }
    const distinctive = [
      'Migration of the archive finished yesterday evening.',
      'Remaining spreadsheets crash the indexer every single time.',
      'Customer interviews keep mentioning search before export.',
      'Wednesday afternoon suits the whole delivery team.',
    ];
    distinctive.forEach((text, i) => {
      ours.push(seg(55 + i * 90, 60 + i * 90, text));
      theirs.push(cue(55 + i * 90 - 12, 60 + i * 90 - 12, 'B', text));
    });
    ours.sort((a, b) => a.start - b.start);
    theirs.sort((a, b) => a.start - b.start);
    expect(Math.abs(estimateOffset(ours, theirs).offsetSecs - 12)).toBeLessThanOrEqual(0.6);
  });

  describe('bounded work', () => {
    // A deterministic three-hour meeting: 2,700 cues of 4 seconds.
    function longMeeting(offset: number): { ours: Segment[]; cues: Cue[] } {
      let state = 12345;
      const next = () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state;
      };
      const vocabulary = Array.from({ length: 4000 }, (_, i) => `word${i.toString(36)}x`);
      const cues: Cue[] = [];
      const ours: Segment[] = [];
      for (let i = 0; i < 2700; i++) {
        const words = Array.from({ length: 9 }, () => vocabulary[next() % vocabulary.length]);
        cues.push(cue(i * 4, i * 4 + 3.6, `Speaker ${i % 5}`, words.join(' ')));
        ours.push(seg(i * 4 + offset, i * 4 + 3.6 + offset, words.join(' ')));
      }
      return { ours, cues };
    }

    it('aligns a three-hour transcript in well under a second', () => {
      const { ours, cues: long } = longMeeting(37);
      const started = performance.now();
      const { offsetSecs, confidence } = estimateOffset(ours, long);
      const ms = performance.now() - started;
      expect(Math.abs(offsetSecs - 37)).toBeLessThanOrEqual(0.2);
      expect(confidence).toBeGreaterThan(0.8);
      expect(ms).toBeLessThan(1000);
    });

    it('does not grow with a transcript far longer than any meeting', () => {
      const repeated: Cue[] = Array.from({ length: 60_000 }, (_, i) => cue(i, i + 1, 'A', 'the same words again and again'));
      const ours: Segment[] = Array.from({ length: 60_000 }, (_, i) => seg(i, i + 1, 'the same words again and again'));
      const started = performance.now();
      const result = estimateOffset(ours, repeated);
      expect(performance.now() - started).toBeLessThan(1500);
      // Nothing distinctive to align on: say so, do not guess.
      expect(result.confidence).toBe(0);
    });

    it('assigns speakers across three hours in linear time', () => {
      const { ours, cues: long } = longMeeting(37);
      const started = performance.now();
      const out = assignSpeakers(ours, long, 37);
      expect(performance.now() - started).toBeLessThan(1000);
      expect(out).toHaveLength(ours.length);
      expect(out[2699].speaker).toBe('Speaker 4');
    });
  });
});

// ── assignSpeakers ──────────────────────────────────────────────────────────

describe('assignSpeakers', () => {
  const cues = parseTeamsVtt(VTT);

  it('labels the fixture: no name for the minute before Teams listened, real names after', () => {
    const out = assignSpeakers(OURS, cues, 37);
    // The first seven segments were spoken before any cue.
    expect(out.slice(0, 7).every((s) => s.speaker === undefined)).toBe(true);
    const by = (needle: string) => out.find((s) => s.text.includes(needle))?.speaker;
    expect(by('startat transkriberingen')).toBe('Anna Svensson');
    expect(by('migreringen av biblioteket')).toBe('Peter Lindberg');
    expect(by('switch to English')).toBe('James Carter');
    expect(by('kundintervjuerna')).toBe('Anna Svensson');
    expect(by('Search first')).toBe('James Carter');
  });

  it('splits a segment that spans a change of speaker, at the sentence between them', () => {
    const out = assignSpeakers(OURS, cues, 37);
    const sure = out.find((s) => s.text.startsWith('Sure'))!;
    const great = out.find((s) => s.text.startsWith('Great'))!;
    expect(sure).toMatchObject({ speaker: 'Peter Lindberg', text: 'Sure, about 80 percent of the documents have been migrated.' });
    expect(great).toMatchObject({
      speaker: 'James Carter',
      text: 'Great, and the remaining 20 percent, is that blocked by the indexing bug?',
    });
    // The pieces tile the original segment in time.
    expect(sure.start).toBe(91);
    expect(sure.end).toBe(great.start);
    expect(great.end).toBe(102.8);
    expect(out).toHaveLength(OURS.length + 1);
  });

  it('never rewords or reorders our text', () => {
    const out = assignSpeakers(OURS, cues, 37);
    const join = (segments: readonly Segment[]) => segments.map((s) => s.text.trim()).join(' ');
    expect(join(out)).toBe(join(OURS));
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].start);
  });

  it('with a wrong offset the names land on the wrong lines, which is what the preview is for', () => {
    const wrong = assignSpeakers(OURS, cues, 0);
    // "Okej, vi väntar en liten stund till." was said before Teams was
    // listening, yet at offset 0 it is handed to whoever Teams heard then.
    const waiting = wrong.filter((s) => s.start >= 30 && s.end <= 38);
    expect(waiting.length).toBeGreaterThanOrEqual(1);
    expect(waiting.every((s) => s.speaker !== undefined)).toBe(true);
  });

  it('keeps a segment\'s previous label when no cue overlaps it', () => {
    const out = assignSpeakers([seg(0, 5, 'Before.', 'me'), seg(100, 105, 'During.', 'me')], [cue(100, 105, 'Anna', 'During.')], 0);
    expect(out.map((s) => s.speaker)).toEqual(['me', 'Anna']);
  });

  it('gives the whole segment to the majority speaker when no clean word boundary is near the change', () => {
    // The change falls in the middle of one long unbroken token.
    const text = `Yes ${'a'.repeat(120)} no`;
    const out = assignSpeakers([seg(0, 10, text)], [cue(0, 6, 'Anna', 'x'), cue(6, 10, 'Bo', 'y')], 0);
    expect(out).toEqual([seg(0, 10, text, 'Anna')]);
  });

  it('ignores a sliver of a neighbour\'s cue at the edge of a segment', () => {
    const out = assignSpeakers(
      [seg(10, 20, 'All of this was said by one person, start to finish.')],
      [cue(0, 10.3, 'Bo', 'earlier'), cue(10.3, 20, 'Anna', 'this')],
      0,
    );
    expect(out).toEqual([seg(10, 20, 'All of this was said by one person, start to finish.', 'Anna')]);
  });

  it('handles overlapping cues (two people at once) by who holds more of the segment', () => {
    const out = assignSpeakers([seg(0, 10, 'Talking over each other here.')], [cue(0, 9, 'Anna', 'a'), cue(2, 5, 'Bo', 'b')], 0);
    expect(out).toHaveLength(1);
    expect(out[0].speaker).toBe('Anna');
  });

  it('assigns nothing from cues that name no speaker', () => {
    const out = assignSpeakers([seg(0, 5, 'Hello.', 'me')], [cue(0, 5, null, 'Hello.')], 0);
    expect(out).toEqual([seg(0, 5, 'Hello.', 'me')]);
  });

  it('copes with empty inputs and zero-length segments', () => {
    expect(assignSpeakers([], cues, 37)).toEqual([]);
    expect(assignSpeakers(OURS, [], 37)).toEqual(OURS);
    expect(assignSpeakers([seg(5, 5, 'Blip.')], [cue(0, 10, 'Anna', 'x')], 0)).toEqual([seg(5, 5, 'Blip.')]);
  });
});

describe('cuesToSegments and previewAlignment', () => {
  const cues = parseTeamsVtt(VTT);

  it("turns Teams' own text into segments on our clock, clamped at zero", () => {
    const segments = cuesToSegments(cues, 37);
    expect(segments[0]).toEqual(seg(60.12, 64.48, 'Okej, då har jag startat transkriberingen också.', 'Anna Svensson'));
    expect(cuesToSegments([cue(5, 8, null, 'x')], -20)).toEqual([seg(0, 0, 'x')]);
  });

  it('pairs a few Teams lines with what we heard at the same moment', () => {
    const lines = previewAlignment(OURS, cues, 37, 3);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.speaker).not.toBeNull();
      // At the right offset the two sides share words.
      const ours = new Set(normaliseTokens(line.ours));
      expect(normaliseTokens(line.teams).filter((w) => ours.has(w)).length).toBeGreaterThanOrEqual(3);
    }
    // At a wrong offset they visibly do not.
    const wrong = previewAlignment(OURS, cues, 0, 3);
    const shared = wrong.map((line) => {
      const ours = new Set(normaliseTokens(line.ours));
      return normaliseTokens(line.teams).filter((w) => w.length > 3 && ours.has(w)).length;
    });
    expect(Math.max(...shared)).toBeLessThan(3);
    expect(previewAlignment(OURS, [], 37)).toEqual([]);
  });
});
