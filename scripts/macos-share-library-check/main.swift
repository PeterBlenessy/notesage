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

// The container needs no security scope, and asking for one answers false —
// which the code this replaced read as a stale grant and turned into a failed
// share for every capture. Told apart by which root came back, not by that
// return value.
if fm.fileExists(atPath: container.path) {
    do {
        let scope = try ShareLibraryAccess.openScope(container)
        let ok = !scope.neededScope
        if !ok { failures += 1 }
        print("\(ok ? "ok  " : "FAIL") the container opens with no security scope")
        scope.close()
    } catch {
        failures += 1
        print("FAIL the container should not need a security scope — \(error)")
    }
}

// A folder that is not the container must take the BOOKMARK branch, whatever
// that branch then decides.
//
// Deliberately not asserted as "refused": whether
// `startAccessingSecurityScopedResource()` answers false for an arbitrary URL
// depends on the sandbox, and this harness is unsandboxed, where it is a no-op
// that returns true. (Found by running it — the first version of this case
// asserted a refusal and failed here while being correct in the extension.)
// What holds in both worlds is which branch was taken, so that is what is
// checked: the wrong answer is succeeding with no scope, which would mean a
// random folder was mistaken for the container.
do {
    let scope = try ShareLibraryAccess.openScope(plain)
    if scope.neededScope {
        print("ok   a non-container folder goes through the security scope")
    } else {
        failures += 1
        print("FAIL a non-container folder was treated as the entitled container")
    }
    scope.close()
} catch {
    print("ok   a non-container folder is refused without a usable scope")
}

if failures > 0 {
    FileHandle.standardError.write("\(failures) check(s) failed\n".data(using: .utf8)!)
    exit(1)
}
print("all checks passed")
