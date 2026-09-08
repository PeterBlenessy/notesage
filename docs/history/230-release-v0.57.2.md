# Release v0.57.2

**Date:** 2026-09-08
**Previous version:** 0.57.1

Moving your library into Notesage's own iCloud folder no longer asks you for
anything.

## Changes

### Fixes

- **Notesage can open its own iCloud folder without you granting anything.**
  Moving your library there used to fail with a permissions error, and the only
  way round it was giving Notesage Full Disk Access — a sweeping permission,
  just to read one folder that belongs to it. The Mac app now claims that
  folder the way the iPhone app does. If you granted Full Disk Access for this,
  you can take it away again.
- **The Library section says when something is blocking it, instead of showing
  an error code.** If the folder ever cannot be opened, it explains what that
  means rather than printing `Operation not permitted (os error 1)`.

## Under the hood

- #963. The Mac app carried no iCloud entitlement — only the iOS app declared
  the container — so macOS guarded
  `~/Library/Mobile Documents/iCloud~com~notesage~app`. It was believed that
  Apple excludes iCloud from Developer ID distribution; **that was wrong**, and
  testing it rather than assuming it is what saved the feature. A
  `MAC_APP_DIRECT` profile for `com.notesage.app` comes back carrying
  `icloud-container-identifiers`, `ubiquity-container-identifiers` and
  `icloud-services`, so a directly-distributed Mac app can own the container
  outright.
- The final entitlements live in `src-tauri/macos/App-DeveloperID.entitlements`,
  separate from `Entitlements.plist`, because `tauri-bundler` signs and
  notarises before any profile is embedded — an entitlement with nothing behind
  it is at best ignored and at worst a notarisation failure. The profile is
  committed (not a secret; a copy ships inside every distributed app) and runs
  to 2044, but is tied to the signing certificate:
  `scripts/macos-provisioning-profile.sh` regenerates it in one command when
  that rotates.
- `macos-release-embed.sh` verifies the pair on every release — profile
  present, signature claims the container, profile actually grants it. All
  three failures are silent at build time and fatal at runtime, so they stop
  the release instead of reaching a user. A unit test locks that the app asks
  for nothing the profile does not grant.
- This removes the root cause of #962 (a migrated Mac that later lost Full Disk
  Access would have shown an empty library): there is no longer a grant to
  lose.
- #961 also ships here: the container is probed for READ access rather than
  mere presence, so the app can no longer offer a move it cannot perform.

## Files Changed

- 7 files across 2 commits (+~600 / −~30)
