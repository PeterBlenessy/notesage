import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  iosNavShellSetAction,
  iosSetChrome,
  type IosChromeItem,
  type IosChromeBreadcrumb,
  type IosChromePlayer,
  type IosChromeRecorder,
  type IosChromeSearch,
  type IosChromeStatus,
} from "@/lib/ios-api";
import { useNavShellPresented } from "./nav-shell-state";
import { useChromeStatus } from "./chrome-status";

export interface NativeChromeSpec {
  topLeft?: IosChromeItem;
  topRight?: IosChromeItem;
  topCenter?: IosChromeBreadcrumb;
  bottomRight?: IosChromeItem;
  /** Read-aloud transport (#833). Native rather than a React island: a
   *  captured article is presented in a separate native web view ABOVE the
   *  app's own, so a React-rendered bar is simply behind it. */
  bottomCenter?: IosChromePlayer;
  /** The recording island (recordings PRD); takes the player's slot while
   *  a recording runs — the two never coexist. */
  bottomRecorder?: IosChromeRecorder;
  search?: IosChromeSearch;
  /** Passive app-global status. NOT set by callers — `useNativeChrome` fills
   *  it from `chrome-status.ts`, because it belongs to the app rather than to
   *  any one screen. It is a field of this type all the same: the type is
   *  where the slot's occupants are written down, and one that is passed
   *  across the bridge but absent here is one nobody arbitrates. */
  bottomStatus?: IosChromeStatus;
}

/**
 * The bottom-centre slot's four occupants, and who decides where they go.
 *
 * `search`, `bottomCenter` (the read-aloud transport), `bottomRecorder` and
 * the app-global status line all land in the same strip of screen. None of
 * them can see the others from here, so NONE of them is positioned here:
 * `ChromeOverlay.layoutBottomColumn` stacks all four, and it is the only
 * thing that may. Twice now an occupant was positioned by whoever rendered it
 * and landed on top of another — search over the recorder's Stop button
 * (build 50), the web sweep indicator under the search pill (build 60, #995).
 *
 * The status line is merged in below rather than being a field of
 * `NativeChromeSpec`, because it is app-global and the spec is per-screen.
 * See `chrome-status.ts`.
 */

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

/**
 * Has the native chrome layer answered, and what did it say?
 *
 * `null` until the first screen has declared its chrome. For a surface that
 * is not itself a screen — the sweep indicator — the three states matter:
 * `true` means the native layer draws the bottom-centre column and a web
 * island there would collide with it, `false` means there is no native layer
 * and the web island is the only chrome there will be, and `null` means the
 * question has not been asked yet and the honest answer is to draw nothing
 * for the frame or two until it has.
 */
export function nativeChromeStatus(): boolean | null {
  return nativeChromeAnswered;
}

/**
 * Test seam: set (or with no argument, forget) the memoised answer.
 *
 * A test that renders a chrome-aware surface on its own has to say which
 * world it is in, because the behaviour genuinely differs: with a native
 * layer the bottom-centre column is drawn natively and a web island there
 * would collide with it; without one the web island is the only chrome.
 */
export function setNativeChromeAnswer(answer: boolean | null = null): void {
  nativeChromeAnswered = answer;
}

export function useNativeChrome(
  spec: NativeChromeSpec,
  actions: Record<string, (value?: string) => void>,
): boolean {
  const [active, setActive] = useState(nativeChromeAnswered ?? false);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  // With the native navigation shell up, the TOP row belongs to the
  // navigation bar: back is the system's, the title is the bar's, and the "…"
  // menu moves to a bar button — the same menu, sent to a different place, so
  // every action keeps working through the same `notesage:chrome` channel.
  // The bottom islands (the "+", the player, the recorder, the search pill)
  // are not navigation and stay exactly where they are.
  // Whether the bar is actually THERE, not merely whether the flag is on —
  // see `nav-shell-state`.
  const navShell = useNavShellPresented();

  // App-global, so it is not part of the caller's spec — see the note above
  // `NativeChromeSpec`. Folded into `specKey` so a change re-declares the
  // chrome exactly like any other part of the shape.
  const status = useChromeStatus();

  // Re-declare only when the SHAPE changes, not on every render.
  const specKey = JSON.stringify({ ...spec, bottomStatus: status ?? undefined });
  useEffect(() => {
    let cancelled = false;
    const full = JSON.parse(specKey) as NativeChromeSpec;
    const parsed: NativeChromeSpec = navShell
      ? { ...full, topLeft: undefined, topCenter: undefined, topRight: undefined }
      : full;
    if (navShell) {
      // The whole control, not just its menu — see `NavShellAction`.
      void iosNavShellSetAction(full.topRight ?? null).catch(() => {});
    }
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
  }, [specKey, navShell]);

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
