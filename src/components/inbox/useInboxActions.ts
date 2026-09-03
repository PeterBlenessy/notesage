import { useCallback } from "react";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useInboxStore, type InboxItem } from "@/stores/inbox-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { t } from "@/lib/i18n";
import { parseFileError } from "@/lib/file-errors";

/**
 * The Inbox's triage verbs, shared by the list, the gallery, the context
 * menu, the reader pill and the keyboard: open, file to a project, pin,
 * trash, open original. One place, so the row, the menu and `e` cannot drift.
 */
export function useInboxActions() {
  const { openFile, renamePath } = useFileOperations();
  const projects = useWorkspaceStore((s) => s.projects);
  const pinnedFiles = useWorkspaceStore((s) => s.pinnedFiles);
  const pinFile = useWorkspaceStore((s) => s.pinFile);
  const unpinFile = useWorkspaceStore((s) => s.unpinFile);

  const open = useCallback(
    async (item: InboxItem) => {
      const store = useInboxStore.getState();
      try {
        await openFile(item.path, item.name);
        store.markOpened(item.path);
        store.setActiveItem(item.path);
        store.setCursor(item.path);
        store.closeInbox();
      } catch (error) {
        toast.error(t("inbox.openFailed", { error: parseFileError(error) }));
      }
    },
    [openFile],
  );

  const fileTo = useCallback(
    async (paths: string[], projectPath: string) => {
      if (paths.length === 0) return [];
      const moved = await useInboxStore.getState().fileTo(paths, projectPath, { renamePath });
      const name = projectPath.slice(projectPath.lastIndexOf("/") + 1);
      if (moved.length > 0) {
        toast.success(
          moved.length === 1
            ? t("inbox.filedOne", { project: name })
            : t("inbox.filedMany", { count: moved.length, project: name }),
        );
      }
      if (moved.length < paths.length) {
        toast.error(t("inbox.fileFailed", { count: paths.length - moved.length }));
      }
      return moved;
    },
    [renamePath],
  );

  /**
   * `e` — file to the LAST destination, and only that. It never guesses: an
   * early version fell back to the first project in the sidebar, which on a
   * real library is some unrelated project — the wrong folder is worse than
   * no action. Choose once through File to… (or a drop); `e` repeats it.
   */
  const fileToLast = useCallback(
    async (paths: string[]) => {
      const dest = useInboxStore.getState().lastDestination;
      if (!dest) {
        toast.error(projects.length === 0 ? t("inbox.noProjects") : t("inbox.chooseDestination"));
        return [];
      }
      return fileTo(paths, dest);
    },
    [fileTo, projects],
  );

  const togglePin = useCallback(
    (paths: string[]) => {
      for (const path of paths) {
        if (pinnedFiles.includes(path)) unpinFile(path);
        else pinFile(path);
      }
    },
    [pinnedFiles, pinFile, unpinFile],
  );

  const trash = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;
    const before = useInboxStore.getState().items.length;
    await useInboxStore.getState().trash(paths);
    const gone = before - useInboxStore.getState().items.length;
    if (gone > 0) toast.success(gone === 1 ? t("inbox.trashedOne") : t("inbox.trashedMany", { count: gone }));
    if (gone < paths.length) toast.error(t("inbox.trashFailed", { count: paths.length - gone }));
  }, []);

  const openOriginal = useCallback(async (path: string) => {
    const meta = useInboxStore.getState().meta[path];
    const url = meta?.sourceUrl;
    if (!url) {
      toast.error(t("inbox.noOriginal"));
      return;
    }
    try {
      await openUrl(url);
    } catch (error) {
      toast.error(t("inbox.openFailed", { error: String(error) }));
    }
  }, []);

  return { open, fileTo, fileToLast, togglePin, trash, openOriginal, projects, pinnedFiles };
}
