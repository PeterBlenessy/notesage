//
//  How a folder's entries are ordered and sectioned.
//
//  Ported from `LibraryBrowser.tsx` — `sortEntries` and `groupEntries` — as
//  the first piece of the native browsing surface (PRD
//  `2026-09-11-native-browsing-surface.md`). It is the only part of that
//  component that is logic rather than markup: the other ~1,400 lines are JSX,
//  chrome wiring and effects, which a native screen does not have.
//
//  Deliberately free of UIKit, Foundation's UI layers and the library itself:
//  in, a list of entries and the current settings; out, sections. That is what
//  lets `scripts/check-library-ordering.sh` compile and run it on macOS, the
//  pattern `check-inbox-state.sh` and `check-chrome-column.sh` established.
//  Ordering is exactly the kind of thing that is wrong in ways a screenshot
//  does not show.
//
//  Section TITLES are not decided here. They are message keys, resolved by the
//  screen against the localisation table, for the same reason the chrome spec
//  carries keys rather than strings: a title resolved at the wrong moment
//  freezes the language the process started in.
//

import Foundation

// MARK: - Inputs

enum LibrarySortMode: String, Codable {
    case name
    case modified
}

enum LibraryGroupMode: String, Codable {
    case none
    case pinned
    case recent
    case date
    case type
}

/// What a file's extension says it is. Mirrors `classifyFile` in `FileRow.tsx`
/// — the kinds are the source of truth for the `type` grouping, and for which
/// thumbnail pipeline a cell uses.
enum LibraryFileKind: String, CaseIterable {
    case markdown, text, pdf, image, media, doc, html, other

    /// Fixed reading order for the `type` grouping, so a listing does not
    /// reshuffle as a folder's mix changes.
    static let sectionOrder: [LibraryFileKind] = [
        .markdown, .text, .pdf, .image, .media, .doc, .html, .other,
    ]

    static func of(_ name: String) -> LibraryFileKind {
        let ext = (name as NSString).pathExtension.lowercased()
        switch ext {
        case "md", "markdown": return .markdown
        case "pdf": return .pdf
        case "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic", "tif", "tiff":
            return .image
        case "epub", "docx", "pptx", "odt", "odp", "rtf": return .doc
        case "mp4", "mov", "m4v", "avi", "mkv", "webm",
             "m4a", "mp3", "wav", "aac", "aiff", "flac", "caf":
            return .media
        // Rendered, not shown as source: an exported report is self-contained
        // HTML whose charts are inline scripts.
        case "html", "htm": return .html
        case "txt", "text", "log", "csv", "json", "yaml", "yml", "toml", "xml",
             "css", "js", "jsx", "ts", "tsx", "rs", "py", "go", "java",
             "c", "cpp", "h", "sh", "sql", "swift", "kt", "rb", "php":
            return .text
        default: return .other
        }
    }
}

/// How a folder screen must refresh itself after its view settings changed.
///
/// The distinction is not cosmetic, it is a crash. `reconfigureItems` keeps
/// the EXISTING cell and insists on the registration it was created with, so
/// using it across a list↔gallery switch — where the provider now answers
/// with a different cell class — raises:
///
///   "Attempted to dequeue a cell for a different registration or reuse
///    identifier than the existing cell when reconfiguring an item"
///
/// which is how build 65's first attempt died the moment Gallery was chosen.
/// A density change keeps the same cell class and only alters what it draws,
/// so there `reconfigure` is right — and necessary, because a diffable data
/// source will not redraw an item whose identity did not move.
enum LibraryRefreshKind: Equatable {
    /// Sort or group only: the snapshot already says everything.
    case none
    /// Same cells, different contents — density.
    case reconfigure
    /// Different cell class — list↔gallery.
    case reload
}

func libraryRefreshKind(layoutChanged: Bool, densityChanged: Bool) -> LibraryRefreshKind {
    // Layout wins: when both changed, the cells are being replaced anyway.
    if layoutChanged { return .reload }
    if densityChanged { return .reconfigure }
    return .none
}

/// Whether a rebuild of the snapshot may also REDRAW the rows that survived it.
///
/// Only when nothing else is about to redraw them. A rebuild that precedes a
/// refresh must leave the cells alone: `.reload` is a cell-class change, and
/// asking UIKit to re-apply a configuration to cells it is about to replace
/// with a different class is the crash this enum exists to prevent.
///
/// Build 69 shipped exactly that. A rebuild was given a reconfigure so that
/// sidecar-driven text (reading progress) would redraw, and it ran on the
/// settings path too — so every list↔gallery switch crashed. The rule is a
/// function rather than a condition at the call site because that is where it
/// was already written down once, in a comment, and still got broken.
func libraryMayReconfigure(_ refresh: LibraryRefreshKind) -> Bool { refresh == .none }

/// What a row shows, for the purpose of searching it.
///
/// Every field the row DRAWS, not just the filename. A saved article's row is
/// titled with the article's own title and carries its site and standfirst —
/// so filtering on `name` alone means typing what you can plainly see matches
/// nothing, and each further character narrows the result until the list is
/// empty. That is exactly what a folder of captures did: the file behind
/// "Gartner Predicts AI Coding Costs" is a timestamped slug, so "G" still
/// matched an unrelated `Gamma.md` and "Gar" matched nothing at all.
struct LibrarySearchable {
    var name: String
    var title: String?
    var site: String?
    var excerpt: String?
}

/// Case- AND diacritic-insensitive: the library is read in Swedish as often as
/// in English, and "Ändringsdatum" should be reachable by typing "andring".
func libraryMatchesFilter(_ filter: String, _ fields: LibrarySearchable) -> Bool {
    let needle = filter.trimmingCharacters(in: .whitespaces)
    guard !needle.isEmpty else { return true }
    let haystacks = [fields.name, fields.title, fields.site, fields.excerpt].compactMap { $0 }
    return haystacks.contains {
        $0.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) != nil
    }
}

/// Can this be read aloud (#833)?
///
/// By EXTENSION, not by `LibraryFileKind`, and deliberately so: `.text` also
/// covers `.json`, `.rs` and `.log`, and offering to read a stack trace aloud
/// is not a feature. Prose only — notes, plain text, and a saved article.
///
/// The same set as `isSpeakable` in `FileRow.tsx` plus the `.html` the
/// article row and the gallery card already offer it on. The two must agree:
/// a control that appears in the list and not in the gallery is a bug report.
func libraryIsSpeakable(_ entry: LibraryEntry) -> Bool {
    guard !entry.isDirectory else { return false }
    let ext = (entry.name as NSString).pathExtension.lowercased()
    return ["md", "markdown", "txt", "text", "html", "htm"].contains(ext)
}

/// Everything the ordering needs about one entry. A projection of
/// `FileEntryDTO`, so the logic can be exercised without a library.
struct LibraryEntry: Equatable {
    let name: String
    /// Relative to the library root — the identity used everywhere.
    let path: String
    let isDirectory: Bool
    /// Seconds since 1970; `nil` when the filesystem did not say.
    let modified: Double?
}

/// The settings that drive ordering, plus the two path sets that only the app
/// knows. `pinned` comes from `.notesage/pins.json` and `recentlyRead` from
/// this device — both are inputs, never decided here.
struct LibraryOrderingContext {
    let sort: LibrarySortMode
    let group: LibraryGroupMode
    let pinned: Set<String>
    let recentlyRead: Set<String>
    /// Now, as seconds since 1970. A parameter rather than `Date()` so the
    /// date buckets can be tested without waiting for tomorrow.
    let now: Double

    init(
        sort: LibrarySortMode = .name,
        group: LibraryGroupMode = .none,
        pinned: Set<String> = [],
        recentlyRead: Set<String> = [],
        now: Double = Date().timeIntervalSince1970
    ) {
        self.sort = sort
        self.group = group
        self.pinned = pinned
        self.recentlyRead = recentlyRead
        self.now = now
    }
}

// MARK: - Output

/// One titled run of entries. `titleKey` is a message key, or `nil` for the
/// single untitled section the `none` grouping produces.
struct LibrarySection: Equatable {
    let key: String
    let titleKey: String?
    /// Set for a date section, whose title is a month name rather than a
    /// fixed phrase and so cannot be a key.
    let titleLiteral: String?
    let items: [LibraryEntry]

    init(key: String, titleKey: String? = nil, titleLiteral: String? = nil, items: [LibraryEntry]) {
        self.key = key
        self.titleKey = titleKey
        self.titleLiteral = titleLiteral
        self.items = items
    }
}

// MARK: - Sorting

/// Order a folder's entries.
///
/// Alphabetical mirrors the desktop — folders first. Modified is newest-first
/// with folders and files interleaved, matching the Files app. Both are
/// stable: `sorted(by:)` is not, so ties fall back to the path, or a listing
/// would shuffle between two identical reads.
func sortLibraryEntries(_ entries: [LibraryEntry], by mode: LibrarySortMode) -> [LibraryEntry] {
    switch mode {
    case .modified:
        return entries.sorted { a, b in
            let am = a.modified ?? 0, bm = b.modified ?? 0
            if am != bm { return am > bm }
            return a.path < b.path
        }
    case .name:
        return entries.sorted { a, b in
            if a.isDirectory != b.isDirectory { return a.isDirectory }
            let c = a.name.compare(b.name, options: [.caseInsensitive, .diacriticInsensitive])
            if c != .orderedSame { return c == .orderedAscending }
            return a.path < b.path
        }
    }
}

// MARK: - Grouping

/// Split already-sorted entries into titled sections.
///
/// Folders keep their own leading section in every mode but `pinned` —
/// grouping files under date headers while folders float loose reads as a bug.
///
/// `pinned` is the exception on purpose: a pinned FOLDER belongs in the Pinned
/// section. Hoisting folders out first meant pinning one wrote to `pins.json`
/// and then changed nothing on screen, which read as "folders cannot be
/// pinned" (Peter, 2026-08-14).
func groupLibraryEntries(
    _ entries: [LibraryEntry],
    context ctx: LibraryOrderingContext,
    monthTitle: (Double) -> String
) -> [LibrarySection] {
    if ctx.group == .none {
        return [LibrarySection(key: "all", items: entries)]
    }

    let folders = entries.filter(\.isDirectory)
    let files = entries.filter { !$0.isDirectory }
    var sections: [LibrarySection] = []

    if ctx.group == .pinned {
        let inPinned = entries.filter { ctx.pinned.contains($0.path) }
        let restFolders = folders.filter { !ctx.pinned.contains($0.path) }
        let restFiles = files.filter { !ctx.pinned.contains($0.path) }
        if !inPinned.isEmpty {
            sections.append(LibrarySection(key: "pinned", titleKey: "section.pinned", items: inPinned))
        }
        if !restFolders.isEmpty {
            sections.append(LibrarySection(key: "folders", titleKey: "section.folders", items: restFolders))
        }
        if !restFiles.isEmpty {
            sections.append(LibrarySection(key: "other", titleKey: "section.allNotes", items: restFiles))
        }
        return sections
    }

    if !folders.isEmpty {
        sections.append(LibrarySection(key: "folders", titleKey: "section.folders", items: folders))
    }

    switch ctx.group {
    case .recent:
        let inRecent = files.filter { ctx.recentlyRead.contains($0.path) }
        let rest = files.filter { !ctx.recentlyRead.contains($0.path) }
        if !inRecent.isEmpty {
            sections.append(LibrarySection(key: "recent", titleKey: "section.recent", items: inRecent))
        }
        if !rest.isEmpty {
            sections.append(LibrarySection(key: "other", titleKey: "section.allNotes", items: rest))
        }

    case .type:
        var byKind: [LibraryFileKind: [LibraryEntry]] = [:]
        for file in files { byKind[LibraryFileKind.of(file.name), default: []].append(file) }
        for kind in LibraryFileKind.sectionOrder {
            guard let items = byKind[kind], !items.isEmpty else { continue }
            sections.append(
                LibrarySection(key: kind.rawValue, titleKey: "section.kind.\(kind.rawValue)", items: items))
        }

    case .date:
        // "Recently changed" for the last week, then one section per month.
        // Coarser than Today / Yesterday / Previous 7 Days, and deliberately
        // so: the rows carry no date line, so the header is the ONLY place a
        // date shows, and a header that changes every day fragments a folder
        // into slivers. Months are stable and scannable.
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let startOfToday = calendar.startOfDay(for: Date(timeIntervalSince1970: ctx.now))
            .timeIntervalSince1970
        let weekAgo = startOfToday - 6 * 86_400

        var recent: [LibraryEntry] = []
        // Ordered buckets: newest month first, which the incoming sort
        // already guarantees for `modified` and which the sort key below
        // guarantees for `name`.
        var monthKeys: [String] = []
        var months: [String: (sortKey: Double, items: [LibraryEntry])] = [:]

        for file in files {
            let m = file.modified ?? 0
            if m >= weekAgo {
                recent.append(file)
                continue
            }
            let comps = calendar.dateComponents([.year, .month], from: Date(timeIntervalSince1970: m))
            let key = String(format: "%04d-%02d", comps.year ?? 0, comps.month ?? 0)
            if months[key] == nil {
                monthKeys.append(key)
                months[key] = (sortKey: m, items: [])
            }
            months[key]?.items.append(file)
            // Keep the newest timestamp in the bucket as its sort key.
            if let existing = months[key]?.sortKey, m > existing { months[key]?.sortKey = m }
        }

        if !recent.isEmpty {
            sections.append(LibrarySection(key: "recent", titleKey: "section.recentlyChanged", items: recent))
        }
        for key in monthKeys.sorted(by: { (months[$0]?.sortKey ?? 0) > (months[$1]?.sortKey ?? 0) }) {
            guard let bucket = months[key] else { continue }
            sections.append(
                LibrarySection(
                    key: key, titleLiteral: monthTitle(bucket.sortKey), items: bucket.items))
        }

    case .none, .pinned:
        break  // handled above
    }

    return sections
}

// MARK: - Sidecar files

// The two files the desktop writes and the folder screen reads. Both are
// parsed here, UIKit-free, because both were read with the WRONG KEY by the
// native screen for as long as it existed: the format is defined in
// `src/lib/pins-file.ts` and `src/lib/reading-progress-file.ts`, and the
// React browser these screens replaced used those parsers directly. Nothing
// in Swift was checking the shape, so both failures were silent — a Pinned
// section that is always empty, and rings that never fill.

/// Paths pinned on the desktop, from `.notesage/pins.json`.
///
/// The shared format is `{ "paths": ["Inbox/a.html", …] }`. The native reader
/// looked for `pinned`, a key the desktop has never written, so Group by →
/// Pinned found nothing even in a library full of pins.
///
/// A malformed or missing file means "nothing is pinned", never an error: a
/// browser that refuses to list a folder because a preferences file is odd is
/// worse than one that shows nothing pinned.
func parseLibraryPins(_ json: String) -> Set<String> {
    guard let data = json.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let list = object["paths"] as? [String]
    else { return [] }
    return Set(list.filter { !$0.isEmpty })
}

/// Reading progress by file NAME, from `Inbox/.notesage/reading-progress.json`.
///
/// `{ "version": 2, "items": { "<file name>": { "fraction": 0.42, … } } }`.
/// The native reader walked the TOP level looking for a `progress` key, so it
/// saw `version` and `items`, matched neither, and every row drew an empty
/// ring.
///
/// Keyed by file name rather than relative path on purpose — that is what the
/// desktop writes, so a capture keeps its progress when it is filed out of the
/// Inbox. `deleted` entries are tombstones for a sync that has not reached
/// this device yet; `liveEntry` drops them on the desktop and so do we.
func parseLibraryReadingProgress(_ json: String) -> [String: Double] {
    guard let data = json.data(using: .utf8),
        let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let items = root["items"] as? [String: Any]
    else { return [:] }
    var values: [String: Double] = [:]
    for (name, value) in items {
        guard let entry = value as? [String: Any], entry["deleted"] == nil,
            let fraction = entry["fraction"] as? Double
        else { continue }
        values[name] = min(max(fraction, 0), 1)
    }
    return values
}
