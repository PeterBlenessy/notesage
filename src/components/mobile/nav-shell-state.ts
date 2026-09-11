import { useSyncExternalStore } from "react";

/**
 * Whether the native navigation stack is actually on screen.
 *
 * NOT the same question as "is the flag on", and the difference is a trap:
 * the top row of chrome (back, breadcrumb, "…") is suppressed because the
 * navigation bar provides it, so keying that on the flag alone would strip the
 * back button on any build where the stack failed to present — desktop dev,
 * the vitest suite, a build without the plugin, or an iOS version where
 * `present` threw. A screen with no way back is a worse failure than no native
 * navigation at all.
 *
 * A module-level store rather than React state because the two readers sit in
 * different trees: the hook that presents the stack lives at the app root, and
 * the chrome hook runs inside whichever screen is mounted.
 */
let presented = false;
const listeners = new Set<() => void>();

/**
 * How much room the top of the screen owes to chrome, as a CSS length.
 *
 * Two different things can sit up there and they are NOT the same height:
 *
 * - the floating islands (back, breadcrumb, "…") hover *over* the content, so
 *   the web layer has to reserve their height itself — the notch plus 3.75rem;
 * - a real navigation bar is part of the view controller, so UIKit already
 *   reports it through the web view's safe area. `env(safe-area-inset-top)`
 *   inside the stack is the notch AND the bar.
 *
 * Adding the island allowance on top of a safe area that already includes the
 * bar is what left a bar-height band of dead space under the title, and cost
 * the list its last row (Peter, 2026-09-07).
 *
 * A custom property rather than a boolean threaded through every scroller:
 * the sticky group header, the pull spinner, three scrollers and the injected
 * report stylesheet all need the same number, and the CSS cascade is a better
 * distribution mechanism than six props. The literal fallback keeps the value
 * correct before this module has run at all — a stylesheet default would be a
 * second place to forget.
 */
export const TOP_INSET = "var(--ns-top-inset, calc(3.75rem + env(safe-area-inset-top)))";

/**
 * Mark the document while the native stack owns screen transitions.
 *
 * Same reasoning as `writeTopInset` above: the fact belongs in the cascade
 * rather than threaded through every screen as a prop. There is one consumer
 * today — the `.view-enter` zoom — and the reason it must be a rule and not a
 * conditional in `LibraryBrowser` is that the NEXT screen to reach for
 * `view-enter` would otherwise have to remember this, and would not.
 */
function writeNavShellFlag(value: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.navShell = value ? "true" : "false";
}

function writeTopInset(value: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--ns-top-inset",
    value ? "env(safe-area-inset-top)" : "calc(3.75rem + env(safe-area-inset-top))",
  );
}

export function setNavShellPresented(value: boolean): void {
  // Written even when the value has not changed: the property is the DOM's
  // copy of this fact, and the early return below exists only to avoid waking
  // listeners for a no-op. Skipping the write as well would leave the default
  // state — the common one — never written at all, which is survivable today
  // only because `TOP_INSET` carries a fallback.
  writeTopInset(value);
  writeNavShellFlag(value);
  if (presented === value) return;
  presented = value;
  for (const listener of listeners) listener();
}

export function isNavShellPresented(): boolean {
  return presented;
}

export function useNavShellPresented(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => presented,
    () => false,
  );
}
