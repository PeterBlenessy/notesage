import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { getContrastVariables, CONTRAST_VARIABLE_NAMES } from "@/lib/contrast";

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { theme, contrastLevel, tintHue, tintChroma } = useSettingsStore();

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");

    let resolvedTheme: "light" | "dark";
    if (theme === "system") {
      resolvedTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    } else {
      resolvedTheme = theme;
    }
    root.classList.add(resolvedTheme);

    // Apply contrast level and color tint via inline CSS variables
    if (contrastLevel > 0 || tintChroma > 0) {
      const vars = getContrastVariables(resolvedTheme, contrastLevel, tintChroma, tintHue);
      for (const [name, value] of Object.entries(vars)) {
        root.style.setProperty(name, value);
      }
    } else {
      // Remove any inline overrides — let base CSS apply
      for (const name of CONTRAST_VARIABLE_NAMES) {
        root.style.removeProperty(name);
      }
    }

    return () => {
      // Clean up inline styles on unmount
      for (const name of CONTRAST_VARIABLE_NAMES) {
        root.style.removeProperty(name);
      }
    };
  }, [theme, contrastLevel, tintHue, tintChroma]);

  return <>{children}</>;
}
