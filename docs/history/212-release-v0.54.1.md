# Release v0.54.1

**Date:** 2026-08-25
**Previous version:** 0.54.0

Sharing an X post from the Mac now saves what you expected, and "Article
(HTML)" saves a file you can actually open.

## Changes

### Fixes

- **An X post shared from the Mac keeps its title and picture.** It used to
  save under the author's name — "Someone (@handle) on X" — with no image, so
  two articles by the same person collided and neither one said what it held.
  Now the note is named after the post, shows the post's own photo in the
  library, and carries the author and date. The phone already did this; the
  Mac does now too.
- **"Article (HTML)" saves a real web page again.** Shares in that format were
  being saved with a `.md` name, so opening one showed raw markup instead of
  the article. They now save as `.html` and open as a page.

## Under the hood

- The macOS Share Extension links the same static library through the same
  bridging header as iOS, so every X function was already available to it —
  only the Swift call sites were missing. Behaviour matches iOS exactly,
  including how it degrades: no metadata → plain article capture; no page but
  metadata → the metadata note rather than an error.
- The HTML naming bug came from tracking whether an HTML document was
  *requested* rather than whether one was *produced*. Both HTML builders
  decline when a page has no article, and the fallback is markdown — so the
  two are not the same thing.
- **The pipeline contract could not see either bug.** It checked only the iOS
  extension; macOS is a second consumer of every export and was invisible to
  it, which is how desktop shipped without the X path for the whole time iOS
  had it. The export table now carries per-platform expectations with a
  written reason wherever macOS legitimately differs. All three new assertions
  were verified to fail when broken.

## iOS

Shipped to TestFlight rather than here — a **Move to…** action in the
long-press menu, for filing captures out of `Inbox/` from the phone (#754).

## Known

- The desktop X path has not been exercised end to end by a real share. It
  calls the same crate functions the iOS path does, and those are confirmed
  working on device; what is unverified is the macOS extension's own fetch and
  whether X's endpoint answers a Mac user-agent the same way.
- The performance gate remains red on benchmarks that were already red in
  v0.53.1 — see the 2026-08-25 entry in `docs/performance-baseline.md`. Not a
  regression from either release; unresolved as to cause.

## Files Changed

- 1 commit since v0.54.0, spanning the macOS Share Extension, the capture
  pipeline contract, and the iOS move command.
