/**
 * Quiet chrome — React hook entry point (ui-refresh #51).
 *
 * Lives on top of #50 `useFadeOnType`, which owns the global `.typing` pulse
 * on the QuietLayout root. This module decides WHICH chrome targets fade
 * under that pulse. Three presets ship by default, plus a "custom" mode that
 * honours per-element overrides from Settings > General > Quiet chrome.
 *
 * Read path is pure CSS: `useQuietChrome()` writes data attributes onto the
 * `[data-quiet-layout-root]` element (`data-quiet-chrome-toolbar="fade" |
 * "stay"`, etc.) and the stylesheet keys off them in combination with
 * `.app.typing` — zero React re-renders per keystroke.
 *
 * Command-bar fade rule (see `docs/design-system.md` →
 * "Fade-on-Type Pattern" for the living spec): the FloatingCommandBar
 * fades ONLY while it is minimized (collapsed pill, not expanded, not
 * pinned) AND unfocused AND unhovered. The selector lives in
 * `globals.css`; the typing-signal exclusion for `[data-cmd-bar]` still
 * applies (typing inside the composer never triggers a fade pulse).
 *
 * Types and the preset table live in `quiet-chrome-presets.ts` so the
 * settings-store can import them without pulling React in and causing a
 * circular dependency.
 */
import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import {
  resolveQuietChromeTargets,
  type QuietChromeTargets,
} from "./quiet-chrome-presets";

// Re-export the pure half so external callers keep a single entry point.
export {
  QUIET_CHROME_PRESETS,
  resolveQuietChromeTargets,
  type QuietChromePreset,
  type QuietChromeTargets,
} from "./quiet-chrome-presets";

/**
 * The chrome-target keys and the data attribute suffix CSS matches on.
 * Kept next to the hook so adding a new target means touching one place.
 */
const TARGET_ATTRS: ReadonlyArray<readonly [keyof QuietChromeTargets, string]> = [
  ["toolbar", "data-quiet-chrome-toolbar"],
  ["status", "data-quiet-chrome-status"],
  ["docHead", "data-quiet-chrome-dochead"],
  ["sidebar", "data-quiet-chrome-sidebar"],
  ["orb", "data-quiet-chrome-orb"],
  ["titlebar", "data-quiet-chrome-titlebar"],
  ["cmdbar", "data-quiet-chrome-cmdbar"],
];

/**
 * Apply the resolved targets as data attributes on the QuietLayout root.
 *
 * - `true`  → `data-quiet-chrome-<target>="fade"` — CSS fades this element
 *   while `.app.typing` is active.
 * - `false` → `data-quiet-chrome-<target>="stay"` — CSS rule short-circuits,
 *   the element stays fully opaque.
 *
 * Falls back to `document.body` if the QuietLayout root is not mounted yet
 * (e.g. legacy layout). In that case the attributes are no-ops because the
 * CSS selectors anchor on `.app`.
 *
 * The `cmdbar` attribute is ALSO mirrored to `<html>` so the FloatingCommandBar
 * (which portals to `document.body` and is therefore a sibling of the layout
 * root, not a descendant) can be reached by a `:root[data-quiet-chrome-cmdbar="fade"]`
 * selector. Every other target lives inside the layout subtree and is matched
 * via `.app[data-quiet-chrome-…]` as before.
 */
function applyTargets(targets: QuietChromeTargets): void {
  if (typeof document === "undefined") return;
  const root =
    document.querySelector<HTMLElement>("[data-quiet-layout-root]") ??
    document.body;
  if (!root) return;
  for (const [key, attr] of TARGET_ATTRS) {
    root.setAttribute(attr, targets[key] ? "fade" : "stay");
  }
  // Mirror just the cmdbar gate to `<html>` for the portal'd command bar.
  document.documentElement.setAttribute(
    "data-quiet-chrome-cmdbar",
    targets.cmdbar ? "fade" : "stay",
  );
}

/**
 * `useQuietChrome` — React hook mounted from QuietLayout alongside
 * `useFadeOnType`. Subscribes to the preset + overrides from
 * `settings-store` and writes the resulting per-element data attributes
 * onto the quiet layout root every time they change.
 *
 * Implementation notes:
 *
 * - State lives on the store, not a ref, so Settings panel changes flow
 *   through reactively without manual re-dispatch.
 * - The subscription is scoped to the two relevant slices; unrelated
 *   settings mutations don't re-run the effect.
 * - We also write on mount so the attributes are present before the user
 *   ever types (some consumers — e.g. hover-only sidebar fade — want a
 *   stable attribute even outside `.app.typing`).
 */
export function useQuietChrome(): void {
  const preset = useSettingsStore((s) => s.quietChromePreset);
  const overrides = useSettingsStore((s) => s.quietChromeOverrides);

  useEffect(() => {
    const targets = resolveQuietChromeTargets(preset, overrides);
    applyTargets(targets);
  }, [preset, overrides]);
}
