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
/// Main-actor by construction. Every cache here is read during cell
/// configuration and written from a sidecar read's completion, so "touched
/// only on the main thread" is the invariant that keeps them safe — and
/// stating it as isolation makes the compiler hold it rather than a comment.
@MainActor
final class LibraryBrowsing: LibraryFolderHost {
    static let shared = LibraryBrowsing()

    /// Home's screen id, and the web layer's `HOME_KEY`.
    ///
    /// The leading slash is load-bearing on BOTH sides: a folder is named by
    /// its relative path, and a relative path can never begin with "/", so
    /// this can never be confused with the folder screen for the root — which
    /// is a different screen showing the same directory ("All Folders").
    static let homeScreenId = "/home"

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

    /// Every folder screen currently on the stack. Weak: a popped screen must
    /// not be kept alive by this.
    ///
    /// A SET rather than a path→screen map, because two screens can show the
    /// same folder: Home and All Folders are both the root. The map silently
    /// held one of them, so a view or density change addressed to `""` reached
    /// All Folders and never Home — the menu appeared to do nothing there.
    /// Keying Home separately only moved the problem, since the web layer
    /// addresses screens by path and has no other name for it.
    private let screens = NSHashTable<LibraryFolderScreen>.weakObjects()

    /// The live screens the web layer addresses as `key` — its own
    /// `screenKeyOf`, so Home (`/home`) and All Folders (`""`) stay distinct
    /// even though both show the root.
    private func screens(for key: String) -> [LibraryFolderScreen] {
        screens.allObjects.filter { $0.screenKey == key }
    }

    private var homeCache: (folders: [String]?, at: Date)?
    private var pinnedCache: (paths: Set<String>, at: Date)?
    /// Per SIDECAR, keyed by its relative path: every folder can have one.
    private var progressCache: [String: (values: [String: Double], at: Date)] = [:]
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
            relPath: rel, title: title,
            settings: settings(for: isHome ? Self.homeScreenId : rel), host: self, isHome: isHome)
        screens.add(screen)
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
        // Every screen showing this folder: Home and All Folders are the same
        // folder seen two ways, and a view choice is about the folder.
        for screen in screens(for: rel) { screen.apply(settings: settings) }
    }

    /// The search island's text, handed to the open screen for that folder.
    @MainActor
    func setFilter(_ query: String, for rel: String) {
        for screen in screens(for: rel) { screen.apply(filter: query) }
    }

    /// Forget the cached sidecars — after a delete, a rename, or a return from
    /// the reader, where progress will have moved.
    func invalidate() {
        appearanceCache.removeAll()
        sidecarPendingSince.removeAll()
        homeCache = nil
        pinnedCache = nil
        progressCache.removeAll()
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
        for screen in screens.allObjects { screen.reloadFromHost() }
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

    func openFailed(_ rel: String, reason: String) {
        onOpen?("folderFailed", rel, reason)
    }

    /// Where each screen was scrolled to, by screen key.
    ///
    /// Held here rather than on the screen because a POP deallocates the
    /// controller: the position has to outlive the thing that had it, or
    /// going back and forward twice forgets. The type itself is UIKit-free
    /// and tested by `scripts/check-library-ordering.sh` — bounding, prefix
    /// handling and rename-following are exactly the kind of thing that is
    /// wrong in ways a screenshot does not show.
    private var scroll = LibraryScrollMemory()

    func rememberScroll(_ item: String, for key: String) {
        scroll.remember(item, for: key)
    }

    func rememberedScroll(for key: String) -> String? { scroll.anchor(for: key) }

    /// A path is gone: drop its remembered position, and its children's.
    ///
    /// Without this, deleting a folder and later making another with the same
    /// name hands the new one a position it never had.
    func forgetScroll(_ rel: String) { scroll.forget(rel) }

    /// A path moved: the position travels with it.
    func moveScroll(from: String, to: String) { scroll.rewrite(from: from, to: to) }

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

    /// A folder's custom icon and colour, from its own `project.json` (#140).
    ///
    /// One small read per FOLDER, cached like the other sidecars — a listing
    /// of a hundred files does none, because only directories can carry one.
    /// Read-only: the phone shows what the Mac set and never writes this
    /// file, so the rest of the project's metadata is never at risk.
    private var appearanceCache: [String: (value: LibraryFolderAppearance, at: Date)] = [:]
    /// Sidecars whose read is already scheduled, so a screenful of rows that
    /// all miss the cache asks for each file once rather than once per row.
    private var sidecarReadsInFlight: Set<String> = []
    /// When a sidecar last came back `.pending`, so a file iCloud is not
    /// delivering is not re-read every time anything else on screen redraws.
    ///
    /// `.pending` is deliberately not cached — the download was only just
    /// asked for, and caching the empty answer would freeze it. But without a
    /// floor between attempts, an evicted or offline sidecar turns every
    /// unrelated redraw into another coordinated read, under exactly the
    /// iCloud contention this whole path exists to relieve.
    private var sidecarPendingSince: [String: Date] = [:]
    /// How long to leave a `.pending` sidecar alone before asking again.
    private static let pendingRetryFloor: TimeInterval = 3
    /// Set while a redraw is already queued for the next turn of the run
    /// loop: ten sidecars landing is one redraw, not ten.
    private var redrawQueued = false

    /// A folder's custom icon and colour — FROM CACHE, never from disk.
    ///
    /// This is called from a `CellRegistration` closure, inside
    /// `cellForItemAt:`. Reading here is what the warm pass exists to avoid:
    /// `readSidecar` ends in `NSFileCoordinator.coordinate`, which blocks on
    /// the systemwide coordination queue and can stall while iCloud syncs the
    /// same container. A miss therefore answers "nothing" immediately and
    /// schedules the read; the row draws plain and is redrawn when it lands,
    /// exactly as a thumbnail does.
    ///
    /// The first version of this fix left the synchronous read in place as a
    /// fallback, which meant the very first paint of every listing — the case
    /// the hitch was reported for — still blocked.
    @MainActor
    func folderAppearance(for entry: LibraryEntry) -> LibraryFolderAppearance {
        guard entry.isDirectory else { return LibraryFolderAppearance() }
        if let hit = appearanceCache[entry.path],
            Date().timeIntervalSince(hit.at) < Self.ttl
        {
            return hit.value
        }
        scheduleSidecarRead(appearanceFor: entry.path)
        return LibraryFolderAppearance()
    }

    /// Reading progress for one item — FROM CACHE, never from disk. See
    /// `folderAppearance` for why.
    ///
    /// The sidecar belongs to the FOLDER the item is in, not to the Inbox.
    /// Filing an item out carries its entry into
    /// `<destination>/.notesage/reading-progress.json` (`fileToNow` in
    /// `inbox-store.ts`) and leaves a tombstone behind, so reading only the
    /// Inbox's copy showed nothing for anything filed — and, because the key
    /// is the bare FILE NAME, could show one item's progress against an
    /// unrelated file elsewhere that happened to share a name.
    @MainActor
    func progress(for rel: String) -> Double {
        let name = (rel as NSString).lastPathComponent
        let sidecar = Self.progressSidecar(forItem: rel)
        if let hit = progressCache[sidecar], Date().timeIntervalSince(hit.at) < Self.ttl {
            return hit.values[name] ?? 0
        }
        scheduleSidecarRead(progress: sidecar)
        return 0
    }

    /// The progress sidecar an item belongs to. Shared by the accessor and
    /// the warm pass so the two can never disagree about which file that is.
    static func progressSidecar(forItem rel: String) -> String {
        let folder = (rel as NSString).deletingLastPathComponent
        return folder.isEmpty
            ? ".notesage/reading-progress.json"
            : "\(folder)/.notesage/reading-progress.json"
    }

    /// Warm a listing's sidecars before its cells ask for them.
    ///
    /// An optimisation, not a correctness requirement: a row that misses
    /// schedules its own read. This exists so the common case — a listing
    /// drawn once — does one batch of reads rather than one per row.
    @MainActor
    func warmSidecars(for entries: [LibraryEntry]) {
        for entry in entries {
            if entry.isDirectory { scheduleSidecarRead(appearanceFor: entry.path) }
            // EVERY entry, not only files: a folder row draws a progress ring
            // too, and a listing of nothing but folders would otherwise never
            // warm the sidecar its rows go on to ask for one at a time.
            scheduleSidecarRead(progress: Self.progressSidecar(forItem: entry.path))
        }
    }

    /// Whether a read of `sidecar` should start now: not already running, and
    /// not inside the floor after a `.pending` answer.
    @MainActor
    private func mayRead(_ sidecar: String) -> Bool {
        if sidecarReadsInFlight.contains(sidecar) { return false }
        if let since = sidecarPendingSince[sidecar],
            Date().timeIntervalSince(since) < Self.pendingRetryFloor
        {
            return false
        }
        return true
    }

    @MainActor
    private func scheduleSidecarRead(appearanceFor folder: String) {
        let sidecar = "\(folder)/.notesage/project.json"
        guard mayRead(sidecar) else { return }
        sidecarReadsInFlight.insert(sidecar)
        DispatchQueue.global(qos: .userInitiated).async {
            let answer = LibraryAccess.readSidecar(sidecar)
            DispatchQueue.main.async {
                self.sidecarReadsInFlight.remove(sidecar)
                switch answer {
                case .text(let raw):
                    self.appearanceCache[folder] = (parseLibraryFolderAppearance(raw), Date())
                case .absent:
                    // Most folders are not projects and never will be. Cache
                    // the nothing, or every scroll asks again.
                    self.appearanceCache[folder] = (LibraryFolderAppearance(), Date())
                case .pending:
                    // A download has only just been asked for; leave it
                    // uncached so a later miss retries — but not immediately,
                    // or an undeliverable file is re-read on every redraw.
                    self.sidecarPendingSince[sidecar] = Date()
                    return
                }
                self.sidecarPendingSince[sidecar] = nil
                self.setNeedsRowRedraw()
            }
        }
    }

    @MainActor
    private func scheduleSidecarRead(progress sidecar: String) {
        guard mayRead(sidecar) else { return }
        sidecarReadsInFlight.insert(sidecar)
        DispatchQueue.global(qos: .userInitiated).async {
            let answer = LibraryAccess.readSidecar(sidecar)
            DispatchQueue.main.async {
                self.sidecarReadsInFlight.remove(sidecar)
                switch answer {
                case .text(let raw):
                    self.progressCache[sidecar] = (parseLibraryReadingProgress(raw), Date())
                case .absent:
                    self.progressCache[sidecar] = ([:], Date())
                case .pending:
                    self.sidecarPendingSince[sidecar] = Date()
                    return
                }
                self.sidecarPendingSince[sidecar] = nil
                self.setNeedsRowRedraw()
            }
        }
    }

    /// Redraw the rows of every live screen — the cells were configured
    /// against a cache that was empty at the time.
    ///
    /// Coalesced to one pass per turn of the run loop. A listing warms a
    /// dozen sidecars at once, and redrawing on each one landing meant a
    /// dozen full `reconfigureItems` passes where one would do.
    @MainActor
    private func setNeedsRowRedraw() {
        guard !redrawQueued else { return }
        redrawQueued = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.redrawQueued = false
            for screen in self.screens.allObjects { screen.redrawRows() }
        }
    }

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
