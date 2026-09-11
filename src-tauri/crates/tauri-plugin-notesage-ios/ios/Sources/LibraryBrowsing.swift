//
//  The native browsing surface's host: what a folder screen cannot work out
//  for itself, and where its answers come from.
//
//  Part of #1000. A folder screen draws entries; it does not know which are
//  pinned, which have been read, or how a section is called. All three come
//  from here, and all three come from the SAME places the rest of the app
//  already uses:
//
//    * pins      — `.notesage/pins.json` at the library root, the file the
//                  desktop sidebar reads and writes;
//    * progress  — `Inbox/.notesage/reading-progress.json`, shared with the
//                  Mac, already the truth for unread weight;
//    * recents   — this device only, so `UserDefaults`.
//
//  That is the contract the PRD describes: the seam between native browsing
//  and the web reader is the FILESYSTEM, which it already was. Nothing here
//  reaches into a JavaScript store, and nothing here is a second copy of
//  something the web layer also owns.
//

import Foundation
import UIKit

/// What read-aloud is doing, as a row needs to draw it.
struct LibrarySpeechState: Equatable {
    /// The document being read, or `nil` when nothing is.
    var relPath: String?
    var playing = false
    /// 0…1 for the ring around the disc; 0 before the first progress event.
    var fraction: Double = 0
    /// The recorder holds the audio session, so Listen is unavailable
    /// everywhere at once — one owner, as on the web side.
    var recording = false
}

protocol LibrarySpeechObserver: AnyObject {
    func speechChanged(from previous: LibrarySpeechState, to current: LibrarySpeechState)
}

/// Reads the two shared sidecars, cached per read-through so a folder of
/// several hundred rows does not re-parse them per cell.
final class LibraryBrowsing: LibraryFolderHost {
    static let shared = LibraryBrowsing()

    /// Set by the plugin when the frontend says the native surface is on.
    /// Off by default so a build where the wiring is incomplete behaves
    /// exactly as it did before.
    var enabled = false

    /// Called with a screen id when the user taps something. Set by
    /// `NavShellPresenter`, which owns the only route back to the web layer.
    var onOpen: ((_ kind: String, _ relPath: String) -> Void)?
    /// The frontend's message table, pushed across when the surface is turned
    /// on. Held as the table rather than behind a resolver closure because
    /// some of what the screen draws is a TEMPLATE, not a finished string —
    /// the reading line interpolates `{total}` itself — and a closure that
    /// only ever did `table[key] ?? key` hid that.
    ///
    /// One localisation source, by construction: a second `.strings` file
    /// would drift from `t()`, and the drift shows up as an English header in
    /// a Swedish app, which is what #989 was and took three builds to notice.
    var strings: [String: String] = [:]

    /// What read-aloud is doing, pushed over from the web controller. Rows
    /// draw it; nothing here changes it.
    private(set) var speech = LibrarySpeechState()
    /// Screens that want telling when it changes. Weak, because a screen
    /// popped off the stack must not be kept alive by a subscription.
    private var speechObservers = NSHashTable<AnyObject>.weakObjects()

    /// The folder screens currently on the stack, by relative path. Weak
    /// values: a popped screen must not be kept alive by this.
    private let screens = NSMapTable<NSString, LibraryFolderScreen>.strongToWeakObjects()

    private var pinnedCache: (paths: Set<String>, at: Date)?
    private var progressCache: (values: [String: Double], at: Date)?
    private var recents: Set<String> = []
    /// Short enough that returning from a document shows fresh state, long
    /// enough that one scroll does not re-read a file per cell.
    private static let ttl: TimeInterval = 2

    private init() {
        recents = Set(UserDefaults.standard.stringArray(forKey: "notesage.recentlyRead") ?? [])
    }

    // MARK: Settings, per folder

    /// Per-device UI state, so `UserDefaults` rather than a synced file. Keyed
    /// by the folder's relative path; an unvisited folder inherits the
    /// app-wide default, matching `resolveFolderView` on the web side.
    func settings(for rel: String) -> LibraryViewSettings {
        let defaults = UserDefaults.standard
        guard
            let raw = defaults.dictionary(forKey: "notesage.folderView.\(rel)")
                ?? defaults.dictionary(forKey: "notesage.folderView")
        else { return LibraryViewSettings() }
        var settings = LibraryViewSettings()
        if let layout = raw["layout"] as? String,
            let parsed = LibraryViewSettings.Layout(rawValue: layout)
        {
            settings.layout = parsed
        }
        settings.condensed = raw["condensed"] as? Bool ?? false
        if let sort = raw["sort"] as? String, let parsed = LibrarySortMode(rawValue: sort) {
            settings.sort = parsed
        }
        if let group = raw["group"] as? String, let parsed = LibraryGroupMode(rawValue: group) {
            settings.group = parsed
        }
        return settings
    }

    func setSettings(_ settings: LibraryViewSettings, for rel: String) {
        UserDefaults.standard.set(
            [
                "layout": settings.layout.rawValue,
                "condensed": settings.condensed,
                "sort": settings.sort.rawValue,
                "group": settings.group.rawValue,
            ], forKey: "notesage.folderView.\(rel)")
    }

    // MARK: Screens

    @MainActor
    func makeScreen(rel: String, title: String) -> LibraryFolderScreen {
        let screen = LibraryFolderScreen(
            relPath: rel, title: title, settings: settings(for: rel), host: self)
        screens.setObject(screen, forKey: rel as NSString)
        return screen
    }

    /// The user changed how a folder is shown. Persist it — so pushing that
    /// folder again starts the same way — and tell the screen if it is open.
    ///
    /// This is pushed from the web layer because the "…" menu that sets it is
    /// still declared there. Nothing is DECIDED here or there twice: the menu
    /// owns the choice, this owns the drawing.
    @MainActor
    func setView(_ settings: LibraryViewSettings, for rel: String) {
        setSettings(settings, for: rel)
        screens.object(forKey: rel as NSString)?.apply(settings: settings)
    }

    /// Forget the cached sidecars — after a delete, a rename, or a return from
    /// the reader, where progress will have moved.
    func invalidate() {
        pinnedCache = nil
        progressCache = nil
    }

    /// Something changed the library: a note or folder created, a row deleted
    /// or renamed, a sweep finishing. Re-read every folder screen on the
    /// stack.
    ///
    /// Build 64 had no route for this at all. A native screen re-read itself
    /// only in `viewWillAppear` or on pull-to-refresh, so deleting a row left
    /// it sitting on screen and a new note did not appear until you left the
    /// folder and came back. The web layer does the mutating, so the web
    /// layer says when.
    @MainActor
    func reloadScreens() {
        invalidate()
        ArticleMeta.clearCache()
        for key in screens.keyEnumerator().allObjects.compactMap({ $0 as? NSString }) {
            screens.object(forKey: key)?.reloadFromHost()
        }
    }

    // MARK: Read-aloud

    func observeSpeech(_ observer: LibrarySpeechObserver) {
        speechObservers.add(observer)
    }

    func setSpeech(_ state: LibrarySpeechState) {
        // Progress events arrive per paragraph, and each one would otherwise
        // redraw a row for an unchanged picture. Only a real change is worth
        // a reconfigure.
        guard state != speech else { return }
        let previous = speech
        speech = state
        for case let observer as LibrarySpeechObserver in speechObservers.allObjects {
            observer.speechChanged(from: previous, to: state)
        }
    }

    func noteRead(_ rel: String) {
        recents.insert(rel)
        UserDefaults.standard.set(Array(recents), forKey: "notesage.recentlyRead")
    }

    // MARK: LibraryFolderHost

    func openFolder(_ rel: String, title: String) {
        onOpen?("folder", rel)
    }

    func openDocument(_ rel: String) {
        noteRead(rel)
        onOpen?("document", rel)
    }

    func presentMenu(for rel: String) {
        onOpen?("menu", rel)
    }

    func swipeAction(_ id: String, for rel: String) {
        onOpen?("swipe:\(id)", rel)
    }

    func toggleListen(for rel: String) {
        // Asked, not done. `toggleSpeech` converts the document to speech
        // text, resumes from the stored position and handles the failure
        // toast — none of which is a folder screen's business.
        onOpen?("listen", rel)
    }

    func speechState() -> LibrarySpeechState { speech }

    func pinnedPaths() -> Set<String> {
        if let cache = pinnedCache, Date().timeIntervalSince(cache.at) < Self.ttl {
            return cache.paths
        }
        // The desktop writes `{ "pinned": ["a/b.md", …] }`; a malformed or
        // missing file means "nothing is pinned", never an error — a browser
        // that refuses to list a folder because a preferences file is odd is
        // worse than one that shows nothing pinned.
        var paths: Set<String> = []
        if let raw = try? LibraryAccess.readFile(".notesage/pins.json"),
            let data = raw.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let list = object["pinned"] as? [String]
        {
            paths = Set(list)
        }
        pinnedCache = (paths, Date())
        return paths
    }

    func recentlyRead() -> Set<String> { recents }

    func progress(for rel: String) -> Double {
        if progressCache == nil || Date().timeIntervalSince(progressCache!.at) >= Self.ttl {
            var values: [String: Double] = [:]
            if let raw = try? LibraryAccess.readFile("Inbox/.notesage/reading-progress.json"),
                let data = raw.data(using: .utf8),
                let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            {
                // `{ "<relPath>": { "progress": 0.42, … } }` — the shape the
                // Mac writes. A bare number is accepted too, since an older
                // sidecar used one.
                for (key, value) in object {
                    if let entry = value as? [String: Any], let p = entry["progress"] as? Double {
                        values[key] = p
                    } else if let p = value as? Double {
                        values[key] = p
                    }
                }
            }
            progressCache = (values, Date())
        }
        return progressCache?.values[rel] ?? 0
    }

    func localized(_ key: String) -> String {
        // Falls back to the key rather than to English: a visible `section.pinned`
        // is a bug report, where a silently English header in a Swedish app is
        // the thing nobody notices for three builds (#989).
        strings[key] ?? key
    }

    func articleTemplates() -> ArticleMeta.Templates? {
        // Absent rather than guessed. These arrive with their `{total}` /
        // `{left}` placeholders still in them, so a missing key would put a
        // literal brace on the row; the plain file row is the better failure.
        guard let minutes = strings["list.minutes"], let left = strings["list.minutesLeft"],
            let read = strings["list.read"]
        else { return nil }
        return ArticleMeta.Templates(minutes: minutes, minutesLeft: left, read: read)
    }
}
