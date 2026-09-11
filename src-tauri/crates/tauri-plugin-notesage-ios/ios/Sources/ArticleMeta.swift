//
//  What a saved article's row says, read natively (#1000).
//
//  A capture is a `.html` file whose header the `notesage-capture` crate
//  wrote: `<title>`, a standfirst, and a ` · `-joined byline carrying "N min
//  read" and the site. `article_card_meta` reads those four fields back out
//  of it, and it is the ONLY parser that does — the web row (#836) calls the
//  same function through a Tauri command.
//
//  So this file does not parse anything. It reads the file, hands the HTML to
//  the C ABI, and decodes the JSON that comes back. Reimplementing the
//  parser in Swift would make the capture format have two readers, which is
//  the exact failure `pipeline_contract.rs` exists to prevent.
//
//  On the linkage, because it caught me once: the plugin package has no
//  bridging header and does not link `libnotesage_capture.a`. It does not
//  need to. The app's Rust library depends on the capture crate, and its
//  twenty `#[no_mangle]` exports survive into `libtauri_app_lib.a` — which
//  the app target already links. All that was missing was a declaration the
//  package may see, which is `CNotesageCapture`.
//

import Foundation

#if canImport(CNotesageCapture)
    import CNotesageCapture
#elseif canImport(UIKit)
    // The `#else` branch below is for the macOS check harness, which has no
    // Rust archive to call into. On iOS it would be a SILENT degradation —
    // every article row falling back to its filename, which is precisely the
    // bug this file fixes — so an app build without the module is a build
    // failure rather than a quiet one.
    #error("CNotesageCapture is missing: check the target's dependency in ios/Package.swift")
#endif

/// A saved article's list-row fields. Mirrors the crate's `CardMeta`, whose
/// serde representation is camelCase.
struct ArticleCardMeta: Decodable, Equatable {
    var title: String?
    var excerpt: String?
    var minutes: Int?
    var site: String?
    var sourceUrl: String?
}

/// The three lines an article row draws, already resolved. Built once per
/// cell configuration so the cell itself holds no formatting rules.
struct ArticleRowText: Equatable {
    var title: String
    var subtitle: String?
    var excerpt: String?
}

/// Reading-time text and the cache in front of the parse. Both are pure
/// enough to check on macOS, which `scripts/check-article-meta.sh` does.
enum ArticleMeta {
    // MARK: The row's reading line

    /// The templates the row interpolates, pushed across from the frontend's
    /// message table with the rest of the strings. They arrive WITH their
    /// placeholders intact (`t()` returns the raw template when handed no
    /// variables), so there is one translation of "{left} of {total} min
    /// left" rather than a Swedish copy in a `.strings` file that drifts.
    struct Templates {
        var minutes: String  // "{total} min"
        var minutesLeft: String  // "{left} of {total} min left"
        var read: String  // "Read"

        init(minutes: String, minutesLeft: String, read: String) {
            self.minutes = minutes
            self.minutesLeft = minutesLeft
            self.read = read
        }
    }

    /// Progress at or past this reads as "Read" — the last few percent of a
    /// capture are the footer and the clipped-from line, not the article.
    /// Same constant as `reading-progress.ts`, deliberately.
    static let readThreshold: Double = 0.97

    /// The reading part of a row's `site · …` line.
    ///
    /// - no estimate → nothing
    /// - never opened → "4 min"
    /// - part-read → "2 of 4 min left", never "0 of 4": a started article has
    ///   at least a minute left until it reads as done
    /// - at or past the threshold → "Read"
    static func readingLine(minutes: Int?, progress: Double, templates: Templates) -> String? {
        guard let minutes else { return nil }
        if progress >= readThreshold { return templates.read }
        if progress <= 0 {
            return fill(templates.minutes, ["total": String(minutes)])
        }
        let left = max(1, Int(ceil(Double(minutes) * (1 - progress))))
        return fill(templates.minutesLeft, ["left": String(left), "total": String(minutes)])
    }

    /// `{name}` → value. A placeholder with no value is left standing rather
    /// than blanked: a visible `{total}` is a bug report, an empty gap is a
    /// line nobody notices is wrong.
    static func fill(_ template: String, _ values: [String: String]) -> String {
        var out = template
        for (key, value) in values {
            out = out.replacingOccurrences(of: "{\(key)}", with: value)
        }
        return out
    }

    /// What the row shows, for a document we know is a capture.
    ///
    /// `meta` of `nil` means the read has not landed yet. The row is still
    /// drawn in the ARTICLE shape, titled with the filename minus its
    /// extension, because a `.html` in the Inbox is almost always a capture
    /// and a row that changes shape when the read lands is the jump this
    /// screen exists to remove.
    static func rowText(
        name: String, meta: ArticleCardMeta?, progress: Double, templates: Templates
    ) -> ArticleRowText {
        let fallback = name.replacingOccurrences(
            of: "\\.html?$", with: "", options: [.regularExpression, .caseInsensitive])
        let reading = readingLine(minutes: meta?.minutes, progress: progress, templates: templates)
        let parts = [meta?.site, reading].compactMap { $0 }.filter { !$0.isEmpty }
        return ArticleRowText(
            title: meta?.title?.isEmpty == false ? meta!.title! : fallback,
            subtitle: parts.isEmpty ? nil : parts.joined(separator: " · "),
            excerpt: meta?.excerpt)
    }

    // MARK: Parsing

    /// Hand the document to the capture crate's reader. `nil` means "not one
    /// of our captures" — the caller draws the plain file row.
    static func parse(_ html: String) -> ArticleCardMeta? {
        #if canImport(CNotesageCapture)
            guard let raw = html.withCString({ notesage_capture_article_card_meta($0) }) else {
                return nil
            }
            defer { notesage_capture_string_free(raw) }
            let json = String(cString: raw)
            guard let data = json.data(using: .utf8) else { return nil }
            return try? JSONDecoder().decode(ArticleCardMeta.self, from: data)
        #else
            // macOS check harness: the Rust archive is not linked there, so
            // the parse is exercised through `decode` instead.
            _ = html
            return nil
        #endif
    }

    /// Decode the ABI's JSON without calling it — the seam the check script
    /// uses, and what keeps the shape of `CardMeta` pinned on a machine with
    /// no iOS toolchain.
    static func decode(_ json: String) -> ArticleCardMeta? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(ArticleCardMeta.self, from: data)
    }

    // MARK: The cache

    /// Keyed by path AND modification time, like the web cache it replaces:
    /// a file rewritten in place (an update from source, the background image
    /// sweep) changes mtime and so misses, while leaving a folder and coming
    /// back — which re-configures every cell — hits and draws instantly.
    /// Rename and delete need no eviction; the old key stops being asked for.
    ///
    /// `.some(nil)` is a real answer — "read it, not a capture" — and must be
    /// distinguishable from "not read yet", or every plain `.html` in the
    /// Inbox is re-read and re-parsed on every scroll.
    private static var cache: [String: ArticleCardMeta?] = [:]
    private static var inFlight: Set<String> = []
    private static let lock = NSLock()
    private static let maxEntries = 1000
    private static let queue = DispatchQueue(
        label: "com.notesage.article-meta", qos: .userInitiated, attributes: .concurrent)

    /// How a document is read. A seam, not a layer: `LibraryAccess` imports
    /// UIKit, so a macOS check harness cannot compile it, and the caching
    /// rules below — which are the part with a bug in them waiting to happen —
    /// would otherwise be testable only on a device.
    #if canImport(UIKit)
        static var readDocument: (String) -> String? = { try? LibraryAccess.readFile($0) }
    #else
        static var readDocument: (String) -> String? = { _ in nil }
    #endif

    static func key(_ rel: String, modified: Double?) -> String {
        "\(rel)@\(Int(modified ?? 0))"
    }

    /// Only documents whose header could carry this. A `.md` note has no
    /// capture header, and asking for one is a file read per row for a
    /// guaranteed `nil`.
    static func isCandidate(_ relPath: String) -> Bool {
        let lower = relPath.lowercased()
        return lower.hasSuffix(".html") || lower.hasSuffix(".htm")
    }

    /// What is already known, without touching the disk — read during cell
    /// configuration so a returning row draws its title in the same frame it
    /// appears. The outer `nil` means "nothing known yet".
    static func peek(_ rel: String, modified: Double?) -> ArticleCardMeta?? {
        lock.lock()
        defer { lock.unlock() }
        return cache[key(rel, modified: modified)]
    }

    /// Read and parse off the main thread, then answer ON it. Called once per
    /// row per mtime: a second request while the first is in flight is
    /// dropped rather than queued, because the cell will be re-configured
    /// when the first lands.
    static func load(
        _ rel: String, modified: Double?, completion: @escaping (ArticleCardMeta?) -> Void
    ) {
        let cacheKey = key(rel, modified: modified)

        lock.lock()
        if let hit = cache[cacheKey] {
            lock.unlock()
            completion(hit)
            return
        }
        if inFlight.contains(cacheKey) {
            lock.unlock()
            return
        }
        inFlight.insert(cacheKey)
        lock.unlock()

        queue.async {
            let meta = readDocument(rel).flatMap(parse)
            lock.lock()
            // A capture is 200–800 KB on disk but four short strings here, so
            // the cap is about entry count, not bytes.
            if cache.count >= maxEntries { cache.removeAll(keepingCapacity: true) }
            cache[cacheKey] = .some(meta)
            inFlight.remove(cacheKey)
            lock.unlock()
            DispatchQueue.main.async { completion(meta) }
        }
    }

    /// Test seam, and what a delete or a rename calls.
    static func clearCache() {
        lock.lock()
        cache.removeAll()
        inFlight.removeAll()
        lock.unlock()
    }
}
