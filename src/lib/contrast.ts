/**
 * Contrast interpolation utility for the soft contrast slider.
 *
 * Each map stores the oklch **lightness** percentage for neutral CSS variables.
 * Variables that carry an alpha channel also store it so the interpolated value
 * can reproduce the full `oklch(L% 0 0 / alpha)` syntax.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ColorEndpoint {
  lightness: number;
  alpha?: number;
}

type EndpointMap = Record<string, ColorEndpoint>;

// ---------------------------------------------------------------------------
// Light mode endpoints
// ---------------------------------------------------------------------------

const LIGHT_BASE: EndpointMap = {
  '--color-background': { lightness: 100 },
  '--color-foreground': { lightness: 14 },
  '--color-card': { lightness: 100 },
  '--color-card-foreground': { lightness: 14 },
  '--color-popover': { lightness: 100 },
  '--color-popover-foreground': { lightness: 14 },
  '--color-primary': { lightness: 20 },
  '--color-primary-foreground': { lightness: 98 },
  '--color-secondary': { lightness: 96 },
  '--color-secondary-foreground': { lightness: 25 },
  '--color-muted': { lightness: 95.5 },
  '--color-muted-foreground': { lightness: 45 },
  '--color-accent': { lightness: 96 },
  '--color-accent-foreground': { lightness: 25 },
  '--color-border': { lightness: 90 },
  '--color-input': { lightness: 90 },
  '--color-ring': { lightness: 50 },
  '--color-comment-bg': { lightness: 92, alpha: 0.5 },
  '--color-comment-border': { lightness: 75 },
  '--color-comment-bg-hover': { lightness: 92, alpha: 0.7 },
  '--color-comment-bg-active': { lightness: 92, alpha: 0.75 },
  '--color-date-badge-bg': { lightness: 93 },
  '--color-date-badge-border': { lightness: 85 },
  '--color-date-badge-bg-hover': { lightness: 88 },
  '--color-find-match': { lightness: 85 },
  '--color-find-match-active': { lightness: 72 },
};

const LIGHT_SOFT: EndpointMap = {
  '--color-background': { lightness: 96 },
  '--color-foreground': { lightness: 20 },
  '--color-card': { lightness: 94 },
  '--color-card-foreground': { lightness: 20 },
  '--color-popover': { lightness: 94 },
  '--color-popover-foreground': { lightness: 20 },
  '--color-primary': { lightness: 25 },
  '--color-primary-foreground': { lightness: 96 },
  '--color-secondary': { lightness: 91 },
  '--color-secondary-foreground': { lightness: 28 },
  '--color-muted': { lightness: 91 },
  '--color-muted-foreground': { lightness: 48 },
  '--color-accent': { lightness: 91 },
  '--color-accent-foreground': { lightness: 28 },
  '--color-border': { lightness: 86 },
  '--color-input': { lightness: 86 },
  '--color-ring': { lightness: 52 },
  '--color-comment-bg': { lightness: 88, alpha: 0.5 },
  '--color-comment-border': { lightness: 72 },
  '--color-comment-bg-hover': { lightness: 88, alpha: 0.7 },
  '--color-comment-bg-active': { lightness: 88, alpha: 0.75 },
  '--color-date-badge-bg': { lightness: 89 },
  '--color-date-badge-border': { lightness: 80 },
  '--color-date-badge-bg-hover': { lightness: 84 },
  '--color-find-match': { lightness: 82 },
  '--color-find-match-active': { lightness: 70 },
};

// ---------------------------------------------------------------------------
// Dark mode endpoints
// ---------------------------------------------------------------------------

const DARK_BASE: EndpointMap = {
  '--color-background': { lightness: 18 },
  '--color-foreground': { lightness: 98 },
  '--color-card': { lightness: 22 },
  '--color-card-foreground': { lightness: 98 },
  '--color-popover': { lightness: 22 },
  '--color-popover-foreground': { lightness: 98 },
  '--color-primary': { lightness: 90 },
  '--color-primary-foreground': { lightness: 14 },
  '--color-secondary': { lightness: 28 },
  '--color-secondary-foreground': { lightness: 98 },
  '--color-muted': { lightness: 28 },
  '--color-muted-foreground': { lightness: 75 },
  '--color-accent': { lightness: 32 },
  '--color-accent-foreground': { lightness: 98 },
  '--color-border': { lightness: 32 },
  '--color-input': { lightness: 28 },
  '--color-ring': { lightness: 60 },
  '--color-comment-bg': { lightness: 55, alpha: 0.2 },
  '--color-comment-border': { lightness: 55, alpha: 0.6 },
  '--color-comment-bg-hover': { lightness: 55, alpha: 0.3 },
  '--color-comment-bg-active': { lightness: 55, alpha: 0.35 },
  '--color-date-badge-bg': { lightness: 30 },
  '--color-date-badge-border': { lightness: 38 },
  '--color-date-badge-bg-hover': { lightness: 35 },
  '--color-find-match': { lightness: 35 },
  '--color-find-match-active': { lightness: 50 },
};

const DARK_SOFT: EndpointMap = {
  '--color-background': { lightness: 25 },
  '--color-foreground': { lightness: 90 },
  '--color-card': { lightness: 28 },
  '--color-card-foreground': { lightness: 90 },
  '--color-popover': { lightness: 28 },
  '--color-popover-foreground': { lightness: 90 },
  '--color-primary': { lightness: 85 },
  '--color-primary-foreground': { lightness: 20 },
  '--color-secondary': { lightness: 32 },
  '--color-secondary-foreground': { lightness: 90 },
  '--color-muted': { lightness: 32 },
  '--color-muted-foreground': { lightness: 70 },
  '--color-accent': { lightness: 35 },
  '--color-accent-foreground': { lightness: 90 },
  '--color-border': { lightness: 36 },
  '--color-input': { lightness: 32 },
  '--color-ring': { lightness: 55 },
  '--color-comment-bg': { lightness: 50, alpha: 0.2 },
  '--color-comment-border': { lightness: 50, alpha: 0.5 },
  '--color-comment-bg-hover': { lightness: 50, alpha: 0.3 },
  '--color-comment-bg-active': { lightness: 50, alpha: 0.35 },
  '--color-date-badge-bg': { lightness: 33 },
  '--color-date-badge-border': { lightness: 40 },
  '--color-date-badge-bg-hover': { lightness: 38 },
  '--color-find-match': { lightness: 38 },
  '--color-find-match-active': { lightness: 48 },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** All CSS variable names managed by the contrast system. */
export const CONTRAST_VARIABLE_NAMES: string[] = Object.keys(LIGHT_BASE);

/**
 * Compute interpolated CSS variable overrides for a given theme, contrast
 * level, and optional color tint.
 *
 * @param theme  `'light'` or `'dark'`
 * @param level  0–100 where 0 = base (full contrast) and 100 = soft
 * @param tintChroma  0–30 mapped to 0–0.03 oklch chroma. 0 = neutral grey.
 * @param tintHue  0–360 oklch hue angle (e.g., 60 = warm yellow, 270 = cool blue)
 * @returns A record of CSS variable names to `oklch(...)` values. Returns an
 *          empty object when both `level` is 0 and `tintChroma` is 0 (no
 *          overrides needed — the base values from the stylesheet apply).
 */
export function getContrastVariables(
  theme: 'light' | 'dark',
  level: number,
  tintChroma: number = 0,
  tintHue: number = 0,
): Record<string, string> {
  if (level === 0 && tintChroma === 0) return {};

  const base = theme === 'light' ? LIGHT_BASE : DARK_BASE;
  const soft = theme === 'light' ? LIGHT_SOFT : DARK_SOFT;
  const t = level / 100;
  const chroma = round(tintChroma / 1000); // 0–30 → 0–0.03

  const result: Record<string, string> = {};

  for (const name of CONTRAST_VARIABLE_NAMES) {
    const b = base[name];
    const s = soft[name];
    const lightness = level === 0
      ? b.lightness
      : round(b.lightness + (s.lightness - b.lightness) * t);

    const c = chroma > 0 ? ` ${chroma} ${tintHue}` : ' 0 0';

    if (b.alpha !== undefined) {
      result[name] = `oklch(${lightness}%${c} / ${b.alpha})`;
    } else {
      result[name] = `oklch(${lightness}%${c})`;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round to two decimal places to avoid floating-point noise. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
