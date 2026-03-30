import { describe, it, expect } from 'vitest';

/**
 * Tests for the SPARKLINE_RE regex pattern used in the TableSparkline
 * decoration extension. We test the regex directly to verify matching
 * behavior without requiring a full ProseMirror editor.
 */

// Replicate the regex from table-sparkline.ts
const SPARKLINE_RE = /\{\{spark:([\d.,\s-]+)\}\}/g;

function findMatches(text: string): { full: string; data: string }[] {
  SPARKLINE_RE.lastIndex = 0;
  const results: { full: string; data: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = SPARKLINE_RE.exec(text)) !== null) {
    results.push({ full: match[0], data: match[1] });
  }
  return results;
}

describe('Sparkline regex pattern matching', () => {
  it('matches basic sparkline syntax {{spark:1,2,3}}', () => {
    const matches = findMatches('{{spark:1,2,3}}');
    expect(matches).toHaveLength(1);
    expect(matches[0].full).toBe('{{spark:1,2,3}}');
    expect(matches[0].data).toBe('1,2,3');
  });

  it('matches sparkline with negatives and decimals {{spark:-1,0,1.5}}', () => {
    const matches = findMatches('{{spark:-1,0,1.5}}');
    expect(matches).toHaveLength(1);
    expect(matches[0].data).toBe('-1,0,1.5');
  });

  it('matches sparkline with spaces between values', () => {
    const matches = findMatches('{{spark:1, 2, 3}}');
    expect(matches).toHaveLength(1);
    expect(matches[0].data).toBe('1, 2, 3');
  });

  it('does NOT match empty data {{spark:}}', () => {
    const matches = findMatches('{{spark:}}');
    expect(matches).toHaveLength(0);
  });

  it('does NOT match regular text', () => {
    expect(findMatches('just some text')).toHaveLength(0);
    expect(findMatches('{{notaspark:1,2}}')).toHaveLength(0);
    expect(findMatches('spark:1,2,3')).toHaveLength(0);
    expect(findMatches('{spark:1,2,3}')).toHaveLength(0);
  });

  it('does NOT match sparkline with alphabetic characters in data', () => {
    const matches = findMatches('{{spark:a,b,c}}');
    expect(matches).toHaveLength(0);
  });

  it('matches multiple sparklines in one string', () => {
    const text = 'Chart A: {{spark:1,2,3}} and Chart B: {{spark:4,5,6}}';
    const matches = findMatches(text);
    expect(matches).toHaveLength(2);
    expect(matches[0].data).toBe('1,2,3');
    expect(matches[1].data).toBe('4,5,6');
  });

  it('matches sparkline embedded in a table cell', () => {
    const text = '| Sales | {{spark:12,15,9,22,18}} |';
    const matches = findMatches(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].data).toBe('12,15,9,22,18');
  });

  it('matches sparkline with single value', () => {
    const matches = findMatches('{{spark:42}}');
    expect(matches).toHaveLength(1);
    expect(matches[0].data).toBe('42');
  });

  it('matches sparkline with large dataset', () => {
    const values = Array.from({ length: 50 }, (_, i) => i).join(',');
    const matches = findMatches(`{{spark:${values}}}`);
    expect(matches).toHaveLength(1);
  });
});

describe('Sparkline inside code block (behavioral note)', () => {
  // The actual code-block exclusion is handled by the ProseMirror plugin
  // (it skips codeBlock nodes and code-marked text). We document it here
  // for completeness — the regex itself cannot distinguish context.
  it('regex matches the pattern even inside a code fence (plugin filters it out)', () => {
    const codeFence = '```\n{{spark:1,2,3}}\n```';
    // The regex alone still matches — the ProseMirror plugin is
    // responsible for skipping code blocks via node type checks.
    const matches = findMatches(codeFence);
    expect(matches).toHaveLength(1);
  });
});
