import { useState, useEffect, useRef, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { useSettingsStore } from "@/stores/settings-store";

export const ALPHA_UPDATE_ENDPOINT =
  "https://github.com/PeterBlenessy/notesage/releases/download/latest-alpha/latest.json";

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
  | "downloaded"
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

  const autoCheckUpdates = useSettingsStore((s) => s.autoCheckUpdates);
  const dismissedVersion = useSettingsStore((s) => s.dismissedVersion);
  const releaseChannel = useSettingsStore((s) => s.releaseChannel);
  const setLastUpdateCheck = useSettingsStore((s) => s.setLastUpdateCheck);
  const setDismissedVersion = useSettingsStore((s) => s.setDismissedVersion);

  const checkForUpdate = useCallback(async () => {
    setState((s) => ({ ...s, status: "checking", error: null }));

    try {
      if (releaseChannel === "alpha") {
        await checkAlphaChannel();
      } else {
        await checkStableChannel();
      }
    } finally {
      setLastUpdateCheck(new Date().toISOString());
    }

    async function checkStableChannel() {
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
      }
    }

    async function checkAlphaChannel() {
      try {
        const response = await fetch(ALPHA_UPDATE_ENDPOINT);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const manifest = await response.json() as {
          version: string;
          notes?: string;
          pub_date?: string;
        };

        const currentVersion = await getVersion();
        const manifestVersion = manifest.version;

        if (manifestVersion === currentVersion) {
          setState({ status: "idle", updateInfo: null, progress: null, error: null });
          return;
        }

        const info: UpdateInfo = {
          version: manifestVersion,
          currentVersion,
          notes: manifest.notes ?? null,
          date: manifest.pub_date ?? null,
        };

        setState({ status: "available", updateInfo: info, progress: null, error: null });
      } catch (err) {
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
  }, [dismissedVersion, releaseChannel, setLastUpdateCheck]);

  const downloadAndInstall = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    setState((s) => ({ ...s, status: "downloading", progress: 0, error: null }));

    let totalSize = 0;
    let downloaded = 0;
    let lastPct = 0;

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalSize = event.data.contentLength ?? 0;
          downloaded = 0;
          lastPct = 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (totalSize > 0) {
            const pct = Math.min(100, Math.floor((downloaded / totalSize) * 100));
            if (pct > lastPct) {
              lastPct = pct;
              setState((s) => ({ ...s, progress: pct }));
            }
          }
        }
      });

      // Download & install completed — waiting for restart
      setState((s) => ({ ...s, status: "downloaded", progress: 100 }));
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const restartNow = useCallback(async () => {
    await relaunch();
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
    restartNow,
    dismiss,
    skipVersion,
  };
}
