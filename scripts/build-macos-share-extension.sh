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

xcrun swiftc \
  -sdk "$SDK" \
  -target arm64-apple-macos11.0 \
  -swift-version 5 \
  -module-name NotesageShare \
  -application-extension \
  -import-objc-header "$REPO/src-tauri/ios/NotesageCapture.h" \
  -O \
  "$SRC"/*.swift \
  "$LIB" \
  -o "$APPEX/Contents/MacOS/NotesageShare"

cp "$SRC/ShareExtension-Info.plist" "$APPEX/Contents/Info.plist"

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
