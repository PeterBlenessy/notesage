import { describe, it, expect } from 'vitest';
import {
  MODES,
  detectActivePrefix,
  type PrefixModeId,
} from '@/components/cmd/prefix-modes';

// ---------------------------------------------------------------------------
// MODES registry shape
// ---------------------------------------------------------------------------

describe('MODES registry', () => {
  const expected: Array<{ id: PrefixModeId; prefix: string }> = [
    { id: 'skill', prefix: '/' },
    { id: 'reference', prefix: '@' },
    { id: 'tag', prefix: '#' },
    { id: 'task', prefix: '!' },
    { id: 'research', prefix: '?' },
    { id: 'palette', prefix: '>' },
  ];

  for (const { id, prefix } of expected) {
    it(`registers the "${id}" mode for prefix "${prefix}"`, () => {
      const mode = MODES[id];
      expect(mode).toBeDefined();
      expect(mode.id).toBe(id);
      expect(mode.prefix).toBe(prefix);
      // Each mode carries the metadata needed by mode pickers (#14–#19).
      expect(typeof mode.label).toBe('string');
      expect(mode.label.length).toBeGreaterThan(0);
      expect(typeof mode.icon).toBe('string');
      expect(mode.icon.length).toBeGreaterThan(0);
      expect(typeof mode.description).toBe('string');
      expect(mode.description.length).toBeGreaterThan(0);
    });
  }

  it('exposes exactly the six expected modes — no extras', () => {
    expect(Object.keys(MODES).sort()).toEqual(
      ['palette', 'reference', 'research', 'skill', 'tag', 'task'].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// detectActivePrefix
// ---------------------------------------------------------------------------

describe('detectActivePrefix', () => {
  it('returns null for an empty input', () => {
    expect(detectActivePrefix('', 0)).toBeNull();
  });

  it('detects a bare prefix at start-of-input (skill)', () => {
    const result = detectActivePrefix('/', 1);
    expect(result).not.toBeNull();
    expect(result?.mode.id).toBe('skill');
    expect(result?.filter).toBe('');
    expect(result?.prefixIndex).toBe(0);
    expect(result?.tokenStart).toBe(0);
    expect(result?.tokenEnd).toBe(1);
  });

  it('detects a partial filter after the skill prefix at start-of-input', () => {
    const result = detectActivePrefix('/sk', 3);
    expect(result?.mode.id).toBe('skill');
    expect(result?.filter).toBe('sk');
    expect(result?.prefixIndex).toBe(0);
    expect(result?.tokenEnd).toBe(3);
  });

  it('detects a prefix preceded by whitespace ("hello /sk")', () => {
    // Indices: h(0) e(1) l(2) l(3) o(4) " "(5) /(6) s(7) k(8) — cursor at 9
    const input = 'hello /sk';
    const result = detectActivePrefix(input, 9);
    expect(result?.mode.id).toBe('skill');
    expect(result?.filter).toBe('sk');
    expect(result?.prefixIndex).toBe(6);
    expect(result?.tokenStart).toBe(6);
    expect(result?.tokenEnd).toBe(9);
  });

  it('returns null when the prefix is mid-word with no preceding whitespace ("hi/sk")', () => {
    const result = detectActivePrefix('hi/sk', 5);
    expect(result).toBeNull();
  });

  it('returns the active prefix when the cursor sits at the end of the prefix token', () => {
    // "/foo bar" cursor at 4 → just past "/foo"
    const result = detectActivePrefix('/foo bar', 4);
    expect(result?.mode.id).toBe('skill');
    expect(result?.filter).toBe('foo');
    expect(result?.tokenEnd).toBe(4);
  });

  it('returns null when the cursor is in a different (later) word', () => {
    // "/foo bar" cursor at 7 → inside "bar" — outside the "/foo" token
    const result = detectActivePrefix('/foo bar', 7);
    expect(result).toBeNull();
  });

  it('detects @reference mode (filter returns the full token text)', () => {
    // Cursor sits between "@u" and "ser" — the token is still "@user", so the
    // filter is the whole "user" string. Mode pickers can clip if they want
    // cursor-based filtering, but the token boundary is the source of truth.
    const result = detectActivePrefix('@user', 2);
    expect(result?.mode.id).toBe('reference');
    expect(result?.filter).toBe('user');
    expect(result?.tokenEnd).toBe(5);
  });

  it('detects #tag mode', () => {
    const result = detectActivePrefix('#tag', 4);
    expect(result?.mode.id).toBe('tag');
    expect(result?.filter).toBe('tag');
  });

  it('detects !task mode', () => {
    const result = detectActivePrefix('!task', 5);
    expect(result?.mode.id).toBe('task');
    expect(result?.filter).toBe('task');
  });

  it('detects ?research mode', () => {
    const result = detectActivePrefix('?research', 9);
    expect(result?.mode.id).toBe('research');
    expect(result?.filter).toBe('research');
  });

  it('detects >palette mode', () => {
    const result = detectActivePrefix('>palette', 8);
    expect(result?.mode.id).toBe('palette');
    expect(result?.filter).toBe('palette');
  });

  it('returns null for a non-prefix character at start-of-input', () => {
    expect(detectActivePrefix('hello', 5)).toBeNull();
  });

  it('returns null for a cursor before the prefix character', () => {
    // "/foo" cursor at 0 — we're in front of the prefix
    expect(detectActivePrefix('/foo', 0)).toBeNull();
  });

  it('handles a cursor in the middle of the filter text', () => {
    // "/abcdef" cursor at 3 — between "abc" and "def"
    const result = detectActivePrefix('/abcdef', 3);
    expect(result?.mode.id).toBe('skill');
    expect(result?.filter).toBe('abcdef');
    expect(result?.tokenEnd).toBe(7);
  });
});
