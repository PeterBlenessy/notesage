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

echo "seeded $LIB"
find "$LIB" -type f ! -path "*/.notesage/*" | sed "s|$LIB/|  |" | sort
