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
  **Article (Markdown)** and **Article (HTML)** — the same readable
  extraction, two output shapes — plus **Link note**, the classic instant
  capture. The last choice is remembered (App Group defaults) and listed
  first; success flashes "✓ Saved…" and auto-dismisses.

  Both article formats run ONE extraction (`extract_article` in the Rust
  `notesage-capture` crate) and differ only in rendering: Markdown produces a
  `capture_format: markdown` note v2; HTML produces a self-contained `.html`
  document with reader typography, images and formatting preserved and site
  chrome/ads stripped (#612). Image URLs are absolute — the extractor resolves
  them against the source — so the document needs no `<base>` tag.

  **There is deliberately no full-page HTML capture.** MVP 1 shipped one
  ("Page (HTML)", the fetched page stored verbatim), which was a
  misreading of the requirement: the point of capturing an article has always
  been to get the article, not the page's ads and navigation. It was removed
  when **Article (HTML)** landed. The `html` format id is reused, so a
  remembered preference keeps working and now means the article.

  Both formats share one fallback chain (#611): **raw fetched HTML → rendered
  DOM → link note**. When extraction declines on the fetched HTML — which is
  what happens on a JavaScript-rendered page, whose article does not exist
  until a bundle runs — `PageRenderer` loads the URL in a hidden `WKWebView`,
  waits for the DOM to go quiet (MutationObserver, 500 ms quiet period, hard
  5 s ceiling), and re-runs extraction on the settled DOM. It is a SECOND
  attempt only: a server-rendered page never constructs a webview. The webview
  is ephemeral (no cookie access), blocks media playback, and is torn down as
  soon as it yields — the extension's ~120 MB ceiling is not a budget you can
  exceed and recover from, it kills the extension.

  **The settle constants are starting points, not measurements.** 500 ms /
  5 s want verifying against real sites: a page that mutates continuously
  never goes quiet (the ceiling catches it), and one that lazy-loads past 5 s
  yields a partial DOM (still better than a link note).

  **X statuses are enriched, not special-cased.** An X share runs the same two
  formats and the same fallback chain; what it adds is a metadata fetch
  beforehand. X's public embed endpoint
  (`cdn.syndication.twimg.com/tweet-result`) knows three things the page does
  not tell an extractor: the post's real title, its author/handle/date, and
  the **cover image** — which an X Article renders client-side, so it exists
  nowhere in the markup readability parses. Without it a capture was named
  `<display name> (@<handle>) on X` (so two articles by one author collided)
  and carried no image at all, which is why the gallery card showed a
  thumbnail of the article's own rendered text.

  The endpoint is the METADATA path, never the capture path — it returns a
  ~200-character teaser, and letting that displace a full extraction would be
  a straight regression. `enrich_x_article` therefore only corrects the title
  and prepends the cover; the body is whatever extraction found. The cover is
  *prepended* because `article_lead_image` takes the first image in document
  order, which is what makes it the thumbnail.

  It is undocumented, unversioned and rate-limits, so every path works without
  it: no JSON, or unparseable JSON, degrades to the plain article capture. A
  post with no long-form article to extract — the common case — falls back to
  the metadata-only note (`capture_format: x-post`) rather than a bare link.

  Wiring: `notesage_capture_x_metadata_url` / `_x_rel_path` / `_x_contents` /
  `_x_html_contents` → `LibraryAccess.writeXCapture` →
  `ShareViewController.saveArticle`. The chain from builder to gallery card is
  regression-locked — see "The capture pipeline contract" below.

  Documents (PDF/EPUB/file shares — the extension also declares
  `NSExtensionActivationSupportsFileWithMaxCount`) skip the picker and store
  immediately in `Inbox/` with their original names, streamed via
  `loadFileRepresentation`. Extraction quality: #610.
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
- **Confined writes & private.** The app's write surface is exactly six
  allowlisted commands (`ios_write_file`, `ios_create_file`,
  `ios_create_directory`, `ios_rename_file`, `ios_delete_file`,
  `ios_move_file`) — library-root-confined relative paths (sanitizer-guarded,
  source-shape-locked tests), coordinated `NSFileCoordinator` writes.

  Each of the last two widened the surface and was reviewed on its own for
  that reason. **Delete** is files-only, never directories. **Move** (#754) is
  files-only for the same reason — relocating a directory would move an
  arbitrary subtree in one call — sanitizes BOTH its paths, and requires the
  destination to already exist rather than creating it, so one name never
  hides two operations. A dedicated test asserts the two-path sanitization,
  because the generic "every command sanitizes" check counts a call, not two. Link/article capture still runs
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
- **Cancel is binding, and every write is off main (#779).** The save chain is
  up to twenty seconds long (X metadata ≤5 s, page fetch ≤10–15 s, render ≤5 s,
  then a coordinated iCloud write) and was tied to nothing: Cancel dismissed the
  sheet, the chain kept running, and an explicitly cancelled share still landed
  in the library — after which `completeRequest` was called on an
  already-cancelled context. Both extensions now hold a lock-guarded
  `CancelFlag`, raised **before** `cancelRequest` and consulted immediately
  before every write and every completion. Cancel deliberately stays enabled
  after Save: disabling it would also have closed the bug, but an
  undismissable fifteen-second sheet is its own. A residual window remains
  between the last check and the write itself — microseconds rather than the
  twenty seconds it was — and closing it fully would need a transactional
  write, which the file coordinator does not offer.
  In the same family, every capture writer now hops off the main thread:
  `writeOffMain` covered the article path only, so the link note, the X
  metadata note and the video note all ran their coordinated iCloud writes on
  the thread the share sheet draws on. `pipeline_contract.rs` asserts all of
  this per call site — the guards were mutation-tested, since this file has
  repeatedly shipped tests that passed for the wrong reason.
- **Share Extension wiring is scripted.** `tauri ios init` cannot create
  extension targets; `src-tauri/ios/integrate-share-extension.py` adds the
  `NotesageShare` app-extension target to the generated xcodegen project
  (sources, bridging header, a cargo phase building the capture staticlib for
  the SDK's triple, App Group entitlements on BOTH targets, version keys
  mirrored from the app) and re-runs `xcodegen generate`. Idempotent — run it
  after any `tauri ios init`.

## Swipe gestures: axis lock + `touch-action`

A swipe row that competes with a vertical scroller needs BOTH halves of the
contract, or it will drop gestures:

1. **`touch-action: pan-y`** on the draggable content. Without it WebKit owns
   the whole gesture and fires `pointercancel` the moment it decides the
   finger is scrolling — the swipe snaps back mid-drag, which reads as "it
   only works sometimes".
2. **An axis lock** decided once at 8 px and never revisited
   (`resolveDragAxis`). Horizontal wins ties and gets a 0.75 bias, because a
   thumb swipe always arcs downward; a gesture that starts vertical is
   terminal and never becomes a swipe no matter how far it later travels
   sideways. Once locked horizontal, later vertical movement is IGNORED
   rather than gradually turning the drag back into a scroll.
3. **`setPointerCapture`** on lock, so a finger that drifts onto the
   neighbouring row keeps feeding the gesture instead of silently ending it.

Long-press (below) covers the same actions, so a user who cannot land a swipe
— or a layout with no swipe at all, like the gallery — is never stuck.

## Long-press actions (#680)

Gallery cards have no swipe affordance — the grid scrolls and a horizontal
drag on a card is ambiguous — so their actions live behind a **long press**
that raises a native action sheet. List rows get the same press as a second
route to their swipe actions, which is what iOS itself does (Files and Notes
both offer swipe *and* hold).

**Rename starts from the current name**, pre-filled and editable with the
stem preselected (Files/Finder behaviour), so a small correction is a small
edit rather than retyping the whole name. The listing also **restores its
scroll position** when you come back from a document — the browser unmounts
while the Reader is open, so the offset is kept per folder in the store
(session-only) and reapplied once the rows exist.

**Move to…** (#754) files a document out of `Inbox/`, which is where every
capture lands. The picker is a stack of flat native action sheets rather than
one tree: `ios_context_menu` presents a `UIAlertController`, which has no
nesting, and a bespoke SwiftUI browser is a lot of native surface for choosing
a folder. Each level offers *Move here*, its subfolders, and a way back up —
which is also how Files behaves. It opens in the file's OWN folder, so moving
to a sibling is one step, and "Move here" on that first screen is a deliberate
no-op rather than a dedupe to `note-1.md`.

It does **not** create folders. `ios_create_directory` exists and it would be
cheap, but a picker that also creates is a bigger surface than one that only
picks, and filing into an existing folder is the common case; the "+" button
already makes folders.

Two things a move breaks that are invisible until they go wrong, both handled:
the thumbnail cache is keyed by path (a stale key makes the moved card render
someone else's image), and Recents, the back trail, scroll offsets and the
shared pins file all hold paths. `mobile-store.rewritePath` fixes all of them
— and read-modify-writes the pins FILE rather than just the cached array,
since the desktop shares it.

**Shape (Apple Notes):** the pressed item lifts out of the list as a large
rounded **preview card** over a blurred backdrop, with the actions in a panel
beneath — an inline icon row (Share / Pin / Delete) above full-width rows
(Rename, Move to… — the latter files only, matching the native command). The card **morphs out of the pressed row and back into it**: the web
layer measures the element at pointer-down and passes its rect, and the native
view interpolates position and scale from there. Dismiss by tapping the
backdrop or **swiping the preview down**. Notes render through the app's OWN markdown pipeline (a `WKWebView` on the
card, fed the same fragment the Reader and the gallery cards use) — QuickLook
renders a `.md` file as its RAW TEXT, so a note whose point is an image
previewed as a wall of markup. Other file types fall back to a QuickLook
thumbnail; folders and unrenderable files to an icon + name card.

The drag-to-dismiss gesture measures in the **global** coordinate space, not
the card's own. The card moves with the drag, so a local-space translation is
measured against a moving origin and each frame feeds back into the next —
which shows up as the card shaking under the finger.

Menu content: **Share** (files only — `ios_share_file` copies a single file to
temp), **Pin/Unpin**, **Delete** (destructive), **Rename**. Both surfaces build
their rows from `entryMenuItems` in `src/lib/mobile-entry-actions.ts`, so they
cannot drift.

**Delete confirms.** iCloud's Recently Deleted does give 30-day recovery, but
a long press or a full swipe is easy to trigger by accident and the recovery
path is not discoverable from inside Notesage. Both the menu row and the
swipe action route through `confirmDelete`.

**Pin writes the shared file.** `togglePin` read-modify-writes the same
library-root `.notesage/pins.json` the desktop sidebar reads — re-reading the
file first, so a pin made on the desktop since launch is not clobbered by a
stale in-memory copy. `.notesage/` is created if missing via
`ios_ensure_directory`, which unlike `ios_create_directory` does NOT dedupe
(deduping there would silently produce `.notesage-1` and split the state).

**Why the menu is hand-built, not a real `UIContextMenu`.** A system context
menu is driven by `UIContextMenuInteraction`, which must be attached to the
pressed *view* and starts tracking at touch-down. The pressed item is web
content inside one WKWebView — there is no native view per row to attach to,
and UIKit exposes no way to raise a context menu programmatically at a point.
`EntryContextMenu.swift` therefore draws the same control in SwiftUI: real
material, real spring physics, real haptics, so it reads as the system control
it imitates. The plain action sheet (`ios_context_menu`) remains, but only
where a sheet is genuinely the right control — the delete confirmation.

Deliberately **not** in the menu: Move (needs a folder picker plus a native
move command), Duplicate (needs a binary-safe copy, or it would silently skip
non-markdown files), Info (repeats the date already on the row), and
Quick Look (a plain tap already does it).

## Search island: fade, then collapse

Closing the folder search made the ✕ appear to fly toward the middle of the
screen. The expanded state is a field capsule filling the container with the
✕ riding its trailing edge, and both states stay MOUNTED in a ZStack — so
animating the container's width back to the pill while that content is still
visible re-lays it out every frame and drags the ✕ inward.

The two are now choreographed: the states cross-fade over `SEARCH_FADE`
(0.14 s, linear — the old 0.35 s spring's tail kept the content visible deep
into the collapse), and the width animation waits that long before starting.
Expanding is unchanged and immediate; only the collapse needed sequencing.

## Reaching the Inbox (#683)

Shared items land in `Inbox/`, but it was an ordinary folder in an
alphabetical list — after sharing a few links from Safari, reaching them meant
scrolling, or switching the whole listing to sort-by-date. Two affordances,
following Apple Notes (which pins Quick Notes / Shared in their own card above
the folder list):

- **A pinned Inbox card** above the root listing, with the item count, in a
  fixed position no sort or grouping can move. Its geometry is IDENTICAL to a
  `FileRow` — same icon size, gap, text size, weight, count, chevron — so it
  reads as one of the list's own rows that happens to be highlighted, rather
  than a different kind of control. Only the background and radius differ.
  The horizontal inset is SPLIT between the card wrapper and the button
  (8 + 8) so it totals `FileRow`'s own `px-4`; putting the full 16 px on the
  button stacks it on the wrapper's and pushes icon, count and chevron a
  further 16 px inward, visibly breaking the column the rows below establish
  (which is exactly what shipped first). Root only — one level down it
  is noise — and only when an Inbox exists. The folder is filtered out of the
  list below so it is never offered twice.
- **A permanent "Inbox" entry in the breadcrumb island's menu**, after the
  ancestors, so it is one tap from ANY depth without new corner chrome. It
  uses `jumpToFolder`, which REPLACES the folder stack — entering it would
  otherwise nest Inbox under wherever you happened to be.

Deliberately not: pinning Inbox via `pins.json` (shared with the desktop, so a
mobile navigation fix would rearrange the Mac sidebar), a sort default (only
works while that mode is kept), or opening the app into Inbox after a share
(wrong the moment you shared yesterday and want your notes today).

## List rows: one line, aligned, counted (#684)

A row was two lines (name over modified date) with the icon centred between
them, which left the icon looking unaligned with the name it belongs to. Rows
are now a single line — `[icon] [name] … [count] [chevron]` — so icon and
title sit on the same baseline, and folders carry their item count on the
right like the Inbox card.

**The count rides along on the listing.** `FileEntry.child_count` is filled in
natively for directories during the same directory walk, using the same
visibility rule as the listing itself (so a folder of dotfiles reads as empty
rather than lying). The alternative — one `ios_list_directory` per visible
folder row — would be a burst of IPC on every folder open.

**The date moved to the section headers.** Grouping by date is now
**Recently changed** (last week) then one section per month, replacing
Today / Yesterday / Previous 7 Days / Older. Coarser deliberately: the rows no
longer carry a date, so the header is the only place the date shows, and a
header that changes every day fragments a folder into slivers. Months are
stable and scannable. The year is dropped within the current year.

Note the consequence: with grouping set to **none**, dates are not shown at
all. That is the trade for a single-line row — the date is available whenever
you want it by grouping on date.

## Capturing a video link (#682)

A video page has no article to extract and its saved HTML is a player that
cannot play — capturing one produced a note showing the page's composite
poster with a drawn-on ▶ that did nothing. For a URL whose host has an oEmbed
endpoint the format picker therefore offers only **Video** and **Link note**,
with Video first.

The video note carries a labelled `[Watch on YouTube](url)` link, the author
(linked to their channel), and the provider's **clean** poster frame as a
plain image — never a fake control. Frontmatter adds
`capture_format: video`, `author`, and `provider`. The provider's title also
names the file, which is what makes a shared YouTube link land as its real
title rather than a mangled URL.

Metadata comes from the provider's **official public oEmbed endpoint**
(`youtube.com/oembed`, `vimeo.com/api/oembed.json`) — 5 s budget, 256 KB cap,
and every field optional so a provider that answers with nothing still yields
a usable note.

**Downloading the video itself is deliberately out of scope.** It would mean
reimplementing stream extraction and signature deciphering (no yt-dlp on iOS),
which breaks whenever a provider changes its player; it violates YouTube's
terms; and App Store review treats it as unauthorized access to third-party
content (guideline 5.2.3) — a real risk for an app heading to TestFlight. The
readable part of a video is what a note wants anyway. Transcribing a shared
media FILE with the desktop's Whisper stack is the planned next step, and
carries none of those problems.

## The capture pipeline contract

`src-tauri/crates/notesage-capture/tests/pipeline_contract.rs` exists because
of a specific failure. X capture shipped in v0.52.0 and TestFlight build 11 —
`build_x_note`, `x_syndication_url` and `XPost` written, unit-tested, and
**never exported over the FFI**, so nothing in the app could reach them. X
articles still saved (generic readability works on X's server-rendered status
pages), so the feature looked present while its whole metadata path was
structurally absent. Every test passed throughout.

A capture crosses four languages, and unit tests only ever covered the first:

```
builder (Rust) → FFI (C ABI) → bridging header (C) → Swift → saved file
  → sweep finds its images → inliner rewrites them
  → article_lead_image locates one → gallery card shows it
```

Four contracts, each catching a different link:

| Contract | Catches |
| --- | --- |
| `every_note_builder_is_reachable_or_documented` | A builder no FFI export reaches — dead code wearing a test suite. `None` is allowed but demands a written reason. |
| `every_ffi_export_is_called_from_swift_and_declared_in_the_header` | An export missing from `NotesageCapture.h` (Swift cannot see it), or declared but never called. An uncalled export is the same defect one stage later. |
| `the_share_controller_routes_x_urls_through_the_x_writer` | A perfect writer that `ShareViewController` never invokes — a one-line omission with no symptom but the bug. |
| `*_survives_to_the_thumbnail` (markdown / HTML / X) | An image that exists in the file but that the sweep cannot find or `article_lead_image` cannot locate — the card falls back to a picture of the text. |

Two design notes. The Swift checks are **text scans, not builds**: the Share
Extension only compiles on a Mac with an iOS toolchain, and a contract that
cannot run in CI is a contract that runs never. And they match on **word
boundaries**, because every export name here is a prefix of another —
`notesage_capture_rel_path` is a prefix of `notesage_capture_rel_path_from_html`,
so a plain substring check reports the first as present on the strength of the
second, passing for exactly the wrong reason.

The same principle applies one layer down: CI's "verify exported symbols" step
derives its list from `NotesageCapture.h` rather than hardcoding names. It had
hardcoded three, and passed for months while the X exports did not exist —
because none of the three were the missing ones.

**Adding a share source means adding a row.** Forgetting one fails the build
naming the stage that broke, instead of shipping a feature that quietly does
nothing.

## Launch: no white flash (#675)

WKWebView paints **white** for its own first frames regardless of what the
layers beneath it are set to. Round 1 of the fix themed every native layer
(webview, scroll view, superview chain, all windows) *and* the document's
pre-paint CSS — and the flash survived on device, because none of that
changes what the webview itself paints first.

The fix is the iOS translation of the desktop trick of starting the window
hidden and showing it when the frontend signals ready (the window can't be
hidden on iOS, so we cover it instead):

1. `LaunchScreen.storyboard` shows the app icon (120 pt, 27 pt corner radius)
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
