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

# Video containers, for importing a meeting recording (`import_media`). These
# need a video encoder, which macOS does not ship on the command line, so they
# are only regenerated where ffmpeg is installed; the committed files are used
# otherwise.
if command -v ffmpeg >/dev/null 2>&1; then
  # What Teams and Zoom write: H.264 video beside 48 kHz stereo AAC, 2 s.
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=black:s=64x64:r=2:d=2" \
    -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=2" \
    -filter_complex "[1:a]volume=4.0,pan=stereo|c0=c0|c1=c0[a]" -map 0:v -map "[a]" \
    -c:v libx264 -pix_fmt yuv420p -preset veryslow -crf 40 -c:a aac -b:a 64k -ac 2 -shortest \
    "$OUT/meeting-video-aac-48k-stereo.mp4"
  # A screen recording with no sound: the "no audio track" error case.
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=black:s=64x64:r=2:d=2" \
    -c:v libx264 -pix_fmt yuv420p -preset veryslow -crf 40 -an \
    "$OUT/video-without-audio.mp4"
  # Opus in WebM: a container the built-in decoder does not read.
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=1" \
    -c:a libopus -b:a 24k "$OUT/tone-opus.webm"
fi

ls -l "$OUT"
