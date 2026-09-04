# Release v0.56.1

**Date:** 2026-09-04
**Previous version:** 0.56.0

Two things noticed on the first day with the Mac Inbox.

## Changes

### Fixes

- **Opening a file closes the Inbox.** With the Inbox list showing, choosing
  a document in the sidebar left the list in place — only opening something
  from the list itself would dismiss it. Any document you open now takes
  the column, including the one that was already open behind the list.
- **The sidebar uses the arrow pointer.** Hovering the Inbox row showed the
  text cursor, and the other rows showed a hand. Every row in the sidebar
  now shows the arrow, as controls do on the Mac.

## Under the hood

- Inbox: `inbox-store` closes on any `activeTabId` change; `openFile` closes
  it explicitly for the re-open-the-active-file case (PR #884).
- The `trash` crate is desktop-only — it has no iOS backend and broke the
  TestFlight build (PR #882). CI compiles no Rust for the iOS target; #883.
- iOS list/gallery density and thumbnail work shipped as TestFlight build 42
  (PR #880); iOS notes are routed to the iOS changelog automatically.
