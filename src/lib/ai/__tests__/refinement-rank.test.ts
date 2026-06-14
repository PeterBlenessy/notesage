import { describe, it, expect } from 'vitest';
import { rankRefinements } from '../refinement-rank';
import type { RefinementEntry, RefinementVerdict } from '../refinement';

let seq = 0;
function entry(verdict: RefinementVerdict, createdAt: number, status: RefinementEntry['status'] = 'pending'): RefinementEntry {
  return {
    id: `e${seq++}`,
    docPath: '/d.md',
    anchor: { from: 0, to: 1 },
    srcHash: 'h',
    originalText: 'x',
    result: { verdict, outcome: 'o', steps: [], rationale: 'r' },
    status,
    createdAt,
  };
}

describe('rankRefinements', () => {
  it('orders by verdict priority then recency, filtering keep + non-pending', () => {
    const entries = [
      entry('defer', 100),
      entry('sharpen', 50),
      entry('drop', 200),
      entry('split', 40),
      entry('keep', 999), // filtered
      entry('sharpen', 60),
      entry('sharpen', 10, 'applied'), // filtered (not pending)
    ];
    const ranked = rankRefinements(entries);
    // sharpen/split (prio 3) first, newest within bucket: sharpen@60, sharpen@50, split@40, then defer@100, then drop@200
    expect(ranked.map((e) => [e.result.verdict, e.createdAt])).toEqual([
      ['sharpen', 60],
      ['sharpen', 50],
      ['split', 40],
      ['defer', 100],
      ['drop', 200],
    ]);
  });

  it('respects the limit (default 5)', () => {
    const entries = Array.from({ length: 8 }, (_, i) => entry('sharpen', i));
    expect(rankRefinements(entries)).toHaveLength(5);
    expect(rankRefinements(entries, 2)).toHaveLength(2);
  });

  it('returns empty for a negative limit and does not mutate input', () => {
    const entries = [entry('sharpen', 1), entry('defer', 2)];
    const before = entries.slice();
    expect(rankRefinements(entries, -1)).toEqual([]);
    expect(entries).toEqual(before);
  });

  it('returns empty when only keep/non-pending entries exist', () => {
    expect(rankRefinements([entry('keep', 1), entry('sharpen', 2, 'dismissed')])).toEqual([]);
  });
});
