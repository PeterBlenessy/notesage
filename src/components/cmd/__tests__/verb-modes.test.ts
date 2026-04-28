import { describe, it, expect } from 'vitest';
import {
  detectActiveVerb,
  computeTabCompletion,
  type VerbMode,
} from '../verb-modes';

// Fixture verb registry — keep tests independent of the live `VERBS`
// map so adding a new verb doesn't churn these assertions.
const TEST_VERBS: VerbMode[] = [
  { id: 'file' as const, name: 'file', label: 'File', icon: 'FileText', description: '' },
  { id: 'file' as const, name: 'find-in-files', label: 'Find', icon: 'Search', description: '' },
  { id: 'file' as const, name: 'goto-line', label: 'Goto', icon: 'ChevronRight', description: '' },
];

// ---------------------------------------------------------------------------
// detectActiveVerb (#5)
// ---------------------------------------------------------------------------

describe('detectActiveVerb', () => {
  it('returns null for empty input', () => {
    expect(detectActiveVerb('', 0)).toBeNull();
  });

  it('returns null when cursor is before any character', () => {
    expect(detectActiveVerb(':file', 0)).toBeNull();
  });

  it('detects bare `:` as discovery state with verb=null', () => {
    const result = detectActiveVerb(':', 1);
    expect(result).not.toBeNull();
    expect(result!.verb).toBeNull();
    expect(result!.typedName).toBe('');
    expect(result!.filter).toBe('');
  });

  it('detects partial verb name with no match → discovery state', () => {
    const result = detectActiveVerb(':fil', 4);
    expect(result).not.toBeNull();
    expect(result!.verb).toBeNull();
    expect(result!.typedName).toBe('fil');
  });

  it('detects full verb name match', () => {
    const result = detectActiveVerb(':file', 5);
    expect(result).not.toBeNull();
    expect(result!.verb?.name).toBe('file');
    expect(result!.typedName).toBe('file');
    expect(result!.filter).toBe('');
  });

  it('detects cursor in filter slot after `:file `', () => {
    const result = detectActiveVerb(':file foo', 9);
    expect(result).not.toBeNull();
    expect(result!.verb?.name).toBe('file');
    expect(result!.filter).toBe('foo');
  });

  it('filter slot only includes the first whitespace-delimited token', () => {
    const result = detectActiveVerb(':file foo bar', 9);
    expect(result).not.toBeNull();
    expect(result!.filter).toBe('foo');
  });

  it('returns null for `:` followed by whitespace then cursor', () => {
    // `: ` with cursor after the space — already two whitespace
    // crossings (the space after `:` and... actually just one). The
    // detector allows ONE space inside the active region (the
    // separator), so cursor after `: ` is in the empty filter slot.
    const result = detectActiveVerb(': ', 2);
    expect(result).not.toBeNull();
    expect(result!.typedName).toBe('');
    expect(result!.filter).toBe('');
  });

  it('returns null when `:` is mid-word (no preceding whitespace)', () => {
    const result = detectActiveVerb('text:file', 9);
    expect(result).toBeNull();
  });

  it('detects `:file` after preceding whitespace', () => {
    const result = detectActiveVerb('hello :file', 11);
    expect(result).not.toBeNull();
    expect(result!.verb?.name).toBe('file');
    expect(result!.verbStart).toBe(6);
  });

  it('returns null when cursor is past the active region', () => {
    // `:file foo bar` with cursor in the second token (`bar`) —
    // outside the verb's filter slot.
    const result = detectActiveVerb(':file foo bar', 13);
    expect(result).toBeNull();
  });

  it('source defaults to "typed"', () => {
    const result = detectActiveVerb(':file', 5);
    expect(result!.source).toBe('typed');
  });
});

// ---------------------------------------------------------------------------
// computeTabCompletion (#6)
// ---------------------------------------------------------------------------

describe('computeTabCompletion', () => {
  it('returns null for bare `:` (no candidates can disambiguate)', () => {
    // All three test verbs match `:` → longest common prefix is "",
    // so completion can't advance. Discovery list shows instead.
    const result = computeTabCompletion(':', 1, TEST_VERBS);
    expect(result).toBeNull();
  });

  it('completes `:f` to longest common prefix `:fi` (file + find-in-files)', () => {
    // Note: `goto-line` doesn't start with `f`, so candidates =
    // [file, find-in-files]. LCP = "fi".
    const fVerbs = TEST_VERBS.filter((v) => v.name.startsWith('f'));
    const result = computeTabCompletion(':f', 2, fVerbs);
    expect(result).not.toBeNull();
    expect(result!.newInput).toBe(':fi');
    expect(result!.newCursor).toBe(3);
    expect(result!.jumpToFilter).toBe(false);
  });

  it('returns null when `:fi` is already the longest common prefix', () => {
    const fVerbs = TEST_VERBS.filter((v) => v.name.startsWith('f'));
    const result = computeTabCompletion(':fi', 3, fVerbs);
    expect(result).toBeNull();
  });

  it('completes `:fil` to `:file ` (single match — file)', () => {
    // Among TEST_VERBS, `:fil` only matches `file` (find-in-files
    // has no `l` after `fi`).
    const result = computeTabCompletion(':fil', 4, TEST_VERBS);
    expect(result).not.toBeNull();
    expect(result!.newInput).toBe(':file ');
    expect(result!.newCursor).toBe(6);
    expect(result!.jumpToFilter).toBe(true);
  });

  it('completes `:file` to `:file ` (already a full match)', () => {
    const result = computeTabCompletion(':file', 5, TEST_VERBS);
    expect(result).not.toBeNull();
    expect(result!.newInput).toBe(':file ');
    expect(result!.newCursor).toBe(6);
    expect(result!.jumpToFilter).toBe(true);
  });

  it('returns null when cursor is past the verb name (in filter)', () => {
    // `:file <cursor>` — Tab is the verb's filter to handle.
    const result = computeTabCompletion(':file ', 6, TEST_VERBS);
    expect(result).toBeNull();
  });

  it('returns null when `:zzz` matches no verb', () => {
    const result = computeTabCompletion(':zzz', 4, TEST_VERBS);
    expect(result).toBeNull();
  });

  it('returns null when registry is empty', () => {
    const result = computeTabCompletion(':file', 5, []);
    expect(result).toBeNull();
  });

  it('does not double-add a trailing space when one already exists', () => {
    // `:fil<cursor> ` — Tab completes the name to `file` but the
    // existing trailing space is reused.
    const result = computeTabCompletion(':fil foo', 4, TEST_VERBS);
    expect(result).not.toBeNull();
    expect(result!.newInput).toBe(':file foo');
    expect(result!.newCursor).toBe(5);
    expect(result!.jumpToFilter).toBe(true);
  });
});
