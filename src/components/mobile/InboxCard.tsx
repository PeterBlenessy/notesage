import { useEffect, useState } from "react";
import { ChevronRight, Inbox } from "lucide-react";
import { iosListDirectory } from "@/lib/ios-api";
import { t } from "@/lib/i18n";

/**
 * The Inbox, pinned above the root listing (#683).
 *
 * Shared items land in `Inbox/`, but it is an ordinary folder in an
 * alphabetical list — so after sharing a few links from Safari, getting to
 * them meant scrolling, or switching the whole listing to sort-by-date
 * (Peter, 2026-08-13). Apple Notes solves the same problem the same way:
 * Quick Notes and Shared sit in their own card above the folder list, with a
 * count, in a fixed position no sort or grouping can move.
 *
 * Rendered ONLY at the library root — one level down it is noise, and the
 * breadcrumb island's permanent "Inbox" entry covers reaching it from depth.
 */
export function InboxCard({ onOpen }: { onOpen: () => void }) {
  // `null` until counted; the row renders without a count rather than
  // withholding the whole card behind an extra directory read.
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void iosListDirectory("Inbox")
      .then((entries) => {
        if (!cancelled) setCount(entries.length);
      })
      .catch(() => {
        // No Inbox yet (nothing ever shared) — the card is hidden by the
        // caller in that case; a failure here just means no count.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="px-4 pb-3">
      <button
        type="button"
        onClick={onOpen}
        className="ios-press-row flex w-full items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5 text-left"
      >
        <Inbox strokeWidth={1.5} className="h-5 w-5 shrink-0 text-[var(--color-accent-primary)]" />
        <span
          className="min-w-0 flex-1 truncate text-[length:calc(1rem*var(--ns-a11y-scale,1))] text-foreground"
          style={{ fontWeight: "var(--ns-a11y-weight, 500)" }}
        >
          {t("library.inbox")}
        </span>
        {count !== null && (
          <span className="shrink-0 text-[length:calc(0.875rem*var(--ns-a11y-scale,1))] text-muted-foreground">
            {count}
          </span>
        )}
        <ChevronRight strokeWidth={1.5} className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </div>
  );
}
