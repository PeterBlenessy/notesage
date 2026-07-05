import { useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import {
  EXPANDED_HEIGHT_MIN,
  EXPANDED_HEIGHT_MAX,
  EXPANDED_HEIGHT_KEYBOARD_STEP,
} from "@/components/cmd/useCommandBarGeometry";

// ---------------------------------------------------------------------------
// TopResizeHandle — horizontal drag handle on the top edge of the floating
// expanded bar. Dragging up increases height, dragging down decreases it.
// The bar is anchored at the bottom, so the new height is the distance from
// the pointer to the bar's bottom edge.
//
// Height state lives in the `--cmd-bar-expanded-height` CSS variable on
// <html>; the React store is only written on pointerup / keyup, same as
// the width-resize handle pattern.
// ---------------------------------------------------------------------------

export function TopResizeHandle() {
  const persistedHeight = useSettingsStore((s) => s.cmdBarExpandedHeight);
  const setCmdBarExpandedHeight = useSettingsStore((s) => s.setCmdBarExpandedHeight);

  // Sync the persisted height to the CSS variable on mount and whenever the
  // store value changes (e.g., on rehydration after restart).
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--cmd-bar-expanded-height",
      `${persistedHeight}px`,
    );
  }, [persistedHeight]);

  // Pointer drag — write to the CSS variable on every move, persist on up.
  // The bar is fixed bottom-10, so height = bottom_edge_y - pointer_y.
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      document.documentElement.setAttribute("data-cmd-bar-resizing", "true");

      // The bottom of the bar is at viewport_height - bottom_offset.
      // We read it once at drag-start to keep it stable during the drag.
      const barEl = target.parentElement;
      const barBottom = barEl ? barEl.getBoundingClientRect().bottom : window.innerHeight - 40;

      const compute = (clientY: number) => {
        return Math.round(
          Math.max(
            EXPANDED_HEIGHT_MIN,
            Math.min(EXPANDED_HEIGHT_MAX, barBottom - clientY),
          ),
        );
      };

      const onMove = (moveEvent: PointerEvent) => {
        document.documentElement.style.setProperty(
          "--cmd-bar-expanded-height",
          `${compute(moveEvent.clientY)}px`,
        );
      };

      const onUp = (upEvent: PointerEvent) => {
        setCmdBarExpandedHeight(compute(upEvent.clientY));
        target.releasePointerCapture(event.pointerId);
        document.documentElement.removeAttribute("data-cmd-bar-resizing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setCmdBarExpandedHeight],
  );

  // Keyboard adjustment — ↑/↓ adjust height by ±20 px while focused.
  // ArrowUp grows the bar, ArrowDown shrinks it.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const delta =
        event.key === "ArrowUp"
          ? EXPANDED_HEIGHT_KEYBOARD_STEP
          : -EXPANDED_HEIGHT_KEYBOARD_STEP;
      const next = Math.max(
        EXPANDED_HEIGHT_MIN,
        Math.min(EXPANDED_HEIGHT_MAX, persistedHeight + delta),
      );
      document.documentElement.style.setProperty(
        "--cmd-bar-expanded-height",
        `${next}px`,
      );
      setCmdBarExpandedHeight(next);
    },
    [persistedHeight, setCmdBarExpandedHeight],
  );

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Resize command bar height"
      aria-orientation="vertical"
      aria-valuemin={EXPANDED_HEIGHT_MIN}
      aria-valuemax={EXPANDED_HEIGHT_MAX}
      aria-valuenow={persistedHeight}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      data-cmd-bar-resize-handle
      className={cn(
        // Hair-thin 1px strip on the top edge — matches the edge-handle
        // rhythm (`h-px`, hover highlight, generous pseudo-element hit
        // target). Thinner-at-rest + brighter-on-hover (consistent with
        // the side handles).
        "absolute top-0 left-0 w-full h-px cursor-row-resize",
        "bg-transparent hover:bg-muted-foreground transition-colors",
        "focus-visible:outline-none focus-visible:bg-muted-foreground",
        // 16px-tall invisible hit target centred on the visible 1px line.
        "after:absolute after:inset-x-0 after:top-1/2 after:h-4 after:-translate-y-1/2",
        "z-10",
      )}
    />
  );
}

export default TopResizeHandle;
