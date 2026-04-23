import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useActivityStore } from "@/stores/activity-store";
import { useEditorStore } from "@/stores/editor-store";
import { useChatStore, selectProjectPaths } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { buildTrayRecents, type TrayRecentFile } from "@/lib/tray-recents";

export type { TrayRecentFile };

/**
 * Keep the system tray badge count and recent files in sync with app state.
 * Must be mounted in App.tsx.
 */
export function useTraySync() {
  // Sync badge count from activity store
  const tasks = useActivityStore((s) => s.tasks);
  useEffect(() => {
    const pendingCount = tasks.filter(
      (t) => t.status === "running"
    ).length;
    invoke("update_tray_badge", { count: pendingCount }).catch(() => {});
  }, [tasks]);

  // Sync recent files from editor store, filtered by active chat scope.
  // `files` is the scoped list (primary submenu); `allFiles` is the unfiltered
  // list exposed via the "All recent" submenu as an opt-in escape hatch.
  const openDocuments = useEditorStore((s) => s.openDocuments);
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  useEffect(() => {
    const { scoped, all } = buildTrayRecents({
      tabs: openDocuments,
      selectedProjectPaths,
      notesRootPath,
      limit: 5,
    });
    invoke("update_tray_recent", { files: scoped, allFiles: all }).catch(() => {});
  }, [openDocuments, selectedProjectPaths, notesRootPath]);
}
