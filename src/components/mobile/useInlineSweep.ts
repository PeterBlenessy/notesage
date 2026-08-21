import { useCallback, useEffect, useRef, useState } from "react";
import { iosInlineArticleImages, iosListDirectory } from "@/lib/ios-api";
import { evictThumbnail } from "@/lib/mobile-thumbnails";
import { INBOX_FOLDER_NAME } from "@/lib/inbox";
import type { FileEntry } from "@/lib/tauri";
import { useMobileStore } from "@/stores/mobile-store";

/**
 * Make captured articles self-contained in the background (task #1.5 of
 * `docs/prds/2026-08-21-self-contained-articles.md`).
 *
 * A shared article saves with remote image URLs, so it is not the article —
 * it is a recipe for fetching it, good only while the network holds and the
 * CDN still serves those paths. This finishes the job afterwards, so sharing
 * stays instant and the saved document still ends up readable offline.
 *
 * **Why the app and not the share extension.** The extension has a ~120 MB
 * ceiling and, more importantly, the user is watching a sheet — ten images on
 * hotel wifi is a hang. Here nobody is waiting.
 *
 * **Why the app root and not the library browser.** LibraryBrowser unmounts
 * the moment a document opens. A sweep hosted there would stop the instant the
 * user started reading — the same class of bug as scoping a global listener to
 * a collapsible surface. It lives at the root and announces its results.
 *
 * **Why nothing here can jank the UI.** This function starts a native job and
 * awaits a COUNT. The fetching, downsampling and rewriting all happen off the
 * webview thread and the image bytes never enter JavaScript; the only thing
 * crossing IPC is a number. See `ios_inline_article_images`.
 */

/** Only these are article captures; everything else in the Inbox is ignored. */
/**
 * Announce that documents changed, at most once a second.
 *
 * Each announcement makes the library reload its whole listing. One per
 * document is fine for a handful of Inbox items and ruinous for the
 * retroactive pass, which is hundreds — that would be hundreds of full
 * listings rebuilt to show thumbnails that are still arriving. Throttling
 * keeps the visible progress (the user sees cards fill in) without the storm.
 */
function makeAnnouncer() {
  let last = 0;
  let pending = false;
  const fire = () => {
    last = performance.now();
    pending = false;
    window.dispatchEvent(new CustomEvent(INLINE_SWEEP_EVENT));
  };
  return {
    announce() {
      if (performance.now() - last >= ANNOUNCE_THROTTLE_MS) {
        fire();
      } else if (!pending) {
        pending = true;
        setTimeout(fire, ANNOUNCE_THROTTLE_MS);
      }
    },
    /** Always fire at the end, so the final state is never left unshown. */
    flush() {
      if (pending || performance.now() - last > 0) fire();
    },
  };
}

function isArticleHtml(entry: FileEntry): boolean {
  if (entry.is_directory) return false;
  const lower = entry.name.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}

/**
 * Fired after a document gains embedded images, so whatever is showing the
 * library can reload and pick up the regenerated thumbnail.
 *
 * A window event rather than a callback prop because this hook is mounted at
 * the APP ROOT, not inside the browser — see `useInlineSweep`'s note on why.
 * The two surfaces have no parent-child relationship to pass a callback down.
 */
export const INLINE_SWEEP_EVENT = "notesage:inline-sweep-updated";

/** Asks the root-mounted sweep to process an explicit list of paths — the
 *  retroactive pass, triggered from the library menu. Same direction problem
 *  as INLINE_SWEEP_EVENT, opposite way round. */
export const INLINE_SWEEP_REQUEST = "notesage:inline-sweep-request";

/** Minimum gap between listing-refresh announcements. */
const ANNOUNCE_THROTTLE_MS = 1000;

/** What the passive indicator needs to know. `total` is the number of
 *  documents this sweep will attempt, `done` how many it has finished. */
export interface SweepProgress {
  active: boolean;
  done: number;
  total: number;
}

export function useInlineSweep() {
  // Read from the store rather than a prop: this hook has no parent that knows
  // what is open. Held in a REF, not a dependency: `sweep` only needs the
  // value at the moment it runs, and making it a dep meant `sweep` changed
  // identity on every document open and close — which re-fired the mount
  // effect and started a fresh sweep each time. Cheap, since the guards catch
  // it, but it is not what the effect claims to do.
  const openDocPath = useMobileStore((s) => s.openDoc?.relPath ?? null);
  const openDocRef = useRef(openDocPath);
  openDocRef.current = openDocPath;
  /**
   * Paths attempted this session.
   *
   * Not a correctness mechanism — `ios_inline_article_images` returns 0 for a
   * document with nothing remote left, so a repeat is harmless. This exists to
   * stop the sweep re-reading every Inbox file on every single foreground,
   * which on a large Inbox is real IPC and real disk for a guaranteed no-op.
   */
  const attempted = useRef<Set<string>>(new Set());
  const announcer = useRef(makeAnnouncer());
  /** One sweep at a time; a second foreground mid-sweep must not double it. */
  const running = useRef(false);
  const [progress, setProgress] = useState<SweepProgress>({
    active: false,
    done: 0,
    total: 0,
  });

  const sweep = useCallback(async () => {
    if (running.current) return;
    // Read the settings ONCE, here, rather than per document. A change made
    // mid-sweep would otherwise produce one article with 2048px images and the
    // next with 1200px — the kind of inconsistency that is invisible until
    // someone compares two files and cannot explain the difference.
    const {
      inlineImagesEnabled,
      imageMaxPixel,
      imageQuality,
    } = useMobileStore.getState();
    if (!inlineImagesEnabled) return;
    // "original" is sent as an explicit 0, NOT as undefined. Undefined means
    // "caller expressed no preference" and the command applies its 1600
    // default — so omitting the field would silently ignore the user's choice
    // and downsample anyway. 0 means "no cap" and the native side skips
    // downsampling entirely rather than "resizing" to a number larger than
    // the source.
    const maxPixel = imageMaxPixel === "original" ? 0 : imageMaxPixel;
    // Offline, every fetch would fail and every document would be marked
    // attempted — burning the one cheap retry this session had. Skipping
    // leaves them for the next foreground, when there may be a network.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    running.current = true;
    try {
      let entries: FileEntry[];
      try {
        entries = await iosListDirectory(INBOX_FOLDER_NAME);
      } catch {
        // No Inbox yet (nothing ever shared). Not an error.
        return;
      }

      // Decide the work set BEFORE starting, so the indicator can show a
      // stable "n of m" rather than a total that grows as it goes.
      const todo = entries.filter(
        (e) =>
          isArticleHtml(e) &&
          !attempted.current.has(e.path) &&
          // Rewriting a file the user is reading would swap the document under
          // them mid-scroll. It keeps its remote images until next time.
          !(openDocRef.current && e.path === openDocRef.current),
      );
      if (todo.length === 0) return;
      setProgress({ active: true, done: 0, total: todo.length });

      for (const [index, entry] of todo.entries()) {
        try {
          const inlined = await iosInlineArticleImages(entry.path, {
            maxPixel,
            jpegQuality: imageQuality,
          });
          // Marked only on SUCCESS. Marking before the call meant a document
          // that failed on a flaky network was skipped for the rest of the
          // session, even once the signal came back — the sweep had silently
          // spent its one attempt.
          attempted.current.add(entry.path);
          if (inlined > 0) {
            // The thumbnail cache is keyed by path and never expires, so
            // without this the article keeps the text-only thumbnail taken
            // before the sweep and the fix looks like it did nothing.
            evictThumbnail(entry.path);
            announcer.current.announce();
          }
        } catch {
          // Deliberately NOT marked attempted: one bad document must not stop
          // the rest, and it should get another try on the next foreground
          // rather than waiting for an app restart.
        }
        setProgress({ active: true, done: index + 1, total: todo.length });
      }
    } finally {
      running.current = false;
      // Always announce the final state, even if the throttle swallowed
      // the last document's update.
      announcer.current.flush();
      setProgress((p) => ({ ...p, active: false }));
    }
  }, [openDocPath]);

  useEffect(() => {
    // Piggyback the hook that already refreshes the listing on return to the
    // foreground (#650) — the moment a newly shared capture appears is exactly
    // the moment worth sweeping. Also runs once on mount for captures shared
    // while the app was not running.
    void sweep();
    const onVisible = () => {
      if (document.visibilityState === "visible") void sweep();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [sweep]);

  /**
   * Sweep an explicit list of documents (the retroactive pass, #3.2).
   *
   * Shares the queue guard and the progress state with the automatic sweep, so
   * the two can never run at once and the indicator says the same thing
   * whichever started the work.
   */
  const sweepPaths = useCallback(async (paths: string[]) => {
    if (running.current || paths.length === 0) return;
    const { imageMaxPixel, imageQuality } = useMobileStore.getState();
    const maxPixel = imageMaxPixel === "original" ? 0 : imageMaxPixel;

    running.current = true;
    setProgress({ active: true, done: 0, total: paths.length });
    try {
      for (const [index, path] of paths.entries()) {
        attempted.current.add(path);
        try {
          const inlined = await iosInlineArticleImages(path, {
            maxPixel,
            jpegQuality: imageQuality,
          });
          if (inlined > 0) {
            evictThumbnail(path);
            announcer.current.announce();
          }
        } catch {
          // Interrupting the whole run for one bad document would strand the
          // rest; this pass may be hundreds of files.
        }
        setProgress({ active: true, done: index + 1, total: paths.length });
      }
    } finally {
      running.current = false;
      // Always announce the final state, even if the throttle swallowed
      // the last document's update.
      announcer.current.flush();
      setProgress((p) => ({ ...p, active: false }));
    }
  }, []);

  useEffect(() => {
    const onRequest = (e: Event) => {
      const paths = (e as CustomEvent).detail as string[];
      void sweepPaths(paths);
    };
    window.addEventListener(INLINE_SWEEP_REQUEST, onRequest);
    return () => window.removeEventListener(INLINE_SWEEP_REQUEST, onRequest);
  }, [sweepPaths]);

  return { sweep, sweepPaths, progress };
}
