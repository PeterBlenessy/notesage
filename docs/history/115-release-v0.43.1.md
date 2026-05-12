# Release v0.43.1

**Date:** 2026-05-12
**Previous version:** 0.43.0
**Channel:** Stable

A small patch fixing the Release Channel selector in Settings → Updates.

## Changes

### Fixes

- **The Release Channel selector in Settings → Updates works correctly.** Picking Alpha now actually fetches alpha builds (clicking "Check for updates" was previously a no-op on Alpha). Staying on Stable strictly stays on Stable. Installing an alpha — when you're on the Alpha channel — is a one-click in-app install, same as Stable updates, no manual download required.

## Under the hood

- Channel isolation enforced at two layers: the release workflow auto-flags `-alpha`/`-beta`/`-rc` tag suffixes as prerelease (server-side), AND the in-app updater on Stable refuses any manifest whose version contains a `-` segment (client-side).
- Alpha-channel manifest fetch routes through Tauri's HTTP plugin (Rust-side, no CORS) instead of the renderer's `fetch()` which tripped over GitHub's cross-origin redirect to `release-assets.githubusercontent.com`.
- New Rust command `alpha_check(url)` (`src-tauri/src/commands/alpha_update.rs`) drives `tauri-plugin-updater::UpdaterBuilder` with the alpha rolling-pointer URL and returns a `Resource` rid the JS-side `new Update(metadata)` wraps. Full plugin-updater install pipeline — same code path stable uses.
- HTTP capability allowlist extended with `release-assets.githubusercontent.com/**`.
- Regression locks: `release-workflow-prerelease-detection.test.ts` + ~30 cases in `useAutoUpdate.test.ts`.
- Channel-isolation principle documented in `feedback_channel_isolation_hard_guarantee.md`.
