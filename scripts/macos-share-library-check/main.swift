//  Exercise the macOS Share Extension's "is this still the library?" rule
//  against real paths on this machine.
//
//  Why this exists: the extension has no test target, and the rule it checks
//  is what stands between a shared article and silent loss. On 2026-09-09 a
//  security-scoped bookmark followed the old library into
//  `~/Library/Mobile Documents/.Trash/Notesage` — resolving cleanly, reporting
//  every capture as saved — and two articles landed on iCloud's 30-day delete
//  timer. Reasoning about that rule is not the same as running it.
//
//  Run:  scripts/check-macos-share-library.sh
//
//  Named `main.swift` because Swift allows top-level code in that file only.
//
//  Reads only; creates its fixtures under a temporary directory.

import Foundation

var failures = 0

func check(_ name: String, _ url: URL, shouldThrow: Bool) {
    var threw = false
    do { try ShareLibraryAccess.validateLiveLibrary(url) } catch { threw = true }
    let ok = threw == shouldThrow
    if !ok { failures += 1 }
    let verdict = threw ? "rejected" : "accepted"
    print("\(ok ? "ok  " : "FAIL") \(name): \(verdict) — \(url.path)")
}

let fm = FileManager.default
let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
    .appendingPathComponent("notesage-share-check-\(UUID().uuidString)")
try? fm.createDirectory(at: tmp, withIntermediateDirectories: true)
defer { try? fm.removeItem(at: tmp) }

// A perfectly ordinary library folder: accepted, unless this Mac has migrated
// into the container — in which case any root outside it is superseded, which
// is the whole point of rule 3.
let plain = tmp.appendingPathComponent("Notesage")
try? fm.createDirectory(at: plain, withIntermediateDirectories: true)

// A trashed library: the exact shape of the 2026-09-09 failure.
let trashed = tmp.appendingPathComponent(".Trash/Notesage")
try? fm.createDirectory(at: trashed, withIntermediateDirectories: true)

// A library that no longer exists.
let missing = tmp.appendingPathComponent("Gone")

check("a folder in the Trash", trashed, shouldThrow: true)
check("a folder that no longer exists", missing, shouldThrow: true)

let container = fm.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Mobile Documents/iCloud~com~notesage~app/Documents")
let marker = container.appendingPathComponent(".notesage/library.json")
let migrated = (try? Data(contentsOf: marker))
    .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    .map { !(($0?["migratedFrom"] as? String) ?? "").isEmpty } ?? false

if migrated {
    print("note: this Mac's library HAS migrated into the container")
    check("a plain folder outside the container", plain, shouldThrow: true)
    check("the container itself", container, shouldThrow: false)
} else {
    print("note: this Mac's library has NOT migrated into the container")
    check("a plain folder", plain, shouldThrow: false)
}

if failures > 0 {
    FileHandle.standardError.write("\(failures) check(s) failed\n".data(using: .utf8)!)
    exit(1)
}
print("all checks passed")
