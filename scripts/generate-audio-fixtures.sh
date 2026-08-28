#!/usr/bin/env bash
# Regenerate the audio decode fixtures (#803).
#
# Committed rather than generated at test time because encoding AAC needs an
# encoder, and a test that silently skips when one is missing is a test that
# reports success for coverage it never had. They are a few KB each — a 0.4 s
# tone, which is all a decoder test needs.
#
# `afconvert` ships with macOS, so this is reproducible on any dev machine and
# on the CI runner, without adding a build dependency to do it.
#
#   ./scripts/generate-audio-fixtures.sh
set -euo pipefail

OUT="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/tests/fixtures/audio"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

python3 - "$TMP/tone.wav" <<'PY'
import math, struct, sys, wave
# 440 Hz, 0.4 s, 16 kHz mono, 16-bit. A pure tone is easy to assert on: any
# decoder that works produces a signal whose peak is near 0.4 and whose sample
# count is 6400, so a test does not need a reference decoder to check against.
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(b"".join(
        struct.pack("<h", int(0.4 * 32767 * math.sin(2 * math.pi * 440 * i / 16000)))
        for i in range(6400)))
PY

cp "$TMP/tone.wav" "$OUT/tone.wav"
# AAC in an MP4 container — what an iPhone Voice Memo is, and the single most
# likely real input.
afconvert -f m4af -d aac  "$TMP/tone.wav" "$OUT/tone.m4a"
# Core Audio Format, which `classifyFile` already lists as shareable.
afconvert -f caff -d LEI16 "$TMP/tone.wav" "$OUT/tone.caf"

ls -l "$OUT"
