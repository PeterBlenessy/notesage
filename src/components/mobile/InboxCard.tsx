import { ChevronRight, Inbox } from "lucide-react";
import { INBOX_FOLDER_NAME } from "@/lib/inbox";

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
export function InboxCard({ count, unread, onOpen }: { count?: number; unread?: number; onOpen: () => void }) {
  return (
    <div className="px-2 pb-3">
      {/* Geometry is deliberately IDENTICAL to FileRow — same icon size, gap,
          text size, weight, count, chevron — so the pinned row reads as one
          of the list's own rows that happens to be highlighted, not as a
          different kind of control (#684). Only the background and radius
          differ.

          The horizontal inset is SPLIT between the wrapper and the button
          (8 + 8) so it totals FileRow's own `px-4`: putting the full 16 px on
          the button would stack it on top of the wrapper's, pushing icon,
          count and chevron a further 16 px inward and visibly breaking the
          column the rows below establish. */}
      <button
        type="button"
        onClick={onOpen}
        className="ios-press-row flex w-full items-center gap-3 rounded-xl bg-muted/60 px-2 py-2 text-left"
      >
        {/* The same 40pt slot every file row centres its icon in, so the
            Inbox icon lines up with the folder icons beneath it (Peter,
            2026-09-04: it sat a slot's half-width to the left). */}
        <span className="flex h-10 w-10 shrink-0 items-center justify-center">
          <Inbox strokeWidth={1.5} className="h-5 w-5 shrink-0 text-[var(--color-accent-primary)]" />
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[length:calc(1.0625rem*var(--ns-a11y-scale,1))] text-foreground"
          style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
        >
          {INBOX_FOLDER_NAME}
        </span>
        {/* The unread count — the same number as the icon badge, from the
            same native count — in the accent when there is something to
            read; otherwise the total, muted, as before. */}
        {unread !== undefined && unread > 0 ? (
          <span
            className="shrink-0 text-[length:calc(1.0625rem*var(--ns-a11y-scale,1))] tabular-nums text-[var(--color-accent-primary)]"
            data-testid="inbox-unread"
          >
            {unread}
          </span>
        ) : (
          count !== undefined && (
            <span className="shrink-0 text-[length:calc(1.0625rem*var(--ns-a11y-scale,1))] tabular-nums text-muted-foreground">
              {count}
            </span>
          )
        )}
        <ChevronRight strokeWidth={1.5} className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </div>
  );
}
