import type { FileEntry } from "@/lib/tauri";
import { useEffect } from "react";
import type { EntryActionContext } from "@/lib/mobile-entry-actions";
import { GalleryCard } from "./GalleryCard";
import { cancelPendingThumbnails } from "@/lib/mobile-thumbnails";

interface GalleryViewProps {
  entries: FileEntry[];
  currentFolderName: string;
  theme: "light" | "dark";
  onActivate: (entry: FileEntry) => void;
  /** Long-press action set, shared verbatim with the list rows (#680). */
  actionContext: EntryActionContext;
  /** The same `listDensity` toggle the list honours: condensed packs four
   *  cards across instead of three, with a one-line caption, so the view
   *  menu's one Condensed entry means "smaller" everywhere (it used to
   *  change nothing here — Peter, 2026-09-04). */
  condensed?: boolean;
  /** Listen badge on article cards; absent where playback is not offered. */
  onListen?: (entry: FileEntry) => void;
}

/**
 * Notes-style gallery grid (#633) — the alternative to `LibraryBrowser`'s
 * single-column list. Three columns across at rest, four condensed;
 * responsive/landscape reflow is left to a future pass.
 */
export function GalleryView({
  entries,
  currentFolderName,
  theme,
  onActivate,
  actionContext,
  condensed = false,
  onListen,
}: GalleryViewProps) {
  // Leaving the gallery (back-out, folder change — the browser remounts this
  // per folder — or a switch to list view) drops every queued thumbnail job
  // so the next screen paints immediately instead of fighting the queue.
  useEffect(() => () => cancelPendingThumbnails(), []);

  return (
    <div
      className={condensed ? "grid grid-cols-4 gap-x-2 gap-y-3 px-3 pb-4" : "grid grid-cols-3 gap-x-3 gap-y-5 px-3 pb-4"}
      role="list"
      aria-label="Notes gallery"
    >
      {entries.map((entry) => (
        <GalleryCard
          key={entry.path}
          entry={entry}
          currentFolderName={currentFolderName}
          theme={theme}
          onActivate={onActivate}
          actionContext={actionContext}
          condensed={condensed}
          onListen={onListen}
        />
      ))}
    </div>
  );
}
