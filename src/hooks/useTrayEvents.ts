import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "@/stores/settings-store";
import { log } from "@/lib/logger";

interface UseTrayEventsOptions {
  onNewNote: () => void;
  onQuickNote: () => void;
  onOpenActions: () => void;
  onOpenFile: (path: string) => void;
}

/**
 * Listen for tray menu events emitted from the Rust backend.
 * Must be mounted in App.tsx alongside other lifecycle hooks.
 */
export function useTrayEvents({
  onNewNote,
  onQuickNote,
  onOpenActions,
  onOpenFile,
}: UseTrayEventsOptions) {
  // Sync tray settings to Rust on mount
  useEffect(() => {
    const { closeToTray, showInTray } = useSettingsStore.getState();
    invoke("set_close_to_tray", { enabled: closeToTray }).catch(() => {});
    invoke("set_tray_visible", { visible: showInTray }).catch(() => {});
  }, []);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      unlisteners.push(
        await listen("tray-new-note", () => {
          log.debug("tray", "Tray: new note");
          onNewNote();
        })
      );

      unlisteners.push(
        await listen("tray-quick-note", () => {
          log.debug("tray", "Tray: quick note");
          onQuickNote();
        })
      );

      unlisteners.push(
        await listen("tray-open-actions", () => {
          log.debug("tray", "Tray: open actions");
          onOpenActions();
        })
      );

      unlisteners.push(
        await listen<string>("tray-open-file", (event) => {
          log.debug("tray", "Tray: open file", event.payload);
          onOpenFile(event.payload);
        })
      );
    };

    setup().catch((e) => log.warn("tray", "Failed to set up tray listeners", e));

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [onNewNote, onQuickNote, onOpenActions, onOpenFile]);
}
