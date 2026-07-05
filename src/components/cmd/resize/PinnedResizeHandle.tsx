import { useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import {
  PINNED_WIDTH_MIN,
  PINNED_WIDTH_MAX,
  PINNED_WIDTH_KEYBOARD_STEP,
} from "@/components/cmd/useCommandBarGeometry";

// ---------------------------------------------------------------------------
// PinnedResizeHandle — vertical drag handle on the left edge of the pinned
// panel. The actual width state lives in the `--cmd-bar-pinned-width` CSS
// variable on <html>; we only persist the final value to settings-store on
// pointerup / keyup. This keeps mousemove paths free of React re-renders.
// ---------------------------------------------------------------------------

export function PinnedResizeHandle() {
  const persistedWidth = useSettingsStore((s) => s.cmdBarPinnedWidth);
  const setCmdBarPinnedWidth = useSettingsStore((s) => s.setCmdBarPinnedWidth);

  // Sync the persisted width to the CSS variable on mount and whenever the
  // store value changes (e.g., on rehydration after restart).
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--cmd-bar-pinned-width",
      `${persistedWidth}px`,
    );
  }, [persistedWidth]);

  // Pointer drag — write to the CSS variable on every move, persist on up.
  // `data-cmd-bar-resizing="true"` on <html> disables the bar's
  // `transition-all duration-200` so the width tracks the cursor with
  // zero lag (live-test 2026-04-26 — see `globals.css`).
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      document.documentElement.setAttribute("data-cmd-bar-resizing", "true");

      const onMove = (moveEvent: PointerEvent) => {
        // The panel docks to the right edge, so the new width is the
        // distance from the pointer to the right edge of the viewport.
        const next = Math.round(
          Math.max(
            PINNED_WIDTH_MIN,
            Math.min(PINNED_WIDTH_MAX, window.innerWidth - moveEvent.clientX),
          ),
        );
        document.documentElement.style.setProperty(
          "--cmd-bar-pinned-width",
          `${next}px`,
        );
      };

      const onUp = (upEvent: PointerEvent) => {
        const finalWidth = Math.round(
          Math.max(
            PINNED_WIDTH_MIN,
            Math.min(PINNED_WIDTH_MAX, window.innerWidth - upEvent.clientX),
          ),
        );
        setCmdBarPinnedWidth(finalWidth);
        target.releasePointerCapture(event.pointerId);
        document.documentElement.removeAttribute("data-cmd-bar-resizing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setCmdBarPinnedWidth],
  );

  // Keyboard adjustment — ←/→ adjust width by ±20 px while focused. Persist
  // immediately (no need to defer; key events are coarse-grained).
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      // ArrowLeft makes the panel WIDER (it grows away from the right edge).
      const delta =
        event.key === "ArrowLeft"
          ? PINNED_WIDTH_KEYBOARD_STEP
          : -PINNED_WIDTH_KEYBOARD_STEP;
      const current = persistedWidth;
      const next = Math.max(
        PINNED_WIDTH_MIN,
        Math.min(PINNED_WIDTH_MAX, current + delta),
      );
      // Update the CSS variable immediately so the user sees the change,
      // then persist via the store setter (which will re-sync on the next
      // effect run, but this avoids any flicker).
      document.documentElement.style.setProperty(
        "--cmd-bar-pinned-width",
        `${next}px`,
      );
      setCmdBarPinnedWidth(next);
    },
    [persistedWidth, setCmdBarPinnedWidth],
  );

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Resize chat panel"
      aria-orientation="vertical"
      aria-valuemin={PINNED_WIDTH_MIN}
      aria-valuemax={PINNED_WIDTH_MAX}
      aria-valuenow={persistedWidth}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      data-cmd-bar-resize-handle
      className={cn(
        // Hair-thin 1px strip on the left edge: `w-px`, hover highlight,
        // generous pseudo-element hit target. Thinner-at-rest +
        // brighter-on-hover is the look the user requested
        // (live-test 2026-04-26).
        "absolute left-0 top-0 h-full w-px cursor-col-resize",
        // Invisible at rest (the bar's own border carries the edge);
        // distinctly visible on hover/focus.
        "bg-transparent hover:bg-muted-foreground transition-colors",
        "focus-visible:outline-none focus-visible:bg-muted-foreground",
        // 16px-wide invisible hit target centred on the visible 1px line so
        // the comfortable click area doesn't fight the hairline aesthetic.
        "after:absolute after:inset-y-0 after:left-1/2 after:w-4 after:-translate-x-1/2",
        // Sit above the panel content so pointer events land on the handle.
        "z-10",
      )}
    />
  );
}

export default PinnedResizeHandle;
