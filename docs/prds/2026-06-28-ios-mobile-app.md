# PRD: Notesage iOS Mobile App — Reader + Share Capture

|  |  |
| --- | --- |
| **Date** | 2026-06-28 |
| **Status** | In progress — in-harness layers implemented (reader incl. PDF, store, commands, capture, tests, docs); native iOS wiring + on-device validation pending |
| **Priority** | Medium |
| **Impact** | Read your Notesage library on iPhone/iPad, and capture links from any app via the iOS share sheet straight into the library |
| **Tasks** | [ios-mobile-app-tasks](../tasks/2026-06-28-ios-mobile-app-tasks.md) |
| **Phase** | Mobile (first companion app) |

## Problem

Notesage is a macOS-first desktop app. The library already syncs to iCloud Drive (`~/Library/Mobile Documents/com~apple~CloudDocs/Notesage/`), so the *files* are on every Apple device — but there is no way to **read** them on iOS, and no way to **capture** something on the phone (a web page, a tweet/X thread, an article) into the library without round-tripping through the Mac.

Two concrete pains:

1. **Reading is desktop-only.** A user away from their Mac can't open a note, re-read research, or check a project — even though the markdown is sitting in iCloud on their phone.
2. **Capture has no mobile on-ramp.** Interesting things surface on mobile (Safari, the X app, a newsletter). Today the user has to email themselves a link or wait until they're back at the desk. There's no "Share → Notesage" path.

This PRD scopes the **smallest useful companion app**: a read-only viewer plus a share-sheet capture target. It deliberately does *not* port the editor, AI, or agent stack to mobile — those are large and depend on desktop-only infrastructure (Seatbelt sandboxing, the bundled `llama-server` sidecar, ACP subprocesses).

## Goals / Non-Goals

### Goals

1. **Browse + read the library on iOS.** Open the Notesage folder, navigate projects/folders, and read markdown notes (rendered, not raw) plus the existing viewable formats (PDF, EPUB, DOCX, plain text, code) where feasible on mobile.
2. **Capture links via the iOS share sheet.** From Safari, the X/Twitter app, or any app that shares a URL/text, "Share → Notesage" writes a capture note containing the link (and any shared title/selection) into the library. No content fetching on-device.
3. **One codebase.** Build with **Tauri Mobile (Tauri v2 iOS)** reusing the existing React/TypeScript frontend, markdown pipeline, and viewers — not a separate native app.
4. **Stay in sync for free.** Reads and capture-writes go through the same iCloud-synced folder the desktop already uses; the desktop's existing workflows (`download-webpage`, `save-research`) enrich captures later. No new sync engine.
5. **Read-only safety.** The only write path is share-capture creating new files. The app never modifies or deletes existing notes.

### Non-Goals

- **No editing of existing notes** (no Tiptap editor on mobile).
- **No on-device content fetching/extraction.** Captures store the link only; enrichment happens later via desktop/agent workflows.
- **No AI features** — no chat, agents, skills, MCP, completions, transcription, or local inference on mobile.
- **No Android** (and no iPadOS-specific layout work beyond what comes free).
- **No iCloud configuration/migration UI** — the app reads an already-synced folder; it does not move projects in/out of iCloud.

## User Stories

- As a Notesage user away from my Mac, I want to open my library on my iPhone and read a note, so that I can reference my work anywhere.
- As a reader, I want notes rendered (headings, lists, tables, code, callouts) rather than raw markdown, so that they're pleasant to read on a small screen.
- As someone browsing Safari on my phone, I want to tap Share → Notesage and have the page's link saved into my library, so that I can process it properly later on desktop.
- As an X/Twitter user, I want to share a tweet or thread to Notesage and have the link captured, so that the desktop workflow can fetch and expand it.
- As a user, I want captures to land somewhere predictable (an Inbox) and show up on my Mac via iCloud, so that I never lose what I sent.
- As a privacy-conscious user, I want to know the app only reads the folder I granted and only ever *adds* capture notes, so that I trust it with my library.

## Technical Approach

### Shell: Tauri Mobile, thin mobile slice

Tauri v2 targets iOS. We reuse the existing `src/` React app but mount a **dedicated mobile shell** rather than `QuietLayout` — gated the same way the desktop layout is gated today (`settings.uiPreview`), via a platform check.

- A new `MobileApp.tsx` root (selected in `App.tsx` when running on iOS) renders a mobile-native navigation: a **library browser** screen and a **reader** screen. No command bar, no agent orb, no sidebar sections beyond a simple file list.
- Reuse without modification: the markdown render path (`render_markdown_preview` / `markdown_to_html`), the viewer components (`PdfViewer`, `EpubViewer`, `DocxViewer`, `PlainTextViewer`, `CodeEditor` in read-only mode), `globals.css`/`editor.css` tokens, light/dark theme.
- Compile out / never mount on mobile: editor write paths, AI hooks (`useAIOperations`, ACP, Copilot, local inference), watcher, git, telemetry SDKs, transcription. These depend on desktop-only Tauri commands and sidecars. The mobile Tauri binary registers only the handful of commands below.

### Library access on iOS (the load-bearing decision)

The Notesage library lives at a **fixed, known location** — the desktop app writes it to the *generic* iCloud Drive at `~/Library/Mobile Documents/com~apple~CloudDocs/Notesage/`. On macOS an app can open that path directly. On **iOS it cannot**: a sandboxed iOS app has no API to open a hardcoded path inside `com~apple~CloudDocs` (and `NSMetadataQuery` on iOS only searches the app's *own* ubiquity container, not the generic Drive). Apple's only supported way for an iOS app to reach a folder in the generic iCloud Drive is a **user-granted, security-scoped** grant via the document picker.

So the grant is **not** "tell us where your notes are" — the location is known. It is a **one-time iOS permission handshake** for a folder we already expect:

1. **First-run permission grant.** The app presents `UIDocumentPickerViewController` (folder mode) **pre-navigated to `iCloud Drive/Notesage`**, so for the common case the user just confirms the highlighted folder — a single tap, not a file hunt. (If the desktop hasn't created it yet, the picker still lands in iCloud Drive.) iOS returns a security-scoped URL.
2. **Persist a security-scoped bookmark** for that URL so access survives relaunch — the user is never asked again unless the grant goes stale. Store it where both the app *and* the share extension can read it — an **App Group** shared container (`group.<bundle-id>`), via shared `UserDefaults` (bookmark data) or the shared Keychain.
3. **All reads** `startAccessingSecurityScopedResource()` → enumerate/read → `stop...`. iCloud items may be **not-yet-downloaded placeholders**; the layer must trigger/await download (`NSFileCoordinator` / `startDownloadingUbiquitousItem`) and surface a "downloading" state.

This is implemented as a **small iOS Rust/Swift bridge** behind new Tauri commands so the React layer stays platform-agnostic (it still calls `read_file` / `list_directory`-shaped commands; the mobile implementations resolve through the bookmark + file coordinator instead of raw paths). Desktop `file.rs` semantics are mirrored, not reused verbatim.

> **Rejected alternative — shared app iCloud container (zero picker).** Hosting the library in a shared `iCloud.<team>.notesage` container that both apps declare would let iOS open it directly with no picker (and it would still surface as a "Notesage" folder in iCloud Drive via `NSUbiquitousContainerIsDocumentScopePublic`). It was rejected for v1 because it forces the **desktop** to relocate the library out of the generic iCloud Drive into the container path and migrate every existing user's library. The one-time picker confirmation is the cheaper trade-off; the container approach remains a viable future migration if the grant UX proves annoying.

### Share capture (iOS Share Extension)

A separate **Share Extension** target receives `public.url` / `public.plain-text` items from the system share sheet.

- The extension reads the **same security-scoped bookmark** from the App Group container, resolves the Notesage folder, and **writes a capture note** — it does not launch the main app or fetch anything.
- **Capture format (link-only, per decision):** create a markdown file in a fixed **Inbox** location (`Notesage/Inbox/` or the library root `Inbox/`), one file per capture, with frontmatter the desktop already understands:

  ```markdown
  ---
  type: capture
  source_url: https://x.com/user/status/123
  title: <shared title if provided>
  date_saved: 2026-06-28T10:14:00Z
  tags: [inbox]
  ---

  https://x.com/user/status/123

  <optional shared selection text>
  ```

  Filename: `Inbox/YYYY-MM-DD-HHmmss-<slugified-title-or-host>.md`. No network call; the body is just the link (+ any shared text). Desktop/agent workflows (`download-webpage`, `save-research`) recognize `type: capture` and enrich later.
- Writes use `NSFileCoordinator` for iCloud-safe atomic writes; iCloud propagates the new file to the Mac.

### Why link-only

Per the capture decision, on-device readability extraction / tweet-thread reconstruction is explicitly out of scope. It would require networking, a readability engine, and X/Twitter handling inside a memory-constrained share extension. Storing the link keeps the extension fast and reliable; the existing desktop workflows are the enrichment engine.

## UI/UX

Mobile-native patterns, but themed with the existing Notesage tokens (neutral palette, optional accent, light/dark). Design-system rules still apply: shadcn/ui where it maps to mobile, generous spacing, transitions, no default browser chrome.

**Screen 1 — Library browser**
- Stack/list navigation: top-level shows Projects + folders + root notes from the granted folder. Tapping a folder pushes a new list level (standard iOS push navigation).
- Each row: file/folder icon (lucide), name, subtle secondary text (modified date). iCloud-not-downloaded items show a small download glyph and fetch on tap.
- States: **loading** (skeleton rows), **empty** ("No notes yet"), **error / no access** ("Grant access to your Notesage folder" → folder picker), **needs re-grant** if the bookmark went stale.

**Screen 2 — Reader**
- Rendered note in a clean reading column (reuse `.ProseMirror`-style read CSS). Format-appropriate viewer for non-markdown files.
- Top bar: back, title, overflow (Open in… / Share link out / Copy). Read-only — no formatting toolbar.
- States: **loading** (render placeholder via `render_markdown_preview` while content loads), **download-in-progress** for iCloud placeholders, **unsupported format** fallback (offer "Open in…").

**First-run / onboarding**
- One screen explaining that iOS requires a **one-time permission** to read your iCloud `Notesage` folder, and that the app only ever *adds* capture notes. Primary button opens the picker **pre-pointed at `iCloud Drive/Notesage`** so it's a confirm tap. Copy frames it as granting access to a known folder, not choosing where notes live. After grant → library browser; the user is not asked again unless the grant goes stale.

**Share sheet (system UI, our extension)**
- Minimal extension UI: a compact sheet confirming "Saved to Notesage Inbox" (or a tiny form: optional tag/title), then dismiss. No browsing inside the extension. Errors (no folder granted yet) show a clear "Open Notesage to set up" message.

## Data Model

### New Tauri commands (iOS targets only)

```rust
// Resolve / manage the security-scoped library grant
#[tauri::command] async fn ios_pick_library_folder() -> Result<LibraryGrant, String>;
#[tauri::command] async fn ios_get_library_grant() -> Result<Option<LibraryGrant>, String>;
#[tauri::command] async fn ios_clear_library_grant() -> Result<(), String>;

// Read paths, resolved through the bookmark + NSFileCoordinator (iCloud-aware)
#[tauri::command] async fn ios_list_directory(rel_path: String) -> Result<Vec<FileEntry>, String>;
#[tauri::command] async fn ios_read_file(rel_path: String) -> Result<String, String>;
#[tauri::command] async fn ios_read_binary(rel_path: String) -> Result<Vec<u8>, String>; // PDF/EPUB/DOCX viewers
#[tauri::command] async fn ios_ensure_downloaded(rel_path: String) -> Result<DownloadState, String>;

// Capture (also callable from the share extension's own write path)
#[tauri::command] async fn ios_write_capture(input: CaptureInput) -> Result<String, String>; // returns rel path
```

```rust
pub struct LibraryGrant { pub display_name: String, pub granted: bool }
pub enum DownloadState { Ready, Downloading, Failed }

pub struct CaptureInput {
    pub url: String,
    pub title: Option<String>,
    pub selection_text: Option<String>,
    pub tags: Vec<String>, // defaults to ["inbox"]
}
```

`FileEntry` reuses the existing shape (`name`, `path`/`rel_path`, `is_directory`, `children`, `hidden`).

### Frontend

- `mobile-store` (Zustand, persisted): `{ grantState, currentPath, recentlyRead[] }`. Small — no editor/AI/workspace stores on mobile.
- A `platform` helper (`isMobile()` / `isIos()`) gating which root mounts in `App.tsx` and which hooks run.
- Reuse `parseFrontmatter`, markdown render types, and viewer prop types as-is.

### Capture note schema

`type: capture` frontmatter (above). Chosen so the desktop SQLite index and existing research/skill workflows can discover and enrich captures with no new format.

## Dependencies

- **Tauri v2 iOS toolchain** — Xcode, Apple Developer account, iOS targets added to `src-tauri` (`tauri ios init`). New iOS-only capability/permission set; the desktop capability surface is untouched.
- **App Group + Share Extension** Xcode targets, shared container entitlement (`group.<bundle-id>`), iCloud Drive document-access entitlement.
- **Swift/Obj-C bridge** for `UIDocumentPicker`, security-scoped bookmarks, and `NSFileCoordinator` (invoked from the new iOS Tauri commands).
- No new JS libraries expected for v1 (viewers already vendored). Confirm `pdfjs-dist`, foliate-js, `docx-preview`, CodeMirror behave under iOS WKWebView; degrade to "Open in…" where they don't.

## Quality Gates

### Functional

- [ ] First run opens the picker pre-pointed at `iCloud Drive/Notesage` so granting is a single confirm; the grant persists (bookmark) and access survives relaunch without re-prompting.
- [ ] Library browser lists projects/folders/notes from the granted folder; nested navigation works.
- [ ] Tapping a markdown note opens it **rendered** (headings, lists, tables, code, callouts) — not raw.
- [ ] iCloud not-yet-downloaded files trigger download and show a downloading state, then open.
- [ ] At least PDF and plain-text/code files open via existing viewers; unsupported formats offer "Open in…".
- [ ] Sharing a URL from Safari and from the X/Twitter app creates a `type: capture` note in `Inbox/` containing the link.
- [ ] The capture note appears on the desktop via iCloud and is recognized by the desktop index/workflows.
- [ ] The app never modifies or deletes an existing note (verified read-only except the Inbox write path).
- [ ] Graceful states for: no grant, stale grant, empty folder, offline/iCloud-unavailable.

### Design

- [ ] Mobile UI uses the Notesage palette/tokens and looks polished in light **and** dark mode.
- [ ] Reading column is comfortable on iPhone widths; typography matches the desktop reading feel.
- [ ] Loading/empty/error states are all designed (no raw spinners or stack traces).
- [ ] Touch targets, navigation, and the share-extension confirmation feel native, not like a shrunk desktop app.

### Engineering

- [ ] iOS-only commands compile behind `#[cfg(target_os = "ios")]`; desktop build and its capability-surface regression test are unaffected.
- [ ] `pnpm typecheck` and existing unit tests stay green; mobile shell components have unit coverage for the grant/empty/error state machine.

## Out of Scope

- Android (separate sync story — SAF/Files, no iCloud).
- Editing existing notes; quick-note creation beyond capture.
- On-device content fetching / readability extraction / tweet-thread reconstruction (handled by desktop workflows).
- Any AI, agent, skill, MCP, completion, transcription, or local-inference feature on mobile.
- iCloud setup/migration UI, git, external-change diff review.
- Offline full-text search / the SQLite index on mobile (reads are folder-walk based in v1).
- iPad-optimized multi-column layout (single adaptive layout for v1).
- Push notifications, widgets, Shortcuts integration.
