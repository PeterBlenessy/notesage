import { create } from "zustand";

/**
 * tree-overlay-store — open/closed state for the Quiet Composer TreeOverlay
 * (PRD `2026-04-21-ui-refresh`, Phase 1 task #38).
 *
 * The overlay is a full-workspace tree browser that slides in from the left
 * over the sidebar when the user hits `⌘⇧E`. This store exposes the single
 * open/closed signal plus an optional `focusedPath` so the FolderPeek footer
 * link (task #36) can open the overlay scrolled to a specific project. No
 * persistence — opening the overlay is always a fresh, ephemeral action.
 */

interface TreeOverlayStore {
  /** True when the overlay is currently mounted and visible. */
  open: boolean;
  /**
   * Optional absolute path to scroll into view / expand when the overlay
   * opens. Currently consumed only by the FolderPeek footer link (#36);
   * keyboard-triggered opens leave this `null`.
   */
  focusedPath: string | null;

  /**
   * Opens the overlay. If `focusedPath` is provided the overlay will scroll
   * that path into view on first render — callers should pass a path that
   * exists in the rendered tree (e.g., a project root or a file known to
   * live inside one of the open projects).
   */
  openOverlay: (focusedPath?: string) => void;

  /** Closes the overlay and clears the focused path. */
  closeOverlay: () => void;
}

export const useTreeOverlayStore = create<TreeOverlayStore>((set) => ({
  open: false,
  focusedPath: null,
  openOverlay: (focusedPath) =>
    set({ open: true, focusedPath: focusedPath ?? null }),
  closeOverlay: () => set({ open: false, focusedPath: null }),
}));
