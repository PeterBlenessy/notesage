#!/usr/bin/env bash
#
# Embed the macOS Share Extension into the release bundle, then rebuild every
# artifact that derives from it.
#
# Runs AFTER `tauri-action` has built, signed, notarised and uploaded the normal
# artifacts. That ordering is deliberate — see "Failure mode" below.
#
# Why this exists
# ---------------
# `tauri-bundler` assembles the .app AND signs it in one pass, then derives the
# .dmg and the updater tarball from the signed bundle. There is no hook in
# between: `beforeBundleCommand` runs *before* the bundling phase, when no .app
# exists yet (verified against the Tauri 2.11 config schema). An extension
# embedded after signing invalidates the signature; there is nothing to embed
# into before it. So the only route is to take the finished bundle, embed, and
# regenerate everything downstream of it.
#
# What derives from the .app, and therefore has to be rebuilt
# ----------------------------------------------------------
#   1. the .app signature      — embedding breaks the seal
#   2. the notarisation ticket — a re-signed bundle needs re-notarising
#   3. the .dmg                — contains a copy of the .app
#   4. the updater .app.tar.gz — contains a copy of the .app
#   5. the updater .sig        — signs the tarball
#   6. latest.json's signature — embeds the .sig contents (patched by the
#                                caller; this script prints the value)
#
# Missing any one of 3-6 ships an inconsistent release. Missing 5 or 6
# specifically breaks auto-update for every desktop user, which is why this
# script verifies rather than assumes, and why it stages everything and only
# swaps artifacts in at the very end.
#
# Failure mode
# ------------
# If any step in THIS script fails, the release keeps the artifacts
# tauri-action already uploaded: correctly signed, correctly notarised, and
# simply lacking the Share Extension — i.e. the behaviour of every release
# before this one. Nothing here mutates the release; it only rebuilds local
# files and reports where they are.
#
# The replacement itself happens in the `Replace release assets` step in
# `release.yml`, and that step is NOT atomic — GitHub offers no atomic asset
# swap, so it is necessarily delete-then-upload. It mitigates rather than
# eliminates: it prepares everything before mutating anything, retries, and
# verifies afterwards. Do not describe the mismatch outcome as "unreachable";
# an earlier version of this comment did, and it was wrong.
#
# Env:
#   APPLE_SIGNING_IDENTITY  required — Developer ID Application: ...
#   APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID   required for notarisation
#   TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]        required for the updater sig
#   TARGET                  default aarch64-apple-darwin
#
# Outputs (GITHUB_OUTPUT when set): dmg, tarball, sig, signature
set -euo pipefail

TARGET="${TARGET:-aarch64-apple-darwin}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$REPO/src-tauri/target/$TARGET/release/bundle"
APP="$BUNDLE/macos/Notesage.app"
TARBALL="$BUNDLE/macos/Notesage.app.tar.gz"
WORK="$REPO/src-tauri/target/macos-release-embed"

step() { echo "==> $*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

: "${APPLE_SIGNING_IDENTITY:?APPLE_SIGNING_IDENTITY is required — refusing to produce an unsigned bundle}"
[ -d "$APP" ] || die "no app bundle at $APP (did the Tauri build run?)"

rm -rf "$WORK"; mkdir -p "$WORK"

# --- 0. reference listing, captured BEFORE we touch anything ------------------
#
# Tauri's own updater tarball is the ground truth for what the updater expects
# to receive. Ours must be a strict superset (same entries, plus the extension).
# Comparing against it catches a malformed tarball — the failure that would
# otherwise surface as a broken auto-update for every user.
#
# Listings are normalised by stripping trailing slashes, because the two
# tarballs are written by different implementations: Tauri's (Rust `tar` crate)
# emits directory entries as `Notesage.app/Contents`, while the `bsdtar` that
# rebuilds it below emits `Notesage.app/Contents/`. Compared raw, EVERY
# directory reads as missing and the check fails on a build that is perfectly
# fine — which is exactly how it failed on the third v0.52.0 attempt, after the
# embed, signing, notarisation and stapling had all succeeded.
if [ -f "$TARBALL" ]; then
  tar tzf "$TARBALL" | sed 's#/$##' | sort > "$WORK/reference-listing.txt"
  step "Reference tarball: $(wc -l < "$WORK/reference-listing.txt" | tr -d ' ') entries"
else
  die "no updater tarball at $TARBALL — expected tauri-action to have produced one"
fi

# --- 1. embed the extension and re-sign, inside out ---------------------------
step "Embedding Share Extension"
"$REPO/scripts/build-macos-share-extension.sh" "$APP" "$APPLE_SIGNING_IDENTITY"

APPEX="$APP/Contents/PlugIns/NotesageShare.appex"
[ -d "$APPEX" ] || die "extension missing after embed: $APPEX"
codesign --verify --strict "$APPEX" || die "extension is not validly signed"

# --- 1b. the iCloud entitlement, verified rather than assumed -----------------
#
# This is the difference between an app that opens its own iCloud folder and
# one that asks every user for Full Disk Access to read it. The failure mode is
# silent — an app signed without the entitlement launches, runs, and only fails
# when somebody tries to use their library — so it is checked here, where a
# failure stops the release, rather than discovered by a user.
step "Verifying iCloud entitlement and provisioning profile"
[ -f "$APP/Contents/embedded.provisionprofile" ] \
  || die "no embedded.provisionprofile in the bundle — macOS will refuse the iCloud entitlements"

SIGNED_ENTS="$WORK/signed-entitlements.plist"
codesign -d --entitlements :- "$APP" > "$SIGNED_ENTS" 2>/dev/null \
  || die "could not read the signed entitlements back from $APP"
grep -q "com.apple.developer.icloud-container-identifiers" "$SIGNED_ENTS" \
  || die "the signed app carries no iCloud container entitlement (see $SIGNED_ENTS)"
grep -q "iCloud.com.notesage.app" "$SIGNED_ENTS" \
  || die "the signed app's iCloud entitlement does not name iCloud.com.notesage.app"

# The profile has to actually grant what the signature claims. A profile for
# the wrong App ID, or one whose capabilities were changed in the developer
# portal, produces a bundle that signs and notarises and then cannot touch the
# container at runtime.
security cms -D -i "$APP/Contents/embedded.provisionprofile" > "$WORK/profile.plist" 2>/dev/null \
  || die "could not decode the embedded provisioning profile"
/usr/libexec/PlistBuddy -c "Print :Entitlements:com.apple.developer.icloud-container-identifiers" \
  "$WORK/profile.plist" 2>/dev/null | grep -q "iCloud.com.notesage.app" \
  || die "the embedded profile does not grant the iCloud container the signature claims"
echo "    iCloud container entitlement present, and granted by the profile"

# The profile must cover the certificate that SIGNED this app.
#
# This is the check whose absence shipped v0.57.2 as an app that would not
# open. Everything else passed: the signature was valid, notarised and
# Gatekeeper-approved, the entitlements were right, the profile granted them.
# The profile simply named a different Developer ID certificate than CI signs
# with, and macOS answers that by SIGKILLing the process at exec.
codesign -d --extract-certificates="$WORK/appcert" "$APP" 2>/dev/null \
  || die "could not extract the signing certificate from $APP"
SIGNER_SHA="$(openssl x509 -inform DER -in "$WORK/appcert0" -noout -fingerprint -sha1 \
  | sed 's/.*=//; s/://g')"
python3 - "$APP/Contents/embedded.provisionprofile" "$SIGNER_SHA" <<'PYEOF' \
  || die "the embedded profile does not cover the certificate this app was signed with — the app would be killed at launch"
import hashlib, plistlib, re, sys
blob = open(sys.argv[1], "rb").read()
pl = plistlib.loads(re.search(rb"<\?xml.*?</plist>", blob, re.S).group(0))
want = sys.argv[2].upper()
have = [hashlib.sha1(c).hexdigest().upper() for c in pl.get("DeveloperCertificates", [])]
print(f"    signer {want[:16]}… ; profile covers {len(have)} certificate(s)")
sys.exit(0 if want in have else 1)
PYEOF

# And then the only question that actually matters: does it RUN.
#
# Every check above inspects metadata. An app can pass all of them and still
# be killed at exec — which is exactly what happened — so this launches the
# thing and looks for the kernel killing it. A window never appears on a
# headless runner and that is fine: the failure being caught here is SIGKILL
# (137), not an unhappy UI.
step "Launching the signed app to prove it is not killed at exec"
"$APP/Contents/MacOS/notesage" >"$WORK/launch.log" 2>&1 &
LAUNCH_PID=$!
sleep 8
if kill -0 "$LAUNCH_PID" 2>/dev/null; then
  kill "$LAUNCH_PID" 2>/dev/null || true
  wait "$LAUNCH_PID" 2>/dev/null || true
  echo "    the app started and stayed up"
else
  wait "$LAUNCH_PID" 2>/dev/null
  LAUNCH_STATUS=$?
  if [ "$LAUNCH_STATUS" -eq 137 ]; then
    tail -20 "$WORK/launch.log" >&2 || true
    die "the signed app was KILLED at launch (137) — its entitlements are not honoured by the embedded profile"
  fi
  # Anything else is not this failure class. A headless runner can end a GUI
  # process for its own reasons, and failing the release over that would be
  # trading one silent breakage for a flaky pipeline.
  echo "    the app exited with $LAUNCH_STATUS (not a signing kill; continuing)"
fi

# --- 2. re-notarise ------------------------------------------------------------
#
# The ticket tauri-action stapled belongs to the pre-embed bundle. Gatekeeper
# rejects a stapled ticket whose hash no longer matches the bundle.
step "Notarising re-signed bundle"
: "${APPLE_ID:?}" ; : "${APPLE_PASSWORD:?}" ; : "${APPLE_TEAM_ID:?}"
ditto -c -k --keepParent "$APP" "$WORK/notarize.zip"
xcrun notarytool submit "$WORK/notarize.zip" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait || die "notarisation failed"
xcrun stapler staple "$APP" || die "could not staple ticket to $APP"

# --- 3. regenerate the updater tarball ----------------------------------------
#
# Same shape Tauri produces: the .app directory itself at the tar root, gzipped.
step "Rebuilding updater tarball"
rm -f "$TARBALL" "$TARBALL.sig"
tar -C "$BUNDLE/macos" -czf "$TARBALL" "Notesage.app"

tar tzf "$TARBALL" | sed 's#/$##' | sort > "$WORK/new-listing.txt"
# `comm` failing and `comm` finding nothing both produce empty output, so a
# blanket `|| true` here would turn "something went wrong" into "all good" —
# in the one check whose whole job is to catch a malformed tarball. Capture
# the status separately and treat a failure as a failure.
set +e
MISSING="$(comm -23 "$WORK/reference-listing.txt" "$WORK/new-listing.txt")"
COMM_STATUS=$?
set -e
[ "$COMM_STATUS" -eq 0 ] || die "could not compare tarball listings (comm exited $COMM_STATUS)"
if [ -n "$MISSING" ]; then
  echo "$MISSING" | head -20 >&2
  die "rebuilt tarball is missing entries the original had (see above)"
fi
grep -q "PlugIns/NotesageShare.appex" "$WORK/new-listing.txt" \
  || die "rebuilt tarball does not contain the extension"
step "Tarball verified: superset of the original, extension present"

# --- 4. sign the tarball -------------------------------------------------------
#
# `tauri signer sign` is the same code path the bundler uses, reading the same
# key from the same env vars — so the signature is generated exactly as an
# untouched release would generate it.
step "Signing updater tarball"
: "${TAURI_SIGNING_PRIVATE_KEY:?}"
( cd "$REPO" && npx tauri signer sign "$TARBALL" >/dev/null )
[ -s "$TARBALL.sig" ] || die "signer produced no .sig at $TARBALL.sig"
SIGNATURE="$(cat "$TARBALL.sig")"

# --- 5. regenerate the dmg -----------------------------------------------------
#
# Cosmetic note: this is a plain UDZO image with an /Applications symlink, not
# Tauri's default window layout (icon positions + window size). It installs
# identically; it just looks plainer on first open. Worth knowing, not worth a
# create-dmg dependency.
step "Rebuilding dmg"
# Under `pipefail` a non-matching glob makes `ls` — the only failing command in
# the pipeline — set the status, which `|| true` then absorbs, leaving DMG
# empty for the guard below to catch. It reads like a swallowed error and is
# not one; the emptiness IS the signal.
DMG="$(ls "$BUNDLE/dmg/"*.dmg 2>/dev/null | head -1)" || true
[ -n "${DMG:-}" ] || die "no dmg found under $BUNDLE/dmg"
STAGE="$WORK/dmg-stage"
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "Notesage" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$DMG" || die "could not sign dmg"
xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" \
  --wait || die "dmg notarisation failed"
xcrun stapler staple "$DMG" || die "could not staple ticket to dmg"

# --- 6. verify the shipped artefact -------------------------------------------
#
# Task #4.2 of the PRD: an extension that fails to load produces no error, no
# crash and no log the user will find — it is simply absent from the Share
# menu, which is indistinguishable from never having been built. So assert.
step "Verifying"
codesign --verify --deep --strict --verbose=2 "$APP" || die "app failed deep signature verification"
spctl -a -t exec -vv "$APP" 2>&1 | grep -q "accepted" || die "Gatekeeper rejected the app"
xcrun stapler validate "$APP" || die "app has no valid stapled ticket"
xcrun stapler validate "$DMG" || die "dmg has no valid stapled ticket"
codesign -dv --verbose=4 "$APPEX" 2>&1 | grep -q "Authority=Developer ID Application" \
  || die "extension is not signed with a Developer ID authority"

step "OK — extension embedded, all derived artifacts rebuilt and verified"
echo "    app:     $APP"
echo "    dmg:     $DMG"
echo "    tarball: $TARBALL"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "dmg=$DMG"
    echo "tarball=$TARBALL"
    echo "sig=$TARBALL.sig"
    # Heredoc rather than `signature=$SIGNATURE`. The .sig is single-line
    # base64 today — verified against a real key, `wc -l` is 0 — so the bare
    # form works. But a bare `key=value` silently truncates at the first
    # newline, and the value it would truncate is the one the updater checks
    # before installing. Free insurance against `tauri signer`'s output shape
    # ever changing.
    echo "signature<<NOTESAGE_SIG_EOF"
    echo "$SIGNATURE"
    echo "NOTESAGE_SIG_EOF"
  } >> "$GITHUB_OUTPUT"
fi
