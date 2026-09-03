import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ExternalLink, Pin } from "lucide-react";
import { useInboxStore } from "@/stores/inbox-store";
import { useInboxActions } from "./useInboxActions";
import { INBOX_STEP_EVENT } from "@/lib/keyboard/shortcut-events";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const BTN =
  "inline-flex items-center gap-1 h-7 px-2 rounded-full text-xs hover:bg-muted/60 transition-colors disabled:opacity-50 disabled:pointer-events-none";

/**
 * Scroll progress of the document column: the fraction of the tagged scroll
 * container (`[data-doc-scroll]`, set by the HTML and PDF viewers) that has
 * been scrolled past, sampled at most every 250 ms — the phone's rule.
 *
 * Looked up by attribute rather than passed through props because the
 * viewers sit three components down from where the Inbox knows an item is
 * open, and the tag is one line in each viewer.
 */
function useDocScrollProgress(path: string | null, onProgress: (fraction: number) => void) {
  const lastRef = useRef(0);
  useEffect(() => {
    if (!path) return;
    const root = document.querySelector("[data-doc-area]");
    if (!root) return;
    let el: HTMLElement | null = null;
    let handler: (() => void) | null = null;
    const attach = () => {
      const found = root.querySelector<HTMLElement>("[data-doc-scroll]");
      if (!found || found === el) return;
      if (el && handler) el.removeEventListener("scroll", handler);
      el = found;
      handler = () => {
        const now = Date.now();
        if (now - lastRef.current < 250) return;
        lastRef.current = now;
        const span = el!.scrollHeight - el!.clientHeight;
        if (span > 1) onProgress(el!.scrollTop / span);
        else onProgress(1);
      };
      el.addEventListener("scroll", handler, { passive: true });
    };
    attach();
    // The viewer mounts asynchronously (lazy import, content load): watch for it.
    const observer = new MutationObserver(attach);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (el && handler) el.removeEventListener("scroll", handler);
    };
  }, [path, onProgress]);
}

/**
 * The reader's controls for an item opened from the Inbox, rendered as the
 * leading slot of the document column's pill: back to the list, position
 * and progress, file to the last destination, pin, open original.
 */
export function InboxReaderControls({ path }: { path: string }) {
  const openInbox = useInboxStore((s) => s.openInbox);
  const recordProgress = useInboxStore((s) => s.recordProgress);
  const entry = useInboxStore((s) => s.progress.items[path.slice(path.lastIndexOf("/") + 1)]);
  // Position in the list the reader is stepping through — the FILTERED one,
  // which is what ⌘↑ / ⌘↓ walk.
  const items = useInboxStore((s) => s.items);
  const filter = useInboxStore((s) => s.filter);
  const metaAll = useInboxStore((s) => s.meta);
  const meta = useInboxStore((s) => s.meta[path]);
  const lastDestination = useInboxStore((s) => s.lastDestination);
  const { open, fileToLast, togglePin, openOriginal, pinnedFiles } = useInboxActions();
  const [busy, setBusy] = useState(false);

  // ⌘↑ / ⌘↓ from the global dispatcher.
  useEffect(() => {
    const onStep = (event: Event) => {
      const direction = (event as CustomEvent<{ direction: 1 | -1 }>).detail?.direction;
      if (direction !== 1 && direction !== -1) return;
      const next = useInboxStore.getState().neighbour(path, direction);
      if (next) void open(next);
    };
    window.addEventListener(INBOX_STEP_EVENT, onStep);
    return () => window.removeEventListener(INBOX_STEP_EVENT, onStep);
  }, [path, open]);

  const position = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const order = q
      ? items.filter((it) => {
          const m = metaAll[it.path];
          return [it.name, m?.title, m?.site, m?.excerpt].filter(Boolean).join(" ").toLowerCase().includes(q);
        })
      : items;
    const i = order.findIndex((it) => it.path === path);
    return i >= 0 ? { index: i + 1, total: order.length } : null;
  }, [items, filter, metaAll, path]);

  const onProgress = useMemo(() => (fraction: number) => recordProgress(path, fraction), [recordProgress, path]);
  useDocScrollProgress(path, onProgress);

  const fraction = entry?.fraction ?? 0;
  const pinned = pinnedFiles.includes(path);
  const destinationName = lastDestination ? lastDestination.slice(lastDestination.lastIndexOf("/") + 1) : null;

  return (
    <div className="inline-flex items-center gap-0.5" data-inbox-reader-controls="">
      <button type="button" className={cn(BTN, "text-foreground")} onClick={openInbox} aria-label={t("inbox.back")}>
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        <span>{t("inbox.title")}</span>
      </button>
      {position && (
        <span
          className="inline-flex items-center gap-1.5 px-1.5 text-[11px] font-mono text-muted-foreground tabular-nums"
          aria-label={t("inbox.positionLabel", { index: position.index, total: position.total, percent: Math.round(fraction * 100) })}
        >
          {position.index} / {position.total}
          <span className="relative block h-[3px] w-11 rounded-full bg-border" aria-hidden="true">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-foreground/70"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </span>
        </span>
      )}
      <span className="w-px h-3.5 bg-border/60 mx-0.5" aria-hidden="true" />
      <button
        type="button"
        className={BTN}
        disabled={!destinationName || busy}
        onClick={async () => {
          setBusy(true);
          try {
            // Decide the successor BEFORE the move takes this item out of
            // the list: the next one down, else the previous, else the list.
            const store = useInboxStore.getState();
            const successor = store.neighbour(path, 1) ?? store.neighbour(path, -1);
            const moved = await fileToLast([path]);
            if (moved.length > 0) {
              if (successor) void open(successor);
              else openInbox();
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        {destinationName ? t("inbox.fileTo", { project: destinationName }) : t("inbox.fileToEllipsis")}
      </button>
      <button
        type="button"
        className={cn(BTN, "w-7 justify-center px-0", pinned && "text-[var(--color-accent-primary)]")}
        onClick={() => togglePin([path])}
        aria-label={pinned ? t("inbox.unpin") : t("inbox.pin")}
        aria-pressed={pinned}
        title={pinned ? t("inbox.unpin") : t("inbox.pin")}
      >
        <Pin className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className={cn(BTN, "w-7 justify-center px-0")}
        disabled={!meta?.sourceUrl}
        onClick={() => void openOriginal(path)}
        aria-label={t("inbox.openOriginal")}
        title={t("inbox.openOriginal")}
      >
        <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
      <span className="ml-1 px-1 text-[11px] font-mono text-muted-foreground" aria-hidden="true">
        ⌘↑ ⌘↓
      </span>
    </div>
  );
}
