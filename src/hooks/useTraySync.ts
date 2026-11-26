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
  // Sync badge count from activity store.
  //
  // The selector returns the COUNT, a primitive, not the `tasks` array. This
  // hook is mounted in `App`, so subscribing to the array re-rendered the
  // whole app on every task update: a transcription's progress stream, an
  // agent's token stream. A count only changes when a task starts or ends.
  const pendingCount = useActivityStore((s) => {
    let count = 0;
    for (const task of s.tasks) if (task.status === "running") count += 1;
    return count;
  });
  useEffect(() => {
    invoke("update_tray_badge", { count: pendingCount }).catch(() => {});
  }, [pendingCount]);

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
