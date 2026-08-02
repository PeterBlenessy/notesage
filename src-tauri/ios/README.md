# iOS native wiring (Notesage mobile)

Reference Swift sources + the steps to wire the iOS app's native layer for the
Notesage mobile reader + share capture. PRD:
`docs/prds/2026-06-28-ios-mobile-app.md`. Tasks: #1–#9 in
`docs/tasks/2026-06-28-ios-mobile-app-tasks.md`.

> **These files are staged, not yet integrated.** The generated iOS project
> (`src-tauri/gen/apple/`) does not exist until you run `tauri ios init` on a
> **Mac with Xcode + an Apple Developer signing identity**. Everything here must
> be wired by hand into that generated project — it cannot be built or validated
> in a Linux/CI container. The Rust command layer
> (`src-tauri/src/commands/ios_library.rs`) already compiles on every platform
> and returns a clear "not yet wired" error until these are integrated.

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

### Still manual: the Share Extension

`tauri ios init` does not create extension targets, so this part is unchanged:

1. `File → New → Target → Share Extension`.
2. Add `ShareViewController.swift`, `LibraryCapture.swift`, and
   `LibraryAccess.swift` (from
   `crates/tauri-plugin-notesage-ios/ios/Sources/`) to that target.
3. Use `ShareExtension-Info.plist` and `ShareExtension.entitlements`
   (App Group only).
4. Link the capture staticlib and set the bridging header:

   ```bash
   cargo build --release --target aarch64-apple-ios \
     --manifest-path src-tauri/crates/notesage-capture/Cargo.toml
   ```

   Add `libnotesage_capture.a` from
   `src-tauri/target/aarch64-apple-ios/release/` to the extension's "Link
   Binary With Libraries", and point "Objective-C Bridging Header" at
   `src-tauri/ios/NotesageCapture.h`. Only the extension links this — the app
   never captures, which is why `LibraryCapture.swift` is split out of
   `LibraryAccess.swift`.
5. Set the Development Team, then build + validate on device: grant
   persistence, iCloud download, capture from Safari.

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
