#!/bin/bash
# Download pre-built llama-server binary + shared libraries (arm64) from llama.cpp GitHub releases.
# Usage: ./scripts/download-llama-server.sh [version]
# Example: ./scripts/download-llama-server.sh b5460

set -euo pipefail

VERSION="${1:-b5460}"
BINARIES_DIR="src-tauri/binaries"

mkdir -p "$BINARIES_DIR"

echo "Downloading llama-server ${VERSION} (macOS arm64)..."

URL="https://github.com/ggml-org/llama.cpp/releases/download/${VERSION}/llama-${VERSION}-bin-macos-arm64.zip"
curl -L -o /tmp/llama-macos-arm64.zip "$URL"

# Extract to temp dir
rm -rf /tmp/llama-arm64
mkdir -p /tmp/llama-arm64
unzip -o /tmp/llama-macos-arm64.zip -d /tmp/llama-arm64

# Find and copy llama-server binary
LLAMA_SERVER=$(find /tmp/llama-arm64 -name "llama-server" -type f | head -1)
if [ -z "$LLAMA_SERVER" ]; then
  echo "ERROR: llama-server not found in archive"
  exit 1
fi
cp "$LLAMA_SERVER" "$BINARIES_DIR/llama-server-aarch64-apple-darwin"
chmod +x "$BINARIES_DIR/llama-server-aarch64-apple-darwin"

# Find and copy all .dylib files (libllama, libggml, etc.) into lib/ next to binary
LIB_DIR="$BINARIES_DIR/lib"
mkdir -p "$LIB_DIR"
find /tmp/llama-arm64 -name "*.dylib" -type f -exec cp {} "$LIB_DIR/" \;

# Copy Metal shader and header files needed for GPU acceleration
find /tmp/llama-arm64 -name "*.metal" -type f -exec cp {} "$LIB_DIR/" \;
find /tmp/llama-arm64 -name "ggml-metal-impl.h" -type f -exec cp {} "$LIB_DIR/" \;
find /tmp/llama-arm64 -name "ggml-common.h" -type f -exec cp {} "$LIB_DIR/" \;

# Fix rpaths so binary finds dylibs in lib/ relative to itself
install_name_tool -add_rpath @executable_path/lib "$BINARIES_DIR/llama-server-aarch64-apple-darwin" 2>/dev/null || true

rm -rf /tmp/llama-macos-arm64.zip /tmp/llama-arm64

echo "Done!"
echo "Binary:"
ls -lh "$BINARIES_DIR"/llama-server-*
echo "Libraries:"
ls -lh "$LIB_DIR"/*.dylib 2>/dev/null || echo "  (none found)"
