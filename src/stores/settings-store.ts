import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";

interface SettingsStore {
  theme: Theme;
  showFloatingToolbar: boolean;
  setTheme: (theme: Theme) => void;
  setShowFloatingToolbar: (show: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: "system",
      showFloatingToolbar: true,

      setTheme: (theme: Theme) => {
        set({ theme });
      },

      setShowFloatingToolbar: (show: boolean) => {
        set({ showFloatingToolbar: show });
      },
    }),
    {
      name: "notesage-settings",
    }
  )
);
