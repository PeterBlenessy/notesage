import { useState, useEffect } from "react";

/**
 * Transient, session-only editor view-zoom multiplier.
 *
 * Layered on top of the persisted font size — never touches editor-styles-store.
 * Module-level state so it acts as an app-wide singleton: every editor tab
 * reads the same multiplier, and the value is lost on app restart.
 *
 * Consumers:
 *  - Editor.tsx: reads `zoom` via the hook, writes `--editor-zoom-multiplier`
 *    CSS variable on the editor container element.
 *  - editor.css: `font-size: calc(var(--ns-paragraph-font-size) * var(--editor-zoom-multiplier, 1))`
 *  - useKeyboardShortcuts.ts: calls increaseZoom / decreaseZoom / resetZoom.
 */

const ZOOM_STEP = 1.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;

let zoomLevel = 1.0;

/** All currently mounted hook instances — notified on every zoom change. */
const subscribers = new Set<(zoom: number) => void>();

function notify() {
  subscribers.forEach((fn) => fn(zoomLevel));
}

/** Increase the zoom multiplier by one step (×1.1), capped at 2.0. */
export function increaseZoom(): void {
  zoomLevel = Math.min(ZOOM_MAX, zoomLevel * ZOOM_STEP);
  notify();
}

/** Decrease the zoom multiplier by one step (÷1.1), floored at 0.5. */
export function decreaseZoom(): void {
  zoomLevel = Math.max(ZOOM_MIN, zoomLevel / ZOOM_STEP);
  notify();
}

/** Reset the zoom multiplier to exactly 1.0 (no zoom). */
export function resetZoom(): void {
  zoomLevel = 1.0;
  notify();
}

/**
 * React hook that exposes the current zoom value and the three action
 * functions. Re-renders whenever zoom changes.
 *
 * The hook itself does NOT persist state — quitting and relaunching the app
 * always starts at 1.0.
 */
export function useEditorZoom() {
  const [zoom, setZoom] = useState(zoomLevel);

  useEffect(() => {
    // Sync in case the module-level value changed between renders.
    setZoom(zoomLevel);
    subscribers.add(setZoom);
    return () => {
      subscribers.delete(setZoom);
    };
  }, []);

  return { zoom, increaseZoom, decreaseZoom, resetZoom };
}
