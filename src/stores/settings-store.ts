import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";

interface SettingsStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: "system",

      setTheme: (theme: Theme) => {
        set({ theme });
      },
    }),
    {
      name: "notesage-settings",
    }
  )
);
