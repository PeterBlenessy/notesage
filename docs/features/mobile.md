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

- **Read the library on iPhone/iPad.** Open to Home — the Inbox and the
  folders chosen for it, everything else under All Folders — and browse
  projects/folders/notes from the iCloud-synced Notesage folder, reading
  them rendered: markdown (via the
  **same Rust comrak pipeline as the desktop** — `render_markdown_fragment`,
  so a note looks identical on both, callouts and all), plain text/code,
  images, and **PDFs** (the desktop `PdfViewer` — pdf.js canvas with
  zoom/fit/search — lazy-loaded and fed the iOS bytes via the shared binary
  cache). Binary reads cross IPC as **base64** — a `Vec<u8>` serializes as a
  JSON number array (~4 bytes of JSON per payload byte) and froze the UI for
  ~10 s on a 113-page PDF; base64 with native `Uint8Array.fromBase64` decoding
  brings a 10 MB PDF to ~0.5 s. EPUB/DOCX/PPTX show an "open on your Mac"
  state in v1.
- **Listen to a saved article** (#833). "Lyssna"/"Listen" in the reader's
  overflow menu reads the article aloud with `AVSpeechSynthesizer`, with a
  transport (back / play-pause / forward / speed / stop) and a paragraph
  position. Playback survives backgrounding and the lock screen, and appears on
  the lock screen and in Control Centre. See "Reading aloud" below.
- **Open exported HTML reports, with their scripts running.** On device
  `.html`/`.htm` files render in a **second, bridge-less `WKWebView`**
  (#606, ADR 0010): its own content process, an empty
  `WKUserContentController`, no Tauri plugin bridge, and `loadHTMLString` with
  `baseURL: nil`. A separate web view has no inherited CSP, so the report's own
  styles and scripts simply work — which is why none of the custom-scheme
  plumbing below is needed there. Link taps are intercepted natively in
  `decidePolicyFor` rather than by an injected agent, and find-in-page is
  WebKit's own `UIFindInteraction` (the system find bar), reached from a
  magnifier button rather than the search island.

  **The iframe path below is the fallback and a real code path** — desktop dev,
  the vitest suite, and any build without the native plugin take it, because
  `ios_present_report` rejects there. It renders in a sandboxed iframe served
  from the **`htmlpreview://` custom scheme** — the same mechanism as the desktop HtmlViewer, for the same
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
  `dom-search` marker, PDFs via the viewer's text-layer search, and HTML reports
  via WebKit's native `UIFindInteraction` on device (#606). On the iframe
  fallback path only, search still runs inside the report via an **injected
  find agent** (`html-find-agent.ts`) driven over postMessage — the app cannot
  reach a cross-origin frame's DOM. That agent is retired by the native path
  and will be deleted once it is confirmed on a device; it is deliberately
  still present so the fallback does not lose search before its replacement is
  proven. (PDF search on WebKit also needed
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

  Reading progress and listen positions for Inbox items are shared with the
  Mac through `Inbox/.notesage/reading-progress.json` — the phone's local
  store is a write-through cache of it (`src/lib/inbox-progress-sync.ts`;
  format and merge rules in docs/features/inbox.md).

  In the list view every file row carries a thumbnail slot on the left:
  images, PDFs, documents, media and plain HTML files show the same picture
  the gallery draws (`getThumbnail`, QuickLook first); a file with no
  picture (a note, an unknown format) gets the same painted tile with its
  small icon centred, so the column reads as one run of thumbnails. Folders
  keep the plain icon row. The tile is 72pt at rest and 40pt condensed — the
  same two sizes as the article row, so a screenshot and the saved article
  above it are one shape — and fixed, so a late thumbnail never reflows rows.

  Documents (PDF/EPUB/file shares) skip the picker and store immediately in
  `Inbox/` with their original names, streamed via `loadFileRepresentation`.
  Extraction quality: #610.

  The iOS activation rule is a **predicate**, not the dictionary shorthand
  (`src-tauri/ios/ShareExtension-Info.plist`). The shorthand's `File` key
  matches only attachments backed by a file URL (Files, QuickLook); Safari's
  PDF viewer hands the document over as in-memory `com.adobe.pdf` data beside
  the page URL, and with the shorthand iOS never listed Notesage for it
  (#843). The predicate accepts any attachment conforming to a type the
  extension handles — Safari's preprocessing payload, URLs, text, PDF, EPUB,
  image, movie, audio — and deliberately not bare `public.data`. Measured
  with a simulator host app presenting every item shape and read off
  `sharingd`'s log (`activityType:com.notesage.app.ShareExtension`), which is
  the only place the sheet's verdict is visible. Any change to the rule must be
  verified in the built `.appex/Info.plist`: Xcode drops unrecognised
  shorthand keys silently.
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
- **The library is the app's own iCloud container** (PRD
  `2026-09-05-icloud-container-library`). `iCloud.com.notesage.app`'s
  `Documents/` folder IS the Notesage library, so a fresh install finds it
  with nothing to grant and no picker at all, and the Share Extension resolves
  the same container itself rather than borrowing a bookmark. The mode
  (`container` | `picked`) is shared with the extension through the App Group;
  switching to the container keeps any bookmark, so switching back stays
  possible, and a marker file makes a library recognisable as one wherever it
  sits. `url(forUbiquityContainerIdentifier:)` blocks for seconds on the first
  call per process, so it runs off the main thread and is cached; `nil` means
  iCloud is unavailable to this app and the picker below is the fallback.
  **Both targets must be entitled** — an unentitled process gets `nil` and
  silently falls back, which is why `scripts/ios-testflight.sh` reads the
  container back out of the signed app AND extension before it will upload.
- **Why a folder picker?** Still the fallback, and the whole story before the
  container. The library lives at a fixed location
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
4. **One drag, one finger.** Every drag records the `pointerId` that started
   it; moves and lifts from any other pointer are ignored, as is a second
   touchdown while a drag is in flight. Without that guard a drag reads
   `clientX` off whatever pointer arrives, so a thumb landing anywhere else
   to steady the phone feeds ITS coordinates into the gesture already
   running: measured from the first finger's start that is a throw of a few
   hundred pixels, which is a commit. The row fires its edge Delete, the
   reader closes the document, and letting go of either finger seals it.

   The guard applies only while the first drag is a REAL swipe. Refusing
   every second touchdown outright trades a corrupted gesture for a stranded
   one: WebKit does not reliably deliver `pointercancel` when the system
   steals a captured touch, and a drag whose terminator never arrives would
   then block the surface for ever. A drag that never locked has taken no
   capture and moved nothing on screen, so it is simply replaced; a locked
   one is ended by an abandonment watchdog: a live drag that goes four
   seconds with no move and no lift springs back without committing. That
   timer is the recovery, because it depends on NO event arriving —
   `lostpointercapture` is the obvious candidate and is handled too, but the
   spec fires it as a consequence of the very pointerup or pointercancel
   that goes missing, so it cannot be the answer on its own. Four seconds is
   far longer than any swipe; the penalty if it ever cuts one off is that
   the surface returns to where it was and the gesture can be made again.
   Two details make it safe. It acts only on a LOCKED drag — a press that
   never became one strands nothing and blocks no later touch, and dropping
   it would cost an open row its tap-to-close. And in a list row the finger
   may still be physically down, which is the whole premise, so a native
   click follows if it ever lifts — and it must not open the document the
   user was swiping away from. That suppression is armed AT THE LIFT, not
   when the watchdog fires: arming it early would leave it armed for ever in
   the case the watchdog exists for, where the touch really was stolen and
   no lift and no click ever arrive, and it would then swallow the user's
   next unrelated tap on that row. Two details follow from that. Only a
   `pointerup` arms it — `pointercancel` is never followed by a click, by
   spec, and `lostpointercapture` is not a termination at all, yet both are
   the likely shape of a genuinely stolen touch, so arming on either would
   set the same flag nothing consumes. And the abandoned pointers are a SET:
   abandoning one drag is exactly what stops the touchdown guard refusing a
   second finger, so a row can abandon two, and a single slot lost the first
   one's lift. The same rule governs a drag that is still live when the news
   arrives: only a lift FINISHES a gesture. A cancel is an interruption by
   definition, and capture loss reaches a live drag only when it comes
   without the lift that normally precedes it, which is the same thing —
   so neither commits the edge Delete nobody completed, and neither arms a
   suppression no click will consume.

## Swipe in from the left edge to leave a document

The gesture iOS gives every navigation stack, which a web view has to supply
for itself (`useEdgeSwipeBack`; Peter, 2026-09-05: *"I want right swipe in a
document to close it and go back to inbox"*). It starts ONLY within 24 pt of
the leading edge, which is what keeps it out of the way of everything else
the reader does horizontally — a wide table scrolling inside itself, text
selection, the speech highlight. Rightward only: a leftward drag from the
edge is someone reaching for something else and must never close their
document. It commits on 96 pt of travel OR on a fast flick, timed from the
AXIS LOCK rather than from touchdown, so a finger that rests on the edge
while reading and then throws is not counted as slow.

**Only a lift finishes it.** A cancel is an interruption by definition, and
capture loss arrives without the lift that normally precedes it, which is the
same thing — and this strip is precisely where the OS's own interactive-pop
gesture lives, so having the touch taken away mid-swipe is the expected case
here rather than a corner one. Committing on either would close the document
on a gesture nobody finished. Same rule as a list row's edge action.

**A captured report needs its own strip.** An HTML document renders in a
sandboxed iframe on an opaque origin, and a finger that lands on it produces
no pointer events out in the app — the handlers on the reader root never
fire, on exactly the documents people read longest. A transparent 24 pt strip
over the frame's leading edge carries the same handlers, below the islands
(z-40) and above the frame. It captures the pointer on POINTERDOWN, not at
the axis lock: once the finger moves right it is over the frame, and a move
the strip does not receive is a gesture that dies halfway with the page left
mid-slide.

**Every list row swipes, whatever it looks like.** The action set is built
once, by `entrySwipeActions` in `FileRow.tsx`, and used by both list rows —
the plain one and the article one. It did not used to be: `ArticleRow` was
its own markup and simply never wrapped itself in `SwipeRevealRow`, so a
saved article had no swipe. Because the article row is also the only row with
a Listen button, the two looked causally linked — the rows that swiped were
exactly the rows without headphones, which is how a missing wrapper reads as
a rule (Peter, 2026-09-05). Folders still get an empty action array (there is
no folder share), which the gesture treats as "no swipe".

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
- **A pinned Recordings card** directly beneath it, same style, above the
  ordinary folders, ALWAYS visible — unlike the Inbox card it does not wait
  for the folder to exist, because the question it answers is "where do my
  recordings go?" and the folder is created by tapping it (Peter, 2026-09-05:
  *"Recordings must be a folder like Inbox! Displayed below it with same
  style, above other folders, always visible"*). Two rules make "always"
  true rather than aspirational. It renders in EVERY branch of the root
  listing — grouped, gallery, empty Home, empty library — because the folder
  is filtered out of the plain listing in all of them, so a card missing from
  one branch means Recordings vanishes from that view entirely (which is what
  shipped first: switching Home to gallery lost it). And the tap uses
  `ensureDirectory`, never `createDirectory`: the latter DEDUPES on
  collision, so a root already holding a file called `Recordings` would get a
  folder called `Recordings-1` while the card navigated to `Recordings` —
  opening a file as a folder, with the real folder unreachable from the card
  for ever. `ensureDirectory` is idempotent, so a double tap is also a no-op
  rather than a race between two render closures.
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

## The read-later list row (#836)

Peter, on Instapaper's list: *"I also like this type of list view. Could have a
more condensed option too."* A saved article's list row is now that shape —
title (two lines), `site · 2 of 4 min left`, a two-line excerpt, a square
thumbnail on the right, a hairline separator. The progress line is what makes
it a read-later list rather than a file list.

Everything but progress is read back out of the capture's own header by
`article_card_meta` (capture crate; iOS-only command like
`article_source_url`): `<title>`, `<p class="standfirst">`, and the
` · `-joined `<p class="byline">` — "By X · N min read · site". The read is
**native** (`ios_article_card_meta`): only the four strings cross the bridge,
not the 200–800 KB capture they sit in — the header is in the first ~2 KB, and
reading whole files for a 39-row Inbox moved ~15 MB of UTF-8 for nothing
(review finding). A session cache keyed by path *and* mtime
(`article-meta-cache.ts`) makes a repeat visit render instantly and still
misses when a file is rewritten in place. While the header is on its way the
row keeps the article shape with just the name, so the list does not jump from
one-line rows to tall ones as reads land. A document
that is not a capture — or one saved before #828, which has no header — makes
`ArticleRow` render the plain `FileRow`, so the list never has a hole; on the
simulator a pre-#828 X capture shows title + thumbnail only, a post-#828 one
shows the full row.

**Reading progress** is the genuinely new piece. Recorded as a 0…1 fraction
per document in `mobile-store.readingProgress` (persisted, rename-aware,
capped at 500) from two sources: the markdown/text reader's own scroller
(`onScroll`), and — for a natively presented report, whose scroll view nothing
in the WebView can see — a `scroll` message on the existing `notesage:report`
bridge, emitted by `ReportWebView.observeScroll` off a KVO on the scroll
view's `contentOffset`, coalesced to one message per ~300 ms. The store only
ever moves progress FORWARD: scrolling back up to re-read a line must not
un-read the article. `≥ 0.97` shows as "Read".

**Condensed** — "Kompakt" in the view menu, a checkmark toggle — drops the
excerpt and shrinks every thumbnail to one line per row, for a library that
has grown past browsing into scanning. The same toggle packs the gallery four
cards across instead of three, with a one-line caption. The entry is left out
of a list of folders alone, where it would change nothing: an option that
does nothing reads as a bug.

**Views are remembered per folder**, the way Finder and Files do it. Layout,
density, order and grouping are one `FolderView` per folder in
`mobile-store.folderViews`, keyed by root-relative path (`""` = root),
persisted and bounded to 200 folders (least recently set forgotten first); a
rename carries a folder's view and its subfolders' with it (`rewritePath`,
which now follows everything under a renamed folder — recents, progress,
offsets, pins — not only the folder itself, with the renamed entry winning
over any stale entry already at the new name; the Reader's title-becomes-
filename rename and its Move to folder go through the same path), and a
delete forgets them
(`forgetPath`: views, offsets, progress, listening positions, reset stamps,
recents, pins — for the path and everything under it) so a later entry of the
same name starts fresh. Every view setter
(`setViewMode`, `setListDensity`, `setSortMode`, `setGroupMode`) writes the
folder being viewed. `resolveFolderView(state, relPath)` fills in what a
folder has not chosen from the app-wide `viewMode` / `listDensity` /
`sortMode` / `groupMode` — the values an upgraded install carries over, so
the Inbox keeps looking as it did — except that the root is a list unless
made a gallery on purpose: a root of folders rendered as a wall of identical
cards was the complaint that made views per-folder.

**Unread reads as weight, not as a badge.** An Inbox item whose title sits
at 600 has not been opened; one at 400 has. A dot beside every thumbnail was
tried first and was clutter (Peter, 2026-09-05) — emphasis is scannable
without being decorative, which is the Mail convention minus the ornament.
Plain rows carry it too, so a PDF and a saved page in the same Inbox behave
alike, and only inside the Inbox, where a read-later contract exists.
Progress cannot supply the rule: an article opened and closed at the first
paragraph has a fraction of 0, exactly like one never touched. So it follows
the sidecar's `openedAt` — the badge's rule, and the Mac's —
mirrored into `mobile-store.inboxOpened` by `inbox-progress-sync` from a
local open and from what the Mac recorded, and cleared again by a Mac "mark
as unread". That mirror is written from a store subscriber, so it is
deferred by a microtask; writing synchronously re-entered the subscriber
before its `prev` had advanced and ran the stack away.

**A recording is on the lock screen and in Control Center.** It outlives the
app being on screen — that is the point of it — so `Recorder` publishes a
now-playing entry with a running elapsed time and `isLiveStream`, which is
the honest shape for something with an elapsed time and no duration. Play
and Pause are wired; **Stop deliberately is not**, because stopping
finalises the bundle into the library and the discard question for a
slip-of-the-finger recording cannot be asked from a locked screen. A
recording you mean to end is one unlock away; one ended from a pocket is not
recoverable. `SpeechPlayer` hands its transport back when it stops: targets
accumulate on the shared command centre, so leaving them registered meant a
Play tap during a recording reached the speech player too. The lock screen's
words come from the frontend, like the recording island's — this app's
translations live there.

**Listen from the list** — playback belongs to the app, not to the open
document. `src/lib/speech-controller.ts` owns it: one session in
`mobile-store.speech` (`relPath`, playing, paragraph index/total, rate,
language), fed by the native events subscribed once at the app root
(`startSpeechEvents` in `MobileApp`). Every saved page's row carries a
`ListenButton` FLOATING over its right edge — glass over a backdrop blur,
reserving no width, so the title and excerpt keep the whole row and simply
pass behind it. It was a 72pt column, which is a third of the text's width on
a 393pt screen: titles that had fitted on one line wrapped onto two and rows
ran 107-136pt against a 72pt thumbnail (Peter, device, build 50). Floating
took them to 96-116pt and left the reach where it was, on the right, which is
where a right hand holds the phone. What remains above the thumbnail's height
is the excerpt and the source line, not the control and every saved page's card one on its
picture — *saved page* meaning a Notesage **capture**, and nothing else: the
row is `ArticleRow`, which the browser picks for any `.html`/`.htm` entry,
and which keeps the article shape only while `ios_article_card_meta` returns
a header. That header is read out of the file's own capture footer
(`article_source_url`: `Clipped from <a href="http…">`), so a `.html` we did
not clip — an exported report, a page saved from elsewhere — has no header,
falls back to `FileRow`, and gets no headphone. Nothing else can be read
aloud today: a PDF, a note or an image has no prose extraction on the phone.
The control itself: headphones to start (the file is read and turned into prose there
and then — nothing opens), then Pause / Play for the document playing, with a
ring around the edge that fills as the paragraphs go by. No skip, speed or
stop in the list; those stay in the Reader's transport, which is the same
session seen from the article: open it mid-playback and the transport is
already running, go back and the ring is mid-way. The hold menu's "Listen"
row does the same as the button. `useSpeechPlayer(relPath)` is now a view
onto the session for one document and no longer stops anything on unmount.

**The highlight while listening** — the paragraph being read is marked in
the article, and the word too when the voice reports word boundaries
(premium and Siri voices do; some compact voices report nothing, and then the
paragraph mark stands alone). The marks live INSIDE the page: natively the
report is a bridge-less WKWebView and in the fallback a sandboxed iframe, so
`html-speech-agent.ts` rides inside the document — appended to it like the
find agent — and only listens. The Reader sends it the utterances once
(`splitSpeechParagraphs(documentToSpeechText(raw))`, the native player's own
split mirrored, so index `i` is utterance `i`) and then positions: the
paragraph from the session, the word from `onSpeechRange` (word events stay
out of the store — several a second). Natively the message goes through
`ios_post_to_report` → `ReportPresenter.post`, the one thing ever evaluated in
the report's context and a pure data drop; in the fallback it is a
`postMessage`. The agent locates each utterance by a whitespace-normalised
search through the page's text nodes in order (the utterances come from the
raw HTML by regex, the page's text differs only in whitespace), draws with the
CSS Custom Highlight API where it exists and wraps `<mark>`s otherwise, and
scrolls a paragraph into view when it changes. Native side:
`SpeechPlayer.onRange` from `willSpeakRangeOfSpeechString`, forwarded as the
`range` speech event. Markdown and plain-text notes get the same marks in
the app's own DOM (#891): the core lives in `speech-highlight-core.ts` as one
self-contained function — the page agent is that function serialised with
`toString()`, the Reader calls it directly on the article element with the
Highlight API only (React owns that DOM, so no `<mark>` wrapping) and its
own scroller for keeping the paragraph in view.

**Switching articles** — `SpeechPlayer.resetQueue` un-pauses before it
stops: `stopSpeaking` is a no-op on a paused synthesiser, so starting B
while A sat paused left A's utterance queued with B's behind it, and the next
Play continued A (heard as "B read in A's language"). The synthesiser's
`didPause`/`didContinue` are honoured only for the current paragraph, so the
continue that un-pausing reports for the old article cannot flip the new
one to Playing.

**The lock screen's plate** — `SpeechPlayer.updateNowPlaying` publishes
`MPNowPlayingInfoCenter.playbackState` as well as the rate: the rate alone
left iOS showing Pause for a paused article (the session stays active while
paused, which is what keeps the plate up). The player also follows the audio
session's interruptions (a call, Siri: began → pause, ended with
should-resume → resume) and the synthesiser's own `didPause`/`didContinue`,
so the app, the row's ring and the plate agree with what is audible.

**Wide content never widens the page** — a table with several numeric
columns has a minimum width past a phone screen, and iOS WebKit answers an
overflowing body by widening the page's layout box to fit it: paragraphs
then wrap past the right edge, the body centres itself in the wider box, and
the whole article drags sideways (Peter, 2026-09-04, a Swedish finance
article; markdown notes with tables did the same in the app's own reader).
Three places carry the same rule — tables `display:block; overflow-x:auto;
max-width:100%`, media `max-width:100%`: the capture stylesheet
(`ARTICLE_HTML_STYLE`, for new captures), `withWideContentGuard` appended at
view time on both the native report and the iframe (for captures saved
before), and `.mobile-article` in `globals.css` for markdown, whose scroller
is `overflow-x-hidden`.

**A Mac "mark as unread" reaches the phone (#876)** — the pull applies a
sidecar entry's `resetAt` once: `mobile-store.applyReadingReset` drops the
item's local fraction and listen position (the one write allowed backwards
past the forward-only guard) and records the stamp in the persisted
`readingResets` ledger, so a relaunch does not re-apply it over progress
made since. A read made on the phone after the reset but before the next
pull is dirty with a newer change time and stays; the stamp is recorded
without wiping.

**Folders in the list and the gallery** — a folder wears the icon and colour
it was given on the Mac (#140, `.notesage/project.json` → `appearance`),
read once per folder version by `folder-appearance-cache.ts` and resolved
with the desktop's own `resolveFolderIcon`, so "Star, teal" is the same on
both. In the gallery a folder's name is centred under its icon; at rest the
caption adds its item count and last change, condensed keeps the name
alone. iCloud sync state is not shown — the listing does not carry it.

## Home: only the folders you chose

The root screen is **Home**, not the raw root listing: the Inbox card, the
folders chosen for it, and the root's own files (a Quick Note the Mac made
has no folder to hide behind). Everything else waits one tap away under
**All Folders**, the last row, which pushes the full root listing as a level
of its own — Back returns to Home, Inbox is an ordinary row there, and the
"+" still creates a folder (the root rule: `atRoot` is about the *listing*,
`currentRelPath === ""`, not the top of the stack). A search at Home looks
through the whole root, so a hidden folder is one query away.

Peter: *"Maybe I don't want to displayable folders in Notesage, just the ones
that I have selected to display, maybe just the inbox."*

**Choosing.** Hold a root-level folder → *Show on Home* / *Hide from Home*
(`entryMenuItems`, offered only when the browser wires `isOnHome` and
`setOnHome`, and only for `isHomeCandidate` entries: directories with no
`/` in their path). The whole set is one screen: **… → Edit Home…** at Home
(`HomeFolders`, a switch per root folder with the Mac's icon and colour,
Inbox first; a toggle writes at once, a failed write reverts and toasts).
An empty Home offers *Choose folders…*; a not-yet-curated library shows a
one-line hint under the list until it is dismissed or a folder is put on
Home (`homeHintDismissed`, persisted — it is about this screen having
changed).

**The file.** `.notesage/home.json` beside `pins.json`:
`{ "version": 1, "folders": ["Inbox", "Reading"] }`, root-relative paths.
Missing = the defaults (the Inbox alone, when there is one). Present = the
whole truth, including "the Inbox is not listed, so the card is hidden".
It is a property of the library, so an iPad opens to the same Home;
`loadHomeFolders` re-reads it with every root listing (mount, pull, foreground
return) and never writes on a read. `setOnHome` is a read-modify-write
against the file (`togglePin`'s discipline), and the only place stale
entries are compacted — a folder renamed on the Mac simply drops out of
Home on the next listing (Home is the set ∩ the live root listing) and out of
the file on the next toggle; a rename on the phone rewrites the entry through
`rewritePath`, and deleting a Home folder takes it off Home. It is neither
the Mac's project list (nearly every iCloud folder, for a Mac user) nor
`pins.json` (which would rearrange the Mac sidebar from a phone preference);
the Mac does not read it yet.

**Screen key.** Home and All Folders both list `""`, so scroll offsets and
the remembered view are keyed by `HOME_KEY` (`"/home"`, which no relative
path can be) at Home and by the folder path elsewhere.

## Notifications: the badge and the background refresh

The phone has no server behind it, so it can only announce what it observes
for itself. Two things ship, both honest about their limits:

- **The app icon badge is the unread Inbox count**, read from disk by one
  Swift helper (`InboxState.swift`, compiled into the app and the Share
  Extension). Its sidecar read is **coordinated**, with a download requested
  when only an iCloud placeholder is present: an uncoordinated read of an
  evicted file simply fails, which that helper cannot tell apart from
  "nothing has ever been read", so every item counted unread and the badge
  froze at the Inbox's file count for ever — reading wrote a sidecar the
  counter could not open (device, build 50). The download is gated on the
  item's **downloading status**, not on whether the path exists: since iOS 11
  an evicted item keeps its real name in the directory listing and hides the
  `.name.icloud` placeholder, so `fileExists` answers true for a file with
  nothing behind it and the download is never asked for — the same frozen
  badge, one condition upstream of the fix. `.current` is the only status
  that means the bytes are here (`.downloaded` means they are stale), and a
  file that is not ubiquitous reports no status at all, where existence is
  again the only question worth asking. It uses the same rule as
  `isUnread` in
  `src/lib/reading-progress-file.ts` — no entry, a tombstone, or
  `openedAt: null` — locked together by `inbox-unread-rule.test.ts`. It is
  refreshed wherever the truth can change: every root or Inbox listing
  (`ios_inbox_unread_count`; the Inbox listing alone also marks its items
  as *seen* and clears the delivered banner — Home shows a number, not the
  items, and a return to the foreground says nothing about what is on
  screen), every return to the foreground, every
  push of the reading-progress sidecar, and the Share Extension's own
  capture (`InboxState.didWriteCapture`, called by every writer in
  `LibraryCapture.swift` — a contract test in `pipeline_contract.rs` fails
  when a writer forgets). The `InboxCard` shows the same number in the
  accent when it is above zero.
- **"N new in Inbox", best effort.** A `BGAppRefreshTask`
  (`BackgroundRefresh.swift`, identifier `com.notesage.app.inbox-refresh`,
  registered in the plugin's `load` and scheduled on every background) lists
  the Inbox, refreshes the badge and posts **one** banner for everything the
  user has not seen — replacing the delivered one, never stacking, never
  repeating an unchanged set. iOS runs it on its own schedule: minutes to
  hours later, never in Low Power Mode, never with Background App Refresh
  off, never after a force-quit. The simulator never runs it; on a device it
  is forced from the debugger with
  `e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.notesage.app.inbox-refresh"]`,
  and every branch logs under `subsystem com.notesage.app`, categories
  `refresh` and `notify`.

**Tauri's notification plugin is not registered on iOS** (`lib.rs`, locked by
a source-shape test): its delegate force-unwraps a map of the notifications
it scheduled itself, so anything posted natively would crash the app in it.
`Notifier.swift` is the app's one `UNUserNotificationCenterDelegate`; a tap
lands on the Inbox — warm through the `notesage:notification` event, cold
through `ios_consume_launch_route` once the grant is in
(`useNotificationRoute`).

**Permission is asked when it means something.** Never on first launch: a
card on the Inbox listing (`NotificationPrePrompt`) appears once the Inbox
holds an item while iOS has not been asked; *Turn on* spends the one system
prompt (badge + alert, no sound), *Not now* is permanent. The root "…" menu
carries *Badge unread count* and *Notify about new items*; a denial replaces
them with a row that opens the Settings app, and Background App Refresh
being off adds one more. Preferences, the seen set and the localised banner
strings (handed over by the frontend, which owns the translation table)
live in the App Group defaults under `notesage.notify.*`, shared by the app,
the task and the extension. The seen set is written by two processes (the
app's recount replaces it; the extension appends its own capture) without a
lock: a capture landing in the same instant as a recount can lose its
"seen" mark and be announced once by the next refresh — accepted, since
the next recount corrects it.

## Recordings: capture on the phone, transcribe on the Mac

A meeting or a voice note is recorded on the phone and transcribed by the
Mac, which already has the model, the GPU and the job runner
(`docs/prds/2026-09-05-ios-recordings.md`). *New Recording* is one hold
of the "+" away everywhere, and inside `Recordings/` the "+" records.

**Capture is native** (`Recorder.swift`): `AVAudioRecorder`, AAC-LC mono
48 kHz 64 kbps — an hour is ~30 MB, which is what makes syncing it through
iCloud affordable — into the app's own container while it runs; a file
growing for two hours inside iCloud Drive would be re-uploaded repeatedly
and be a half-file to the Mac. The audio session is `.playAndRecord` with
the `audio` background mode, so a locked screen does not stop it; a phone
call pauses it, and it resumes only when iOS says it should (otherwise the
island says *Paused — call ended · Resume*); an AirPod taken out keeps
recording on the built-in mic. `AudioSessionArbiter` gives the session one
owner: starting a recording stops read-aloud, and Listen is refused (and
its buttons disabled) while a recording runs. Two rules make that hold
rather than merely look true. The hand-over from speech happens on the
**main thread**, before the recorder's worker queue starts, because stopping
speech is main-thread work and `prepare()` deliberately is not; the arbiter
itself only arbitrates, behind a lock, and never names `SpeechPlayer`. And
the refusal is the **gate**, not the pre-check: `speechStart` looks at the
recorder before it runs language detection, which is asynchronous and long
enough for a recording to begin inside it, so the thing that actually stops
playback is `activateSession()` returning false, which `start()` and
`resume()` honour and the plugin reports as `recording-in-progress`. Both
were regressions found in review (2026-09-05) and are locked by source-shape
tests in `ios_library.rs`. On stop,
`LibraryAccess.finalizeRecording` (`RecordingLibrary.swift`, the app target
only — the Share Extension compiles `LibraryAccess.swift` too) copies the
audio under coordination into `Recordings/Recording <stamp>/audio.m4a`
(the Mac's stamp format, deduped) and writes `recording.json` — device,
start, duration, bytes, codec, language, `transcription: null` — then
removes the staging folder. Under five seconds is a slip of the finger and
asks to discard — the question lives in `stopRecording` itself, not at the
call site, because when it lived at the call site only one of the two
surfaces asked it and stopping from the Reader silently saved every stray
recording. A force-quit leaves a staging folder; the next launch
offers to keep (finalise) or discard it (`RecoverRecordingSheet`), never
deciding alone.

**The island** (`bottomRecorder` in the chrome spec, `GlassRecorder` in
`ChromeOverlay.swift`, `RecordingBar` as the web fallback): red dot,
elapsed, a faint level bar (a muted mic reads as a flat line),
pause/resume, stop — shown in the browser and the Reader alike while a
recording runs, in the read-aloud transport's slot. Nothing of ours on the
lock screen: iOS's red microphone indicator is the affordance. The
frontend mirror is `mobile-store.recording`, fed by `notesage:recording`
events (`recording-controller.ts`); everything that must keep going with
the screen locked is native, since the WebView's timers are suspended.

**The Mac's part** — noticing a bundle whose manifest has no transcript,
waiting for the audio's size to match the manifest, queueing the existing
transcription job and writing the status back — is `useRecordingsInbox`
on the desktop (`docs/features/ai-workflows.md` § Meeting Recording). The
phone shows the transcript when it exists; playback on the phone is the
next phase.

## Office web-viewer URLs are documents (#868)

`view.officeapps.live.com/op/view.aspx?src=<url>` (and `embed.aspx`) is not a
page; it is a JavaScript viewer that fetches the file named in `src` and renders
it client-side. Both capture paths saw only its loading shell — *"Vi hämtar din
fil…"* plus a spinner was saved as an article, with the spinner as its
thumbnail. The page names the real document in its own URL, so
`viewer_document_url` (capture crate, exported as
`notesage_capture_viewer_document_url`) unwraps `src`, and the extension routes
a viewer share through the existing linked-document probe (`fetch` →
`saveLinkedDocument`) — deliberately skipping Safari's rendered-DOM payload,
which for a viewer *is* the shell. The sheet presents it as a document (name +
real URL, no format picker) and the file keeps its own name. Only `http(s)`
targets are unwrapped; a `javascript:` or `file:` `src` is refused. If the
document cannot be fetched the share falls back to a link note to the viewer,
which is honest where the spinner article was not. Verified on the simulator:
the shared viewer URL landed as `FY27ExternalKPIs.pptx`, 4,016,522 bytes — the
server's exact Content-Length. macOS has no URL-to-document probe yet, so the
contract row marks the export iOS-first.

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

**Permissions.** Beyond the one-time folder grant, the only runtime prompt
is notifications — and it is reached only from the UI in front of the
reviewer: a card on the Inbox listing once the Inbox holds an item, or the
*Badge unread count* / *Notify about new items* rows in the root "…" menu.
The demo path above (grant a local folder, browse, read) never shows it.
The microphone is declared (`NSMicrophoneUsageDescription`, written into
the app target by `integrate-share-extension.py`) and asked for only when
the reviewer starts a recording themselves (*New Recording* under the "+");
recording never starts on its own and the audio never leaves the device
except through the user's own iCloud Drive. No camera, photo library,
contacts or location keys are declared.

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

## Reading aloud (#833)

Listening is how a read-later library gets used away from the screen — walking,
cooking, on a commute. Four decisions carry the feature:

**Paragraph utterances, not one blob.** `SpeechPlayer` splits the text on blank
lines and speaks one paragraph at a time. That is what makes skip-by-paragraph
possible, but the stronger reason is resume: a paragraph index survives the app
being killed, where a character offset into a single long utterance survives
nothing. The position is persisted per document in `mobile-store.speechPositions`
(path-keyed, rename-aware, like `scrollOffsets`) and clamped natively, so a
stored position from a since-edited article cannot crash or silently restart.

**`didFinish` advances; `didCancel` does not.** `skip()` and `setRate()` both
call `stopSpeaking`, which fires *cancel*. Advancing on cancel too would
double-step past a paragraph — a bug that presents as "it randomly skips
ahead".

**`.playback` + `.spokenAudio` + `UIBackgroundModes: audio`.** All three, and
the third is not optional: with the category alone iOS gives a backgrounded app
the ordinary ~30 s grace period and then SUSPENDS it, so playback dies shortly
after the screen locks — the feature silently broken in exactly the case it
exists for. The background mode is declared from
`integrate-share-extension.py` (the app plist is generated), and verified
present in the built `.app`. The mode makes speech duck politely against
navigation prompts rather than fight them.

**Position and liveness are separate events.** `progress` carries the
paragraph; `playing` and `finished` carry whether audio is running. Collapsing
them left the transport showing Pause forever after an article ended, and
`playing` is the only way a lock-screen or Control Centre pause reaches the
frontend at all — those bypass it entirely.

**The player owns the bottom-centre slot exclusively.** The search island and
the report's find button live there too, so both are suppressed while playback
runs; find is one tap away again the moment it stops.

**The transport is drawn by the NATIVE chrome, not React.** A captured article
is presented in a separate native web view that sits ABOVE the app's own
(#606/ADR 0010), so a React-rendered island portals to `document.body` and ends
up behind it — invisible for exactly the document kind people most want to
listen to. `ChromeSpec.bottomCenter` renders the bar in the overlay that
already draws above that view (the same one the back and find buttons use). The
React `SpeechPlayerBar` remains as the fallback for builds with no native
chrome (desktop dev, the vitest suite).

**Language is decided by a PER-PARAGRAPH majority vote, not by the whole
document.** Feeding the whole text to `NLLanguageRecognizer` is what the
obvious implementation does, and measured against Peter's real library it got
**10 of 36 articles wrong** — all English, all read as Danish or Norwegian. One
short foreign line was enough: an X capture whose title is localised ("Thariq
(@trq212) **på** X") came back Danish at 0.68 across 13,917 characters of plain
English prose. Neither more text nor `languageConstraints` helped — both made
the WRONG answers *more* confident (0.68 → 0.75), so no threshold or margin
could separate them. Voting can: those same documents split en=64/pl=1 and
en=12/pl=1. Only paragraphs of 80+ characters vote, since headings, list items
and handles are exactly the noise that misleads the recogniser. After the
change the library resolves 30 en / 6 sv with nothing wrong, and every
genuinely Swedish document still detects as Swedish.

**Voice choice, in order: in-app pick → the system's configured voice → best
installed.** Peter's objection to a picker was right — if he has selected an
English voice in Settings › Spoken Content, the app must not make him select
again. So after any explicit in-app pick, `systemDefaultVoice` asks iOS for the
default voice of the user's own region of the article's language
(`AVSpeechSynthesisVoice(language: "en-US")`, regions from
`Locale.preferredLanguages`) and uses it whenever it is enhanced or premium —
the factory default is compact, so a better-than-compact answer can only mean
the user chose it. Only then does the ranking below run. **Verified on Peter's phone
(build 36, 2026-09-03):** iOS does hand apps the Settings selection through
that API — the log read `system default for en-SE is compact Samantha`, then
`system default for en-US is enhanced Tom` → `chose Tom via system default`,
Tom being the voice he had configured. (The earlier claim that "there is no
API for the Settings voice" came from a Mac with no premium voices installed,
which could not show it either way — a limit asserted, not tested.)
`SpeechPlayer` logs the path it took (`subsystem com.notesage.app, category
speech`), readable from a paired phone over WiFi with `idevicesyslog -n`; that
is how the question was settled. The "Voice…"
sheet in the reader menu remains as an override the user never has to touch:
it lists installed voices for the article's language as `Name · Premium ·
en-US` (premium en-AU and premium en-US are both "Premium" and sound nothing
alike), ✓ on the current one, remembered per language in
`mobile-store.speechVoices`. Measured on Peter's phone before any of this:
English was read by premium **en-AU Karen** — the right tier, the wrong voice,
which is what "sounds like the regular Siri voice" was.

**The lock screen shows the article's picture.** `speech_start` carries the
same lead-image thumbnail the gallery card uses (base64), and `SpeechPlayer`
publishes it as `MPMediaItemPropertyArtwork` — the grey box Peter saw on the
lock screen was the absence of one. It rejects for a document with no inline
image, in which case the player simply has no artwork; the image is fetched
before `start()` but never delays it, since either outcome starts playback.

**Novelty voices are excluded everywhere.** Apple's classic joke set
(`com.apple.speech.synthesis.voice.*` — Albert, Bad News, Bells, Zarvox…) and
the Eloquence screen-reader family (`com.apple.eloquence.*`) are 19 of the 25
English voices on the simulator; left in, they bury a user's premium voices in
the picker and are eligible for the automatic choice. `isNoveltyVoice` drops
them from both.

**When the user has not chosen, ranking is quality → the user's own region →
US/UK → the rest.** Quality alone picks arbitrarily among equals; the region
step reads `Locale.preferredLanguages` so a phone set to en-US gets en-US.

**The voice otherwise follows the ARTICLE, not the device.** With no voice set, iOS speaks
in the system language: on a Swedish phone an English article is read by
`sv-SE.Alva`, which is close to unintelligible. `NLLanguageRecognizer` detects
the language from the text (≥0.5 confidence, first 2000 characters) and the
voice is resolved against `speechVoices()` — matching the language *subtag*, so
"en" matches "en-GB" — rather than trusting `AVSpeechSynthesisVoice(language:)`
with a bare subtag, which does not reliably resolve one. Higher-quality voices
win when installed.

**Text extraction is a hard requirement, not a nicety** (`speech-text.ts`).
Captures inline their images, so a single X article carries ~500 KB of base64
that a naive strip would hand to the synthesiser to read out character by
character. The extractor drops `script`/`style`/`svg` content wholesale, drops
every tag (and with it any `data:` URI), decodes entities, and normalises
paragraphs so a markdown note and its HTML capture split identically — the
paragraph index is the resume position, so the two must agree.

**Known gap:** the player has no surface outside the reader, so playback stops
when the reader closes. Backgrounding and screen lock do not unmount it, so the
motivating case is unaffected; a library-level mini player is the follow-up.
Simulator note: `speechVoices()` lists 68 voices there but only the
device-language asset is installed, so a non-Swedish voice logs "utterance had
bad voice" and falls back — selection is verifiable, audible output is not.

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
| `src/lib/home-file.ts` | `.notesage/home.json`: the folders Home shows (format, defaults, compaction, `HOME_KEY`) |
| `src/components/mobile/HomeFolders.tsx` | Edit Home — a switch per root folder |
| `src/components/mobile/AllFoldersRow.tsx` | The last row on Home: pushes the full root listing as a level |
| `src/components/mobile/HomeHint.tsx` | The one-time line under a not-yet-curated Home |
| `src/components/mobile/BrowserStates.tsx` | The listing's skeleton and error states, shared by the browser and Edit Home |
| `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/InboxState.swift` | The Inbox's disk truth (names, unread count, seen set, preferences) — app, background task and Share Extension |
| `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/Notifier.swift` | The one notification delegate: status, the prompt, the badge, the "new in Inbox" banner, the tap route |
| `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/BackgroundRefresh.swift` | `BGAppRefreshTask`: register, schedule, run |
| `src/components/mobile/NotificationPrePrompt.tsx` | The Inbox card that asks before the system prompt |
| `src/components/mobile/useNotificationRoute.ts` | A notification tap lands on the Inbox (warm event, cold launch route) |
| `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/Recorder.swift` | The native recorder: AAC into the app's container, interruptions, routes, the 1 Hz tick |
| `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/AudioOwner.swift` | One owner of the audio session: speech, recording, or playback |
| `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/RecordingLibrary.swift` | Finalise a recording into `Recordings/Recording <stamp>/` with its manifest |
| `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/RecordingManifest.swift` | `recording.json` as the phone writes it |
| `src/lib/recording-controller.ts` | Start / pause / resume / stop / recover; the native events into the store |
| `src/components/mobile/RecordingBar.tsx`, `RecoverRecordingSheet.tsx` | The island's web fallback; the keep-or-discard sheet after a force-quit |
| `src/components/mobile/LibraryBrowser.tsx` | Push-navigation folder browser |
| `src/components/mobile/Reader.tsx` | Markdown / HTML / mermaid / text / image / PDF reader + iCloud download + theme re-render |
| `src/components/mobile/ArticleRow.tsx` | Read-later list row: title, `site · min left`, excerpt, thumbnail; falls back to `FileRow` |
| `src/components/mobile/speech-text.ts` | Document → speech prose (strips markup, base64 images, URLs) |
| `src/hooks/useSpeechPlayer.ts` | Speech controller + per-document resume position |
| `src/components/mobile/SpeechPlayerBar.tsx` | Fallback transport for builds with no native chrome |
| `src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/SpeechPlayer.swift` | `AVSpeechSynthesizer` player: paragraph utterances, lock-screen controls, voice-per-language |
| `src/lib/markdown-render.ts` | `renderMarkdownFragment` — the shared Rust markdown renderer (theme-aware) |
| `src-tauri/src/commands/html_preview.rs` | `htmlpreview://` scheme store (mime-aware: `.svg` ids serve image/svg+xml) |
| `src-tauri/crates/notesage-capture/` | The one capture-note formatter; C ABI for the Share Extension |
| `src/lib/ios-api.ts` | Typed wrappers for the iOS Tauri commands (base64 binary decode) |
| `src/stores/mobile-store.ts` | Grant + navigation state machine |
| `src-tauri/src/commands/ios_library.rs` | iOS commands (cfg-gated) |
| `src-tauri/crates/notesage-capture/` | Pure capture-note builder + tests (C ABI for the Share Extension) |
| `src-tauri/crates/tauri-plugin-notesage-ios/` | The Tauri bridge as a plugin crate (`LibraryAccess.swift` + `NotesageIosPlugin.swift` in its Swift package) — wired automatically by `tauri ios init` via `.ios_path()` |
| `src-tauri/ios/` | Share Extension sources + `integrate-share-extension.py` (extension wiring) + `make-ios-icon.py` (icon set) + wiring README |
