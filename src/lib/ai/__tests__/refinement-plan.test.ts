import { describe, it, expect } from 'vitest';
import { planRefinement } from '../refinement-plan';

const ctx = (over: Partial<{ hash: string; alreadyRefined: boolean; seen: (h: string) => boolean }> = {}) => ({
  hash: 'h1',
  alreadyRefined: false,
  seen: () => false,
  ...over,
});

describe('planRefinement', () => {
  it("dispatches an unseen, unrefined action candidate", () => {
    expect(planRefinement('- [ ] email the team', ctx())).toBe('dispatch');
    expect(planRefinement('Fix the onboarding bug', ctx())).toBe('dispatch');
  });

  it('skips non-action prose regardless of context', () => {
    expect(planRefinement('The meeting was productive.', ctx())).toBe('skip');
    expect(planRefinement('# A heading', ctx())).toBe('skip');
    expect(planRefinement('', ctx())).toBe('skip');
  });

  it('skips a line already refined and unchanged (watermark holds)', () => {
    expect(planRefinement('- [ ] email the team', ctx({ alreadyRefined: true }))).toBe('skip');
  });

  it('re-dispatches an edited (diverged-hash) refined line', () => {
    // alreadyRefined is computed false by the caller once the hash diverges.
    expect(planRefinement('- [ ] email the whole team', ctx({ alreadyRefined: false }))).toBe('dispatch');
  });

  it('skips a line whose hash is in the seen-set', () => {
    const seen = (h: string) => h === 'h1';
    expect(planRefinement('- [ ] email the team', ctx({ seen }))).toBe('skip');
    // A different hash is not seen → dispatches.
    expect(planRefinement('- [ ] email the team', ctx({ hash: 'h2', seen }))).toBe('dispatch');
  });

  it('candidate gate wins before the seen/refined checks (prose never dispatches)', () => {
    expect(planRefinement('just prose', ctx({ alreadyRefined: false, seen: () => false }))).toBe('skip');
  });
});
