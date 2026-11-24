import { useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useInboxStore, type InboxItem } from "@/stores/inbox-store";
import { isUnread } from "@/lib/reading-progress-file";
import { t } from "@/lib/i18n";

/** The row or card an event happened on, by the `data-path` both carry. */
function pathUnder(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest("[data-path]")?.getAttribute("data-path") ?? null;
}

/**
 * The Inbox's right-click menu — ONE for the whole list, wrapped around the
 * listbox, which works out the row or card under the pointer when it opens.
 *
 * It used to be one per row: a Radix ContextMenu root, a `useInboxActions()`
 * call (four workspace-store subscriptions) and three inbox-store
 * subscriptions for every item, mounted or not on screen — some 2,450
 * subscriptions for a 350-item Inbox, rebuilt on every return to the list.
 *
 * Acts on the selection when the item is part of it, else on the item alone
 * — the same rule as the row's drag and the keyboard. A right-click that is
 * not on an item opens nothing.
 */
export function InboxItemMenu({
  itemAt,
  isPinned,
  projects,
  onOpen,
  onOpenOriginal,
  onFileTo,
  onFileToLast,
  onTogglePin,
  onTrash,
  onCloseFocus,
  children,
}: {
  /** The item a `data-path` names, if it is still listed. */
  itemAt: (path: string) => InboxItem | undefined;
  isPinned: (path: string) => boolean;
  projects: ReadonlyArray<{ path: string }>;
  onOpen: (item: InboxItem) => void;
  onOpenOriginal: (path: string) => void;
  onFileTo: (paths: string[], projectPath: string) => void;
  onFileToLast: (paths: string[]) => void;
  onTogglePin: (paths: string[]) => void;
  onTrash: (paths: string[]) => void;
  /** Where focus goes when the menu closes: the row it was opened on. The
   *  trigger is the list now, and Radix would hand focus to that. */
  onCloseFocus: (path: string) => void;
  children: ReactNode;
}) {
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const item = targetPath ? itemAt(targetPath) : undefined;
  const meta = useInboxStore((s) => (targetPath ? s.meta[targetPath] : undefined));
  const entry = useInboxStore((s) => (item ? s.progress.items[item.name] : undefined));
  const lastDestination = useInboxStore((s) => s.lastDestination);

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    const path = pathUnder(event.target);
    if (!path || !itemAt(path)) {
      // Not on an item: no menu. Prevented, so Radix does not open one.
      event.preventDefault();
      return;
    }
    setTargetPath(path);
  };
  // Touch and pen open the menu by long press, with no `contextmenu` event.
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse") return;
    const path = pathUnder(event.target);
    if (path && itemAt(path)) setTargetPath(path);
  };

  const targets = () => {
    if (!item) return [];
    const store = useInboxStore.getState();
    return store.selection.includes(item.path) ? store.selection : [item.path];
  };
  const unread = isUnread(entry);
  const pinned = item ? isPinned(item.path) : false;
  const projectName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={onContextMenu} onPointerDown={onPointerDown}>
        {children}
      </ContextMenuTrigger>
      {item && (
        <ContextMenuContent
          className="w-56"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onCloseFocus(item.path);
          }}
        >
          <ContextMenuItem onSelect={() => onOpen(item)}>{t("inbox.open")}</ContextMenuItem>
          {meta?.sourceUrl && (
            <ContextMenuItem onSelect={() => onOpenOriginal(item.path)}>{t("inbox.openOriginal")}</ContextMenuItem>
          )}
          <ContextMenuSeparator />
          {lastDestination && (
            <ContextMenuItem onSelect={() => onFileToLast(targets())}>
              {t("inbox.fileTo", { project: projectName(lastDestination) })}
              <span className="ml-auto text-xs text-muted-foreground">E</span>
            </ContextMenuItem>
          )}
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={projects.length === 0}>{t("inbox.fileToEllipsis")}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              {projects.map((p) => (
                <ContextMenuItem key={p.path} onSelect={() => onFileTo(targets(), p.path)}>
                  {projectName(p.path)}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onSelect={() => onTogglePin(targets())}>
            {pinned ? t("inbox.unpin") : t("inbox.pin")}
            <span className="ml-auto text-xs text-muted-foreground">P</span>
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              const store = useInboxStore.getState();
              if (unread) store.markRead(targets());
              else store.markUnread(targets());
            }}
          >
            {unread ? t("inbox.markRead") : t("inbox.markUnread")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => onTrash(targets())}>
            {t("inbox.delete")}
            <span className="ml-auto text-xs text-muted-foreground">⌘⌫</span>
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}
