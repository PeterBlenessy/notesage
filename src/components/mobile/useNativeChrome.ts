import { useEffect, useRef, useState, type CSSProperties } from "react";
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
/**
 * Whether the native chrome layer answered, remembered for the life of the
 * process.
 *
 * The layer cannot appear or vanish at runtime — it is either compiled into
 * this build or it is not — so once it has answered, a later mount can trust
 * the answer immediately. Starting every mount at `false` meant closing a
 * document rendered the WEB fallback header (large title + breadcrumb, in the
 * content) for the frame or two until `ios_set_chrome` resolved, and it then
 * jumped up into the island (Peter, 2026-08-14).
 */
let nativeChromeAnswered: boolean | null = null;

export function useNativeChrome(
  spec: NativeChromeSpec,
  actions: Record<string, (value?: string) => void>,
): boolean {
  const [active, setActive] = useState(nativeChromeAnswered ?? false);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Re-declare only when the SHAPE changes, not on every render.
  const specKey = JSON.stringify(spec);
  useEffect(() => {
    let cancelled = false;
    const parsed = JSON.parse(specKey) as NativeChromeSpec;
    iosSetChrome(parsed)
      .then(() => {
        nativeChromeAnswered = true;
        if (!cancelled) setActive(true);
      })
      .catch(() => {
        nativeChromeAnswered = false;
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

/** Text scale + weight the folder-view surfaces adopt from the device's
 * accessibility settings. `scale` of 1 and `bold` of false is the system
 * default (no Larger Text, Bold Text off). */
export interface A11yPrefs {
  scale: number;
  bold: boolean;
}

const DEFAULT_A11Y_PREFS: A11yPrefs = { scale: 1, bold: false };

/**
 * Tracks the native `notesage:a11y` bridge event — dispatched by the Swift
 * plugin whenever `UIApplication.preferredContentSizeCategory` (Dynamic Type)
 * or `UIAccessibility.isBoldTextEnabled` (Bold Text) changes, and once
 * immediately on install so the web layer isn't stuck at defaults until the
 * user changes a setting. Off-iOS (desktop dev, tests, builds without the
 * native layer) no event ever arrives, so callers stay at the system default.
 *
 * Deliberately narrow to folder-view surfaces (Chrome, FileRow,
 * LibraryBrowser, Onboarding) — document/reader content has its own zoom
 * mechanism and does not consume this hook.
 */
export function useA11yPrefs(): A11yPrefs {
  const [prefs, setPrefs] = useState<A11yPrefs>(DEFAULT_A11Y_PREFS);

  useEffect(() => {
    const onA11y = (e: Event) => {
      const detail = (e as CustomEvent<Partial<A11yPrefs>>).detail;
      if (!detail) return;
      const scale =
        typeof detail.scale === "number" && Number.isFinite(detail.scale) && detail.scale > 0
          ? detail.scale
          : 1;
      setPrefs({ scale, bold: detail.bold === true });
    };
    window.addEventListener("notesage:a11y", onA11y);
    return () => window.removeEventListener("notesage:a11y", onA11y);
  }, []);

  return prefs;
}

/**
 * Root props for a folder-view surface that scales with `useA11yPrefs()`:
 * `--ns-a11y-scale` / `--ns-a11y-weight` CSS custom properties for
 * descendants to consume via `calc()`/`var()` (inherited through the DOM
 * tree, including portaled chrome islands and menus that apply this on
 * their own root).
 */
export function a11yRootProps(prefs: A11yPrefs): {
  style: CSSProperties;
  "data-a11y-scale": number;
  "data-a11y-bold": boolean;
} {
  return {
    style: {
      "--ns-a11y-scale": prefs.scale,
      "--ns-a11y-weight": prefs.bold ? 700 : 400,
    } as CSSProperties,
    "data-a11y-scale": prefs.scale,
    "data-a11y-bold": prefs.bold,
  };
}
