#!/usr/bin/env bash
# setup.sh - Verify that the `lit` CLI and optional converters are installed.
# Usage: setup.sh

set -euo pipefail

missing=()

if ! command -v lit >/dev/null 2>&1; then
  missing+=("lit")
fi

if [ ${#missing[@]} -gt 0 ]; then
  cat >&2 <<'EOF'
Error: The `lit` CLI from LlamaIndex liteparse is required but was not found on PATH.

Install one of the following:

  Homebrew (macOS / Linux):
    brew install llamaindex-liteparse

  npm (global):
    npm install -g @llamaindex/liteparse

After installation, re-run this skill. The `lit` binary must be reachable from the shell Notesage launches scripts in.

Optional dependencies (install only if you need non-PDF formats):
  - LibreOffice   -> required for .doc/.docx/.ppt/.pptx/.xls/.xlsx
  - ImageMagick   -> required for .jpg/.png/.gif/.bmp/.tiff/.webp/.svg
EOF
  exit 1
fi

lit_version=$(lit --version 2>/dev/null || echo "unknown")

libreoffice_status="missing"
if command -v soffice >/dev/null 2>&1 || command -v libreoffice >/dev/null 2>&1; then
  libreoffice_status="installed"
fi

imagemagick_status="missing"
if command -v magick >/dev/null 2>&1 || command -v convert >/dev/null 2>&1; then
  imagemagick_status="installed"
fi

printf '{"lit":"%s","libreoffice":"%s","imagemagick":"%s","status":"ready"}\n' \
  "$lit_version" "$libreoffice_status" "$imagemagick_status"
