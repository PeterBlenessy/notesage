import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useSettingsStore } from "@/stores/settings-store";

/** Breathing room in px between the cursor row bottom and the cmd bar top edge. */
const BREATHING_ROOM_PX = 60;

/** Minimum ms between consecutive scroll corrections to avoid animation fights. */
const THROTTLE_MS = 16;

/**
 * Prevents the floating command bar from hiding the cursor row during typing.
 *
 * On each keydown event the hook:
 * 1. Reads the cursor's screen coordinates via `window.getSelection()`.
 * 2. Reads the floating cmd bar's top edge via `getBoundingClientRect()`.
 * 3. If the cursor bottom is within BREATHING_ROOM_PX of the cmd bar top,
 *    smoothly scrolls the editor container upward by the overlap amount.
 *
 * Only active in Quiet Composer floating mode (`cmdBarPinned === false`).
 * Skips if the DOM cmd bar element itself reports `data-cmd-bar-pinned="true"`
 * (defence-in-depth against stale store state during transitions).
 */
export function useCursorScrollGuard(
  scrollContainerRef: RefObject<HTMLElement | null>,
): void {
  const cmdBarPinned = useSettingsStore((s) => s.cmdBarPinned);
  const lastFireTime = useRef(0);

  const guardScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const cmdBar = document.querySelector<HTMLElement>("[data-cmd-bar]");
    if (!cmdBar) return;
    if (cmdBar.getAttribute("data-cmd-bar-pinned") === "true") return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const cursorRect = range.getBoundingClientRect();
    // Guard against a fully degenerate rect (browser returned all-zero values,
    // meaning the range has no screen position — e.g. selection outside the
    // rendered viewport).  A collapsed cursor on an empty line is NOT degenerate:
    // it has height === 0 but valid top/bottom reflecting its real y position.
    if (!cursorRect || (cursorRect.top === 0 && cursorRect.bottom === 0)) return;

    const safeBottom = cmdBar.getBoundingClientRect().top - BREATHING_ROOM_PX;

    if (cursorRect.bottom > safeBottom) {
      container.scrollBy({
        top: cursorRect.bottom - safeBottom,
        behavior: "smooth",
      });
    }
  }, [scrollContainerRef]);

  useEffect(() => {
    if (cmdBarPinned) return;

    const onKeydown = () => {
      const now = Date.now();
      if (now - lastFireTime.current < THROTTLE_MS) return;
      lastFireTime.current = now;
      guardScroll();
    };

    document.addEventListener("keydown", onKeydown, { capture: true });
    return () => {
      document.removeEventListener("keydown", onKeydown, { capture: true });
    };
  }, [cmdBarPinned, guardScroll]);
}
