# Shipping the iOS app via TestFlight

The path from the current dev-signed builds to a TestFlight build Peter can
install over the air. Issue: #587.

Everything under **Build side** is done in the repo and needs no Apple
account; everything under **Account side** needs Peter signed in to the Apple
Developer portal / App Store Connect.

## Account side (Peter — one-time)

1. **Apple Developer Program** membership, active, for ADDABLE AB. TestFlight
   is not available on a free account.
2. **App IDs**: `com.notesage.app` and the extension's
   `com.notesage.app.share`, both with the **App Groups** capability enabled
   and joined to `group.com.notesage.app` (the shared library grant lives
   there — an unentitled build cannot see the folder the extension saved to).
3. **App Store Connect app record** for `com.notesage.app`: name, primary
   language, bundle ID, SKU.
4. **Distribution signing**: an App Store distribution certificate plus
   provisioning profiles for both targets. Xcode-managed signing with the
   ADDABLE team is the least-friction route for a first upload.

## Build side (in-repo, done)

- **Export compliance baked in**: `ITSAppUsesNonExemptEncryption: false` on
  BOTH targets (`integrate-share-extension.py` → `project.yml`). Notesage
  uses only standard HTTPS/TLS, which is exempt; declaring it stops App Store
  Connect asking on every upload and prevents builds parking in "Missing
  Compliance".
- **Icon alpha stripped**: `tauri icon` emits RGBA icons whose alpha is fully
  opaque, and App Store Connect rejects an app icon that merely *has* an
  alpha channel. `strip_icon_alpha()` in the integrator flattens them onto
  white (pixels unchanged) and re-runs on every integration, so a later icon
  regeneration cannot reintroduce the rejection.
- **Privacy label answer**: **Data Not Collected** — backed by the verified
  telemetry-free binary (the Sentry/Aptabase crates are gated off the iOS
  target and the frontend telemetry module is unreachable from `MobileApp`;
  both regression-locked — see `docs/features/mobile.md` §"Telemetry-free by
  construction").
- **Versioning**: `CFBundleShortVersionString` / `CFBundleVersion` come from
  `package.json` via Tauri (prerelease tags stripped: `0.48.0-alpha.29` →
  `0.48.0` / `0.48.0.29`). Each alpha cut therefore yields a unique, ascending
  build number — but two uploads from the SAME alpha would collide. Cut an
  alpha (or bump the build) before each upload.

## Upload

```bash
# 1. Archive with App Store distribution signing (needs the account side done)
npx tauri ios build --export-method app-store-connect

# 2. Upload the IPA
xcrun altool --upload-app -f src-tauri/gen/apple/build/arm64/Notesage.ipa \
  -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
# (or drag the archive through Xcode → Organizer → Distribute App)
```

Then in App Store Connect → TestFlight: add Peter as an **internal** tester
(up to 100 of the team's own devices, **no beta review**, available within
minutes of processing). External testing is what needs Beta App Review — not
required for our own testing.

## Before the first upload

- Build and smoke-test the **release** configuration on device (no dev
  server, different optimization) — grant flow, reading, create/edit, share
  capture, QuickLook, gallery.
- Draft "What to Test" notes for the TestFlight build.

## Not required for TestFlight (App Store only)

Screenshots, description/keywords/category, support + privacy-policy URLs,
age rating. Those belong to the store submission, not the beta.
