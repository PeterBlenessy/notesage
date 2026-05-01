import { tauriApi, type FileEntry } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * List only files (no directories) at the top level of a directory.
 * Falls back to listDirectory with client-side filtering if the
 * shallow command is unavailable (e.g. backend not rebuilt).
 */
async function listNotesFiles(path: string): Promise<FileEntry[]> {
  const showHidden = useSettingsStore.getState().showHiddenFiles;
  try {
    return await tauriApi.listFilesShallow(path, showHidden);
  } catch {
    // Expected: listFilesShallow command may not exist (backend not rebuilt) — fallback to recursive listing
    const tree = await tauriApi.listDirectory(path, showHidden);
    return tree.filter((e) => !e.is_directory);
  }
}

/**
 * Reload the Quick Notes file list into workspace-store.
 * Uses shallow file-only listing (no recursive directory descent).
 *
 * The previous version maintained a parallel `<icloudNotesagePath>/`
 * folder for synced Quick Notes and merged them with local Quick Notes
 * when `icloudEnabled && syncQuickNotes` was true. That's gone — Quick
 * Notes live wherever the user's `notesRootPath` points. If the user
 * keeps their notes root under iCloud Drive, Quick Notes are synced;
 * if not, they're local. There's no separate "sync Quick Notes" toggle
 * to consult.
 */
export async function refreshNotesTree(): Promise<void> {
  const { notesRootPath } = useSettingsStore.getState();
  const ws = useWorkspaceStore.getState();

  if (!notesRootPath) return;

  let files: FileEntry[] = [];

  try {
    const exists = await tauriApi.pathExists(notesRootPath);
    if (exists) {
      files = await listNotesFiles(notesRootPath);
    }
  } catch (err) {
    console.error("Failed to list notes in", notesRootPath, err);
  }

  ws.setNotesTree(files);
}
