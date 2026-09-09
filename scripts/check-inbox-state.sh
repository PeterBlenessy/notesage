#!/usr/bin/env bash
# Run InboxState's badge logic against a real filesystem. See the header of
# scripts/inbox-state-check/main.swift for why this is not an XCTest target.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
xcrun swiftc -sdk "$SDK" -target arm64-apple-macos13.0 \
  -o "$OUT/check" \
  "$REPO/src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/InboxState.swift" \
  "$REPO/scripts/inbox-state-check/main.swift"
"$OUT/check"
