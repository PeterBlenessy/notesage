import { describe, it, expect } from 'vitest';
import { computeExternalDiff } from '@/lib/external-diff';

describe('computeExternalDiff', () => {
  // ── 1. Identical strings ──────────────────────────────────────────────

  it('returns empty array for identical strings', () => {
    const hunks = computeExternalDiff('Hello world', 'Hello world');
    expect(hunks).toEqual([]);
  });

  // ── 2. Single word change ─────────────────────────────────────────────

  it('returns one hunk for a single word replacement', () => {
    const hunks = computeExternalDiff('The cat sat', 'The dog sat');
    expect(hunks).toHaveLength(1);

    const hunk = hunks[0];
    expect(hunk.id).toBe('ext-hunk-0');
    expect(hunk.deleteText).toBe('cat');
    expect(hunk.insertText).toBe('dog');
    // charFrom/charTo must span "cat" in the old text "The cat sat"
    expect(hunk.charFrom).toBe(4);
    expect(hunk.charTo).toBe(7); // exclusive end
  });

  // ── 3. Pure insertion (text added at end) ─────────────────────────────

  it('returns hunk with empty deleteText for a pure insertion at end', () => {
    const hunks = computeExternalDiff('Hello', 'Hello world');
    expect(hunks).toHaveLength(1);

    const hunk = hunks[0];
    expect(hunk.deleteText).toBe('');
    expect(hunk.insertText).toContain('world');
    // For a pure insertion, charFrom === charTo (zero-width range in old text)
    expect(hunk.charFrom).toBe(hunk.charTo);
  });

  // ── 4. Pure deletion (text removed) ───────────────────────────────────

  it('returns hunk with empty insertText for a pure deletion', () => {
    const hunks = computeExternalDiff('Hello world', 'Hello');
    expect(hunks).toHaveLength(1);

    const hunk = hunks[0];
    expect(hunk.insertText).toBe('');
    expect(hunk.deleteText).toContain('world');
    // charTo should be greater than charFrom (covering the deleted text)
    expect(hunk.charTo).toBeGreaterThan(hunk.charFrom);
  });

  // ── 5. Multiple scattered changes ────────────────────────────────────

  it('returns multiple hunks in document order for scattered changes', () => {
    const oldText = 'The quick brown fox jumps over the lazy dog';
    const newText = 'The slow brown cat jumps over the happy dog';

    const hunks = computeExternalDiff(oldText, newText);
    expect(hunks.length).toBeGreaterThanOrEqual(2);

    // Hunks must be in ascending charFrom order
    for (let i = 1; i < hunks.length; i++) {
      expect(hunks[i].charFrom).toBeGreaterThanOrEqual(hunks[i - 1].charTo);
    }

    // Check that "quick" -> "slow" is captured
    const quickHunk = hunks.find((h) => h.deleteText.includes('quick'));
    expect(quickHunk).toBeDefined();
    expect(quickHunk!.insertText).toContain('slow');

    // Check that "fox" -> "cat" is captured
    const foxHunk = hunks.find((h) => h.deleteText.includes('fox'));
    expect(foxHunk).toBeDefined();
    expect(foxHunk!.insertText).toContain('cat');

    // Check that the lazy/happy change is captured
    // Note: diff-match-patch semantic cleanup may split "lazy"->"happy" as "laz"->"happ"
    // (keeping the shared "y" suffix as an equal segment), so we check for partial match
    const lazyHunk = hunks.find((h) => h.deleteText.includes('laz'));
    expect(lazyHunk).toBeDefined();
    expect(lazyHunk!.insertText).toContain('happ');

    // IDs should be sequential
    hunks.forEach((hunk, idx) => {
      expect(hunk.id).toBe(`ext-hunk-${idx}`);
    });
  });

  // ── 6. Empty old string ───────────────────────────────────────────────

  it('returns a pure insertion hunk when old string is empty', () => {
    const hunks = computeExternalDiff('', 'Hello world');
    expect(hunks).toHaveLength(1);

    const hunk = hunks[0];
    expect(hunk.charFrom).toBe(0);
    expect(hunk.charTo).toBe(0);
    expect(hunk.deleteText).toBe('');
    expect(hunk.insertText).toBe('Hello world');
  });

  // ── 7. Empty new string ───────────────────────────────────────────────

  it('returns a pure deletion hunk when new string is empty', () => {
    const hunks = computeExternalDiff('Hello world', '');
    expect(hunks).toHaveLength(1);

    const hunk = hunks[0];
    expect(hunk.charFrom).toBe(0);
    expect(hunk.charTo).toBe(11);
    expect(hunk.deleteText).toBe('Hello world');
    expect(hunk.insertText).toBe('');
  });

  // ── 8. Both empty ────────────────────────────────────────────────────

  it('returns empty array when both strings are empty', () => {
    const hunks = computeExternalDiff('', '');
    expect(hunks).toEqual([]);
  });

  // ── 9. Whitespace-only changes ────────────────────────────────────────

  it('detects an extra space added between words', () => {
    const hunks = computeExternalDiff('Hello world', 'Hello  world');
    expect(hunks.length).toBeGreaterThanOrEqual(1);

    // The change should involve a space character
    const allInserted = hunks.map((h) => h.insertText).join('');
    const allDeleted = hunks.map((h) => h.deleteText).join('');
    // Applying the diff: removing deleted text and inserting inserted text should yield the new string
    expect(allInserted.length).toBeGreaterThan(allDeleted.length);
  });

  it('detects trailing whitespace addition', () => {
    const hunks = computeExternalDiff('Hello', 'Hello   ');
    expect(hunks.length).toBeGreaterThanOrEqual(1);

    const hunk = hunks[0];
    expect(hunk.deleteText).toBe('');
    expect(hunk.insertText).toBe('   ');
    expect(hunk.charFrom).toBe(5);
    expect(hunk.charTo).toBe(5);
  });

  // ── 10. Multi-line text changes ───────────────────────────────────────

  it('handles multi-line text with a changed line', () => {
    const oldText = 'Line one\nLine two\nLine three';
    const newText = 'Line one\nLine TWO\nLine three';

    const hunks = computeExternalDiff(oldText, newText);
    expect(hunks.length).toBeGreaterThanOrEqual(1);

    const hunk = hunks.find((h) => h.deleteText.includes('two'));
    expect(hunk).toBeDefined();
    expect(hunk!.insertText).toContain('TWO');

    // charFrom should point somewhere in the second line
    expect(hunk!.charFrom).toBeGreaterThanOrEqual('Line one\n'.length);
    expect(hunk!.charTo).toBeLessThanOrEqual('Line one\nLine two'.length);
  });

  it('handles inserting a new line in the middle', () => {
    const oldText = 'Line one\nLine three';
    const newText = 'Line one\nLine two\nLine three';

    const hunks = computeExternalDiff(oldText, newText);
    expect(hunks.length).toBeGreaterThanOrEqual(1);

    // The inserted text should contain "Line two\n" or "\nLine two"
    const allInserted = hunks.map((h) => h.insertText).join('');
    expect(allInserted).toContain('Line two');
  });

  it('handles removing a line from the middle', () => {
    const oldText = 'Line one\nLine two\nLine three';
    const newText = 'Line one\nLine three';

    const hunks = computeExternalDiff(oldText, newText);
    expect(hunks.length).toBeGreaterThanOrEqual(1);

    // The deleted text should contain "Line two"
    const allDeleted = hunks.map((h) => h.deleteText).join('');
    expect(allDeleted).toContain('Line two');
  });

  // ── Additional edge cases ─────────────────────────────────────────────

  it('produces consistent charFrom/charTo offsets relative to old text', () => {
    const oldText = 'ABCDEFGHIJ';
    const newText = 'ABxxEFGHIJ';

    const hunks = computeExternalDiff(oldText, newText);
    expect(hunks).toHaveLength(1);

    const hunk = hunks[0];
    expect(hunk.charFrom).toBe(2);
    expect(hunk.charTo).toBe(4);
    expect(hunk.deleteText).toBe('CD');
    expect(hunk.insertText).toBe('xx');

    // Verify: old text from charFrom to charTo equals deleteText
    expect(oldText.slice(hunk.charFrom, hunk.charTo)).toBe(hunk.deleteText);
  });

  it('verifies that old text slices match deleteText for all hunks', () => {
    const oldText = 'The quick brown fox jumps over the lazy dog';
    const newText = 'The slow brown cat leaps over a happy dog';

    const hunks = computeExternalDiff(oldText, newText);

    for (const hunk of hunks) {
      expect(oldText.slice(hunk.charFrom, hunk.charTo)).toBe(hunk.deleteText);
    }
  });

  it('assigns sequential IDs starting from ext-hunk-0', () => {
    const hunks = computeExternalDiff('aaa bbb ccc', 'xxx bbb yyy');

    hunks.forEach((hunk, idx) => {
      expect(hunk.id).toBe(`ext-hunk-${idx}`);
    });
  });

  it('handles single character change', () => {
    const hunks = computeExternalDiff('a', 'b');
    expect(hunks).toHaveLength(1);

    const hunk = hunks[0];
    expect(hunk.charFrom).toBe(0);
    expect(hunk.charTo).toBe(1);
    expect(hunk.deleteText).toBe('a');
    expect(hunk.insertText).toBe('b');
  });
});
