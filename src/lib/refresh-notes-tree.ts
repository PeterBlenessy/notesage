import { tauriApi, type FileEntry } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSyncStore } from "@/stores/sync-store";

/** Merge two file lists, deduplicating by name. Local entries take priority. */
function mergeFileLists(local: FileEntry[], icloud: FileEntry[]): FileEntry[] {
  const localNames = new Set(local.map((e) => e.name));
  const icloudOnly = icloud.filter((e) => !localNames.has(e.name));
  return [...local, ...icloudOnly];
}

/**
 * List only files (no directories) at the top level of a directory.
 * Falls back to listDirectory with client-side filtering if the
 * shallow command is unavailable (e.g. backend not rebuilt).
 */
async function listNotesFiles(path: string): Promise<FileEntry[]> {
  try {
    return await tauriApi.listFilesShallow(path);
  } catch {
    // Expected: listFilesShallow command may not exist (backend not rebuilt) — fallback to recursive listing
    const tree = await tauriApi.listDirectory(path);
    return tree.filter((e) => !e.is_directory);
  }
}

/**
 * Reload the Quick Notes file list into workspace-store.
 * Uses shallow file-only listing (no recursive directory descent).
 * Handles iCloud merge when sync is enabled.
 */
export async function refreshNotesTree(): Promise<void> {
  const { notesRootPath, icloudNotesagePath } = useSettingsStore.getState();
  const { icloudEnabled, syncQuickNotes } = useSyncStore.getState();
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

  // Merge iCloud notes when Quick Notes sync is active
  if (icloudEnabled && syncQuickNotes && icloudNotesagePath) {
    try {
      const exists = await tauriApi.pathExists(icloudNotesagePath);
      if (exists) {
        const icloudFiles = await listNotesFiles(icloudNotesagePath);
        files = mergeFileLists(files, icloudFiles);
      }
    } catch (err) {
      console.error("Failed to list iCloud notes in", icloudNotesagePath, err);
    }
  }

  ws.setNotesTree(files);
}
