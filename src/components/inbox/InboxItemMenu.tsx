import type { ReactNode } from "react";
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
import { useInboxActions } from "./useInboxActions";
import { isUnread } from "@/lib/reading-progress-file";
import { t } from "@/lib/i18n";

/**
 * Right-click menu for an Inbox row or card. Acts on the selection when the
 * item is part of it, else on the item alone — the same rule as the row's
 * drag and the keyboard.
 */
export function InboxItemMenu({
  item,
  pinned,
  onFileToLast,
  onTogglePin,
  onTrash,
  children,
}: {
  item: InboxItem;
  pinned: boolean;
  onFileToLast: (paths: string[]) => void;
  onTogglePin: (paths: string[]) => void;
  onTrash: (paths: string[]) => void;
  children: ReactNode;
}) {
  const { open, fileTo, openOriginal, projects } = useInboxActions();
  const meta = useInboxStore((s) => s.meta[item.path]);
  const entry = useInboxStore((s) => s.progress.items[item.name]);
  const lastDestination = useInboxStore((s) => s.lastDestination);

  const targets = () => {
    const store = useInboxStore.getState();
    return store.selection.includes(item.path) ? store.selection : [item.path];
  };
  const unread = isUnread(entry);
  const projectName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => void open(item)}>{t("inbox.open")}</ContextMenuItem>
        {meta?.sourceUrl && (
          <ContextMenuItem onSelect={() => void openOriginal(item.path)}>{t("inbox.openOriginal")}</ContextMenuItem>
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
              <ContextMenuItem key={p.path} onSelect={() => void fileTo(targets(), p.path)}>
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
    </ContextMenu>
  );
}
