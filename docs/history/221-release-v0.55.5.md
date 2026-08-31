# Release v0.55.5

**Date:** 2026-08-31
**Previous version:** 0.55.4

Two things you can do with a saved article on your phone: file it into a folder,
and bring back the picture and author line for ones saved before the app kept
them.

## Changes

### Features

- **Move a saved article into a folder.** An article could be read, edited,
  shared and searched, but not filed — which is the whole point of an inbox. The
  reader's menu now offers Move, with a picker over your library's folders. If a
  folder already holds a file of the same name, both are kept.
- **Update an older article from its source.** Articles saved before the app
  kept the picture, author and summary can now fetch them back — the reader's
  menu offers "Update from source". It only ever ADDS the missing header: the
  text you already have is never replaced, so a page that has since been
  paywalled, changed or removed leaves your copy exactly as it was. If there is
  nothing to add, it says so and changes nothing.

## Under the hood

- **#832.** `ios_move_file` had existed and been unused since #754 — sanitised
  paths, root refused, deduped, returns the path produced. This is UI on a
  finished primitive. The folder picker walks breadth-first and is BOUNDED
  (depth 4, 200 folders) for the same reason the filename search is (#783): an
  iCloud library can hold anything, and an unbounded walk stalls the picker with
  no way out — removing the bound hangs the test rather than failing it. The
  open document follows the move using the RETURNED path, since the name may
  have been deduped.
- **#829.** Deliberately NOT an on-open repair, unlike #805: the hero and byline
  were never written to disk, so restoring them needs the source page, and a
  network fetch must never fire because someone opened a file. Header-only
  splicing — the saved body is never replaced, because a refetch can come back
  worse (`ubs.com` answers a server-side fetch with Akamai "Access Denied", and
  an article captured from the share sheet's rendered DOM cannot be reproduced
  by a fetch at all). Refuses on: not our capture, already repaired, or no
  article — all three mutation-tested. The header builder is now shared with the
  capture path so a repaired article is byte-identical to a fresh one.
- iOS-only, unavoidably: the splice calls `extract_article`, so it needs the
  Readability stack desktop deliberately does not link.

## Files Changed

- 6 files across 2 commits (PR #838)
