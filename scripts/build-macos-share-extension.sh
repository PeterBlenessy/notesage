#!/usr/bin/env bash
#
# Build the macOS Share Extension and embed it in a Tauri-produced .app.
#
#   scripts/build-macos-share-extension.sh <path-to-Notesage.app> [signing-identity]
#
# Why a script and not an Xcode target
# ------------------------------------
# On iOS, `tauri ios init` generates an Xcode project and a python script adds
# the extension target to it. On macOS Tauri emits the .app directly — there is
# no project to add a target to — so the extension is compiled, assembled and
# embedded here.
#
# ORDERING IS THE FRAGILE PART. tauri-bundler both creates AND signs the app.
# An extension embedded after that invalidates the signature; before, there is
# nothing to embed into. So this signs the whole thing itself — inside out,
# extension first, app last, which is what codesign requires for nested code.
#
# The bundle may arrive EITHER unsigned (a local `tauri build` with no identity)
# or already signed, notarised and stapled (the release pipeline, where
# `macos-release-embed.sh` calls this after tauri-action has finished). Both are
# fine: `codesign --force` replaces the existing signature. But in the second
# case the stapled notarisation ticket no longer matches the bundle, so the
# CALLER must re-notarise and re-staple afterwards — `macos-release-embed.sh`
# does. Anything invoking this on a notarised bundle without doing that ships an
# app Gatekeeper will reject.
set -euo pipefail

APP="${1:?usage: $0 <path-to-Notesage.app> [signing-identity]}"
IDENTITY="${2:-${APPLE_SIGNING_IDENTITY:-}}"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO/src-tauri/macos"
BUILD="$REPO/src-tauri/target/macos-share"
APPEX="$APP/Contents/PlugIns/NotesageShare.appex"

[ -d "$APP" ] || { echo "Not a bundle: $APP"; exit 1; }

# --- 1. the Rust capture staticlib -------------------------------------------
#
# The same crate the iOS extension links. Building it per-arch and lipo-ing lets
# the extension match whatever the app was built for.
#
# NOTE: the release pipeline installs and builds ONLY aarch64-apple-darwin, so
# both app and extension are arm64 there and the lipo is a no-op. If x86_64 is
# ever added, this loop picks it up automatically but the `swiftc` invocation
# below does NOT — it is hardcoded to `-target arm64-apple-macos11.0`, and would
# need a second compile plus a lipo of the binaries to keep parity.
echo "==> Building notesage-capture"
ARCHS=()
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  if rustup target list --installed | grep -q "^${target}$"; then
    ( cd "$REPO/src-tauri" && cargo build --release -p notesage-capture --target "$target" )
    ARCHS+=("$REPO/src-tauri/target/$target/release/libnotesage_capture.a")
  fi
done
[ ${#ARCHS[@]} -gt 0 ] || { echo "No darwin rust targets installed"; exit 1; }

mkdir -p "$BUILD"
LIB="$BUILD/libnotesage_capture.a"
if [ ${#ARCHS[@]} -gt 1 ]; then
  lipo -create "${ARCHS[@]}" -output "$LIB"
else
  cp "${ARCHS[0]}" "$LIB"
fi

# --- 2. compile the extension ------------------------------------------------
echo "==> Compiling NotesageShare"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
mkdir -p "$APPEX/Contents/MacOS"

# `-e _NSExtensionMain` is load-bearing and easy to miss.
#
# An app extension has no `main`. Its entry point is `NSExtensionMain`, which
# instantiates the `NSExtensionPrincipalClass` named in Info.plist
# (NotesageShare.ShareViewController). Xcode passes this for extension targets
# automatically; a hand-rolled `swiftc` does not, and defaults to linking an
# executable — which fails with:
#
#     Undefined symbols for architecture arm64:
#       "_main", referenced from:
#
# That is exactly how the first real run of this script failed, in the v0.52.0
# release. `-application-extension` alone does NOT supply it: that flag governs
# API availability checking, not the entry point.
#
# The deployment target matches the app's `minimumSystemVersion` (14.0) rather
# than an arbitrary 11.0. The Rust staticlib is built at 14.0 too, so a lower
# value here produced ~50 "object file was built for newer macOS version"
# warnings that buried the real error in the log.
xcrun swiftc \
  -sdk "$SDK" \
  -target arm64-apple-macos14.0 \
  -swift-version 5 \
  -module-name NotesageShare \
  -application-extension \
  -Xlinker -e -Xlinker _NSExtensionMain \
  -import-objc-header "$REPO/src-tauri/ios/NotesageCapture.h" \
  -O \
  "$SRC"/*.swift \
  "$LIB" \
  -o "$APPEX/Contents/MacOS/NotesageShare"

# Assert the entry point, rather than assume the flags above did their job.
#
# The failure this catches is silent in the worst way: a Share Extension that
# builds but has the wrong entry point does not crash, it simply never appears
# in the Share menu — indistinguishable from not having been built. Checking
# the produced binary costs milliseconds and turns that into a build error.
BIN="$APPEX/Contents/MacOS/NotesageShare"
nm -u "$BIN" 2>/dev/null | grep -q "_NSExtensionMain" \
  || { echo "Linked binary does not reference _NSExtensionMain — an extension needs it as its entry point (-Xlinker -e -Xlinker _NSExtensionMain)"; exit 1; }

cp "$SRC/ShareExtension-Info.plist" "$APPEX/Contents/Info.plist"

# NO principal-class check here, deliberately. One was added and removed the
# same day, having blocked a release on a false positive.
#
# It asserted that the class named by `NSExtensionPrincipalClass` appeared in
# `nm` output. That passed locally and failed in CI, because the class symbol
# (`_OBJC_CLASS_$__TtC13NotesageShare19ShareViewController`) is NON-EXTERNAL —
# a local symbol, which `strip` removes. Measured:
#
#     before strip:  6 matches      after strip -x:  0 matches
#     _NSExtensionMain (undefined):  survives, as it must for dynamic linking
#
# So the check measured whether the binary had been stripped, not whether the
# class was present. The ObjC runtime resolves the principal class through
# `__objc_classlist` metadata, which stripping does not touch — a stripped
# extension works perfectly.
#
# The entry-point check above is sound for the opposite reason: an undefined
# symbol has to survive, or nothing could link it. If you want to verify the
# principal class, do it by loading the extension, not by reading symbols.

# --- 3. sign, inside out -----------------------------------------------------
#
# Nested code signs first. Signing the app before its extension leaves the app
# claiming a seal that no longer matches its contents, and the extension simply
# never loads — with no error anyone sees.
if [ -n "$IDENTITY" ]; then
  echo "==> Signing extension then app as: $IDENTITY"
  codesign --force --timestamp --options runtime \
    --entitlements "$SRC/ShareExtension.entitlements" \
    --sign "$IDENTITY" "$APPEX"
  codesign --force --timestamp --options runtime \
    --entitlements "$REPO/src-tauri/Entitlements.plist" \
    --sign "$IDENTITY" "$APP"

  # Verify rather than trust. A share extension that fails to load produces no
  # error, no crash and no log the user will find — it is simply absent from
  # the Share menu, which is indistinguishable from never having been built.
  echo "==> Verifying"
  codesign --verify --deep --strict --verbose=2 "$APP"
else
  echo "==> No signing identity — bundle assembled UNSIGNED (local build only)."
  echo "    macOS will not load an unsigned extension; set APPLE_SIGNING_IDENTITY."
fi

echo "==> Embedded: $APPEX"
