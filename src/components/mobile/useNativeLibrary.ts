import { useEffect, useState } from "react";
import { iosSetLibraryBrowsing } from "@/lib/ios-api";
import { t, getLocale, type MessageKey } from "@/lib/i18n";
import { useMobileStore } from "@/stores/mobile-store";

/**
 * Hand folder browsing to the native surface (#1000).
 *
 * The native screen lists, orders and draws a folder itself. This hook does
 * two things and nothing else:
 *
 *   1. tells the native side to take over, and hands it the section-header
 *      strings for the CURRENT language;
 *   2. answers the taps it sends back, by moving the store — so navigation
 *      state has exactly one owner, as it does today.
 *
 * It returns whether native browsing is live, which is what
 * `LibraryBrowser` uses to stop rendering rows. That component keeps running:
 * it still declares the chrome (the search island, the "+", the view menu,
 * the breadcrumb), and those are already native. It simply draws no content.
 *
 * # Why the strings come from here
 *
 * A `.strings` file would be a second localisation source, and it would drift
 * from the `t()` table. The drift shows up as an English header in a Swedish
 * app, which is exactly what #989 was and took three builds to notice. One
 * table, pushed across on every language change.
 */

/** Section headers the native screen can produce. Kept beside the Swift enum
 *  that names them (`LibraryOrdering.swift`) — a key added there without one
 *  here renders as the raw key, which is a visible bug rather than a silent
 *  English word. */
const SECTION_KEYS: MessageKey[] = [
  "section.pinned",
  "section.folders",
  "section.allNotes",
  "section.recent",
  "section.recentlyChanged",
  "section.kind.markdown",
  "section.kind.text",
  "section.kind.pdf",
  "section.kind.image",
  "section.kind.media",
  "section.kind.doc",
  "section.kind.html",
  "section.kind.other",
  // Swipe action titles. The native screen offers the gesture; what each one
  // DOES still lives in `entrySwipeActions`.
  "action.share",
  "action.delete",
];

export function useNativeLibrary(active: boolean): boolean {
  const [live, setLive] = useState(false);
  const locale = getLocale();
  const enterFolder = useMobileStore((s) => s.enterFolder);
  const openDocument = useMobileStore((s) => s.openDocument);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const strings = Object.fromEntries(SECTION_KEYS.map((key) => [key, t(key)]));
    iosSetLibraryBrowsing({ enabled: true, strings })
      .then(() => {
        if (!cancelled) setLive(true);
      })
      .catch(() => {
        // No native layer, or a build without this command: the web browser
        // keeps rendering, exactly as before.
        if (!cancelled) setLive(false);
      });
    return () => {
      cancelled = true;
    };
    // `locale` is a dependency: the headers are pushed across already
    // localised, so a language change has to push them again.
  }, [active, locale]);

  useEffect(() => {
    if (!live) return;
    const onShell = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; kind?: string; relPath?: string }>)
        .detail;
      if (detail?.type !== "open" || !detail.relPath) return;
      // The name is the last path segment — the same thing the row showed,
      // and the store's refs carry a display name alongside the path.
      const name = detail.relPath.split("/").pop() ?? detail.relPath;
      if (detail.kind === "folder") enterFolder({ relPath: detail.relPath, name });
      else openDocument({ relPath: detail.relPath, name });
    };
    window.addEventListener("notesage:nav-shell", onShell);
    return () => window.removeEventListener("notesage:nav-shell", onShell);
  }, [live, enterFolder, openDocument]);

  return live;
}
