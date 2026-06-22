import { useState, useEffect, useRef, useCallback } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useSettingsStore } from "@/stores/settings-store";
import { isPrereleaseVersion } from "@/lib/version";

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

// Semver-style prerelease detection (`0.44.0-alpha.2` → true, `0.44.0` → false).
// Single source of truth lives in `@/lib/version` (pure, import-cycle-safe so the
// settings store can use it too). Re-exported here for existing importers.
// Used as a HARD GUARANTEE in the stable-channel updater: a manifest reporting a
// prerelease version is refused. See feedback_channel_isolation_hard_guarantee.md.
export { isPrereleaseVersion };

/**
 * Compare two SemVer version triples (major.minor.patch). Ignores any
 * prerelease suffix. Returns -1 / 0 / +1.
 *
 * Used by `isLeaveAlphaDowngrade` to decide whether the stable manifest
 * we just fetched would move the user backward from their alpha build.
 *
 *   compareTriples("0.43.1", "0.44.0-alpha.3") → -1  // 0.43.1 is older
 *   compareTriples("0.44.0", "0.44.0-alpha.3") →  0  // same triple
 *   compareTriples("0.45.0", "0.44.0-alpha.3") → +1
 */
function compareTriples(a: string, b: string): -1 | 0 | 1 {
  const tripleA = a.split("-", 1)[0];
  const tripleB = b.split("-", 1)[0];
  const partsA = tripleA.split(".").map((n) => Number(n) || 0);
  const partsB = tripleB.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    const x = partsA[i] ?? 0;
    const y = partsB[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * "Leaving alpha" detection: the user is on a prerelease binary, switched to
 * Stable channel, and the latest stable's triple is strictly less than the
 * current prerelease's triple. This is the downgrade case that must show
 * "Switch back to Stable" UX instead of "Update available" UX, AND must call
 * `check({ allowDowngrades: true })` so Tauri returns the older manifest
 * (otherwise Tauri rejects with `null` per its default ascending rule).
 *
 * NOTE: we don't compare the full SemVer including prerelease suffix here on
 * purpose. `0.44.0-alpha.3` and `0.44.0` are "same triple"; offering 0.44.0
 * as an upgrade is the right call (not a downgrade). Only when the manifest
 * triple is strictly less than the current triple do we treat it as the
 * "leave alpha → previous stable" path.
 */
export function isLeaveAlphaDowngrade(
  currentVersion: string,
  manifestVersion: string,
): boolean {
  if (!isPrereleaseVersion(currentVersion)) return false;
  if (isPrereleaseVersion(manifestVersion)) return false;
  return compareTriples(manifestVersion, currentVersion) < 0;
}

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
  /**
   * True when the offered update would move the user from a prerelease
   * binary back to an OLDER stable release (because they switched from
   * Alpha to Stable channel). UI should show explicit "Switch back to
   * Stable" / "downgrade" copy and require extra confirmation — settings
   * and data migrations from the alpha may not carry over cleanly.
   */
  isLeaveAlphaDowngrade?: boolean;
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
        // When the user is running a prerelease (alpha) binary and they
        // switched to Stable, they want to LEAVE alpha. Without
        // `allowDowngrades: true`, Tauri's `check()` returns `null` for any
        // version older than the current — leaving the user stuck on the
        // alpha binary even though they're on the Stable channel. Passing
        // the flag only when on a prerelease keeps normal stable-channel
        // behaviour unchanged for regular stable users.
        const currentVersion = await getVersion();
        const onPrerelease = isPrereleaseVersion(currentVersion);
        const update = await check({ allowDowngrades: onPrerelease });

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

          updateRef.current = update;

          const info: UpdateInfo = {
            version: update.version,
            currentVersion,
            notes: update.body ?? null,
            date: update.date ?? null,
            isLeaveAlphaDowngrade: isLeaveAlphaDowngrade(
              currentVersion,
              update.version,
            ),
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

  // Auto-check when the user changes release channel. Critical for the
  // leave-alpha flow: switching from Alpha to Stable should immediately
  // surface the "Switch back to Stable" prompt without making the user
  // click "Check for updates" in Settings. Skips the initial mount —
  // that's already covered by the auto-check above.
  const lastChannelRef = useRef(releaseChannel);
  useEffect(() => {
    if (lastChannelRef.current === releaseChannel) return;
    lastChannelRef.current = releaseChannel;
    checkForUpdate();
  }, [releaseChannel, checkForUpdate]);

  return {
    state,
    checkForUpdate,
    downloadAndInstall,
    restartNow,
    dismiss,
    skipVersion,
  };
}
