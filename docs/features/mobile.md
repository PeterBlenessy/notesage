# Mobile (iOS)

A read-only iOS companion app for the Notesage library, plus a system
share-sheet target for capturing links. PRD:
`docs/prds/2026-06-28-ios-mobile-app.md`. Tasks:
`docs/tasks/2026-06-28-ios-mobile-app-tasks.md`.

> **Status: scaffolded.** The frontend shell, the cfg-gated iOS Tauri commands,
> the pure capture formatter, and reference Swift sources are committed and the
> frontend is test-covered. The native layer is **not yet built or validated** —
> that requires `tauri ios init` on a Mac with Xcode + an Apple signing identity
> (see `src-tauri/ios/README.md`). Until then the iOS commands return a clear
> "not yet wired" error.

## What it does

- **Read the library on iPhone/iPad.** Browse projects/folders/notes from the
  iCloud-synced Notesage folder and read them rendered: markdown (via the
  **same Rust comrak pipeline as the desktop** — `render_markdown_fragment`,
  so a note looks identical on both, callouts and all), plain text/code,
  images, and **PDFs** (the desktop `PdfViewer` — pdf.js canvas with
  zoom/fit/search — lazy-loaded and fed the iOS bytes via the shared binary
  cache). EPUB/DOCX/PPTX show an "open on your Mac" state in v1.
- **Open exported HTML reports, with their scripts running.** `.html`/`.htm`
  files render in a sandboxed iframe fed from a `blob:` URL. iOS Files shows a
  report as markup with scripts disabled, which makes an export with inline
  charts unreadable on phone; this renders it as intended. The frame carries
  `sandbox="allow-scripts"` **without** `allow-same-origin`, so the report
  executes on an opaque origin and cannot reach the app's DOM, storage, or the
  Tauri IPC bridge. The `blob:` URL (rather than `srcdoc`) is load-bearing: a
  `srcdoc` document inherits the host CSP, whose nonce neutralises
  `'unsafe-inline'`, so the report's own styles and scripts would be refused —
  the same finding as the desktop HtmlViewer regression (PR #447).
- **Capture links via the share sheet.** "Share → Notesage" from Safari, the
  X/Twitter app, or anything that shares a URL writes a link-only
  `type: capture` note into `Inbox/`, which syncs back to the desktop where the
  existing `download-webpage` / `save-research` workflows enrich it.
- **Read-only & private.** The only write path in the whole app is the share
  capture. The reader never modifies or deletes existing notes — enforced by a
  regression test that asserts the shell only invokes allowed read commands.

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
  persisted as a security-scoped bookmark in an App Group container so the Share
  Extension shares it. (A shared app iCloud container would remove the picker
  entirely but force a desktop relocation + migration — rejected for v1.)
- **Command surface.** `ios_pick_library_folder` / `ios_get_library_grant` /
  `ios_clear_library_grant` (grant lifecycle); `ios_list_directory` /
  `ios_read_file` / `ios_read_binary` / `ios_ensure_downloaded` (iCloud-aware
  reads); `ios_write_capture` (Inbox write). All `relPath`s are relative to the
  granted root; the Rust layer rejects absolute paths and `..` traversal. See
  `docs/tauri-commands.md` → "iOS Library & Capture Operations".
- **Capture format.** Produced by the pure, unit-tested
  `capture::build_capture_note` (frontmatter `type: capture` / `source_url` /
  `title` / `date_saved` / `tags`; body = the link + any shared selection;
  filename `Inbox/YYYY-MM-DD-HHmmss-<slug>.md`). The Share Extension mirrors it
  in Swift.

## v1 limitations (deferred)

- EPUB/DOCX/PPTX in-app rendering (shown as "open on your Mac"). PDF renders in-app.
- Chart and drawing blocks (``` ```chart ```, ``` ```excalidraw ```) render as
  code rather than as diagrams — the comrak pipeline emits them as fenced code
  and the mobile reader mounts no node-views. Callouts, tables, task lists and
  syntax highlighting DO render, because the reader shares the desktop's
  renderer.
- No editing, no AI, no SQLite index, no Android. See the PRD's "Out of Scope".

## Key files

| File | Purpose |
| --- | --- |
| `src/lib/platform.ts` | `isIos()` / `isMobile()` root-shell selection |
| `src/MobileApp.tsx` | iOS root — grant-gated screen switch |
| `src/components/mobile/Onboarding.tsx` | One-time permission / re-grant screen |
| `src/components/mobile/LibraryBrowser.tsx` | Push-navigation folder browser |
| `src/components/mobile/Reader.tsx` | Markdown / HTML / text / image / PDF reader + iCloud download |
| `src/lib/markdown-render.ts` | `renderMarkdownFragment` — the shared Rust markdown renderer |
| `src-tauri/crates/notesage-capture/` | The one capture-note formatter; C ABI for the Share Extension |
| `src/lib/ios-api.ts` | Typed wrappers for the iOS Tauri commands |
| `src/stores/mobile-store.ts` | Grant + navigation state machine |
| `src-tauri/src/commands/ios_library.rs` | iOS commands (cfg-gated) |
| `src-tauri/src/commands/capture.rs` | Pure capture-note builder + tests |
| `src-tauri/ios/` | Staged native layer: `LibraryAccess.swift` (logic), `NotesagePlugin.swift` (Tauri bridge), `ShareViewController.swift`, `*.entitlements`, `ShareExtension-Info.plist`, wiring README |
