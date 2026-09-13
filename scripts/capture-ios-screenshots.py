#!/usr/bin/env python3
"""Marketing screenshots for the iOS app (#593).

Drives a booted simulator through a fixed set of poses and writes PNGs at the
device's native size — so a re-shoot after any UI change is one command rather
than an afternoon of tapping.

Apple wants one set at 6.9" (1320 x 2868) and derives the smaller sizes from
it; that is an iPhone 17/16 Pro **Max**, not the Pro. The script refuses to
run on anything else rather than quietly producing a set Apple will reject.

Targets are resolved from the accessibility tree (`idb ui describe-all`), never
from screenshot pixels — every one of them, now that Home is native too. Hardcoded coordinates were tried first and were wrong
within one pose: a tap 40pt above the Listen button opened the article
instead, which looks exactly like the Listen bug we shipped in build 43 and
cost twenty minutes to tell apart from one.

Prerequisites, in order:
  1. idb      python3 -m venv /tmp/idbenv && /tmp/idbenv/bin/pip install fb-idb
              (idb_companion comes from brew — see CLAUDE.md)
  2. the app  pnpm tauri ios build --target aarch64-sim
              xcrun simctl install <UDID> <path to Notesage.app>
  3. a grant  the library is reached through a security-scoped bookmark, so a
              folder cannot be pointed at from outside: put the demo library
              under the simulator's "On My iPhone"
                ~/Library/Developer/CoreSimulator/Devices/<UDID>/data/Containers
                  /Shared/AppGroup/<group.com.apple.FileProvider.LocalStorage>
                  /File Provider Storage/Notesage
              (scripts/seed-ios-demo-library.sh writes it), then launch the
              app once and grant that folder in the picker. The picker is a
              separate process and its accessibility tree is NOT visible to
              idb — only the app's own is — so this one step is tapped by
              coordinate or by hand: Choose a folder → Browse → On My iPhone
              → Notesage → Open. The grant survives relaunches, so it is paid
              once per simulator and never again.

Usage:
  scripts/capture-ios-screenshots.py <UDID> [--out DIR] [--lang en|sv]

The language argument sets the DEVICE language and relaunches, because the
App Store listing is per-locale: shoot the set once per language we publish in.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time

IDB = os.environ.get("IDB", "/tmp/idbenv/bin/idb")
APP_ID = "com.notesage.app"
# The 6.9" set Apple asks for. Anything else means the wrong simulator.
REQUIRED_SIZE = (1320, 2868)

LANGS = {
    "en": (["en-US", "en"], "en_US"),
    "sv": (["sv-SE", "sv"], "sv_SE"),
}

# The nav bar's trailing "…" sits this far in from the right edge, in points.
# A pushed screen does not expose it to the accessibility tree, so it has to
# be tapped blind — but DERIVED from the screen width, never hardcoded: a
# fixed 398 is the Pro Max's button and four points from the edge on a 402pt
# phone, which silently taps nothing and reports "the menu did not open".
NAV_TRAILING_INSET = 38
NAV_TRAILING_Y = 84

# The … menu is one ordered list of 250pt-wide buttons, and the order is fixed
# by `EntryContextMenu.swift`. Indexing it is language-independent, which
# matching on "Gallery" / "Galleri" would not be.
MENU_LIST = 0
MENU_GALLERY = 1
MENU_GROUP_PINNED = 6


def sh(*args: str) -> str:
    return subprocess.run(args, capture_output=True, text=True).stdout


def idb(*args: str) -> str:
    env = dict(os.environ, PATH="/opt/homebrew/bin:" + os.environ.get("PATH", ""))
    return subprocess.run(
        [IDB, *args], capture_output=True, text=True, env=env
    ).stdout


class Screen:
    def __init__(self, udid: str, out: str, width: float, height: float) -> None:
        self.udid = udid
        self.out = out
        self.width = width
        self.height = height
        self.shots = 0

    @property
    def nav_trailing(self) -> tuple[float, float]:
        """Where the nav bar's trailing button is on THIS device."""
        return (self.width - NAV_TRAILING_INSET, NAV_TRAILING_Y)

    # -- reading the screen -------------------------------------------------

    def tree(self) -> list[dict]:
        raw = idb("ui", "describe-all", "--udid", self.udid)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return []

    def find(self, label: str, kind: str | None = None) -> dict | None:
        for node in self.tree():
            if node.get("AXLabel") == label and (kind is None or node.get("type") == kind):
                return node
        return None

    def buttons(self, label: str) -> list[dict]:
        return [
            n
            for n in self.tree()
            if n.get("type") == "Button" and n.get("AXLabel") == label
        ]

    def menu_items(self) -> list[dict]:
        """The open … menu's rows, top to bottom.

        On-screen rows only. A dismissed menu can linger in the tree with its
        rows pushed off the bottom, and those look exactly like an open menu
        to a filter that only checks the width — which is how a "gallery" pose
        came back byte-identical to the list pose: the step tapped a row of a
        menu that was no longer there and reported success.
        """
        rows = [
            n
            for n in self.tree()
            if n.get("type") == "Button"
            and 200 < n["frame"]["width"] < 300
            and 0 <= n["frame"]["y"] < self.height
        ]
        return sorted(rows, key=lambda n: n["frame"]["y"])

    def signature(self) -> str:
        """A fingerprint of what is on screen, to tell a step that did
        something from one that only looked like it did.

        The PIXELS, not the accessibility tree: the tree carries transient
        nodes and sub-point coordinates that differ between two reads of an
        identical screen, so comparing it reports a change that did not
        happen — which is the failure this is here to catch.
        """
        probe = os.path.join(self.out, ".sig.png")
        sh("xcrun", "simctl", "io", self.udid, "screenshot", probe)
        try:
            with open(probe, "rb") as fh:
                return hashlib.md5(fh.read()).hexdigest()
        except OSError:
            return ""
        finally:
            if os.path.exists(probe):
                os.remove(probe)

    # -- driving it ---------------------------------------------------------

    def tap_node(self, node: dict, settle: float = 2.0) -> None:
        f = node["frame"]
        self.tap(f["x"] + f["width"] / 2, f["y"] + f["height"] / 2, settle)

    def tap(self, x: float, y: float, settle: float = 2.0) -> None:
        idb("ui", "tap", "--udid", self.udid, f"{x:.0f}", f"{y:.0f}")
        time.sleep(settle)

    def swipe(self, x1: float, y1: float, x2: float, y2: float) -> None:
        # --duration is not optional: without it UIKit sees a tap, not a pan,
        # and a "swipe" across a row opens the document instead.
        idb(
            "ui", "swipe", "--udid", self.udid,
            "--delta", "4", "--duration", "0.45",
            f"{x1:.0f}", f"{y1:.0f}", f"{x2:.0f}", f"{y2:.0f}",
        )
        time.sleep(2)

    def type_(self, text: str) -> None:
        idb("ui", "text", "--udid", self.udid, text)
        time.sleep(2)

    def menu(self, index: int, expect_change: bool = True) -> bool:
        """Open the … menu and choose the row at `index`.

        `expect_change` re-runs the whole thing once when the screen is
        unchanged afterwards. Every row in this menu alters the listing, so
        "nothing happened" means the tap missed, never that the choice was
        already in effect — except for the two idempotent ones the callers
        pass False for.
        """
        before = self.signature() if expect_change else ""
        if self._menu_once(index) and expect_change and self.signature() == before:
            print(f"  … menu row {index} changed nothing — retrying", file=sys.stderr)
            return self._menu_once(index)
        return True

    def _menu_once(self, index: int) -> bool:
        # Home exposes the nav bar's trailing button as "More"; a PUSHED
        # screen exposes neither it nor Back — the same blind spot that makes
        # `back()` tap blind. Returning False here silently meant every menu
        # step on a folder screen did nothing and reported success, which
        # surfaced two layers away as a gallery pose byte-identical to the
        # list pose. Tap the fixed nav-bar position instead: it is placed by
        # the nav shell, not by content.
        more = self.find("More", "Button") or self.find("Mer", "Button")

        def open_menu() -> None:
            if more is not None:
                self.tap_node(more, settle=2.5)
            else:
                self.tap(self.nav_trailing[0], self.nav_trailing[1], settle=2.5)

        # The menu has 17 rows; anything short of that is a tree caught
        # mid-animation, or no menu at all.
        rows = self.menu_items()
        for _ in range(3):
            if len(rows) >= 15:
                break
            open_menu()
            rows = self.menu_items()
        if len(rows) <= index:
            print(f"  ! the … menu did not open (row {index})", file=sys.stderr)
            return False
        self.tap_node(rows[index], settle=3)
        return True

    def at_home(self) -> bool:
        # Home is the only screen with a nav-bar Heading; every pushed screen
        # has a plain title in a Group instead.
        return any(
            n.get("type") == "Heading" and n["frame"]["y"] < 120 for n in self.tree()
        )

    def back(self) -> None:
        """Pop one screen.

        The reader is a separate WKWebView presented above the app's own, and
        its nav bar does not reach the accessibility tree at all — only its
        Search button does. So a labelled Back is used when there is one and
        the nav bar's leading circle is tapped blind when there is not; that
        position is fixed by the nav shell, not by content.
        """
        for label in ("Back", "Tillbaka"):
            node = self.find(label, "Button")
            if node:
                self.tap_node(node, settle=3.5)
                return
        leading = [
            n for n in self.tree()
            if n.get("type") == "Button" and n["frame"]["y"] < 120
            and n["frame"]["x"] < 100
        ]
        if leading:
            self.tap_node(leading[0], settle=3.5)
        else:
            self.tap(40, 88, settle=3.5)

    def clear_search(self) -> None:
        """Empty and dismiss the search field.

        Not cosmetic: the filter is app state that OUTLIVES the run, and it
        applies to Home as well as to a folder. A run that ended on the search
        pose left the next one staring at "Nothing matches …" on Home, with no
        Inbox row to tap — which then showed up as a gallery pose that was
        byte-identical to the list pose, three layers away from the cause.

        Both controls are called "Close": the small one clears the text, the
        big one dismisses the field. Told apart by size, since that is what
        distinguishes them in the tree.
        """
        closes = [n for n in self.tree() if n.get("AXLabel") == "Close"]
        for node in sorted(closes, key=lambda n: n["frame"]["width"]):
            self.tap_node(node, settle=1.5)

    def pop_to_root(self) -> None:
        # The app restores its last screen on launch, so every run starts by
        # walking back to Home rather than assuming it is already there.
        for _ in range(4):
            if self.at_home():
                return
            self.back()

    # -- output -------------------------------------------------------------

    def shot(self, name: str) -> None:
        path = os.path.join(self.out, f"{name}.png")
        sh("xcrun", "simctl", "io", self.udid, "screenshot", path)
        self.shots += 1
        print(f"  → {name}.png")


def device_size(udid: str, out: str) -> tuple[int, int]:
    probe = os.path.join(out, ".probe.png")
    sh("xcrun", "simctl", "io", udid, "screenshot", probe)
    try:
        dims = sh("sips", "-g", "pixelWidth", "-g", "pixelHeight", probe)
        w = int([l for l in dims.splitlines() if "pixelWidth" in l][0].split(":")[1])
        h = int([l for l in dims.splitlines() if "pixelHeight" in l][0].split(":")[1])
        return w, h
    finally:
        if os.path.exists(probe):
            os.remove(probe)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("udid")
    ap.add_argument("--out", default="content/screenshots/ios")
    ap.add_argument("--lang", default="en", choices=sorted(LANGS))
    ap.add_argument(
        "--any-device", action="store_true",
        help="shoot on a device that is not the 6.9\" one Apple asks for",
    )
    args = ap.parse_args()

    if not os.path.exists(IDB):
        print(f"idb not found at {IDB} — see this file's header", file=sys.stderr)
        return 1

    out = os.path.join(args.out, args.lang)
    os.makedirs(out, exist_ok=True)

    size = device_size(args.udid, out)
    if size != REQUIRED_SIZE and not args.any_device:
        print(
            f"this simulator is {size[0]}x{size[1]}; Apple's 6.9\" set is "
            f"{REQUIRED_SIZE[0]}x{REQUIRED_SIZE[1]} (iPhone 17/16 Pro Max). "
            "Pass --any-device to shoot anyway.",
            file=sys.stderr,
        )
        return 1

    langs, locale = LANGS[args.lang]
    print(f"==> language: {args.lang}")
    sh("xcrun", "simctl", "spawn", args.udid, "defaults", "write",
       ".GlobalPreferences", "AppleLanguages", "-array", *langs)
    sh("xcrun", "simctl", "spawn", args.udid, "defaults", "write",
       ".GlobalPreferences", "AppleLocale", "-string", locale)

    print("==> relaunching")
    sh("xcrun", "simctl", "terminate", args.udid, APP_ID)
    time.sleep(1)
    idb("connect", args.udid)
    sh("xcrun", "simctl", "launch", args.udid, APP_ID)
    time.sleep(12)

    s = Screen(args.udid, out, width=size[0] / 3, height=size[1] / 3)
    # A filter left behind by a previous run survives a relaunch and hides
    # every row, Home included — clear it before deciding anything is missing.
    s.clear_search()
    s.pop_to_root()

    print("==> poses")
    # Pin Home's view before shooting it. The choice is remembered per screen
    # in UserDefaults, so an un-pinned Home photographs as list on one
    # simulator and gallery on another, and a re-shoot is not a re-shoot.
    s.menu(MENU_LIST, expect_change=False)
    s.shot("01-home")

    # The Inbox is the only folder guaranteed to exist, and the one the
    # listing is really about.
    #
    # Resolved, not measured. Home used to be the one screen drawn by the
    # React renderer, so its rows were invisible to the accessibility tree and
    # this single tap had to be a coordinate. Home draws itself now, so the
    # card is a real button with a real frame like everything else.
    inbox = s.find("Inbox", "Button")
    if inbox is None:
        print("no Inbox card on Home — is the library seeded?", file=sys.stderr)
        return 1
    s.tap_node(inbox, settle=4)
    if not (s.buttons("Listen") or s.buttons("Lyssna")):
        print(
            "the Inbox did not open, or it is empty — is the library seeded? "
            "See scripts/seed-ios-demo-library.sh",
            file=sys.stderr,
        )
        return 1

    s.menu(MENU_LIST, expect_change=False)
    s.menu(MENU_GROUP_PINNED, expect_change=False)
    s.shot("02-inbox")

    s.menu(MENU_GALLERY)
    s.shot("03-gallery")
    s.menu(MENU_LIST)

    # The reader, opened from the first row.
    listens = s.buttons("Listen") or s.buttons("Lyssna")
    if listens:
        first = listens[0]["frame"]
        s.tap(s.width / 2.5, first["y"] + first["height"] / 2, settle=8)
        s.shot("04-reader")
        s.back()

    # Listening in place — the disc becomes a pause control with a ring.
    listens = s.buttons("Listen") or s.buttons("Lyssna")
    if listens:
        s.tap_node(listens[0], settle=7)
        s.shot("05-listening")
        pauses = s.buttons("Pause") or s.buttons("Pausa") or s.buttons("Listen")
        if pauses:
            s.tap_node(pauses[0], settle=2)

    # Swipe actions on the second row.
    listens = s.buttons("Listen") or s.buttons("Lyssna")
    if len(listens) > 1:
        y = listens[1]["frame"]["y"] + listens[1]["frame"]["height"] / 2
        near, far = s.width / 4, s.width - 22
        s.swipe(far, y, near, y)
        s.shot("06-swipe-actions")
        # Swiped back, not tapped away: a tap on "empty space" is only empty
        # until the listing is long enough, and then it opens a document.
        s.swipe(near, y, far, y)

    # Search, which reads titles and sites rather than filenames.
    # The status island floats above the home indicator and labels itself with
    # the count ("4 items"), so it is found by shape and position rather than
    # by text. The band has to be generous: the island sits ~90pt off the
    # bottom on a Pro and ~100 on a Pro Max, and a threshold tight enough to
    # exclude nothing else excluded the island itself.
    pill = [
        n for n in s.tree()
        if n.get("type") == "Button" and n["frame"]["y"] > s.height * 0.8
        and 100 < n["frame"]["width"] < 200
    ]
    if pill:
        s.tap_node(pill[0], settle=2.5)
        s.type_("reading")
        s.shot("07-search")
        s.clear_search()

    print(f"\nWrote {s.shots} screenshots to {out} at {size[0]}x{size[1]}")
    print(
        "Apple takes 3–10 per set; the first two are what people see in "
        "search results, so lead with the Inbox listing."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
