import { describe, it, expect } from 'vitest';
import { computeUnifiedDiff, type DiffLine } from './diff-utils';

const byType = (lines: DiffLine[], type: DiffLine['type']) =>
  lines.filter((l) => l.type === type);

describe('computeUnifiedDiff', () => {
  it('treats undefined oldText as a new file with all additions', () => {
    const result = computeUnifiedDiff(undefined, 'line 1\nline 2\nline 3');
    expect(result.isNewFile).toBe(true);
    expect(result.isDeletion).toBe(false);
    expect(result.additions).toBe(3);
    expect(result.deletions).toBe(0);
    expect(result.lines.every((l) => l.type === 'add')).toBe(true);
    expect(result.lines.map((l) => l.text)).toEqual(['line 1', 'line 2', 'line 3']);
  });

  it('handles a new empty file (no lines)', () => {
    const result = computeUnifiedDiff(undefined, '');
    expect(result.isNewFile).toBe(true);
    expect(result.additions).toBe(0);
    expect(result.lines).toHaveLength(0);
  });

  it('treats empty newText as a full deletion', () => {
    const result = computeUnifiedDiff('one\ntwo', '');
    expect(result.isDeletion).toBe(true);
    expect(result.isNewFile).toBe(false);
    expect(result.deletions).toBe(2);
    expect(result.additions).toBe(0);
    expect(result.lines.every((l) => l.type === 'remove')).toBe(true);
  });

  it('produces no lines when old and new are identical', () => {
    const result = computeUnifiedDiff('same\ncontent', 'same\ncontent');
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.lines).toHaveLength(0);
  });

  it('represents a single-line replacement as remove+add with no context around standalone', () => {
    const result = computeUnifiedDiff('hello', 'world');
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    const types = result.lines.map((l) => l.type);
    expect(types).toContain('remove');
    expect(types).toContain('add');
  });

  it('keeps context lines around mixed changes', () => {
    const oldText = [
      'keep-1',
      'keep-2',
      'keep-3',
      'old-middle',
      'keep-4',
      'keep-5',
      'keep-6',
    ].join('\n');
    const newText = [
      'keep-1',
      'keep-2',
      'keep-3',
      'new-middle',
      'keep-4',
      'keep-5',
      'keep-6',
    ].join('\n');
    const result = computeUnifiedDiff(oldText, newText);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    // Context lines near the change should be present.
    const contextTexts = byType(result.lines, 'context').map((l) => l.text);
    expect(contextTexts).toContain('keep-3');
    expect(contextTexts).toContain('keep-4');
  });

  it('inserts a separator between distant hunks', () => {
    // Force two distant changes with plenty of context between them.
    const oldLines: string[] = [];
    oldLines.push('old-top');
    for (let i = 0; i < 20; i++) oldLines.push(`middle-${i}`);
    oldLines.push('old-bottom');
    const newLines: string[] = [];
    newLines.push('new-top');
    for (let i = 0; i < 20; i++) newLines.push(`middle-${i}`);
    newLines.push('new-bottom');
    const result = computeUnifiedDiff(oldLines.join('\n'), newLines.join('\n'));
    const separators = byType(result.lines, 'separator');
    expect(separators.length).toBeGreaterThan(0);
  });

  it('truncates very large diffs with a trailing summary separator', () => {
    // Generate many changed lines (250 additions) — exceeds MAX_LINES=200.
    const newLines = Array.from({ length: 250 }, (_, i) => `new line ${i}`);
    const result = computeUnifiedDiff(undefined, newLines.join('\n'));
    expect(result.truncated).toBe(true);
    // Last entry should be a summary separator with remaining line count.
    const last = result.lines[result.lines.length - 1];
    expect(last.type).toBe('separator');
    expect(last.text).toMatch(/\d+ more line/);
  });

  it('handles empty strings without crashing', () => {
    const result = computeUnifiedDiff('', '');
    expect(result.lines).toHaveLength(0);
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
  });

  it('treats oldText="" as a non-new-file change', () => {
    // Empty -> non-empty. isNewFile is only for undefined oldText.
    const result = computeUnifiedDiff('', 'hello');
    expect(result.isNewFile).toBe(false);
    expect(result.additions).toBeGreaterThanOrEqual(1);
  });
});
