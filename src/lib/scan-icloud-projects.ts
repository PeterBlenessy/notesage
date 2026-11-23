import { tauriApi } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { log } from "@/lib/logger";
import { t } from "@/lib/i18n";
import { toast } from "sonner";

/**
 * Scan the iCloud Notesage folder for projects synced from other machines.
 * For each top-level subdirectory with a `.notesage/` metadata dir that
 * isn't already in the workspace, add it as a project. The project's
 * sync state is implicit — its path is under the iCloud Notesage folder,
 * so `isProjectSynced(path, icloudNotesagePath)` returns true on the
 * derived check.
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
    const entries = await tauriApi.listDirectory(icloudNotesagePath, useSettingsStore.getState().showHiddenFiles);

    for (const entry of entries) {
      if (!entry.is_directory) continue;
      if (knownPaths.has(entry.path)) continue;
      if (dismissed.has(entry.path)) continue;

      // Check if this directory has .notesage/ metadata (i.e., it's a project)
      try {
        const hasMetadata = await tauriApi.pathExists(
          `${entry.path}/.notesage`
        );
        if (!hasMetadata) continue;

        const tree = await tauriApi.listDirectory(entry.path, useSettingsStore.getState().showHiddenFiles);
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
