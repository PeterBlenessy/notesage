import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "@/stores/settings-store";
import { log } from "@/lib/logger";

interface UseTrayEventsOptions {
  onNewNote: () => void;
  onOpenActions: () => void;
  onOpenFile: (path: string) => void;
}

/**
 * Listen for tray menu events emitted from the Rust backend.
 * Must be mounted in App.tsx alongside other lifecycle hooks.
 */
export function useTrayEvents({
  onNewNote,
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
    // Mounted-flag pattern (see `useSandboxViolations`): registration is
    // async, so a cleanup that races it must immediately unlisten any
    // late-resolving registrations instead of leaking them. Registrations
    // run concurrently via Promise.all — no partial-push window between
    // sequential awaits.
    let mounted = true;
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      const registered = await Promise.all([
        listen("tray-new-note", () => {
          log.debug("tray", "Tray: new note");
          onNewNote();
        }),
        listen("tray-open-actions", () => {
          log.debug("tray", "Tray: open actions");
          onOpenActions();
        }),
        listen<string>("tray-open-file", (event) => {
          log.debug("tray", "Tray: open file", event.payload);
          onOpenFile(event.payload);
        }),
      ]);
      for (const fn of registered) {
        if (mounted) unlisteners.push(fn);
        else fn(); // Already unmounted — clean up immediately
      }
    };

    setup().catch((e) => log.warn("tray", "Failed to set up tray listeners", e));

    return () => {
      mounted = false;
      unlisteners.forEach((fn) => fn());
    };
  }, [onNewNote, onOpenActions, onOpenFile]);
}
