# Release v0.56.2

**Date:** 2026-09-04
**Previous version:** 0.56.1

A faster Inbox, and the Mac's "mark as unread" now reaches the phone.

## Changes

### Improvements

- **The Inbox lists faster.** Each row's title and picture come from one
  read of the saved page instead of two, and a page that has not changed is
  not read again when the list refreshes — noticeable on a large Inbox in
  iCloud.

### Fixes

- **"Mark as unread" on the Mac now shows on the phone too.** The phone used
  to keep its own "2 of 4 min left" until the item was read again.

## Under the hood

- #875: `inbox_card_meta` and `article_lead_image` share one read per file
  version (mtime, ctime, size), coalesced per path, oversized lead images
  served but not retained.
- #876: the phone's pull applies a sidecar `resetAt` once, through a
  persisted ledger, and compares stamps as times.
- #883: CI now builds the iOS app for the simulator when native code
  changes — the check that would have caught build 42's desktop-only crate.
- #891: the read-aloud highlight for markdown and plain-text notes
  (TestFlight build 49).
