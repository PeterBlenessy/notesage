#!/usr/bin/env bash
# parse.sh - Parse a document into markdown/text/JSON via `lit parse`.
# Usage: parse.sh <input_path> <output_path> [--format "markdown"] [--no-ocr] [--ocr-language "eng"] [--password "secret"] [--force]
#
# Outputs JSON to stdout: { file, format, pages, bytes, ocrUsed, status }
# status: "created", "exists", or "overwritten"
# Errors go to stderr with non-zero exit code.

set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: parse.sh <input_path> <output_path> [--format FMT] [--no-ocr] [--ocr-language LANG] [--password PW] [--force]" >&2
  exit 64
fi

input="$1"
output="$2"
shift 2

format="markdown"
ocr=true
ocr_language=""
password=""
force=false

while [ $# -gt 0 ]; do
  case "$1" in
    --format)         format="${2:?--format requires a value}"; shift 2 ;;
    --no-ocr)         ocr=false; shift ;;
    --ocr-language)   ocr_language="${2:?--ocr-language requires a value}"; shift 2 ;;
    --password)       password="${2:?--password requires a value}"; shift 2 ;;
    --force)          force=true; shift ;;
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

if [ -e "$output" ] && [ "$force" = false ]; then
  size=$(wc -c <"$output" | tr -d ' ')
  printf '{"file":"%s","format":"%s","pages":0,"bytes":%s,"ocrUsed":false,"status":"exists"}\n' \
    "$output" "$format" "$size"
  exit 0
fi

existed=false
[ -e "$output" ] && existed=true

mkdir -p "$(dirname "$output")"

args=(parse "$input" --format "$format" -o "$output")
if [ "$ocr" = false ]; then
  args+=(--no-ocr)
fi
if [ -n "$ocr_language" ]; then
  args+=(--ocr-language "$ocr_language")
fi
if [ -n "$password" ]; then
  args+=(--password "$password")
fi

if ! lit "${args[@]}" >/dev/null 2>&1; then
  lit "${args[@]}" >&2 || true
  echo "Error: lit parse failed for $input" >&2
  exit 1
fi

if [ ! -f "$output" ]; then
  echo "Error: lit reported success but output file is missing: $output" >&2
  exit 1
fi

bytes=$(wc -c <"$output" | tr -d ' ')

ocr_used="false"
if [ "$ocr" = true ]; then
  ocr_used="true"
fi

status="created"
[ "$existed" = true ] && status="overwritten"

printf '{"file":"%s","format":"%s","bytes":%s,"ocrUsed":%s,"status":"%s"}\n' \
  "$output" "$format" "$bytes" "$ocr_used" "$status"
