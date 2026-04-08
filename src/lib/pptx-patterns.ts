import type { CSSProperties } from "react";

/**
 * Generate CSS background patterns for OOXML pattern fill presets.
 * Maps DrawingML preset names to repeating-linear-gradient CSS.
 */
export function patternToCSS(preset: string, fg: string, bg: string): CSSProperties {
  const pattern = PATTERN_MAP[preset];
  if (!pattern) {
    // Unrecognized preset: solid fallback using foreground color
    return { backgroundColor: fg };
  }
  return pattern(fg, bg);
}

type PatternFn = (fg: string, bg: string) => CSSProperties;

function stripes(angle: number, stripeWidth: number, gap: number): PatternFn {
  return (fg, bg) => ({
    backgroundColor: bg,
    backgroundImage: `repeating-linear-gradient(${angle}deg, ${fg} 0px, ${fg} ${stripeWidth}px, ${bg} ${stripeWidth}px, ${bg} ${stripeWidth + gap}px)`,
  });
}

const PATTERN_MAP: Record<string, PatternFn> = {
  // Standard patterns (1px stripe, 3px gap)
  horz: stripes(0, 1, 3),
  vert: stripes(90, 1, 3),
  dnDiag: stripes(45, 1, 3),
  upDiag: stripes(-45, 1, 3),

  // Dark/thick patterns (2px stripe, 3px gap)
  dkHorz: stripes(0, 2, 3),
  dkVert: stripes(90, 2, 3),
  dkDnDiag: stripes(45, 2, 3),
  dkUpDiag: stripes(-45, 2, 3),

  // Light/thin patterns (1px stripe, 5px gap)
  ltHorz: stripes(0, 1, 5),
  ltVert: stripes(90, 1, 5),
};
