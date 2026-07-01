import { create } from "zustand";

/**
 * Holds the DOM node of the QuietSidebar footer's status slot so the editor's
 * `StatusBar` can portal itself there.
 *
 * The status strip (status-tray trigger + word count + focus-mode hint) used to
 * live in a footer at the bottom of the editor column. It was relocated into the
 * sidebar's sticky bottom bar — next to the Settings button — so the document
 * area runs edge-to-edge, top to bottom.
 *
 * `el` is `null` when the sidebar is hidden (`⌘⇧L`) or absent (standalone tests);
 * `StatusBar` then falls back to rendering inline where it's mounted.
 */
interface SidebarStatusSlotState {
  el: HTMLElement | null;
  setEl: (el: HTMLElement | null) => void;
}

export const useSidebarStatusSlotStore = create<SidebarStatusSlotState>((set) => ({
  el: null,
  setEl: (el) => set({ el }),
}));
