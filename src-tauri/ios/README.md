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

1. `pnpm tauri:ios:init` (`tauri ios init`) — generates `src-tauri/gen/apple/`.
2. **Signing & capabilities** (Xcode → target → Signing & Capabilities), or copy
   the staged files here:
   - App target → add the contents of **`Notesage.entitlements`** (App Group
     `group.com.notesage.app`; iCloud Documents optional-but-recommended).
   - Set your Apple **Development Team** (or `TAURI_APPLE_DEVELOPMENT_TEAM` env).
3. **Wire the Swift bridge as a Tauri mobile plugin.** Add `LibraryAccess.swift`
   and `NotesagePlugin.swift` to the app target. `NotesagePlugin` is a Tauri
   `Plugin` subclass that decodes the invoke args and calls `LibraryAccess`; it
   resolves the exact shapes the Rust commands expect. Then:
   - Register it from Rust (e.g. in `lib.rs`, iOS-only):
     ```rust
     #[cfg(target_os = "ios")]
     tauri::ios_plugin_binding!(init_plugin_notesage);
     // in the builder setup, behind #[cfg(target_os = "ios")]:
     //   app.handle().plugin(tauri::plugin::Builder::new("notesage")
     //       .setup(|app, api| { api.register_ios_plugin(init_plugin_notesage)?; Ok(()) })
     //       .build())?;
     ```
   - Replace the `NOT_WIRED` stubs in `ios_library.rs::ios_impl` with
     `app.run_mobile_plugin("<method>", payload)` calls. The plugin methods +
     resolved shapes are final:

     | Rust command | Plugin method | Resolves |
     | --- | --- | --- |
     | `pick_library_folder` | `pickLibraryFolder` | `{ displayName, granted }` |
     | `get_library_grant` | `getLibraryGrant` | `{ displayName, granted }` |
     | `clear_library_grant` | `clearLibraryGrant` | — |
     | `list_directory(relPath)` | `listDirectory` | `{ entries: FileEntry[] }` |
     | `read_file(relPath)` | `readFile` | `{ text }` |
     | `read_binary(relPath)` | `readBinary` | `{ bytes: u8[] }` |
     | `ensure_downloaded(relPath)` | `ensureDownloaded` | `{ state }` |
     | `write_capture(input)` | `writeCapture` | `{ relPath }` |
4. Add a **Share Extension** target (`File → New → Target → Share Extension`):
   - Replace its generated `ShareViewController` with `ShareViewController.swift`.
   - Use `ShareExtension-Info.plist` (URL/text activation rule) and
     `ShareExtension.entitlements` (App Group only).
   - Add `LibraryAccess.swift` to the extension's target membership (it writes
     captures directly, without Tauri).
5. No network entitlements — the app is read-only + link capture and makes
   **no** network calls on device.

### tauri.conf.json additions (apply after init)

```jsonc
// "bundle": { ... add:
"iOS": {
  "developmentTeam": "<TEAM_ID>",      // or set TAURI_APPLE_DEVELOPMENT_TEAM
  "minimumSystemVersion": "16.0"
}
```

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
