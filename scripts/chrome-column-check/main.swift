//
//  Exercise the bottom-centre column's stacking arithmetic.
//
//  That arithmetic decides where the search pill, the read-aloud transport,
//  the recording island and the passive status line sit relative to each
//  other, and it has been wrong three times — twice reaching a device:
//
//    * search drawn over the recorder's Pause and Stop, so a recording could
//      be started and then not stopped (build 50);
//    * the sweep indicator underneath the search island, unreadable before it
//      vanished (build 60, #995);
//    * the player and the search pill pinned at the same offset, which
//      collides as soon as an article is read aloud with find open.
//
//  Each was fixed where it was noticed, with its own arithmetic, and none of
//  it was testable: `ChromeOverlay.swift` imports UIKit, SwiftUI and WebKit,
//  so it compiles only for a device, and seeing the result needs a simulator
//  and a granted library. `ChromeColumn.swift` therefore holds the offsets
//  alone, importing only CoreGraphics, and this runs them on macOS.
//
//  There is no XCTest target in this repo and adding one would mean a second
//  build system in CI, so this follows the pattern established by
//  `scripts/check-inbox-state.sh`: compile the real source, assert against it,
//  exit non-zero on a failure.
//
//  What it cannot cover: that the offsets are applied to the right
//  constraints, that the constraints hang off the keyboard guide, or that the
//  islands look right. Those need the device.
//
//  Named main.swift because Swift allows top-level code in that file only.
//

import CoreGraphics
import Foundation

var failures = 0

func check(_ name: String, _ actual: some Equatable, _ expected: some Equatable) {
    let ok = "\(actual)" == "\(expected)"
    print("\(ok ? "ok  " : "FAIL") \(name)\(ok ? "" : "  — got \(actual), want \(expected)")")
    if !ok { failures += 1 }
}

let inset = ChromeColumnMetrics.inset
let gap = ChromeColumnMetrics.gap
let searchH = ChromeColumnMetrics.searchHeight
let transportH = ChromeColumnMetrics.transportHeight

// --- An island on its own sits on the guide, wherever the others are. -------

let searchOnly = bottomColumnOffsets(hasSearch: true, hasTransport: false, hasStatus: false)
check("search alone rests on the guide", searchOnly.search, inset)

let transportOnly = bottomColumnOffsets(hasSearch: false, hasTransport: true, hasStatus: false)
check("transport alone rests on the guide", transportOnly.transport, inset)

let statusOnly = bottomColumnOffsets(hasSearch: false, hasTransport: false, hasStatus: true)
check("status alone rests on the guide", statusOnly.status, inset)

// --- Build 50: search must not cover the recorder's Stop. -------------------

let searchAndTransport = bottomColumnOffsets(hasSearch: true, hasTransport: true, hasStatus: false)
check("search stays lowest", searchAndTransport.search, inset)
check(
    "the transport clears the search island",
    searchAndTransport.transport,
    inset + searchH + gap
)
check(
    "…which is a real gap, not an overlap",
    searchAndTransport.transport - searchAndTransport.search >= searchH,
    true
)

// --- Build 60 (#995): the status must not hide behind the search pill. ------

let searchAndStatus = bottomColumnOffsets(hasSearch: true, hasTransport: false, hasStatus: true)
check("the status clears the search island", searchAndStatus.status, inset + searchH + gap)
check(
    "…and sits ABOVE it, never behind",
    searchAndStatus.status > searchAndStatus.search,
    true
)

// --- The latent one: listening with find open. ------------------------------

check(
    "the transport and the search pill never share an offset",
    searchAndTransport.transport != searchAndTransport.search,
    true
)

// --- All three at once: a recording, a filter and a sweep. ------------------

let all = bottomColumnOffsets(hasSearch: true, hasTransport: true, hasStatus: true)
check("all three — search lowest", all.search, inset)
check("all three — transport in the middle", all.transport, inset + searchH + gap)
check(
    "all three — status highest",
    all.status,
    inset + searchH + gap + transportH + gap
)
check("all three — strictly increasing", all.search < all.transport && all.transport < all.status, true)

// --- An absent island takes no space. ---------------------------------------

let statusNoSearch = bottomColumnOffsets(hasSearch: false, hasTransport: true, hasStatus: true)
check(
    "with no search, the status sits one transport up, not two",
    statusNoSearch.status,
    inset + transportH + gap
)
check(
    "a missing island costs nothing",
    bottomColumnOffsets(hasSearch: false, hasTransport: false, hasStatus: true).status,
    inset
)

// --- Nothing at all is still well-defined. ----------------------------------

let empty = bottomColumnOffsets(hasSearch: false, hasTransport: false, hasStatus: false)
check("an empty column is the inset", empty.search, inset)

print(failures == 0 ? "\nall good" : "\n\(failures) failed")
exit(failures == 0 ? 0 : 1)
