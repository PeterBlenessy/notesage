import Foundation
import os.log

/// Thumbnails that survive the app being closed.
///
/// The gallery and the list have always cached thumbnails, but only in a
/// `Map` inside the web view: correct for a second visit to a folder, worth
/// nothing on the next launch. So every cold start rebuilt every thumbnail,
/// and rebuilding one is not cheap — a saved article's lead image means
/// reading a 200-800 KB capture to find it, then decoding and downscaling
/// it. Eleven rows of that is the delay you can watch (Peter, device,
/// builds 50 and 51: "the thumbnails still load like they are not cached").
///
/// This is a plain byte cache, keyed by a digest the frontend computes from
/// the path, its modification time and the render settings, so a file that
/// changes simply asks under a new name and the old entry ages out. It lives
/// in Caches — iOS may reclaim it under pressure, which is exactly right for
/// something that can always be rebuilt.
enum ThumbnailCache {
    private static let logger = OSLog(subsystem: "com.notesage.app", category: "thumbcache")

    /// Total bytes kept before the oldest entries are dropped. A card-sized
    /// JPEG is ~20 KB, so this holds a library far larger than anyone
    /// scrolls in a session.
    static let budget = 64 * 1024 * 1024

    private static var directory: URL? {
        guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
        else { return nil }
        let dir = caches.appendingPathComponent("Thumbnails", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    /// Keys come from the frontend, so they are treated as untrusted: only a
    /// hex digest is ever turned into a filename. Anything else is refused
    /// rather than sanitised, because a "cleaned" key could collide with a
    /// real one and serve the wrong picture.
    static func isValidKey(_ key: String) -> Bool {
        !key.isEmpty && key.count <= 128
            && key.allSatisfy { $0.isHexDigit && ($0.isNumber || $0.isLowercase) }
    }

    private static func file(_ key: String) -> URL? {
        guard isValidKey(key), let directory else { return nil }
        return directory.appendingPathComponent("\(key).bin", isDirectory: false)
    }

    static func get(_ key: String) -> Data? {
        guard let url = file(key), let data = try? Data(contentsOf: url) else { return nil }
        // Touch it, so the sweep below drops what nobody looks at rather than
        // what happens to be old.
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
        return data
    }

    static func put(_ key: String, _ data: Data) {
        guard let url = file(key) else { return }
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            os_log("write failed: %{public}@", log: logger, type: .error, String(describing: error))
            return
        }
        sweep()
    }

    /// Drop least-recently-used entries once the budget is exceeded. Cheap
    /// enough to run after a write: it lists one flat directory and does
    /// nothing at all until the cache is actually full.
    static func sweep() {
        guard let directory,
            let urls = try? FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey],
                options: [.skipsHiddenFiles])
        else { return }
        var entries: [(url: URL, size: Int, at: Date)] = []
        var total = 0
        for url in urls {
            let v = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            let size = v?.fileSize ?? 0
            entries.append((url, size, v?.contentModificationDate ?? .distantPast))
            total += size
        }
        guard total > budget else { return }
        for entry in entries.sorted(by: { $0.at < $1.at }) {
            try? FileManager.default.removeItem(at: entry.url)
            total -= entry.size
            if total <= budget { break }
        }
        os_log("swept to %d bytes", log: logger, type: .info, total)
    }
}
