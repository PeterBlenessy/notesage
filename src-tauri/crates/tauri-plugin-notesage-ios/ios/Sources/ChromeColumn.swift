//
//  The bottom-centre column's arithmetic, and nothing else.
//
//  Four things want the strip of screen above the home indicator — the search
//  pill, the read-aloud transport, the recording island and a passive status
//  line — and each one that was positioned by whoever happened to draw it
//  eventually landed on top of another:
//
//    * search over the recorder's Pause and Stop, so a recording could be
//      started and then not stopped (device, build 50);
//    * the web layer's sweep indicator under the native search island,
//      unreadable before it vanished (device, build 60, #995);
//    * the player and the search pill both pinned at the same offset, which
//      collides the moment an article is read aloud with find open.
//
//  Each was fixed where it was noticed, with its own arithmetic. The
//  arithmetic lives here now, once — and it lives in its OWN FILE, importing
//  nothing but CoreGraphics, so it can be compiled and run on macOS by
//  `scripts/check-chrome-column.sh`. `ChromeOverlay.swift` imports UIKit,
//  SwiftUI and WebKit and can only be built for a device; the part most worth
//  testing is the part with no UI in it at all.
//
//  Everything here is pure: in, a description of which islands exist; out,
//  how far each sits above the bottom guide. `ChromeManager` does the rest.
//

import CoreGraphics

/// How far each bottom-centre island sits above the keyboard/safe-area guide,
/// as a POSITIVE distance. The caller negates it for a bottom constraint.
struct BottomColumnOffsets: Equatable {
    let search: CGFloat
    let transport: CGFloat
    let status: CGFloat
}

/// Metrics of the islands that share the column.
enum ChromeColumnMetrics {
    /// Gap between the lowest island and the bottom safe area / keyboard.
    static let inset: CGFloat = 10
    /// Vertical gap between two stacked islands.
    static let gap: CGFloat = 8
    /// The collapsed search island.
    static let searchHeight: CGFloat = 50
    /// The player and the recorder, which are deliberately the same shape and
    /// the same size — recording and listening are the same kind of thing to a
    /// thumb (see `GlassRecorder`).
    static let transportHeight: CGFloat = 66
}

/// Stack the bottom-centre islands, from the bottom edge upward.
///
/// Order, and why:
///
///   1. **search** — lowest, because it is the one a thumb reaches for most
///      and the only one that expands into a keyboard.
///   2. **transport** — the player or the recorder. They never coexist (the
///      audio session has one owner), so they share a rung.
///   3. **status** — passive, so it floats highest: nothing is lost if a
///      finger never reaches it, and everything below stays tappable.
///
/// An absent island takes no space, so a screen with only a search pill puts
/// it exactly where a screen with nothing else would.
func bottomColumnOffsets(
    hasSearch: Bool,
    hasTransport: Bool,
    hasStatus: Bool
) -> BottomColumnOffsets {
    var offset = ChromeColumnMetrics.inset

    let search = offset
    if hasSearch { offset += ChromeColumnMetrics.searchHeight + ChromeColumnMetrics.gap }

    let transport = offset
    if hasTransport { offset += ChromeColumnMetrics.transportHeight + ChromeColumnMetrics.gap }

    return BottomColumnOffsets(search: search, transport: transport, status: offset)
}
