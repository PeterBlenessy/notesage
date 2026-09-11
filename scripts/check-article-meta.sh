#!/usr/bin/env bash
# Run the saved-article row's logic — reading line, JSON decode, candidacy,
# fallback title — on macOS. See the header of
# scripts/article-meta-check/main.swift for what is and is not covered here.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
xcrun swiftc -sdk "$SDK" -target arm64-apple-macos13.0 \
  -o "$OUT/check" \
  "$REPO/src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/ArticleMeta.swift" \
  "$REPO/scripts/article-meta-check/main.swift"
"$OUT/check"
