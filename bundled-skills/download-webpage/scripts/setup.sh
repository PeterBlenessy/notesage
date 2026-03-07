#!/usr/bin/env bash
# setup.sh — Install npm dependencies for download-webpage skill
# Usage: setup.sh <skill_scripts_dir>

set -euo pipefail

SCRIPTS_DIR="${1:?Usage: setup.sh <skill_scripts_dir>}"

cd "$SCRIPTS_DIR"

if [ -d "node_modules" ]; then
  echo "Dependencies already installed"
  exit 0
fi

if ! command -v npm &>/dev/null; then
  echo "Error: npm is required but not installed" >&2
  exit 1
fi

npm install --no-fund --no-audit --loglevel=error 2>&1
echo "Dependencies installed successfully"
