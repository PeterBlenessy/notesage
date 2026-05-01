import { useEffect } from "react";
import { tauriApi } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * Start filesystem watchers for all relevant directories.
 * Called once at startup, re-runs when workspace changes.
 */
export function useStartWatchers() {
  const startupReady = useSettingsStore((s) => s.startupReady);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  const icloudNotesagePath = useSettingsStore((s) => s.icloudNotesagePath);
  const projects = useWorkspaceStore((s) => s.projects);
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);

  useEffect(() => {
    // Wait until reloadTrees() has finished validating/cleaning up paths
    if (!startupReady) return;

    const paths: string[] = [];

    // Notes root (~/Notesage)
    if (notesRootPath) {
      paths.push(notesRootPath);
    }

    // iCloud Notesage folder (when iCloud Drive is detected). Watching
    // it lets useFileWatcher.ts pick up newly-arrived projects from
    // other devices and add them to the workspace.
    if (icloudNotesagePath) {
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

    // Watch ~/.notesage/ for skill/agent changes (created by agents or manually)
    tauriApi.getHomeDir().then((home) => {
      const notesageDir = `${home}/.notesage`;
      tauriApi.watchDirectory(notesageDir).catch((err) => {
        console.error(`Failed to watch ${notesageDir}:`, err);
      });
    });
  }, [startupReady, notesRootPath, icloudNotesagePath, projects, explorerFolders]);
}
