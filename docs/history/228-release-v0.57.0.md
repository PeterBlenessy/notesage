# Release v0.57.0

**Date:** 2026-09-08
**Previous version:** 0.56.4

Your synced library can now live in Notesage's own iCloud folder — and once
it moves, every other device finds it there by itself.

## Changes

### Features

- **Move your synced library into Notesage's own iCloud folder.** Until now a
  synced library lived in a normal folder in iCloud Drive, which meant your
  iPhone had to ask you to go and find it. Notesage's own iCloud folder is one
  both apps already know, so nothing has to be pointed at anything. Turn on
  "Keep the synced library in Notesage's own iCloud folder" in Settings → Labs,
  then look under Settings → Projects → Library.
- **You see the whole plan before anything moves.** How many projects, Inbox
  items and files, and every name that already exists on the other side with
  what will happen to it. Two projects with the same name are kept side by
  side and never merged into one — combining two projects' settings and
  comments is not something that can be taken back.
- **Nothing moves until it is really on your Mac.** iCloud keeps files you
  have not opened in a while in the cloud, leaving only a stand-in on disk.
  Moving one of those is how a file gets lost, so Notesage fetches them all
  first and will not start until they have arrived — with progress, and a way
  to stop waiting and see which ones are holding things up.
- **Move it back.** Every move can be undone, and the offer is still there the
  next morning — not only while the window is open. Moving back puts every
  file where it was; anything you have changed since stays as it is now.
- **Your other devices follow.** A Mac or iPhone that finds the library has
  moved simply uses the new place. No setting to change, no folder to pick,
  nothing to confirm.

### Improvements

- **Settings says where your synced library actually is** — the place and the
  full path, under Settings → Projects → Library. Worth having now that there
  is more than one place it can be.

## Under the hood

- #943, phase 2 of PRD `2026-09-05-icloud-container-library`. Both roots can
  exist at once, so `<root>/.notesage/library.json` decides which is live
  rather than the directories; `resolveSyncedLibraryRoot` applies four
  branches at every launch and neither the resolved path nor its kind is
  persisted, because a remembered root is a lie the moment another device
  moves the library. Following a migration is unflagged; performing one is
  behind `icloud-container-library`.
- Everything the move depends on fails CLOSED — listing either root, the
  `.notesage` project check, the evicted-file walk, the comments directory.
  Each of those once failed open, and each produced the same shape of
  disaster: an unreadable library indistinguishable from an empty one, a
  "successful" run that moved nothing, and the app pointed at an empty folder
  for ever after.
- Both roots are locked for the duration (`library-lock.ts`): there is no
  natural quiescence, `write_file` creates a missing file rather than failing,
  and the stored absolute paths are only rewritten after every move — so an
  autosave landing mid-run would recreate a note at the abandoned root with
  the newest edit in it. The migration's own writes use separate entry points
  rather than an exemption flag.
- Materialise-first and undo-by-inversion are designed in
  `docs/design/migration-safety.md`, including why copy-verify-finalize and a
  zip snapshot were both rejected — the second because an archive round-trip
  drops creation dates and rounds mtime, and Notesage sorts by those.
- Six review rounds. The last three found bugs the first three did not,
  each from a new angle rather than more reading: driving the migration
  through the real app found that `write_file` does not create parent
  directories (the rehearsal's fake did, and hid it); asking "is this like the
  per-project sync?" found an AI lock that silently stopped enforcing and a
  path rewrite with no boundary check; and writing the dialog's first tests
  found a refusal screen that could not be reached and a report whose lines
  rendered without their subject.
- The real-E2E migration spec had never actually passed in CI — it needs a
  throwaway library root the Rust guard will accept, and nothing wired one.
  `run-real-e2e.sh` now creates and exports it, and takes `--spec=<name>`.

## Files Changed

- 41 files across 1 squashed commit (+7176 / −58), of which about 2,800 lines
  are tests: 13 real-E2E cases, a rehearsal suite against a real filesystem,
  and the dialog's own phase-machine tests.
