# PRD: Notesage iOS — App Store Launch MVP

Extends the shipped v1 reader (`docs/prds/2026-06-28-ios-mobile-app.md`) into
an App Store-launchable MVP. Tasks:
`docs/tasks/2026-08-09-ios-appstore-mvp-tasks.md`.

## Problem

v1 proves the reader + link capture on device, but three gaps keep it short of
a store-worthy product, and none of the store-side machinery (privacy labels,
metadata, distribution signing) exists yet:

1. A captured web page is only a **link** — the content isn't there when you
   want to read it on the train. (v1 deliberately deferred enrichment to
   desktop workflows; for a store MVP the capture itself must carry content.)
2. Sharing a **document** (a PDF opened in Safari, an EPUB download) also
   stores only a URL — the document is what the user wanted to keep.
3. The app is strictly read-only. A store MVP needs at least **create + simple
   edit** for markdown/plain-text notes.

## Goals

- Share → Notesage stores a web page's **readable content as markdown**
  (frontmatter keeps `source_url`; body = extracted article). Link-only
  remains the graceful fallback when extraction fails or times out.
- Share → Notesage with a **document** (PDF/EPUB/other redistributable
  formats) — whether shared as a file or as a URL that serves one — stores
  **the document itself** in the library, no conversion.
- **Create new notes** and **edit markdown/txt** files in a simple
  source-mode editor (not Tiptap; plain text with the existing rendered
  preview one tap away).
- **Pass App Store review**: privacy labels backed by reality (no data
  collection on iOS), complete metadata, review-safe first-run (works with no
  iCloud account and no desktop), TestFlight → App Store pipeline.

## Non-Goals (unchanged from v1 unless listed above)

- No Tiptap/WYSIWYG editor on mobile — source-mode editing only.
- No AI features, no SQLite index (search stays post-launch), no Android.
- HTML-format capture storage is **post-launch** (user-selectable setting);
  MVP stores markdown.
- No tweet-thread reconstruction or paywalled-content workarounds — readable
  extraction only, fallback to link.

## Technical Approach

### Rich web capture (markdown)

- **Extraction and conversion live in Rust** (`notesage-capture` crate):
  readable-content extraction + HTML→markdown conversion via dependency-light
  crates, exposed through the existing C ABI for the Share Extension and as a
  Tauri command for in-app use. One implementation, tested in Rust — same
  principle as the capture formatter.
- **The Share Extension fetches the page** (URLSession, ~10 s budget, size
  cap) and hands the HTML to Rust. On success: note with `type: capture`
  frontmatter (`source_url`, `title`, `date_saved`, `tags`) and the article
  markdown as body. On any failure: today's link-only note — capture must
  never fail outright because a site is slow.
- Extension memory stays bounded (App Extensions get ~120 MB): streaming
  download with a hard cap, extraction on the downloaded string only.

### Document capture

- Extension activation rule gains file attachments (PDF, EPUB, and other
  redistributable document UTIs) alongside web URLs.
- A shared **file** is copied into `Inbox/` under a slugged, collision-safe
  name (same rule as capture notes).
- A shared **URL** is content-type sniffed during the capture fetch: documents
  are saved as files, HTML goes through extraction. The reader already opens
  PDFs; EPUB stays "open on your Mac" for now.

### Create + edit

- New Tauri commands `ios_write_file(relPath, content)` and
  `ios_create_note(folder, name)` — coordinated writes through the
  security-scoped bookmark, path-sanitized like every read, **extension-
  allowlisted** (`.md`, `.markdown`, `.txt`, `.text`). The v1 "read-only"
  regression test becomes a **write-surface** test: writes happen only through
  these commands, nothing deletes, nothing renames.
- Editor screen: plain-text editing of the raw source (system font stack,
  no highlighting in MVP), reachable from the reader via an Edit affordance
  on editable file types. Save on back/background; explicit save affordance;
  rendered preview is the existing reader view.
- New-note affordance in the library browser (defaults to the current
  folder), filename from first line/slug.

### App Store readiness

- **Privacy**: verify the iOS build compiles with telemetry fully out
  (Sentry/Aptabase are desktop concerns) so the privacy label is
  "Data Not Collected"; privacy policy URL published (repo Pages or
  notesage site).
- **Versioning**: iOS marketing version derives from `package.json` minus the
  prerelease tag (already automatic); store submissions bump the base
  version, not the alpha suffix.
- **Signing/distribution**: App Store Connect app record for
  `com.notesage.app`, distribution certificate + profiles (extension
  included), `tauri ios build --export-method app-store-connect`, TestFlight
  first.
- **Review safety**: first-run must demo well with no iCloud and no desktop —
  the picker already works with local On My iPhone folders; review notes
  document that path. Empty-library and denied-picker states verified.
- **Compliance**: `ITSAppUsesNonExemptEncryption = false` (HTTPS only),
  6.9"/6.5" screenshots, name/subtitle/description/keywords within limits,
  age rating, Productivity category.
- **Guideline 4.2 posture**: native document integration, offline reading,
  share extension, editing — clearly beyond a wrapped website; no remote
  site is loaded at all.

## Quality Gates

- [ ] Shared article stores readable markdown; slow/failed fetch degrades to link-only
- [ ] Shared PDF (file and URL) lands as the document in `Inbox/` and opens in the reader
- [ ] Create note → edit → re-open on desktop round-trips cleanly (no format damage)
- [ ] Write-surface regression test enumerates the exact allowed write commands
- [ ] Embedded-simulator harness pass for every new surface (CSP truth, not dev-server truth)
- [ ] Device pass on iPhone: capture (article/document), edit, dark mode
- [ ] Privacy label = Data Not Collected, verified against the shipped binary
- [ ] TestFlight build installs and runs on a clean device without developer tooling
- [ ] Code-review findings from the 2026-08-09 review triaged: Critical/High fixed pre-launch

## Out of Scope (post-launch backlog)

- HTML-format capture storage (user-selectable), on-device search / SQLite
  index, folder-listing performance overhaul (measure first), EPUB/DOCX/PPTX
  viewers, chart/drawing block rendering, iPad layout, widgets/Shortcuts/push,
  Android.
