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
 * `onLongPress` receives the press point in CSS pixels, which is what the
 * native action sheet wants for its iPad anchor. The returned `suppressClick`
 * handler must be spread onto the same element: iOS still delivers a `click`
 * after the finger lifts, and without swallowing it a long press that opened
 * the menu would ALSO open the document behind it.
 */
export function useLongPress(onLongPress: (at: { x: number; y: number }) => void) {
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
      const at = { x: e.clientX, y: e.clientY };
      origin.current = at;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress(at);
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
