import { useState, useEffect, useRef, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { useSettingsStore } from "@/stores/settings-store";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  progress: number | null;
  error: string | null;
}

export function useAutoUpdate() {
  const [state, setState] = useState<UpdateState>({
    status: "idle",
    updateInfo: null,
    progress: null,
    error: null,
  });

  const updateRef = useRef<Update | null>(null);
  const checkedRef = useRef(false);

  const {
    autoCheckUpdates,
    dismissedVersion,
    setLastUpdateCheck,
    setDismissedVersion,
  } = useSettingsStore();

  const checkForUpdate = useCallback(async () => {
    setState((s) => ({ ...s, status: "checking", error: null }));

    try {
      const update = await check();

      if (update) {
        const currentVersion = await getVersion();
        updateRef.current = update;

        const info: UpdateInfo = {
          version: update.version,
          currentVersion,
          notes: update.body ?? null,
          date: update.date ?? null,
        };

        if (dismissedVersion === update.version) {
          // User dismissed this version — keep state idle but store info
          setState({ status: "idle", updateInfo: info, progress: null, error: null });
        } else {
          setState({ status: "available", updateInfo: info, progress: null, error: null });
        }
      } else {
        updateRef.current = null;
        setState({ status: "idle", updateInfo: null, progress: null, error: null });
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setLastUpdateCheck(new Date().toISOString());
    }
  }, [dismissedVersion, setLastUpdateCheck]);

  const downloadAndInstall = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    setState((s) => ({ ...s, status: "downloading", progress: 0, error: null }));

    let totalSize = 0;
    let downloaded = 0;

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalSize = event.data.contentLength ?? 0;
          downloaded = 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const pct = totalSize > 0 ? Math.round((downloaded / totalSize) * 100) : null;
          setState((s) => ({ ...s, progress: pct }));
        }
        // 'Finished' — the app will restart via the plugin
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const dismiss = useCallback(() => {
    // Just close the dialog — keep status as "available" so Settings can show "View Update"
    // The update remains available for install at any time
  }, []);

  const skipVersion = useCallback(() => {
    if (state.updateInfo) {
      setDismissedVersion(state.updateInfo.version);
    }
    setState((s) => ({ ...s, status: "idle" }));
  }, [state.updateInfo, setDismissedVersion]);

  // Auto-check on mount with 5s delay
  useEffect(() => {
    if (!autoCheckUpdates || checkedRef.current) return;
    checkedRef.current = true;

    const timer = setTimeout(() => {
      checkForUpdate();
    }, 5000);

    return () => clearTimeout(timer);
  }, [autoCheckUpdates, checkForUpdate]);

  return {
    state,
    checkForUpdate,
    downloadAndInstall,
    dismiss,
    skipVersion,
  };
}
