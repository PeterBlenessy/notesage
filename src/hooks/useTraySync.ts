import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useActivityStore } from "@/stores/activity-store";
import { useEditorStore } from "@/stores/editor-store";

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

  // Sync recent files from editor store
  const tabs = useEditorStore((s) => s.tabs);
  useEffect(() => {
    const recentFiles = tabs
      .filter((t) => t.filePath)
      .slice(-5)
      .reverse()
      .map((t) => ({
        name: t.filePath.split("/").pop() ?? t.filePath,
        path: t.filePath,
      }));
    invoke("update_tray_recent", { files: recentFiles }).catch(() => {});
  }, [tabs]);
}
