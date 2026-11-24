import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { LayoutGrid, List, Search } from "lucide-react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { ViewerToolbarPill } from "@/components/editor/viewers/ViewerToolbarPill";
import { useInboxStore, type InboxItem } from "@/stores/inbox-store";
import { useSettingsStore } from "@/stores/settings-store";
import { groupByDate } from "./inbox-grouping";
import { InboxRow } from "./InboxRow";
import { InboxCard } from "./InboxCard";
import { InboxItemMenu } from "./InboxItemMenu";
import { useInboxActions } from "./useInboxActions";
import { t } from "@/lib/i18n";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { INBOX_FOLDER_NAME } from "@/lib/inbox";

const PILL_BTN =
  "inline-flex items-center gap-1 h-7 px-2 rounded-full text-xs hover:bg-muted/60 transition-colors disabled:opacity-50 disabled:pointer-events-none";
const PILL_ON = "bg-muted text-foreground font-medium";

function PillDivider() {
  return <span className="w-px h-3.5 bg-border/60 mx-0.5" aria-hidden="true" />;
}

/**
 * One line of the windowed list. The date groups are flattened into these —
 * a header, a row, or (in the gallery) one row of cards — because a window
 * is a range over a flat sequence.
 */
type Entry =
  | { kind: "header"; key: string; group: number }
  | { kind: "row"; key: string; group: number; item: InboxItem; pos: number; last: boolean }
  | { kind: "cards"; key: string; group: number; items: InboxItem[]; pos: number; last: boolean };

/** A date group as a span of entries: its header, and its last line. */
interface GroupSpan {
  key: string;
  title: string;
  count: number;
  header: number;
  last: number;
}

/** Lines rendered beyond the visible ones, each way. */
const OVERSCAN = 6;
/** Size guesses until a line is measured (and for good where nothing can be
 *  measured). Rows vary: an article with a two-line excerpt is taller. */
const HEADER_HEIGHT = 36;
const ROW_HEIGHT = 80;
const ROW_HEIGHT_CONDENSED = 53;
/** The gallery grid: `gap-3` between cards, `px-1` around them. */
const CARD_GAP = 12;
const CARD_INSET = 8;
const CARD_MIN_WIDTH = { small: 150, medium: 210, large: 300 } as const;
/** Columns when the list's width is not known (no layout). */
const FALLBACK_COLUMNS = 3;

/** How many cards fit across — what `repeat(auto-fill, minmax(min, 1fr))` did
 *  in CSS, computed here because a window has to know its rows. */
export function galleryColumns(size: "small" | "medium" | "large", width: number): number {
  if (width <= 0) return FALLBACK_COLUMNS;
  return Math.max(1, Math.floor((width - CARD_INSET + CARD_GAP) / (CARD_MIN_WIDTH[size] + CARD_GAP)));
}

/**
 * Where the list was when it was last left, so coming back from an item
 * lands on the same rows: the Inbox is a mode of the column, and the view
 * unmounts every time an item opens. The measured line heights travel with
 * it — the offset only means the same rows if the lines above are as tall
 * as they were.
 */
const remembered: { top: number; measurements: VirtualItem[]; signature: string } = {
  top: 0,
  measurements: [],
  signature: "",
};

/** Test-only: the remembered scroll position is module-level. */
export function resetInboxViewScroll(): void {
  remembered.top = 0;
  remembered.measurements = [];
  remembered.signature = "";
}

/**
 * The Inbox view — the read-later list in the document column.
 *
 * No header bar: "Inbox · 12 items · 7 unread" is content, set like a
 * document title, and the controls live in the same floating pill the
 * viewers use (top right here, so it never covers the title). Rows group by
 * date with sticky headers; the gallery is the same items at three sizes.
 *
 * The list is WINDOWED: only the lines on screen (plus a few each way, and
 * the cursor's) are in the DOM. A 350-item Inbox used to mount 350 rows —
 * each with its own context menu, store subscriptions and thumbnail request
 * — on every return to the list. Where there is no layout to window by (a
 * viewport that measures 0: jsdom, a hidden column) every line renders.
 *
 * Keyboard, on the list: j / k or ↓ / ↑ move the cursor, ↩ opens,
 * e files to the last-used project, p pins, ⌘⌫ trashes, ⇧-click selects a
 * range, ⌘-click toggles. The same verbs are on the row's hover actions and
 * the context menu — `useInboxActions` is the single source for all three.
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

  const { open, fileTo, fileToLast, togglePin, trash, openOriginal, pinnedFiles, projects } = useInboxActions();
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const registerRef = useCallback((path: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(path, el);
    else rowRefs.current.delete(path);
  }, []);
  const mountedAt = useRef(performance.now());

  // One listing per open. `openInbox` has started one by the time this
  // mounts (`loading` is set synchronously); this covers a view that appears
  // any other way.
  useEffect(() => {
    if (!useInboxStore.getState().loading) void load();
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
  const itemByPath = useMemo(() => new Map(items.map((i) => [i.path, i])), [items]);
  // Membership as sets: `includes` per row was O(items × selection) per
  // render, and ⌘A makes the selection the whole list.
  const selected = useMemo(() => new Set(selection), [selection]);
  const pinned = useMemo(() => new Set(pinnedFiles), [pinnedFiles]);

  // The keyboard handlers read these through refs: every memoised row holds
  // `onKeyDown`, and a handler rebuilt whenever the listing changed (a file
  // arriving, one being filed) re-rendered every row for it.
  const orderRef = useRef(order);
  orderRef.current = order;
  const itemByPathRef = useRef(itemByPath);
  itemByPathRef.current = itemByPath;

  const destinationName = lastDestination ? lastDestination.slice(lastDestination.lastIndexOf("/") + 1) : null;

  // ── Layout the window needs: the viewport's height, the list's width, and
  //    how far down the scroll content the list starts. `null` = not
  //    measured yet (first render); 0 = there is no layout.
  const listRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<number | null>(null);
  const [listWidth, setListWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const list = listRef.current;
    if (!scroller || !list) return;
    const measure = () => {
      setViewport(scroller.offsetHeight);
      setListWidth(list.offsetWidth);
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);
  const noLayout = viewport === 0;
  const columns = layout === "gallery" ? galleryColumns(gallerySize, listWidth) : 1;

  const { entries, spans, entryOf } = useMemo(() => {
    const entries: Entry[] = [];
    const spans: GroupSpan[] = [];
    const entryOf = new Map<string, number>();
    let pos = 0;
    groups.forEach((group, g) => {
      const header = entries.length;
      entries.push({ kind: "header", key: `h:${group.key}`, group: g });
      if (layout === "list") {
        for (const item of group.items) {
          entryOf.set(item.path, entries.length);
          entries.push({ kind: "row", key: item.path, group: g, item, pos, last: false });
          pos += 1;
        }
      } else {
        for (let i = 0; i < group.items.length; i += columns) {
          const cards = group.items.slice(i, i + columns);
          for (const item of cards) entryOf.set(item.path, entries.length);
          entries.push({ kind: "cards", key: `c:${cards[0].path}`, group: g, items: cards, pos, last: false });
          pos += cards.length;
        }
      }
      const last = entries[entries.length - 1];
      if (last.kind !== "header") last.last = true;
      spans.push({ key: group.key, title: group.title, count: group.items.length, header, last: entries.length - 1 });
    });
    return { entries, spans, entryOf };
  }, [groups, layout, columns]);

  const cardWidth = columns > 0 && listWidth > 0 ? (listWidth - CARD_INSET - (columns - 1) * CARD_GAP) / columns : CARD_MIN_WIDTH[gallerySize];
  const estimateSize = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (!entry || entry.kind === "header") return HEADER_HEIGHT;
      if (entry.kind === "row") return condensed ? ROW_HEIGHT_CONDENSED : ROW_HEIGHT;
      // p-2, a 16:10 picture, then the title (and a sub line above "small").
      return Math.round(cardWidth * 0.625) + (gallerySize === "small" ? 50 : 86) + CARD_GAP;
    },
    [entries, condensed, cardWidth, gallerySize],
  );
  const getItemKey = useCallback((index: number) => entries[index]?.key ?? index, [entries]);

  // What a remembered measurement is valid for: the same kind of lines.
  const signature = `${layout}|${condensed}|${gallerySize}`;
  const [restore] = useState(() => ({
    top: remembered.top,
    measurements: remembered.signature === signature ? remembered.measurements : [],
  }));
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    overscan: OVERSCAN,
    scrollMargin,
    initialOffset: restore.top,
    initialMeasurementsCache: restore.measurements,
  });
  const signatureRef = useRef(signature);
  signatureRef.current = signature;
  useEffect(
    () => () => {
      remembered.measurements = virtualizer.measurementsCache;
      remembered.signature = signatureRef.current;
    },
    [virtualizer],
  );

  // Where the list starts inside the scroll content: under the title, and
  // under either "nothing here" message. The scroller is the list's offset
  // parent (it is `relative`), so this is independent of the scroll position.
  const emptyShown = !loading && (items.length === 0 || visible.length === 0);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || noLayout) return;
    const margin = list.offsetTop;
    setScrollMargin((current) => (current === margin ? current : margin));
  }, [emptyShown, viewport, listWidth, noLayout]);

  // ── The window. The cursor's line is always in it: it is the row that
  //    holds DOM focus, and a focused row that scrolled out of the window
  //    and unmounted would take the keyboard with it.
  const windowed = virtualizer.getVirtualIndexes();
  const measured = virtualizer.measurementsCache;
  const cursorEntry = cursor !== null ? entryOf.get(cursor) : undefined;
  const indexes = useMemo(() => {
    if (noLayout) return entries.map((_, i) => i);
    if (viewport === null || cursorEntry === undefined || windowed.includes(cursorEntry)) return windowed;
    return [...windowed, cursorEntry].sort((a, b) => a - b);
  }, [noLayout, viewport, entries, windowed, cursorEntry]);
  const linesByGroup = useMemo(() => {
    const byGroup = new Map<number, number[]>();
    for (const index of indexes) {
      const entry = entries[index];
      if (!entry) continue;
      let lines = byGroup.get(entry.group);
      if (!lines) byGroup.set(entry.group, (lines = []));
      if (entry.kind !== "header") lines.push(index);
    }
    return byGroup;
  }, [indexes, entries]);
  // Measuring needs layout; without one every line would measure 0.
  const measureRef = noLayout ? undefined : virtualizer.measureElement;

  const logged = useRef(false);
  useEffect(() => {
    if (logged.current || viewport === null || entries.length === 0) return;
    logged.current = true;
    log.info("perf:inbox", "view mount", {
      items: order.length,
      lines: entries.length,
      mounted: indexes.length,
      layout,
      windowed: !noLayout,
      ms: Math.round(performance.now() - mountedAt.current),
    });
  });

  /** Put DOM focus on the store's cursor row — after a move, and after the
   *  focused row left the list (filed or trashed), so `e, e, e` keeps going.
   *  The row may not be in the DOM yet (the cursor only just moved onto a
   *  line outside the window), so the request is kept until the commit that
   *  mounts it. */
  const focusPending = useRef(false);
  const listHadFocus = useRef(false);
  const flushFocus = useCallback(() => {
    if (!focusPending.current) return;
    const path = useInboxStore.getState().cursor;
    if (!path) {
      // Nothing left to land on (the last item was filed or trashed): keep
      // focus in the view so Escape / ⌘⇧I still work, rather than on <body>.
      focusPending.current = false;
      listRef.current?.focus();
      return;
    }
    const el = rowRefs.current.get(path);
    if (!el) return;
    focusPending.current = false;
    el.focus();
    // Optional: jsdom has no scrollIntoView, and neither do some embeds.
    el.scrollIntoView?.({ block: "nearest" });
  }, []);
  const focusCursorRow = useCallback(() => {
    focusPending.current = true;
    flushFocus();
  }, [flushFocus]);
  useLayoutEffect(() => {
    // The focused row was removed under the keyboard (filed, trashed): the
    // browser drops focus to <body> without a blur. Follow the cursor.
    const list = listRef.current;
    if (listHadFocus.current && list && !list.contains(document.activeElement)) focusPending.current = true;
    if (!focusPending.current) return;
    // A cursor the filter has hidden has no row to wait for.
    const path = useInboxStore.getState().cursor;
    if (path && !entryOf.has(path)) {
      focusPending.current = false;
      return;
    }
    flushFocus();
  });
  const onListFocus = useCallback(() => {
    listHadFocus.current = true;
  }, []);
  const onListBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    // A blur that comes from the focused row being REMOVED is not the user
    // leaving the list.
    if (event.relatedTarget === null && !event.target.isConnected) return;
    if (!event.currentTarget.contains(event.relatedTarget)) listHadFocus.current = false;
  }, []);

  // Reads the cursor from the store rather than closing over it: closing over
  // `cursor` would re-create this handler — and every memoised row's
  // `onKeyDown` — on each keystroke.
  const moveCursor = useCallback(
    (delta: 1 | -1, extend: boolean) => {
      const order = orderRef.current;
      if (order.length === 0) return;
      const cur = useInboxStore.getState().cursor;
      const at = cur ? order.indexOf(cur) : -1;
      const next = order[Math.min(order.length - 1, Math.max(0, at + delta))];
      if (!next) return;
      if (extend) select(next, { shift: true });
      else setCursor(next);
      focusCursorRow();
    },
    [select, setCursor, focusCursorRow],
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
          const path = store.cursor ?? targets[0];
          const item = path ? itemByPathRef.current.get(path) : undefined;
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
            const order = orderRef.current;
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
    [moveCursor, open, fileToLast, togglePin, trash, clearSelection, focusCursorRow],
  );

  const onSelect = useCallback(
    (item: InboxItem, modifiers: { shift: boolean; meta: boolean }) => select(item.path, modifiers),
    [select],
  );
  const onFileToLast = useCallback((paths: string[]) => void fileToLast(paths).then(focusCursorRow), [fileToLast, focusCursorRow]);
  const onTrash = useCallback((paths: string[]) => void trash(paths).then(focusCursorRow), [trash, focusCursorRow]);
  const onMenuCloseFocus = useCallback(
    (path: string) => {
      const el = rowRefs.current.get(path);
      if (el) el.focus();
      else focusCursorRow();
    },
    [focusCursorRow],
  );

  const offsetOf = (index: number) => measured[index]?.start ?? scrollMargin;
  const endOf = (index: number) => measured[index]?.end ?? scrollMargin;

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

      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto"
        data-doc-scroll=""
        onScroll={(event) => {
          remembered.top = event.currentTarget.scrollTop;
        }}
      >
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

          <InboxItemMenu
            itemAt={(path) => itemByPath.get(path)}
            isPinned={(path) => pinned.has(path)}
            projects={projects}
            onOpen={(item) => void open(item)}
            onOpenOriginal={(path) => void openOriginal(path)}
            onFileTo={(paths, projectPath) => void fileTo(paths, projectPath).then(focusCursorRow)}
            onFileToLast={onFileToLast}
            onTogglePin={togglePin}
            onTrash={onTrash}
            onCloseFocus={onMenuCloseFocus}
          >
            <div
              ref={listRef}
              role="listbox"
              tabIndex={-1}
              aria-multiselectable="true"
              aria-label={INBOX_FOLDER_NAME}
              className="relative focus:outline-none"
              style={{ height: virtualizer.getTotalSize() }}
              onFocus={onListFocus}
              onBlur={onListBlur}
            >
              {/* ARIA: a listbox owns options, or groups of options. The date
                  sections are `group`s and the line wrappers are
                  presentational so the options stay the listbox's own
                  children. Each group is as tall as ALL its lines — mounted
                  or not — so its header stays sticky across the whole of it. */}
              {spans.map((span, g) => {
                const lines = linesByGroup.get(g);
                if (!lines) return null;
                const top = offsetOf(span.header);
                return (
                  <div
                    key={span.key}
                    role="group"
                    aria-label={span.title}
                    className="absolute inset-x-0"
                    style={{ top: top - scrollMargin, height: endOf(span.last) - top }}
                  >
                    <h2
                      ref={measureRef}
                      data-index={span.header}
                      className="sticky top-0 z-10 flex items-center justify-between bg-background/85 px-3 pb-1.5 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur"
                    >
                      {span.title}
                      <span className="font-mono normal-case tracking-normal">{span.count}</span>
                    </h2>
                    {lines.map((index) => {
                      const entry = entries[index];
                      if (entry.kind === "row") {
                        const item = entry.item;
                        return (
                          <div
                            key={entry.key}
                            ref={measureRef}
                            data-index={index}
                            role="presentation"
                            className={cn("absolute inset-x-0", !entry.last && "border-b border-border/70")}
                            style={{ top: offsetOf(index) - top }}
                          >
                            <InboxRow
                              item={item}
                              meta={meta[item.path]}
                              entry={progress.items[item.name]}
                              selected={selected.has(item.path)}
                              cursor={cursor === item.path}
                              condensed={condensed}
                              pinned={pinned.has(item.path)}
                              destinationName={destinationName}
                              posInSet={entry.pos + 1}
                              setSize={order.length}
                              onOpen={open}
                              onSelect={onSelect}
                              onFileToLast={onFileToLast}
                              onTogglePin={togglePin}
                              onTrash={onTrash}
                              onKeyDown={onRowKeyDown}
                              registerRef={registerRef}
                            />
                          </div>
                        );
                      }
                      if (entry.kind !== "cards") return null;
                      return (
                        <div
                          key={entry.key}
                          ref={measureRef}
                          data-index={index}
                          role="presentation"
                          className={cn("absolute inset-x-0 grid gap-3 px-1", entry.last ? "pb-4" : "pb-3")}
                          style={{ top: offsetOf(index) - top, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                        >
                          {entry.items.map((item, i) => (
                            <InboxCard
                              key={item.path}
                              item={item}
                              meta={meta[item.path]}
                              entry={progress.items[item.name]}
                              selected={selected.has(item.path)}
                              cursor={cursor === item.path}
                              size={gallerySize}
                              posInSet={entry.pos + i + 1}
                              setSize={order.length}
                              onOpen={open}
                              onSelect={onSelect}
                              onKeyDown={onRowKeyDown}
                              registerRef={registerRef}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </InboxItemMenu>
        </div>
      </div>
    </div>
  );
}
