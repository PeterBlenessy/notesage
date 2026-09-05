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
# 1. BUILD. Tauri archives the app. The marketing version comes from
#    `tauri.ios.conf.json`, which Tauri merges for iOS builds — iOS has its own
#    version line, separate from the desktop's in package.json.
#
#    The build number is NOT handed to Tauri. Tauri derives CFBundleVersion
#    from the version string, so the best it could produce is `0.50.0.3`; the
#    number is meant to be a plain counter, since the version is carried
#    separately. It is stamped onto the archive in step 2b instead.
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

# The iOS marketing version is its OWN line, in `tauri.ios.conf.json` — the
# file Tauri already merges for iOS builds, verified to override the base
# config's version. It moves when iOS ships something worth a new version,
# which is rarely the same moment the desktop moves.
#
# It deliberately does NOT bump per release. Several builds under one marketing
# version is the correct shape: the build number carries per-build identity, so
# testers see `0.50.0 (0.50.0.3)`. Bumping the marketing version on every
# upload would produce a stream of numbers that mean nothing.
#
# Falling back to package.json would silently re-merge the two lines, which is
# exactly the drift this replaced — so a missing key is an error, not a default.
IOS_CONF=src-tauri/tauri.ios.conf.json
MARKETING="$(node -e "
  const c = require('./$IOS_CONF');
  if (!c.version) {
    console.error('No version in $IOS_CONF — the iOS marketing version lives there.');
    process.exit(1);
  }
  console.log(c.version.split('-')[0]);
")" || exit 2
TEAM_ID="${APPLE_TEAM_ID:-M39TDQ2D7L}"
echo "Notesage iOS ${MARKETING} · key ${ASC_KEY_ID} · team ${TEAM_ID}"

CORES="$(sysctl -n hw.ncpu)"
LOAD="$(uptime | sed -E 's/.*load averages?: *([0-9.]+).*/\1/')"
if awk -v l="$LOAD" -v c="$CORES" 'BEGIN { exit !(l / c > 0.7) }'; then
  echo "Machine is busy: load ${LOAD} on ${CORES} cores — the build will be slow."
  confirm "Continue anyway?" || exit 1
fi

# --- 0a. is this actually main? -----------------------------------------------
#
# Releases are cut from `main`, and everything in them is merged first. The
# alternative was tried on 2026-08-17 and does not hold up: four builds went to
# testers from an integration branch merging five open PRs, and by the end
# there was no commit on `main` that corresponded to what anyone was running.
# Shipping `main` would have silently REMOVED features testers already had.
#
# The `ios-build/*` tags kept it traceable, but traceable-to-a-throwaway-branch
# is not the same as reproducible.
#
# There is NO override. One existed (`RELEASE_OFF_MAIN=1`) for "just verifying
# a fix on device", which is a real need — and on 2026-08-21 it was used to
# work around a blocked git push, putting build 9 in front of testers from a
# branch. The flag printed a warning saying not to do exactly that. Warnings
# do not hold when someone is mid-flow; a hard stop does. Verify on device by
# merging first — CI is the cost, and it is smaller than an unreproducible
# build in a tester's hands.
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [ "$BRANCH" != "main" ]; then
  echo "On '${BRANCH}', not main."
  echo
  echo "Every build ships from main, TestFlight included. Merge first."
  echo
  echo "There is no override. RELEASE_OFF_MAIN used to be one, and it was"
  echo "removed on 2026-08-21 after being used to route around a blocked"
  echo "push: build 9 went to testers from a branch, and for as long as it"
  echo "sat there no commit on main matched what they were running. That is"
  echo "the same failure the flag's own warning described, which is the"
  echo "problem with warnings — they are advice, and advice loses to"
  echo "momentum. The rule is only worth anything if it is not negotiable"
  echo "in the moment someone is in a hurry."
  exit 1
fi
git fetch -q origin main 2>/dev/null || true
BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
if [ "${BEHIND:-0}" -gt 0 ]; then
  echo "main is ${BEHIND} commit(s) behind origin/main — pull before releasing,"
  echo "or the build omits work that is already merged."
  exit 1
fi

# --- 0b. are the tester notes actually for THIS release? -----------------------
#
# The failure this guards is silent and lands on the tester: notes describing
# the previous release, sending people to try something that already shipped.
# Nothing about a build reveals it — the notes look fine, they are simply
# about the wrong thing.
#
# The `ios-build/*` tags make it checkable. If no note file has changed since
# the last tagged build, they are last release's notes. That is often correct
# (a second build of the same release is meant to reuse them) and sometimes
# not, so this asks rather than refuses.
LAST_BUILD_TAG=$(git tag --list 'ios-build/*' --sort=-creatordate 2>/dev/null | head -1)
if [ -z "$LAST_BUILD_TAG" ]; then
  # Say so rather than passing quietly — this check silently does nothing in
  # exactly the place least likely to notice stale notes.
  #
  # 2026-08-22: this used to read "the tags are not pushed". They are —
  # `ios-build/3` through `ios-build/10` are all on origin; only the ancient 1
  # and 2 are local-only. The real cause was a shallow, tagless checkout in
  # `.github/workflows/ios-testflight.yml`, now fixed with `fetch-depth: 0`.
  # Left as a guard for a clone that genuinely has no tags.
  echo "No ios-build/* tags here, so the notes cannot be checked for staleness."
  echo "Read docs/app-store/testflight-whats-new*.md before continuing."
else
  if git diff --quiet "$LAST_BUILD_TAG" -- docs/app-store/testflight-whats-new*.md 2>/dev/null; then
    echo
    echo "The tester notes have not changed since ${LAST_BUILD_TAG}."
    echo "Fine for another build of the same release; wrong for a new one —"
    echo "testers would be told to try something that already shipped."
    echo "  docs/app-store/testflight-whats-new*.md"
    confirm "Ship the existing notes?" || { echo "Stopped. Rewrite the notes and run again."; exit 1; }
  fi
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
echo "    ${FULL}"

# --- 2. build -----------------------------------------------------------------
#
# `src-tauri/gen/apple/` is gitignored, so a fresh clone — or any CI runner —
# has no Xcode project. Generate it when missing rather than failing, so this
# script behaves identically wherever it runs.
if [ ! -d src-tauri/gen/apple ]; then
  echo "==> Generating the Xcode project (first run here)"
  pnpm tauri ios init --ci
fi

# ALWAYS re-run the integration, not only on first generation.
#
# `integrate-share-extension.py` owns the extension's source list, and the
# generated project is a cache of whatever that list said when it last ran. Gate
# this behind "only when gen/apple is missing" and a Swift file added afterwards
# is simply never compiled: on 2026-08-20 `PageRenderer.swift` had been in the
# script's list for a day and in nobody's build, and the release failed at the
# first line that referenced it. A developer with an older gen dir would have hit
# it too — and had the new file merely been unreferenced rather than called, the
# build would have SUCCEEDED and shipped without it.
#
# The script is idempotent (it patches project.yml and re-runs xcodegen), so the
# cost of running it every time is a few seconds against a build measured in
# minutes. Only gitignored files under `gen/` are touched.
echo "==> Syncing the Xcode project with the extension source list"
python3 src-tauri/ios/integrate-share-extension.py

# Keep the Share Extension's marketing version on the app's.
#
# The integration script above writes the extension's version from
# `tauri.ios.conf.json`, the same source Tauri reads for the app's plist, so
# after that step the two normally already agree. This stays as the backstop for
# the paths that skip it — an Info.plist xcodegen carried over rather than
# rewrote, or a project generated by some other route. Drift here is not
# cosmetic: Xcode warns on every build and App Store Connect rejects the pair.
#
# Step 2b stamps both plists inside the archive afterwards, so the artifact was
# always correct; this is about the project the build actually compiles. Only
# generated files under the gitignored `gen/` tree are touched — the rule that
# no TRACKED file is rewritten mid-release still holds.
EXT_INFO_PLIST="src-tauri/gen/apple/NotesageShare/Info.plist"
if [ -f "$EXT_INFO_PLIST" ]; then
  EXT_HAS=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$EXT_INFO_PLIST" 2>/dev/null || echo "")
  if [ "$EXT_HAS" != "$MARKETING" ]; then
    echo "==> Extension version ${EXT_HAS:-unset} -> ${MARKETING}"
    /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${MARKETING}" "$EXT_INFO_PLIST" \
      || /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string ${MARKETING}" "$EXT_INFO_PLIST"
  fi
fi

# Nothing is rewritten before the build any more. The version comes from
# `tauri.ios.conf.json`, which Tauri reads directly, and the build number is
# stamped onto the archive below — so no tracked file is mutated mid-release.
#
# An earlier version rewrote `tauri.conf.json` to smuggle the build number in
# through Tauri's prerelease mapping (`0.50.0-build.3` -> `0.50.0.3`). That was
# only necessary while the build number had to survive Tauri; now that it is
# written after the archive exists, the detour is gone.
echo "==> Building ${MARKETING}"
# The export method here is irrelevant — step 3 re-exports the archive
# properly. `debugging` simply avoids a guaranteed failure at this stage.
pnpm tauri ios build --export-method debugging

ARCHIVE=$(ls -dt src-tauri/gen/apple/build/*.xcarchive 2>/dev/null | head -1)
[ -n "$ARCHIVE" ] || { echo "The build produced no archive."; exit 1; }

# --- 2b. stamp the build number onto the archive -------------------------------
#
# Tauri cannot emit a bare integer: it derives CFBundleVersion from the version
# string, so the best it can do is `0.50.0.3`. The build number is meant to be
# a plain counter — the version is already carried separately — so it is
# written here instead, in the seam between archive and export.
#
# That seam is safe because `exportArchive` RE-SIGNS. The edit lands before
# signing, so the signature covers it; verified by exporting an edited archive
# and running `codesign --verify --deep --strict` on the result.
#
# Every bundle must agree — the app, the Share Extension, and the archive's own
# metadata. Xcode rejects an extension whose version differs from its host.
echo "==> Stamping build ${FULL}"
# Match by PATH, not by "any plist that happens to carry the key".
#
# An earlier version stamped every Info.plist under Products/Applications with
# a non-empty CFBundleVersion and required at least two. That worked only
# because the app currently embeds no frameworks: every bundle type carries
# that key, so the day an SPM package or pod brings a .framework along, the
# loop would overwrite ITS version too — and the >= 2 count could be satisfied
# by "app + framework" while the extension was silently missed.
APP_PLIST=$(find "$ARCHIVE/Products/Applications" -maxdepth 2 -name Info.plist -path '*.app/Info.plist' | head -1)
[ -n "$APP_PLIST" ] || { echo "No app Info.plist in the archive."; exit 1; }

EXT_PLISTS=$(find "$ARCHIVE/Products/Applications" -name Info.plist -path '*.appex/Info.plist')
[ -n "$EXT_PLISTS" ] || { echo "No extension Info.plist in the archive — the Share Extension is missing."; exit 1; }

/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${FULL}" "$APP_PLIST"
while IFS= read -r plist; do
  [ -n "$plist" ] || continue
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${FULL}" "$plist"
done <<EOF
$EXT_PLISTS
EOF
/usr/libexec/PlistBuddy -c "Set :ApplicationProperties:CFBundleVersion ${FULL}" "$ARCHIVE/Info.plist" 2>/dev/null || true
echo "    app + $(printf '%s\n' "$EXT_PLISTS" | grep -c . ) extension(s)"

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
# -maxdepth 2 reaches the app's plist (Payload/App.app/Info.plist) but NOT the
# extension's, which sits at depth 4 inside PlugIns/. So this step only ever
# verified half the pair — and the mismatch it would miss is exactly what
# Apple rejects on upload.
PLIST_PATH=$(find "$WORK/Payload" -maxdepth 2 -name Info.plist | head -1)
EXT_PLIST=$(find "$WORK/Payload" -name Info.plist -path '*.appex/Info.plist' | head -1)
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

# The extension must carry the SAME versions as its host; Apple rejects the
# pair otherwise. Checking only the app left the stamping step's most likely
# failure invisible until after the upload.
if [ -n "$EXT_PLIST" ]; then
  EXT_BUILD=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$EXT_PLIST")
  EXT_SHORT=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$EXT_PLIST")
  echo "    extension ${EXT_SHORT} (${EXT_BUILD})"
  [ "$EXT_BUILD" = "$FULL" ] || { echo "Extension build is ${EXT_BUILD}, app is ${FULL}. Apple would reject this."; exit 1; }
  [ "$EXT_SHORT" = "$MARKETING" ] || { echo "Extension version is ${EXT_SHORT}, app is ${MARKETING}. Apple would reject this."; exit 1; }
else
  echo "No extension found in the .ipa — the Share Extension should be there."
  exit 1
fi

# An entitlement the app declares but the SIGNATURE does not carry produces a
# build that installs, launches, and then cannot see its own library —
# `url(forUbiquityContainerIdentifier:)` returns nil in an unentitled process,
# so the app silently falls back to the folder picker and the whole feature
# looks like it was never built. That is the same failure shape
# `docs/ios-testflight.md` records for the App Group, and it is invisible
# until someone installs the build.
#
# The expectation comes from the entitlements the BUILD used, not from the
# reference file in `src-tauri/ios/` — that one has listed a container since
# before anything wrote it into the generated project, so keying off it would
# demand a container from every build that never asked for one.
GEN_ENT="src-tauri/gen/apple/notesage_iOS/notesage_iOS.entitlements"
WANT_CONTAINER=""
if [ -f "$GEN_ENT" ]; then
  WANT_CONTAINER=$(/usr/libexec/PlistBuddy -c "Print :com.apple.developer.ubiquity-container-identifiers:0" "$GEN_ENT" 2>/dev/null || true)
fi
if [ -n "$WANT_CONTAINER" ]; then
  EXT_BUNDLE=$(find "$WORK/Payload" -name '*.appex' -maxdepth 3 | head -1)
  for bundle in "$APP" "$EXT_BUNDLE"; do
    [ -n "$bundle" ] || continue
    signed=$(codesign -d --entitlements :- "$bundle" 2>/dev/null | tr -d '\0' || true)
    case "$signed" in
      *"$WANT_CONTAINER"*) ;;
      *)
        echo "$(basename "$bundle") is signed WITHOUT ${WANT_CONTAINER}."
        echo "The App ID needs the iCloud capability with that container assigned,"
        echo "or the build installs and then cannot find its library. Not uploading."
        exit 1
        ;;
    esac
  done
  echo "    iCloud container ${WANT_CONTAINER} present on both bundles"
fi

# --- 5. upload ----------------------------------------------------------------
echo
echo "Ready: ${GOT_SHORT} (${GOT_BUILD})"
echo "This reaches your TestFlight testers and cannot be withdrawn."
if ! confirm "Upload?"; then
  # The export directory is temporary and the EXIT trap removes it, so the
  # .ipa has to be moved somewhere durable before saying where it is —
  # otherwise this prints a path that is deleted a second later.
  DECLINED="src-tauri/gen/apple/build/Notesage-${GOT_BUILD}.ipa"
  mkdir -p "$(dirname "$DECLINED")"
  cp "$IPA" "$DECLINED"
  echo "Stopped. The build is at ${DECLINED}"
  exit 0
fi

# Keep the verified .ipa somewhere durable BEFORE talking to Apple. Validation
# and upload are the two steps most likely to fail for reasons that have
# nothing to do with the build — a network blip, a transient Apple error — and
# the cleanup trap would otherwise delete the artifact along with the temp
# directory, costing a full rebuild to retry a thirty-second upload.
KEPT="src-tauri/gen/apple/build/Notesage-${GOT_BUILD}.ipa"
mkdir -p "$(dirname "$KEPT")"
cp "$IPA" "$KEPT"

echo "==> Validating with Apple"
if ! xcrun altool --validate-app -f "$KEPT" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"; then
  echo "Validation failed. The build is kept at ${KEPT} — fix and retry the upload without rebuilding."
  exit 1
fi

echo "==> Uploading"
if ! xcrun altool --upload-app -f "$KEPT" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"; then
  echo "Upload failed. The build is kept at ${KEPT} — retry the upload without rebuilding."
  exit 1
fi

# --- 5b. record which commit this build came from ------------------------------
#
# A git tag, rather than a ledger file: git already has a mechanism for giving
# a commit a durable name, and 193 tags are already doing it. `ios-build/7`
# answers "which commit is build 7" via `git rev-parse`, and
# `git describe --tags --match 'ios-build/*'` answers the reverse.
#
# The `ios-build/` namespace keeps these out of the way — `git tag --list 'v*'`
# still lists releases only.
#
# Tagged AFTER the upload succeeds, so a failed release leaves no tag claiming
# a build that does not exist. Not pushed automatically: pushing is an outward
# action, and the tag is useful locally either way.
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  BUILD_TAG="ios-build/${FULL}"
  if git rev-parse -q --verify "refs/tags/${BUILD_TAG}" >/dev/null; then
    echo "    tag ${BUILD_TAG} already exists — leaving it alone"
  else
    git tag -a "$BUILD_TAG" -m "iOS ${GOT_SHORT} build ${FULL}" 2>/dev/null \
      && echo "    tagged ${BUILD_TAG} at $(git rev-parse --short HEAD)" \
      || echo "    (could not tag — release is unaffected)"
    echo "    push it with: git push origin ${BUILD_TAG}"
  fi
fi

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
