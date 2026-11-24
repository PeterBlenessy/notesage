import { tauriApi } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { log } from "@/lib/logger";
import { t } from "@/lib/i18n";
import { toast } from "sonner";
import { isReservedLibraryFolder } from "@/lib/library-reserved-folders";

/**
 * Scan the iCloud Notesage folder for projects synced from other machines.
 * For each top-level subdirectory with a `.notesage/` metadata dir that
 * isn't already in the workspace, add it as a project. The project's
 * sync state is implicit — its path is under the iCloud Notesage folder,
 * so `isProjectSynced(path, icloudNotesagePath)` returns true on the
 * derived check.
 *
 * The Inbox and Recordings folders are never projects, whatever they contain
 * (`Inbox/.notesage/` is the Inbox's own sidecar folder, not project
 * metadata).
 *
 * The root listing is the recursive `list_directory`: the only shallow
 * command, `list_files_shallow`, returns FILES only and this needs the
 * top-level folders. What the listing already returned is reused as each new
 * project's tree, so a discovered project is not walked a second time.
 *
 * @returns true if any new projects were discovered
 */
export async function scanICloudForProjects(
  icloudNotesagePath: string
): Promise<boolean> {
  const ws = useWorkspaceStore.getState();
  const knownPaths = new Set(ws.projects.map((p) => p.path));
  // Removed by the person on this Mac: discovery must not overrule them.
  const dismissed = new Set(ws.dismissedLibraryProjects ?? []);

  let discovered = false;

  try {
    // Top level only (`maxDepth: 0`): this used to walk the WHOLE library —
    // every project and the Inbox — just to read the names of its folders.
    const entries = await tauriApi.listDirectory(icloudNotesagePath, useSettingsStore.getState().showHiddenFiles, 0);

    for (const entry of entries) {
      if (!entry.is_directory) continue;
      if (knownPaths.has(entry.path)) continue;
      if (dismissed.has(entry.path)) continue;
      if (isReservedLibraryFolder(entry.path, icloudNotesagePath)) continue;

      // Check if this directory has .notesage/ metadata (i.e., it's a project)
      try {
        const hasMetadata = await tauriApi.pathExists(
          `${entry.path}/.notesage`
        );
        if (!hasMetadata) continue;

        // The directory itself could not be read while the root was listed:
        // same outcome as the per-project listing failing used to have.
        if (entry.unreadable) throw new Error("directory is unreadable");
        // A top-level listing does not carry the folder's contents
        // (`truncated`), so a NEWLY discovered project is listed here.
        const tree =
          !entry.truncated && entry.children
            ? entry.children
            : await tauriApi.listDirectory(entry.path, useSettingsStore.getState().showHiddenFiles);
        ws.addProject(entry.path, tree);
        discovered = true;
      } catch (err) {
        // One project mid-sync or unreadable must not stop the rest, but it
        // is logged: "could not read" and "nothing new" used to look the same.
        log.warn("startup", `iCloud project not readable, skipped: ${entry.path}: ${err}`);
      }
    }
  } catch (err) {
    // The library root itself could not be listed. A folder that does not
    // exist yet is the ordinary first-run case and stays quiet; anything else
    // is why the sidebar is missing synced projects, so it is said out loud.
    let exists = false;
    try {
      exists = await tauriApi.pathExists(icloudNotesagePath);
    } catch {
      exists = true;
    }
    if (exists) {
      log.warn("startup", `iCloud library not readable: ${icloudNotesagePath}: ${err}`);
      toast.warning(t("toast.libraryUnreadable", { error: String(err) }), {
        id: "library-unreadable",
      });
    }
  }

  return discovered;
}

/**
 * Un-register an Inbox or Recordings folder that an earlier version added as
 * a project (or that was opened as a folder) under any of `libraryRoots`.
 *
 * Only the registration goes. Nothing on disk is touched — not even an
 * `Inbox/.notesage/project.json` a previous launch may have written — and the
 * folder is neither recorded as dismissed nor put in Recent projects, because
 * the person never removed anything: it should not have been listed at all.
 * Silent for the same reason; the log says what happened.
 *
 * @returns the paths whose registration was dropped
 */
export function forgetReservedLibraryFolders(
  libraryRoots: Array<string | null | undefined>,
): string[] {
  const roots = libraryRoots.filter((r): r is string => Boolean(r));
  if (roots.length === 0) return [];
  const isReserved = (path: string) => roots.some((root) => isReservedLibraryFolder(path, root));

  const ws = useWorkspaceStore.getState();
  const projects = ws.projects.filter((p) => !isReserved(p.path));
  const explorerFolders = ws.explorerFolders.filter((f) => !isReserved(f.path));
  const dropped = [
    ...ws.projects.filter((p) => isReserved(p.path)).map((p) => p.path),
    ...ws.explorerFolders.filter((f) => isReserved(f.path)).map((f) => f.path),
  ];
  if (dropped.length === 0) return [];

  useWorkspaceStore.setState({ projects, explorerFolders });
  for (const path of dropped) {
    log.info("startup", `Un-registered a reserved library folder that was listed as a project: ${path}`);
  }
  return dropped;
}
