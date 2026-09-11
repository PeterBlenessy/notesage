# Native browsing surface (iOS)

**Status:** proposed
**Date:** 2026-09-11
**Tasks:** [step 1 — native gallery](../tasks/2026-09-11-native-gallery-tasks.md)
**Supersedes the reasoning in:** `NativeNavShell.swift` § "What is deliberately NOT native here"

## Why this, and why now

The nav shell's own comment argues against this, and that argument was right
when it was written. It is worth quoting, because it is the thing being
reversed:

> The owner's acceptance criterion is "it must have the same features as the
> current version", and the way to meet that is to keep the code that already
> implements them.

What changed is not the feature count. It is the **rate at which the seam
produces bugs**. On 2026-09-11, in one afternoon:

| Bug | Cause | Native list/gallery prevents it? |
| --- | --- | --- |
| #995 — status pill unreadable behind the search island | A web island and a native island drawn in the same strip, neither aware of the other | **Yes** — one layer owns the strip |
| #994 — the screen blinks when a document closes | `MobileApp` swaps Reader for LibraryBrowser, so the browser UNMOUNTS and remounts | **Yes** — a `UIViewController` in a stack is not unmounted |
| Blank tiles after #995's prefetch | A hand-rolled `IntersectionObserver` over a promise cache, with no synchronous read | **Mostly** — `UICollectionView` prefetch and cell reuse are given |
| The "bump or zoom" returning to the list | A 340 ms CSS `view-zoom-in` playing while UIKit animates the same pop | **Yes** — one animation, owned by UIKit |

Four for four. Each was found by the owner on a device, and each fix uncovered
the next: blink → blank tiles → zoom. That is the signature of one structural
fault emitting defects, not a backlog of four.

Every one of them is the same sentence with different nouns: **two layers
disagree about who owns something** — a strip of screen, the lifetime of a
view, a transition.

## What stays web, and why — and it is only one thing

**The reader's RENDERING.** A `WKWebView` over the comrak HTML: 1,892 lines,
shared with the desktop and a future Android, and the piece with the most
leverage anywhere else. Nothing in the bug table above is a reader bug.

Everything else is native. Three earlier drafts of this document hedged on
that — first an overlay inside a web-owned screen, then "web owns the data
pipeline, native owns presentation". Both were the same instinct: minimise the
diff. The owner rejected both, and the second time asked the question that
settles it — *what has to be web in the navigation?*

Nothing does. The facts:

- **Listing is already native.** `ios_list_directory` calls
  `LibraryAccess.listDirectory`, which returns name, path, directory flag,
  modified date and child count. Today that goes Swift → Rust → JS, is sorted
  in TypeScript, and would be handed back to Swift to draw. A round trip
  through JavaScript to render something JavaScript did not produce.
- **Markdown thumbnails render in Rust**, not JS — `render_markdown_fragment`
  is comrak. And Swift already calls Rust directly over its C ABI in this
  repo: `LibraryCapture.swift` calls `notesage_capture_*`.
- **The sort/group/filter logic is ~80 lines of pure functions.**
  `sortEntries` is twelve. The other ~1,400 lines of `LibraryBrowser` are
  JSX, chrome wiring, pull-to-refresh and effects, which *vanish* in a native
  screen rather than port.
- **`useNativeNavShell` exists only to mirror a web store into native
  pushes.** It exists because the screens are web. Native screens delete it,
  and with it the snapshot handoff — whose failure under an interactive
  swipe-back is the black screen in build 62.

Keeping the data web would cost a bridge, a round trip and a split boundary,
to save porting eighty lines.

## The contract between them

Not a JS store. **The filesystem — which it already is:**

| File | Written by | Read by |
| --- | --- | --- |
| `Inbox/.notesage/reading-progress.json` | reader, and the Mac | native browser (unread weight, progress lines) |
| `.notesage/pins.json` | native browser | desktop sidebar |
| `.notesage/home.json` | native browser | — |

Plus two calls: present a document, and dismiss it.

That is the whole seam, and it is a seam between a renderer and a filesystem
rather than between two things drawing on the same screen.

## Scope

### Moving native (~3,390 lines of TypeScript)

| File | Lines | What it is |
| --- | --- | --- |
| `LibraryBrowser.tsx` | 1,515 | The screen: grouping, sort, filter, pull-to-refresh, chrome wiring |
| `FileRow.tsx` | 422 | A list row |
| `SwipeRevealRow.tsx` | 414 | Swipe actions |
| `GalleryCard.tsx` | 217 | A grid card |
| `ArticleRow.tsx` | 206 | A saved-article row |
| `HomeFolders.tsx` | 132 | Edit Home |
| `ListenButton.tsx` | 122 | Read-aloud affordance on a row |
| `InboxCard.tsx` | 120 | The Inbox card on Home |
| `useVisibleSoon.ts` | 108 | Prefetch predicate — becomes `prefetchItemsAt` |
| `useLongPress.ts` | 75 | Becomes `UIContextMenuInteraction` |
| `GalleryView.tsx` | 59 | The grid |

### Already native, and reusable as-is

This is the part that makes the estimate smaller than it looks. The browsing
surface's expensive machinery has already migrated:

| File | Lines | Gives us |
| --- | --- | --- |
| `LibraryAccess.swift` | 773 | Directory listing, coordinated reads, security scope |
| `EntryContextMenu.swift` | 369 | **The long-press menu is already native** |
| `ThumbnailCache.swift` | 121 | Disk-persisted thumbnails, survives launches |
| `NativeNavShell.swift` | 447 | The stack, push/pop, snapshots |
| `ChromeOverlay.swift` | 1,401 | Islands, search, the bottom-centre column |

`QLThumbnailGenerator` generation is already native too (`LibraryAccess.thumbnail`).
A native gallery stops base64-ing images across the bridge and hands
`UIImage` straight to a cell.

### The real risk: where the state lives

The browsing surface reads persisted state that today lives in a Zustand store
in `localStorage`. Splitting the surface without splitting the state is how
this becomes a mess. Sorted by difficulty:

| State | Today | Native path |
| --- | --- | --- |
| `readingProgress` | `Inbox/.notesage/reading-progress.json` | **Already a file.** Native reads it directly; the Mac already shares it |
| `pinnedPaths` | `.notesage/pins.json` | **Already a file** |
| `homeFolders` | `.notesage/home.json` | **Already a file** |
| `folderViews` (per-folder view/density/sort/group) | Zustand → localStorage | Move to `UserDefaults`; per-device UI state, not library data |
| `scrollOffsets` | Zustand (not persisted) | Native, per screen controller — UIKit does this for free |
| `recentlyRead`, `inboxOpened` | Zustand → localStorage | Move to `UserDefaults` |

Three of six are already files on disk. The rest are per-device preferences
with no desktop counterpart. **No library data has to move.**

## Feature parity checklist

Derived from the 34 mobile test files (≈380 cases). The browsing-relevant
suites are the contract; each must have a native equivalent or a deliberate,
recorded decision not to.

**View and layout**
- [ ] List and gallery, per folder, remembered (`folderViews`)
- [ ] Density: normal / condensed — 3 cards across vs 4, 72pt vs 40pt tiles
- [ ] Sort: name, modified
- [ ] Group: none, pinned, recent, date, type — **five modes**, with sticky headers
- [ ] Scroll position per folder, restored on return

**Rows and cards**
- [ ] Thumbnails: markdown render, QuickLook, generic icon; fixed slot so a late one never reflows (`FileRow.test.tsx`, `GalleryView.test.tsx`)
- [ ] Article rows: title, site, reading time, progress line, excerpt (`ArticleRow.test.tsx`)
- [ ] Unread weight — 600 vs 400, no badge (`ArticleRow.test.tsx`, `reading-progress.test.ts`)
- [ ] Listen button, in place, without opening the row (`ListenButton.test.tsx`)
- [ ] Inbox card with unread count (`InboxCard.test.tsx`, `inbox-name.test.tsx`)

**Interaction**
- [ ] Swipe actions: Share, Delete, per entry kind (`SwipeRevealRow.test.tsx`, 31 cases — the largest single suite)
- [ ] Long-press menu: Share / Pin / Delete / Rename (already native; needs wiring from cells)
- [ ] Pull to refresh
- [ ] Filter-as-you-type through the native search island
- [ ] Home: chosen folders, the hint, "All folders" (`HomeFolders.test.tsx`, `library-folders.test.ts`)

**Behaviour under stress**
- [ ] A folder of several hundred files scrolls without starving the UI thread
- [ ] Thumbnails prefetch ahead of the viewport and are cancelled on leave
- [ ] Deleting/renaming updates the listing without a full reload

## Order, chosen to de-risk

**1. Gallery.** 276 lines of web (`GalleryView` + `GalleryCard`), the fewest
features, and the most to gain: a grid of pictures is exactly what
`UICollectionView` prefetch and cell reuse are for. It proves the whole
pattern — cells, data source, thumbnail hand-off, context-menu wiring,
`folderViews` in `UserDefaults` — against the smallest surface. If the
approach is wrong, we learn it here for 276 lines.

**2. List rows.** `FileRow` + `ArticleRow` + `SwipeRevealRow` (1,042 lines).
Swipe actions are the genuinely hard part and have the largest test suite;
`UISwipeActionsConfiguration` gives them, but the row layouts are detailed
(two densities × two row kinds × progress lines × unread weight).

**3. The browser shell.** `LibraryBrowser` (1,515 lines): grouping, sort,
filter, pull-to-refresh. Largest, but by this point the cells exist and the
state has moved.

**4. Home.** `HomeFolders` + `InboxCard`. Smallest, least risky, last.

Each step ships behind the existing Labs flag with the web version still
present, verified for parity on device, and only then is the web code deleted.

## What this costs

Honest, not advocacy:

- **Two UI codebases for the browsing surface.** Desktop keeps its own; this
  stops being shared. The reader still is.
- **Localisation duplicates.** The browsing surface's strings move from the
  `t()` table to `.strings`. The table was finished on 2026-09-11 at some
  effort; roughly the mobile share of it is re-done.
- **Android.** If Android happens, the browsing surface is written a third
  time. The reader, the capture pipeline, and the Rust core still port — which
  is most of the app by value.
- **Slower iteration.** A rebuild instead of HMR.
- **A rewrite has its own first-build defects.** This does not buy a bug-free
  gallery. It buys ordinary bugs instead of a class that regenerates every
  time either side is touched.

## What would make this wrong

Stated in advance so it can be checked rather than argued:

- If the gallery step takes materially longer than the four seam fixes it is
  meant to replace, the premise is wrong and we stop at step 1.
- If parity against `GalleryView.test.tsx` cannot be reached without inventing
  new interactions, the "same features" criterion has been broken and the
  owner decides, not the implementer.
