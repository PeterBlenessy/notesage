# Release v0.57.3

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

- #963 / #965. The Mac app carried no iCloud entitlement — only the iOS app
  declared the container — so macOS guarded
  `~/Library/Mobile Documents/iCloud~com~notesage~app`. It was believed Apple
  excludes iCloud from Developer ID distribution; that was wrong, and testing
  it rather than assuming it is what saved the feature. A `MAC_APP_DIRECT`
  profile for `com.notesage.app` comes back carrying
  `icloud-container-identifiers`, `ubiquity-container-identifiers` and
  `icloud-services`.
- **v0.57.2 was withdrawn: it would not launch.** The profile it embedded named
  one Developer ID certificate — the newest by expiry — and CI signs with a
  different one. macOS refuses entitlements whose profile does not cover the
  signing certificate and SIGKILLs the process at exec, so the app could not be
  opened at all. Everything around it was correct: valid signature, notarised,
  Gatekeeper-approved, right entitlements, profile granting them. Only the
  pairing was wrong, and nothing checked the pairing.
- The release now verifies what it previously assumed. `macos-release-embed.sh`
  asserts that **the profile covers the certificate that signed the app**, and
  then **launches the signed app** and fails the release if the kernel kills it
  (137). Every earlier check inspected metadata; an app can satisfy all of them
  and still not start, which is precisely what happened. The profile itself now
  covers every Developer ID certificate on the account, so it cannot name the
  wrong one and a rotation cannot orphan it.
- The final entitlements live in `src-tauri/macos/App-DeveloperID.entitlements`,
  separate from `Entitlements.plist`, because `tauri-bundler` signs and
  notarises before any profile is embedded. `scripts/macos-provisioning-profile.sh`
  regenerates the profile in one command.
- Removes the root cause of #962 — a migrated Mac that later lost Full Disk
  Access would have shown an empty library. There is no longer a grant to lose.
- #961 also ships here: the container is probed for READ access rather than
  mere presence, so the app cannot offer a move it is unable to perform.

## Files Changed

- 9 files across 3 commits (+~700 / −~40)
