import Foundation
import UserNotifications

/// What the Inbox holds, read from disk with no JavaScript running — the one
/// source of truth for the app icon badge, the background refresh and the
/// Share Extension, which all compile this file.
///
/// The unread rule is `isUnread` from `src/lib/reading-progress-file.ts`
/// transcribed: an item is unread when its sidecar entry is missing, is a
/// tombstone (`deleted: true`), or was never opened (`openedAt: null`).
/// A vitest source-shape test keeps the two in step.
enum InboxState {
    static let inboxName = "Inbox"
    static let sidecarRel = "Inbox/.notesage/reading-progress.json"

    /// iCloud placeholders are named ".<name>.icloud" — the real name.
    static func displayName(_ name: String) -> String {
        name.hasPrefix(".") && name.hasSuffix(".icloud") ? String(name.dropFirst().dropLast(7)) : name
    }

    /// The files directly under `Inbox/`: not directories, not dotfiles,
    /// placeholders under their real names.
    static func names(root: URL) -> [String] {
        let dir = root.appendingPathComponent(inboxName)
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.isDirectoryKey], options: [])
        else { return [] }
        return urls.compactMap { url in
            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            if isDir { return nil }
            let name = displayName(url.lastPathComponent)
            return name.hasPrefix(".") ? nil : name
        }.sorted()
    }

    /// `true` when the entry says the item was never opened here or anywhere.
    static func isUnread(_ entry: [String: Any]?) -> Bool {
        guard let entry else { return true }
        if entry["deleted"] as? Bool == true { return true }
        let opened = entry["openedAt"]
        return opened == nil || opened is NSNull
    }

    /// The sidecar's `items`, or empty for a missing or malformed file — the
    /// same tolerance `parseReadingProgress` has.
    static func progressItems(root: URL) -> [String: [String: Any]] {
        let url = root.appendingPathComponent(sidecarRel)
        // COORDINATED, and materialised first.
        //
        // This was a plain `Data(contentsOf:)`, which is the one read in this
        // file that cannot see an iCloud library. A synced sidecar can sit on
        // disk as an evicted placeholder (`.reading-progress.json.icloud`),
        // and an uncoordinated read of one simply fails — indistinguishable
        // here from "no progress has ever been recorded". Every item then
        // counts as unread, so the badge equals the number of files in the
        // Inbox and never moves again, however much is read: reading writes
        // the sidecar the counter cannot open.
        //
        // The app's own writes go through `NSFileCoordinator`; this is the
        // reader catching up with them.
        //
        // The gate is the DOWNLOADING STATUS, not whether the path exists.
        // Since iOS 11 an evicted item keeps its real name in the directory
        // listing and hides the `.name.icloud` placeholder, so `fileExists`
        // answers true for a file with nothing behind it — the exact case
        // this read has to handle. `.current` is the only status that means
        // the bytes are here; `.downloaded` means they are stale, and
        // `.notDownloaded` that there are none. A file that is not
        // ubiquitous at all reports no status, and then existence is the
        // only question worth asking.
        let fm = FileManager.default
        var needsDownload = !fm.fileExists(atPath: url.path)
        if !needsDownload,
            let status = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
                .ubiquitousItemDownloadingStatus
        {
            needsDownload = status != .current
        }
        if needsDownload {
            try? fm.startDownloadingUbiquitousItem(at: url)
        }
        var data: Data?
        var coordError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) { u in
            data = try? Data(contentsOf: u)
        }
        guard let data,
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let items = json["items"] as? [String: [String: Any]]
        else { return [:] }
        return items
    }

    /// The Share Extension's funnel after every successful capture: the
    /// user made this item, so it is seen (the next refresh must not announce
    /// it), and the badge is recounted from disk — never `+1`, so two shares
    /// in a row cannot drift. No banner, ever: the sheet already confirmed.
    static func didWriteCapture(root: URL, name: String) {
        Prefs.recordOwnCapture(name)
        guard Prefs.badge else { return }
        let unread = unreadCount(root: root)
        UNUserNotificationCenter.current().setBadgeCount(unread) { _ in }
    }

    static func unreadCount(root: URL) -> Int {
        let items = progressItems(root: root)
        return names(root: root).filter { isUnread(items[$0]) }.count
    }

    /// Preferences and the seen set, in the App Group defaults the app, the
    /// background task and the Share Extension all share.
    enum Prefs {
        static let suite = "group.com.notesage.app"
        private static var defaults: UserDefaults? { UserDefaults(suiteName: suite) }
        private static func key(_ k: String) -> String { "notesage.notify.\(k)" }

        static var badge: Bool {
            get { defaults?.bool(forKey: key("badge")) ?? false }
            set { defaults?.set(newValue, forKey: key("badge")) }
        }
        static var newItems: Bool {
            get { defaults?.bool(forKey: key("newItems")) ?? false }
            set { defaults?.set(newValue, forKey: key("newItems")) }
        }
        /// Names the user has had in front of them.
        static var seen: [String] {
            get { defaults?.stringArray(forKey: key("seen")) ?? [] }
            set { defaults?.set(newValue, forKey: key("seen")) }
        }
        /// Names covered by the delivered "new in Inbox" banner.
        static var announced: [String] {
            get { defaults?.stringArray(forKey: key("announced")) ?? [] }
            set { defaults?.set(newValue, forKey: key("announced")) }
        }
        /// Localised banner strings handed over by the frontend, which owns
        /// the translation table: `title`, `one` ("{title}"), `many` ("{count}").
        static var templates: [String: String] {
            get { defaults?.dictionary(forKey: key("templates")) as? [String: String] ?? [:] }
            set { defaults?.set(newValue, forKey: key("templates")) }
        }

        static func markSeen(_ names: [String]) {
            // Replace, not union: a name that left the Inbox has nothing to
            // be seen any more, and the set must not grow forever.
            seen = names
        }
        static func recordOwnCapture(_ name: String) {
            var s = seen
            if !s.contains(name) { s.append(name) }
            seen = s
        }
        static func unseen(of names: [String]) -> [String] {
            let s = Set(seen)
            return names.filter { !s.contains($0) }
        }
    }
}
