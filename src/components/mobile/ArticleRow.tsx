import { useEffect, useState } from "react";
import { articleCardMeta, iosReadFile, type ArticleCardMeta } from "@/lib/ios-api";
import { getThumbnail, type ThumbnailResult } from "@/lib/mobile-thumbnails";
import { useMobileStore } from "@/stores/mobile-store";
import { cn } from "@/lib/utils";
import { FileRow, type FileRowProps } from "./FileRow";
import { readingLine, READ_THRESHOLD } from "./reading-progress";

/**
 * A read-later list row for a saved article (#836) — Instapaper's shape:
 * title, `site · 2 of 4 min left`, a two-line excerpt, a square thumbnail on
 * the right, a hairline separator. The reading-progress line is what makes it
 * a read-later list rather than a file list.
 *
 * Everything but progress comes from the capture's own header, read back by
 * `article_card_meta`. A document that is not a capture (or whose header has
 * not arrived yet) renders the plain `FileRow`, so the list never has a hole.
 *
 * `condensed` drops the excerpt and shrinks the thumbnail: one line per row,
 * for a library that has grown past browsing into scanning.
 */
export function ArticleRow({ condensed, ...props }: FileRowProps & { condensed: boolean }) {
  const { entry } = props;
  const [meta, setMeta] = useState<ArticleCardMeta | null | undefined>(undefined);
  const [thumbnail, setThumbnail] = useState<ThumbnailResult | null>(null);
  const progress = useMobileStore((s) => s.readingProgress[entry.path] ?? 0);

  useEffect(() => {
    let cancelled = false;
    void iosReadFile(entry.path)
      .then((raw) => articleCardMeta(raw))
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch(() => {
        if (!cancelled) setMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.path]);

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

  // Not a capture (or not yet known): the plain row, never a hole.
  if (!meta) return <FileRow {...props} />;

  const title = meta.title ?? entry.name;
  const done = progress >= READ_THRESHOLD;
  const minutesLine = readingLine(meta.minutes, progress);
  const sub = [meta.site, minutesLine].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={() => props.onActivate(entry)}
      aria-current={props.active ? "page" : undefined}
      className={cn(
        "ios-press-row flex w-full items-start gap-3 px-4 text-left",
        condensed ? "py-2" : "py-3",
        "border-b border-border last:border-b-0 hover:bg-muted/50",
        props.active && "bg-muted",
      )}
    >
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
        {!condensed && meta.excerpt && (
          <div className="mt-1 line-clamp-2 text-[length:calc(0.9375rem*var(--ns-a11y-scale,1))] text-muted-foreground">
            {meta.excerpt}
          </div>
        )}
      </div>
      {thumbnail && (thumbnail.kind === "image" || thumbnail.kind === "pdf") && (
        <img
          src={thumbnail.url}
          alt=""
          className={cn(
            "shrink-0 rounded-md object-cover bg-muted",
            condensed ? "h-10 w-10" : "h-[4.5rem] w-[4.5rem]",
          )}
        />
      )}
    </button>
  );
}
