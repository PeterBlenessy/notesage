#!/usr/bin/env tsx
/**
 * Automated WCAG contrast audit for the Notesage design system.
 *
 * Parses every `oklch(...)` token in `src/styles/globals.css` for the light
 * (`:root`/`@theme`) and dark (`.dark`) palettes, plus the four accent
 * variants (`.accent-orange`, `.accent-blue`, `.accent-system`, default), and
 * checks WCAG AA thresholds:
 *
 *   - 4.5:1 for body-text pairs (`foreground`/`background`,
 *     `accent-foreground`/`accent`, `primary-foreground`/`primary`,
 *     `foreground`/`muted`).
 *   - 3:1 for UI/non-text pairs (`ring`/`background`,
 *     `border-strong`/`background`, `muted-foreground`/`background`,
 *     `destructive-foreground`/`destructive`).
 *
 * Why `border-strong` and not plain `border`? WCAG 2.1 Success Criterion
 * 1.4.11 ("Non-text Contrast") explicitly carves out "graphical objects that
 * are not required to understand the content" — decorative hairlines that
 * only group elements (cards, separators, panel dividers) do NOT need to
 * clear 3:1. We split the token: `--color-border` is the soft hairline,
 * `--color-border-strong` is reserved for borders that DO convey UI state
 * or affordance (form input outlines, outline buttons, unchecked checkboxes,
 * focus indicators outside of `--color-ring`). Only the strong variant is
 * audited at the WCAG-required threshold.
 *
 * Runs in CI as `pnpm audit:contrast`. Exits 0 on pass, 1 on any failure;
 * always prints the full table.
 *
 * Run locally with: `pnpm audit:contrast`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  parseOklch,
  oklchContrastRatio,
  type OklchColor,
} from '../src/lib/contrast-math.ts';

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const globalsPath = path.join(repoRoot, 'src', 'styles', 'globals.css');

// ---------------------------------------------------------------------------
// Pair definitions (the contract we audit against)
// ---------------------------------------------------------------------------

type PairKind = 'body' | 'ui';

interface Pair {
  /** CSS variable that provides the foreground (text or graphic). */
  fgVar: string;
  /** CSS variable that provides the background surface. */
  bgVar: string;
  /** Body-text (4.5:1) or UI/non-text (3:1). */
  kind: PairKind;
  /** Human-readable label for the report. */
  label: string;
}

const BODY_THRESHOLD = 4.5;
const UI_THRESHOLD = 3.0;

const PAIRS: Pair[] = [
  // Body text on surfaces (4.5:1)
  { fgVar: '--color-foreground', bgVar: '--color-background', kind: 'body', label: 'foreground / background' },
  { fgVar: '--color-foreground', bgVar: '--color-muted', kind: 'body', label: 'foreground / muted' },
  { fgVar: '--color-accent-foreground', bgVar: '--color-accent', kind: 'body', label: 'accent-foreground / accent' },
  { fgVar: '--color-primary-foreground', bgVar: '--color-primary', kind: 'body', label: 'primary-foreground / primary' },
  { fgVar: '--color-destructive-foreground', bgVar: '--color-destructive', kind: 'body', label: 'destructive-foreground / destructive' },

  // UI / non-text (3:1).
  // Note: `--color-border` is intentionally NOT audited — it is the decorative
  // hairline token (WCAG 1.4.11 carve-out). `--color-border-strong` is the
  // affordance-carrying border (form inputs, outline buttons, unchecked
  // checkboxes, focus indicators) and MUST clear 3:1 against the background.
  { fgVar: '--color-ring', bgVar: '--color-background', kind: 'ui', label: 'ring / background' },
  { fgVar: '--color-border-strong', bgVar: '--color-background', kind: 'ui', label: 'border-strong / background' },
  { fgVar: '--color-muted-foreground', bgVar: '--color-background', kind: 'ui', label: 'muted-foreground / background' },
];

/**
 * Accent variants extend a theme by overriding `--accent` (which feeds into
 * `--color-accent-primary`, used for primary buttons/focus rings/dirty dots).
 *
 * `accent-default` (no class) leaves `--accent` unset, so the existing
 * neutral palette applies. The accent overrides are tested as a separate
 * audit pair: `--accent` (foreground role: button background) against
 * `--color-background` — checked at the UI threshold (3:1).
 */
interface AccentVariant {
  name: string;
  /** oklch literal for `--accent` in light mode; `null` for the default neutral. */
  light: string | null;
  /** oklch literal for `--accent` in dark mode; `null` for the default neutral. */
  dark: string | null;
}

const ACCENT_VARIANTS: AccentVariant[] = [
  { name: 'default', light: null, dark: null },
  { name: 'orange', light: 'oklch(68% 0.21 37)', dark: 'oklch(74% 0.19 37)' },
  { name: 'blue', light: 'oklch(56% 0.16 253)', dark: 'oklch(70% 0.14 253)' },
  // `.accent-system` reads `--accent-system-value` set by useAccent at runtime;
  // when unset it falls back to orange (see globals.css comment). We treat it
  // as orange for the audit since that's the deterministic worst case.
  { name: 'system (fallback orange)', light: 'oklch(68% 0.21 37)', dark: 'oklch(74% 0.19 37)' },
];

// ---------------------------------------------------------------------------
// CSS parsing
// ---------------------------------------------------------------------------

type Palette = Record<string, OklchColor>;

/**
 * Extract a palette (variable → oklch) from a CSS rule body.
 *
 * Only neutral oklch values with chroma > 0 OR chroma === 0 are accepted —
 * everything in `globals.css` is oklch by convention. Variables with alpha
 * (e.g. `oklch(92% 0 0 / 0.5)`) are skipped — they're translucent overlays,
 * not solid colors that participate in WCAG contrast.
 */
function extractPaletteFromBody(body: string): Palette {
  const palette: Palette = {};
  // Match: --color-foo: oklch(...);  (single-line declarations only)
  const declRegex = /(--[a-z0-9-]+)\s*:\s*(oklch\([^;]*?\))\s*;/gi;
  for (const match of body.matchAll(declRegex)) {
    const varName = match[1];
    const valueRaw = match[2].trim();
    // Skip values with alpha — not meaningful for solid-color contrast.
    if (valueRaw.includes('/')) continue;
    try {
      palette[varName] = parseOklch(valueRaw);
    } catch {
      // Skip unparseable entries silently — they'll surface elsewhere if needed.
    }
  }
  return palette;
}

/**
 * Find a top-level CSS rule body for a given selector. Handles brace nesting
 * because Tailwind v4 `@theme {}` and `:root {}` blocks contain comments and
 * potentially nested at-rules.
 *
 * Returns the inner body text (without the surrounding braces) or `null`.
 */
function extractRuleBody(css: string, selectorRegex: RegExp): string | null {
  const match = selectorRegex.exec(css);
  if (!match) return null;
  // Find the opening `{` after the match.
  let i = match.index + match[0].length - 1; // points at `{`
  if (css[i] !== '{') return null;
  let depth = 1;
  let j = i + 1;
  while (j < css.length && depth > 0) {
    const ch = css[j];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    j++;
  }
  if (depth !== 0) return null;
  return css.slice(i + 1, j - 1);
}

/**
 * Build the light palette from `@theme { ... }` and the dark palette from
 * `.dark { ... }` rule bodies.
 */
function loadPalettes(): { light: Palette; dark: Palette } {
  const css = readFileSync(globalsPath, 'utf8');

  const themeBody = extractRuleBody(css, /@theme\s*\{/);
  const darkBody = extractRuleBody(css, /\.dark\s*\{/);

  if (!themeBody) {
    throw new Error('Could not locate @theme {} block in globals.css');
  }
  if (!darkBody) {
    throw new Error('Could not locate .dark {} block in globals.css');
  }

  return {
    light: extractPaletteFromBody(themeBody),
    dark: extractPaletteFromBody(darkBody),
  };
}

// ---------------------------------------------------------------------------
// Audit + reporting
// ---------------------------------------------------------------------------

interface PairResult {
  theme: 'light' | 'dark';
  accent: string;
  label: string;
  ratio: number;
  threshold: number;
  passed: boolean;
}

function auditPalette(
  palette: Palette,
  theme: 'light' | 'dark',
  accent: string,
): PairResult[] {
  const results: PairResult[] = [];
  for (const pair of PAIRS) {
    const fg = palette[pair.fgVar];
    const bg = palette[pair.bgVar];
    if (!fg || !bg) {
      // Variable missing — record a synthetic failure so it surfaces.
      results.push({
        theme,
        accent,
        label: `${pair.label} (missing var: ${!fg ? pair.fgVar : pair.bgVar})`,
        ratio: 0,
        threshold: pair.kind === 'body' ? BODY_THRESHOLD : UI_THRESHOLD,
        passed: false,
      });
      continue;
    }
    const ratio = oklchContrastRatio(fg, bg);
    const threshold = pair.kind === 'body' ? BODY_THRESHOLD : UI_THRESHOLD;
    results.push({
      theme,
      accent,
      label: pair.label,
      ratio,
      threshold,
      passed: ratio + 1e-6 >= threshold,
    });
  }
  return results;
}

function auditAccentPair(
  palette: Palette,
  variant: AccentVariant,
  theme: 'light' | 'dark',
): PairResult | null {
  const accentLiteral = theme === 'light' ? variant.light : variant.dark;
  if (!accentLiteral) return null;
  const bg = palette['--color-background'];
  if (!bg) return null;
  const accent = parseOklch(accentLiteral);
  const ratio = oklchContrastRatio(accent, bg);
  return {
    theme,
    accent: variant.name,
    label: 'accent-primary / background',
    ratio,
    threshold: UI_THRESHOLD,
    passed: ratio + 1e-6 >= UI_THRESHOLD,
  };
}

function formatRow(r: PairResult): string {
  const status = r.passed ? 'PASS' : 'FAIL';
  const pad = (s: string, n: number): string => (s + ' '.repeat(n)).slice(0, n);
  return [
    pad(status, 4),
    pad(r.theme, 5),
    pad(r.accent, 24),
    pad(r.label, 44),
    `${r.ratio.toFixed(2).padStart(6)} : 1`,
    `(>= ${r.threshold.toFixed(1)} : 1)`,
  ].join('  ');
}

function printReport(results: PairResult[]): void {
  const header = [
    'STAT',
    'theme',
    'accent                  ',
    'pair                                        ',
    'ratio    ',
    'threshold',
  ].join('  ');
  console.log('');
  console.log('Notesage contrast audit — WCAG AA thresholds');
  console.log('  Body text pairs require 4.5:1; UI / non-text pairs require 3:1.');
  console.log('  Source: src/styles/globals.css');
  console.log('');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of results) {
    console.log(formatRow(r));
  }
}

function summarize(results: PairResult[]): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.passed) passed++;
    else failed++;
  }
  return { passed, failed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const palettes = loadPalettes();

  const allResults: PairResult[] = [];

  // Audit base pairs across light and dark, accent-default only (the base
  // palette pairs don't depend on the accent override).
  allResults.push(...auditPalette(palettes.light, 'light', 'default'));
  allResults.push(...auditPalette(palettes.dark, 'dark', 'default'));

  // Audit accent-primary / background for every variant in both themes.
  for (const variant of ACCENT_VARIANTS) {
    for (const theme of ['light', 'dark'] as const) {
      const palette = theme === 'light' ? palettes.light : palettes.dark;
      const result = auditAccentPair(palette, variant, theme);
      if (result) allResults.push(result);
    }
  }

  printReport(allResults);

  const { passed, failed } = summarize(allResults);
  console.log('');
  console.log(`${passed} passed, ${failed} failed (${allResults.length} total).`);

  if (failed > 0) {
    console.log('');
    console.error(
      `Contrast audit FAILED: ${failed} pair(s) below WCAG AA threshold. ` +
        'See "FAIL" rows above. Adjust the palette in src/styles/globals.css ' +
        'or, if the drop is intentional, update the audit pair list in ' +
        'scripts/contrast-audit.ts with a documented exemption.',
    );
    process.exit(1);
  }
  console.log('Contrast audit PASSED — all pairs meet WCAG AA.');
}

main();
