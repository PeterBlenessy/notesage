import { useEffect, useState } from "react";
import { log } from "@/lib/logger";
import {
  iosSetLibraryBrowsing,
  iosSetLibraryFilter,
  iosSetLibrarySpeech,
  iosSetLibraryView,
} from "@/lib/ios-api";
import { t, getLocale, type MessageKey } from "@/lib/i18n";
import { toggleSpeech } from "@/lib/speech-controller";
import { useMobileStore, resolveFolderView, screenKeyOf } from "@/stores/mobile-store";
import { HOME_KEY } from "@/lib/home-file";

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
  // Home's own rows (#1000 step 4): the way to the uncurated root, and the
  // one-off tip saying where the folders went. The two cards show the
  // FOLDERS' names, which are not translated.
  "home.allFolders",
  "home.hint",
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
      const detail = (
        event as CustomEvent<{
          type?: string;
          kind?: string;
          relPath?: string;
          title?: string;
        }>
      ).detail;
      // `typeof`, not truthiness: the ROOT's relative path is the empty
      // string, which is falsy. `!detail.relPath` dropped every event about
      // it — which is why Home's "All Folders" row, the first thing that ever
      // opens the root BY PATH, did nothing at all (#1000 step 4).
      if (detail?.type !== "open" || typeof detail.relPath !== "string") return;
      // `name` stays the FILE's name: the viewer is chosen from its
      // extension. `title` is what the row displayed — for a saved article
      // the capture's own title, sent by the native side because that is the
      // side that read the header.
      const name = detail.relPath.split("/").pop() ?? detail.relPath;
      const title = detail.title || undefined;
      // A folder shows the title the native row carried where there is one —
      // "All Folders" is the root under another name, and the last path
      // segment of the root is the empty string.
      if (detail.kind === "folder")
        enterFolder({ relPath: detail.relPath, name: title || name });
      // Read aloud: the native row draws the control, this still does the
      // work — document→speech text, resuming from the stored position, the
      // failure toast. A second player would be a second answer to "where
      // was I".
      else if (detail.kind === "listen") toggleSpeech({ path: detail.relPath, name });
      else if (detail.kind === "document")
        openDocument({ relPath: detail.relPath, name, title });
      // Everything else is NOT ours. `menu` and `swipe:*` belong to
      // `LibraryBrowser`'s listener, which has the listing needed to find the
      // entry. This used to end in a bare `else openDocument(...)`, so
      // raising the entry menu or tapping ANY swipe action also opened the
      // document behind it — which read as a tap passing through to the row
      // and was blamed on the gesture for a while (build 65).
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

/**
 * Keep the native folder screen showing what the "…" menu says (#1000).
 *
 * The menu is still the web layer's, and it writes `folderViews` in the
 * store. Build 64 stopped there: the native screen read its settings from
 * `UserDefaults` once when it was constructed, nothing ever wrote them, and
 * nothing told a live screen they had changed — so list/gallery, density,
 * sort and group were ALL inert, not just the two that were noticed first.
 *
 * One way, like the speech session: the menu owns the choice, the native
 * screen owns the drawing.
 */
export function useNativeLibraryView(live: boolean): void {
  // FOUR primitive selectors, not one returning `resolveFolderView(...)`.
  // That builds a fresh object on every call, so zustand sees a new value
  // each render and re-renders forever — "Maximum update depth exceeded",
  // which on a device is a hang rather than a message.
  const screenKey = useMobileStore((s) => screenKeyOf(s.folderStack));
  const layout = useMobileStore((s) => resolveFolderView(s, screenKeyOf(s.folderStack)).viewMode);
  const density = useMobileStore(
    (s) => resolveFolderView(s, screenKeyOf(s.folderStack)).listDensity,
  );
  const sort = useMobileStore((s) => resolveFolderView(s, screenKeyOf(s.folderStack)).sortMode);
  const group = useMobileStore((s) => resolveFolderView(s, screenKeyOf(s.folderStack)).groupMode);

  useEffect(() => {
    if (!live) return;
    // Home is the web layer's own screen and has no native folder screen to
    // tell — `screenKeyOf` gives it HOME_KEY rather than a folder path.
    if (!screenKey || screenKey === HOME_KEY) return;
    void iosSetLibraryView({
      relPath: screenKey,
      layout,
      condensed: density === "condensed",
      sort,
      group,
    }).catch((err) => {
      log.warn("native-library", `view push failed: ${String(err)}`);
    });
  }, [live, screenKey, layout, density, sort, group]);
}

/**
 * Filter-as-you-type on a native folder screen (#1000).
 *
 * The search island is native chrome, but its text arrives in the web layer
 * first, so the screen has to be told. `apply(filter:)` has existed on the
 * screen since the start with no caller at all, which meant typing filtered
 * nothing while the PRD listed it as done.
 */
export function useNativeLibraryFilter(live: boolean, query: string): void {
  const screenKey = useMobileStore((s) => screenKeyOf(s.folderStack));

  useEffect(() => {
    if (!live || !screenKey || screenKey === HOME_KEY) return;
    void iosSetLibraryFilter({ relPath: screenKey, query }).catch((err) => {
      log.warn("native-library", `filter push failed: ${String(err)}`);
    });
  }, [live, screenKey, query]);
}
