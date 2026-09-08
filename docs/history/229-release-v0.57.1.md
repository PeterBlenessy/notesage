# Release v0.57.1

**Date:** 2026-09-08
**Previous version:** 0.57.0

Turning on the library move in Labs did nothing visible, and on some Macs
offered nothing at all without saying why. It explains itself now.

## Changes

### Fixes

- **The library move tells you what it is and where to find it.** Turning it
  on in Labs previously gave no confirmation and no next step, and the thing
  it unlocks lives in a different part of Settings. The Labs entry now says
  what the move is for and where to go — Settings → Projects → Library.
- **The Library section explains why the move is not on offer.** It used to
  show an empty space, whether your Mac was not ready, the move was already
  done, or there was nothing to move. Each of those now says which it is. The
  common one on a second Mac: Notesage's own iCloud folder is made by the
  iPhone app and brought over by iCloud, so until it arrives there is nothing
  to move into — and the app now tells you that instead of appearing broken.
- **Your library's location is named before its path is shown.** "iCloud
  Drive/Notesage" is where it is; the long folder path underneath is which
  folder exactly. The path alone was doing the explaining, and it cannot.

## Under the hood

- #958. `FlagSpec` grows an optional `details` for the case of a flag that
  reveals a control elsewhere rather than acting on its own — the failure is
  silent: the switch reports success and nothing happens.
  `migrationOfferState` replaces the boolean that collapsed four situations
  into one blank row, and `LibraryMigrationRow` prints the answer for
  whichever it is. Six cases lock the states, six more lock that the row
  explains itself rather than going blank.
- Migration telemetry, scoped to the population that already reports:
  enabling any Labs flag switches usage reporting on, which the panel states.
  `library_root_kind` per launch is the denominator for retiring the flag —
  it counts the people who have NOT moved; `library_migration_state` says
  what is stopping those who opted in; `blocked`/`started`/`finished`/`undone`
  are the funnel. Sizes bucketed, no paths, no names. Its blind spot is
  written where it is defined: consent defaults on only for flag users, so it
  cannot see anyone who never opted in — cross-check against release download
  counts. Retirement criteria are issue #959.
- A real-E2E leak, found while this was in CI: `inbox.test.ts` registered a
  project and never removed it, and `sidebar-tree-nav` asserted against the
  FIRST project row — another spec's. It had been failing on first attempt
  and passing on the orchestrator's retry since before v0.57.0, which CI
  counted as success. Both ends fixed; the suite now reports
  `15 passed, 0 failed (0 retried)`.

## Files Changed

- 12 files across 1 commit (+~450 / −~40)
