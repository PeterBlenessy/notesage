import { ChevronRight, Folder, FileText, FileImage, FileType, FileCode, File, FilePlay, Share, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { FileEntry } from "@/lib/tauri";
import { iosShareFile, iosDeleteFile } from "@/lib/ios-api";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { SwipeRevealRow, type SwipeRevealAction } from "./SwipeRevealRow";
import { useLongPress } from "./useLongPress";
import {
  confirmDelete,
  presentEntryMenu,
  type EntryActionContext,
} from "@/lib/mobile-entry-actions";

/** Classify a file by extension for icon + viewer routing. */
export function classifyFile(
  name: string,
): "markdown" | "image" | "text" | "pdf" | "doc" | "media" | "html" | "other" {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "md" || ext === "markdown") return "markdown";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["epub", "docx", "pptx"].includes(ext)) return "doc";
  // Videos and audio (shared screen recordings, voice memos, …) — opened
  // via the native QuickLook player, never the web reader.
  if (["mp4", "mov", "m4v", "mp3", "m4a", "wav", "aac", "caf"].includes(ext)) return "media";
  // Rendered, not shown as source: exported reports are self-contained HTML
  // whose charts and interactivity are inline scripts. iOS Files shows them as
  // markup with scripts disabled, which is the gap this reader closes.
  if (ext === "html" || ext === "htm") return "html";
  // Treated as readable text (code files, txt, csv, json, yaml, etc.)
  if (
    [
      "txt", "text", "log", "csv", "json", "yaml", "yml", "toml", "xml",
      "css", "js", "jsx", "ts", "tsx", "rs", "py", "go", "java", "c", "cpp", "h", "sh",
      "sql", "swift", "kt", "rb", "php",
    ].includes(ext)
  ) {
    return "text";
  }
  return "other";
}

/** Icon for a file's classification — shared with the gallery view's card
 *  thumbnail fallback (#633), so list and gallery agree on iconography. */
export function iconFor(entry: FileEntry) {
  if (entry.is_directory) return Folder;
  switch (classifyFile(entry.name)) {
    case "markdown":
      return FileText;
    case "image":
      return FileImage;
    case "pdf":
    case "doc":
      return FileType;
    case "media":
      return FilePlay;
    case "html":
      return FileCode;
    case "text":
      return FileText;
    default:
      return File;
  }
}

/**
 * Files-app-style modified label (#588): time for today, "Yesterday", then
 * a locale date (year included only when it differs). Locale-aware via the
 * platform formatter — no strings of our own beyond "Yesterday"'s key.
 */
export function formatModified(seconds: number, now: Date = new Date()): string {
  const d = new Date(seconds * 1000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, now)) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return t("section.yesterday");
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

interface FileRowProps {
  entry: FileEntry;
  active?: boolean;
  onActivate: (entry: FileEntry) => void;
  /** Called after a row action mutates the listing (delete) so the parent
   *  can refresh. */
  onChanged?: () => void;
  /** Long-press actions (#680) — the same set the gallery offers, so the two
   *  layouts expose identical capabilities. */
  actionContext: EntryActionContext;
}

/**
 * A single tappable row in the mobile library browser. Swipe left to reveal
 * row actions (Share today; #619 adds Delete to this same array, without
 * touching the gesture in `SwipeRevealRow`).
 */
export function FileRow({ entry, active, onActivate, onChanged, actionContext }: FileRowProps) {
  const Icon = iconFor(entry);
  // Hold for the full menu — iOS itself offers both swipe AND hold on a list
  // row (Files, Notes), and hold is the only way to reach Rename/Pin here.
  const longPress = useLongPress((rect) => {
    void presentEntryMenu(entry, rect, actionContext);
  });
  // Directories have no share concept in Notesage today — `ios_share_file`
  // copies a single file to a temp location for the share sheet, mirroring
  // its only other consumer (the Reader, which only ever shares a document).
  // Delete is EDGE-MOST (last) — the full-swipe gesture commits the last
  // action, and in iOS that is always the destructive one. No confirm:
  // iCloud's "Recently Deleted" gives 30-day recovery (#618).
  const actions: SwipeRevealAction[] = entry.is_directory
    ? []
    : [
        {
          id: "share",
          label: t("action.share"),
          icon: Share,
          onSelect: () => {
            void iosShareFile(entry.path).catch((err) => toast.error(t("action.shareFailed", { error: String(err) })));
          },
        },
        {
          id: "delete",
          label: t("action.delete"),
          icon: Trash2,
          tone: "destructive",
          onSelect: () => {
            // Confirm first (#680): a full swipe commits this action outright,
            // which is easy to trigger by accident.
            void confirmDelete(entry).then((ok) => {
              if (!ok) return;
              return iosDeleteFile(entry.path)
                .then(() => onChanged?.())
                .catch((err) => toast.error(t("action.deleteFailed", { error: String(err) })));
            });
          },
        },
      ];

  return (
    <SwipeRevealRow actions={actions}>
      <button
        type="button"
        onClick={() => onActivate(entry)}
        {...longPress}
        aria-current={active ? "page" : undefined}
        className={cn(
          "ios-press-row flex w-full items-center gap-3 px-4 py-2.5 text-left",
          "border-b border-border last:border-b-0",
          "hover:bg-muted/50",
          active && "bg-muted",
        )}
      >
        <Icon
          strokeWidth={1.5}
          className={cn(
            "h-5 w-5 shrink-0",
            active ? "text-[var(--color-accent-primary)]" : "text-muted-foreground",
            entry.hidden && "opacity-50",
          )}
        />
        {/* One line, so the icon reads as aligned WITH the name rather than
            floating between two lines of unequal weight (#684). The modified
            date moved to the section headers — see `dateSection`. */}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[length:calc(0.875rem*var(--ns-a11y-scale,1))] text-foreground",
            entry.hidden && "opacity-60",
          )}
          style={{
            fontWeight: active
              ? "max(500, var(--ns-a11y-weight, 400))"
              : "var(--ns-a11y-weight, 400)",
          }}
        >
          {entry.name}
        </span>
        {entry.is_directory && entry.child_count !== undefined && (
          <span className="shrink-0 text-[length:calc(0.875rem*var(--ns-a11y-scale,1))] tabular-nums text-muted-foreground">
            {entry.child_count}
          </span>
        )}
        {entry.is_directory && (
          <ChevronRight strokeWidth={1.5} className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
    </SwipeRevealRow>
  );
}
