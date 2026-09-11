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
    /// Resolves a message key. Set by the plugin from the frontend's table, so
    /// there is ONE localisation source rather than a second `.strings` file
    /// that drifts from it.
    var localize: ((String) -> String)?

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
        LibraryFolderScreen(
            relPath: rel, title: title, settings: settings(for: rel), host: self)
    }

    /// Forget the cached sidecars — after a delete, a rename, or a return from
    /// the reader, where progress will have moved.
    func invalidate() {
        pinnedCache = nil
        progressCache = nil
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
        localize?(key) ?? key
    }
}
