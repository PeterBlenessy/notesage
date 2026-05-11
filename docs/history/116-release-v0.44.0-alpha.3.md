# Release v0.44.0-alpha.3

**Date:** 2026-05-11
**Previous version:** 0.44.0-alpha.2
**Channel:** Alpha

The first alpha that actually honors the v0.43.0 promise that you can leave the alpha channel and the Stable channel will never push you onto alpha by mistake. Also the first alpha that can receive updates via the in-app updater — alpha.0/.1/.2 are stranded by a CORS bug in the manifest fetch and need manual reinstall.

## Changes

### Features

- **Leave-alpha works properly now.** Switching from Alpha to Stable in Settings → Updates → Release Channel runs an immediate update check. If the latest stable is older than your current alpha (which it usually will be while alpha is ahead), a dedicated dialog asks "Switch back to Stable?" and explains the downgrade clearly — settings introduced in alpha may not carry over. Decline and you stay on the alpha; the app will auto-update you to stable once a stable release exceeds your alpha version. Previously, switching to Stable silently did nothing because Tauri's update check refuses downgrades by default.

### Improvements

- **Stable users can't be auto-upgraded to alpha builds anymore.** Defense in depth: (a) the release workflow auto-detects `-alpha`/`-beta`/`-rc` tags and flags them as prereleases — no more hardcoded `prerelease: false` shipping alphas as stable, AND (b) the in-app updater on Stable channel refuses any prerelease version regardless of what the server says. Either layer would have prevented the v0.43.0 → v0.44.0-alpha.1 mis-upgrade; both running means a single mistake can't break the guarantee. (This was the headline fix in v0.43.1; bringing it forward into the alpha track so it never regresses.)

- **Alpha channel actually receives updates now.** The manifest fetch on Alpha was silently failing on a cross-origin redirect (`github.com/.../latest.json` → `release-assets.githubusercontent.com`) — WKWebView's CORS rejected the second hop. Routing the fetch through Tauri's HTTP plugin (Rust-side, no CORS) fixes the chain. Anyone on alpha.0/.1/.2 is still stranded — those binaries shipped before this fix — but from alpha.3 forward, alpha → alpha updates work via the in-app updater.

- **Auto-update check fires when you change channel.** Previously you had to click "Check for updates" manually after switching channel. Now it fires automatically so the leave-alpha dialog (or any new-channel update) appears immediately.

### Fixes

- **Stable users on v0.43.0 mis-pushed to v0.44.0-alpha.1.** Root cause: alpha.0 and alpha.1 were published with `prerelease: false` (workflow bug). GitHub's `releases/latest` pointer resolved to the latest alpha and the in-app updater obediently offered it. Fixed in v0.43.1 (workflow auto-flags prereleases) and re-locked here.

- **Alpha channel showed "Up to date" even when a new alpha existed.** Same CORS bug as above; same fix.

- **Release workflow no longer leaves orphan draft releases.** alpha.2's release run created a stale draft alongside the published prerelease — `tauri-action` was creating a duplicate release entry because it got both `releaseId` AND `tagName`. Removing the duplicate args means a single release entry per tag, no manual cleanup needed.

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
