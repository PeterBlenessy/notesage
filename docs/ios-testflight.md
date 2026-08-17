# Shipping the iOS app via TestFlight

The path from the current dev-signed builds to a TestFlight build Peter can
install over the air. Issue: #587.

Everything under **Build side** is done in the repo and needs no Apple
account; everything under **Account side** needs Peter signed in to the Apple
Developer portal / App Store Connect.

## Account side (Peter — one-time), step by step

Apple's labels shift between redesigns; the paths below are the shape to look
for, not a guarantee of wording.

### 0. Confirm the membership

`src-tauri/tauri.ios.conf.json` already carries `developmentTeam: M39TDQ2D7L`,
so a team exists. Check it is the ORG team and the membership is active:
**developer.apple.com → Account**. The header shows the team name and role; an
expired membership shows a renewal banner and blocks everything below.

If enrolment is still needed, it is the long pole — an organization enrolment
needs a D-U-N-S number and legal-entity verification, and can take days.
Everything else here is minutes.

### 1. Create the App Group FIRST

It must exist before the App IDs can join it.

1. **developer.apple.com → Account → Certificates, Identifiers & Profiles →
   Identifiers**.
2. Switch the filter (top right of the list) from *App IDs* to **App Groups**.
3. **+** → *App Groups* → Continue.
4. Description: `Notesage App Group`. Identifier: `group.com.notesage.app` —
   exactly this string; it is compiled into both targets' entitlements and the
   Swift `APP_GROUP_ID` constant.
5. Continue → Register.

### 2. Register the two App IDs

Do this twice — once for the app, once for the Share Extension.

1. Same **Identifiers** page, filter back to *App IDs* → **+** → *App IDs* →
   Continue → *App* → Continue.
2. Description: `Notesage` (then `Notesage Share`). Bundle ID: **Explicit**,
   `com.notesage.app` (then **`com.notesage.app.ShareExtension`** — the exact
   string in `project.yml` and `integrate-share-extension.py`; NOT
   `com.notesage.app.share`).

   Both App IDs may ALREADY EXIST, auto-registered by Xcode during dev builds.
   If Apple offers them, edit the existing entry instead of creating a new
   one — the capability work below is identical either way.
3. In **Capabilities**, tick **App Groups**.
4. Continue → Register.
5. Reopen the App ID you just made, click **Configure** next to App Groups,
   tick `group.com.notesage.app`, Save.

Step 5 is the one to double-check on BOTH IDs. Ticking the capability without
assigning the group produces a build that installs, launches, and then cannot
see the folder the Share Extension saved into — the failure looks like a bug
in the app, not a provisioning mistake.

### 3. Create the App Store Connect record

1. **appstoreconnect.apple.com → My Apps → + → New App**.
2. Platform: **iOS**. Name: `Notesage`. Primary Language. Bundle ID: pick
   `com.notesage.app` from the dropdown — *it only appears if step 2
   succeeded*. SKU: any unique internal string, e.g. `notesage-ios`. User
   Access: Full Access.
3. **Create**.

The name is claimed here. If `Notesage` is taken, the dropdown accepts it but
Create fails — decide the store name before going further.

### 4. Point Xcode at the team

1. Open `src-tauri/gen/apple/notesage.xcodeproj`.
2. Select the **notesage_iOS** target → **Signing & Capabilities** → tick
   *Automatically manage signing* → Team: the ADDABLE team.
3. Repeat for the **NotesageShare** target.
4. Both should show a green "provisioning profile" line with no red text.

Automatic signing then creates the distribution certificate and both profiles
on the first archive. Note Xcode edits the generated project — re-running
`tauri ios init` would overwrite it, so if that ever happens, redo this step.

### 5. (For command-line upload) Create an App Store Connect API key

Skip if you would rather upload through Xcode's Organizer GUI the first time.

1. **App Store Connect → Users and Access → Integrations → App Store Connect
   API** → **+**.
2. Name it, Access: **Admin**, Generate.

   **Admin, not App Manager.** This document said App Manager until
   2026-08-17, and that is exactly what an evening was lost to. The
   distribution certificate is cloud-managed, so the export has to ask Apple
   to sign — and only an Admin key may use a cloud-managed certificate.
   Anything less authenticates perfectly and then fails with
   `error: exportArchive Cloud signing permission error`, which reads like a
   bug and is not one. **Roles cannot be changed after creation**; a wrong
   role means generating a new key.
3. Download the `.p8` — **once only, it is never shown again** — and note the
   **Key ID** and the **Issuer ID** shown above the list.
4. Put the file at `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`, then
   record which key to use and the issuer beside it:

   ```bash
   echo <KEYID>     > ~/.appstoreconnect/private_keys/key_id
   echo <ISSUER_ID> > ~/.appstoreconnect/private_keys/issuer_id
   ```

   `scripts/ios-testflight.sh` reads all three, so nothing has to be typed or
   remembered at release time. The directory is `altool`'s own search path, so
   the key is found there by both.

### 6. Then releasing is one command

Once 1–5 are done, releases run from the repo:

```bash
scripts/ios-testflight.sh
```

See §"Upload" below for what it does and why each step is the way it is.

**Do not follow older instructions to archive with
`npx tauri ios build --export-method app-store-connect`** — that cannot work,
for reasons the Upload section explains. It is the single most expensive wrong
turn available here.

### 7. Turn on TestFlight (after the build finishes processing)

Processing is usually minutes; ASC emails you when it is done.

1. **App Store Connect → your app → TestFlight**. The build appears with a
   status; wait for *Ready to Test*.
2. Export compliance should NOT be asked — `ITSAppUsesNonExemptEncryption` is
   baked into both targets. If it asks anyway, answer *No* (standard
   HTTPS/TLS only).
3. Nothing to paste — the release script sends the **What to Test** notes for
   every locale, from `docs/app-store/testflight-whats-new*.md`. Rewrite those
   files before a release rather than typing into the web form.
4. **Internal Testing → + →** create a group (e.g. `Internal`) → add testers.
   Testers must already exist under **Users and Access**; your own account is
   there by default.
5. Tick the build for that group.
6. On the phone: install **TestFlight** from the App Store, sign in with the
   same Apple ID, accept the invite, install.

No Beta App Review for internal testers, up to 100 devices, and no
screenshots, description, support URL or privacy-policy URL required.

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
  `package.json` via Tauri, with prerelease tags stripped and their trailing
  number appended: `0.48.0-alpha.29` → `0.48.0` / `0.48.0.29`.

  While the alpha channel existed, each cut therefore produced a unique
  ascending build number **by accident**. Retiring the channel removed that,
  and a plain `0.50.0` gives every build the same `CFBundleVersion` — the
  second upload is rejected as a duplicate.

  `scripts/ios-testflight.sh` uses the same mapping deliberately: it asks App
  Store Connect for the next number and builds as `<marketing>-build.<N>`,
  yielding `CFBundleVersion <marketing>.<N>`. Only `tauri.conf.json` is
  rewritten, for the duration of the build; `package.json` is untouched.

  Note this cannot be done by stamping the generated Xcode project — Tauri
  overwrites `project.yml` during the build, so an edit there reaches nothing.
  Asking Apple for the number, rather than counting locally, is also what lets
  a release cut from a laptop and one cut from CI agree.

## Upload

**Validate first.** It costs a minute and catches the things that would
otherwise fail after uploading hundreds of megabytes. Both problems below
were caught this way on the first attempt.

```bash
scripts/ios-testflight.sh
```

**Releases are cut from `main`, and everything in them is merged first.** The
script refuses otherwise.

That rule exists because the alternative was tried: on 2026-08-17 four builds
went to testers from an integration branch merging five open PRs, and by the
end no commit on `main` matched what anyone was running — shipping `main`
would have silently removed features testers already had. The `ios-build/*`
tags kept it traceable, but traceable-to-a-throwaway-branch is not
reproducible.

`RELEASE_OFF_MAIN=1` overrides, for verifying a fix on device before merging
it. That is a real need — it is how the HTML-height fix was checked — and the
override prints what is being shipped that `main` lacks, so it stays an
exception rather than becoming the habit.

No arguments. Proven end to end on 2026-08-17 with build `0.50.0.1`. It asks
App Store Connect for the next build number, builds, exports a
distribution-signed `.ipa`, checks it, and uploads.

**`--export-method app-store-connect` does not work, and the reason is not
obvious.** That runs Xcode's `exportArchive`, which needs a distribution
identity. There is none locally and there is not meant to be: Xcode 13 and
later create **cloud-managed** distribution certificates whose private key
stays on Apple's servers. Signing happens remotely, so whatever exports must
authenticate — and `tauri ios build` has no way to pass credentials through
(it offers only `--export-method` and `--no-sign`).

The symptom is `No Accounts` followed by
`No signing certificate "iOS Distribution" found`, which reads as though
something is missing from the machine. Nothing is. Hours went into hunting for
a certificate that does not exist by design.

So the archive is made by Tauri and exported separately:

```bash
xcodebuild -exportArchive \
  -archivePath <archive> -exportOptionsPlist <plist> -exportPath <dir> \
  -allowProvisioningUpdates \
  -authenticationKeyPath <p8> \
  -authenticationKeyID <keyid> \
  -authenticationKeyIssuerID <issuer>
```

Two traps around the certificates themselves:

- **A distribution certificate added in Xcode may not appear in your
  keychain.** Xcode lists cloud-managed certificates next to local ones, and
  cloud-managed ones have no local private key, so `security find-identity`
  will not show them. This is not something that failed to persist.
- **Adding one via *Manage Certificates → + → Apple Distribution* creates a
  second, different certificate.** Both are called
  `Apple Distribution: ADDABLE AB`; only the serials differ. Existing
  profiles trust the original, so the new one yields
  `Provisioning profile … doesn't include signing certificate`. Apple allows
  two distribution certificates per team — do not keep adding them.

The script reads the version and signing authority back out of the built
`.ipa` and refuses to upload if either is wrong, then validates before
uploading. Both checks have earned their place: a build number was once
stamped that never reached the artifact, and validation once caught a
development-signed build headed for real testers.

**Read the log, not the exit code.** A backgrounded `cmd | tee log` reports
`tee`'s status; a failed build once looked like a success because of it.

The API key lives at `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`;
the issuer id is on the same App Store Connect page that generated it. Prefer
the key over an Xcode account session: Xcode persists the ACCOUNT in its
preferences but keeps the SESSION token in the login keychain, and under 2FA
that token expires — `xcodebuild` then reports "No Accounts" even though the
account is plainly listed, which is what blocked the first export.

### Two things that failed validation the first time

Both are fixed permanently in `integrate-share-extension.py`, so they cannot
come back when `tauri ios init` regenerates the project.

- **ITMS-90171, "libapp.a is not permitted"** — Tauri's generated
  `project.yml` lists `Externals` as a SOURCE path of the app target, so
  XcodeGen copied the 1.4 GB Rust staticlib into the bundle as a resource on
  top of linking it properly. `buildPhase: none` keeps the folder in the
  project and the linker untouched while adding it to no copy phase. The IPA
  went from 386 MB to 16 MB.
- **ITMS-90737, "Missing Document Configuration"** — we declare
  `CFBundleDocumentTypes` for `.md`, so Apple wants to know what happens when
  a document is opened. `LSSupportsOpeningDocumentsInPlace: false` is the
  truthful answer: the app reads and writes only inside the granted library,
  so iOS hands it a copy instead. A warning today; Apple promotes these.

### Querying App Store Connect without installing anything

Useful when TestFlight and the web UI disagree. An ES256 JWT can be minted
with openssl and the standard library alone — no `pyjwt`, no `cryptography`:
sign `base64url(header).base64url(payload)` with
`openssl dgst -sha256 -sign AuthKey_<KEYID>.p8`, then convert the DER
signature to raw `r||s` (32 bytes each). Tokens last 20 minutes maximum.
Quote the URLs — zsh eats the `filter[...]` brackets.

Fields worth knowing: `builds.processingState` (VALID = processed),
`buildBetaDetails.internalBuildState` (IN_BETA_TESTING = live for internal
testers), and `betaTesters.state` (INVITED = the invitation has not been
redeemed).

### If the build never appears in TestFlight

Seen once, on the first ever build: everything read correct server-side —
build VALID, attached to the internal group, `IN_BETA_TESTING` — and the app
still would not list, with the invite link reporting "not available". The
tester was stuck at `INVITED` from a redemption attempted BEFORE the build
was attached to the group, and nothing re-checks after that.

The fix: DELETE the `betaTesters` entry and POST it again, which issues a
fresh invitation. Force-quitting TestFlight and re-tapping the old link did
not clear it.

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

All of that copy is drafted in [`app-store/`](app-store/) so it is reviewable
and versioned rather than typed into a web form: the App Privacy answers (with
the evidence for "Data Not Collected"), the privacy policy itself, the
TestFlight "What to Test" and beta-review notes, the listing copy, the
screenshot shot list, and the age-rating answers. Three decisions there need a
human: where the privacy policy is hosted, what the support URL is, and
whether the store name "Notesage" is free.
