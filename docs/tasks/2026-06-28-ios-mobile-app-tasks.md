# Tasks: Notesage iOS Mobile App — Reader + Share Capture

|  |  |
| --- | --- |
| **Date** | 2026-06-28 |
| **Status** | Not started |
| **PRD** | [ios-mobile-app](../prds/2026-06-28-ios-mobile-app.md) |
| **Total** | 16 tasks: 3S, 7M, 6L |
| **Suggested order** | iOS scaffold (#1–#2) → native bridge + commands (#3–#8) → share extension (#9) → platform split + state (#10–#11) → mobile UI (#12–#15) → docs (#16) |

## Risks & open questions

- **Highest risk is native, not in-harness.** Tasks #2–#9 (entitlements, App Group, security-scoped bookmarks, `NSFileCoordinator`, the share-extension target) can only be fully validated on a real device/simulator with a signing identity. They fall outside the Rust/React test harness — budget device time and treat their acceptance criteria as manual.
- **Apple Developer account + signing** is a hard prerequisite for #1 onward (App Groups, iCloud entitlement, share extension all require a provisioning profile).
- **Tauri Mobile maturity:** confirm the installed Tauri v2 version's iOS support covers custom Swift plugins and a share-extension target. If `tauri ios` can't host the extension, the extension becomes a hand-maintained Xcode target in the generated project (#9 accounts for this).
- **Viewer behavior under iOS WKWebView** (pdfjs-dist, foliate-js, docx-preview, CodeMirror) is unverified — #14 includes a triage step and an "Open in…" fallback for anything that misbehaves.
- **Bookmark staleness:** security-scoped bookmarks can go stale (OS update, iCloud re-auth). The state machine (#11) and onboarding (#12) must handle re-grant explicitly.
- Decide the capture **Inbox** location: library-root `Inbox/` vs `Notesage/Inbox/`. PRD assumes library-root `Inbox/`; confirm before #8.

---

## 1. Initialize Tauri iOS target + project config

**Description:** Run `tauri ios init`, add the iOS target scaffold under `src-tauri/gen/apple/`, set bundle identifier, app name, deployment target, and icons. Wire a `pnpm` script (e.g. `tauri:ios:dev`) and document the build in `CLAUDE.md`/`docs`. Desktop build must remain unaffected. Acceptance: a stub iOS app builds and launches in the simulator showing the existing web frontend.
**Complexity:** L
**Category:** backend
**Dependencies:** none (requires Apple Developer signing set up out-of-band)
**Files:** `src-tauri/gen/apple/*` (generated), `src-tauri/tauri.conf.json` (iOS section), `package.json`, `CLAUDE.md`

## 2. Configure iOS entitlements: App Group, iCloud document access, share extension capability

**Description:** Add the App Group (`group.<bundle-id>`), iCloud Drive document-access entitlement, and the capability needed for a share extension to the iOS target's entitlements/Info.plist. Establish the shared-container scheme both the app and the (later) extension will use for the bookmark. Acceptance: entitlements present in the signed build; app can resolve the App Group container URL at runtime.
**Complexity:** M
**Category:** backend
**Dependencies:** Depends on #1
**Files:** `src-tauri/gen/apple/*.entitlements`, iOS `Info.plist`

## 3. Swift bridge: folder picker + security-scoped bookmark persistence

**Description:** Native Swift module presenting `UIDocumentPickerViewController` in folder mode **pre-navigated to `iCloud Drive/Notesage`**, returning the chosen security-scoped URL. Persist/restore a security-scoped bookmark in the App Group shared store (UserDefaults or Keychain). Expose start/stop accessing helpers and a staleness check. Acceptance: pick once, relaunch app, bookmark resolves without re-prompting; stale bookmark reported as needing re-grant.
**Complexity:** L
**Category:** backend
**Dependencies:** Depends on #2
**Files:** `src-tauri/gen/apple/Sources/.../LibraryGrant.swift` (new), bridge glue

## 4. Swift bridge: iCloud-aware file reads via NSFileCoordinator

**Description:** Native helpers to (a) enumerate a directory, (b) read a file as text, (c) read a file as bytes, and (d) ensure an iCloud item is downloaded (`startDownloadingUbiquitousItem` + await), all scoped through the resolved bookmark and coordinated with `NSFileCoordinator`. Return a download state (`Ready`/`Downloading`/`Failed`) for placeholders. Acceptance: lists and reads files inside the granted folder; a not-yet-downloaded file transitions to readable after `ensure_downloaded`.
**Complexity:** L
**Category:** backend
**Dependencies:** Depends on #3
**Files:** `src-tauri/gen/apple/Sources/.../LibraryFiles.swift` (new)

## 5. iOS Tauri commands: grant lifecycle

**Description:** Register `ios_pick_library_folder`, `ios_get_library_grant`, `ios_clear_library_grant` (behind `#[cfg(target_os = "ios")]`) forwarding to the Swift bridge from #3. Return `LibraryGrant { display_name, granted }`. Follow the command registration pattern in `commands/mod.rs`/`lib.rs`. Acceptance: callable from the frontend via `invoke`; round-trips grant state.
**Complexity:** M
**Category:** backend
**Dependencies:** Depends on #3
**Files:** `src-tauri/src/commands/ios_library.rs` (new), `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

## 6. iOS Tauri commands: read paths

**Description:** Register `ios_list_directory(rel_path)`, `ios_read_file(rel_path)`, `ios_read_binary(rel_path)`, `ios_ensure_downloaded(rel_path)` forwarding to #4. Reuse the existing `FileEntry` shape; resolve all paths relative to the granted folder root (reject `..` traversal). Acceptance: frontend can list the library root and nested folders and read a markdown file's text.
**Complexity:** M
**Category:** backend
**Dependencies:** Depends on #4, #5
**Files:** `src-tauri/src/commands/ios_library.rs`, `src-tauri/src/lib.rs`

## 7. Capture-note format helper (shared)

**Description:** Pure function that builds a `type: capture` markdown note from `{ url, title?, selection_text?, tags }` — frontmatter (`type`, `source_url`, `title`, `date_saved` ISO-8601, `tags`) + body (the URL, then optional selection text) + the `Inbox/YYYY-MM-DD-HHmmss-<slug>.md` filename rule (slug from title or URL host). Unit-tested. Place it where both the command (#8) and any future desktop reuse can import; mirror frontmatter conventions in `src/lib/frontmatter.ts`. Acceptance: deterministic output for fixed input (inject timestamp); slug + filename rules covered by tests.
**Complexity:** S
**Category:** backend
**Dependencies:** none
**Files:** `src-tauri/src/commands/capture.rs` (new) or shared module + unit tests

## 8. iOS Tauri command: write capture note

**Description:** `ios_write_capture(input: CaptureInput) -> Result<String, String>` (returns the relative path written). Uses #7 for content/filename and the #4 coordinated-write path to atomically create the file under `Inbox/` in the granted folder, creating `Inbox/` if absent. Acceptance: calling it creates a well-formed capture note that appears on desktop via iCloud; never overwrites an existing note (timestamped names avoid collisions).
**Complexity:** M
**Category:** backend
**Dependencies:** Depends on #4, #6, #7
**Files:** `src-tauri/src/commands/ios_library.rs`, `commands/capture.rs`

## 9. iOS Share Extension target (link capture)

**Description:** Add a Share Extension Xcode target that accepts `public.url` / `public.plain-text`. Read the shared bookmark from the App Group, resolve the Notesage folder, and write a link-only capture note via the same #7 format + `NSFileCoordinator` write (the extension writes directly — it does not launch the app or fetch content). Minimal confirmation UI ("Saved to Notesage Inbox"); if no grant exists yet, show "Open Notesage to set up." Acceptance: sharing a URL from Safari and from the X/Twitter app produces a capture note in `Inbox/`; works with the host app closed.
**Complexity:** L
**Category:** backend
**Dependencies:** Depends on #2, #3, #7
**Files:** `src-tauri/gen/apple/ShareExtension/*` (new target), shared Swift from #3/#7

## 10. Platform detection + mobile app root

**Description:** Add an `isIos()` / `isMobile()` helper and branch in `App.tsx` to mount a new `MobileApp.tsx` root on iOS instead of `QuietLayout`. Ensure desktop-only hooks/providers (AI, ACP, watcher, git, telemetry, editor write paths) are not mounted on mobile. Acceptance: iOS build renders the mobile root; desktop build renders `QuietLayout` unchanged; `pnpm typecheck` green.
**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #1
**Files:** `src/App.tsx`, `src/MobileApp.tsx` (new), `src/lib/platform.ts` (new)

## 11. `mobile-store` + grant/navigation state machine

**Description:** Zustand store (persisted) holding `{ grantState: 'ungranted'|'granted'|'stale', currentPath, recentlyRead[] }` plus actions that call the #5/#6 commands. Encode the state machine: ungranted → (pick) → granted; stale → re-grant. Unit-test the reducer/transitions. Acceptance: store transitions covered by tests; selectors drive which screen renders.
**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #5, #10
**Files:** `src/stores/mobile-store.ts` (new) + tests

## 12. Onboarding / grant screen

**Description:** First-run screen explaining iOS needs a **one-time permission** to read the iCloud `Notesage` folder and that the app only *adds* capture notes; primary button invokes `ios_pick_library_folder` (picker pre-pointed at `iCloud Drive/Notesage`). Handle `stale` re-grant with the same screen. Themed with Notesage tokens, light/dark, designed empty/error copy. Acceptance: granting advances to the library browser; denial/cancel returns to onboarding with a retry; never re-prompts once granted.
**Complexity:** M
**Category:** frontend
**Dependencies:** Depends on #11
**Files:** `src/components/mobile/Onboarding.tsx` (new)

## 13. Library browser screen

**Description:** Push-navigation list over the granted folder via `ios_list_directory`: projects/folders/notes with lucide icons, name, modified date; tapping a folder pushes a level, tapping a file opens the reader. iCloud-undownloaded rows show a download glyph and call `ios_ensure_downloaded` on tap. States: loading (skeleton), empty, error/no-access. Acceptance: nested navigation works; placeholders download then open; all states render with no raw spinners.
**Complexity:** L
**Category:** frontend
**Dependencies:** Depends on #6, #11
**Files:** `src/components/mobile/LibraryBrowser.tsx` (new), `src/components/mobile/FileRow.tsx` (new)

## 14. Reader screen + viewer integration

**Description:** Render markdown notes via the existing render path (`render_markdown_preview` / `markdown_to_html`) in a clean reading column reusing `.ProseMirror` read CSS. Route non-markdown to existing viewers (`PdfViewer`, `PlainTextViewer`/code, then EPUB/DOCX) fed by `ios_read_file`/`ios_read_binary`. **Triage each viewer under iOS WKWebView**; for any that misbehave, show an "Unsupported format — Open in…" fallback. Top bar: back, title, overflow (Open in… / Share link / Copy). Strictly read-only. Acceptance: a markdown note renders formatted; PDF + plain-text/code open; unsupported formats offer "Open in…"; loading/download states handled.
**Complexity:** L
**Category:** frontend
**Dependencies:** Depends on #6, #13
**Files:** `src/components/mobile/Reader.tsx` (new), reuse `src/components/editor/viewers/*`

## 15. Mobile read-only & isolation safety tests

**Description:** Frontend tests asserting the mobile shell never invokes any write/delete/AI command except `ios_write_capture` (e.g., mock the Tauri invoke layer and assert the call allow-list across browser/reader flows), plus state-machine coverage from #11 and capture-format coverage from #7 wired into CI. Acceptance: tests fail if a mobile component calls a forbidden command; `pnpm typecheck` + `pnpm test` green.
**Complexity:** S
**Category:** frontend
**Dependencies:** Depends on #12, #13, #14
**Files:** `src/components/mobile/__tests__/*`, `src/stores/__tests__/mobile-store.test.ts`

## 16. Documentation: architecture + features + tauri-commands

**Description:** Document the iOS app: add a mobile section to `docs/architecture.md` (mobile root, platform split, command surface), a feature page (or section) for the mobile reader + share capture, and the new iOS commands to `docs/tauri-commands.md`. Note the `#[cfg(target_os = "ios")]` gating and that the desktop capability surface/regression test is untouched. Acceptance: docs reflect shipped behavior; file paths/signatures accurate.
**Complexity:** S
**Category:** both
**Dependencies:** Depends on #8, #9, #14
**Files:** `docs/architecture.md`, `docs/features/*`, `docs/tauri-commands.md`
