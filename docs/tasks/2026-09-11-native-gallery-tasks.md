# Tasks: Native folder screen (step 1 of the native browsing surface)

PRD: [2026-09-11-native-browsing-surface](../prds/2026-09-11-native-browsing-surface.md)
Issue: #1000

Step 1 of four. The gallery is first because it is 276 lines of web with the
fewest features and the most to gain, so it proves the whole pattern — cells,
data source, thumbnail hand-off, context menus, view state — against the
smallest surface. **If the approach is wrong, we learn it here and stop.**

Ordered so the app is never worse than it is now: the native grid goes in
beside the web one behind a flag, is verified at parity on device, and only
then does the web one go.

---

## Progress (2026-09-11)

Shipped in build 63, and verified on the simulator rather than reasoned about:

- ✅ `LibraryOrdering.swift` — sort + five grouping modes, 28 assertions run on
  macOS by `scripts/check-library-ordering.sh`, in CI. Both regressions the
  TypeScript learned the hard way are pinned and fail when reintroduced.
- ✅ `LibraryFolderScreen` — native screen, list and gallery layouts, diffable
  data source, sticky headers, prefetch, pull-to-refresh, swipe, long-press.
- ✅ `LibraryCells` — rows, cards, headers, and a thumbnail loader that draws
  note previews natively in the app's colours (QuickLook renders a `.md` as a
  white page, which is a wall of glare in a dark app).
- ✅ `LibraryBrowsing` — pins and progress from the shared sidecars, recents in
  `UserDefaults`.
- ✅ The bridge, and `useNativeLibrary` with 10 tests.
- ✅ **The premise, verified:** Home → folder → document → back captured frame
  by frame. The return is ONE transition frame with the folder fully drawn
  underneath — rows, thumbnails, dates, item count — and it comes back at
  identical pixel density to before it was left. No blank, no black, no zoom.
  The screen was never unmounted, so there is nothing to re-render.

Not done, and not claimed:

- ❌ Home is still the web layer's — it is synthesised cards, not a listing.
- ❌ The folder is listed TWICE: once natively, and once by `LibraryBrowser`
  so the menu and swipe handlers can find the entry. That goes when the
  browser shell moves (step 3).

## Progress (2026-09-11, after build 63)

Two of build 63's three gaps closed.

- ✅ **Article rows.** A saved article shows its own title, `site · 4 min`
  and its standfirst instead of a timestamped filename.

  Build 63's note said the plugin package "cannot call" the C ABI because the
  bridging header and the capture staticlib belong to the app target. The
  staticlib half was **wrong**, and checking it rather than believing it is
  what unblocked this: the app's Rust library depends on the capture crate,
  and `nm -gU libtauri_app_lib.a` shows all twenty `#[no_mangle]` exports
  present — in an archive the app target already links. Only a DECLARATION was
  missing.

  So there is now a `CNotesageCapture` target in `ios/Package.swift`: two
  function declarations, an empty `shim.c`, and no implementation. A build
  without it is a hard `#error` rather than a silent fall back to filenames.

  `ArticleMeta.swift` parses nothing — it reads the file, hands the HTML to
  the crate's own reader and decodes the JSON. The cache is keyed by
  path@mtime and distinguishes "read it, not a capture" from "not read yet",
  which is what stops every plain `.html` being re-read on every scroll.

  The row keeps its ABSOLUTE height. The standfirst gets one line, not the
  web's two, because self-sizing is what let the web list jump when a late
  read changed a row's shape — and a row that never reflows is the point of
  this screen.

- ✅ **Listen on a row.** The floating 36pt glass disc is back, with the
  progress ring, over the row's right edge — reserving no width, as on the
  web (a 72pt column cost titles a third of the screen in build 50).

  Playback is still the web controller's. State flows one way — session in
  via `ios_set_library_speech`, taps out as a `listen` event — so there is no
  second answer to "where was I". What can be read aloud is decided by
  extension, not by `LibraryFileKind`: `.text` also covers `.json` and source
  files, and offering to read a stack trace aloud is not a feature.

- ✅ `scripts/check-article-meta.sh` — 45 assertions on macOS, in CI. Verified
  to fail on both regressions it exists for: the truncation that produces
  "0 of 4 min left", and a field renamed out of camelCase, which would decode
  to nil in silence.
- ✅ Ten more assertions in `check-library-ordering.sh` pinning what can be
  read aloud against `isSpeakable` in `FileRow.tsx`.
- ✅ Seven more frontend tests, including that the reading-time messages cross
  as TEMPLATES with `{total}` intact — resolving them here would look harmless
  and ship rows reading "0 of 0 min left".

Verified on the simulator, not reasoned about — photographed at each step:

- The Inbox as a native list: the article row showing **its own title**,
  `anthropic.com · 4 min`, and its standfirst, beside six note rows still
  showing filenames and dates.
- The Listen disc idle on every speakable row, then playing: pushing a speech
  session moved ONLY the article's disc to Pause and drew its quarter ring.
  That is `ios_set_library_speech` → `LibraryBrowsing.setSpeech` →
  `speechChanged` → a targeted `reconfigureItems`, end to end.
- The same in the gallery, three across, with the badge on each card's corner.

Not pressed on a device: the tap itself. The Mac's screen was locked, so the
Simulator had no window to click — see [[simulator-needs-an-unlocked-mac]].
The JS half of that path is unit-tested; the native half is a target/action on
a control.

**The cost of this session was not the code.** Three build cycles went into
debugging a probe that was never in the binary: `tauri ios build
--target aarch64-sim` printed `** BUILD SUCCEEDED **` and left the PREVIOUS
`.app` in place, because the xcarchive directory was not empty. I concluded in
turn that a Tauri command was rejecting and that the library grant had been
wiped. Both were fiction. The memory now says to `stat` the app binary's mtime
before forming any theory at all.

Still open after this: Home, and the double listing.

## 0. The shape

A **native `UIViewController` per folder level**, in the nav stack, owning a
`UICollectionView` that does both list and gallery layouts. It lists, sorts,
groups, filters, draws, scrolls and navigates. The web layer is not involved.

Two earlier drafts hedged — an overlay inside a web-owned screen, then "web
owns the data". Both were the smallest-diff instinct, and both preserved the
two-layers-one-screen arrangement that is the entire problem. See the PRD's
"What stays web" for the facts that settle it.

It is also simpler. `ScreenController`'s snapshot dance exists solely because
one live `WKWebView` must move between controllers. A native folder screen has
no web view to move: no freeze, no thaw, no `rendered` signal — and no black
screen when an interactive swipe-back outruns the handoff (build 62).

## 1. `LibraryFolderScreen.swift` — the screen

- `UIViewController` + `UICollectionView`, one instance per level, pushed on
  the existing `UINavigationController`.
- `UICollectionViewCompositionalLayout`, switched between list and grid by the
  view setting — one collection view, two layouts, animated between.
- `UICollectionViewDiffableDataSource` keyed by rel path, so a delete, a
  rename or a sweep animates instead of reloading.
- Scroll position restored per level by UIKit, for free.

## 2. Listing and ordering — in Swift

- `LibraryAccess.listDirectory(rel)` directly. It already returns name, path,
  directory flag, modified and child count.
- Port `sortEntries` (12 lines) and the five grouping modes (~70 lines) from
  `LibraryBrowser.tsx`. Pure functions, and they get a check script like
  `check-chrome-column.sh` — they are exactly the kind of logic that is
  testable on macOS without a device.
- Filter-as-you-type from the existing native search island.

## 3. Cells and thumbnails

- `LibraryAccess.thumbnail` + `ThumbnailCache`, both already native and
  already disk-cached. `UIImage` straight into a cell.
- `UICollectionViewDataSourcePrefetching` for the lead; cancel on
  `cancelPrefetchingForItemsAt`. **No base64, no JSON, no
  `IntersectionObserver`, no promise cache.**
- Markdown notes: comrak over the C ABI, like `LibraryCapture.swift` calls
  `notesage_capture_*`. Rendering the fragment to an image is the one open
  question — decide by measurement; a `WKWebView` per cell is the obvious
  wrong answer at 3-across.
- Unread weight and progress lines from `reading-progress.json`, read
  natively.

## 4. Navigation and the reader

- Folder tap → push another `LibraryFolderScreen`. No store to mirror, no
  `useNativeNavShell`.
- Document tap → present the reader: the web view renders ONE screen on
  demand, the inverse of today. `ReportWebView.swift` is the precedent — it
  already presents a bridge-less web view for saved articles.
- Dismiss → the folder screen is still there, still scrolled where it was,
  because it was never unmounted.

## 5. View settings

`folderViews` (list/gallery, density, sort, group) move to `UserDefaults`
with the screen that uses them. The "…" menu that sets them is already native
chrome. Nothing is shared with the web layer, so nothing can disagree.

## 6. Parity gate — from `GalleryView.test.tsx` and `GalleryCard`

Verified **on a device**, not reasoned about. Each line is a thing today's
gallery does:

- [ ] 3 columns at rest, 4 condensed
- [ ] A directory card shows a folder icon and never requests a thumbnail
- [ ] A card requests its thumbnail only when near the viewport, and a folder
      left mid-scroll cancels what it queued
- [ ] Thumbnail kinds: markdown render, QuickLook picture, generic icon
- [ ] Title, date, containing-folder caption; one-line caption when condensed
- [ ] Unread weight, and it follows `reading-progress.json`
- [ ] Long-press opens the menu with the same rows, in the same order
- [ ] Tap opens the document; tap on a folder pushes it
- [ ] The Listen control on a saved article works without opening the row
- [ ] Scroll position survives leaving and returning to the folder
- [ ] **No blink, no blank tiles, no double animation** — the four bugs that
      motivated this must be absent by construction, not by patch

## 7. Measure, then decide

The PRD says what would make this wrong; this is where it gets checked.

- [ ] Time taken vs. the four seam fixes it replaces
- [ ] Scroll a folder of several hundred files: frame time, and whether the
      UI thread starves the way it did at a concurrency of two
- [ ] Cold-folder thumbnail latency vs. the web grid, same folder, same device

**If step 1 costs materially more than the patching it replaces, stop here**
and say so. The point of doing the smallest surface first is that abandoning
it is cheap.

## 8. Only then

- [ ] Delete `GalleryView.tsx` and `GalleryCard.tsx`
- [ ] Retire `GalleryView.test.tsx`, replacing its assertions with the native
      parity checks
- [ ] Move the gallery's strings from `t()` to `.strings`
- [ ] Mark this file and the PRD done — both, per convention

---

## Not in step 1

List rows, swipe actions, the browser shell, Home, and moving view state
native. They are steps 2–4 in the PRD and depend on what step 1 measures.
