import { useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import {
  EXPANDED_WIDTH_MIN,
  EXPANDED_WIDTH_MAX,
  EXPANDED_WIDTH_KEYBOARD_STEP,
} from "@/components/cmd/useCommandBarGeometry";

// ---------------------------------------------------------------------------
// ExpandedResizeHandle — vertical drag handle on either edge of the
// floating expanded bar. The bar is horizontally centred, so width changes
// twice as fast as the cursor delta — one cursor pixel of drag moves both
// edges by one pixel, growing the width by two. This makes whichever edge
// the user grabs follow the cursor exactly.
//
// Width state lives in the `--cmd-bar-expanded-width` CSS variable on
// <html>; the React store is only written on pointerup / keyup, same as
// the pinned handle pattern.
// ---------------------------------------------------------------------------

export function ExpandedResizeHandle({ side }: { side: "left" | "right" }) {
  const persistedWidth = useSettingsStore((s) => s.cmdBarExpandedWidth);
  const setCmdBarExpandedWidth = useSettingsStore((s) => s.setCmdBarExpandedWidth);

  // Sync the persisted width to the CSS variable on mount and whenever the
  // store value changes (e.g., on rehydration after restart). Both handles
  // share the same variable so this effect runs in either instance — that's
  // fine; setProperty is idempotent.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--cmd-bar-expanded-width",
      `${persistedWidth}px`,
    );
  }, [persistedWidth]);

  // `data-cmd-bar-resizing="true"` on <html> disables the bar's
  // `transition-all duration-200` so width tracks the cursor without lag.
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      document.documentElement.setAttribute("data-cmd-bar-resizing", "true");

      const startX = event.clientX;
      const startWidth = persistedWidth;
      // Right-edge drag: rightward cursor → wider; deltaWidth = +2 * deltaX
      // Left-edge drag:  leftward cursor → wider;  deltaWidth = -2 * deltaX
      const sign = side === "right" ? 1 : -1;

      const compute = (clientX: number) => {
        const deltaX = clientX - startX;
        return Math.round(
          Math.max(
            EXPANDED_WIDTH_MIN,
            Math.min(EXPANDED_WIDTH_MAX, startWidth + 2 * sign * deltaX),
          ),
        );
      };

      const onMove = (moveEvent: PointerEvent) => {
        document.documentElement.style.setProperty(
          "--cmd-bar-expanded-width",
          `${compute(moveEvent.clientX)}px`,
        );
      };

      const onUp = (upEvent: PointerEvent) => {
        setCmdBarExpandedWidth(compute(upEvent.clientX));
        target.releasePointerCapture(event.pointerId);
        document.documentElement.removeAttribute("data-cmd-bar-resizing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [persistedWidth, side, setCmdBarExpandedWidth],
  );

  // Keyboard adjustment — ←/→ adjust width by ±20 px while focused. Direction
  // is consistent regardless of which side handle is focused: ArrowRight
  // grows the bar, ArrowLeft shrinks it. (The pinned handle inverts because
  // its panel grows away from the right edge; the floating bar grows
  // symmetrically, so the convention is "right widens".)
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const delta =
        event.key === "ArrowRight"
          ? EXPANDED_WIDTH_KEYBOARD_STEP
          : -EXPANDED_WIDTH_KEYBOARD_STEP;
      const next = Math.max(
        EXPANDED_WIDTH_MIN,
        Math.min(EXPANDED_WIDTH_MAX, persistedWidth + delta),
      );
      document.documentElement.style.setProperty(
        "--cmd-bar-expanded-width",
        `${next}px`,
      );
      setCmdBarExpandedWidth(next);
    },
    [persistedWidth, setCmdBarExpandedWidth],
  );

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Resize command bar"
      aria-orientation="vertical"
      aria-valuemin={EXPANDED_WIDTH_MIN}
      aria-valuemax={EXPANDED_WIDTH_MAX}
      aria-valuenow={persistedWidth}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      data-cmd-bar-resize-handle
      data-cmd-bar-resize-side={side}
      className={cn(
        // Hair-thin 1px strip on the chosen edge: `w-px`, hover
        // highlight, 16px pseudo-element hit target. Thinner-at-rest +
        // brighter-on-hover (live-test 2026-04-26).
        "absolute top-0 h-full w-px cursor-col-resize",
        side === "right" ? "right-0" : "left-0",
        "bg-transparent hover:bg-muted-foreground transition-colors",
        "focus-visible:outline-none focus-visible:bg-muted-foreground",
        // 16px-wide invisible hit target centred on the visible line.
        "after:absolute after:inset-y-0 after:left-1/2 after:w-4 after:-translate-x-1/2",
        "z-10",
      )}
    />
  );
}

export default ExpandedResizeHandle;
