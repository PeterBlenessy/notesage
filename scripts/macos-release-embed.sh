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
# If any step here fails, the release keeps the artifacts tauri-action already
# uploaded: correctly signed, correctly notarised, and simply lacking the Share
# Extension — i.e. exactly the behaviour of every release before this one. The
# bad outcome (a release whose updater signature does not match its tarball) is
# unreachable, because assets are replaced only after all verification passes.
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
if [ -f "$TARBALL" ]; then
  tar tzf "$TARBALL" | sort > "$WORK/reference-listing.txt"
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

tar tzf "$TARBALL" | sort > "$WORK/new-listing.txt"
MISSING="$(comm -23 "$WORK/reference-listing.txt" "$WORK/new-listing.txt" || true)"
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
    echo "signature=$SIGNATURE"
  } >> "$GITHUB_OUTPUT"
fi
