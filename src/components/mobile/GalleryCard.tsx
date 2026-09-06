import { useEffect, useRef, useState } from "react";
import { useFolderAppearance } from "./useFolderAppearance";
import { t } from "@/lib/i18n";
import { ListenButton } from "./ListenButton";
import { cn } from "@/lib/utils";
import type { FileEntry } from "@/lib/tauri";
import { presentEntryMenu, type EntryActionContext } from "@/lib/mobile-entry-actions";
import { useLongPress } from "./useLongPress";
import { classifyFile, formatModified, iconFor } from "./FileRow";
import { getThumbnail, type ThumbnailResult } from "@/lib/mobile-thumbnails";
import { isUnreadRow } from "./reading-progress";
import { useMobileStore } from "@/stores/mobile-store";

interface GalleryCardProps {
  entry: FileEntry;
  /** The folder currently being browsed — shown under each note card as the
   *  "containing folder" (gallery cards are always scoped to one folder). */
  currentFolderName: string;
  theme: "light" | "dark";
  onActivate: (entry: FileEntry) => void;
  /** Long-press actions (#680). Gallery cards have no swipe affordance —
   *  the grid scrolls and a horizontal drag on a card is ambiguous — so
   *  hold-to-act is the only route to Share / Rename / Pin / Delete here. */
  actionContext: EntryActionContext;
  /** Four-across density: a smaller title and no date line, so the caption
   *  fits the narrower card in one line. */
  condensed?: boolean;
}

/**
 * A single card in the gallery grid (#633) — content-preview thumbnail,
 * title, modified date, and containing folder. Thumbnail generation is
 * deferred until the card actually scrolls into view (IntersectionObserver);
 * `getThumbnail` additionally caps concurrency and caches by path across the
 * whole gallery, so opening a folder with hundreds of notes never bursts.
 * Directories never fetch a thumbnail at all — a folder icon is immediate.
 */
export function GalleryCard({
  entry,
  currentFolderName,
  theme,
  onActivate,
  actionContext,
  condensed = false,
}: GalleryCardProps) {
  // Read from the store here rather than threaded through props: the gallery
  // renders from the same listing as the rows, and a card that has to be TOLD
  // it is unread is a card the next caller forgets to tell — which is exactly
  // how this went missing.
  const opened = useMobileStore((s) => s.inboxOpened);
  const progress = useMobileStore((s) => s.readingProgress[entry.path] ?? 0);
  const unread = isUnreadRow(entry.path, opened, progress);

  const longPress = useLongPress((rect) => {
    void presentEntryMenu(entry, rect, actionContext);
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [thumbnail, setThumbnail] = useState<ThumbnailResult | null>(
    entry.is_directory ? { kind: "icon" } : null,
  );

  useEffect(() => {
    if (entry.is_directory) return;
    const el = rootRef.current;
    if (!el) return;
    let cancelled = false;
    const load = () => {
      void getThumbnail(entry, { theme }).then((result) => {
        if (!cancelled) setThumbnail(result);
      });
    };
    // Feature-detect: real WKWebView always has IntersectionObserver. The
    // fallback (fetch immediately) only matters for environments without it.
    if (typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver((observed) => {
      for (const item of observed) {
        if (item.isIntersecting) {
          load();
          observer.disconnect();
        }
      }
    });
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
    // `theme` IS a dependency, despite the cost of re-observing.
    //
    // It used to be excluded to avoid re-triggering every card's observer on a
    // theme flip. But the thumbnail is RENDERED in a theme, so excluding it
    // meant a flip left every card in the old one — and worse, a card whose
    // first request beat ThemeProvider's effect (React runs effects
    // child-first) cached a light thumbnail in a dark app for the whole
    // session, which is what Peter saw.
    //
    // Re-observing is bounded: only cards actually in view regenerate, the
    // shared limiter still caps concurrency at two, and `getThumbnail` is now
    // keyed by theme so the other theme's work is not thrown away.
  }, [entry.path, entry.is_directory, theme]);

  const Icon = iconFor(entry);
  const folder = useFolderAppearance(entry);
  // Read aloud without opening (#833): every saved page's card carries the
  // control on its picture.
  const listenable = !entry.is_directory && classifyFile(entry.name) === "html";

  return (
    // The card button and the Listen badge are SIBLINGS (a button may not
    // contain another). The badge sits in a square the size of the thumbnail
    // so it anchors to the picture's corner whatever the caption's height.
    <div ref={rootRef} data-testid="gallery-card" className="relative">
    <button
      type="button"
      onClick={() => onActivate(entry)}
      {...longPress}
      className="ios-press-row flex w-full flex-col items-start gap-1.5 rounded-lg text-left"
    >
      <span className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted">
        {entry.is_directory ? (
          // The icon and colour the folder was given on the Mac (#140);
          // sized to the CARD (55% of its square), not a fixed 32px — at
          // three cards per row a fixed icon reads as a speck.
          <folder.Icon
            strokeWidth={1}
            className="absolute inset-0 m-auto h-[55%] w-[55%] text-muted-foreground"
            style={folder.color ? { color: folder.color } : undefined}
            data-testid="folder-card-icon"
          />
        ) : thumbnail === null ? (
          <span className="absolute inset-0 animate-pulse" aria-hidden />
        ) : thumbnail.kind === "markdown" ? (
          // Safe to inject: `renderMarkdownFragment` strips raw HTML at the
          // source (comrak run without `unsafe_`) — same guarantee the
          // Reader's article view relies on. Scaled down via a tiny BASE font
          // and BROWSER-DEFAULT element styles, which are em-relative and
          // shrink with it. Deliberately NOT `.ProseMirror`: editor.css is
          // un-layered, so its rem-fixed heading sizes and desktop padding
          // variables beat any Tailwind utility — that combination rendered
          // giant clipped headings shoved right by a 6rem left pad (Peter's
          // gallery bug). Faded via a mask so overflow doesn't hard-cut.
          <span
            className="pointer-events-none absolute inset-0 block select-none overflow-hidden p-2 text-left text-[6px] leading-[1.4] text-foreground [&_*]:max-w-full"
            style={{
              maskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
              WebkitMaskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
            }}
            dangerouslySetInnerHTML={{ __html: thumbnail.html }}
          />
        ) : thumbnail.kind === "image" || thumbnail.kind === "pdf" ? (
          <img
            src={thumbnail.url}
            alt=""
            decoding="async"
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <Icon
            strokeWidth={1}
            className="absolute inset-0 m-auto h-[45%] w-[45%] text-muted-foreground"
          />
        )}
      </span>
      {/* A folder's caption is centred under its icon, like Files; a
          document's stays left under its picture. Condensed keeps the name
          alone; at rest a folder adds its count and last change. */}
      <span className={cn("w-full min-w-0", entry.is_directory && "text-center")}>
        {/* The same unread weight the list rows carry. It was missing here
            entirely, so switching Home to gallery lost every indication of
            what had not been read (Peter, build 52: "Unread is not indicated
            in gallery view"). Weight rather than a badge, for the reason the
            rows use weight: a dot on every card is clutter. The captions are
            small, so the step is 600 against 500 — at 11px a 400 caption
            reads as faint rather than as "already read". */}
        <span
          className={cn("block truncate text-foreground", condensed ? "text-[11px]" : "text-xs")}
          style={{
            fontWeight: unread
              ? "max(600, var(--ns-a11y-weight, 500))"
              : "max(500, var(--ns-a11y-weight, 500))",
          }}
        >
          {entry.name}
        </span>
        {!condensed && !entry.is_directory && entry.modified !== undefined && (
          <span className="block truncate text-[11px] text-muted-foreground">
            {formatModified(entry.modified)} · {currentFolderName}
          </span>
        )}
        {!condensed && entry.is_directory && (entry.child_count !== undefined || entry.modified !== undefined) && (
          <span className="block truncate text-[11px] text-muted-foreground" data-testid="folder-card-meta">
            {[
              entry.child_count === undefined
                ? null
                : entry.child_count === 1
                  ? t("library.itemsOne")
                  : t("library.items", { count: entry.child_count }),
              entry.modified !== undefined ? formatModified(entry.modified) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </span>
    </button>
      {listenable && (
        <span className="pointer-events-none absolute inset-x-0 top-0 aspect-square">
          <ListenButton entry={entry} size="card" className="pointer-events-auto absolute bottom-1.5 right-1.5" />
        </span>
      )}
    </div>
  );
}
