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
 *
 * Note: `cmdbar` only fades when the FloatingCommandBar is BOTH minimized
 * (collapsed pill, not expanded, not pinned) AND unfocused — that gating
 * lives in the CSS selector, not here. The `:not(:hover):not(:focus-within)`
 * guard is standard for every target.
 */
export interface QuietChromeTargets {
  toolbar: boolean;
  status: boolean;
  docHead: boolean;
  sidebar: boolean;
  orb: boolean;
  titlebar: boolean;
  cmdbar: boolean;
}

/**
 * The preset table. Living spec lives in `docs/design-system.md` →
 * "Fade-on-Type Pattern".
 *
 * - Relaxed    → minimal fade (toolbar + status only)
 * - Default    → recommended (toolbar + status + doc-head)
 * - Aggressive → deep focus (everything including title bar dim, minimized
 *   command bar fade, sidebar dim, orb dim — and a narrower cancel-signal
 *   set in `useFadeOnType` that requires actual mouse movement to unfade)
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
    titlebar: false,
    cmdbar: false,
  },
  default: {
    toolbar: true,
    status: true,
    docHead: true,
    sidebar: false,
    orb: false,
    titlebar: false,
    cmdbar: false,
  },
  aggressive: {
    toolbar: true,
    status: true,
    docHead: true,
    sidebar: true,
    orb: true,
    titlebar: true,
    cmdbar: true,
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
