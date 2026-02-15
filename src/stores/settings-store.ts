import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";
export type ContentWidth = "full" | "auto" | "a4" | "a5" | "letter";

interface SettingsStore {
  theme: Theme;
  showFloatingToolbar: boolean;
  contentWidth: ContentWidth;
  sidebarOpen: boolean;
  chatPanelOpen: boolean;
  setTheme: (theme: Theme) => void;
  setShowFloatingToolbar: (show: boolean) => void;
  setContentWidth: (width: ContentWidth) => void;
  setSidebarOpen: (open: boolean) => void;
  setChatPanelOpen: (open: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: "system",
      showFloatingToolbar: true,
      contentWidth: "auto",
      sidebarOpen: true,
      chatPanelOpen: false,

      setTheme: (theme: Theme) => {
        set({ theme });
      },

      setShowFloatingToolbar: (show: boolean) => {
        set({ showFloatingToolbar: show });
      },

      setContentWidth: (width: ContentWidth) => {
        set({ contentWidth: width });
      },

      setSidebarOpen: (open: boolean) => {
        set({ sidebarOpen: open });
      },

      setChatPanelOpen: (open: boolean) => {
        set({ chatPanelOpen: open });
      },
    }),
    {
      name: "notesage-settings",
    }
  )
);
