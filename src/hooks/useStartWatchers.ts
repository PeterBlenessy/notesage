import { useEffect } from "react";
import { tauriApi } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSyncStore } from "@/stores/sync-store";

/**
 * Start filesystem watchers for all relevant directories.
 * Called once at startup, re-runs when workspace changes.
 */
export function useStartWatchers() {
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  const icloudNotesagePath = useSettingsStore((s) => s.icloudNotesagePath);
  const icloudEnabled = useSyncStore((s) => s.icloudEnabled);
  const projects = useWorkspaceStore((s) => s.projects);
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);

  useEffect(() => {
    const paths: string[] = [];

    // Notes root (~/Notesage)
    if (notesRootPath) {
      paths.push(notesRootPath);
    }

    // iCloud Notesage folder (when sync is enabled)
    if (icloudEnabled && icloudNotesagePath) {
      paths.push(icloudNotesagePath);
    }

    // All open project directories
    for (const project of projects) {
      paths.push(project.path);
    }

    // All open explorer folders
    for (const folder of explorerFolders) {
      paths.push(folder.path);
    }

    // Start watching all paths (the Rust side deduplicates)
    for (const path of paths) {
      tauriApi.watchDirectory(path).catch((err) => {
        console.error(`Failed to watch ${path}:`, err);
      });
    }
  }, [notesRootPath, icloudNotesagePath, icloudEnabled, projects, explorerFolders]);
}
