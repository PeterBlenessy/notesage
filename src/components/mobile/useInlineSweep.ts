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

/** What the passive indicator needs to know. `total` is the number of
 *  documents this sweep will attempt, `done` how many it has finished. */
export interface SweepProgress {
  active: boolean;
  done: number;
  total: number;
}

export function useInlineSweep() {
  // Read from the store rather than a prop: this hook has no parent that knows
  // what is open, and the value must stay live across a sweep.
  const openDocPath = useMobileStore((s) => s.openDoc?.relPath ?? null);
  /**
   * Paths attempted this session.
   *
   * Not a correctness mechanism — `ios_inline_article_images` returns 0 for a
   * document with nothing remote left, so a repeat is harmless. This exists to
   * stop the sweep re-reading every Inbox file on every single foreground,
   * which on a large Inbox is real IPC and real disk for a guaranteed no-op.
   */
  const attempted = useRef<Set<string>>(new Set());
  /** One sweep at a time; a second foreground mid-sweep must not double it. */
  const running = useRef(false);
  const [progress, setProgress] = useState<SweepProgress>({
    active: false,
    done: 0,
    total: 0,
  });

  const sweep = useCallback(async () => {
    if (running.current) return;
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
          !(openDocPath && e.path === openDocPath),
      );
      if (todo.length === 0) return;
      setProgress({ active: true, done: 0, total: todo.length });

      for (const [index, entry] of todo.entries()) {
        attempted.current.add(entry.path);
        try {
          const inlined = await iosInlineArticleImages(entry.path);
          if (inlined > 0) {
            // The thumbnail cache is keyed by path and never expires, so
            // without this the article keeps the text-only thumbnail taken
            // before the sweep and the fix looks like it did nothing.
            evictThumbnail(entry.path);
            window.dispatchEvent(new CustomEvent(INLINE_SWEEP_EVENT, { detail: entry.path }));
          }
        } catch {
          // One bad document must not stop the rest. It stays linked and gets
          // another chance next session.
        }
        setProgress({ active: true, done: index + 1, total: todo.length });
      }
    } finally {
      running.current = false;
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

  return { sweep, progress };
}
