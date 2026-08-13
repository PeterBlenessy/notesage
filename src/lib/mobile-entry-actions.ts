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
  iosRenameFile,
  iosShareFile,
  iosTextPrompt,
  type IosEntryMenuItem,
} from "@/lib/ios-api";
import { t } from "@/lib/i18n";

export interface EntryActionContext {
  /** Whether a root-relative path is in the shared pins file. A predicate
   *  rather than a boolean so ONE context object serves every row. */
  isPinned: (relPath: string) => boolean;
  /** Toggle the pin, writing `.notesage/pins.json`. */
  togglePin: (relPath: string) => Promise<void>;
  /** Called after the listing changed (delete, rename) so it can reload. */
  onChanged?: () => void;
}

/**
 * The rows for one entry.
 *
 * Deliberately NOT included, and why:
 * - **Move** needs a folder picker and a native move command — real work,
 *   not a menu row (tracked separately).
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
  return items;
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
      const name = await iosTextPrompt(
        t("action.renameTitle"),
        entry.name,
        t("action.rename"),
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
    default:
      return;
  }
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
  const chosen = await iosEntryMenu({
    title: entry.name,
    // Only files have something QuickLook can render; folders fall back to
    // the name + icon card.
    previewRelPath: entry.is_directory ? undefined : entry.path,
    isDirectory: entry.is_directory,
    sourceRect,
    items: entryMenuItems(entry, ctx),
  }).catch(() => null);
  await runEntryAction(chosen, entry, ctx);
}
