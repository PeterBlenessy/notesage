import { useEffect, useRef, useState } from "react";
import { Folder } from "lucide-react";
import type { FileEntry } from "@/lib/tauri";
import { formatModified, iconFor } from "./FileRow";
import { getThumbnail, type ThumbnailResult } from "@/lib/mobile-thumbnails";

interface GalleryCardProps {
  entry: FileEntry;
  /** The folder currently being browsed — shown under each note card as the
   *  "containing folder" (gallery cards are always scoped to one folder). */
  currentFolderName: string;
  theme: "light" | "dark";
  onActivate: (entry: FileEntry) => void;
}

/**
 * A single card in the gallery grid (#633) — content-preview thumbnail,
 * title, modified date, and containing folder. Thumbnail generation is
 * deferred until the card actually scrolls into view (IntersectionObserver);
 * `getThumbnail` additionally caps concurrency and caches by path across the
 * whole gallery, so opening a folder with hundreds of notes never bursts.
 * Directories never fetch a thumbnail at all — a folder icon is immediate.
 */
export function GalleryCard({ entry, currentFolderName, theme, onActivate }: GalleryCardProps) {
  const rootRef = useRef<HTMLButtonElement | null>(null);
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
    // `theme` intentionally excluded: a theme flip mid-session should not
    // re-trigger every already-cached/in-flight card's observer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.path, entry.is_directory]);

  const Icon = iconFor(entry);

  return (
    <button
      ref={rootRef}
      type="button"
      onClick={() => onActivate(entry)}
      className="ios-press-row flex flex-col items-start gap-1.5 rounded-lg text-left"
    >
      <span className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted">
        {entry.is_directory ? (
          <Folder
            strokeWidth={1}
            // Sized to the CARD (55% of its square), not a fixed 32px — at
            // three cards per row a fixed icon reads as a speck.
            className="absolute inset-0 m-auto h-[55%] w-[55%] text-muted-foreground"
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
      <span className="w-full min-w-0">
        <span className="block truncate text-xs font-medium text-foreground">{entry.name}</span>
        {!entry.is_directory && entry.modified !== undefined && (
          <span className="block truncate text-[11px] text-muted-foreground">
            {formatModified(entry.modified)} · {currentFolderName}
          </span>
        )}
      </span>
    </button>
  );
}
