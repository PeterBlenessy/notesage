import { memo, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { FileIcon } from "@/components/sidebar/FileIcon";
import { useInboxStore, type InboxItem } from "@/stores/inbox-store";
import { isFinished, isUnread, type ReadingProgressEntry } from "@/lib/reading-progress-file";
import { readingLine } from "@/components/mobile/reading-progress";
import { beginFileDrag, FILE_DRAG_PATHS_MIME } from "@/components/sidebar/quiet/file-drag";
import type { InboxCardMeta } from "@/lib/tauri";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { InboxItemMenu } from "./InboxItemMenu";
import { useInboxThumbnail } from "./InboxRow";

export interface InboxCardProps {
  item: InboxItem;
  meta: InboxCardMeta | null | undefined;
  entry: ReadingProgressEntry | undefined;
  selected: boolean;
  cursor: boolean;
  size: "small" | "medium" | "large";
  pinned: boolean;
  onOpen: (item: InboxItem) => void;
  onSelect: (item: InboxItem, modifiers: { shift: boolean; meta: boolean }) => void;
  onFileToLast: (paths: string[]) => void;
  onTogglePin: (paths: string[]) => void;
  onTrash: (paths: string[]) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  registerRef: (path: string, el: HTMLElement | null) => void;
}

/**
 * A gallery card: 16:10 thumbnail, two-line title, `site · progress`. The
 * same item, selection and drag as the row — the gallery is a way of
 * scanning, not a second feature. `size` sets the type scale; the grid
 * decides the column count.
 */
function InboxCardImpl({
  item, meta, entry, selected, cursor, size, pinned,
  onOpen, onSelect, onFileToLast, onTogglePin, onTrash, onKeyDown, registerRef,
}: InboxCardProps) {
  const thumb = useInboxThumbnail(item);
  const title = meta?.title ?? item.name.replace(/\.html?$/i, "");
  const unread = isUnread(entry);
  const finished = isFinished(entry);
  const fraction = entry?.fraction ?? 0;
  const line = meta ? readingLine(meta.minutes, fraction) : null;

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
    const store = useInboxStore.getState();
    const paths = store.selection.includes(item.path) ? store.selection : [item.path];
    beginFileDrag(event, item.path);
    event.dataTransfer.setData(FILE_DRAG_PATHS_MIME, JSON.stringify(paths));
  };

  return (
    <InboxItemMenu item={item} pinned={pinned} onFileToLast={onFileToLast} onTogglePin={onTogglePin} onTrash={onTrash}>
      <div
        ref={(el) => registerRef(item.path, el)}
        role="option"
        aria-selected={selected}
        aria-current={cursor ? "true" : undefined}
        tabIndex={cursor ? 0 : -1}
        draggable
        data-testid="inbox-card"
        data-path={item.path}
        data-unread={unread ? "true" : undefined}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onDragStart={onDragStart}
        onFocus={() => useInboxStore.getState().setCursor(item.path)}
        className={cn(
          "relative flex flex-col gap-2 rounded-xl p-2",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))]",
          selected ? "bg-muted" : "hover:bg-muted/50",
          cursor && !selected && "ring-1 ring-border",
        )}
      >
        {unread && (
          <span
            className="absolute left-3.5 top-3.5 z-10 h-2 w-2 rounded-full bg-[var(--color-accent-primary)] ring-2 ring-background"
            aria-label={t("inbox.unreadOne")}
          />
        )}
        {item.kind !== "html" && item.kind !== "markdown" && (
          <span className="absolute right-3 top-3 z-10 rounded bg-background/85 px-1.5 font-mono text-[10px] text-muted-foreground">
            {item.kind.toUpperCase()}
          </span>
        )}
        <span className="flex aspect-[16/10] items-center justify-center overflow-hidden rounded-lg bg-muted">
          {thumb?.kind === "picture" ? (
            <img src={thumb.url} alt="" className="h-full w-full object-cover" draggable={false} />
          ) : (
            <FileIcon fileName={item.name} className="h-6 w-6 text-muted-foreground" />
          )}
        </span>
        <span
          className={cn(
            "line-clamp-2 font-serif font-semibold leading-tight [text-wrap:balance]",
            size === "small" ? "text-[12.5px] line-clamp-1" : size === "large" ? "text-[16px]" : "text-[14.5px]",
            finished && "text-muted-foreground",
          )}
        >
          {title}
        </span>
        {size !== "small" && (
          <span className="flex items-center gap-2 text-[11.5px] text-muted-foreground tabular-nums">
            <span className="truncate">{[meta?.site, line].filter(Boolean).join(" · ")}</span>
            {!unread && !finished && fraction > 0 && (
              <span className="relative block h-[3px] flex-1 rounded-full bg-border" aria-hidden="true">
                <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/70" style={{ width: `${Math.round(fraction * 100)}%` }} />
              </span>
            )}
          </span>
        )}
      </div>
    </InboxItemMenu>
  );
}

export const InboxCard = memo(InboxCardImpl);
