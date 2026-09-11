#!/usr/bin/env bash
# Run the folder ordering — sort and the five grouping modes — on macOS.
# See the header of scripts/library-ordering-check/main.swift for why this is
# not an XCTest target, and why the logic lives in a UIKit-free file.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
xcrun swiftc -sdk "$SDK" -target arm64-apple-macos13.0 \
  -o "$OUT/check" \
  "$REPO/src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/LibraryOrdering.swift" \
  "$REPO/scripts/library-ordering-check/main.swift"
"$OUT/check"
