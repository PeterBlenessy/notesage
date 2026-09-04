import { useEffect, useState } from "react";
import { Headphones } from "lucide-react";
import type { ArticleCardMeta } from "@/lib/ios-api";
import type { FileEntry } from "@/lib/tauri";
import { articleMetaFor } from "@/lib/article-meta-cache";
import { getThumbnail, type ThumbnailResult } from "@/lib/mobile-thumbnails";
import { useMobileStore } from "@/stores/mobile-store";
import { cn } from "@/lib/utils";
import { FileRow, iconFor, THUMBNAIL_SLOT, type FileRowProps } from "./FileRow";
import { useLongPress } from "./useLongPress";
import { presentEntryMenu } from "@/lib/mobile-entry-actions";
import { t } from "@/lib/i18n";
import { readingLine, READ_THRESHOLD } from "./reading-progress";

/**
 * A read-later list row for a saved article (#836) — Instapaper's shape:
 * a square thumbnail on the left, title, `site · 2 of 4 min left`, a two-line
 * excerpt, a hairline separator. The reading-progress line is what makes it a
 * read-later list rather than a file list.
 *
 * The thumbnail sits on the LEFT, in the same slot the plain `FileRow` uses,
 * so an Inbox mixing saved articles with PDFs and screenshots reads as one
 * list (build 41 had articles on the right and files on the left — Peter,
 * 2026-09-04; the Mac Inbox mockup settled on left). The slot is fixed-size
 * and holds the file icon until the picture lands, so a late thumbnail never
 * pushes the title sideways.
 *
 * Everything but progress comes from the capture's own header, read back by
 * `article_card_meta`. A document that is not a capture (or whose header has
 * not arrived yet) renders the plain `FileRow`, so the list never has a hole.
 *
 * `condensed` drops the excerpt and shrinks the thumbnail: one line per row,
 * for a library that has grown past browsing into scanning.
 */
export function ArticleRow({
  condensed,
  onListen,
  ...props
}: FileRowProps & {
  condensed: boolean;
  /** Start reading this article aloud — the headphones control at the
   *  row's right edge. Absent where playback is not offered. */
  onListen?: (entry: FileEntry) => void;
}) {
  const { entry } = props;
  // Hold for the full menu, as on the plain row — Pin, Rename, Move and
  // Listen were unreachable from an article row before.
  const longPress = useLongPress((rect) => {
    void presentEntryMenu(entry, rect, props.actionContext);
  });
  const [meta, setMeta] = useState<ArticleCardMeta | null | undefined>(undefined);
  const [thumbnail, setThumbnail] = useState<ThumbnailResult | null>(null);
  const progress = useMobileStore((s) => s.readingProgress[entry.path] ?? 0);

  useEffect(() => {
    let cancelled = false;
    // Native read + session cache: a repeat visit to the folder renders every
    // row instantly, and even a cold one moves four strings, not the file.
    void articleMetaFor(entry.path, entry.modified).then((m) => {
      if (!cancelled) setMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.path, entry.modified]);

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    // Same theme rule as the gallery card: the thumbnail is RENDERED in a
    // theme, so it is keyed on the one in effect now.
    const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    void getThumbnail(entry, { theme }).then((thumb) => {
      if (!cancelled) setThumbnail(thumb);
    });
    return () => {
      cancelled = true;
    };
  }, [meta, entry.path, entry.name]);

  // Known NOT to be a capture: the plain row.
  if (meta === null) return <FileRow {...props} />;

  // While the header is still on its way, render the article-shaped row with
  // just the name, so the list does not jump from a one-line row to a tall
  // one as each read lands (review finding). A `.html` in the Inbox is almost
  // always a capture, so the placeholder is almost always the right shape.
  const title = meta?.title ?? entry.name.replace(/\.html?$/i, "");
  const done = progress >= READ_THRESHOLD;
  const minutesLine = meta ? readingLine(meta.minutes, progress) : null;
  const sub = [meta?.site, minutesLine].filter(Boolean).join(" · ");
  const picture = thumbnail && (thumbnail.kind === "image" || thumbnail.kind === "pdf") ? thumbnail.url : null;
  const Icon = iconFor(entry);
  const slot = condensed ? THUMBNAIL_SLOT.small : THUMBNAIL_SLOT.large;

  return (
    // The row button and the Listen button are SIBLINGS: a button may not
    // contain another, and a `div[role=button]` around a real button is the
    // nested-interactive pattern assistive tech handles inconsistently.
    <div
      className={cn(
        "flex items-stretch",
        "border-b border-border last:border-b-0",
        props.active && "bg-muted",
      )}
    >
    <button
      type="button"
      onClick={() => props.onActivate(entry)}
      {...longPress}
      aria-current={props.active ? "page" : undefined}
      className={cn(
        // Centred like the plain row: the slot is fixed-height, and a
        // title-only row (header not yet read, or no excerpt) would otherwise
        // sit top-heavy beside an empty 72pt box.
        "ios-press-row flex min-w-0 flex-1 items-center gap-3 pl-4 text-left",
        onListen ? "pr-2" : "pr-4",
        condensed ? "py-2" : "py-3",
        "hover:bg-muted/50",
      )}
    >
      <span
        data-testid="row-thumbnail-slot"
        className={cn("flex shrink-0 items-center justify-center rounded-md bg-muted", slot)}
      >
        {picture ? (
          <img
            src={picture}
            alt=""
            data-testid="row-thumbnail"
            className={cn("rounded-md object-cover", slot)}
          />
        ) : (
          <Icon strokeWidth={1.5} className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-[length:calc(1.0625rem*var(--ns-a11y-scale,1))] text-foreground",
            condensed ? "truncate" : "line-clamp-2",
            done && "text-muted-foreground",
          )}
          style={{ fontWeight: "max(500, var(--ns-a11y-weight, 400))" }}
        >
          {title}
        </div>
        {sub && (
          <div className="mt-0.5 truncate text-[length:calc(0.8125rem*var(--ns-a11y-scale,1))] text-muted-foreground">
            {sub}
          </div>
        )}
        {!condensed && meta?.excerpt && (
          <div className="mt-1 line-clamp-2 text-[length:calc(0.9375rem*var(--ns-a11y-scale,1))] text-muted-foreground">
            {meta.excerpt}
          </div>
        )}
      </div>
    </button>
      {onListen && (
        <button
          type="button"
          aria-label={t("action.listen")}
          data-testid="row-listen"
          onClick={() => onListen(entry)}
          className="ios-press-row flex w-12 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            <Headphones className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </span>
        </button>
      )}
    </div>
  );
}
