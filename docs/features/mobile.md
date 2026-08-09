# Mobile (iOS)

A read-only iOS companion app for the Notesage library, plus a system
share-sheet target for capturing links. PRD:
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
- **Capture links via the share sheet.** "Share → Notesage" from Safari, the
  X/Twitter app, or anything that shares a URL writes a link-only
  `type: capture` note into `Inbox/`, which syncs back to the desktop where the
  existing `download-webpage` / `save-research` workflows enrich it. Verified
  end-to-end (share → grant resolution → Rust formatter → coordinated write).
- **Read-only & private.** The only write path in the whole app is the share
  capture, which runs in the extension's separate process. Enforced at TWO
  layers: the iOS binary registers only the mobile reader's commands in its
  invoke handler (no `write_file`, no `delete_path`, no credential or agent
  commands — they are compiled out of the iOS target), and a regression test
  asserts the shell only invokes allowed read commands.

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
  (iCloud-aware reads). There is deliberately NO write command on the app's
  surface — captures are written by the Share Extension in its own process
  over the C ABI. All `relPath`s are
  relative to the granted root. See `docs/tauri-commands.md` → "iOS Library &
  Capture Operations".
- **Capture format.** Produced by the pure, unit-tested
  `capture::build_capture_note` (frontmatter `type: capture` / `source_url` /
  `title` / `date_saved` / `tags`; body = the link + any shared selection;
  filename `Inbox/YYYY-MM-DD-HHmmss-<slug>.md`). The Share Extension calls the
  same Rust implementation over a C ABI (`notesage-capture` staticlib +
  `NotesageCapture.h`) — one format, one implementation, tested once.
- **Share Extension wiring is scripted.** `tauri ios init` cannot create
  extension targets; `src-tauri/ios/integrate-share-extension.py` adds the
  `NotesageShare` app-extension target to the generated xcodegen project
  (sources, bridging header, a cargo phase building the capture staticlib for
  the SDK's triple, App Group entitlements on BOTH targets, version keys
  mirrored from the app) and re-runs `xcodegen generate`. Idempotent — run it
  after any `tauri ios init`.

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
