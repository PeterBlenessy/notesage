import { useEffect } from "react";

/**
 * useWindowFocus — Quiet Composer audit #17 (2026-04-27 migration).
 *
 * Mirrors macOS-native window de-emphasis behaviour. When the window loses
 * focus (the user clicks into another application), AppKit applies a
 * system-wide pass that desaturates accent colours, dims traffic-light
 * buttons, and softens chrome. WebKit content inside Tauri does not get
 * this treatment for free — it keeps rendering at full saturation
 * regardless of NSWindow key status.
 *
 * This hook subscribes to standard `window` `blur` / `focus` events
 * (which fire reliably in Tauri WebViews — no Tauri-specific API needed)
 * and toggles `data-window-inactive="true"` on the QuietLayout root
 * element identified by `[data-quiet-layout-root]`. CSS rules in
 * `globals.css` key off that attribute to:
 *
 *   1. Re-point `--accent` to the desaturated `--color-accent-primary-inactive`
 *      token, so every consumer of `--color-accent-primary` (primary buttons,
 *      switch ON state, focus rings, editor link, dirty dot, AgentOrb pulse
 *      ring) automatically swaps to neutral grey via the existing
 *      `var(--accent, var(--color-primary))` fallback chain.
 *   2. Apply a subtle opacity dim (`0.85`) to pre-stamped chrome targets
 *      (`[data-quiet-chrome-toolbar]`, `[data-quiet-chrome-status]`,
 *      `[data-quiet-chrome-orb]`) — the same elements `useQuietChrome`
 *      already manages for the fade-on-type pattern.
 *
 * Body text, borders, backgrounds, syntax highlighting, diff colours, and
 * the destructive (red) palette are all left unchanged — desaturating chrome
 * does NOT drop body-text contrast below WCAG AA.
 *
 * Initial state: reads `document.hasFocus()` so a window mounted while
 * already in the background renders correctly without waiting for the
 * first blur event.
 *
 * Mounted from `QuietLayout` only — Quiet Composer is the only shell
 * shipping past Phase 2 (the locked-in 2026-04-27 scoping decision).
 */
export function useWindowFocus(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const ATTR = "data-window-inactive";

    const getRoot = (): HTMLElement | null => {
      return document.querySelector<HTMLElement>("[data-quiet-layout-root]");
    };

    const apply = (focused: boolean): void => {
      const root = getRoot();
      if (!root) return;
      if (focused) {
        root.removeAttribute(ATTR);
      } else {
        root.setAttribute(ATTR, "true");
      }
    };

    // Seed initial state from the platform — covers the case where the app
    // is launched into the background (mount happens while window already
    // unfocused) so the chrome renders desaturated immediately.
    const initiallyFocused =
      typeof document !== "undefined" && typeof document.hasFocus === "function"
        ? document.hasFocus()
        : true;
    apply(initiallyFocused);

    const onFocus = (): void => apply(true);
    const onBlur = (): void => apply(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      // Clean up — leave the root in its focused state so a stale attribute
      // doesn't linger after a hot-reload or unmount in dev mode.
      const root = getRoot();
      root?.removeAttribute(ATTR);
    };
  }, []);
}
