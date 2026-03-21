import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { theme, softMode } = useSettingsStore();

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark", "soft");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }

    if (softMode) {
      root.classList.add("soft");
    }
  }, [theme, softMode]);

  return <>{children}</>;
}
