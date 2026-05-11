import { useState, useEffect, useRef, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { useSettingsStore } from "@/stores/settings-store";

export const ALPHA_UPDATE_ENDPOINT =
  "https://github.com/PeterBlenessy/notesage/releases/download/latest-alpha/latest.json";

/**
 * Semver-style prerelease detection: any version that contains a `-` segment
 * after the major.minor.patch triple is considered a prerelease.
 *
 * Examples:
 *   "0.44.0-alpha.2" → true
 *   "0.44.0-beta.1"  → true
 *   "0.44.0-rc.1"    → true
 *   "0.44.0"         → false
 *   "0.44.0+meta"    → false (build metadata, not a prerelease)
 *
 * Used as a HARD GUARANTEE in the stable-channel updater: if an update
 * manifest reports a prerelease version (because a tag was mis-flagged
 * server-side or `releases/latest` resolved to a prerelease), the client
 * refuses to offer it. See feedback_channel_isolation_hard_guarantee.md.
 */
export function isPrereleaseVersion(version: string): boolean {
  // Strip build metadata (`+...`) before checking for prerelease suffix.
  const withoutBuild = version.split("+", 1)[0];
  return withoutBuild.includes("-");
}

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
          // HARD GUARANTEE: stable channel users must NEVER be auto-upgraded
          // to a prerelease. If the server somehow returned a manifest with
          // a prerelease version (e.g. an alpha tag was mis-flagged as
          // non-prerelease so `releases/latest` resolved to it), refuse the
          // update at the client. The user picked Stable; honor that.
          //
          // Defense in depth on top of the workflow's auto-prerelease flag.
          // See feedback_channel_isolation_hard_guarantee.md.
          if (isPrereleaseVersion(update.version)) {
            updateRef.current = null;
            setState({ status: "idle", updateInfo: null, progress: null, error: null });
            return;
          }

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
        // Use Tauri's `@tauri-apps/plugin-http` fetch — routed through Rust —
        // instead of the renderer's `fetch()`. The renderer fetch trips over
        // CORS on the 302 from `github.com/.../latest.json` →
        // `release-assets.githubusercontent.com/...` (the redirect target
        // doesn't include `Access-Control-Allow-Origin: tauri://localhost`).
        // Rust-side fetch isn't subject to WKWebView's CORS check.
        //
        // Tauri 2.10's plugin-updater `check()` has no runtime URL override
        // (CheckOptions doesn't have a `url` field), so we can't reuse the
        // plugin's signature/install path for alpha. Detection works via the
        // manifest; alpha install opens the tagged GitHub release in the
        // browser for manual download. A real alpha-channel install path
        // would need a custom Tauri command around `UpdaterBuilder` — tracked
        // separately.
        const response = await tauriFetch(ALPHA_UPDATE_ENDPOINT);
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
          updateRef.current = null;
          setState({ status: "idle", updateInfo: null, progress: null, error: null });
          return;
        }

        // Alpha channel can't reuse plugin-updater's `Update` instance — clear
        // updateRef so `downloadAndInstall()` doesn't try to drive a stale one
        // from a previous stable check.
        updateRef.current = null;

        const info: UpdateInfo = {
          version: manifestVersion,
          currentVersion,
          notes: manifest.notes ?? null,
          date: manifest.pub_date ?? null,
        };

        if (dismissedVersion === manifestVersion) {
          setState({ status: "idle", updateInfo: info, progress: null, error: null });
        } else {
          setState({ status: "available", updateInfo: info, progress: null, error: null });
        }
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

    // Alpha-channel path: no `Update` instance (plugin-updater can't accept a
    // runtime URL override in Tauri 2.10). Open the tagged release page in the
    // system browser so the user can grab the DMG manually. A real in-app
    // install for alpha would need a custom Rust command — tracked separately.
    if (!update) {
      const version = state.updateInfo?.version;
      if (!version) return;
      try {
        await openUrl(
          `https://github.com/PeterBlenessy/notesage/releases/tag/v${version}`,
        );
      } catch (err) {
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
      return;
    }

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
  }, [state.updateInfo]);

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
