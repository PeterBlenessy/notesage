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

1. `pnpm tauri ios init` — generates `src-tauri/gen/apple/`.
2. **Signing & capabilities** (Xcode → target → Signing & Capabilities):
   - App Group: `group.<bundle-id>` on both the app and the share extension.
   - iCloud → iCloud Documents (so the picker can reach iCloud Drive).
3. Add a **Tauri mobile plugin** (or extend the generated app delegate) that
   exposes the Swift functions in `LibraryAccess.swift` to Rust, and replace the
   `NOT_WIRED` stubs in `ios_library.rs::ios_impl` with calls into it. The Rust
   command names + payload shapes are already final:
   - `pick_library_folder() -> LibraryGrant`
   - `get_library_grant() -> LibraryGrant`
   - `clear_library_grant()`
   - `list_directory(rel) -> [FileEntry]`
   - `read_file(rel) -> String`
   - `read_binary(rel) -> [UInt8]`
   - `ensure_downloaded(rel) -> DownloadState`  (`ready` | `downloading` | `failed`)
   - `write_capture(CaptureInput) -> String (rel path)`
4. Add a **Share Extension** target (`File → New → Target → Share Extension`),
   replace its `ShareViewController` with `ShareViewController.swift` here, and
   set its App Group to match. The extension reuses `LibraryAccess.swift` (add it
   to the extension target's membership).
5. Set `App Transport Security` / no extra network entitlements — the app is
   read-only + link capture and makes **no** network calls on device.

## Path contract

All `rel` paths are **relative to the granted library root**, `/`-separated.
The Rust layer (`sanitize_rel_path`) already rejects absolute paths and `..`
traversal before calling the bridge — the Swift side can treat `rel` as trusted
and resolve it against the bookmarked root URL.

## Capture format

The note body/filename are produced by the **shared, unit-tested** Rust
formatter (`src-tauri/src/commands/capture.rs::build_capture_note`). For the
Share Extension (a separate process that writes directly without Rust), mirror
that format — see `ShareViewController.swift` — or, preferably, route the
extension through the same Rust formatter if you expose it to the extension
target. The filename rule is `Inbox/YYYY-MM-DD-HHmmss-<slug>.md`.
