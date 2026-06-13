import { describe, it, expect } from 'vitest';
import {
  serializeRefineComment,
  parseRefineComment,
  stripRefineComment,
  isLineRefined,
} from '../refine-comment';
import { REFINEMENT_VERDICTS, type RefinementResult } from '../refinement';

function makeResult(overrides: Partial<RefinementResult> = {}): RefinementResult {
  return {
    verdict: 'sharpen',
    outcome: 'Email Bob the Q3 numbers by Friday',
    steps: [],
    rationale: 'Added owner and deadline',
    ...overrides,
  };
}

describe('serialize → parse round-trip', () => {
  it('is lossless for every verdict', () => {
    for (const verdict of REFINEMENT_VERDICTS) {
      const result = makeResult({
        verdict,
        outcome: verdict === 'keep' ? '' : `outcome for ${verdict}`,
        steps:
          verdict === 'split'
            ? [{ text: 'first step' }, { text: 'second step' }]
            : [],
        rationale: `rationale for ${verdict}`,
      });
      const comment = serializeRefineComment(result, 'hash-' + verdict, 'pending');
      const parsed = parseRefineComment(comment);
      expect(parsed).not.toBeNull();
      expect(parsed?.result).toEqual(result);
      expect(parsed?.srcHash).toBe('hash-' + verdict);
      expect(parsed?.status).toBe('pending');
    }
  });

  it('preserves all three statuses', () => {
    for (const status of ['pending', 'applied', 'dismissed'] as const) {
      const comment = serializeRefineComment(makeResult(), 'h', status);
      expect(parseRefineComment(comment)?.status).toBe(status);
    }
  });

  it('defaults status to pending when omitted', () => {
    const comment = serializeRefineComment(makeResult(), 'h');
    expect(parseRefineComment(comment)?.status).toBe('pending');
  });

  it('survives outcomes/rationale containing comment-terminator and quotes', () => {
    const result = makeResult({
      outcome: 'close the loop --> then "ship it" and \'wrap\' <!-- nested -->',
      rationale: 'because --> -->',
    });
    const comment = serializeRefineComment(result, 'h', 'applied');
    // The serialized comment must not contain a stray terminator inside the payload.
    expect(comment.match(/-->/g)?.length).toBe(1);
    const parsed = parseRefineComment(comment);
    expect(parsed?.result).toEqual(result);
    expect(parsed?.status).toBe('applied');
  });

  it('survives emoji and non-ASCII content', () => {
    const result = makeResult({
      outcome: '🚀 Skicka rapporten — café résumé 日本語 ☕',
      rationale: 'Ångström — naïve façade 你好',
      steps: [{ text: 'étape un 🎯' }],
    });
    const comment = serializeRefineComment(result, 'hꙮash', 'dismissed');
    const parsed = parseRefineComment(comment);
    expect(parsed?.result).toEqual(result);
  });

  it('survives newlines folded into the outcome as spaces', () => {
    const result = makeResult({
      outcome: 'line one\nline two\ttabbed',
      rationale: 'multi\nline\nrationale',
    });
    const comment = serializeRefineComment(result, 'h');
    // Comment is single-line (base64 has no newlines).
    expect(comment.includes('\n')).toBe(false);
    expect(parseRefineComment(comment)?.result).toEqual(result);
  });

  it('parses a comment embedded mid-line after real content', () => {
    const comment = serializeRefineComment(makeResult(), 'abc');
    const line = `- [ ] Do the thing ${comment}`;
    const parsed = parseRefineComment(line);
    expect(parsed?.srcHash).toBe('abc');
  });
});

describe('parseRefineComment returns null on bad input', () => {
  it('returns null for a line with no comment', () => {
    expect(parseRefineComment('just some plain text')).toBeNull();
    expect(parseRefineComment('')).toBeNull();
  });

  it('returns null for a different/wrong marker', () => {
    expect(parseRefineComment('<!-- ns-refine:v2 YWJj -->')).toBeNull();
    expect(parseRefineComment('<!-- other-marker YWJj -->')).toBeNull();
    expect(parseRefineComment('<!-- type:currency,summary:sum -->')).toBeNull();
  });

  it('returns null for garbage / non-base64 payload', () => {
    // `@@@` is not base64 charset → regex never matches.
    expect(parseRefineComment('<!-- ns-refine:v1 @@@not base64@@@ -->')).toBeNull();
  });

  it('returns null for truncated/corrupt base64 that is valid charset but not valid JSON', () => {
    // Valid base64 charset, decodes to garbage bytes / invalid JSON.
    expect(parseRefineComment('<!-- ns-refine:v1 Zm9vYmFy -->')).toBeNull();
  });

  it('returns null when payload version is wrong', () => {
    const badVersion = btoa(
      JSON.stringify({ v: 2, src: 'h', status: 'pending', result: makeResult() }),
    );
    expect(parseRefineComment(`<!-- ns-refine:v1 ${badVersion} -->`)).toBeNull();
  });

  it('returns null when the embedded result fails the shape guard', () => {
    const badResult = btoa(
      JSON.stringify({ v: 1, src: 'h', status: 'pending', result: { verdict: 'nonsense' } }),
    );
    expect(parseRefineComment(`<!-- ns-refine:v1 ${badResult} -->`)).toBeNull();
  });

  it('returns null when the status is invalid', () => {
    const badStatus = btoa(
      JSON.stringify({ v: 1, src: 'h', status: 'bogus', result: makeResult() }),
    );
    expect(parseRefineComment(`<!-- ns-refine:v1 ${badStatus} -->`)).toBeNull();
  });

  it('returns null when src hash is missing', () => {
    const noSrc = btoa(JSON.stringify({ v: 1, status: 'pending', result: makeResult() }));
    expect(parseRefineComment(`<!-- ns-refine:v1 ${noSrc} -->`)).toBeNull();
  });
});

describe('stripRefineComment', () => {
  it('removes the comment and surrounding space', () => {
    const comment = serializeRefineComment(makeResult(), 'h');
    const line = `- [ ] Do the thing ${comment}`;
    expect(stripRefineComment(line)).toBe('- [ ] Do the thing');
  });

  it('leaves plain lines untouched', () => {
    expect(stripRefineComment('- [ ] plain task')).toBe('- [ ] plain task');
    expect(stripRefineComment('')).toBe('');
  });

  it('does not remove unrelated HTML comments', () => {
    const line = '| Header | <!-- type:currency,summary:sum -->';
    expect(stripRefineComment(line)).toBe(line);
  });

  it('round-trips: strip(serialize-appended line) yields the original prefix', () => {
    const prefix = '- [ ] Ship the release';
    const comment = serializeRefineComment(makeResult({ verdict: 'keep', outcome: '' }), 'h');
    expect(stripRefineComment(`${prefix} ${comment}`)).toBe(prefix);
  });
});

describe('isLineRefined', () => {
  it('is true when the stored hash matches the current hash', () => {
    const comment = serializeRefineComment(makeResult(), 'hash-123');
    const line = `- [ ] task ${comment}`;
    expect(isLineRefined(line, 'hash-123')).toBe(true);
  });

  it('is false when the hash has diverged (line edited)', () => {
    const comment = serializeRefineComment(makeResult(), 'hash-123');
    const line = `- [ ] task ${comment}`;
    expect(isLineRefined(line, 'hash-999')).toBe(false);
  });

  it('is false when there is no comment', () => {
    expect(isLineRefined('- [ ] plain task', 'anything')).toBe(false);
  });

  it('is false when the comment is corrupt', () => {
    expect(isLineRefined('<!-- ns-refine:v1 Zm9vYmFy -->', 'anything')).toBe(false);
  });
});
