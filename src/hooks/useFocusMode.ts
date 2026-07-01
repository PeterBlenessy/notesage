import { useCallback, useEffect, useRef, useState } from "react";

import { emitCmdBarEvent } from "@/lib/cmd-bar-events";
import { track } from "@/lib/telemetry";
import { registerFocusModeController } from "@/hooks/shortcuts/focus-mode-controller";

/**
 * useFocusMode — Phase 1 #56.
 *
 * Canonical implementation of the "Focus mode — done right" behaviour from
 * the 2026-04-21 UI-refresh PRD:
 *
 *   - `⌘.` (toggle) and `Esc` (exit) are dispatched by the App-root
 *     `useGlobalShortcuts` and routed here via the `focus-mode-controller`
 *     bridge — this hook no longer installs its own keydown listener. It owns
 *     the state, DOM class, announcer, focus-restore, and the `canExitViaEsc`
 *     predicate the dispatcher's Esc guard consults.
 *   - `Esc` exits **with fall-through priority** — open popovers, the command
 *     bar's expanded state, and inline edits all consume `Esc` before focus
 *     mode does (encoded in `canExitViaEsc`). This mirrors the OS convention
 *     that `Esc` always exits the most-current mode.
 *   - Applies `.focus-mode` to the `[data-quiet-layout-root]` node. The
 *     CSS in `globals.css` (`.app.focus-mode …`) fades the sidebar, hides
 *     doc-head/toolbar/status, dims the orb to 30%, and adds +110px
 *     top-padding to the document so text clears the macOS traffic lights.
 *   - Announces enter/exit to screen readers via a short-lived `aria-live`
 *     region on `document.body`, matching the PRD's exact wording.
 *   - Reduced-motion: the hook itself is unaffected (the class toggles
 *     instantly either way). The CSS honours `prefers-reduced-motion` via
 *     a `@media` rule that zeros the transitions.
 *
 * State lives as a single boolean React flag here so consumers (e.g. the
 * `<FocusPill />` overlay) can subscribe. The DOM class is a side-effect
 * that stays in sync via `useEffect`.
 *
 * Mount once at the QuietLayout level. The single-slot controller registration
 * means a second mount would clobber the controller — `registerFocusModeController`
 * only nulls the slot on unmount when it still owns it (identity-checked) to
 * survive StrictMode double-invoke and transient remounts.
 */

const ROOT_SELECTOR = "[data-quiet-layout-root]";
const FOCUS_MODE_CLASS = "focus-mode";

// Fall-through selectors — kept narrow so we don't suppress Esc inside
// dialogs/popovers that manage their own dismissal. Covered cases:
//
//   1. Any Radix-managed popover/dialog/dropdown/tooltip with data-state="open".
//      Radix fires its own onEscapeKeyDown handler; we must not preventDefault
//      or the component's internal listener never sees the key.
//   2. FloatingCommandBar in its expanded state (the bar's own Esc handler
//      collapses it).
//   3. Sidebar / file-tree inline rename rows (data-renaming="true") — the
//      owning component commits or cancels the edit on Esc.
const POPOVER_OPEN_SELECTOR =
  '[data-state="open"][data-radix-popper-content-wrapper],' +
  ' [role="dialog"][data-state="open"],' +
  ' [data-radix-portal] [data-state="open"],' +
  ' [role="menu"][data-state="open"],' +
  ' [role="listbox"][data-state="open"]';
const CMD_BAR_EXPANDED_SELECTOR = '[data-cmd-bar][data-expanded="true"]';
const INLINE_EDIT_SELECTOR =
  '[data-sidebar-inline-edit="true"], [data-renaming="true"]';

const ANNOUNCEMENT_ENTER = "Focus mode on. Press Command period to exit.";
const ANNOUNCEMENT_EXIT = "Focus mode off. Chrome restored.";
const ANNOUNCEMENT_TTL_MS = 2000;

export interface UseFocusModeResult {
  active: boolean;
  toggle: () => void;
  exit: () => void;
}

/**
 * Returns focus-mode state plus imperative `toggle` / `exit` actions, and
 * registers them (plus `canExitViaEsc`) with the global shortcut dispatcher
 * via the focus-mode-controller bridge. The ⌘. / Esc keydown handling lives in
 * `useGlobalShortcuts`, not here.
 *
 * Mount this once, at the QuietLayout level.
 */
export function useFocusMode(): UseFocusModeResult {
  const [active, setActive] = useState<boolean>(false);

  // Keep the latest `active` flag in a ref so the keydown listener (installed
  // exactly once) can read the current value without needing to re-install
  // whenever state changes. Re-installing on every toggle would risk losing
  // in-flight keydown events.
  const activeRef = useRef<boolean>(false);
  activeRef.current = active;

  // Captures `document.activeElement` at the moment focus mode is entered so
  // we can restore focus to the pre-focus-mode element on exit. This matches
  // the 2026-04-21 UI-refresh PRD #84 spec: "Focus returns to pre-focus-mode
  // element." Restoration is skipped if the previously-focused element is
  // `document.body` (i.e. nothing was focused) or has since been detached.
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const toggle = useCallback((): void => {
    setActive((prev) => !prev);
  }, []);

  const exit = useCallback((): void => {
    setActive(false);
  }, []);

  // --- DOM class sync + screen-reader announcement + focus restore ------

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root =
      document.querySelector<HTMLElement>(ROOT_SELECTOR) ?? document.body;
    if (active) {
      // Capture the currently-focused element BEFORE adding the class so we
      // can restore focus on exit. Skip the body fallback — restoring focus
      // to body is indistinguishable from "no focus" and would cause a jarring
      // blur on exit. An empty ref means "don't restore".
      const activeEl = document.activeElement;
      previousFocusRef.current =
        activeEl instanceof HTMLElement && activeEl !== document.body
          ? activeEl
          : null;

      root.classList.add(FOCUS_MODE_CLASS);

      track("feature_used", { feature: "focus_mode" });

      // Task #120: entering focus mode collapses the expanded command bar —
      // focus mode is distraction-free writing and the composer is chrome
      // that belongs out of the way. The bar's bus subscriber (landed in
      // #114) no-ops if the bar is already collapsed, so we emit
      // unconditionally. This `useEffect` runs exactly on the off→on
      // transition (not on every render, not on exit), guaranteeing one
      // emit per enter. The emit is decoupled from the bar's state — the
      // bus is the only bridge between the two modules.
      emitCmdBarEvent({ type: "dismiss" });
    } else {
      root.classList.remove(FOCUS_MODE_CLASS);

      // Restore focus to the pre-focus-mode element on exit. Use
      // `requestAnimationFrame` so React's commit flush has landed and any
      // focus-stealing effects (toolbar mount, overlay unmount) have already
      // run — otherwise our `.focus()` call would be immediately clobbered.
      const target = previousFocusRef.current;
      previousFocusRef.current = null;
      if (
        target !== null &&
        target.isConnected &&
        typeof target.focus === "function" &&
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame === "function"
      ) {
        window.requestAnimationFrame(() => {
          // Re-check isConnected inside rAF — the node might have been removed
          // from the DOM between entering focus mode and exiting it.
          if (target.isConnected) {
            target.focus();
          }
        });
      }
    }

    // Announce the transition to screen readers via a short-lived aria-live
    // region. The FocusPill itself is `aria-hidden="true"` in the PRD because
    // the announcement already does the work.
    const announcer = document.createElement("div");
    announcer.setAttribute("role", "status");
    announcer.setAttribute("aria-live", "polite");
    announcer.setAttribute("data-focus-mode-announcer", "");
    // Visually-hidden styling — the announcer must exist in the accessibility
    // tree but never render on screen. Inline styles keep us independent of
    // Tailwind utilities (tests don't load globals.css).
    announcer.style.position = "absolute";
    announcer.style.width = "1px";
    announcer.style.height = "1px";
    announcer.style.padding = "0";
    announcer.style.margin = "-1px";
    announcer.style.overflow = "hidden";
    announcer.style.clip = "rect(0, 0, 0, 0)";
    announcer.style.whiteSpace = "nowrap";
    announcer.style.border = "0";
    announcer.textContent = active ? ANNOUNCEMENT_ENTER : ANNOUNCEMENT_EXIT;
    document.body.appendChild(announcer);

    const removalTimer = window.setTimeout(() => {
      // The announcer may already have been removed by an unmount cleanup,
      // so parentNode?.removeChild is the safe form.
      announcer.parentNode?.removeChild(announcer);
    }, ANNOUNCEMENT_TTL_MS);

    return () => {
      window.clearTimeout(removalTimer);
      announcer.parentNode?.removeChild(announcer);
    };
  }, [active]);

  // --- Esc fall-through predicate ---------------------------------------

  // True only when an Esc press should exit focus mode: focus mode is active
  // AND nothing higher-priority wants Esc first. Used by the dispatcher both
  // as the `exit-focus-mode` guard (whether to act + preventDefault) and so
  // the key falls through to Radix / command-bar / inline-edit otherwise.
  const canExitViaEsc = useCallback((): boolean => {
    if (typeof document === "undefined") return false;
    if (!activeRef.current) return false;
    // 1) Any open popover/dropdown/dialog — let Radix dismiss it first.
    if (document.querySelector(POPOVER_OPEN_SELECTOR) !== null) return false;
    // 2) Command bar expanded state — its own handler collapses it.
    if (document.querySelector(CMD_BAR_EXPANDED_SELECTOR) !== null) return false;
    // 3) Inline edit row active — the owning component commits/cancels.
    if (document.querySelector(INLINE_EDIT_SELECTOR) !== null) return false;
    // Second safety net: the active element is itself inside a renaming row
    // (some implementations mark the input, not the row).
    const activeEl = document.activeElement;
    if (
      activeEl instanceof Element &&
      activeEl.closest('[data-renaming="true"]') !== null
    ) {
      return false;
    }
    return true;
  }, []);

  // --- Register with the App-root dispatcher ----------------------------

  // ⌘. (toggle) and Esc (exit) are dispatched by `useGlobalShortcuts` like
  // every other chord — matched against the manifest at capture phase. This
  // hook keeps focus mode's state/announcer/focus-restore and exposes its
  // imperative actions through the controller bridge.
  useEffect(() => {
    return registerFocusModeController({ toggle, exit, canExitViaEsc });
  }, [toggle, exit, canExitViaEsc]);

  // --- Unmount cleanup: never leave `.focus-mode` on the root ----------

  useEffect(() => {
    return () => {
      if (typeof document === "undefined") return;
      const root = document.querySelector<HTMLElement>(ROOT_SELECTOR);
      if (root) {
        root.classList.remove(FOCUS_MODE_CLASS);
      } else {
        document.body.classList.remove(FOCUS_MODE_CLASS);
      }
      // Best-effort removal of any orphan announcer elements the effect
      // above may have left behind if unmount happened before the TTL.
      document
        .querySelectorAll("[data-focus-mode-announcer]")
        .forEach((node) => {
          node.parentNode?.removeChild(node);
        });
    };
  }, []);

  return { active, toggle, exit };
}
