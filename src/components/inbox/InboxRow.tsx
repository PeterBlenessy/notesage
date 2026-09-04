import { memo, useEffect, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Pin, Trash2 } from "lucide-react";
import { FileIcon } from "@/components/sidebar/FileIcon";
import { useInboxStore, type InboxItem } from "@/stores/inbox-store";
import { getDesktopThumbnail, type DesktopThumbnail } from "@/lib/desktop-thumbnails";
import { isFinished, isUnread, type ReadingProgressEntry } from "@/lib/reading-progress-file";
import { readingLine } from "@/components/mobile/reading-progress";
import { beginFileDrag, FILE_DRAG_PATHS_MIME } from "@/components/sidebar/quiet/file-drag";
import type { InboxCardMeta } from "@/lib/tauri";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { InboxItemMenu } from "./InboxItemMenu";

export interface InboxRowProps {
  item: InboxItem;
  meta: InboxCardMeta | null | undefined;
  entry: ReadingProgressEntry | undefined;
  selected: boolean;
  cursor: boolean;
  condensed: boolean;
  pinned: boolean;
  destinationName: string | null;
  onOpen: (item: InboxItem) => void;
  onSelect: (item: InboxItem, modifiers: { shift: boolean; meta: boolean }) => void;
  onFileToLast: (paths: string[]) => void;
  onTogglePin: (paths: string[]) => void;
  onTrash: (paths: string[]) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  registerRef: (path: string, el: HTMLElement | null) => void;
}

function formatSize(item: InboxItem): string | null {
  return item.kind === "html" || item.kind === "markdown" ? null : item.kind.toUpperCase();
}

/** The thumbnail slot: 56pt (40pt condensed), picture or type icon. */
export function useInboxThumbnail(item: InboxItem): DesktopThumbnail | null {
  const [thumb, setThumb] = useState<DesktopThumbnail | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getDesktopThumbnail({ name: item.name, path: item.path, is_directory: false, hidden: false, modified: item.modified }).then(
      (result) => {
        if (!cancelled) setThumb(result);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [item.path, item.name, item.modified]);
  return thumb;
}

/**
 * A read-later row (the phone's article row, thumbnail on the left):
 * unread dot · thumbnail · title · `site · 2 of 4 min left` with a progress
 * bar · two-line excerpt. Documents show their type instead of a reading
 * time. Hover reveals the triage actions; the whole row is a drag source
 * for filing into a project.
 */
function InboxRowImpl({
  item, meta, entry, selected, cursor, condensed, pinned, destinationName,
  onOpen, onSelect, onFileToLast, onTogglePin, onTrash, onKeyDown, registerRef,
}: InboxRowProps) {
  const thumb = useInboxThumbnail(item);
  const title = meta?.title ?? item.name.replace(/\.html?$/i, "");
  const unread = isUnread(entry);
  const finished = isFinished(entry);
  const fraction = entry?.fraction ?? 0;
  const line = meta ? readingLine(meta.minutes, fraction) : null;
  const type = formatSize(item);
  const sub = [meta?.site, line].filter(Boolean);

  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (event.detail === 2) {
      onOpen(item);
      return;
    }
    onSelect(item, { shift: event.shiftKey, meta: event.metaKey || event.ctrlKey });
    // The row is only tabbable while it is the cursor, so a click on any
    // other row lands focus nowhere and the next key goes to the body.
    // Take focus explicitly; `.focus()` works on tabIndex -1.
    event.currentTarget.focus();
  };

  const onDragStart = (event: DragEvent<HTMLElement>) => {
    // Drag the selection when the row is part of it, else just this row.
    const store = useInboxStore.getState();
    const paths = store.selection.includes(item.path) ? store.selection : [item.path];
    beginFileDrag(event, item.path);
    event.dataTransfer.setData(FILE_DRAG_PATHS_MIME, JSON.stringify(paths));
  };

  return (
    <InboxItemMenu
      item={item}
      onFileToLast={onFileToLast}
      onTogglePin={onTogglePin}
      onTrash={onTrash}
      pinned={pinned}
    >
      <div
        ref={(el) => registerRef(item.path, el)}
        role="option"
        aria-selected={selected}
        aria-current={cursor ? "true" : undefined}
        tabIndex={cursor ? 0 : -1}
        draggable
        data-testid="inbox-row"
        data-path={item.path}
        data-unread={unread ? "true" : undefined}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onDragStart={onDragStart}
        onFocus={() => useInboxStore.getState().setCursor(item.path)}
        className={cn(
          "group/inbox-row relative grid items-center gap-x-3 rounded-lg px-3",
          condensed ? "grid-cols-[14px_40px_minmax(0,1fr)_auto] py-1.5" : "grid-cols-[14px_56px_minmax(0,1fr)_auto] py-2",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))]",
          selected ? "bg-muted" : "hover:bg-muted/50",
          cursor && !selected && "ring-1 ring-border",
        )}
      >
        <span className="flex justify-center">
          {unread && <span className="h-[7px] w-[7px] rounded-full bg-[var(--color-accent-primary)]" aria-label={t("inbox.unreadOne")} />}
        </span>
        <span
          className={cn(
            "overflow-hidden rounded-md bg-muted flex items-center justify-center",
            condensed ? "h-10 w-10" : "h-14 w-14",
          )}
        >
          {thumb?.kind === "picture" ? (
            <img src={thumb.url} alt="" className="h-full w-full object-cover" draggable={false} />
          ) : (
            <FileIcon fileName={item.name} className="h-5 w-5 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex flex-col gap-0.5">
          <span
            className={cn(
              "truncate font-serif text-[15px] font-semibold leading-tight",
              finished && "text-muted-foreground",
            )}
          >
            {title}
          </span>
          <span className="flex items-center gap-2 text-[12px] text-muted-foreground tabular-nums">
            {sub.length > 0 && <span className="truncate">{sub.join(" · ")}</span>}
            {type && (
              <span className="rounded bg-muted px-1.5 font-mono text-[10.5px] text-muted-foreground">{type}</span>
            )}
            {!unread && !finished && fraction > 0 && (
              <span className="relative block h-[3px] w-16 shrink-0 rounded-full bg-border" aria-hidden="true">
                <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/70" style={{ width: `${Math.round(fraction * 100)}%` }} />
              </span>
            )}
          </span>
          {!condensed && meta?.excerpt && (
            <span className="line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">{meta.excerpt}</span>
          )}
        </span>
        <span
          className={cn(
            "flex items-center gap-1 opacity-0 transition-opacity duration-150 motion-reduce:transition-none",
            "group-hover/inbox-row:opacity-100 focus-within:opacity-100",
            (selected || cursor) && "opacity-100",
          )}
        >
          {destinationName && (
            <button
              type="button"
              className="h-6 rounded-md border border-border bg-background px-2 text-[11.5px] text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onFileToLast([item.path]);
              }}
            >
              {t("inbox.fileTo", { project: destinationName })}
            </button>
          )}
          <button
            type="button"
            className={cn(
              "inline-grid h-6 w-6 place-items-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground",
              pinned && "text-[var(--color-accent-primary)]",
            )}
            aria-label={pinned ? t("inbox.unpin") : t("inbox.pin")}
            title={pinned ? t("inbox.unpin") : t("inbox.pin")}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin([item.path]);
            }}
          >
            <Pin className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="inline-grid h-6 w-6 place-items-center rounded-md border border-border bg-background text-muted-foreground hover:text-destructive"
            aria-label={t("inbox.delete")}
            title={t("inbox.delete")}
            onClick={(e) => {
              e.stopPropagation();
              onTrash([item.path]);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </span>
      </div>
    </InboxItemMenu>
  );
}

export const InboxRow = memo(InboxRowImpl);
