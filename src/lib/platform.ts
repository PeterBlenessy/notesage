/**
 * Platform detection for the mobile (iOS) shell split.
 *
 * The Notesage desktop shell (`QuietLayout`) and the read-only mobile shell
 * (`MobileApp`) are chosen at the root (`main.tsx`) by `isIos()`. We branch at
 * the root — not inside `App.tsx` — so the desktop lifecycle hooks (AI, ACP,
 * watcher, git, telemetry, editor) are never *called* on mobile (Rules of
 * Hooks forbid conditionally calling them lower down).
 *
 * v1 uses a user-agent heuristic rather than `@tauri-apps/plugin-os` to avoid
 * adding a native plugin + capability that can't be validated outside a Mac
 * build. The heuristic covers iPhone/iPad (incl. iPadOS reporting as "Mac" with
 * touch). A `__NOTESAGE_FORCE_PLATFORM__` global override exists for tests and
 * for forcing the mobile shell during desktop development.
 *
 * TODO(ios-wiring): once the iOS target exists, switch to the authoritative
 * `@tauri-apps/plugin-os` `platform()` and drop the UA heuristic.
 */

declare global {
  interface Window {
    __NOTESAGE_FORCE_PLATFORM__?: "ios" | "desktop";
  }
}

/** True when running on iOS (iPhone or iPad), or forced via the test override. */
export function isIos(): boolean {
  if (typeof window !== "undefined" && window.__NOTESAGE_FORCE_PLATFORM__) {
    return window.__NOTESAGE_FORCE_PLATFORM__ === "ios";
  }
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent || "";
  if (/iPhone|iPod/.test(ua)) return true;
  // Explicit iPad UA (older iPadOS / Safari "Request Desktop Site" off).
  if (/iPad/.test(ua)) return true;
  // iPadOS 13+ reports as "Macintosh" but is a touch device. A real Mac has
  // maxTouchPoints 0 (or 1 with some trackpads); iPad reports > 1.
  const isMacUA = /Macintosh|Mac OS X/.test(ua);
  const touchPoints = typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0;
  if (isMacUA && touchPoints > 1) return true;

  return false;
}

/** Alias kept for readability at call sites that only care "is this the mobile shell". */
export function isMobile(): boolean {
  return isIos();
}
