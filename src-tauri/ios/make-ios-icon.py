#!/usr/bin/env python3
"""Regenerate the iOS app icon set from the desktop master icon.

iOS app icons must be full-bleed opaque squares — iOS applies its own
superellipse mask and rejects/black-fills transparency. The desktop master
(`src-tauri/icons/icon.png`) is a rounded-rect with transparent corners and a
subtle vertical gradient, so neither using it directly (black corners) nor a
flat `--ios-color` fill (visible corner slivers where the fill meets the
gradient) looks right.

This script edge-bleeds the master — every transparent pixel takes the color
of the nearest opaque pixel in its row (or column for the top/bottom margins)
— so the gradient extends seamlessly to the edges, then runs `tauri icon` on
the result and installs the iOS set into `src-tauri/icons/ios/` and, when the
generated Xcode project exists, `gen/apple/Assets.xcassets/AppIcon.appiconset/`.

Usage:  python3 src-tauri/ios/make-ios-icon.py     (requires Pillow)
"""

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent.parent
MASTER = REPO / "src-tauri" / "icons" / "icon.png"
IOS_ICONS = REPO / "src-tauri" / "icons" / "ios"
GEN_APPICONSET = REPO / "src-tauri" / "gen" / "apple" / "Assets.xcassets" / "AppIcon.appiconset"


def edge_bleed(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()

    spans = {}
    for y in range(h):
        row = [x for x in range(w) if px[x, y][3] > 200]
        if row:
            l, r = row[0], row[-1]
            spans[y] = (l, r)
            lc, rc = px[l, y][:3] + (255,), px[r, y][:3] + (255,)
            for x in range(0, l):
                px[x, y] = lc
            for x in range(r + 1, w):
                px[x, y] = rc

    ys = sorted(spans)
    top, bot = ys[0], ys[-1]
    for y in range(0, top):
        for x in range(w):
            px[x, y] = px[x, top]
    for y in range(bot + 1, h):
        for x in range(w):
            px[x, y] = px[x, bot]
    return im.convert("RGB")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        master = Path(tmp) / "ios-master.png"
        edge_bleed(Image.open(MASTER)).save(master)
        out = Path(tmp) / "out"
        subprocess.run(
            ["npx", "tauri", "icon", str(master), "-o", str(out)],
            cwd=REPO, check=True, capture_output=True,
        )
        for f in (out / "ios").iterdir():
            shutil.copy(f, IOS_ICONS / f.name)
            if GEN_APPICONSET.is_dir():
                shutil.copy(f, GEN_APPICONSET / f.name)
    print(f"iOS icon set regenerated into {IOS_ICONS.relative_to(REPO)}"
          + (" and gen/apple" if GEN_APPICONSET.is_dir() else ""))


if __name__ == "__main__":
    main()
