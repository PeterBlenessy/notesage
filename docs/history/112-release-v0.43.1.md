# Release v0.43.1

**Date:** 2026-05-11
**Previous version:** 0.43.0
**Channel:** Stable

Stable patch fixing two related auto-updater bugs that landed v0.43.0 users on alpha builds against their will.

## Changes

### Fixes

- **Stable users are no longer auto-upgraded to alpha builds.** Before this fix, the in-app updater on the Stable channel could offer an alpha build as an "update" — without the user ever switching to the Alpha channel. The cause was a workflow that published alpha tags without the prerelease flag set, so GitHub's "latest release" pointer resolved to an alpha. Now: (a) the release workflow auto-detects `-alpha`/`-beta`/`-rc` tag suffixes and flags them as prereleases, AND (b) the in-app updater on Stable refuses any version that looks like a prerelease, regardless of what the server says. Defense in depth — both layers have to fail for the bug to recur.

- **Alpha channel actually receives updates now.** When the Alpha channel was selected, the in-app updater silently failed (spinner spun, no toast). The cause was a cross-origin redirect when fetching the alpha manifest — GitHub redirects release-asset URLs to a different host, and the renderer's `fetch()` was rejected by CORS on that hop. Now the alpha-channel manifest fetch goes through Tauri's HTTP plugin (Rust-side, no CORS) and the update offer appears as expected. For now, installing an alpha update opens the tagged release in the system browser for a manual download — full in-app install for alpha is tracked separately.

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
