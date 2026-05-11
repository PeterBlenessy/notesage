# Release v0.44.0-alpha.3

**Date:** 2026-05-11
**Previous version:** 0.44.0-alpha.2
**Channel:** Alpha

First alpha that fully delivers on the promise that you can switch between Stable and Alpha channels cleanly. Plus all the post-v0.43.0 alpha content (HTML viewer security toggles, etc.) — see alpha.2's notes for that feature list.

> ⚠️ If you're on alpha.0, alpha.1 or alpha.2, the in-app updater can't bring you to alpha.3 — those builds have a bug that breaks the alpha-channel fetch. Grab the alpha.3 DMG from the release page once and you're back on the auto-update train.

## Changes

### Features

- **Switching back from Alpha to Stable now works.** Pick Stable in Settings → Updates → Release Channel and a clear "Switch back to Stable?" dialog appears, showing exactly which version you're moving to. It also warns you up front that settings introduced by alpha versions may not carry over — and gives you the choice to stay on the alpha and wait for stable to catch up. Before, switching to Stable on an alpha build silently did nothing.

### Improvements

- **The Stable channel really won't push you to alpha builds.** Belt-and-braces on top of the v0.43.1 fix: even if a release ever gets mis-flagged again on the server side, the app itself now refuses to install anything alpha-flavoured while you're on the Stable channel.

- **Checking for updates fires automatically when you switch channel.** No more manual "Check for updates" click after toggling between Stable and Alpha.

- **The "(Alpha)" suffix is gone from release names.** GitHub already shows a "Pre-release" badge on alpha builds; the redundant suffix was clutter.

### Fixes

- **Alpha-channel update check actually works on this build.** Forward-port of the v0.43.1 fix. Anyone installing alpha.3 will get clean alpha → alpha auto-updates from here on.

- **Release pipeline no longer leaves orphan draft entries.** A duplicate workflow file was creating a second release alongside the real one on every alpha tag, leaving behind a stale draft that had to be cleaned up by hand. Removed; one release per tag from now on.

## Known issues — still deferred

- **alpha.0/.1/.2 cannot auto-update** to alpha.3 — those binaries have the broken Alpha-channel fetch baked in. Manual reinstall via the GitHub release page is required. The `latest-alpha` rolling release at github.com/PeterBlenessy/notesage/releases/tag/latest-alpha is the convenience URL.

- **Installing a Stable downgrade still uses Tauri's normal install flow.** Settings stored in localStorage that reference alpha-only schemas (e.g., `htmlViewerAllowScripts` from PR #196, `htmlViewerAllowForms` from PR #189) will remain in localStorage but be ignored by the stable binary. That's harmless; if/when you re-install an alpha that supports them, they'll be active again.

- **Alpha channel "Install" still opens GitHub in browser**, not a true in-app install. Tauri 2.10's plugin-updater doesn't accept a runtime URL override, so we can't drive the install machinery with the alpha manifest. A custom Tauri command around `UpdaterBuilder` is tracked as follow-up work.

## Under the hood

### Channel-isolation hard guarantee — what changed

The user-facing "stable users never get alpha" promise from v0.43.0 is now backed by four redundant layers, each independently sufficient:

1. **Workflow auto-detect** (`release.yml`): `create-release` step now computes `prerelease: /-(alpha|beta|rc)(\.|$)/.test(tag)`. Hardcoded `prerelease: false` is gone.
2. **GitHub native resolution**: `releases/latest` skips prereleases by definition.
3. **In-app stable guard** (`useAutoUpdate.ts`): even if both above somehow fail, the stable channel calls `isPrereleaseVersion()` on the manifest and refuses any update whose version has a `-` segment.
4. **Rolling pointer is prerelease** (`update-latest-alpha` workflow job): the `latest-alpha` rolling release is created with `--prerelease`, so even if a stable user somehow hit that URL, GitHub would skip it.

Two regression-lock tests parse `release.yml` and assert the pieces stay wired up: `release-workflow-prerelease-detection.test.ts` (this PR) and `release-workflow.test.ts` (PR #205).

### Leave-alpha flow — implementation notes

- `isLeaveAlphaDowngrade(current, manifest)` checks: current is prerelease AND manifest is stable AND the major.minor.patch triple of the manifest is strictly less than the triple of the current. Same triple (e.g., `0.44.0-alpha.3` → `0.44.0`) is treated as a normal upgrade, not a downgrade.
- `checkStableChannel()` passes `allowDowngrades: true` to `check()` only when the running binary is a prerelease. For regular stable users, behaviour is unchanged.
- `UpdateInfo.isLeaveAlphaDowngrade?: boolean` is the discriminator that drives the dialog's switched copy. `UpdateDialog` shows different title, body, and button labels when the flag is true.
- `useAutoUpdate` adds a `useEffect` that re-runs `checkForUpdate()` when `releaseChannel` changes (skipping initial mount). Without this, the user would have to click "Check for updates" after changing channel; with it, the dialog surfaces immediately.

### Files Changed (since v0.44.0-alpha.2)

~12 files. Notable adds:

- `src/hooks/useAutoUpdate.ts` — Tauri HTTP plugin fetch for alpha, `isPrereleaseVersion`, `isLeaveAlphaDowngrade`, `checkStableChannel` with downgrade detection, channel-change auto-check effect
- `src/components/UpdateDialog.tsx` — branching copy for leave-alpha downgrade
- `src/hooks/__tests__/useAutoUpdate.test.ts` — 22 new tests across prerelease guard / Tauri HTTP / install flow / `isPrereleaseVersion` / `isLeaveAlphaDowngrade` / leave-alpha flow / channel-change auto-check
- `src/lib/__tests__/release-workflow-prerelease-detection.test.ts` — workflow regression-lock
- `.github/workflows/release.yml` — `create-release` auto-prerelease + `update-latest-alpha` job (from PR #204) + tauri-action de-duplication (from PR #205)
- `src-tauri/capabilities/default.json` — `release-assets.githubusercontent.com/**` added to HTTP allowlist
