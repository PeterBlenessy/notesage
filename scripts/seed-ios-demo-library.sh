#!/usr/bin/env bash
# Seed a simulator's GRANTED Notesage library with the demo content used for
# marketing screenshots, backing up whatever was there.
#
# Everything written comes from content/demo (notes, shared with the desktop
# screenshots) and content/demo-ios (saved articles, written for this purpose).
# All of it is FICTIONAL — no real publications, people or URLs — because these
# end up in the App Store listing and on the website. Never shoot a screenshot
# of a real library, and never of a real publisher's article.
#
# The app reaches its library through a security-scoped bookmark, so a new
# folder cannot simply be pointed at: either drive the folder picker, or write
# into the folder already granted. This does the latter, and keeps a backup so
# the test library comes back.
#
#   scripts/seed-ios-demo-library.sh --list <UDID>            # candidate libraries
#   scripts/seed-ios-demo-library.sh <UDID> <library-path>    # seed (backs up first)
#   scripts/seed-ios-demo-library.sh --restore <library-path> # put the backup back
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" = "--list" ]; then
  DEV="$HOME/Library/Developer/CoreSimulator/Devices/${2:?udid}/data"
  find "$DEV/Containers/Shared/AppGroup" -maxdepth 3 -type d -name "*" 2>/dev/null \
    | grep "File Provider Storage/" | grep -v "/File Provider Storage$" | sort
  exit 0
fi

if [ "${1:-}" = "--restore" ]; then
  LIB="${2:?library path}"
  [ -d "$LIB.backup" ] || { echo "no backup at $LIB.backup" >&2; exit 1; }
  rm -rf "$LIB"; mv "$LIB.backup" "$LIB"
  echo "restored $LIB"; exit 0
fi

UDID="${1:?usage: seed-ios-demo-library.sh <UDID> <library-path>}"
LIB="${2:?pass the granted library path — see --list}"
[ -d "$LIB" ] || { echo "no such library: $LIB" >&2; exit 1; }

[ -d "$LIB.backup" ] || { cp -R "$LIB" "$LIB.backup"; echo "backed up → $LIB.backup"; }

# Keep the app's own sidecars; replace the visible content.
find "$LIB" -mindepth 1 -maxdepth 1 ! -name ".notesage" -exec rm -rf {} +
mkdir -p "$LIB/Inbox" "$LIB/Recordings"

for d in Essays Research Drafts Guides Data Slides; do
  [ -d "$REPO/content/demo/$d" ] && cp -R "$REPO/content/demo/$d" "$LIB/"
done
cp "$REPO/content/demo/Prompt library.md" "$LIB/"
cp "$REPO"/content/demo-ios/Inbox/*.html "$LIB/Inbox/"
# One note among the articles, so the Inbox reads like a real read-later pile
# rather than a wall of identical article rows.
cp "$REPO/content/demo/Drafts/Weekly Review.md" "$LIB/Inbox/"

# The two sidecars the desktop writes. Both drive visible state on the folder
# screen — the Pinned group and the progress rings — so a library without them
# photographs as one nobody has ever opened. Formats are defined by
# `src/lib/pins-file.ts` and `src/lib/reading-progress-file.ts`; the native
# reader read both with the wrong key until 2026-09-12, which is exactly the
# kind of thing a seeded library makes visible.
mkdir -p "$LIB/.notesage" "$LIB/Inbox/.notesage"
cat > "$LIB/.notesage/pins.json" <<'JSON'
{
  "paths": [
    "Inbox/2026-09-11-131000-everything-is-a-draft.html",
    "Essays"
  ]
}
JSON
cat > "$LIB/Inbox/.notesage/reading-progress.json" <<'JSON'
{
  "version": 2,
  "items": {
    "2026-08-19-091500-reading-on-purpose.html": {
      "fraction": 1,
      "openedAt": "2026-08-19T10:02:00.000Z",
      "updatedAt": "2026-08-19T10:14:00.000Z"
    },
    "2026-08-21-183000-the-quiet-hours.html": {
      "fraction": 1,
      "openedAt": "2026-08-22T09:12:00.000Z",
      "updatedAt": "2026-08-22T09:31:00.000Z"
    },
    "2026-08-24-074500-notes-that-answer-back.html": {
      "fraction": 0.38,
      "openedAt": "2026-08-25T07:40:00.000Z",
      "updatedAt": "2026-08-25T07:46:00.000Z"
    },
    "2026-08-29-113000-what-a-library-is-for.html": {
      "fraction": 0.62,
      "openedAt": "2026-09-01T20:10:00.000Z",
      "updatedAt": "2026-09-01T20:18:00.000Z"
    },
    "2026-09-03-192000-small-tools-sharp-edges.html": {
      "fraction": 0.14,
      "openedAt": "2026-09-04T06:55:00.000Z",
      "updatedAt": "2026-09-04T06:58:00.000Z"
    },
    "2026-09-06-144500-how-to-keep-a-commonplace-book.html": {
      "fraction": 0.81,
      "openedAt": "2026-09-08T21:05:00.000Z",
      "updatedAt": "2026-09-08T21:22:00.000Z"
    }
  }
}
JSON

# Home: which root folders the first screen shows (`src/lib/home-file.ts`).
# Without this the file is absent, Home falls back to the Inbox alone, and the
# lead marketing screenshot is three rows on black. The folders chosen are the
# ones with the most photogenic content.
cat > "$LIB/.notesage/home.json" <<'JSON'
{
  "version": 1,
  "folders": [
    "Essays",
    "Research",
    "Guides"
  ]
}
JSON

# Per-folder appearance, set on the desktop and read on the phone (#140).
# Icon names come from the desktop's curated set and colour is an index into
# the eight tag colours — both listed in `LibraryOrdering.swift`. Seeding them
# is not decoration: the folder cards photograph as grey rectangles otherwise,
# and it is the only way the screenshots exercise the mapping at all.
seed_appearance() {  # <folder> <icon> <color index>
  [ -d "$LIB/$1" ] || return 0
  mkdir -p "$LIB/$1/.notesage"
  cat > "$LIB/$1/.notesage/project.json" <<JSON
{
  "appearance": {
    "iconName": "$2",
    "colorIndex": $3
  }
}
JSON
}
seed_appearance Essays BookOpen 6
seed_appearance Research Lightbulb 4
seed_appearance Guides Compass 1

# Modification dates. Every file otherwise carries the moment the seed ran,
# which makes "Date modified" a random order and collapses "Group by date"
# into one bucket called RECENTLY CHANGED — a library nobody has ever used
# twice. The captures take their dates from their own filenames; the notes get
# spread over the same weeks so the two kinds interleave.
set_mtime() {  # <file> <YYYYMMDDhhmm>
  touch -t "$2" "$1"
}
for f in "$LIB"/Inbox/*.html; do
  b="$(basename "$f")"                       # 2026-08-19-091500-slug.html
  set_mtime "$f" "${b:0:4}${b:5:2}${b:8:2}${b:11:2}${b:13:2}"
done
set_mtime "$LIB/Inbox/Weekly Review.md"        202609120830
set_mtime "$LIB/Essays/On Attention.md"        202608260945
set_mtime "$LIB/Essays/Notes on Craft.md"      202609081410
set_mtime "$LIB/Research/Attention and Devotion.md" 202609031120
set_mtime "$LIB/Guides/Formatting.md"          202608201600
set_mtime "$LIB/Drafts/Weekly Review.md"       202609120830
set_mtime "$LIB/Data/Quarterly review.md"      202608281030
set_mtime "$LIB/Prompt library.md"             202609101715
set_mtime "$LIB/Slides/Sample deck.pptx"       202608221300

echo "seeded $LIB"
find "$LIB" -type f ! -path "*/.notesage/*" | sed "s|$LIB/|  |" | sort
