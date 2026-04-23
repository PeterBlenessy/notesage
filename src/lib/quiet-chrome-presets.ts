/**
 * Pure half of quiet-chrome (ui-refresh #51) — types, preset table, and
 * resolver. Split out from `quiet-chrome.ts` so `settings-store.ts` can
 * import the presets without pulling React or the hook in, which would
 * create a circular dependency (store ← lib/quiet-chrome ← store).
 *
 * The React hook lives in `quiet-chrome.ts` and re-exports these symbols
 * so external callers can keep their `@/lib/quiet-chrome` import.
 */

/**
 * User-selectable presets. "custom" is not a preset — it's the sentinel the
 * store flips to when any individual override is toggled.
 */
export type QuietChromePreset = "relaxed" | "default" | "aggressive";

/**
 * Per-element fade toggles. `true` → the element fades under `.app.typing`;
 * `false` → it stays fully visible regardless of typing.
 */
export interface QuietChromeTargets {
  toolbar: boolean;
  status: boolean;
  docHead: boolean;
  sidebar: boolean;
  orb: boolean;
}

/**
 * The preset table from PRD `2026-04-21-ui-refresh`:
 *
 * - Relaxed    → minimal fade (toolbar + status only)
 * - Default    → recommended (toolbar + status + doc-head)
 * - Aggressive → deep focus (everything including sidebar dim and orb dim)
 *
 * Focus mode is NOT a preset — `Cmd+.` is owned by task #56 and operates at
 * a different layer.
 */
export const QUIET_CHROME_PRESETS: Record<QuietChromePreset, QuietChromeTargets> = {
  relaxed: {
    toolbar: true,
    status: true,
    docHead: false,
    sidebar: false,
    orb: false,
  },
  default: {
    toolbar: true,
    status: true,
    docHead: true,
    sidebar: false,
    orb: false,
  },
  aggressive: {
    toolbar: true,
    status: true,
    docHead: true,
    sidebar: true,
    orb: true,
  },
};

/**
 * Resolve the effective per-element targets for the current settings.
 *
 * - If `preset` is one of the named presets, return that preset's mapping
 *   verbatim — the overrides are ignored (they apply only in "custom" mode).
 * - If `preset === "custom"`, return the overrides as-is.
 *
 * Pure function — no store access, safe for unit tests.
 */
export function resolveQuietChromeTargets(
  preset: QuietChromePreset | "custom",
  overrides: QuietChromeTargets,
): QuietChromeTargets {
  if (preset === "custom") return overrides;
  return QUIET_CHROME_PRESETS[preset];
}
