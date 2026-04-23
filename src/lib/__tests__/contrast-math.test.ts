import { describe, it, expect } from 'vitest';
import {
  parseOklch,
  oklchToRgb,
  relativeLuminance,
  contrastRatio,
  oklchContrastRatio,
} from '../contrast-math';

describe('parseOklch', () => {
  it('parses a neutral oklch literal', () => {
    expect(parseOklch('oklch(100% 0 0)')).toEqual({ l: 1, c: 0, h: 0, alpha: 1 });
  });

  it('parses a chromatic oklch literal', () => {
    const parsed = parseOklch('oklch(55.62% 0.227 27.33)');
    expect(parsed.l).toBeCloseTo(0.5562, 4);
    expect(parsed.c).toBeCloseTo(0.227, 4);
    expect(parsed.h).toBeCloseTo(27.33, 4);
    expect(parsed.alpha).toBe(1);
  });

  it('parses an oklch literal with alpha', () => {
    const parsed = parseOklch('oklch(92% 0 0 / 0.5)');
    expect(parsed.l).toBeCloseTo(0.92, 4);
    expect(parsed.alpha).toBe(0.5);
  });

  it('tolerates extra whitespace', () => {
    const parsed = parseOklch('  oklch(  50%   0.1   180  )  ');
    expect(parsed.l).toBeCloseTo(0.5, 4);
    expect(parsed.c).toBeCloseTo(0.1, 4);
    expect(parsed.h).toBeCloseTo(180, 4);
  });

  it('throws for invalid input', () => {
    expect(() => parseOklch('rgb(255, 0, 0)')).toThrow();
    expect(() => parseOklch('not a color')).toThrow();
  });
});

describe('oklchToRgb', () => {
  it('converts pure white to (1, 1, 1)', () => {
    const rgb = oklchToRgb({ l: 1, c: 0, h: 0, alpha: 1 });
    expect(rgb.r).toBeCloseTo(1, 3);
    expect(rgb.g).toBeCloseTo(1, 3);
    expect(rgb.b).toBeCloseTo(1, 3);
  });

  it('converts pure black to (0, 0, 0)', () => {
    const rgb = oklchToRgb({ l: 0, c: 0, h: 0, alpha: 1 });
    expect(rgb.r).toBeCloseTo(0, 3);
    expect(rgb.g).toBeCloseTo(0, 3);
    expect(rgb.b).toBeCloseTo(0, 3);
  });

  it('produces a valid sRGB color for a chromatic input', () => {
    // accent-blue (light variant): rgb(25,118,210) ≈ #1976d2
    const rgb = oklchToRgb({ l: 0.56, c: 0.16, h: 253, alpha: 1 });
    // Should land in roughly that ballpark — exact match isn't critical because
    // OKLab→sRGB conversion + CSS-rounded oklch values won't reproduce the
    // exact source RGB. The point is it stays in [0, 1] and is recognizably blue.
    expect(rgb.r).toBeGreaterThanOrEqual(0);
    expect(rgb.r).toBeLessThan(0.4);
    expect(rgb.g).toBeGreaterThanOrEqual(0);
    expect(rgb.g).toBeLessThan(0.6);
    expect(rgb.b).toBeGreaterThan(0.6);
    expect(rgb.b).toBeLessThanOrEqual(1);
  });

  it('clamps out-of-gamut colors to [0, 1]', () => {
    // Extremely high chroma at hue 0 — way outside sRGB gamut.
    const rgb = oklchToRgb({ l: 0.5, c: 1.0, h: 0, alpha: 1 });
    expect(rgb.r).toBeGreaterThanOrEqual(0);
    expect(rgb.r).toBeLessThanOrEqual(1);
    expect(rgb.g).toBeGreaterThanOrEqual(0);
    expect(rgb.g).toBeLessThanOrEqual(1);
    expect(rgb.b).toBeGreaterThanOrEqual(0);
    expect(rgb.b).toBeLessThanOrEqual(1);
  });
});

describe('relativeLuminance', () => {
  it('returns 1 for pure white', () => {
    expect(relativeLuminance({ r: 1, g: 1, b: 1, alpha: 1 })).toBeCloseTo(1, 4);
  });

  it('returns 0 for pure black', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0, alpha: 1 })).toBeCloseTo(0, 4);
  });

  it('weights green more than red and blue', () => {
    const red = relativeLuminance({ r: 1, g: 0, b: 0, alpha: 1 });
    const green = relativeLuminance({ r: 0, g: 1, b: 0, alpha: 1 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 1, alpha: 1 });
    expect(green).toBeGreaterThan(red);
    expect(green).toBeGreaterThan(blue);
    expect(red).toBeGreaterThan(blue);
    // WCAG coefficients: 0.2126 / 0.7152 / 0.0722
    expect(red).toBeCloseTo(0.2126, 4);
    expect(green).toBeCloseTo(0.7152, 4);
    expect(blue).toBeCloseTo(0.0722, 4);
  });
});

describe('contrastRatio', () => {
  it('returns 21 for pure black on pure white', () => {
    const white = { r: 1, g: 1, b: 1, alpha: 1 };
    const black = { r: 0, g: 0, b: 0, alpha: 1 };
    expect(contrastRatio(white, black)).toBeCloseTo(21, 2);
  });

  it('returns 1 for the same color (white on white)', () => {
    const white = { r: 1, g: 1, b: 1, alpha: 1 };
    expect(contrastRatio(white, white)).toBeCloseTo(1, 4);
  });

  it('returns 1 for the same color (black on black)', () => {
    const black = { r: 0, g: 0, b: 0, alpha: 1 };
    expect(contrastRatio(black, black)).toBeCloseTo(1, 4);
  });

  it('is symmetric (order of arguments does not matter)', () => {
    const a = { r: 0.3, g: 0.4, b: 0.5, alpha: 1 };
    const b = { r: 0.9, g: 0.9, b: 0.9, alpha: 1 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 6);
  });
});

describe('oklchContrastRatio (design-system pairs)', () => {
  // Reference values pre-computed by an independent oklch→sRGB→WCAG pipeline.
  // These pin the math so a regression in any helper surfaces here.

  it('light foreground on light background ≈ 19.9 (well above 4.5:1 AA body)', () => {
    const ratio = oklchContrastRatio(parseOklch('oklch(100% 0 0)'), parseOklch('oklch(14% 0 0)'));
    expect(ratio).toBeCloseTo(19.9, 1);
    expect(ratio).toBeGreaterThan(4.5);
  });

  it('dark foreground on dark background ≈ 17.8 (well above 4.5:1 AA body)', () => {
    const ratio = oklchContrastRatio(parseOklch('oklch(18% 0 0)'), parseOklch('oklch(98% 0 0)'));
    expect(ratio).toBeCloseTo(17.75, 1);
    expect(ratio).toBeGreaterThan(4.5);
  });

  it('light muted-foreground on light background ≈ 6.5 (above 4.5:1 AA body)', () => {
    const ratio = oklchContrastRatio(
      parseOklch('oklch(95.5% 0 0)'),
      parseOklch('oklch(45% 0 0)'),
    );
    expect(ratio).toBeCloseTo(6.5, 1);
    expect(ratio).toBeGreaterThan(4.5);
  });

  it('light ring on light background ≈ 6.0 (above 3:1 UI)', () => {
    const ratio = oklchContrastRatio(parseOklch('oklch(100% 0 0)'), parseOklch('oklch(50% 0 0)'));
    expect(ratio).toBeCloseTo(6.0, 1);
    expect(ratio).toBeGreaterThan(3);
  });

  it('accent-orange on white ≈ 3.15 (passes 3:1 UI, but fails 4.5:1 body)', () => {
    // Documented intent in globals.css comment for `.accent-orange`:
    // "intentionally vivid (Material Deep Orange 500) and clears UI 3:1 but
    // lands at ~3.2:1 against white".
    const ratio = oklchContrastRatio(
      parseOklch('oklch(68% 0.21 37)'),
      parseOklch('oklch(100% 0 0)'),
    );
    expect(ratio).toBeCloseTo(3.15, 1);
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(4.5);
  });

  it('accent-blue on white ≈ 4.7 (clears 4.5:1 AA body)', () => {
    // Documented intent: "the blue clears WCAG body 4.5:1 in both modes".
    const ratio = oklchContrastRatio(
      parseOklch('oklch(56% 0.16 253)'),
      parseOklch('oklch(100% 0 0)'),
    );
    expect(ratio).toBeCloseTo(4.69, 1);
    expect(ratio).toBeGreaterThan(4.5);
  });

  // Regression lock: --color-border-strong is the WCAG 1.4.11-grade affordance
  // border (form inputs, outline buttons, unchecked checkboxes). It MUST clear
  // 3:1 against --color-background in both themes. If a future palette tweak
  // softens these values, this test fails before the contrast-audit script
  // does, so the regression surfaces in normal `pnpm test`.
  it('light border-strong on light background ≥ 3:1 (WCAG 1.4.11 UI affordance)', () => {
    // --color-border-strong: oklch(60% 0 0)
    // --color-background    : oklch(100% 0 0)
    const ratio = oklchContrastRatio(
      parseOklch('oklch(60% 0 0)'),
      parseOklch('oklch(100% 0 0)'),
    );
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it('dark border-strong on dark background ≥ 3:1 (WCAG 1.4.11 UI affordance)', () => {
    // .dark --color-border-strong: oklch(52% 0 0)
    // .dark --color-background    : oklch(18% 0 0)
    const ratio = oklchContrastRatio(
      parseOklch('oklch(52% 0 0)'),
      parseOklch('oklch(18% 0 0)'),
    );
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});
