import { useEffect, useRef, useState } from "react";
import { iosSetChrome, type IosChromeItem, type IosChromeBreadcrumb, type IosChromeSearch } from "@/lib/ios-api";

export interface NativeChromeSpec {
  topLeft?: IosChromeItem;
  topRight?: IosChromeItem;
  topCenter?: IosChromeBreadcrumb;
  bottomRight?: IosChromeItem;
  search?: IosChromeSearch;
}

/**
 * Declare native Liquid Glass chrome (real SwiftUI buttons hosted over the
 * webview) and receive taps back as `notesage:chrome` events. Returns
 * whether native chrome is ACTIVE — when false (desktop dev, tests, builds
 * without the native layer) the caller renders its web islands instead, so
 * the app never ends up with no chrome at all.
 *
 * The action map is kept in a ref so tap handling always sees current
 * state without re-declaring the chrome on every render.
 */
export function useNativeChrome(
  spec: NativeChromeSpec,
  actions: Record<string, (value?: string) => void>,
): boolean {
  const [active, setActive] = useState(false);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Re-declare only when the SHAPE changes, not on every render.
  const specKey = JSON.stringify(spec);
  useEffect(() => {
    let cancelled = false;
    const parsed = JSON.parse(specKey) as NativeChromeSpec;
    iosSetChrome(parsed)
      .then(() => {
        if (!cancelled) setActive(true);
      })
      .catch(() => {
        if (!cancelled) setActive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [specKey]);

  useEffect(() => {
    const onChrome = (e: Event) => {
      const detail = (e as CustomEvent<{ id?: string; value?: string }>).detail;
      if (detail?.id) actionsRef.current[detail.id]?.(detail.value);
    };
    window.addEventListener("notesage:chrome", onChrome);
    return () => window.removeEventListener("notesage:chrome", onChrome);
  }, []);

  return active;
}
