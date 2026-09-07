import { tauriApi } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings-store";
import { applyProjectMoved } from "@/lib/project-moved";

/**
 * Update every store reference after ONE project has moved. Called once the
 * Tauri migration command has succeeded.
 *
 * A thin wrapper now: the bookkeeping itself lives in `applyProjectMoved`,
 * shared with the library migration, which had grown its own copy that was
 * missing the metadata re-key. See that file for why the two must not drift.
 */
export async function migrateProjectPath(oldPath: string, newPath: string): Promise<void> {
  await applyProjectMoved(oldPath, newPath, {
    listDirectory: (path) =>
      tauriApi.listDirectory(path, useSettingsStore.getState().showHiddenFiles),
    writeFile: (path, content) => tauriApi.writeFile(path, content),
  });
}
