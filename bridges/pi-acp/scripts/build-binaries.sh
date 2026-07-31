#!/usr/bin/env bash
# Compile notesage-acp-pi into self-contained platform binaries (task #12).
# Same technique pi itself uses: `bun build --compile`. Produces
#   dist/notesage-acp-pi-<triple>.tar.gz  (single executable at tar root)
#   dist/SHA256SUMS
# Usage: scripts/build-binaries.sh [target ...]
#   Default targets: all four release platforms. Pass a single Bun target
#   (e.g. bun-linux-x64) for a local smoke build.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"
command -v bun >/dev/null || { echo "ERROR: bun is required (used only at build time)"; exit 1; }

# Bun target → release-asset triple (matches the Rust-triple naming used for
# Goose/pi assets so agent_manager.rs asset resolution stays uniform).
declare -A TRIPLES=(
  [bun-darwin-arm64]="aarch64-apple-darwin"
  [bun-darwin-x64]="x86_64-apple-darwin"
  [bun-linux-x64]="x86_64-unknown-linux-gnu"
  [bun-linux-arm64]="aarch64-unknown-linux-gnu"
)

TARGETS=("$@")
[[ ${#TARGETS[@]} -gt 0 ]] || TARGETS=(bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-linux-arm64)

rm -rf dist && mkdir -p dist
for target in "${TARGETS[@]}"; do
  triple="${TRIPLES[$target]:-}"
  [[ -n "$triple" ]] || { echo "ERROR: unknown target $target"; exit 1; }
  out="dist/notesage-acp-pi-$triple"
  echo "== $target → $out"
  bun build --compile --target="$target" src/index.ts --outfile "$out"
  tar -C dist -czf "$out.tar.gz" "notesage-acp-pi-$triple"
  rm -f "$out"
done

# Scoped checksum asset name — this lands on the shared Notesage app release,
# so a bare "SHA256SUMS" could collide with future checksummed assets.
# agent_manager.rs (task #15) configures this exact name as checksum_asset.
SUMS="notesage-acp-pi-SHA256SUMS"
(cd dist && shasum -a 256 ./*.tar.gz | sed 's|\./||' > "$SUMS") 2>/dev/null \
  || (cd dist && sha256sum ./*.tar.gz | sed 's|\./||' > "$SUMS")
echo "== dist/:" && ls -la dist && cat "dist/$SUMS"
