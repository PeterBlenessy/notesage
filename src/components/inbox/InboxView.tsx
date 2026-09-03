import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { LayoutGrid, List, Search } from "lucide-react";
import { ViewerToolbarPill } from "@/components/editor/viewers/ViewerToolbarPill";
import { useInboxStore, type InboxItem } from "@/stores/inbox-store";
import { useSettingsStore } from "@/stores/settings-store";
import { groupByDate } from "./inbox-grouping";
import { InboxRow } from "./InboxRow";
import { InboxCard } from "./InboxCard";
import { useInboxActions } from "./useInboxActions";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { INBOX_FOLDER_NAME } from "@/lib/inbox";

const PILL_BTN =
  "inline-flex items-center gap-1 h-7 px-2 rounded-full text-xs hover:bg-muted/60 transition-colors disabled:opacity-50 disabled:pointer-events-none";
const PILL_ON = "bg-muted text-foreground font-medium";

function PillDivider() {
  return <span className="w-px h-3.5 bg-border/60 mx-0.5" aria-hidden="true" />;
}

/**
 * The Inbox view — the read-later list in the document column.
 *
 * No header bar: "Inbox · 12 items · 7 unread" is content, set like a
 * document title, and the controls live in the same floating pill the
 * viewers use (top right here, so it never covers the title). Rows group by
 * date with sticky headers; the gallery is the same items at three sizes.
 *
 * Keyboard, on the list: j / k or ↓ / ↑ move the cursor, ↩ opens,
 * e files to the last-used project, p pins, ⌘⌫ trashes, ⇧-click selects a
 * range, ⌘-click toggles. The same verbs are on the row's hover actions and
 * its context menu — `useInboxActions` is the single source for all three.
 */
export function InboxView() {
  const items = useInboxStore((s) => s.items);
  const meta = useInboxStore((s) => s.meta);
  const progress = useInboxStore((s) => s.progress);
  const filter = useInboxStore((s) => s.filter);
  const selection = useInboxStore((s) => s.selection);
  const cursor = useInboxStore((s) => s.cursor);
  const loading = useInboxStore((s) => s.loading);
  const lastDestination = useInboxStore((s) => s.lastDestination);
  const unread = useInboxStore((s) => s.unreadCount());
  const setFilter = useInboxStore((s) => s.setFilter);
  const select = useInboxStore((s) => s.select);
  const setCursor = useInboxStore((s) => s.setCursor);
  const clearSelection = useInboxStore((s) => s.clearSelection);
  const markAllRead = useInboxStore((s) => s.markAllRead);
  const load = useInboxStore((s) => s.load);

  const layout = useSettingsStore((s) => s.inboxLayout);
  const condensed = useSettingsStore((s) => s.inboxCondensed);
  const gallerySize = useSettingsStore((s) => s.inboxGallerySize);
  const setLayout = useSettingsStore((s) => s.setInboxLayout);
  const setCondensed = useSettingsStore((s) => s.setInboxCondensed);
  const setGallerySize = useSettingsStore((s) => s.setInboxGallerySize);

  const { open, fileToLast, togglePin, trash, pinnedFiles } = useInboxActions();
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const registerRef = useCallback((path: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(path, el);
    else rowRefs.current.delete(path);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => {
      const m = meta[i.path];
      return [i.name, m?.title, m?.site, m?.excerpt].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [items, meta, filter]);
  const groups = useMemo(() => groupByDate(visible), [visible]);
  const order = useMemo(() => groups.flatMap((g) => g.items.map((i) => i.path)), [groups]);

  const destinationName = lastDestination ? lastDestination.slice(lastDestination.lastIndexOf("/") + 1) : null;

  /** Put DOM focus on the store's cursor row — after a move, and after the
   *  focused row left the list (filed or trashed), so `e, e, e` keeps going. */
  const listRef = useRef<HTMLDivElement>(null);
  const focusCursorRow = useCallback(() => {
    const path = useInboxStore.getState().cursor;
    const el = path ? rowRefs.current.get(path) : undefined;
    if (el) {
      el.focus();
      // Optional: jsdom has no scrollIntoView, and neither do some embeds.
      el.scrollIntoView?.({ block: "nearest" });
      return;
    }
    // Nothing left to land on (the last item was filed or trashed): keep
    // focus in the view so Escape / ⌘⇧I still work, rather than on <body>.
    listRef.current?.focus();
  }, []);

  // Reads the cursor from the store rather than closing over it: closing over
  // `cursor` would re-create this handler — and every memoised row's
  // `onKeyDown` — on each keystroke.
  const moveCursor = useCallback(
    (delta: 1 | -1, extend: boolean) => {
      if (order.length === 0) return;
      const cur = useInboxStore.getState().cursor;
      const at = cur ? order.indexOf(cur) : -1;
      const next = order[Math.min(order.length - 1, Math.max(0, at + delta))];
      if (!next) return;
      if (extend) select(next, { shift: true });
      else setCursor(next);
      focusCursorRow();
    },
    [order, select, setCursor, focusCursorRow],
  );

  const onRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const store = useInboxStore.getState();
      const targets = store.targets();
      const mod = event.metaKey || event.ctrlKey;
      switch (event.key) {
        case "ArrowDown":
        case "j":
          if (mod) return;
          event.preventDefault();
          moveCursor(1, event.shiftKey);
          return;
        case "ArrowUp":
        case "k":
          if (mod) return;
          event.preventDefault();
          moveCursor(-1, event.shiftKey);
          return;
        case "Enter": {
          event.preventDefault();
          const item = items.find((i) => i.path === (store.cursor ?? targets[0]));
          if (item) void open(item);
          return;
        }
        case "e":
          if (mod) return;
          event.preventDefault();
          void fileToLast(targets).then(focusCursorRow);
          return;
        case "p":
          if (mod) return;
          event.preventDefault();
          togglePin(targets);
          return;
        case "Backspace":
        case "Delete":
          if (event.key === "Backspace" && !mod) return;
          event.preventDefault();
          void trash(targets).then(focusCursorRow);
          return;
        case "a":
          if (mod) {
            event.preventDefault();
            useInboxStore.setState({ selection: order, anchor: order[0] ?? null });
          }
          return;
        case "Escape":
          clearSelection();
          return;
        default:
          return;
      }
    },
    [items, order, moveCursor, open, fileToLast, togglePin, trash, clearSelection, focusCursorRow],
  );

  const onSelect = useCallback(
    (item: InboxItem, modifiers: { shift: boolean; meta: boolean }) => select(item.path, modifiers),
    [select],
  );
  const onFileToLast = useCallback((paths: string[]) => void fileToLast(paths).then(focusCursorRow), [fileToLast, focusCursorRow]);
  const onTrash = useCallback((paths: string[]) => void trash(paths).then(focusCursorRow), [trash, focusCursorRow]);

  const gridCols =
    gallerySize === "small" ? "grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"
    : gallerySize === "large" ? "grid-cols-[repeat(auto-fill,minmax(300px,1fr))]"
    : "grid-cols-[repeat(auto-fill,minmax(210px,1fr))]";

  return (
    <div className="relative h-full flex flex-col" data-inbox-view="">
      <ViewerToolbarPill viewerId="inbox" scrollRef={scrollRef} className="absolute top-4 right-5 left-auto translate-x-0 z-20">
        <label className="inline-flex items-center gap-1.5 h-7 px-2 rounded-full text-xs text-muted-foreground focus-within:bg-muted/60">
          <Search className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("inbox.filter")}
            aria-label={t("inbox.filter")}
            className="w-28 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </label>
        <PillDivider />
        <div className="inline-flex" role="group" aria-label={t("inbox.layout")}>
          <button type="button" className={cn(PILL_BTN, layout === "list" && PILL_ON)} aria-pressed={layout === "list"} onClick={() => setLayout("list")}>
            <List className="h-3.5 w-3.5" strokeWidth={1.5} /> {t("inbox.list")}
          </button>
          <button type="button" className={cn(PILL_BTN, layout === "gallery" && PILL_ON)} aria-pressed={layout === "gallery"} onClick={() => setLayout("gallery")}>
            <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.5} /> {t("inbox.gallery")}
          </button>
        </div>
        <PillDivider />
        {layout === "list" ? (
          <button type="button" className={cn(PILL_BTN, condensed && PILL_ON)} aria-pressed={condensed} onClick={() => setCondensed(!condensed)}>
            {t("inbox.condensed")}
          </button>
        ) : (
          <div className="inline-flex" role="group" aria-label={t("inbox.cardSize")}>
            {(["small", "medium", "large"] as const).map((size) => (
              <button
                key={size}
                type="button"
                className={cn(PILL_BTN, "w-7 justify-center px-0", gallerySize === size && PILL_ON)}
                aria-pressed={gallerySize === size}
                aria-label={t(`inbox.size.${size}` as "inbox.size.small")}
                onClick={() => setGallerySize(size)}
              >
                {size === "small" ? "S" : size === "medium" ? "M" : "L"}
              </button>
            ))}
          </div>
        )}
        <PillDivider />
        <button type="button" className={PILL_BTN} disabled={unread === 0} onClick={markAllRead}>
          {t("inbox.markAllRead")}
        </button>
      </ViewerToolbarPill>

      <div ref={scrollRef} className="flex-1 overflow-y-auto" data-doc-scroll="">
        <div className="mx-auto w-full max-w-5xl px-5 pb-10 pt-20">
          <div className="flex items-baseline gap-3 px-3 pb-2">
            <h1 className="font-serif text-[22px] font-semibold">{INBOX_FOLDER_NAME}</h1>
            <span className="text-[12.5px] text-muted-foreground tabular-nums">
              {t("inbox.count", { count: items.length })}
              {unread > 0 ? ` · ${t("inbox.unreadCount", { count: unread })}` : ""}
            </span>
          </div>

          {!loading && items.length === 0 && (
            <div className="px-3 py-16 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{t("inbox.empty")}</p>
              <p className="mt-1 max-w-md mx-auto">{t("inbox.emptyHint")}</p>
            </div>
          )}
          {!loading && items.length > 0 && visible.length === 0 && (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">{t("inbox.noMatches", { query: filter })}</p>
          )}

          <div ref={listRef} role="listbox" tabIndex={-1} aria-multiselectable="true" aria-label={INBOX_FOLDER_NAME} className="focus:outline-none">
            {/* ARIA: a listbox owns options, or groups of options. The date
                sections are `group`s and the list markup is presentational so
                the options stay the listbox's own children. */}
            {groups.map((group) => (
              <div key={group.key} role="group" aria-label={group.title}>
                <h2 className="sticky top-0 z-10 flex items-center justify-between bg-background/85 px-3 pb-1.5 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur">
                  {group.title}
                  <span className="font-mono normal-case tracking-normal">{group.items.length}</span>
                </h2>
                {layout === "list" ? (
                  <ul role="presentation" className="flex flex-col">
                    {group.items.map((item) => (
                      <li key={item.path} role="presentation" className="border-b border-border/70 last:border-b-0">
                        <InboxRow
                          item={item}
                          meta={meta[item.path]}
                          entry={progress.items[item.name]}
                          selected={selection.includes(item.path)}
                          cursor={cursor === item.path}
                          condensed={condensed}
                          pinned={pinnedFiles.includes(item.path)}
                          destinationName={destinationName}
                          onOpen={open}
                          onSelect={onSelect}
                          onFileToLast={onFileToLast}
                          onTogglePin={togglePin}
                          onTrash={onTrash}
                          onKeyDown={onRowKeyDown}
                          registerRef={registerRef}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className={cn("grid gap-3 px-1 pb-4", gridCols)}>
                    {group.items.map((item) => (
                      <InboxCard
                        key={item.path}
                        item={item}
                        meta={meta[item.path]}
                        entry={progress.items[item.name]}
                        selected={selection.includes(item.path)}
                        cursor={cursor === item.path}
                        size={gallerySize}
                        pinned={pinnedFiles.includes(item.path)}
                        onOpen={open}
                        onSelect={onSelect}
                        onFileToLast={onFileToLast}
                        onTogglePin={togglePin}
                        onTrash={onTrash}
                        onKeyDown={onRowKeyDown}
                        registerRef={registerRef}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
