import { describe, it, expect } from 'vitest';
import type { TranscriptSegment } from '@/lib/tauri';
import { parseFrontmatter } from '@/lib/frontmatter';
import {
  renderTranscript,
  groupSegmentsIntoParagraphs,
  parseTranscriptSegments,
  TRANSCRIPT_NOTE_TYPE,
} from '@/lib/transcription/render-transcript';

function seg(
  start: number,
  end: number,
  text: string,
  speakerId: string | null = null,
): TranscriptSegment {
  return { start, end, text, speaker_id: speakerId, speaker_name: null };
}

describe('groupSegmentsIntoParagraphs', () => {
  it('merges consecutive close segments into one paragraph', () => {
    const segments = [
      seg(0, 1, 'Hello there.'),
      seg(1, 2, 'How are you?'),
      seg(2, 3, 'Doing fine.'),
    ];
    expect(groupSegmentsIntoParagraphs(segments)).toEqual([
      'Hello there. How are you? Doing fine.',
    ]);
  });

  it('starts a new paragraph after a long silent gap', () => {
    const segments = [
      seg(0, 1, 'First thought.'),
      // gap of 5s (1 → 6) exceeds the 2s default
      seg(6, 7, 'Second thought.'),
    ];
    expect(groupSegmentsIntoParagraphs(segments)).toEqual([
      'First thought.',
      'Second thought.',
    ]);
  });

  it('starts a new paragraph when the speaker changes', () => {
    const segments = [
      seg(0, 1, 'Alice speaking.', 'spk-1'),
      seg(1, 2, 'Bob speaking.', 'spk-2'),
    ];
    expect(groupSegmentsIntoParagraphs(segments)).toEqual([
      'Alice speaking.',
      'Bob speaking.',
    ]);
  });

  it('trims segment text and drops blank segments', () => {
    const segments = [
      seg(0, 1, '  padded  '),
      seg(1, 2, '   '),
      seg(2, 3, 'kept'),
    ];
    expect(groupSegmentsIntoParagraphs(segments)).toEqual(['padded kept']);
  });

  it('honours a custom paragraph gap', () => {
    const segments = [seg(0, 1, 'A'), seg(2, 3, 'B')];
    // gap is 1s — splits at 0.5 threshold, merges at 2s default
    expect(groupSegmentsIntoParagraphs(segments, 0.5)).toEqual(['A', 'B']);
    expect(groupSegmentsIntoParagraphs(segments, 2)).toEqual(['A B']);
  });

  it('returns an empty array for no segments', () => {
    expect(groupSegmentsIntoParagraphs([])).toEqual([]);
  });
});

describe('renderTranscript', () => {
  it('produces deterministic markdown with frontmatter, heading and paragraphs', () => {
    const segments = [
      seg(0, 1, 'Welcome to the meeting.'),
      seg(1, 2, 'Let us begin.'),
      seg(10, 11, 'Different topic now.'),
    ];
    const md = renderTranscript(segments, {
      title: 'Standup',
      durationSecs: 11,
      language: 'en',
    });

    // Deterministic — same input gives the same output.
    expect(renderTranscript(segments, { title: 'Standup', durationSecs: 11, language: 'en' })).toBe(md);

    // Body has the heading and TWO paragraphs (gap split at 2→10).
    expect(md).toContain('# Standup');
    expect(md).toContain('Welcome to the meeting. Let us begin.');
    expect(md).toContain('Different topic now.');

    // No timestamps leak into the body (v1 rule).
    const { content } = parseFrontmatter(md);
    expect(content).not.toMatch(/\d{2}:\d{2}/);
    expect(content).not.toContain('start');
  });

  it('writes the segment metadata and type into frontmatter', () => {
    const segments = [seg(0, 1.5, 'Body text only.')];
    const md = renderTranscript(segments, { title: 'Note', durationSecs: 1.5, language: 'sv' });

    const { frontmatter } = parseFrontmatter(md);
    expect(frontmatter?.type).toBe(TRANSCRIPT_NOTE_TYPE);
    expect(frontmatter?.title).toBe('Note');
    expect(frontmatter?.duration_secs).toBe(1.5);
    expect(frontmatter?.language).toBe('sv');
    expect(Array.isArray(frontmatter?.segments)).toBe(true);
  });

  it('renders heading-only body when there are no usable segments', () => {
    const md = renderTranscript([], { title: 'Empty Meeting' });
    const { content } = parseFrontmatter(md);
    expect(content.trim()).toBe('# Empty Meeting');
  });

  it('omits optional frontmatter keys when not provided', () => {
    const md = renderTranscript([seg(0, 1, 'hi')], { title: 'X' });
    const { frontmatter } = parseFrontmatter(md);
    expect(frontmatter?.duration_secs).toBeUndefined();
    expect(frontmatter?.language).toBeUndefined();
  });
});

describe('frontmatter round-trip', () => {
  it('parses the rendered frontmatter back to the original segments (v1, null speakers)', () => {
    const segments = [
      seg(0, 1, 'One.'),
      seg(1.2, 2.4, 'Two.'),
      seg(5, 6, 'Three.'),
    ];
    const md = renderTranscript(segments, { title: 'RT', durationSecs: 6, language: 'en' });
    const recovered = parseTranscriptSegments(md);
    expect(recovered).toEqual(segments);
  });

  it('round-trips named/diarized segments (future-proofing)', () => {
    const segments: TranscriptSegment[] = [
      { start: 0, end: 1, text: 'Hi', speaker_id: 'spk-1', speaker_name: 'Alice' },
      { start: 1, end: 2, text: 'Hello', speaker_id: 'spk-2', speaker_name: 'Bob' },
    ];
    const md = renderTranscript(segments, { title: 'Diarized' });
    expect(parseTranscriptSegments(md)).toEqual(segments);
  });

  it('returns an empty array for notes with no frontmatter', () => {
    expect(parseTranscriptSegments('# Just a heading\n\nSome text.')).toEqual([]);
  });

  it('skips malformed segment entries during parse', () => {
    const md = [
      '---',
      'type: meeting-transcript',
      'segments:',
      '  - start: 0',
      '    end: 1',
      '    text: good',
      '    speaker_id: null',
      '    speaker_name: null',
      '  - start: not-a-number',
      '    end: 2',
      '    text: bad',
      '---',
      '',
      '# Note',
      '',
    ].join('\n');
    expect(parseTranscriptSegments(md)).toEqual([seg(0, 1, 'good')]);
  });
});
