/**
 * Contrast math helpers — oklch parsing + WCAG contrast ratio computation.
 *
 * Used by the automated contrast audit script (`scripts/contrast-audit.ts`)
 * to verify that the design-system palette in `globals.css` clears WCAG AA
 * thresholds (4.5:1 for body text, 3:1 for UI components).
 *
 * Pipeline: parse oklch(L% C h) → OKLab → linear sRGB → gamma-corrected sRGB
 *           → relative luminance → WCAG contrast ratio.
 *
 * The conversion follows the CSS Color Module Level 4 specification for
 * oklch (https://www.w3.org/TR/css-color-4/#ok-lab) and the WCAG 2.1
 * contrast formula (https://www.w3.org/WAI/GL/wiki/Contrast_ratio).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OklchColor {
  /** Lightness, 0–1 (CSS uses 0%–100%; we normalize to the 0–1 range used by OKLab). */
  l: number;
  /** Chroma, typically 0–0.4 in display sRGB gamut. */
  c: number;
  /** Hue, in degrees (0–360). */
  h: number;
  /** Optional alpha, 0–1. Defaults to 1. */
  alpha: number;
}

export interface RgbColor {
  /** Red channel in gamma-corrected sRGB, 0–1. */
  r: number;
  /** Green channel in gamma-corrected sRGB, 0–1. */
  g: number;
  /** Blue channel in gamma-corrected sRGB, 0–1. */
  b: number;
  /** Alpha, 0–1. */
  alpha: number;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a CSS `oklch(L% C h [/ alpha])` color string.
 *
 * Accepts:
 * - `oklch(100% 0 0)` — neutral white
 * - `oklch(55% 0.227 27.33)` — chromatic
 * - `oklch(92% 0 0 / 0.5)` — with alpha
 * - whitespace tolerant
 *
 * Throws if the string isn't a valid oklch literal.
 */
export function parseOklch(input: string): OklchColor {
  const trimmed = input.trim();
  const match = trimmed.match(
    /^oklch\(\s*([0-9.]+)%?\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\s*\)$/,
  );
  if (!match) {
    throw new Error(`Invalid oklch literal: "${input}"`);
  }

  const lRaw = parseFloat(match[1]);
  const c = parseFloat(match[2]);
  const h = parseFloat(match[3]);
  const alpha = match[4] !== undefined ? parseFloat(match[4]) : 1;

  // CSS oklch lightness is a percentage (0–100); OKLab uses 0–1.
  // The percent sign is optional in our regex (`%?`); either way we treat
  // values >1 as percentages. Real-world oklch in our codebase always uses %.
  const l = lRaw > 1 ? lRaw / 100 : lRaw;

  return { l, c, h, alpha };
}

// ---------------------------------------------------------------------------
// oklch → linear sRGB
// ---------------------------------------------------------------------------

/**
 * Convert an OKLab color (l, a, b) to linear sRGB (0–1, may exceed [0,1] for
 * out-of-gamut colors — caller is responsible for clamping).
 *
 * Reference: https://bottosson.github.io/posts/oklab/
 */
function oklabToLinearSrgb(l: number, a: number, b: number): { r: number; g: number; b: number } {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const lCubed = l_ * l_ * l_;
  const mCubed = m_ * m_ * m_;
  const sCubed = s_ * s_ * s_;

  return {
    r: 4.0767416621 * lCubed - 3.3077115913 * mCubed + 0.2309699292 * sCubed,
    g: -1.2684380046 * lCubed + 2.6097574011 * mCubed - 0.3413193965 * sCubed,
    b: -0.0041960863 * lCubed - 0.7034186147 * mCubed + 1.707614701 * sCubed,
  };
}

/**
 * Convert oklch (lightness, chroma, hue) to OKLab (l, a, b).
 *
 * Hue is in degrees; converted to radians for the trig.
 */
function oklchToOklab(color: OklchColor): { l: number; a: number; b: number } {
  const hRad = (color.h * Math.PI) / 180;
  return {
    l: color.l,
    a: color.c * Math.cos(hRad),
    b: color.c * Math.sin(hRad),
  };
}

/**
 * Apply the sRGB gamma transfer function to a single linear channel value.
 *
 * Reference: https://en.wikipedia.org/wiki/SRGB#Transformation
 */
function linearToGammaSrgb(channel: number): number {
  // Clamp to [0, 1] — out-of-gamut oklch can produce negative or >1 values.
  const clamped = Math.max(0, Math.min(1, channel));
  if (clamped <= 0.0031308) {
    return clamped * 12.92;
  }
  return 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

/**
 * Convert an oklch color to gamma-corrected sRGB (channels 0–1).
 *
 * Out-of-gamut colors are clamped to the sRGB cube — this matches what a
 * browser actually displays.
 */
export function oklchToRgb(color: OklchColor): RgbColor {
  const oklab = oklchToOklab(color);
  const linear = oklabToLinearSrgb(oklab.l, oklab.a, oklab.b);
  return {
    r: linearToGammaSrgb(linear.r),
    g: linearToGammaSrgb(linear.g),
    b: linearToGammaSrgb(linear.b),
    alpha: color.alpha,
  };
}

// ---------------------------------------------------------------------------
// Relative luminance + WCAG contrast ratio
// ---------------------------------------------------------------------------

/**
 * Linearize a single gamma-corrected sRGB channel for luminance computation.
 *
 * Reference: https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
function linearizeChannel(channel: number): number {
  const c = Math.max(0, Math.min(1, channel));
  if (c <= 0.04045) {
    return c / 12.92;
  }
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Compute the WCAG 2.1 relative luminance of a gamma-corrected sRGB color.
 *
 * Returns a value in [0, 1] where 0 is black and 1 is white.
 */
export function relativeLuminance(rgb: RgbColor): number {
  const r = linearizeChannel(rgb.r);
  const g = linearizeChannel(rgb.g);
  const b = linearizeChannel(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Compute the WCAG 2.1 contrast ratio between two colors. Returns a value
 * in [1, 21] where 1 is identical, 21 is pure black on pure white.
 *
 * The order of arguments is irrelevant — the formula uses the lighter of
 * the two as L1.
 */
export function contrastRatio(a: RgbColor, b: RgbColor): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Convenience: contrast ratio between two oklch colors. Composes
 * `parseOklch`-style structures, not raw strings.
 */
export function oklchContrastRatio(a: OklchColor, b: OklchColor): number {
  return contrastRatio(oklchToRgb(a), oklchToRgb(b));
}
