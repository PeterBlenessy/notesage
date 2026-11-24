import { inboxDir, recordingsDir } from "@/lib/notes-root";

/**
 * True when `folderPath` is the Inbox or the Recordings folder directly under
 * `libraryRoot`.
 *
 * Both are native features, not projects: the Inbox keeps its own
 * `Inbox/.notesage/` sidecar folder, which is exactly what project discovery
 * looks for, so without this check a library scan registers the Inbox as a
 * project. The folder names come from the same helpers the Inbox and the
 * recorder use, so the three cannot drift apart.
 */
export function isReservedLibraryFolder(folderPath: string, libraryRoot: string): boolean {
  const root = libraryRoot.replace(/\/+$/, "");
  if (root === "") return false;
  const folder = folderPath.replace(/\/+$/, "");
  return folder === inboxDir(root) || folder === recordingsDir(root);
}
