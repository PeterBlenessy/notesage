#!/usr/bin/env bash
#
# Release to TestFlight:
#
#   scripts/ios-testflight.sh
#
# No arguments. Everything is discovered. Full background in
# `docs/ios-testflight.md`.
#
# ---------------------------------------------------------------------------
# The three steps, and why each is the way it is
# ---------------------------------------------------------------------------
#
# 1. BUILD. Tauri archives the app. The version it is given decides the bundle
#    versions, and it overwrites anything stamped into the generated Xcode
#    project afterwards — so the project cannot be edited into submission.
#    Instead the version is handed to Tauri as `<marketing>-build.<N>`: Tauri
#    strips the prerelease tag and appends its trailing number, producing
#    CFBundleVersion `<marketing>.<N>` and CFBundleShortVersionString
#    `<marketing>`. Using its own mapping rather than fighting it.
#
# 2. EXPORT. NOT `tauri ios build --export-method app-store-connect`. Tauri has
#    no way to pass authentication to xcodebuild, and the export needs it: the
#    distribution certificate is CLOUD-MANAGED, its private key held by Apple,
#    so signing happens on Apple's servers and xcodebuild must authenticate to
#    reach it. Hence a separate `xcodebuild -exportArchive` with
#    `-allowProvisioningUpdates` and the three `-authenticationKey*` flags.
#
#    The API key must have the **Admin** role. A Developer or App Manager key
#    fails with "Cloud signing permission error", which reads like a bug and is
#    not one.
#
# 3. UPLOAD. `altool`, same key. Validation runs first: it is the only thing
#    standing between a wrongly-signed build and your testers, and it has
#    already caught one.
#
# Everything here was established the hard way on 2026-08-17. Read
# `docs/ios-testflight.md` before changing any of it.
set -euo pipefail

cd "$(dirname "$0")/.."

# --- credentials, all discovered ---------------------------------------------
#
# The key lives in altool's canonical directory, which is where it was created
# and where altool looks anyway. `key_id` names which key to use — there is
# more than one, and picking by glob order would be luck rather than intent.
# `issuer_id` is per account and survives key rotation.
ASC_KEY_DIR="${ASC_KEY_DIR:-$HOME/.appstoreconnect/private_keys}"

read_file_or_empty() { [ -f "$1" ] && tr -d '[:space:]' < "$1" || true; }

ASC_KEY_ID="${ASC_KEY_ID:-$(read_file_or_empty "$ASC_KEY_DIR/key_id")}"
ASC_ISSUER_ID="${ASC_ISSUER_ID:-$(read_file_or_empty "$ASC_KEY_DIR/issuer_id")}"

if [ -z "$ASC_KEY_ID" ]; then
  echo "No key designated. Write the Admin key's id to $ASC_KEY_DIR/key_id"
  echo "Available: $(ls "$ASC_KEY_DIR"/AuthKey_*.p8 2>/dev/null | xargs -n1 basename 2>/dev/null | tr '\n' ' ')"
  exit 2
fi
if [ -z "$ASC_ISSUER_ID" ]; then
  echo "No issuer id. Write it to $ASC_KEY_DIR/issuer_id"
  exit 2
fi

ASC_PRIVATE_KEY_PATH="${ASC_PRIVATE_KEY_PATH:-$ASC_KEY_DIR/AuthKey_${ASC_KEY_ID}.p8}"
if [ ! -f "$ASC_PRIVATE_KEY_PATH" ]; then
  echo "Key ${ASC_KEY_ID} is designated but $ASC_PRIVATE_KEY_PATH does not exist."
  exit 2
fi
export ASC_KEY_ID ASC_ISSUER_ID

assume_yes() { [ "${ASSUME_YES:-0}" = "1" ]; }
confirm() {
  if assume_yes; then echo "$1 [auto-confirmed]"; return 0; fi
  local reply=""
  read -r -p "$1 [y/N] " reply || reply=""
  [ "$reply" = "y" ] || [ "$reply" = "Y" ]
}

MARKETING="$(node -p "require('./package.json').version.split('-')[0]")"
TEAM_ID="${APPLE_TEAM_ID:-M39TDQ2D7L}"
echo "Notesage ${MARKETING} · key ${ASC_KEY_ID} · team ${TEAM_ID}"

CORES="$(sysctl -n hw.ncpu)"
LOAD="$(uptime | sed -E 's/.*load averages?: *([0-9.]+).*/\1/')"
if awk -v l="$LOAD" -v c="$CORES" 'BEGIN { exit !(l / c > 0.7) }'; then
  echo "Machine is busy: load ${LOAD} on ${CORES} cores — the build will be slow."
  confirm "Continue anyway?" || exit 1
fi

# --- 1. build number ----------------------------------------------------------
#
# Asked of App Store Connect rather than counted locally, so that a release cut
# from a laptop and one cut from CI can never disagree about what comes next.
echo "==> Next build number"
FULL=$(
  ASC_PRIVATE_KEY="$(cat "$ASC_PRIVATE_KEY_PATH")" \
  ASC_BUNDLE_ID=com.notesage.app \
  node scripts/asc-next-build-number.mjs
)
N="${FULL##*.}"
echo "    ${FULL}"

# --- 2. build -----------------------------------------------------------------
CONF=src-tauri/tauri.conf.json
cp "$CONF" "$CONF.release-backup"
restore() { mv -f "$CONF.release-backup" "$CONF" 2>/dev/null || true; }
trap restore EXIT

node -e '
const fs = require("fs");
const p = "src-tauri/tauri.conf.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));
// Replaces the "../package.json" pointer with a literal, for this build only.
// package.json is untouched, so the version the app reports about itself and
// everything keyed off it are unaffected.
c.version = process.argv[1];
fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
' "${MARKETING}-build.${N}"

echo "==> Building ${MARKETING}-build.${N}"
# The export method here is irrelevant — step 3 re-exports the archive
# properly. `debugging` simply avoids a guaranteed failure at this stage.
pnpm tauri ios build --export-method debugging

restore
trap - EXIT

ARCHIVE=$(ls -dt src-tauri/gen/apple/build/*.xcarchive 2>/dev/null | head -1)
[ -n "$ARCHIVE" ] || { echo "The build produced no archive."; exit 1; }

# --- 3. export, signed for distribution ---------------------------------------
echo "==> Exporting for App Store"
EXPORT_DIR="$(mktemp -d)"
OPTIONS="$EXPORT_DIR/ExportOptions.plist"
cat > "$OPTIONS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key><string>app-store-connect</string>
    <key>signingStyle</key><string>automatic</string>
    <key>teamID</key><string>${TEAM_ID}</string>
    <key>destination</key><string>export</string>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$OPTIONS" \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_PRIVATE_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

IPA=$(find "$EXPORT_DIR" -name '*.ipa' | head -1)
[ -n "$IPA" ] || { echo "The export produced no .ipa."; exit 1; }

# --- 4. verify before uploading -----------------------------------------------
#
# Read it back off the artifact rather than trusting the steps above. An
# earlier attempt stamped a build number that never reached the app, and
# nothing noticed until Apple would have rejected it — after a full build.
echo "==> Verifying the artifact"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$EXPORT_DIR"' EXIT
unzip -qo "$IPA" -d "$WORK"
PLIST_PATH=$(find "$WORK/Payload" -maxdepth 2 -name Info.plist | head -1)
APP=$(find "$WORK/Payload" -maxdepth 1 -name '*.app' | head -1)

GOT_BUILD=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$PLIST_PATH")
GOT_SHORT=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$PLIST_PATH")
GOT_AUTH=$(codesign -dvv "$APP" 2>&1 | grep '^Authority' | head -1 | sed 's/Authority=//')
echo "    ${GOT_SHORT} (${GOT_BUILD}) · ${GOT_AUTH}"

[ "$GOT_BUILD" = "$FULL" ] || { echo "Expected build ${FULL}, got ${GOT_BUILD}. Not uploading."; exit 1; }
[ "$GOT_SHORT" = "$MARKETING" ] || { echo "Expected version ${MARKETING}, got ${GOT_SHORT}. Not uploading."; exit 1; }
case "$GOT_AUTH" in
  "Apple Distribution"*) ;;
  *) echo "Signed with '${GOT_AUTH}', not Apple Distribution. Apple would reject this."; exit 1;;
esac

# --- 5. upload ----------------------------------------------------------------
echo
echo "Ready: ${GOT_SHORT} (${GOT_BUILD})"
echo "This reaches your TestFlight testers and cannot be withdrawn."
if ! confirm "Upload?"; then
  # The export directory is temporary and the EXIT trap removes it, so the
  # .ipa has to be moved somewhere durable before saying where it is —
  # otherwise this prints a path that is deleted a second later.
  KEPT="src-tauri/gen/apple/build/Notesage-${GOT_BUILD}.ipa"
  mkdir -p "$(dirname "$KEPT")"
  cp "$IPA" "$KEPT"
  echo "Stopped. The build is at ${KEPT}"
  exit 0
fi

echo "==> Validating with Apple"
xcrun altool --validate-app -f "$IPA" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo "==> Uploading"
xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

# --- 6. "What to Test" notes ---------------------------------------------------
#
# Sent from `docs/app-store/testflight-whats-new*.md`, one per locale, so the
# notes never have to be pasted into the web form. This waits for Apple to
# finish processing, because a build is not addressable before then — expect a
# few minutes of nothing happening here.
#
# A failure at this point is NOT a failed release: the build is uploaded and
# testers can install it. Say so, and say how to fix it, rather than exiting
# non-zero and implying the upload came apart.
echo "==> Setting the What to Test notes"
if ASC_PRIVATE_KEY="$(cat "$ASC_PRIVATE_KEY_PATH")" \
   ASC_BUNDLE_ID=com.notesage.app \
   node scripts/asc-set-testflight-notes.mjs "$GOT_BUILD"; then
  :
else
  echo
  echo "The build uploaded fine, but the notes did not go through."
  echo "Nothing is lost — re-run just that step whenever:"
  echo "  ASC_KEY_ID=$ASC_KEY_ID ASC_ISSUER_ID=$ASC_ISSUER_ID \\"
  echo "  ASC_PRIVATE_KEY=\"\$(cat $ASC_PRIVATE_KEY_PATH)\" ASC_BUNDLE_ID=com.notesage.app \\"
  echo "  node scripts/asc-set-testflight-notes.mjs $GOT_BUILD"
fi

echo
echo "Released ${GOT_SHORT} (${GOT_BUILD})."
echo "Remember to rewrite docs/app-store/testflight-whats-new*.md before the next one —"
echo "stale notes send testers after something that already shipped."
