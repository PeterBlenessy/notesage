# PRD: Self-Contained Articles — Inline Images for Captured Documents

**Status:** Draft
**Date:** 2026-08-21
**Depends on:** #611 / #612 (clean article capture), shipped in iOS build 5
**Tasks:** `docs/tasks/2026-08-21-self-contained-articles.md`

## Problem

A captured article keeps its images as remote `https://` URLs. The saved
document is therefore not the article — it is a recipe for fetching the
article, and it only works while the network is up and the CDN still serves
those exact paths.

Two symptoms, one cause:

- **Gallery thumbnails render as text.** QuickLook generates thumbnails with
  no network access, so every `<img>` is a blank. A folder of saved articles
  looks like a folder of documents nobody bothered to illustrate.
- **Saved articles are not offline-safe.** Read one on a plane and the images
  are gone. Read one in two years and they may be gone permanently — CDN
  paths rotate, sites restructure, publications fold.

The second is the real defect. The thumbnail is just the first place it became
visible. "Saved" should mean saved.

## Goals / Non-Goals

### Goals

- A captured article is **self-contained**: images embedded, readable with no
  network, indefinitely.
- Capture stays **fast**. Sharing from Safari must not wait on image
  downloads.
- The transformation **never blocks the UI**. Opening the app must not stutter
  because a sweep is running.
- **Existing captures can be upgraded** — the fix is worth as much to the back
  catalogue as to new saves.
- Library growth stays **proportionate**, via downscaling.

### Non-Goals

- Inlining anything but images (no fonts, CSS, video, or iframes).
- Archiving a *page*. The unit remains the extracted article — #612 settled
  that and this does not reopen it.
- Desktop parity in this phase. The capture path is iOS-only today.

## Decisions already taken

| Question | Decision | Why |
| --- | --- | --- |
| Inline base64 vs sidecar asset files | **Inline base64** | Peter's call: a saved article should be one portable file. Sidecars sync more cheaply and skip base64's 33% inflation, but split the artifact. Downscaling (below) removes most of the cost that motivated sidecars. |
| Prompt the user when an article is image-heavy? | **No** | Asked at the worst moment (mid-task in Safari) and unanswerable — the user cannot judge cost without the headers we have not fetched. A sweep that always finishes makes the question moot. |
| Where the work runs | **Natively, off the main thread** | Image bytes must never cross IPC into the WebView. |
| Downscaling | **A setting, defaulting to on** | At 1600px/q0.8 a press photo goes from ~3 MB to ~250 KB with no visible loss on a 390pt screen. This is what makes inlining affordable. |

## Technical Approach

### The load-bearing constraint: images never enter the WebView

The frontend starts a job and listens for progress. It never sees image bytes.
Multi-MB base64 crossing IPC into JavaScript would jank the UI regardless of
how the work is scheduled — the same reasoning that put thumbnail generation
on `QLThumbnailGenerator` instead of reading files over IPC.

### Division of labour

| Layer | Owns | Why there |
| --- | --- | --- |
| Rust (`notesage-capture`) | Extracting image URLs from article HTML; rewriting HTML with a url→data-URI map | Pure and already unit-tested (53 tests). Keeps "which images, what the output looks like" testable with no network and no device. |
| Swift | Fetching, downsampling, re-encoding | `CGImageSourceCreateThumbnailAtIndex` downsamples **without fully decoding** — a 4000px photo never becomes a 60 MB bitmap. No Rust image crate can match that on iOS. |
| Swift | Scheduling | `.utility` QoS serial queue, one image at a time, so the OS deprioritises it while the user interacts. |
| Frontend | Starting the job; a passive progress indicator | Nothing else. |

### Memory

The extension's ~120 MB ceiling is unrecoverable — iOS kills the process and
the sheet vanishes. Two properties keep us far below it:

1. **Stream to disk.** Write head, append each encoded image, append tail.
   Peak memory is one image, not the whole document. (Building the document as
   a growing string transiently holds it twice.)
2. **Downsample before encoding.** The bytes held are the *output* size, not
   the source's.

The document lands via the coordinated atomic replace `ios_write_file`
already uses.

### Sizing images before paying for them

A separate `HEAD` is unreliable — many CDNs omit `Content-Length` on HEAD or
do not implement it. Use the GET response headers, which arrive before the
body: read `expectedContentLength`, cancel if over the per-image cap, and fall
back to aborting mid-stream when the header is absent. Same information, one
round trip.

### Where the sweep runs

There is **no background execution in the app today** — no `BGTaskScheduler`,
no `UIBackgroundModes`. There *is* a `visibilitychange` foreground hook
(#650). Phase 1 hangs the sweep there. `BGProcessingTask` is a phase-3
addition: it needs an entitlement, and iOS runs it opportunistically
(typically charging + wifi), so it improves the story but cannot be the whole
story.

The narrow risk this leaves: share an article, go offline without ever opening
the app. Link rot is slow, so the images are almost always still there
whenever the sweep does run.

## Phases

### Phase 1 — Sweep new captures

Extension keeps saving with links (fast, no new risk). On foreground, the app
finds Inbox documents with remote images and rewrites them. Passive progress
indicator; no modal, no blocking.

### Phase 2 — Settings

Max dimension (Original / 2048 / 1600 / 1200), JPEG quality, and a master
toggle. Default 1600px / q0.8 / on.

### Phase 3 — Retroactive sweep

**Opt-in, with a size estimate shown first.** This rewrites documents the user
already owns, can multiply library size, and makes the device contact every
site they ever saved from — long after they saved it. Automatic for new
captures is fine; doing it to a back catalogue unasked is not.

### Phase 4 — Background task

`BGProcessingTask` so the sweep can complete without a launch.

## Open questions

1. **Does QuickLook render data-URI images in its thumbnail sandbox?** It does
   not fetch remote ones. If it also declines inline ones, this still fixes
   offline reading but *not* thumbnails, and thumbnails would need us to
   render and cache them ourselves — feasible, since `PageRenderer` already
   has the WKWebView machinery. **Worth verifying on device before building
   the budget around it.**
2. **Markdown captures.** The same problem exists for `Article (Markdown)`,
   but base64 in markdown is hostile to read and edit. Sidecar images may be
   the right answer for markdown even though HTML goes inline — deliberately
   deferred rather than assumed.
3. **Re-sync cost.** An inlined image lives inside the text file, so editing
   one word re-uploads the whole document to iCloud. Downscaling keeps this
   tolerable; it does not eliminate it.

## Success criteria

- A shared article opens with images in airplane mode.
- Sharing is no slower than today.
- No dropped frames in the library while a sweep runs.
- A 12-image article lands under ~4 MB at default settings.
- Existing captures upgrade without the user hand-editing anything.
