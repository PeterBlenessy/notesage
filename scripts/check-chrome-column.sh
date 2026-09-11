#!/usr/bin/env bash
# Run the bottom-centre column's stacking arithmetic. See the header of
# scripts/chrome-column-check/main.swift for why this is not an XCTest target,
# and why the arithmetic lives in a file of its own.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
xcrun swiftc -sdk "$SDK" -target arm64-apple-macos13.0 \
  -o "$OUT/check" \
  "$REPO/src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/ChromeColumn.swift" \
  "$REPO/scripts/chrome-column-check/main.swift"
"$OUT/check"
