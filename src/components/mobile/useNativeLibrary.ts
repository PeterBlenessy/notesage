import { useEffect, useState } from "react";
import { log } from "@/lib/logger";
import { iosSetLibraryBrowsing, iosSetLibrarySpeech } from "@/lib/ios-api";
import { t, getLocale, type MessageKey } from "@/lib/i18n";
import { toggleSpeech } from "@/lib/speech-controller";
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
  // The Listen control's three states, which are also its accessibility
  // label — the only thing a screen reader has to go on.
  "action.listen",
  "reader.listenPause",
  "reader.listenResume",
  "recording.inProgress",
];

/** Messages the native row interpolates rather than shows as they are: the
 *  reading line is "{left} of {total} min left", and the numbers are only
 *  known in Swift. `t()` with no variables returns the template with its
 *  placeholders intact, which is exactly what has to cross — so the Swedish
 *  word order travels with the Swedish string instead of being assumed. */
const TEMPLATE_KEYS: MessageKey[] = ["list.minutes", "list.minutesLeft", "list.read"];

export function useNativeLibrary(active: boolean): boolean {
  const [live, setLive] = useState(false);
  const locale = getLocale();
  const enterFolder = useMobileStore((s) => s.enterFolder);
  const openDocument = useMobileStore((s) => s.openDocument);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const strings = Object.fromEntries(
      [...SECTION_KEYS, ...TEMPLATE_KEYS].map((key) => [key, t(key)]),
    );
    iosSetLibraryBrowsing({ enabled: true, strings })
      .then(() => {
        if (!cancelled) setLive(true);
      })
      .catch((err) => {
        // No native layer, or a build without this command: the web browser
        // keeps rendering, exactly as before.
        //
        // LOGGED, not swallowed. A bare `.catch(() => {})` here cost a whole
        // build cycle: the native surface staying off looks exactly like a
        // flag being off, and there was nothing anywhere saying which. The
        // nav shell learned the same thing one PRD earlier — see the comment
        // on `present failed` in `useNativeNavShell`.
        log.warn("native-library", `enable failed: ${String(err)}`);
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
      // Read aloud: the native row draws the control, this still does the
      // work — document→speech text, resuming from the stored position, the
      // failure toast. A second player would be a second answer to "where
      // was I".
      else if (detail.kind === "listen") toggleSpeech({ path: detail.relPath, name });
      else openDocument({ relPath: detail.relPath, name });
    };
    window.addEventListener("notesage:nav-shell", onShell);
    return () => window.removeEventListener("notesage:nav-shell", onShell);
  }, [live, enterFolder, openDocument]);

  return live;
}

/**
 * Keep the native rows' Listen controls in step with playback (#833).
 *
 * Split from the hook above because it subscribes to state that changes
 * several times a minute, and `useNativeLibrary`'s own effect must not re-run
 * on every paragraph. State flows ONE way: out to the native rows, which draw
 * it and report taps. Nothing native decides anything about playback.
 */
export function useNativeLibrarySpeech(live: boolean): void {
  const relPath = useMobileStore((s) => s.speech?.relPath ?? null);
  const playing = useMobileStore((s) => s.speech?.playing ?? false);
  const index = useMobileStore((s) => s.speech?.index ?? 0);
  const total = useMobileStore((s) => s.speech?.total ?? 0);
  // One owner of the audio session: no listening while a recording runs.
  const recording = useMobileStore((s) => s.recording.status !== "idle");

  useEffect(() => {
    if (!live) return;
    // The same count the Reader's transport shows ("4 / 12"): both surfaces
    // are visible at once, so they have to agree.
    const fraction = total > 0 ? Math.min(1, (index + 1) / total) : 0;
    // Rejection is not a failure here: a build without the command keeps the
    // rows exactly as they were.
    void iosSetLibrarySpeech({ relPath, playing, fraction, recording }).catch(() => {});
  }, [live, relPath, playing, index, total, recording]);
}
