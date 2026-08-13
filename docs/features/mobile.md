# Mobile (iOS)

An iOS companion app for the Notesage library — browse and read, create and
edit markdown notes (#586), plus a system share-sheet target for capturing
links and documents. PRD:
`docs/prds/2026-06-28-ios-mobile-app.md`. Tasks:
`docs/tasks/2026-06-28-ios-mobile-app-tasks.md`.

> **Status: running on device.** Built, signed (ADDABLE AB team) and validated
> end-to-end on an iPhone 14 Pro: grant flow, reading (markdown / HTML / PDF /
> images / code), mermaid diagrams, dark mode, share-sheet capture, app icon.
> The Share Extension is wired by a committed script — no manual Xcode steps
> remain (see `src-tauri/ios/README.md`).

## What it does

- **Read the library on iPhone/iPad.** Browse projects/folders/notes from the
  iCloud-synced Notesage folder and read them rendered: markdown (via the
  **same Rust comrak pipeline as the desktop** — `render_markdown_fragment`,
  so a note looks identical on both, callouts and all), plain text/code,
  images, and **PDFs** (the desktop `PdfViewer` — pdf.js canvas with
  zoom/fit/search — lazy-loaded and fed the iOS bytes via the shared binary
  cache). Binary reads cross IPC as **base64** — a `Vec<u8>` serializes as a
  JSON number array (~4 bytes of JSON per payload byte) and froze the UI for
  ~10 s on a 113-page PDF; base64 with native `Uint8Array.fromBase64` decoding
  brings a 10 MB PDF to ~0.5 s. EPUB/DOCX/PPTX show an "open on your Mac"
  state in v1.
- **Open exported HTML reports, with their scripts running.** `.html`/`.htm`
  files render in a sandboxed iframe served from the **`htmlpreview://`
  custom scheme** — the same mechanism as the desktop HtmlViewer, for the same
  reason: `srcdoc`, `blob:` AND `data:` documents all inherit the host
  window's CSP, and the embedded build's nonce injection neutralises
  `'unsafe-inline'`, so the report's own styles and scripts would be refused
  (`blob:` additionally renders blank on device — WKWebView refuses blobs
  minted from the app's custom-scheme origin in a sandboxed frame). Dev builds
  hide all of this: Vite serves the app with no CSP. The frame carries
  `sandbox="allow-scripts"` **without** `allow-same-origin`, so the report
  executes on an opaque origin and cannot reach the app's DOM, storage, or the
  Tauri IPC bridge.
- **Render mermaid diagrams.** ```` ```mermaid ```` fences render as diagrams
  (same lazily-imported library as the desktop's node view). The SVG ships
  inside a minimal HTML document served from the `htmlpreview://` scheme,
  framed by a **fully sandboxed** iframe (`sandbox=""` — a diagram needs no
  scripts, so it gets none), sized by the SVG's viewBox aspect ratio and
  painted with the app's computed background. Lighter approaches fail:
  innerHTML loses the SVG's internal `<style>` to the CSP nonce rewrite;
  SVG-as-`<img>` hits WebKit's refusal to render `<foreignObject>`, which
  mermaid emits for composite-state labels. A diagram that fails to parse
  keeps its readable code block.
- **Follow the system light/dark appearance — live.** `ThemeProvider` listens
  for OS appearance changes, and the reader re-renders the open document when
  the theme class flips (syntect's syntax colors are inline styles from the
  Rust renderer, and mermaid bakes its theme + background at render time —
  neither follows a CSS-variable swap).
- **Native chrome over the webview (ADR 0009).** The corner controls are
  REAL SwiftUI Liquid Glass buttons (`.buttonStyle(.glass)`, iOS 26) hosted
  in per-corner `UIHostingController`s above the WKWebView — genuine
  material, illumination, and interruptible spring physics, with a native
  `UIMenu` on back-button long-press (Files' ancestor-jump pattern). The web
  app declares chrome as data (`ios_set_chrome`: ids + SF Symbol names +
  menu entries) and receives taps as `notesage:chrome` CustomEvents;
  `useNativeChrome` falls back to the web islands below when the native
  layer is absent (desktop dev, tests). Content stays web — the shared Rust
  rendering pipeline is the reason the hybrid wins over fully-native.
- **iOS island chrome (issue #581) — web layer, now the fallback + in-content press language.** No full-width toolbars: floating glass
  "button islands" pinned to the screen corners (Apple Notes / iOS 26 pattern,
  the mobile cousin of the desktop Quiet Composer), with content scrolling
  full-height beneath them. Placement contract in `mobile/Chrome.tsx`: back
  top-left (always — including the PDF viewer, which drops the desktop pill
  entirely in `mobileChrome` mode), screen actions top-right (Share; library
  re-pick on the folder root), search bottom-center. Islands portal to
  `document.body` with `position: fixed` — chrome, never page content.
- **Search everywhere, bottom-center.** The folder view filters filenames; a
  collapsed island shows passive status (item count / PDF page indicator,
  Files-style). Documents get find-in-document: markdown/text via the shared
  `dom-search` marker, PDFs via the viewer's text-layer search, and sandboxed
  HTML reports via an **injected find agent** (`html-find-agent.ts`) driven
  over postMessage — the app cannot reach a cross-origin frame's DOM, so
  search runs inside the report itself. (PDF search on WebKit also needed
  `src/lib/readablestream-asynciterator-polyfill.ts`: pdf.js ≥ 4 iterates a
  ReadableStream with `for await`, which WebKit doesn't implement — this had
  silently broken PDF text search on desktop macOS too.)
- **Keyboard-aware chrome, natively.** The page cannot see the iOS keyboard —
  in WKWebView neither `window.innerHeight` nor `visualViewport` reacts to it
  (verified empirically). The Swift plugin observes
  `UIResponder.keyboardWill{Show,ChangeFrame,Hide}` and dispatches a
  `notesage:keyboard` CustomEvent with the exact overlap; bottom islands lift
  by that amount and drop back on hide. The plugin also strips WKWebView's
  keyboard accessory bar (the ∧∨/Done row that duplicated island controls)
  via the dynamic `WKContent` subclass trick.
- **Share any document.** The top-right island in the reader presents the
  native share sheet (`UIActivityViewController`) over a **temp copy** of the
  file — share targets cannot read through the security-scoped grant, so the
  Swift side (`LibraryAccess.copyForSharing`) copies to the app's temp dir
  first. Full stack: `ios_share_file` command → plugin `shareFile`.
- **Capture with a format picker.** Sharing a URL opens a compact
  transparent card (the host app stays visible — no opaque sheet) offering
  **Article (Markdown)** — page fetched (10 s / 5 MB, Safari UA) and run
  through readable extraction + HTML→Markdown in the Rust `notesage-capture`
  crate (`extract_article`, `capture_format: markdown` note v2), falling back
  to the link note when a page yields nothing readable; **Link note** — the
  classic instant capture; **Page (HTML)** — the fetched page stored as a
  real `.html` Inbox file (opens in the app's HTML viewer). The last choice
  is remembered (App Group defaults) and listed first; success flashes
  "✓ Saved…" and auto-dismisses. Documents (PDF/EPUB/file shares — the
  extension also declares `NSExtensionActivationSupportsFileWithMaxCount`)
  skip the picker and store immediately in `Inbox/` with their original
  names, streamed via `loadFileRepresentation`. PDF-format capture via an
  in-extension WKWebView render: #609; extraction quality: #610.
- **Capture links via the share sheet.** "Share → Notesage" from Safari, the
  X/Twitter app, or anything that shares a URL writes a link-only
  `type: capture` note into `Inbox/`, which syncs back to the desktop where the
  existing `download-webpage` / `save-research` workflows enrich it. Verified
  end-to-end (share → grant resolution → Rust formatter → coordinated write).
- **Create & edit (#586).** A native "+" (bottom-right glass circle) creates:
  at the library root it prompts for a folder name (root is folders-only);
  inside a folder a tap creates `Untitled.md` INSTANTLY and opens it —
  long-press offers New Folder. A brand-new empty note drops straight into
  edit mode (Notes-style). Editing is raw markdown in a full-screen textarea:
  pencil to edit (Share moves to its long-press menu), ✓ to save; back while
  editing saves first. On save the note's TITLE (first heading / non-empty
  line, sanitized) becomes the filename via `ios_rename_file` (deduped
  natively) and the doc re-opens under the new name.
- **Confined writes & private.** The app's write surface is exactly four
  allowlisted commands (`ios_write_file`, `ios_create_file`,
  `ios_create_directory`, `ios_rename_file`) — library-root-confined relative
  paths (sanitizer-guarded, source-shape-locked tests), no delete, no move,
  coordinated `NSFileCoordinator` writes. Link/article capture still runs
  only in the Share Extension's separate process. The desktop's broad
  write/exec/credential commands remain compiled out of the iOS binary, and
  the mobile test suite's ALLOWED/FORBIDDEN lock asserts the shell never
  invokes anything beyond this surface.

## Telemetry-free by construction (#587)

The iOS binary ships with **no telemetry SDKs linked at all** — this is the
verified basis for the App Store privacy label **"Data Not Collected"**:

- `sentry` / `tauri-plugin-sentry` / `tauri-plugin-aptabase` are declared
  under `[target.'cfg(not(target_os = "ios"))'.dependencies]` in
  `src-tauri/Cargo.toml`, and the Sentry init + plugin-registration blocks in
  `lib.rs` (plus the whole `commands/telemetry.rs` module) are
  `#[cfg(not(target_os = "ios"))]`. Verified:
  `cargo tree --target aarch64-apple-ios -i sentry` (and `-i
  tauri-plugin-aptabase`) prints nothing — the crates are unreachable from
  the iOS dependency graph.
- Regression locks: `telemetry_crates_are_gated_off_the_ios_target`
  (Rust — fails if a telemetry crate moves out of the not-iOS target table)
  and `telemetry-unreachable.test.ts` (walks `MobileApp.tsx`'s transitive
  static import graph and fails if `src/lib/telemetry.ts` ever becomes
  reachable from the iOS shell).
- Usage insight comes from Apple's own OS-level collection (App Store
  Connect App Analytics + TestFlight metrics), which requires zero in-app
  code.

## Architecture

- **One codebase, Tauri Mobile.** The iOS app reuses the React/TS frontend. The
  root shell is chosen in `main.tsx` via `isIos()` (`src/lib/platform.ts`):
  `MobileApp` on iOS, the desktop `App` otherwise. Branching at the root — not
  inside `App.tsx` — means the desktop lifecycle hooks (AI, ACP, watcher, git,
  editor, telemetry) are never *called* on iOS (Rules of Hooks).
- **Why a folder picker?** The library lives at a fixed location
  (`iCloud Drive/Notesage`), but a sandboxed iOS app cannot open a hardcoded
  path in the generic iCloud Drive (`com~apple~CloudDocs`). Apple's only
  supported route is a one-time, security-scoped grant via the document picker —
  pre-pointed at `iCloud Drive/Notesage`, so it's a confirm tap. The grant is
  persisted as a security-scoped bookmark in the **App Group** container
  (`group.com.notesage.app`) so the Share Extension resolves the same grant.
  Note: a build without the App Group entitlement cannot resolve the shared
  container at all — `UserDefaults(suiteName:)` yields nothing — so a grant
  stored before the entitlement landed is simply unreachable and the app falls
  through to onboarding: users re-select the folder once.
- **Native layer = a Tauri plugin crate.** The Rust↔Swift bridge is
  `src-tauri/crates/tauri-plugin-notesage-ios` (`.ios_path("ios")` in its
  build.rs), which is the only shape where Tauri links the `@_cdecl` plugin
  entry point. Swift stays thin: folder picker, bookmark resolution,
  `NSFileCoordinator` reads. Path sanitization (`..`/absolute rejection)
  happens in Rust before Swift sees a path.
- **Command surface.** `ios_pick_library_folder` / `ios_get_library_grant` /
  `ios_clear_library_grant` (grant lifecycle); `ios_list_directory` /
  `ios_read_file` / `ios_read_binary` (base64) / `ios_ensure_downloaded`
  (iCloud-aware reads) / `ios_stat_file` (size-only probe the reader runs
  before `ios_read_file` on text/markdown/html so an oversized file is
  declined instead of freezing the WebView, issue #616). There is deliberately NO write command on the app's
  surface — captures are written by the Share Extension in its own process
  over the C ABI. All `relPath`s are
  relative to the granted root. See `docs/tauri-commands.md` → "iOS Library &
  Capture Operations".
- **Capture format.** Produced by the pure, unit-tested
  `capture::build_capture_note` (frontmatter `type: capture` / `source_url` /
  `title` / `date_saved` / `tags`; body = the link + any shared selection;
  filename `Inbox/<Note Title>.md` — readable and UNDATED: `date_saved` is
  already in the frontmatter and drives sorting/grouping, so a timestamp in
  the name is noise; same-title captures dedupe to `<Title>-1.md` rather than
  overwriting). The Share Extension calls the
  same Rust implementation over a C ABI (`notesage-capture` staticlib +
  `NotesageCapture.h`) — one format, one implementation, tested once.
- **Share Extension wiring is scripted.** `tauri ios init` cannot create
  extension targets; `src-tauri/ios/integrate-share-extension.py` adds the
  `NotesageShare` app-extension target to the generated xcodegen project
  (sources, bridging header, a cargo phase building the capture staticlib for
  the SDK's triple, App Group entitlements on BOTH targets, version keys
  mirrored from the app) and re-runs `xcodegen generate`. Idempotent — run it
  after any `tauri ios init`.

## Launch: no white flash (#675)

WKWebView paints **white** for its own first frames regardless of what the
layers beneath it are set to. Round 1 of the fix themed every native layer
(webview, scroll view, superview chain, all windows) *and* the document's
pre-paint CSS — and the flash survived on device, because none of that
changes what the webview itself paints first.

The fix is the iOS translation of the desktop trick of starting the window
hidden and showing it when the frontend signals ready (the window can't be
hidden on iOS, so we cover it instead):

1. `LaunchScreen.storyboard` shows the app icon (96 pt, 21 pt corner radius)
   centered on `systemBackground`.
2. The plugin's `load(webview:)` installs an **opaque cover** over the window
   with the *same icon at the same size and position* — so the launch-screen →
   cover handoff is invisible. The cover is
   `isUserInteractionEnabled = false`, so a stuck cover can never block the
   app, and it self-removes after 4 s if the frontend never signals.
3. `MobileApp` calls `ios_content_ready` inside a double `requestAnimationFrame`
   (the second fires *after* the browser has painted the commit), and the
   native side dissolves the cover: the icon scales to 1.35× as it fades while
   the cover fades slightly faster, so the icon reads as opening *into* the
   loaded UI.

The storyboard and the `LaunchLogo` imageset live in
`src-tauri/ios/LaunchAssets/` and are re-applied by
`integrate-share-extension.py` on every integration, because `tauri ios init`
regenerates both from its own templates.

**Verify with video, never screenshots.** The flash is 20–100 ms; polling
`simctl io screenshot` misses it and reports a clean launch that isn't one.
Record with `simctl io recordVideo`, decompose at 60 fps, and check the frame
means — in a dark-mode launch any frame with mean luminance > 150 is the bug
(and in light mode, any frame < 100).

## Build & verification pipeline

- **Dev loop:** `npx tauri ios dev "<sim name>" --config '{"build":{...}}'`
  with a dedicated Vite port; frontend changes hot-reload. Caveats: the
  `build` section of `tauri.ios.conf.json` is silently ignored (use `--config`
  inline JSON), and never run `tauri ios build` while a dev session is alive —
  both CLIs share one `$TMPDIR/<bundle-id>-server-addr` file and the loser
  panics with "connection refused".
- **Embedded-simulator harness** (the device-truth gate):
  `npx tauri ios build --debug --target aarch64-sim` +
  `xcrun simctl install booted .../arm64-sim/Notesage.app`. `tauri ios dev`
  serves the app from Vite with **no CSP**, so every CSP-dependent behavior
  passes in dev and breaks on device; the embedded build reproduces the
  device's nonce-injected CSP exactly. All the iframe/mermaid findings above
  were verified in this harness before shipping.
- **Device install:** `npx tauri ios build --debug --export-method debugging`
  then `xcrun devicectl device install app --device <udid> .../Notesage.ipa`.
  Signing: `bundle > iOS > developmentTeam` in `tauri.ios.conf.json`; the
  first device build needs `-allowProvisioningDeviceRegistration` (via raw
  xcodebuild) to register a new phone to the team.
- **App icon:** regenerate with `src-tauri/ios/make-ios-icon.py` — edge-bleeds
  the desktop master (iOS icons must be full-bleed opaque; a flat fill leaves
  corner slivers against the logo's gradient) and installs the set into
  `icons/ios/` + the generated asset catalog.

## App Review notes (task #11, issue #594)

Apple App Review will not have the team's iCloud account. The onboarding flow
already supports that: the folder picker is only *pre-pointed* at `iCloud
Drive/Notesage` as a convenience — `LibraryAccess.pickLibraryFolder` persists
a bookmark for whatever folder the user actually picks, iCloud or not.
When `FileManager.default.url(forUbiquityContainerIdentifier:)` returns `nil`
(no iCloud account signed in), the `if let` guard around `picker.directoryURL`
simply skips setting a starting location — the picker still opens on the
standard Files browse view, with no crash and no forced iCloud dependency.
The onboarding copy says this explicitly, so a reviewer isn't left guessing.

**Demo path for reviewers (no iCloud account required):**

1. Launch the app — the onboarding screen appears ("Welcome to Notesage").
   Its copy explains that a local folder works if you don't use iCloud.
2. Tap "Select your Notesage folder". The system Files picker opens.
3. In the picker, go to "On My iPhone" (or "Browse" → "On My iPhone") and
   create or choose any folder — it does not need to be named "Notesage" or
   contain anything.
4. Confirm. The app grants access and shows the library browser for that
   folder.
5. An empty folder shows a real empty state ("Nothing here yet" / "This
   folder is empty."), not placeholder or lorem-ipsum content.
6. Cancelling the picker at step 3 (tap "Cancel") returns to the onboarding
   screen with a friendly "No folder selected — tap again to choose your
   Notesage folder" message; the button is immediately re-tappable, nothing
   is left in a stuck/loading state.

**Permissions.** The app requests no runtime permission beyond the one-time
folder grant itself — no camera, microphone, photo library, contacts,
location, or notification usage keys are declared
(`src-tauri/ios/Notesage.entitlements` / `ShareExtension-Info.plist`), so
reviewers will not hit a permission prompt they can't explain from the UI in
front of them.

**Verified this pass (code review — no macOS/Xcode available in this
environment, so the actual `UIDocumentPickerViewController` could not be
exercised on a simulator or device):**

- The picker's iCloud pre-point uses an optional `if let` (no force-unwrap),
  so a missing iCloud container cannot crash folder selection.
- `documentPickerWasCancelled` resolves `granted: false` rather than
  rejecting, so cancelling is a friendly no-op, not an error.
- The empty-folder state, the cancelled/rejected-picker states, and the
  onboarding copy are covered by automated tests in
  `src/components/mobile/__tests__/mobile-app.test.tsx` (describe block
  "App Review safety — local-folder demo path (issue #594)").

Before submitting to App Review, run the embedded-simulator harness (above)
through the six demo-path steps on a simulator signed out of iCloud
(Settings → \[your name\] → Sign Out, or a fresh simulator that was never
signed in) to confirm on-device behavior matches this code-level review.

## v1 limitations (deferred)

- EPUB/DOCX/PPTX in-app rendering (shown as "open on your Mac"). PDF renders in-app.
- Chart and drawing blocks (```` ```chart ````, ```` ```excalidraw ````) render
  as code rather than as diagrams — the comrak pipeline emits them as fenced
  code and the mobile reader mounts no node-views. Mermaid DOES render (see
  above); callouts, tables, task lists and syntax highlighting render too.
- No editing, no AI, no SQLite index, no Android. See the PRD's "Out of Scope".

## Key files

| File | Purpose |
| --- | --- |
| `src/lib/platform.ts` | `isIos()` / `isMobile()` root-shell selection |
| `src/MobileApp.tsx` | iOS root — grant-gated screen switch |
| `src/components/mobile/Onboarding.tsx` | One-time permission / re-grant screen |
| `src/components/mobile/LibraryBrowser.tsx` | Push-navigation folder browser |
| `src/components/mobile/Reader.tsx` | Markdown / HTML / mermaid / text / image / PDF reader + iCloud download + theme re-render |
| `src/lib/markdown-render.ts` | `renderMarkdownFragment` — the shared Rust markdown renderer (theme-aware) |
| `src-tauri/src/commands/html_preview.rs` | `htmlpreview://` scheme store (mime-aware: `.svg` ids serve image/svg+xml) |
| `src-tauri/crates/notesage-capture/` | The one capture-note formatter; C ABI for the Share Extension |
| `src/lib/ios-api.ts` | Typed wrappers for the iOS Tauri commands (base64 binary decode) |
| `src/stores/mobile-store.ts` | Grant + navigation state machine |
| `src-tauri/src/commands/ios_library.rs` | iOS commands (cfg-gated) |
| `src-tauri/crates/notesage-capture/` | Pure capture-note builder + tests (C ABI for the Share Extension) |
| `src-tauri/crates/tauri-plugin-notesage-ios/` | The Tauri bridge as a plugin crate (`LibraryAccess.swift` + `NotesageIosPlugin.swift` in its Swift package) — wired automatically by `tauri ios init` via `.ios_path()` |
| `src-tauri/ios/` | Share Extension sources + `integrate-share-extension.py` (extension wiring) + `make-ios-icon.py` (icon set) + wiring README |
