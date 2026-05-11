import { useState, useEffect, useRef, useCallback } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * Metadata returned by our custom `alpha_check` Tauri command. Shape matches
 * `@tauri-apps/plugin-updater`'s `UpdateMetadata` exactly (camelCased on the
 * wire by serde rename_all). Wrapping in `new Update(metadata)` gives us a
 * plugin-updater `Update` instance backed by the rid we returned from Rust;
 * `update.downloadAndInstall()` then routes through plugin-updater's own
 * `download` + `install` IPC handlers, which resolve the rid in the same
 * resources_table our Rust command inserted into. Signature verification
 * against the bundled `pubkey` in `tauri.conf.json` happens regardless of
 * which endpoint produced the manifest — same install pipeline as stable.
 */
interface AlphaUpdateMetadata {
  rid: number;
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  rawJson: Record<string, unknown>;
}

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
        // Drive plugin-updater against the alpha rolling-pointer URL via our
        // custom Rust command. Returns the same metadata shape the plugin's
        // own `check()` produces; wrapping in `new Update(metadata)` gives us
        // a plugin-updater Update instance whose `downloadAndInstall()` is
        // the SAME pipeline stable users get (signature verify, download,
        // bundle replace, restart). See `src-tauri/src/commands/alpha_update.rs`
        // for the Rust side and the long-form rationale.
        //
        // Earlier we tried (a) renderer `fetch()` — CORS-blocked on
        // GitHub's cross-origin redirect to release-assets.githubusercontent.com,
        // (b) Tauri's HTTP plugin fetch + manual `openUrl` to the release page
        // for manual DMG install — worked but high-friction. The Rust-side
        // UpdaterBuilder.endpoints() path is the supported in-app install
        // for runtime-URL switching; the plugin's own `check` command uses
        // the same pattern, just without the runtime URL.
        const metadata = await invoke<AlphaUpdateMetadata | null>("alpha_check", {
          url: ALPHA_UPDATE_ENDPOINT,
        });

        if (metadata) {
          const update = new Update(metadata);
          updateRef.current = update;

          const info: UpdateInfo = {
            version: update.version,
            currentVersion: update.currentVersion,
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
