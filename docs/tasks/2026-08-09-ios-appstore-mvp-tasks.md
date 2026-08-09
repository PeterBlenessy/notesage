# Tasks: Notesage iOS — App Store Launch MVP

PRD: `docs/prds/2026-08-09-ios-appstore-mvp.md`.

Legend: ✅ done · 🚧 in progress · (blank) pending.

## Feature: Rich web capture

### #1 — Readable extraction + HTML→markdown in Rust
`notesage-capture` grows `extract_article(html, url) -> Option<Article>`
(title, byline, markdown body) using dependency-light readability +
html→markdown crates. Unit tests over fixture pages (article, nav-heavy page,
non-article). Exposed over the C ABI and re-exported for the app crate.

### #2 — Share Extension: fetch + content routing
URLSession fetch with ~10 s budget and a hard size cap. Route by
content-type: HTML → #1 extraction → markdown capture note; document types →
#4 file save; anything else / any failure → v1 link-only note. Never fail a
capture outright.

### #3 — Capture note format v2
Extend `build_capture_note` for a body-bearing variant (frontmatter unchanged
+ `capture_format: markdown`). Keep the link-only builder as the fallback
path. Round-trip tests.

## Feature: Document capture

### #4 — Store shared documents as files
Extension activation accepts file attachments (PDF/EPUB + other
redistributable UTIs). Files copy into `Inbox/` with slugged collision-safe
names via the shared grant. URL-shared documents ride #2's sniffing.

## Feature: Create + edit

### #5 — Write commands with an allowlisted surface
`ios_write_file` / `ios_create_note` in `ios_library.rs` + plugin +
`LibraryAccess.swift` (coordinated writes). Extension allowlist `.md`,
`.markdown`, `.txt`, `.text`. Rewrite the read-only regression test into a
write-surface test.

### #6 — Editor screen
Source-mode editor for markdown/txt: plain textarea UX, save on
back/background + explicit save, dirty indicator, dark mode. Edit affordance
in the Reader for editable types; rendered preview = existing reader.

### #7 — New-note affordance
Create-note button in the library browser (current folder), name prompt or
first-line slug, opens straight into #6.

## Workstream: App Store readiness

### #8 — Telemetry-free iOS binary, verified
Confirm (or cfg-gate) that Sentry/Aptabase never compile into the iOS target;
add a check the privacy label can lean on ("Data Not Collected").

### #9 — App Store Connect setup
App record for `com.notesage.app`, distribution cert + App Store profiles
(app + extension), privacy policy URL published and linked.

### #10 — Store metadata + screenshots
Name/subtitle/description/keywords within limits, 6.9" + 6.5" screenshots
(light + dark), age rating, Productivity category, support URL.

### #11 — Review-safe first run
Verify onboarding/cancel/empty-library with no iCloud account; write App
Review notes documenting the local-folder demo path.

### #12 — TestFlight pipeline
`tauri ios build --export-method app-store-connect`, upload, internal
TestFlight pass on a clean device. `ITSAppUsesNonExemptEncryption = false`.

## Workstream: Quality

### #13 — Code-review remediation
Triage the 2026-08-09 mobile code review: fix Critical/High before launch,
schedule Medium/Low.

### #15 — iOS bottom navigation (issue #581) ✅
Move the mobile shell's chrome to bottom-anchored toolbars per iOS
convention (reachability + native feel): browser, reader, and the new
editor screen designed bottom-bar-first. Respect safe-area-inset-bottom;
land before the store screenshots are taken.

### #14 — Docs
`mobile.md` v2 (capture pipeline, write surface, editor), tauri-commands.md
additions, PRD/task cross-marks per process.
