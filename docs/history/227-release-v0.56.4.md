# Release v0.56.4

**Date:** 2026-09-07
**Previous version:** 0.56.3

The Inbox is where you left it even when it's empty, and your recordings now
have a place of their own.

## Changes

### Features

- **Recordings has its own place in the sidebar.** Everything you or your
  phone recorded, with the transcript, "move to project", and a way to try a
  transcription again when one didn't work. Until now a recording only
  appeared while it was being transcribed, and one that failed was impossible
  to get back to without going hunting in Finder.

### Fixes

- **The Inbox is always in the sidebar.** It used to appear only after
  something had been shared to it, so a new Mac looked as though it had no
  Inbox at all. It's a place, so it's there whether or not anything is in it
  — the count still only shows when something is unread.

## Under the hood

- #955: `InboxSection` dropped its `hasItems` gate; new `recordings-store`
  (read-only over `<library root>/Recordings` — `useRecordingsInbox` keeps
  sole ownership of dispatch and manifest writes), `RecordingsView`,
  `RecordingsSection`. The Recordings badge counts FAILED bundles, not all of
  them: recordings transcribe and file themselves, so a standing total would
  never reach zero. "Done" is the transcript on disk rather than the
  manifest's `status`, which can say `running` for ever if the app died
  mid-run. Inbox and Recordings are both modes of the document column, so
  opening either closes the other — enforced by subscribing to the Inbox's
  flag rather than editing its four callers, which also avoids a store cycle.
- The iOS work merged in this window (#947, #951–#954: the native navigation
  stack, its insets, the read-aloud player and the sticky group header) ships
  through TestFlight, not here.

## Files Changed

- 9 files across 1 commit (+~700 / −~30)
