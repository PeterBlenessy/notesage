//
//  Exercise the folder ordering: the sort, and the five grouping modes.
//
//  This is the first piece of the native browsing surface, and it is the piece
//  most worth testing without a device: an ordering is wrong in ways a
//  screenshot does not show. A folder that shuffles between two identical
//  reads, a pinned folder that does not appear under Pinned, a month bucket in
//  the wrong place — all of those look like a working screen.
//
//  There is no XCTest target in this repo and adding one would mean a second
//  build system in CI, so this follows `check-inbox-state.sh` and
//  `check-chrome-column.sh`: compile the real source, assert against it, exit
//  non-zero on a failure. `LibraryOrdering.swift` imports Foundation and
//  nothing else precisely so this can run on macOS.
//
//  The cases come from the behaviour `LibraryBrowser.tsx` had, including the
//  two that its comments record as having been wrong once.
//
//  Named main.swift because Swift allows top-level code in that file only.
//

import Foundation

var failures = 0

func check(_ name: String, _ actual: some Equatable, _ expected: some Equatable) {
    let ok = "\(actual)" == "\(expected)"
    print("\(ok ? "ok  " : "FAIL") \(name)\(ok ? "" : "  — got \(actual), want \(expected)")")
    if !ok { failures += 1 }
}

let DAY: Double = 86_400
/// A fixed "now" so the date buckets are testable without waiting for tomorrow.
let NOW: Double = 1_757_500_000  // 2026-09-10-ish

func file(_ name: String, _ path: String? = nil, age days: Double = 0) -> LibraryEntry {
    LibraryEntry(name: name, path: path ?? name, isDirectory: false, modified: NOW - days * DAY)
}
func dir(_ name: String, _ path: String? = nil) -> LibraryEntry {
    LibraryEntry(name: name, path: path ?? name, isDirectory: true, modified: NOW)
}

func names(_ sections: [LibrarySection]) -> [String] { sections.flatMap { $0.items.map(\.name) } }
func keys(_ sections: [LibrarySection]) -> [String] { sections.map(\.key) }

// A month title the assertions can predict, standing in for the screen's
// locale-aware one.
let monthTitle: (Double) -> String = { ts in
    let c = Calendar(identifier: .gregorian).dateComponents(
        [.year, .month], from: Date(timeIntervalSince1970: ts))
    return String(format: "%04d-%02d", c.year ?? 0, c.month ?? 0)
}

// MARK: - Sorting

let mixed = [file("beta.md"), dir("Zeta"), file("Alpha.md"), dir("apple")]

check(
    "by name: folders first, then case-insensitive",
    sortLibraryEntries(mixed, by: .name).map(\.name),
    ["apple", "Zeta", "Alpha.md", "beta.md"]
)

check(
    "by modified: newest first, folders NOT hoisted",
    sortLibraryEntries(
        [file("old.md", age: 10), dir("Folder"), file("new.md", age: 1)], by: .modified
    ).map(\.name),
    ["Folder", "new.md", "old.md"]
)

// A folder that reshuffles between two identical reads reads as a bug, and
// `sorted(by:)` is not stable — so ties fall back to the path.
let ties = [file("same.md", "b/same.md", age: 3), file("same.md", "a/same.md", age: 3)]
check(
    "ties break on path, so the order is stable",
    sortLibraryEntries(ties, by: .modified).map(\.path),
    ["a/same.md", "b/same.md"]
)
check(
    "…and by name too",
    sortLibraryEntries(ties, by: .name).map(\.path),
    ["a/same.md", "b/same.md"]
)

// MARK: - Grouping: none

check(
    "none: one untitled section holding everything",
    keys(groupLibraryEntries(mixed, context: .init(group: .none, now: NOW), monthTitle: monthTitle)),
    ["all"]
)
check(
    "none: no title",
    groupLibraryEntries(mixed, context: .init(group: .none, now: NOW), monthTitle: monthTitle)[0]
        .titleKey ?? "nil",
    "nil"
)

// MARK: - Grouping: pinned

// The one recorded regression: pinning a FOLDER wrote to pins.json and then
// changed nothing on screen, because folders were hoisted out before this ran.
let pinnedCtx = LibraryOrderingContext(group: .pinned, pinned: ["apple", "beta.md"], now: NOW)
let pinnedSections = groupLibraryEntries(mixed, context: pinnedCtx, monthTitle: monthTitle)
check("pinned: sections in order", keys(pinnedSections), ["pinned", "folders", "other"])
check(
    "pinned: a pinned FOLDER appears under Pinned, not under Folders",
    pinnedSections[0].items.map(\.name).contains("apple"),
    true
)
check(
    "pinned: the unpinned folder stays under Folders",
    pinnedSections[1].items.map(\.name),
    ["Zeta"]
)
check("pinned: the rest are files", pinnedSections[2].items.map(\.name), ["Alpha.md"])

check(
    "pinned: an empty Pinned section is dropped, not shown empty",
    keys(groupLibraryEntries(mixed, context: .init(group: .pinned, now: NOW), monthTitle: monthTitle)),
    ["folders", "other"]
)

// MARK: - Grouping: recent

let recentCtx = LibraryOrderingContext(group: .recent, recentlyRead: ["Alpha.md"], now: NOW)
let recentSections = groupLibraryEntries(mixed, context: recentCtx, monthTitle: monthTitle)
check("recent: folders keep their own leading section", recentSections[0].key, "folders")
check("recent: read files lift to the top", recentSections[1].items.map(\.name), ["Alpha.md"])
check("recent: the rest follow", recentSections[2].items.map(\.name), ["beta.md"])

// MARK: - Grouping: type

let typed = [
    file("a.md"), file("b.pdf"), file("c.png"), file("d.txt"),
    file("e.html"), file("f.mp3"), file("g.docx"), file("h.bin"), dir("Folder"),
]
let typeSections = groupLibraryEntries(
    typed, context: .init(group: .type, now: NOW), monthTitle: monthTitle)
check(
    "type: a fixed reading order, so a folder does not reshuffle as its mix changes",
    keys(typeSections),
    ["folders", "markdown", "text", "pdf", "image", "media", "doc", "html", "other"]
)
check("type: kinds map as classifyFile does", LibraryFileKind.of("x.HEIC"), LibraryFileKind.image)
check("type: an exported report is html, not text", LibraryFileKind.of("r.htm"), LibraryFileKind.html)
check("type: source files are text", LibraryFileKind.of("main.swift"), LibraryFileKind.text)
check("type: unknown sinks to other", LibraryFileKind.of("x.zzz"), LibraryFileKind.other)
check("type: no extension is other", LibraryFileKind.of("Makefile"), LibraryFileKind.other)

// MARK: - Grouping: date

let dated = [
    file("today.md", age: 0),
    file("threeDays.md", age: 3),
    file("lastMonth.md", age: 40),
    file("older.md", age: 400),
    dir("Folder"),
]
let dateSections = groupLibraryEntries(
    dated, context: .init(group: .date, now: NOW), monthTitle: monthTitle)
check("date: folders lead", dateSections[0].key, "folders")
check(
    "date: the last week is one section, not one per day",
    dateSections[1].items.map(\.name).sorted(),
    ["threeDays.md", "today.md"]
)
check("date: then months", dateSections.count, 4)
check(
    "date: newest month before oldest",
    (dateSections[2].titleLiteral ?? "") > (dateSections[3].titleLiteral ?? ""),
    true
)
check(
    "date: a month section is titled literally, not by key",
    dateSections[2].titleKey ?? "nil",
    "nil"
)

// An entry the filesystem gave no date sinks rather than claiming today.
let undated = [LibraryEntry(name: "nodate.md", path: "nodate.md", isDirectory: false, modified: nil)]
let undatedSections = groupLibraryEntries(
    undated, context: .init(group: .date, now: NOW), monthTitle: monthTitle)
check(
    "date: an undated entry does not land in the last week",
    undatedSections.first?.key != "recent",
    true
)

// MARK: - Empty

check(
    "an empty folder produces one empty section, not a crash",
    groupLibraryEntries([], context: .init(group: .none, now: NOW), monthTitle: monthTitle).count,
    1
)
check(
    "an empty folder groups to nothing at all",
    groupLibraryEntries([], context: .init(group: .date, now: NOW), monthTitle: monthTitle).count,
    0
)


// What can be read aloud (#833). By EXTENSION, not by kind: `.text` also
// covers `.json`, `.rs` and `.log`, and offering to read a stack trace aloud
// is not a feature. Must agree with `isSpeakable` in FileRow.tsx, plus the
// `.html` the article row and the gallery card already offer it on.
check("speakable: a note", libraryIsSpeakable(file("a.md")), true)
check("speakable: plain text", libraryIsSpeakable(file("a.txt")), true)
check("speakable: a saved article", libraryIsSpeakable(file("a.html")), true)
check("speakable: case does not matter", libraryIsSpeakable(file("A.MD")), true)
check("speakable: not json", libraryIsSpeakable(file("a.json")), false)
check("speakable: not source", libraryIsSpeakable(file("a.swift")), false)
check("speakable: not a log", libraryIsSpeakable(file("a.log")), false)
check("speakable: not a pdf", libraryIsSpeakable(file("a.pdf")), false)
check("speakable: not an image", libraryIsSpeakable(file("a.png")), false)
check("speakable: not a folder", libraryIsSpeakable(dir("Notes")), false)


// How a folder screen refreshes after its view settings changed. Getting this
// wrong is a CRASH, not a cosmetic slip: `reconfigureItems` keeps the existing
// cell and insists on its original registration, so using it across a
// list↔gallery switch raises "Attempted to dequeue a cell for a different
// registration". Build 65's first attempt died exactly there.
check("refresh: list to gallery rebuilds the cells",
    libraryRefreshKind(layoutChanged: true, densityChanged: false), LibraryRefreshKind.reload)
check("refresh: density alone reconfigures them",
    libraryRefreshKind(layoutChanged: false, densityChanged: true), LibraryRefreshKind.reconfigure)
check("refresh: both at once still rebuilds, never reconfigures",
    libraryRefreshKind(layoutChanged: true, densityChanged: true), LibraryRefreshKind.reload)
// Sort and group move items; the snapshot expresses that by itself.
check("refresh: sort or group needs neither",
    libraryRefreshKind(layoutChanged: false, densityChanged: false), LibraryRefreshKind.none)


// Searching a folder matches what the ROW SHOWS, not just the filename.
// Reported on build 66: "searching any string that is visible in the list
// eventually hides every item" — the rows showed article titles while the
// filter read `name`, so a capture saved as a timestamped slug could not be
// found by the title printed on it, and each extra character narrowed the
// result to nothing.
let capture = LibrarySearchable(
    name: "2026-06-24-101400-gartner-ai.html",
    title: "Gartner Predicts AI Coding Costs",
    site: "gartner.com",
    excerpt: "By 2028, AI coding costs will overtake…")
let note = LibrarySearchable(name: "Gamma.md", title: nil, site: nil, excerpt: nil)

check("search: an article is found by its TITLE", libraryMatchesFilter("Gartner Predicts", capture), true)
check("search: and by its site", libraryMatchesFilter("gartner.com", capture), true)
check("search: and by its standfirst", libraryMatchesFilter("2028", capture), true)
check("search: and still by its filename", libraryMatchesFilter("101400", capture), true)
check("search: case does not matter", libraryMatchesFilter("gARTNER", capture), true)
// The exact progression that emptied the list: "G" matched an unrelated note,
// "Gar" matched nothing, because only `name` was searched.
check("search: 'G' matches the note by name", libraryMatchesFilter("G", note), true)
check("search: 'Gar' no longer matches nothing", libraryMatchesFilter("Gar", capture), true)
check("search: a miss is still a miss", libraryMatchesFilter("zzz", capture), false)
// Swedish is read as often as English here.
check("search: diacritics are ignored",
    libraryMatchesFilter("andring",
        LibrarySearchable(name: "Ändringsdatum.md", title: nil, site: nil, excerpt: nil)), true)
check("search: an empty filter keeps everything", libraryMatchesFilter("", note), true)
check("search: whitespace alone keeps everything", libraryMatchesFilter("   ", note), true)
// A note has no header; it must not be lost because the fields are nil.
check("search: a plain note still matches its name", libraryMatchesFilter("gamma", note), true)

// MARK: - Sidecar files
//
// Both of these were read with a key the desktop has never written, and both
// failed silently: Pinned was empty in a library full of pins, and every
// progress ring was empty. The literals below are copied from the shapes in
// `src/lib/pins-file.ts` and `src/lib/reading-progress-file.ts` — if either
// side renames a key, one of these fails instead of a user noticing months
// later.

check("pins: the desktop's `paths` key is read",
    parseLibraryPins(#"{"paths":["Inbox/a.html","Notes/b.md"]}"#).sorted(),
    ["Inbox/a.html", "Notes/b.md"])
// The exact bug: `pinned` is what the native screen looked for, and is not a
// key the shared serializer has ever emitted.
check("pins: the key the native screen invented finds nothing",
    parseLibraryPins(#"{"pinned":["Inbox/a.html"]}"#), Set<String>())
check("pins: an empty file is no pins, not an error",
    parseLibraryPins(#"{"paths":[]}"#), Set<String>())
check("pins: malformed JSON degrades to no pins",
    parseLibraryPins("{not json"), Set<String>())
check("pins: a missing file degrades to no pins", parseLibraryPins(""), Set<String>())

let progressJSON = #"""
{"version":2,"items":{
  "Half.html":{"fraction":0.5,"openedAt":"2026-09-01T00:00:00Z"},
  "Done.html":{"fraction":1,"openedAt":"2026-09-01T00:00:00Z"},
  "Gone.html":{"fraction":0.9,"openedAt":null,"deleted":true},
  "Fresh.html":{"fraction":0,"openedAt":null}
}}
"""#
let progress = parseLibraryReadingProgress(progressJSON)
check("progress: entries come from `items`, not the top level", progress["Half.html"] ?? -1, 0.5)
check("progress: a finished article is 1", progress["Done.html"] ?? -1, 1.0)
check("progress: an unopened article is 0", progress["Fresh.html"] ?? -1, 0.0)
// A tombstone means the desktop deleted it; the row must not resurrect it.
check("progress: tombstones are dropped", progress["Gone.html"] == nil, true)
check("progress: the version field is not an entry", progress["version"] == nil, true)
// What the native screen actually did — walk the top level for a `progress`
// key — found neither `version` nor `items`, so every ring was empty.
check("progress: the old flat shape is no longer what we write",
    parseLibraryReadingProgress(#"{"Half.html":{"progress":0.5}}"#).isEmpty, true)
check("progress: malformed JSON degrades to nothing read",
    parseLibraryReadingProgress("{not json").isEmpty, true)

// A rebuild may redraw surviving rows ONLY when nothing else is about to.
// Build 69 crashed on every list/gallery switch because a rebuild reconfigured
// cells that were about to be replaced by a different class.
check("refresh: a plain rebuild may redraw its rows",
    libraryMayReconfigure(.none), true)
check("refresh: a density change must not — its own reconfigure follows",
    libraryMayReconfigure(.reconfigure), false)
check("refresh: a LAYOUT change must not — the cell class is changing",
    libraryMayReconfigure(.reload), false)

// MARK: - Home
//
// Home is the root listing CURATED: two cards, the chosen folders, the root's
// own files, and everything else under All Folders. The rules come from
// `LibraryBrowser.tsx`, and the one worth pinning is nil-vs-empty: they look
// the same on screen and mean opposite things to the hint.

let homeRoot = [
    dir("Inbox"), dir("Recordings"), dir("Essays"), dir("Archive 2024"),
    file("Prompt library.md"),
]

check("home: never curated shows the files and no folders",
    names(libraryHomeEntries(homeRoot, home: nil).map { LibrarySection(key: "x", items: [$0]) }),
    ["Prompt library.md"])
check("home: a chosen folder is listed",
    libraryHomeEntries(homeRoot, home: ["Essays"]).map(\.name),
    ["Essays", "Prompt library.md"])
// Both are cards. Listing them too is how a folder appeared twice.
check("home: Inbox is never listed, even when chosen",
    libraryHomeEntries(homeRoot, home: ["Inbox", "Essays"]).map(\.name),
    ["Essays", "Prompt library.md"])
check("home: Recordings is never listed either",
    libraryHomeEntries(homeRoot, home: ["Recordings"]).map(\.name),
    ["Prompt library.md"])
check("home: a chosen folder that has since gone is simply absent",
    libraryHomeEntries(homeRoot, home: ["Deleted"]).map(\.name),
    ["Prompt library.md"])

check("home file: folders are read in order",
    parseLibraryHome(#"{"version":1,"folders":["Essays","Archive 2024"]}"#) ?? [],
    ["Essays", "Archive 2024"])
check("home file: duplicates collapse",
    parseLibraryHome(#"{"version":1,"folders":["A","A","B"]}"#) ?? [],
    ["A", "B"])
// nil and [] look identical on screen and mean opposite things to the hint.
check("home file: an empty list is a CHOICE, not silence",
    parseLibraryHome(#"{"version":1,"folders":[]}"#) != nil, true)
check("home file: a missing file is silence", parseLibraryHome("") == nil, true)
check("home file: malformed is silence", parseLibraryHome("{oops") == nil, true)
check("home file: another version is silence",
    parseLibraryHome(#"{"version":2,"folders":["A"]}"#) == nil, true)

check("home hint: speaks before any choice is made",
    libraryHomeHintApplies(entries: homeRoot, home: nil, dismissed: false), true)
check("home hint: silent once a choice exists",
    libraryHomeHintApplies(entries: homeRoot, home: [], dismissed: false), false)
check("home hint: silent once dismissed",
    libraryHomeHintApplies(entries: homeRoot, home: nil, dismissed: true), false)
// A root holding only the Inbox hides nothing, so there is nothing to point at.
check("home hint: silent when there is no folder it could mean",
    libraryHomeHintApplies(entries: [dir("Inbox"), file("a.md")], home: nil, dismissed: false),
    false)

// MARK: - Folder appearance
//
// Read-only: the desktop sets a folder's icon and colour (#140) in
// `<folder>/.notesage/project.json`, and the phone shows it. The literals
// below come from `src/lib/folder-icon.ts`, so a rename on either side fails
// here rather than silently reverting a folder to the default.

check("appearance: an icon name maps to an SF Symbol",
    parseLibraryFolderAppearance(#"{"appearance":{"iconName":"Rocket"}}"#).symbol ?? "",
    "paperplane")
check("appearance: a colour index is kept",
    parseLibraryFolderAppearance(#"{"appearance":{"colorIndex":5}}"#).colorIndex ?? -1, 5)
check("appearance: both together",
    parseLibraryFolderAppearance(#"{"appearance":{"iconName":"Leaf","colorIndex":3}}"#),
    LibraryFolderAppearance(symbol: "leaf", colorIndex: 3))
// Independently optional on the desktop, so independently optional here.
check("appearance: an icon alone leaves the colour unset",
    parseLibraryFolderAppearance(#"{"appearance":{"iconName":"Star"}}"#).colorIndex == nil, true)
// An unknown name is the DEFAULT, never a guess: a folder wearing the wrong
// picture is worse than one wearing the plain folder.
check("appearance: an unknown icon falls back rather than approximating",
    parseLibraryFolderAppearance(#"{"appearance":{"iconName":"Nonesuch"}}"#).symbol == nil, true)
check("appearance: an index outside the palette is ignored",
    parseLibraryFolderAppearance(#"{"appearance":{"colorIndex":99}}"#).colorIndex == nil, true)
check("appearance: a negative index is ignored",
    parseLibraryFolderAppearance(#"{"appearance":{"colorIndex":-1}}"#).colorIndex == nil, true)
check("appearance: a project.json without one is empty",
    parseLibraryFolderAppearance(#"{"version":1}"#).isEmpty, true)
check("appearance: malformed JSON is empty", parseLibraryFolderAppearance("{oops").isEmpty, true)
check("appearance: a missing file is empty", parseLibraryFolderAppearance("").isEmpty, true)
// The palette is the desktop's, converted once. Eight, in its order.
check("appearance: eight colours, Red first and Pink last",
    libraryFolderTagColors.count, 8)
// Read the DESKTOP's list and require every name in it, rather than pinning a
// count. Adding an icon there and forgetting it here would otherwise show up
// as one folder quietly wearing the default, on a phone, months later.
// `#filePath`, not a path relative to the working directory: this binary is
// built into a temp dir and run from wherever the caller happened to be.
let repoRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // library-ordering-check/
    .deletingLastPathComponent()  // scripts/
    .deletingLastPathComponent()  // repo root
let iconSource =
    (try? String(
        contentsOf: repoRoot.appendingPathComponent("src/lib/folder-icon.ts"),
        encoding: .utf8)) ?? ""
// From the FIRST mention to the end: the name appears again further down in
// a lookup, and taking the last block found a slice with no entries in it.
let curatedBlock =
    iconSource.range(of: "CURATED_FOLDER_ICONS").map { String(iconSource[$0.lowerBound...]) } ?? ""
var curatedNames: [String] = []
for line in curatedBlock.components(separatedBy: "\n") {
    // A curated entry is `{ name: 'X', icon: Y }` — requiring BOTH keeps
    // unrelated `name:` lines elsewhere in the file out of the list.
    guard line.contains("icon:"), let r = line.range(of: "name: '") else { continue }
    let rest = line[r.upperBound...]
    guard let end = rest.firstIndex(of: "'") else { continue }
    curatedNames.append(String(rest[..<end]))
}
check("appearance: the desktop's list was readable", curatedNames.count > 40, true)
let unmapped = curatedNames.filter { librarySymbolForFolderIcon[$0] == nil }
check("appearance: every curated icon has an SF Symbol", unmapped.joined(separator: ","), "")

print(failures == 0 ? "\nall good" : "\n\(failures) failed")
exit(failures == 0 ? 0 : 1)
