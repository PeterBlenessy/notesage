import { describe, it, expect } from 'vitest';
import { REACT_GUIDANCE, buildReActAddendum } from '@/lib/ai/react-prompt';

describe('buildReActAddendum', () => {
  it('returns the guidance text when tool calling is enabled', () => {
    expect(buildReActAddendum(true)).toBe(REACT_GUIDANCE);
  });

  it('returns an empty string when tool calling is disabled', () => {
    // Guard against wasting tokens on guidance for an unavailable feature.
    expect(buildReActAddendum(false)).toBe('');
  });
});

describe('REACT_GUIDANCE', () => {
  it('mentions the four protocol points', () => {
    // Each bullet covers a failure mode small models hit; if a future edit
    // drops one of these, the prompt loses its load-bearing value.
    expect(REACT_GUIDANCE).toMatch(/before each tool call/i);
    expect(REACT_GUIDANCE).toMatch(/after each result/i);
    expect(REACT_GUIDANCE).toMatch(/error/i);
    expect(REACT_GUIDANCE).toMatch(/speculative/i);
  });

  it('stays compact — the prompt is appended every send', () => {
    // Soft budget: under ~120 tokens. Rough token estimate ≈ chars / 4.
    expect(REACT_GUIDANCE.length).toBeLessThan(500);
  });
});
