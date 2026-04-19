#!/usr/bin/env bash
# screenshot.sh - Render PDF pages as images via `lit screenshot`.
# Usage: screenshot.sh <input_path> <output_dir> [--target-pages "1-5"] [--dpi "150"] [--format "png"]
#
# Outputs JSON to stdout: { dir, pages: [{ page, file }], status }
# Errors go to stderr with non-zero exit code.

set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: screenshot.sh <input_path> <output_dir> [--target-pages RANGE] [--dpi N] [--format png|jpg]" >&2
  exit 64
fi

input="$1"
output_dir="$2"
shift 2

target_pages="all"
dpi="150"
format="png"

while [ $# -gt 0 ]; do
  case "$1" in
    --target-pages)   target_pages="${2:?--target-pages requires a value}"; shift 2 ;;
    --dpi)            dpi="${2:?--dpi requires a value}"; shift 2 ;;
    --format)         format="${2:?--format requires a value}"; shift 2 ;;
    *)                echo "Unknown flag: $1" >&2; exit 64 ;;
  esac
done

if [ ! -f "$input" ]; then
  echo "Error: input file does not exist: $input" >&2
  exit 66
fi

if ! command -v lit >/dev/null 2>&1; then
  echo "Error: lit CLI not found. Run setup.sh first." >&2
  exit 127
fi

mkdir -p "$output_dir"

args=(screenshot "$input" --target-pages "$target_pages" --dpi "$dpi" --format "$format" -o "$output_dir")

if ! lit "${args[@]}" >/dev/null 2>&1; then
  lit "${args[@]}" >&2 || true
  echo "Error: lit screenshot failed for $input" >&2
  exit 1
fi

python3 - "$output_dir" "$format" <<'PY'
import json
import os
import re
import sys

out_dir, fmt = sys.argv[1], sys.argv[2]
entries = []
pat = re.compile(r"(\d+)")
for name in sorted(os.listdir(out_dir)):
    if not name.lower().endswith("." + fmt.lower()):
        continue
    m = pat.search(name)
    if not m:
        continue
    entries.append({"page": int(m.group(1)), "file": os.path.join(out_dir, name)})

entries.sort(key=lambda e: e["page"])
print(json.dumps({"dir": out_dir, "pages": entries, "status": "created"}))
PY
