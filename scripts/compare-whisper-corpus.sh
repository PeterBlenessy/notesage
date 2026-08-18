#!/usr/bin/env bash
#
# Run `compare:whisper` across a whole corpus and aggregate per model (#698).
#
# The single-clip harness answers "what did each model do with THIS audio".
# That is too small a sample to choose a model with: on two or three clips the
# ranking moves depending on which clips you picked. This runs every clip in a
# directory and aggregates, so the comparison is over a corpus rather than an
# anecdote.
#
#   scripts/compare-whisper-corpus.sh tests/fixtures/speech sv-fleurs
#   scripts/compare-whisper-corpus.sh tests/fixtures/speech en-librispeech
#
# The second argument is a filename prefix, so English and Swedish can be
# aggregated separately — mixing them produces a mean that describes no
# language in particular.
#
# ---------------------------------------------------------------------------
# Two things this reports that a mean alone hides
# ---------------------------------------------------------------------------
#
# **Worst clip.** Whisper's failure mode is not gentle degradation, it is
# hallucination: on near-silence or a hard accent a model can emit a fluent
# paragraph that was never spoken. One such clip moves a 10-clip mean by tens
# of points, so a model with a good mean and a catastrophic worst case looks
# identical to a uniformly mediocre one. They are not the same choice. When
# `worst` sits far above `mean`, read that clip's transcript before believing
# the mean.
#
# **Median.** Same reason, from the other side: when median and mean diverge,
# the mean is being dragged by outliers rather than describing typical output.
#
# ---------------------------------------------------------------------------
# Why it refuses to run on a busy machine
# ---------------------------------------------------------------------------
#
# Transcription time is the whole point of the timing column, and it is only
# meaningful if each model got a comparable share of the CPU. A run competing
# with a build, a training job, or a security scan produces timings that
# describe the contention, not the models — and because the contention varies
# through the run, it does not even do so consistently.
#
# So the run is gated on sustained load, sampled over half a minute rather than
# taken as one snapshot: background work is bursty, and an instantaneous dip
# means nothing about the next twenty minutes. Override with FORCE=1 when you
# only care about accuracy and are willing to discard the timings.
set -euo pipefail

DIR="${1:-tests/fixtures/speech}"
PREFIX="${2:-}"
CORES="$(sysctl -n hw.ncpu 2>/dev/null || nproc)"

# `pnpm compare:whisper` runs with cwd=src-tauri (see package.json), so every
# path handed to it has to be absolute.
abspath() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *)  printf '%s/%s' "$PWD" "$1" ;;
  esac
}

# Per-core load. Above this, timings stop being comparable between models.
THRESHOLD="${LOAD_THRESHOLD:-0.6}"

# --- load gate -------------------------------------------------------------
if [ "${FORCE:-0}" != "1" ]; then
  echo "Checking the machine is idle enough for timings to mean anything…"
  worst=0
  for i in 1 2 3; do
    load="$(uptime | sed -E 's/.*load averages?: *([0-9.]+).*/\1/')"
    per_core="$(awk -v l="$load" -v c="$CORES" 'BEGIN { printf "%.2f", l / c }')"
    echo "  sample $i/3: load ${load} on ${CORES} cores = ${per_core} per core"
    worst="$(awk -v a="$worst" -v b="$per_core" 'BEGIN { print (b > a ? b : a) }')"
    [ "$i" -lt 3 ] && sleep 15
  done
  if awk -v w="$worst" -v t="$THRESHOLD" 'BEGIN { exit !(w > t) }'; then
    echo
    echo "Machine is busy (peak ${worst} per core, threshold ${THRESHOLD})."
    echo "Timings from this run would measure the contention, not the models."
    echo "Busiest processes:"
    ps -A -o %cpu,comm | sort -rn | head -5 | sed 's/^/  /'
    echo
    echo "Wait for it to settle, or FORCE=1 to run anyway (accuracy only)."
    exit 1
  fi
  echo "OK — peak ${worst} per core."
  echo
fi

# --- run every clip --------------------------------------------------------
shopt -s nullglob
clips=("$DIR/${PREFIX}"*.wav)
[ ${#clips[@]} -eq 0 ] && { echo "No clips matching $DIR/${PREFIX}*.wav"; exit 1; }

raw="$(mktemp)"
trap 'rm -f "$raw"' EXIT

for wav in "${clips[@]}"; do
  ref="${wav%.wav}.txt"
  # Timings-only clips (no reference transcript) can't contribute to WER, and
  # a corpus mean is the one number here worth trusting. Skip rather than
  # silently average an unmeasured clip in as zero.
  [ -f "$ref" ] || { echo "skip $(basename "$wav") — no reference transcript"; continue; }
  echo "→ $(basename "$wav")"
  # Absolute paths: `pnpm compare:whisper` cds into src-tauri/ before running
  # cargo, so a repo-relative path resolves against the wrong directory and the
  # harness exits with "No such file" — for every clip, silently, because
  # stderr is dropped. The aggregate then reports nothing at all.
  pnpm -s compare:whisper "$(abspath "$wav")" "$(abspath "$ref")" 2>/dev/null >>"$raw" || true
done

# --- aggregate -------------------------------------------------------------
#
# The harness prints one table row per model:
#     large-v3-turbo     1.2s     10.4s      1.8GB      sv    10.6%
# Strip each field's unit suffix INDIVIDUALLY. An earlier version of this
# script stripped `[s%GB]` from the whole line, which silently ate letters out
# of the model names — "small" became "mall", "base" became "bae" — while the
# numbers parsed fine, so the corruption was easy to miss in a plausible table.
awk '
  NF == 6 && $6 ~ /%$/ && $3 ~ /s$/ {
    name = $1
    t = $3; sub(/s$/,  "", t)
    r = $4; sub(/GB$/, "", r)
    w = $6; sub(/%$/,  "", w)

    n[name]++
    wer[name]  += w
    secs[name] += t
    if (r > ram[name])   ram[name]  = r
    if (w > worst[name]) worst[name] = w
    all[name] = all[name] " " w        # kept for the median
  }
  END {
    printf "%-24s %8s %8s %8s %9s %8s %6s\n",
           "model", "mean WER", "median", "worst", "mean time", "peak RAM", "clips"
    printf "%s\n", "----------------------------------------------------------------------------"
    for (m in n) {
      # Median: sort this model'"'"'s WERs with a plain insertion sort — the
      # corpus is tens of clips, so clarity beats cleverness here.
      c = split(all[m], v, " ")
      for (i = 2; i <= c; i++) {
        key = v[i]; j = i - 1
        while (j > 0 && v[j] > key) { v[j+1] = v[j]; j-- }
        v[j+1] = key
      }
      med = (c % 2) ? v[(c+1)/2] : (v[c/2] + v[c/2+1]) / 2

      printf "%-24s %7.1f%% %7.1f%% %7.1f%% %8.1fs %8.1fGB %6d\n",
             m, wer[m]/n[m], med, worst[m], secs[m]/n[m], ram[m], n[m] | "sort -k2 -n"
    }
  }
' "$raw"

echo
echo "Read 'worst' before 'mean WER': a model that hallucinates on one clip and"
echo "is excellent on the rest averages the same as one that is mediocre"
echo "throughout, and they are not the same choice."
