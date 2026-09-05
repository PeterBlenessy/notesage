import { ChevronRight, Folders } from "lucide-react";
import { t } from "@/lib/i18n";

/**
 * The way out of a curated Home: one row, always last, that pushes the full
 * root listing as a level of its own (Back returns to Home) — Notes puts
 * "All iCloud" at the bottom of its folder list for the same reason.
 *
 * Geometry is the Inbox card's (the same 40pt icon slot, text size and
 * chevron, the same split inset) so it sits in the column the rows above it
 * establish; only the tint is missing — the Inbox is the highlighted row,
 * this is a plain one.
 */
export function AllFoldersRow({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="px-2 pb-3 pt-1">
      <button
        type="button"
        onClick={onOpen}
        className="ios-press-row flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center">
          <Folders strokeWidth={1.5} className="h-5 w-5 shrink-0 text-muted-foreground" />
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[length:calc(1.0625rem*var(--ns-a11y-scale,1))] text-foreground"
          style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
        >
          {t("home.allFolders")}
        </span>
        <ChevronRight strokeWidth={1.5} className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </div>
  );
}
