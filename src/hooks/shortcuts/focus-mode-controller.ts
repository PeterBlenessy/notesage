/**
 * Focus-mode controller bridge.
 *
 * `useFocusMode` owns focus mode's React state, DOM class, screen-reader
 * announcer, and focus restoration. The keyboard chords (⌘. toggle, Esc exit)
 * live in the App-root dispatcher (`useGlobalShortcuts`) like every other
 * shortcut. This module is the thin bridge: `useFocusMode` registers its
 * imperative actions here on mount; the dispatcher's `toggle-focus-mode` /
 * `exit-focus-mode` actions (and the Esc fall-through guard) call through it.
 *
 * Single-slot registration (mirrors `registerZoomController` in
 * `useEditorZoom`) — focus mode is mounted once at the QuietLayout level.
 */
export interface FocusModeController {
  toggle: () => void;
  exit: () => void;
  /**
   * True only when an Esc press should exit focus mode: focus mode is active
   * AND nothing higher-priority (an open popover/dialog, the expanded command
   * bar, or an inline rename row) wants to claim Esc first. Drives both the
   * dispatcher's exit guard and whether Esc is preventDefault-ed.
   */
  canExitViaEsc: () => boolean;
}

let controller: FocusModeController | null = null;

/**
 * Register the active controller. Returns an unregister function that only
 * clears the slot if it still holds THIS controller — so a stale instance's
 * cleanup (StrictMode double-invoke, a transient remount) can't null out the
 * live instance's registration.
 */
export function registerFocusModeController(
  next: FocusModeController,
): () => void {
  controller = next;
  return () => {
    if (controller === next) controller = null;
  };
}

export function getFocusModeController(): FocusModeController | null {
  return controller;
}
