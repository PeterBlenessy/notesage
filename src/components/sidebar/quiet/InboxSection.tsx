import { useEffect, useRef, type KeyboardEvent } from "react";
import { Inbox } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { tauriApi } from "@/lib/tauri";
import { useInboxStore } from "@/stores/inbox-store";
import { useSettingsStore } from "@/stores/settings-store";
import { INBOX_FOLDER_NAME } from "@/lib/inbox";
import { cn } from "@/lib/utils";

/**
 * The Inbox row, above Pinned (the Mac Inbox, 2026-09).
 *
 * One row, no header: it is a place, not a list. The badge is the unread
 * count — items never opened on any device — read from the shared sidecar.
 * Choosing it switches the document column into the Inbox view.
 *
 * Hidden while the library root is unknown (startup) and when the folder
 * has never received a capture: a row for an empty Inbox at the top of every
 * sidebar would be the same clutter an empty Pinned section was.
 */
export function InboxSection({ filter = "" }: { filter?: string }) {
  const open = useInboxStore((s) => s.open);
  const items = useInboxStore((s) => s.items);
  const dir = useInboxStore((s) => s.dir);
  const unread = useInboxStore((s) => s.unreadCount());
  const load = useInboxStore((s) => s.load);
  const openInbox = useInboxStore((s) => s.openInbox);
  const homeDir = useSettingsStore((s) => s.homeDir);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  const icloudNotesagePath = useSettingsStore((s) => s.icloudNotesagePath);

  // First listing once the root resolves, so the badge is right before the
  // Inbox is ever opened. Later reloads come from the view and the watcher.
  useEffect(() => {
    if (homeDir || icloudNotesagePath) void load();
  }, [homeDir, notesRootPath, icloudNotesagePath, load]);

  // Live: a share from the phone lands while the Mac is open. Watch the
  // folder once its path is known and reload on any change under it — the
  // sidecar's own writes are self-marked and filtered out by the watcher.
  const watchedRef = useRef<string | null>(null);
  const hasItems = items.length > 0;
  useEffect(() => {
    if (!dir || watchedRef.current === dir) return;
    watchedRef.current = dir;
    void tauriApi.watchDirectory(dir).catch(() => {
      // No folder yet. The effect re-runs when the first listing finds
      // something (`hasItems` flips), which is when the folder exists.
      watchedRef.current = null;
    });
  }, [dir, hasItems]);
  useEffect(() => {
    let timer: number | null = null;
    const unlisten = listen<Array<{ path: string; kind: string }>>("file-changed-batch", (event) => {
      const root = useInboxStore.getState().dir;
      if (!root) return;
      const prefix = `${root}/`;
      const touched = event.payload.some((c) => c.path.startsWith(prefix) && !c.path.startsWith(`${prefix}.notesage/`));
      if (!touched) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void useInboxStore.getState().load();
      }, 300);
    });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      void unlisten.then((fn) => fn());
    };
  }, []);

  if (!dir) return null;
  if (items.length === 0 && !open) return null;
  if (filter && !INBOX_FOLDER_NAME.toLowerCase().includes(filter.toLowerCase())) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openInbox();
    }
  };

  return (
    <section aria-label={INBOX_FOLDER_NAME} className="flex flex-col gap-1">
      <div
        role="button"
        tabIndex={0}
        aria-current={open ? "page" : undefined}
        data-active={open ? "true" : undefined}
        data-testid="inbox-row"
        onClick={openInbox}
        onKeyDown={onKeyDown}
        className={cn(
          "h-7 px-2 flex items-center gap-2 rounded-sm text-[13px] transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))] focus-visible:z-10",
          open
            ? "bg-muted text-foreground font-medium"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        <Inbox
          className={cn("h-3.5 w-3.5 shrink-0", open ? "text-[var(--color-accent-primary)]" : "text-muted-foreground/70")}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className="truncate min-w-0 flex-1">{INBOX_FOLDER_NAME}</span>
        {unread > 0 && (
          <span
            data-testid="inbox-unread"
            aria-label={`${unread} unread`}
            className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-medium leading-4 tabular-nums text-primary-foreground"
          >
            {unread}
          </span>
        )}
      </div>
    </section>
  );
}
