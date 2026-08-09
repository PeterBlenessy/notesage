import { useEffect, useState } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { getContrastVariables, CONTRAST_VARIABLE_NAMES } from "@/lib/contrast";

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { theme, contrastLevel, tintHue, tintChroma } = useSettingsStore();

  // Re-resolve when the OS appearance changes while theme is "system". The
  // matchMedia check in the effect below runs once per dependency change, so
  // without this listener the app keeps whatever appearance it launched with —
  // most visible on iOS, where the app stays alive across the phone's
  // light/dark switches (auto sunset switching included).
  const [systemTick, setSystemTick] = useState(0);
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemTick((t) => t + 1);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Why: theme is keyed off `.light` / `.dark` classes on <html> — never a
  // `data-theme` attribute. globals.css uses `@custom-variant dark (&:where(.dark, .dark *))`
  // and bare `.dark` selectors throughout. Do NOT reintroduce data-theme; see
  // ThemeProvider.test.tsx for the regression lock.
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
  }, [theme, contrastLevel, tintHue, tintChroma, systemTick]);

  return <>{children}</>;
}
