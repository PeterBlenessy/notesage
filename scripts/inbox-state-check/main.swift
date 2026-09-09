//  Exercise InboxState against a real filesystem.
//
//  `InboxState.swift` decides the app icon badge and is compiled into the app,
//  the background refresh and the Share Extension. It had no automated test of
//  any kind (#933) — and its sidecar read has been wrong twice in the same
//  spot, both times producing the same user-visible failure: the badge frozen
//  at the Inbox's file count for ever, because reading writes a sidecar the
//  counter could not open.
//
//  There is no XCTest target in this repo and adding one would mean a second
//  build system in CI, so this follows the pattern established by
//  `scripts/check-macos-share-library.sh`: compile the real source, run it
//  against real files in a temp directory, exit non-zero on a failure.
//
//  What it cannot cover, and why:
//    * the iCloud download gate itself — creating an evicted placeholder needs
//      a real ubiquity container. The shape of that gate is locked instead by
//      `src/lib/__tests__/inbox-download-gate.test.ts`.
//    * `InboxState.Prefs` — it reads the App Group suite by a hardcoded name,
//      which resolves to nil without the entitlement, so every getter would
//      return its default and the test would assert nothing.
//
//  Named main.swift because Swift allows top-level code in that file only.

import Foundation

var failures = 0

func check(_ name: String, _ actual: some Equatable, _ expected: some Equatable) {
    let ok = "\(actual)" == "\(expected)"
    if !ok { failures += 1 }
    print("\(ok ? "ok  " : "FAIL") \(name)\(ok ? "" : " — got \(actual), want \(expected)")")
}

let fm = FileManager.default
let root = URL(fileURLWithPath: NSTemporaryDirectory())
    .appendingPathComponent("notesage-inbox-check-\(UUID().uuidString)")
let inbox = root.appendingPathComponent("Inbox")
try! fm.createDirectory(at: inbox.appendingPathComponent(".notesage"), withIntermediateDirectories: true)
defer { try? fm.removeItem(at: root) }

func write(_ url: URL, _ text: String) {
    try! text.data(using: .utf8)!.write(to: url, options: .atomic)
}

// MARK: - displayName

check("a plain name is unchanged", InboxState.displayName("Article.html"), "Article.html")
check("a placeholder reveals its real name",
      InboxState.displayName(".Article.html.icloud"), "Article.html")
check("a dotfile that is not a placeholder is left alone",
      InboxState.displayName(".DS_Store"), ".DS_Store")

// MARK: - names

write(inbox.appendingPathComponent("Beta.html"), "b")
write(inbox.appendingPathComponent("Alpha.md"), "a")
write(inbox.appendingPathComponent(".Gamma.html.icloud"), "")   // evicted
write(inbox.appendingPathComponent(".DS_Store"), "")            // noise
try! fm.createDirectory(at: inbox.appendingPathComponent("Nested"), withIntermediateDirectories: true)

// Sorted, directories and dotfiles dropped, the placeholder under its real
// name — an evicted item still counts, or the badge would drop as iCloud
// reclaimed space.
check("names lists files only, placeholders included, sorted",
      InboxState.names(root: root), ["Alpha.md", "Beta.html", "Gamma.html"])
check("a missing Inbox is empty rather than an error",
      InboxState.names(root: root.appendingPathComponent("nope")), [String]())

// MARK: - isUnread

check("no entry is unread", InboxState.isUnread(nil), true)
check("a tombstone is unread", InboxState.isUnread(["deleted": true]), true)
check("openedAt null is unread", InboxState.isUnread(["openedAt": NSNull()]), true)
check("a missing openedAt is unread", InboxState.isUnread(["fraction": 0.5]), true)
check("an opened item is read", InboxState.isUnread(["openedAt": "2026-09-09T10:00:00Z"]), false)

// MARK: - progressItems

let sidecar = root.appendingPathComponent(InboxState.sidecarRel)
check("no sidecar yet is empty, not a crash", InboxState.progressItems(root: root).count, 0)

write(sidecar, "{ not json")
check("a malformed sidecar is empty, the same tolerance the TS parser has",
      InboxState.progressItems(root: root).count, 0)

write(sidecar, #"{"version":1}"#)
check("a sidecar with no items key is empty", InboxState.progressItems(root: root).count, 0)

write(sidecar, #"{"items":{"Alpha.md":{"openedAt":"2026-09-09T10:00:00Z"},"Beta.html":{"openedAt":null}}}"#)
check("items are read back", InboxState.progressItems(root: root).count, 2)

// MARK: - unreadCount, end to end

// Alpha opened; Beta explicitly never opened; Gamma has no entry at all.
check("unread counts every file the sidecar does not say was opened",
      InboxState.unreadCount(root: root), 2)

write(sidecar, #"{"items":{"Alpha.md":{"openedAt":"x"},"Beta.html":{"openedAt":"y"},"Gamma.html":{"openedAt":"z"}}}"#)
check("reading everything takes the badge to zero", InboxState.unreadCount(root: root), 0)

// The regression that has happened twice, in its observable form: a sidecar
// the reader cannot open must not silently mean "nothing has been read".
write(sidecar, #"{"items":{"Alpha.md":{"openedAt":"x"},"Beta.html":{"openedAt":"y"},"Gamma.html":{"deleted":true}}}"#)
check("a tombstone counts as unread again", InboxState.unreadCount(root: root), 1)

if failures > 0 {
    FileHandle.standardError.write("\(failures) check(s) failed\n".data(using: .utf8)!)
    exit(1)
}
print("all checks passed")
