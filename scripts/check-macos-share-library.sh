#!/usr/bin/env bash
# Run the macOS Share Extension's library-validity rule against real paths.
# See the header of check-macos-share-library.swift for why.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
xcrun swiftc -sdk "$SDK" -target arm64-apple-macos13.0 \
  -o "$OUT/check" \
  "$REPO/src-tauri/macos/ShareLibraryAccess.swift" \
  "$REPO/scripts/macos-share-library-check/main.swift"
"$OUT/check"
