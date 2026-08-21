# Tasks: Self-Contained Articles

Breakdown of `docs/prds/2026-08-21-self-contained-articles.md`.

Ordered so each slice lands independently and the risky unknown is resolved
before anything is built on top of it.

---

## Phase 0 — Resolve the load-bearing unknown

### #0.1 Does QuickLook render data-URI images in a thumbnail? 🚧

The PRD's open question 1. Everything about the *thumbnail* half depends on
it; the offline half does not.

Build a two-file fixture — one HTML with a remote `<img>`, one with the same
image as a data URI — put both in the library, and look at the gallery.

- **Both blank** → QuickLook renders no images at all; thumbnails need our own
  render-and-cache path (`PageRenderer` has the machinery). Phase 1 still
  proceeds, for offline.
- **Data URI renders** → thumbnails come free with Phase 1.

Needs a device. Cheap to run, and the answer redirects real work, so it goes
first.

---

## Phase 1 — Sweep new captures

### #1.1 Rust: image URL extraction + HTML rewrite ✅

In `notesage-capture`, pure and unit-tested — no network, no device:

- `article_image_urls(html) -> Vec<String>` — remote `http(s)` `<img src>` in
  document order (reuse the existing `img` selector from ad-stripping).
  Skips data URIs and relative paths.
- `inline_article_images(html, map) -> String` — rewrite `src` from a
  url→data-URI map, leaving unmapped images untouched.

Tests: order preserved, duplicates collapse to one fetch, already-inlined
documents are no-ops, unmapped images survive, `srcset` does not resurrect a
remote fetch.

### #1.2 Swift: fetch + downsample + encode ✅

`.utility` QoS serial queue, one image at a time.

- Size from the GET response's `expectedContentLength`; cancel over the
  per-image cap. Abort mid-stream when the header is absent.
- `CGImageSourceCreateThumbnailAtIndex` to downsample without fully decoding.
- Re-encode JPEG; return base64.
- Any failure → skip that image, keep its remote URL. A partial article is a
  working article.

### #1.3 Stream the document to disk ✅ — not needed; dropped deliberately

**Resolved by design rather than implemented, and the scope reduction is
deliberate — not an omission.**

This existed to survive the Share Extension's ~120 MB ceiling, which is
unrecoverable: exceed it and iOS kills the process with the sheet open. But
phase 1 moved the work into the APP, and the app has no such ceiling.

The realistic peak there: a 12-image article at default settings is ~250 KB
per JPEG → ~333 KB base64 → ~4 MB of map, plus one copy of the rewritten
document. Under 10 MB, for a process that routinely renders PDFs.

Streaming would buy nothing measurable and cost a chunked-write path that
must not corrupt a file if interrupted — real complexity guarding a risk that
no longer exists. The plain read → rewrite → coordinated atomic write via
`ios_write_file` is both simpler and safer.

**This reverses if the work ever moves back into the extension** (e.g. inlining
at capture time). The ceiling is a property of where the code runs, not of
the algorithm — so if that moves, revisit this.

### #1.4 Tauri command ✅

`ios_inline_article_images(relPath)` returning immediately, plus a progress
event. **Image bytes never cross IPC.**

### #1.5 Foreground sweep ✅

Hang off the existing `visibilitychange` hook (#650). Find Inbox documents
with remote images, queue them, rewrite one at a time.

Guard against: sweeping the same document twice, sweeping while offline,
sweeping a document the user has open.

### #1.6 Passive progress indicator ✅

No modal, no blocking, no spinner over the content. The library stays fully
usable while a sweep runs.

---

## Phase 2 — Settings

### #2.1 Scale + quality settings ✅

Max dimension (Original / 2048 / 1600 / 1200), JPEG quality, master toggle.
Default **1600px / q0.8 / on**.

### #2.2 Wire settings through to the native job ✅

Read at job start, not per image, so a mid-sweep change cannot produce a
document with inconsistent image sizes.

---

## Phase 3 — Retroactive sweep

### #3.1 Find upgradable documents ✅

Scan the library (not just Inbox) for HTML with remote images. Report count
and an estimated size delta **before** doing anything.

### #3.2 Opt-in trigger + progress

Explicit user action. Resumable, cancellable, and it must survive being
interrupted mid-document without corrupting the file.

---

## Phase 4 — Background completion

### #4.1 `BGProcessingTask`

Entitlement + registration so the sweep can finish without a launch. Phase 1
must already work standalone — iOS runs these opportunistically and may defer
for hours.

---

## Deferred (tracked, not scheduled)

- **Markdown captures.** Same defect, but base64 in markdown is hostile to
  read and edit — sidecar images are likely correct there even though HTML
  goes inline. PRD open question 2.
- **Desktop parity.** Capture is iOS-only today.

---

## Out of scope

Inlining fonts, CSS, video, or iframes. Archiving whole pages — #612 settled
that the unit is the extracted article.
