# Release v0.56.0

**Date:** 2026-09-04
**Previous version:** 0.55.6

The Inbox comes to the Mac: everything you share to Notesage from Safari,
Files or your phone in one read-later list, with filing, keyboard triage and
reading progress that follows you between devices.

## Changes

### Features

- **Inbox.** A new row at the top of the sidebar, with a badge for what you
  haven't opened yet. It opens a read-later list in the document column:
  each item with its picture, title, source and reading time ("2 of 4 min
  left" once you have started), grouped by day. Switch to a gallery of cards
  in three sizes from the floating controls; Condensed keeps one line per
  item.
- **File it where it belongs.** Drag an item (or a selection) onto a project
  in the sidebar, or press `e` to file to the project you filed to last.
  Pin, mark read or unread, open the original page in your browser, or move
  to the Trash — from the row, its right-click menu, or the keyboard
  (`j`/`k`, ↩, `p`, ⌘⌫, ⌘A).
- **Read without leaving the loop.** Opening an item adds a few controls to
  the reader's floating pill: back to the Inbox, where you are in the list,
  File to…, pin, open original. ⌘↓ and ⌘↑ step to the next and previous
  item. ⌘⇧I opens the Inbox from anywhere.
- **Progress travels with the item.** How far you got, and where listening
  stopped, is shared between the Mac and the phone through the Inbox folder
  itself, so an article started on the phone shows "2 of 4 min left" on the
  Mac. Filing an item takes its progress along into the project.
- **New captures appear while the app is open.** Share from your phone and
  the badge and list update on the Mac without a restart.

### Improvements

- Deleting from the Inbox moves to the Trash, where it can be recovered.

## Under the hood

- Desktop Inbox: PR #877, designed from a mockup rather than an issue.
  Docs: `docs/features/inbox.md`.
- The read-later state is `Inbox/.notesage/reading-progress.json`, kept with
  the folder like a project's `.notesage/`. Every write is read → merge →
  write; the merge is safe in any order (monotonic progress, `resetAt` for
  mark-as-unread, tombstones with a carried `deletedAt` for deletions). The
  phone (`inbox-progress-sync.ts`) writes only what it changed.
- The capture crate is now linked on desktop for its pure readers
  (`inbox_card_meta`, `article_lead_image`); `list_files_shallow` carries
  mtimes; new `trash_path` (the `trash` crate).
- Real-E2E spec `e2e-real/tests/inbox.test.ts` runs on a throw-away library
  through `inbox-store.rootOverride` with a guard before every destructive
  step.
- CI: the npm audit step retries and treats an unreachable registry as a
  warning (#878, #879) — it had blocked every merge for a day.
- Follow-ups: #875 (one native read per row), #876 (phone reset of local
  progress).
