import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * React hook that tracks the OS-level `prefers-reduced-motion: reduce` setting.
 *
 * Reactive: subscribes to changes via `matchMedia` so toggling the system
 * preference at runtime updates consuming components without remount.
 *
 * Returns `false` when `window.matchMedia` is unavailable (SSR / non-browser).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(QUERY);
    const handler = (event: MediaQueryListEvent | { matches: boolean }) => {
      setReduced(event.matches);
    };
    mql.addEventListener("change", handler as (event: MediaQueryListEvent) => void);
    return () => {
      mql.removeEventListener("change", handler as (event: MediaQueryListEvent) => void);
    };
  }, []);

  return reduced;
}
