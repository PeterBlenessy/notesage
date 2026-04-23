import { useEffect } from "react";

/**
 * useFadeOnType — Phase 1 #50.
 *
 * Adds the class `typing` to the QuietLayout root element (identified by
 * `[data-quiet-layout-root]`) whenever the user is actively typing. The class
 * is removed after 1200 ms of inactivity, or immediately when the user moves
 * the mouse, scrolls, shifts focus, or otherwise signals non-typing intent.
 *
 * CSS selectors in `globals.css` (`.app.typing [data-quiet-toolbar]`,
 * `.app.typing [data-doc-head]`, …) use the class to fade pre-stamped chrome
 * targets during active typing. The pre-stamped components (#48 DocHead, #49
 * Toolbar pill) already carry a 340 ms `transition-opacity` so the fade is
 * applied by this hook flipping the class alone.
 *
 * Behaviour:
 *
 * - Typing events (`keydown`, `keypress`, `input`) add `.typing`.
 * - Cancel events (`mousemove`, `wheel`, `scroll`, `focusin`) remove it.
 * - A 1200 ms inactivity timer auto-removes it if no cancel signal fires.
 * - Targets inside the FloatingCommandBar (`[data-cmd-bar]` /
 *   `.cmdbar` / `.cmd-bar`) are excluded — the user may be typing the chat
 *   prompt itself, which must stay fully visible.
 * - Honors `prefers-reduced-motion`: when reduce is set the hook is a
 *   no-op (no listeners installed, `.typing` never added). A matchMedia
 *   change listener re-enables the hook if the user toggles the preference
 *   at runtime.
 *
 * State lives on the DOM (the `.typing` class) rather than Zustand — the CSS
 * selector is the read path and every tick doesn't need a React re-render.
 *
 * Mounted from `QuietLayout` only, so activation is already gated behind the
 * `quiet-composer` UI preview flag.
 */
export function useFadeOnType(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
    const TYPING_CLASS = "typing";
    const INACTIVITY_MS = 1200;
    // `[data-cmd-bar]` is the FloatingCommandBar's root attribute.
    // `.cmdbar` / `.cmd-bar` kept as forward-compatible fallbacks per the
    // task spec in case the pill adopts a class-based selector later.
    const CMD_BAR_SELECTOR = "[data-cmd-bar], .cmdbar, .cmd-bar";

    const mql =
      typeof window.matchMedia === "function"
        ? window.matchMedia(REDUCED_MOTION_QUERY)
        : null;

    let timerId: ReturnType<typeof setTimeout> | null = null;
    let typingListenersInstalled = false;

    const getRoot = (): HTMLElement => {
      const root = document.querySelector<HTMLElement>(
        "[data-quiet-layout-root]",
      );
      return root ?? document.body;
    };

    const clearTimer = (): void => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    };

    const removeTypingClass = (): void => {
      clearTimer();
      getRoot().classList.remove(TYPING_CLASS);
    };

    const addTypingClass = (): void => {
      const root = getRoot();
      root.classList.add(TYPING_CLASS);
      clearTimer();
      timerId = setTimeout(() => {
        getRoot().classList.remove(TYPING_CLASS);
        timerId = null;
      }, INACTIVITY_MS);
    };

    const isInsideCmdBar = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return target.closest(CMD_BAR_SELECTOR) !== null;
    };

    const onTypingEvent = (event: Event): void => {
      if (isInsideCmdBar(event.target)) return;
      addTypingClass();
    };

    const onCancelEvent = (): void => {
      removeTypingClass();
    };

    const installListeners = (): void => {
      if (typingListenersInstalled) return;
      typingListenersInstalled = true;

      // Typing signals — capture phase so we observe them before React
      // handlers stop propagation (e.g. ChatInput's preventDefault).
      document.addEventListener("keydown", onTypingEvent, { capture: true });
      document.addEventListener("keypress", onTypingEvent, { capture: true });
      document.addEventListener("input", onTypingEvent, { capture: true });

      // Cancel signals — passive because we never preventDefault and we
      // want to stay off the scrolling fast path.
      document.addEventListener("mousemove", onCancelEvent, {
        capture: true,
        passive: true,
      });
      document.addEventListener("wheel", onCancelEvent, {
        capture: true,
        passive: true,
      });
      document.addEventListener("scroll", onCancelEvent, {
        capture: true,
        passive: true,
      });
      document.addEventListener("focusin", onCancelEvent, { capture: true });
    };

    const removeListeners = (): void => {
      if (!typingListenersInstalled) return;
      typingListenersInstalled = false;

      document.removeEventListener("keydown", onTypingEvent, { capture: true });
      document.removeEventListener("keypress", onTypingEvent, {
        capture: true,
      });
      document.removeEventListener("input", onTypingEvent, { capture: true });
      document.removeEventListener("mousemove", onCancelEvent, {
        capture: true,
      });
      document.removeEventListener("wheel", onCancelEvent, { capture: true });
      document.removeEventListener("scroll", onCancelEvent, { capture: true });
      document.removeEventListener("focusin", onCancelEvent, { capture: true });
    };

    // Initial install — only if the user does NOT have reduce motion set.
    if (!mql?.matches) {
      installListeners();
    }

    // React to matchMedia changes so live toggles of the system preference
    // take effect without an app restart.
    const onMediaChange = (event: MediaQueryListEvent): void => {
      if (event.matches) {
        removeListeners();
        removeTypingClass();
      } else {
        installListeners();
      }
    };

    if (mql) {
      mql.addEventListener("change", onMediaChange);
    }

    return () => {
      if (mql) {
        mql.removeEventListener("change", onMediaChange);
      }
      removeListeners();
      // Always clean up the class + timer — unmount should never leave the
      // DOM in a "typing" state that the next layout would inherit.
      removeTypingClass();
    };
  }, []);
}
