import { useEffect, useState } from "react";
import { ChevronRight, Folder, FileText, FileImage, FileType, FileCode, File, FilePlay, FileAudio, Share, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getThumbnail, type ThumbnailResult } from "@/lib/mobile-thumbnails";
import type { FileEntry } from "@/lib/tauri";
import { iosShareFile, iosDeleteFile } from "@/lib/ios-api";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { SwipeRevealRow, type SwipeRevealAction } from "./SwipeRevealRow";
import { useLongPress } from "./useLongPress";
import { useFolderAppearance } from "./useFolderAppearance";
import {
  confirmDelete,
  presentEntryMenu,
  type EntryActionContext,
} from "@/lib/mobile-entry-actions";
import { getFormatLocale } from "@/lib/i18n";

/** The `media` kind, split by what the icon should say.
 *
 *  Both halves open in the same native player, so this split does not affect
 *  routing — it picks the glyph. That matters more than it looks: QuickLook can
 *  only make a thumbnail for an audio file carrying embedded cover art, so for
 *  a voice memo the icon is not a fallback, it is permanently the entire card.
 *
 *  Declared as the two halves and unioned below rather than written out twice.
 *  A second hand-maintained copy of these extensions is precisely the drift
 *  this file's guard exists to catch, and it would fail silently here: an
 *  audio format added to one list and not the other still classifies as
 *  `media`, so nothing breaks — it just quietly wears the video glyph. */
const AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "aac", "caf", "ogg", "flac"];
const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm"];

function extensionOf(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
}

export function isAudioFile(name: string): boolean {
  return AUDIO_EXTENSIONS.includes(extensionOf(name));
}

/** OpenDocument text / presentation.
 *
 *  Split out because these are the one `doc` type iOS QuickLook has no
 *  generator for, so the thumbnail pipeline needs a name for "try the
 *  preview embedded in the package instead". */
export function isOpenDocument(name: string): boolean {
  return ["odt", "odp"].includes(extensionOf(name));
}

/** Classify a file by extension for icon + viewer routing.
 *
 *  INVARIANT: every extension the capture pipeline can land in the library must
 *  be classified here as something other than `other`. `other` is the dead end
 *  — generic icon, no thumbnail attempted (`mobile-thumbnails.ts` gates its
 *  native QuickLook call on the kinds below), and activation falls to the
 *  Reader's "unsupported" card rather than the native viewer.
 *
 *  That is how odt/odp/rtf/tiff/webm/ogg/flac arrived broken: `linked_document_
 *  for_content_type` (notesage-capture) learned to save them, this list did
 *  not, and they landed as grey generic rows. When adding a row there, add the
 *  extension here — `classify_file_covers_every_linked_document_extension` in
 *  FileRow.test.tsx fails the build if the two lists drift apart. */
export function classifyFile(
  name: string,
): "markdown" | "image" | "text" | "pdf" | "doc" | "media" | "html" | "other" {
  const ext = extensionOf(name);
  if (ext === "md" || ext === "markdown") return "markdown";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic", "tif", "tiff"].includes(ext))
    return "image";
  if (ext === "pdf") return "pdf";
  if (["epub", "docx", "pptx", "odt", "odp", "rtf"].includes(ext)) return "doc";
  // Videos and audio (shared screen recordings, voice memos, …) — opened
  // via the native QuickLook player, never the web reader.
  if (VIDEO_EXTENSIONS.includes(ext) || AUDIO_EXTENSIONS.includes(ext)) return "media";
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

/** The kinds whose list row shows a real thumbnail instead of the icon.
 *
 *  These are exactly the kinds `mobile-thumbnails.ts` can turn into a picture
 *  (QuickLook natively, the web pipeline as fallback). Markdown and text get a
 *  source preview there, which reads as nothing at 40pt, so they keep the
 *  icon; the article row (#836) already covers captured HTML, and a plain HTML
 *  file falls back to this row and still gets its page render.
 *
 *  Until now only the article row carried a thumbnail: a PNG in the Inbox was
 *  listed by name beside a generic glyph while the gallery drew the picture
 *  from the same pipeline (Peter, 2026-09-03). */
const THUMBNAIL_KINDS: ReadonlySet<ReturnType<typeof classifyFile>> = new Set([
  "image", "pdf", "doc", "media", "html",
]);

/** The two thumbnail-slot sizes, shared with `ArticleRow` so a saved article
 *  and the PDF under it can never drift apart: 72pt at rest, 40pt condensed. */
export const THUMBNAIL_SLOT = {
  large: "h-[4.5rem] w-[4.5rem]",
  small: "h-10 w-10",
} as const;

export function rowWantsThumbnail(entry: FileEntry): boolean {
  return !entry.is_directory && THUMBNAIL_KINDS.has(classifyFile(entry.name));
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
      return isAudioFile(entry.name) ? FileAudio : FilePlay;
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
    return d.toLocaleTimeString(getFormatLocale(), { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return t("section.yesterday");
  return d.toLocaleDateString(getFormatLocale(), {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/**
 * The swipe-to-reveal actions for one library row (#618, #619).
 *
 * Shared with `ArticleRow` rather than built inside `FileRow`, because for a
 * long time it was NOT: a saved article had no swipe at all, so the same
 * gesture that deleted the PDF above it did nothing on the article — and the
 * only rows that DID swipe were the ones without a Listen button, which made
 * the two look like alternatives (Peter, 2026-09-05). They are not: every
 * file swipes, and a capture additionally reads aloud.
 *
 * Folders get an empty array (no share concept — `ios_share_file` copies a
 * single file), which `SwipeRevealRow` treats as "no gesture".
 *
 * Delete is EDGE-MOST (last) — the full-swipe gesture commits the last
 * action, and in iOS that is always the destructive one.
 */
export function entrySwipeActions(
  entry: FileEntry,
  actionContext: EntryActionContext,
  onChanged?: () => void,
): SwipeRevealAction[] {
  if (entry.is_directory) return [];
  return [
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
            .then(() => {
              // The same forgetting the hold menu's Delete does.
              actionContext.onPathRemoved?.(entry.path);
              onChanged?.();
            })
            .catch((err) => toast.error(t("action.deleteFailed", { error: String(err) })));
        });
      },
    },
  ];
}

export interface FileRowProps {
  entry: FileEntry;
  active?: boolean;
  onActivate: (entry: FileEntry) => void;
  /** Called after a row action mutates the listing (delete) so the parent
   *  can refresh. */
  onChanged?: () => void;
  /** Long-press actions (#680) — the same set the gallery offers, so the two
   *  layouts expose identical capabilities. */
  actionContext: EntryActionContext;
  /** Row density (`listDensity`). A file's thumbnail tile is 72pt at rest
   *  and 40pt condensed — the same two sizes the article row uses, so a PNG
   *  and the saved article above it are the same shape (build 41 shipped
   *  them at 40pt in both densities beside 72pt article rows). A file with
   *  no picture (a note, an unknown format) still gets the painted tile with
   *  its small icon centred, so the column reads as one run of thumbnails
   *  (Peter, 2026-09-04). Folders keep the plain icon row. */
  condensed?: boolean;
}

/**
 * A single tappable row in the mobile library browser. Swipe left to reveal
 * row actions (Share today; #619 adds Delete to this same array, without
 * touching the gesture in `SwipeRevealRow`).
 */
export function FileRow({ entry, active, onActivate, onChanged, actionContext, condensed = false }: FileRowProps) {
  // A folder wears the icon and colour it was given on the Mac (#140).
  const folder = useFolderAppearance(entry);
  const Icon = entry.is_directory ? folder.Icon : iconFor(entry);
  const wantsThumbnail = rowWantsThumbnail(entry);
  const tile = !entry.is_directory;
  const large = tile && !condensed;
  const [thumbnail, setThumbnail] = useState<ThumbnailResult | null>(null);
  useEffect(() => {
    if (!wantsThumbnail) return;
    let cancelled = false;
    // Same theme rule as the gallery card and the article row: a rendered
    // thumbnail is keyed on the theme in effect now.
    const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    void getThumbnail(entry, { theme })
      .then((thumb) => {
        if (!cancelled) setThumbnail(thumb);
      })
      // A folder left before the job finished rejects with the pipeline's
      // cancellation; the icon already on screen is the right outcome.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Keyed on the fields that identify the file, not the entry object: a
    // caller that maps or spreads its entries would otherwise refetch every
    // thumbnail on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsThumbnail, entry.path, entry.name, entry.modified]);
  const picture = thumbnail && (thumbnail.kind === "image" || thumbnail.kind === "pdf") ? thumbnail.url : null;
  // Hold for the full menu — iOS itself offers both swipe AND hold on a list
  // row (Files, Notes), and hold is the only way to reach Rename/Pin here.
  const longPress = useLongPress((rect) => {
    void presentEntryMenu(entry, rect, actionContext);
  });
  const actions = entrySwipeActions(entry, actionContext, onChanged);

  return (
    <SwipeRevealRow actions={actions}>
      <button
        type="button"
        onClick={() => onActivate(entry)}
        {...longPress}
        aria-current={active ? "page" : undefined}
        className={cn(
          "ios-press-row flex w-full items-center gap-3 px-4 text-left",
          large ? "py-3" : "py-2",
          "border-b border-border last:border-b-0",
          "hover:bg-muted/50",
          active && "bg-muted",
        )}
      >
        {/* A fixed slot per row — 72pt for a file at rest, 40pt condensed or
            for a folder — so a picture landing late never reflows the rows
            around it. A file's slot is painted as a tile whether or not a
            picture arrives. */}
        <span
          data-testid="row-thumbnail-slot"
          className={cn(
            "flex shrink-0 items-center justify-center",
            large ? THUMBNAIL_SLOT.large : THUMBNAIL_SLOT.small,
            tile && "rounded-md bg-muted",
            tile && entry.hidden && "opacity-50",
          )}
        >
          {picture ? (
            <img
              src={picture}
              alt=""
              data-testid="row-thumbnail"
              className={cn("rounded-md object-cover", large ? THUMBNAIL_SLOT.large : THUMBNAIL_SLOT.small)}
            />
          ) : (
            <Icon
              strokeWidth={1.5}
              className={cn(
                "h-5 w-5 shrink-0",
                active ? "text-[var(--color-accent-primary)]" : "text-muted-foreground",
                !tile && entry.hidden && "opacity-50",
              )}
              style={entry.is_directory && folder.color && !active ? { color: folder.color } : undefined}
              data-testid={entry.is_directory ? "folder-row-icon" : undefined}
            />
          )}
        </span>
        {/* One line, so the icon reads as aligned WITH the name rather than
            floating between two lines of unequal weight (#684). The modified
            date moved to the section headers — see `dateSection`. */}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[length:calc(1.0625rem*var(--ns-a11y-scale,1))] text-foreground",
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
          <span className="shrink-0 text-[length:calc(1.0625rem*var(--ns-a11y-scale,1))] tabular-nums text-muted-foreground">
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
