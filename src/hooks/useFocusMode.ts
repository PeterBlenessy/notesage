import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useFocusMode — Phase 1 #56.
 *
 * Canonical implementation of the "Focus mode — done right" behaviour from
 * the 2026-04-21 UI-refresh PRD:
 *
 *   - `⌘.` (or `Ctrl+.` on non-mac) toggles focus mode from any state.
 *   - `Esc` exits focus mode **with fall-through priority** — open popovers,
 *     the command bar's expanded state, and inline edits all consume `Esc`
 *     before focus mode does. Only when nothing else claims the key do we
 *     exit focus. This mirrors the OS convention that `Esc` always exits
 *     the most-current mode.
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
 * Intentionally scoped to QuietLayout — the legacy shell still owns its
 * own `focusMode` useState + useKeyboardShortcuts handler in App.tsx. This
 * hook uses a capture-phase, `stopImmediatePropagation` handler for `⌘.`
 * so the legacy bubble-phase listener never fires while QuietLayout is
 * mounted, avoiding double-toggles.
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
 * Returns focus-mode state plus imperative `toggle` / `exit` actions. Installs
 * window-level capture-phase keydown listeners for `⌘.` and `Escape`.
 *
 * Mount this once, at the QuietLayout level. Mounting twice would install
 * duplicate listeners and double-toggle on every `⌘.` press.
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

  // --- Keyboard listeners ------------------------------------------------

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      // ⌘. / Ctrl+. — toggle focus mode. We own this chord while the
      // QuietLayout is mounted; stopImmediatePropagation keeps the legacy
      // App-level handler from also firing.
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.shiftKey && !event.altKey && event.key === ".") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setActive((prev) => !prev);
        return;
      }

      // Escape — fall-through chain. Only we act (and only when active);
      // otherwise we let the event propagate so Radix/command-bar/inline-edit
      // handlers can claim it.
      if (event.key !== "Escape") return;
      if (!activeRef.current) return;

      // 1) Any open popover/dropdown/dialog — let Radix dismiss it first.
      if (document.querySelector(POPOVER_OPEN_SELECTOR) !== null) {
        return;
      }
      // 2) Command bar expanded state — its own handler collapses it.
      if (document.querySelector(CMD_BAR_EXPANDED_SELECTOR) !== null) {
        return;
      }
      // 3) Inline edit row active — the owning component commits/cancels.
      if (document.querySelector(INLINE_EDIT_SELECTOR) !== null) {
        return;
      }
      // Second safety net: if the active element is itself inside a
      // renaming row (some implementations don't mark the row but do mark
      // the input), defer. Matches the spec's suggestion to check
      // `document.activeElement?.closest('[data-renaming="true"]')`.
      const activeEl = document.activeElement;
      if (
        activeEl instanceof Element &&
        activeEl.closest('[data-renaming="true"]') !== null
      ) {
        return;
      }

      // 4) Nothing else claimed Escape — exit focus mode.
      event.preventDefault();
      setActive(false);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, []);

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
