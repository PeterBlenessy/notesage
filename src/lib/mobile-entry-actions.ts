/**
 * Long-press actions for a library entry (#680).
 *
 * Gallery cards have no swipe affordance — the grid scrolls both ways and a
 * horizontal drag on a card is ambiguous — so the actions live behind a long
 * press instead, presented as a NATIVE action sheet. List rows get the same
 * press as a second route to the actions they already expose on swipe, which
 * is what iOS itself does (Files and Notes both offer swipe AND hold).
 *
 * The menu content lives here rather than in either component so the two
 * surfaces can never drift apart.
 */

import { toast } from "sonner";
import type { FileEntry } from "@/lib/tauri";
import {
  iosContextMenu,
  iosEntryMenu,
  iosDeleteFile,
  iosListDirectory,
  iosMoveFile,
  iosRenameFile,
  iosShareFile,
  iosTextPrompt,
  type IosEntryMenuItem,
} from "@/lib/ios-api";
import { t } from "@/lib/i18n";
import { evictThumbnail, getThumbnail } from "@/lib/mobile-thumbnails";

export interface EntryActionContext {
  /** Whether a root-relative path is in the shared pins file. A predicate
   *  rather than a boolean so ONE context object serves every row. */
  isPinned: (relPath: string) => boolean;
  /** Toggle the pin, writing `.notesage/pins.json`. */
  togglePin: (relPath: string) => Promise<void>;
  /** Called after the listing changed (delete, rename, move) so it can reload. */
  onChanged?: () => void;
  /** Rewrite any stored reference to `from` so it points at `to`. Recent and
   *  pinned entries hold PATHS, so a move leaves both aiming at a file that no
   *  longer exists — the same problem `useFileRenameSync` solves on desktop. */
  onPathMoved?: (from: string, to: string) => void;
}

/**
 * The rows for one entry.
 *
 * Deliberately NOT included, and why:
 * - **Duplicate** needs a binary-safe copy command to be honest about
 *   non-markdown files; a markdown-only Duplicate would silently skip PDFs.
 * - **Info** would only repeat the date already printed on the row/card.
 * - **Quick Look / Open** is what a plain tap already does.
 */
export function entryMenuItems(entry: FileEntry, ctx: EntryActionContext): IosEntryMenuItem[] {
  const pinned = ctx.isPinned(entry.path);
  // Layout mirrors Notes: the frequent actions as an icon row, the rest as
  // full-width rows beneath. Delete is last in the row and red.
  const items: IosEntryMenuItem[] = [];
  // Directories have no share concept — `ios_share_file` copies a single
  // file to temp for the share sheet (same reason the swipe row omits it).
  if (!entry.is_directory) {
    items.push({
      id: "share",
      title: t("action.share"),
      systemImage: "square.and.arrow.up",
      inline: true,
    });
  }
  items.push({
    id: "pin",
    title: pinned ? t("action.unpin") : t("action.pin"),
    systemImage: pinned ? "pin.slash" : "pin",
    inline: true,
  });
  items.push({
    id: "delete",
    title: t("action.delete"),
    systemImage: "trash",
    destructive: true,
    inline: true,
  });
  items.push({ id: "rename", title: t("action.rename"), systemImage: "pencil" });
  // Files only — the native command refuses directories, so offering the row
  // for a folder would be a menu entry whose only outcome is an error toast.
  if (!entry.is_directory) {
    items.push({ id: "move", title: t("action.moveTo"), systemImage: "folder" });
  }
  return items;
}

/** The library root, as the picker's own pseudo-folder. */
const ROOT_DIR = "";

/**
 * Drill down the library and return the chosen destination directory, or
 * `null` if cancelled.
 *
 * A stack of flat native action sheets rather than one tree: `ios_context_menu`
 * presents a `UIAlertController`, which has no nesting, and a bespoke
 * SwiftUI browser is a lot of native surface for picking a folder. Each level
 * offers "Move here", its subfolders, and a way back up — which is also how
 * Files itself behaves.
 *
 * Deliberately does NOT create folders. `ios_create_directory` exists and it
 * would be cheap, but a picker that also creates is a bigger surface than one
 * that only picks, and filing into a folder that already exists is the common
 * case (issue #754, "worth deciding"). The "+" button already makes folders.
 */
export async function pickDestinationFolder(startDir = ROOT_DIR): Promise<string | null> {
  let dir = startDir;
  for (;;) {
    const entries = await iosListDirectory(dir).catch(() => []);
    const folders = entries
      .filter((e) => e.is_directory)
      .sort((a, b) => a.name.localeCompare(b.name));

    const items = [
      { id: "__here__", title: t("action.moveHere", { name: dirLabel(dir) }) },
      ...folders.map((f) => ({ id: `dir:${f.path}`, title: f.name })),
    ];
    if (dir !== ROOT_DIR) {
      items.push({ id: "__up__", title: t("action.upOneLevel") });
    }

    const chosen = await iosContextMenu({ title: dirLabel(dir), items });
    if (chosen === null) return null;
    if (chosen === "__here__") return dir;
    if (chosen === "__up__") {
      dir = parentDir(dir);
      continue;
    }
    if (chosen.startsWith("dir:")) dir = chosen.slice(4);
  }
}

function dirLabel(dir: string): string {
  return dir === ROOT_DIR ? t("action.libraryRoot") : dir.split("/").pop() || dir;
}

function parentDir(dir: string): string {
  const cut = dir.lastIndexOf("/");
  return cut === -1 ? ROOT_DIR : dir.slice(0, cut);
}

/**
 * Ask before deleting. iCloud's Recently Deleted does give 30-day recovery,
 * but a long press or a full swipe is easy to trigger by accident and the
 * recovery path is not obvious from inside Notesage — so the destructive
 * action confirms, natively.
 */
export async function confirmDelete(entry: FileEntry): Promise<boolean> {
  const chosen = await iosContextMenu({
    title: entry.is_directory
      ? t("action.confirmDeleteFolder", { name: entry.name })
      : t("action.confirmDeleteFile", { name: entry.name }),
    items: [{ id: "delete", title: t("action.delete"), destructive: true }],
  });
  return chosen === "delete";
}

/** Run the chosen menu action. Unknown ids (and cancel) are a no-op. */
export async function runEntryAction(
  id: string | null,
  entry: FileEntry,
  ctx: EntryActionContext,
): Promise<void> {
  switch (id) {
    case "share":
      await iosShareFile(entry.path).catch((err) =>
        toast.error(t("action.shareFailed", { error: String(err) })),
      );
      return;
    case "rename": {
      // Pre-filled and editable: renaming is usually a small edit to the
      // existing name, not retyping it (Peter, 2026-08-13). Files-style, the
      // stem is preselected so typing replaces the name but keeps the
      // extension — and a folder has no extension to keep.
      const name = await iosTextPrompt(
        t("action.renameTitle"),
        entry.name,
        t("action.rename"),
        { value: entry.name, selectStem: !entry.is_directory },
      ).catch(() => null);
      if (!name || name === entry.name) return;
      await iosRenameFile(entry.path, name)
        .then(() => ctx.onChanged?.())
        .catch((err) => toast.error(t("action.renameFailed", { error: String(err) })));
      return;
    }
    case "pin":
      await ctx
        .togglePin(entry.path)
        .catch((err) => toast.error(t("action.pinFailed", { error: String(err) })));
      return;
    case "delete": {
      if (!(await confirmDelete(entry))) return;
      await iosDeleteFile(entry.path)
        .then(() => ctx.onChanged?.())
        .catch((err) => toast.error(t("action.deleteFailed", { error: String(err) })));
      return;
    }
    case "move": {
      const dest = await pickDestinationFolder(parentDir(entry.path));
      if (dest === null) return;
      // Picking the folder it is already in is a no-op, not a dedupe to
      // `note-1.md`. The native side agrees, but saying so here saves a
      // round trip and a pointless "moved" toast.
      if (dest === parentDir(entry.path)) return;
      try {
        const moved = await iosMoveFile(entry.path, dest);
        // The thumbnail cache is keyed by PATH. Left alone, the card for the
        // moved file resolves the old key and renders a stale image — or the
        // next file to land on that path renders this one's.
        evictThumbnail(entry.path);
        // Recent and pinned entries hold paths too; without this the file
        // stays in Recent pointing at nothing and silently loses its pin.
        ctx.onPathMoved?.(entry.path, moved);
        ctx.onChanged?.();
        toast.success(t("action.movedTo", { name: dirLabel(dest) }));
      } catch (err) {
        toast.error(t("action.moveFailed", { error: String(err) }));
      }
      return;
    }
    default:
      return;
  }
}

/** The appearance the app is currently painted in. */
function currentTheme(): "light" | "dark" {
  return typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

/**
 * Present the preview menu for `entry` and run the choice.
 *
 * `sourceRect` is the pressed element's rect: the preview card grows out of
 * it and shrinks back into it, so the card reads as the row itself lifting
 * off the list rather than a panel appearing over it.
 */
export async function presentEntryMenu(
  entry: FileEntry,
  sourceRect: { x: number; y: number; width: number; height: number } | undefined,
  ctx: EntryActionContext,
): Promise<void> {
  // Prefer the app's OWN render of the note: QuickLook shows a `.md` file as
  // raw text, so a note whose point is an image previewed as markup. This is
  // the same pipeline (and cache) the gallery cards use, so a card already on
  // screen costs nothing to preview.
  const rendered = entry.is_directory
    ? null
    : await getThumbnail(entry, { theme: currentTheme() }).catch(() => null);

  const chosen = await iosEntryMenu({
    title: entry.name,
    previewHtml: rendered?.kind === "markdown" ? rendered.html : undefined,
    // Only files have something QuickLook can render; folders fall back to
    // the name + icon card.
    previewRelPath: entry.is_directory ? undefined : entry.path,
    isDirectory: entry.is_directory,
    sourceRect,
    items: entryMenuItems(entry, ctx),
  }).catch(() => null);
  await runEntryAction(chosen, entry, ctx);
}
