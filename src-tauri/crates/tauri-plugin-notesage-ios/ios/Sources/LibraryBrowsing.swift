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
    var onOpen: ((_ kind: String, _ relPath: String, _ title: String?) -> Void)?
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

    private var homeCache: (folders: [String]?, at: Date)?
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
    func makeScreen(rel: String, title: String, isHome: Bool = false) -> LibraryFolderScreen {
        let screen = LibraryFolderScreen(
            relPath: rel, title: title, settings: settings(for: rel), host: self, isHome: isHome)
        // Keyed so the host can push a filter or a setting at the right
        // screen. Home and All Folders are both the root, so Home takes its
        // own key rather than evicting the other from the table.
        screens.setObject(screen, forKey: (isHome ? "/home" : rel) as NSString)
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

    /// The search island's text, handed to the open screen for that folder.
    @MainActor
    func setFilter(_ query: String, for rel: String) {
        screens.object(forKey: rel as NSString)?.apply(filter: query)
    }

    /// Forget the cached sidecars — after a delete, a rename, or a return from
    /// the reader, where progress will have moved.
    func invalidate() {
        homeCache = nil
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
        // NOT `ArticleMeta.clearCache()`. That cache is keyed by path AND
        // modification time, so a rewritten file already misses it — clearing
        // only throws away entries that are still correct. It made every
        // article row fall back to its placeholder and re-read an 800 KB
        // capture from disk on every refresh, and because playback writes
        // reading progress (which refreshes the browser), a row visibly lost
        // its title line and excerpt a moment after Listen was pressed and
        // then got them back. Build 65.
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
        onOpen?("folder", rel, title)
    }

    func openDocument(_ rel: String, title: String?) {
        noteRead(rel)
        onOpen?("document", rel, title)
    }

    func presentMenu(for rel: String) {
        onOpen?("menu", rel, nil)
    }

    func swipeAction(_ id: String, for rel: String) {
        onOpen?("swipe:\(id)", rel, nil)
    }

    func toggleListen(for rel: String) {
        // Asked, not done. `toggleSpeech` converts the document to speech
        // text, resumes from the stored position and handles the failure
        // toast — none of which is a folder screen's business.
        onOpen?("listen", rel, nil)
    }

    func speechState() -> LibrarySpeechState { speech }

    func pinnedPaths() -> Set<String> {
        if let cache = pinnedCache, Date().timeIntervalSince(cache.at) < Self.ttl {
            return cache.paths
        }
        // `readSidecar`, not `readFile`: on a device this file is synced and
        // can be an evicted placeholder, which reads as empty — see there.
        switch LibraryAccess.readSidecar(".notesage/pins.json") {
        case .text(let raw):
            let paths = parseLibraryPins(raw)
            pinnedCache = (paths, Date())
            return paths
        case .absent:
            pinnedCache = ([], Date())
            return []
        case .pending:
            // A download is running. Remembering the empty answer would show
            // an unpinned library until something else forced a re-read.
            pinnedCache = nil
            return []
        }
    }

    func recentlyRead() -> Set<String> { recents }

    // MARK: Home

    /// `.notesage/home.json`. Cached like the other sidecars, and invalidated
    /// with them — editing Home rewrites the file, and the screen has to see
    /// that on the way back.
    func homeFolders() -> [String]? {
        if let cache = homeCache, Date().timeIntervalSince(cache.at) < Self.ttl {
            return cache.folders
        }
        switch LibraryAccess.readSidecar(".notesage/home.json") {
        case .text(let raw):
            let folders = parseLibraryHome(raw)
            homeCache = (folders, Date())
            return folders
        case .absent:
            // No file is the honest "never curated" — the default Home.
            homeCache = (nil, Date())
            return nil
        case .pending:
            // Not cached: see `readSidecar`. Answering "never curated" for a
            // file that is merely on its way would show the hint to someone
            // who has already chosen, once.
            homeCache = nil
            return nil
        }
    }

    /// Per DEVICE, not per library: the tip is about where this phone puts
    /// things, and a Mac has no Home screen to be confused by.
    private static let hintKey = "notesage.homeHintDismissed"

    func homeHintDismissed() -> Bool {
        UserDefaults.standard.bool(forKey: Self.hintKey)
    }

    func dismissHomeHint() {
        UserDefaults.standard.set(true, forKey: Self.hintKey)
    }

    /// The Inbox card's badge. `InboxState` is also what badges the app icon,
    /// so asking it here means the two numbers cannot disagree — which they
    /// did when the web layer counted separately.
    func inboxUnread() -> Int {
        guard let root = try? LibraryAccess.resolveRoot() else { return 0 }
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        return InboxState.unreadCount(root: root)
    }

    func progress(for rel: String) -> Double {
        if progressCache == nil || Date().timeIntervalSince(progressCache!.at) >= Self.ttl {
            switch LibraryAccess.readSidecar("Inbox/.notesage/reading-progress.json") {
            case .text(let raw):
                progressCache = (parseLibraryReadingProgress(raw), Date())
            case .absent:
                progressCache = ([:], Date())
            case .pending:
                // Left uncached on purpose, so the next row to be configured
                // tries again — by then the bytes have usually landed. The
                // alternative is a blank ring on every row until the folder is
                // left and re-entered.
                progressCache = nil
            }
        }
        // The sidecar is keyed by file name, not by path — see
        // `parseLibraryReadingProgress`.
        return progressCache?.values[(rel as NSString).lastPathComponent] ?? 0
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
