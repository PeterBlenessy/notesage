import { ChevronRight, Folder, FileText, FileImage, FileType, FileCode, File, Share, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { FileEntry } from "@/lib/tauri";
import { iosShareFile, iosDeleteFile } from "@/lib/ios-api";
import { cn } from "@/lib/utils";
import { SwipeRevealRow, type SwipeRevealAction } from "./SwipeRevealRow";

/** Classify a file by extension for icon + viewer routing. */
export function classifyFile(
  name: string,
): "markdown" | "image" | "text" | "pdf" | "doc" | "html" | "other" {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "md" || ext === "markdown") return "markdown";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["epub", "docx", "pptx"].includes(ext)) return "doc";
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

function iconFor(entry: FileEntry) {
  if (entry.is_directory) return Folder;
  switch (classifyFile(entry.name)) {
    case "markdown":
      return FileText;
    case "image":
      return FileImage;
    case "pdf":
    case "doc":
      return FileType;
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
  if (sameDay(d, yesterday)) return "Yesterday";
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
}

/**
 * A single tappable row in the mobile library browser. Swipe left to reveal
 * row actions (Share today; #619 adds Delete to this same array, without
 * touching the gesture in `SwipeRevealRow`).
 */
export function FileRow({ entry, active, onActivate, onChanged }: FileRowProps) {
  const Icon = iconFor(entry);
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
          label: "Share",
          icon: Share,
          onSelect: () => {
            void iosShareFile(entry.path).catch((err) => toast.error(`Couldn't share: ${err}`));
          },
        },
        {
          id: "delete",
          label: "Delete",
          icon: Trash2,
          tone: "destructive",
          onSelect: () => {
            void iosDeleteFile(entry.path)
              .then(() => onChanged?.())
              .catch((err) => toast.error(`Couldn't delete: ${err}`));
          },
        },
      ];

  return (
    <SwipeRevealRow actions={actions}>
      <button
        type="button"
        onClick={() => onActivate(entry)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "ios-press-row flex w-full items-center gap-3 px-4 py-1.5 text-left",
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
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm",
              active ? "font-medium text-foreground" : "text-foreground",
              entry.hidden && "opacity-60",
            )}
          >
            {entry.name}
          </span>
          {entry.modified !== undefined && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {formatModified(entry.modified)}
            </span>
          )}
        </span>
        {entry.is_directory && (
          <ChevronRight strokeWidth={1.5} className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
    </SwipeRevealRow>
  );
}
