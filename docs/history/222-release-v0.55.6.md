# Release v0.55.6

**Date:** 2026-09-01
**Previous version:** 0.55.5

Move and Update from source, which shipped in the last release and did nothing,
now work — and they are on a "…" button instead of hidden behind a long press.

## Changes

### Fixes

- **Move and Update from source actually work now.** Both were added last
  release and neither did anything: tapping a row in the reader's menu was
  silently ignored. They also sat behind a long press on the share button, which
  is not somewhere anyone would look. Both are now on a "…" button that opens
  on a tap.
- **Update from source can reach the page.** It could never load the article it
  was meant to fetch, so it always reported having nothing to add. It now
  fetches the way the rest of the app does and works as intended.

## Under the hood

- **Menu rows were inert.** `ChromeOverlay.menuRows` had two branches: a
  selection row emitted from a Toggle's binding setter — with a comment saying
  why, since a tap-gesture version had already shipped inert sort/view pickers —
  while an ACTION row used a plain `Button`, which UIMenu never delivers a tap
  to. Nothing had ever used the action branch, because every menu in the app was
  a selection menu, so it survived untested until Move (#832) and Update (#829)
  became its first users. A contract test now asserts rows emit through a
  binding; restoring the `Button` fails it.
- **The fetch was CORS-blocked.** `updateFromSource` called the WebView's
  `fetch()`, which for another origin is a CORS request that almost no site
  permits — so it failed before Rust was asked to splice. Now a Rust command
  using `reqwest` with Safari's user-agent, matching the Share Extension's own
  fetch. `ImageInliner.swift` already fetched natively for this exact reason.
- The reader's overflow uses `menuOnTap` with an `ellipsis` icon, matching
  `LibraryBrowser`'s existing pattern; Share moved into the menu since tapping
  no longer fires it.
- Both defects were invisible to the tests written for them: those proved the
  Rust and the orchestration correct and never asked whether a person could
  reach or trigger the feature. The contract guard is the smallest check that
  would have caught it before a build.

## Files Changed

- 5 files across 3 commits (PR #844, #845, #846)
