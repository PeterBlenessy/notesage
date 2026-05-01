import { tauriApi } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";

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

  let discovered = false;

  try {
    const entries = await tauriApi.listDirectory(icloudNotesagePath, useSettingsStore.getState().showHiddenFiles);

    for (const entry of entries) {
      if (!entry.is_directory) continue;
      if (knownPaths.has(entry.path)) continue;

      // Check if this directory has .notesage/ metadata (i.e., it's a project)
      try {
        const hasMetadata = await tauriApi.pathExists(
          `${entry.path}/.notesage`
        );
        if (!hasMetadata) continue;

        const tree = await tauriApi.listDirectory(entry.path, useSettingsStore.getState().showHiddenFiles);
        ws.addProject(entry.path, tree);
        discovered = true;
      } catch {
        // Expected: individual project check may fail (iCloud sync in progress, permissions)
      }
    }
  } catch {
    // Expected: iCloud Notesage folder may not exist yet or is inaccessible
  }

  return discovered;
}
