//
//  What a saved article's row shows, read from the capture itself.
//
//  Part of #1000. A capture is an HTML document whose header already carries
//  its title, standfirst, reading time and publisher — `article_card_meta` in
//  the `notesage-capture` crate parses them back out, and that is the parser
//  the desktop and the web reader already use.
//
//  So this does NOT parse anything. It reads the file and hands it to that
//  crate over the C ABI, exactly as `LibraryCapture.swift` does for building a
//  capture. A second parser in Swift would be a second definition of the
//  capture format, which `pipeline_contract.rs` exists to prevent — that
//  format has shipped broken twice by having two ideas of itself.
//

import Foundation

/// A saved article's list-row fields. Every field is optional: a capture may
/// have no standfirst, and an older one may have no reading time.
struct ArticleMeta: Decodable {
    let title: String?
    let excerpt: String?
    let minutes: Int?
    let site: String?
    let sourceUrl: String?
}

enum ArticleMetaReader {
    /// Keyed by path AND modified time, so the retroactive image sweep —
    /// which rewrites captures in place — does not leave a row showing
    /// metadata from before it ran.
    private static var cache: [String: ArticleMeta?] = [:]
    private static let lock = NSLock()

    private static func key(_ rel: String, _ modified: Double?) -> String {
        "\(rel)@\(modified.map { String(Int($0)) } ?? "-")"
    }

    /// What is already known, without touching the disk. For cell
    /// configuration, so a reused cell showing an article it has drawn before
    /// never flashes the filename first.
    static func cached(_ rel: String, modified: Double?) -> ArticleMeta?? {
        lock.lock()
        defer { lock.unlock() }
        return cache[key(rel, modified)]
    }

    /// Read and parse. Call OFF the main thread: a capture is 200–800 KB of
    /// inlined images, and this reads all of it — the source footer the parser
    /// needs is at the end of the document, so there is no prefix to stop at.
    ///
    /// Returns `nil` for a document that is not a capture, which is a real
    /// answer and is cached as one: the plain row is correct for it, and
    /// re-reading an 800 KB file on every scroll to learn that again is not.
    static func read(_ rel: String, modified: Double?) -> ArticleMeta? {
        let cacheKey = key(rel, modified)
        lock.lock()
        if let hit = cache[cacheKey] {
            lock.unlock()
            return hit
        }
        lock.unlock()

        var parsed: ArticleMeta?
        if let html = try? LibraryAccess.readFile(rel) {
            parsed = html.withCString { pointer -> ArticleMeta? in
                guard let raw = notesage_capture_article_card_meta(pointer) else { return nil }
                defer { notesage_capture_string_free(raw) }
                let json = String(cString: raw)
                guard let data = json.data(using: .utf8) else { return nil }
                return try? JSONDecoder().decode(ArticleMeta.self, from: data)
            }
        }

        lock.lock()
        cache[cacheKey] = parsed
        lock.unlock()
        return parsed
    }

    /// Is this file worth asking about at all? Captures are HTML; asking for
    /// anything else would read a PDF to learn it has no byline.
    static func isCandidate(_ name: String) -> Bool {
        LibraryFileKind.of(name) == .html
    }

    static func forget() {
        lock.lock()
        cache.removeAll()
        lock.unlock()
    }
}
