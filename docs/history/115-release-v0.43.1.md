# Release v0.43.1

**Date:** 2026-05-11
**Previous version:** 0.43.0
**Channel:** Stable

A small patch fixing two bugs in how the app handles release channels.

## Changes

### Fixes

- **You won't be offered an alpha build on the Stable channel.** A handful of recent v0.44.0 alpha builds were mistakenly shown as available stable updates — they shouldn't have been. From now on, the Stable channel only ever offers stable releases. If something alpha-flavoured ever sneaks through again, the app refuses it.

- **The Alpha channel actually finds alpha builds now.** If you switched to the Alpha channel in Settings → Updates and clicked "Check for updates", it would spin briefly and then quietly find nothing — even when an alpha was available. That's fixed; alpha updates appear as expected.

## Under the hood

- New `isPrereleaseVersion()` helper in `useAutoUpdate.ts` — SemVer prerelease detection on the manifest version. Used as a hard guarantee on Stable channel.
- `src-tauri/capabilities/default.json` HTTP allowlist extended with `release-assets.githubusercontent.com/**` so the Tauri HTTP plugin can follow GitHub's release-asset redirect.
- `release.yml`'s `create-release` step now computes `prerelease: isPrerelease` from a regex on the tag — replaces the previously hardcoded `prerelease: false` that shipped alpha.0 and alpha.1 as non-prerelease releases.
- New regression-lock tests: `release-workflow-prerelease-detection.test.ts` (parses `release.yml` and asserts the auto-detection logic exists) + extended `useAutoUpdate.test.ts` (7 new test cases covering the prerelease guard, Tauri HTTP plugin fetch, alpha install flow, and `isPrereleaseVersion()` itself).
- Channel-isolation guarantee documented in the user memory under `feedback_channel_isolation_hard_guarantee.md`.
- Picked up two CI flake fixes from main (otherwise this patch's release CI would fail before publishing): `PERF_BUDGET_MULTIPLIER` bumped from 3 to 4 in the frontend perf job, and `TEST_TIMEOUT_MS` in `sidebar-filter.perf.test.tsx` now scales by the multiplier. Both originated in commit `47dc83ee` on the alpha branch; cherry-picked here so v0.43.1 builds.

## Files Changed

5 files changed across the patch:

- `src/hooks/useAutoUpdate.ts` — alpha-channel fetch via Tauri HTTP plugin, `isPrereleaseVersion` guard on Stable, `downloadAndInstall` browser-fallback for Alpha
- `src-tauri/capabilities/default.json` — release-assets URL added to HTTP allowlist
- `.github/workflows/release.yml` — auto-detect prerelease from tag suffix
- `src/hooks/__tests__/useAutoUpdate.test.ts` — expanded test coverage
- `src/lib/__tests__/release-workflow-prerelease-detection.test.ts` — new regression-lock for the workflow

No alpha track content is bundled in this patch — `v0.43.1` is strictly a Stable channel fix. The v0.44.0 alpha track continues on its own series after this lands.
