# Release v0.48.0-alpha.36

**Date:** 2026-08-15
**Previous version:** 0.48.0-alpha.35
**Channel:** Alpha

**The migration alpha.** This build exists to move alpha-channel users onto
the single release stream before the alpha update endpoint is removed. Cut by
hand rather than by `aw-alpha-cut` (`WORKFLOW_PAT` has been dead since
2026-08-01, and a green cutter run is false comfort under that failure — a
hand-pushed tag still ships, because `release.yml` needs no PAT).

## Changes

### Features

- Notesage is moving to a **single build** for everyone. Experimental features
  now ship in every release, switched off, and are opted into under
  **Settings → Labs**. There is no separate alpha download any more.
- **This build switches your update channel back to the standard one.** No
  action needed; you keep receiving updates as before.
- Usage and crash reporting now follow Labs: they turn on if you enable an
  experimental feature — that is how a feature earns its way out of Labs —
  and stay off otherwise. Your own choice in Settings → Privacy always wins.

### Fixes (iOS)

- Pinning a folder now shows it under Pinned instead of appearing to do
  nothing.
- Closing a note no longer flashes the title and breadcrumb in the list before
  they settle into the top bar.
- Opening an HTML report no longer flashes white before its content appears.

## Under the hood

- Flag registry (`src/lib/flags.ts`) with a typed id, plus `flag-store` — its
  own store, so a corrupted settings blob cannot enable unfinished behaviour,
  and rehydrate filters unknown ids so a removed flag cannot resurrect.
- `flags.test.ts` carries the channel-isolation guarantee across: every flag
  defaults off, a fresh store enables nothing. Previously enforced by the
  release's `prerelease` flag, which stops existing once there is one stream.
- `labs_flag_changed` / `labs_feature_used` added to the fixed telemetry
  taxonomy; crash reports carry a `labs_flags` tag so a crash can be
  attributed to — or cleared of — an experimental feature.
- The flag store reports through an injected function rather than importing
  `lib/telemetry`: `settings-store` imports it and `MobileApp` imports
  `settings-store`, so a direct import made telemetry reachable from the iOS
  shell and broke the telemetry-free guarantee behind its App Store "Data Not
  Collected" answer.
- Settings migration `v26` rewrites `releaseChannel` `alpha` → `stable`.
- PRD `docs/prds/2026-08-15-single-binary-feature-flags.md`, tasks
  `docs/tasks/2026-08-15-single-binary-feature-flags-tasks.md`. Deletion of
  the alpha update path, `releaseChannel`, the second changelog and
  `buildIsAlpha()` follows once this build has been taken.
