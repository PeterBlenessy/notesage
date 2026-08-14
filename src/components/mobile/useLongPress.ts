import { useRef } from "react";

/** Hold duration (ms) before a press becomes a long press — matches the
 *  system's own context-menu delay closely enough to feel native. */
const HOLD_MS = 500;
/** Movement (px) that turns a hold into a scroll and cancels it. */
const MOVE_TOLERANCE = 10;

/**
 * Long-press detection for a web element that must still scroll and tap
 * normally (#680).
 *
 * `onLongPress` receives the pressed element's rect in CSS pixels — the
 * native preview grows out of it and shrinks back into it. The handlers must
 * be spread onto that element as a set: iOS still delivers a `click` after
 * the finger lifts, and without swallowing it a long press that opened the
 * menu would ALSO open the document behind it.
 */
export interface PressRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function useLongPress(onLongPress: (rect: PressRect | undefined) => void) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      // Measure NOW, while the element is still where the finger landed —
      // by the time the hold completes the list may have settled elsewhere.
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const rect: PressRect | undefined =
        box.width > 0 && box.height > 0
          ? { x: box.x, y: box.y, width: box.width, height: box.height }
          : undefined;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress(rect);
      }, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const start = origin.current;
      if (!start) return;
      if (
        Math.abs(e.clientX - start.x) > MOVE_TOLERANCE ||
        Math.abs(e.clientY - start.y) > MOVE_TOLERANCE
      ) {
        clear();
      }
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onClickCapture: (e: React.MouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
