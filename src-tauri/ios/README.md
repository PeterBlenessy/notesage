# iOS native wiring (Notesage mobile)

Reference Swift sources + the steps to wire the iOS app's native layer for the
Notesage mobile reader + share capture. PRD:
`docs/prds/2026-06-28-ios-mobile-app.md`. Tasks: #1–#9 in
`docs/tasks/2026-06-28-ios-mobile-app-tasks.md`.

> **Status: integrated and device-validated.** The generated iOS project
> (`src-tauri/gen/apple/`, gitignored) is produced by `tauri ios init` on a
> Mac; the library bridge wires automatically via the plugin crate, and the
> Share Extension wires via `integrate-share-extension.py` (below). Nothing
> here needs hand-editing in Xcode. On non-Mac platforms the Rust command
> layer still compiles everywhere and the iOS commands return a clear
> platform error.

## Why a folder picker at all?

The library lives at a fixed location (`iCloud Drive/Notesage`), but a sandboxed
iOS app **cannot** open a hardcoded path inside the generic iCloud Drive
(`com~apple~CloudDocs`). The only supported route is a user-granted,
security-scoped folder access via `UIDocumentPickerViewController`, persisted as
a security-scoped **bookmark**. The picker is pre-pointed at `iCloud
Drive/Notesage`, so it is a one-time confirm, not a hunt. The bookmark is stored
in an **App Group** container so the Share Extension can use the same grant.

## Wiring steps (on a Mac)

Most of what this section used to describe is now automatic. The iOS bridge is
a **plugin crate** — `src-tauri/crates/tauri-plugin-notesage-ios` — whose
`build.rs` calls `.ios_path("ios")`. That is what makes Tauri add its Swift
Package to the generated Xcode project *and* resolve the `@_cdecl` entry point
at link time.

> Why it matters: loose `.swift` files added to the app target by hand do
> compile, but the Rust half links independently and fails with an undefined
> `init_plugin_notesage` that never mentions Swift. An earlier revision of this
> branch spent a long time on that symptom. Do not re-introduce hand-added
> Swift; add to the plugin package instead.

```bash
pnpm tauri:ios:init                  # generates src-tauri/gen/apple (gitignored)
pnpm tauri ios build --target aarch64-sim
```

The app builds, installs and launches with the library bridge wired. No
project.yml patching, no manual target membership, no bridging-header setup.

### The Share Extension: one script, no Xcode GUI

`tauri ios init` does not create extension targets, but the generated project
is xcodegen-driven — so the extension is wired declaratively instead of by
hand:

```bash
python3 src-tauri/ios/integrate-share-extension.py   # after `tauri ios init`; idempotent
```

The script adds a `NotesageShare` app-extension target to
`gen/apple/project.yml` (sources: `ShareViewController.swift`,
`LibraryCapture.swift`, and the plugin package's `LibraryAccess.swift`;
bridging header `NotesageCapture.h`; a cargo build phase that produces
`libnotesage_capture.a` for the SDK being built), adds the App Group
entitlement to the main app (which writes the shared bookmark the extension
resolves), registers the extension as an embedded dependency of the app
target, and re-runs `xcodegen generate`. Only the extension links the capture
staticlib — the app never captures, which is why `LibraryCapture.swift` is
split out of `LibraryAccess.swift`.

`ShareExtension-Info.plist` and `ShareExtension.entitlements` in this folder
remain the reference the script's generated files mirror. After running it,
build + validate on device: grant persistence, iCloud download, capture from
Safari.

## Path contract

All `rel` paths are **relative to the granted library root**, `/`-separated.
The Rust layer (`sanitize_rel_path`) already rejects absolute paths and `..`
traversal before calling the bridge — the Swift side can treat `rel` as trusted
and resolve it against the bookmarked root URL.

## Capture format

**One implementation, in Rust.** The note's filename and contents come from
`src-tauri/crates/notesage-capture` — a dependency-free crate exposed over a C
ABI (`NotesageCapture.h`) that `LibraryAccess.writeCapture` calls. The filename
rule is `Inbox/YYYY-MM-DD-HHmmss-<slug>.md`.

Swift owns only what it must: resolving the security-scoped root, disambiguating
a same-second filename collision, and the coordinated write. Those need the
bookmark and `NSFileCoordinator`, which have no Rust equivalent here.

This split is deliberate. The format is shared with what the desktop workflows
(`download-webpage`, `save-research`) expect from a `type: capture` note, and an
earlier revision of this branch carried a **second** implementation in Swift.
Two copies of a format drift silently, and only the Rust one had tests — so the
tested implementation was not the one that shipped.
