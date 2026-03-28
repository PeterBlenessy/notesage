import { describe, it, expect } from 'vitest';
import { getContrastVariables, CONTRAST_VARIABLE_NAMES } from '../contrast';

describe('getContrastVariables', () => {
  // -------------------------------------------------------------------
  // level = 0 → no overrides
  // -------------------------------------------------------------------

  it('returns empty object for level 0 (light)', () => {
    expect(getContrastVariables('light', 0)).toEqual({});
  });

  it('returns empty object for level 0 (dark)', () => {
    expect(getContrastVariables('dark', 0)).toEqual({});
  });

  // -------------------------------------------------------------------
  // level = 100 → soft endpoints
  // -------------------------------------------------------------------

  describe('level 100 matches soft endpoints', () => {
    it('light theme', () => {
      const vars = getContrastVariables('light', 100);
      expect(vars['--color-background']).toBe('oklch(96% 0 0)');
      expect(vars['--color-foreground']).toBe('oklch(20% 0 0)');
      expect(vars['--color-card']).toBe('oklch(94% 0 0)');
      expect(vars['--color-primary']).toBe('oklch(25% 0 0)');
      expect(vars['--color-muted']).toBe('oklch(91% 0 0)');
      expect(vars['--color-border']).toBe('oklch(86% 0 0)');
      expect(vars['--color-ring']).toBe('oklch(52% 0 0)');
      expect(vars['--color-find-match']).toBe('oklch(82% 0 0)');
      expect(vars['--color-find-match-active']).toBe('oklch(70% 0 0)');
    });

    it('dark theme', () => {
      const vars = getContrastVariables('dark', 100);
      expect(vars['--color-background']).toBe('oklch(25% 0 0)');
      expect(vars['--color-foreground']).toBe('oklch(90% 0 0)');
      expect(vars['--color-card']).toBe('oklch(28% 0 0)');
      expect(vars['--color-primary']).toBe('oklch(85% 0 0)');
      expect(vars['--color-muted']).toBe('oklch(32% 0 0)');
      expect(vars['--color-border']).toBe('oklch(36% 0 0)');
      expect(vars['--color-ring']).toBe('oklch(55% 0 0)');
      expect(vars['--color-find-match']).toBe('oklch(38% 0 0)');
      expect(vars['--color-find-match-active']).toBe('oklch(48% 0 0)');
    });
  });

  // -------------------------------------------------------------------
  // level = 50 → midpoints
  // -------------------------------------------------------------------

  describe('level 50 produces midpoints', () => {
    it('light theme midpoints', () => {
      const vars = getContrastVariables('light', 50);
      // background: base=100, soft=96 → midpoint = 98
      expect(vars['--color-background']).toBe('oklch(98% 0 0)');
      // foreground: base=14, soft=20 → midpoint = 17
      expect(vars['--color-foreground']).toBe('oklch(17% 0 0)');
      // card: base=100, soft=94 → midpoint = 97
      expect(vars['--color-card']).toBe('oklch(97% 0 0)');
      // muted: base=95.5, soft=91 → midpoint = 93.25
      expect(vars['--color-muted']).toBe('oklch(93.25% 0 0)');
      // border: base=90, soft=86 → midpoint = 88
      expect(vars['--color-border']).toBe('oklch(88% 0 0)');
    });

    it('dark theme midpoints', () => {
      const vars = getContrastVariables('dark', 50);
      // background: base=18, soft=25 → midpoint = 21.5
      expect(vars['--color-background']).toBe('oklch(21.5% 0 0)');
      // foreground: base=98, soft=90 → midpoint = 94
      expect(vars['--color-foreground']).toBe('oklch(94% 0 0)');
      // primary: base=90, soft=85 → midpoint = 87.5
      expect(vars['--color-primary']).toBe('oklch(87.5% 0 0)');
      // border: base=32, soft=36 → midpoint = 34
      expect(vars['--color-border']).toBe('oklch(34% 0 0)');
    });
  });

  // -------------------------------------------------------------------
  // Alpha values preserved
  // -------------------------------------------------------------------

  describe('alpha values are preserved', () => {
    it('light theme alpha variables', () => {
      const vars = getContrastVariables('light', 100);
      // comment-bg: soft lightness=88, base alpha=0.5
      expect(vars['--color-comment-bg']).toBe('oklch(88% 0 0 / 0.5)');
      // comment-bg-hover: soft lightness=88, base alpha=0.7
      expect(vars['--color-comment-bg-hover']).toBe('oklch(88% 0 0 / 0.7)');
      // comment-bg-active: soft lightness=88, base alpha=0.75
      expect(vars['--color-comment-bg-active']).toBe('oklch(88% 0 0 / 0.75)');
    });

    it('dark theme alpha variables', () => {
      const vars = getContrastVariables('dark', 100);
      // comment-bg: soft lightness=50, base alpha=0.2
      expect(vars['--color-comment-bg']).toBe('oklch(50% 0 0 / 0.2)');
      // comment-border: soft lightness=50, base alpha=0.6
      expect(vars['--color-comment-border']).toBe('oklch(50% 0 0 / 0.6)');
      // comment-bg-hover: soft lightness=50, base alpha=0.3
      expect(vars['--color-comment-bg-hover']).toBe('oklch(50% 0 0 / 0.3)');
    });

    it('alpha preserved at intermediate levels', () => {
      const vars = getContrastVariables('light', 50);
      // comment-bg: base lightness=92, soft=88 → midpoint=90, alpha=0.5
      expect(vars['--color-comment-bg']).toBe('oklch(90% 0 0 / 0.5)');
    });
  });

  // -------------------------------------------------------------------
  // CONTRAST_VARIABLE_NAMES
  // -------------------------------------------------------------------

  describe('CONTRAST_VARIABLE_NAMES', () => {
    it('contains all expected variables', () => {
      expect(CONTRAST_VARIABLE_NAMES).toContain('--color-background');
      expect(CONTRAST_VARIABLE_NAMES).toContain('--color-foreground');
      expect(CONTRAST_VARIABLE_NAMES).toContain('--color-comment-bg');
      expect(CONTRAST_VARIABLE_NAMES).toContain('--color-find-match-active');
    });

    it('has 26 entries', () => {
      expect(CONTRAST_VARIABLE_NAMES).toHaveLength(26);
    });

    it('all names returned at non-zero level', () => {
      const vars = getContrastVariables('light', 50);
      for (const name of CONTRAST_VARIABLE_NAMES) {
        expect(vars).toHaveProperty(name);
      }
    });
  });

  // -------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------

  describe('edge cases', () => {
    it('level 1 produces small deltas from base', () => {
      const vars = getContrastVariables('light', 1);
      // background: 100 + (96 - 100) * 0.01 = 99.96
      expect(vars['--color-background']).toBe('oklch(99.96% 0 0)');
    });

    it('level 99 produces values near soft', () => {
      const vars = getContrastVariables('dark', 99);
      // background: 18 + (25 - 18) * 0.99 = 18 + 6.93 = 24.93
      expect(vars['--color-background']).toBe('oklch(24.93% 0 0)');
    });
  });
});
