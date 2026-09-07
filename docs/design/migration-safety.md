# Migration safety: materialise first, and undo by inversion

Design for two additions to the iCloud container migration
(PRD `docs/prds/2026-09-05-icloud-container-library.md`, phase 2). Neither
changes the migration algorithm; both sit around it.

## Why

The migration moves every file someone owns, re-uploads the library through
iCloud, and cannot be undone. Five review rounds, a filesystem rehearsal and a
real-app E2E run established that the algorithm is sound in the shapes we can
test. Two gaps remain, and they are different in kind:

| Gap | Consequence | Closed by |
| --- | --- | --- |
| iCloud evicts a file between the guard and the rename | **Bytes destroyed.** The stub moves to a container that does not own its content, and the owner may purge it. | Materialise first |
| No way back from a *successful* migration | The result is wrong and there is nothing to return to. | Undo by inversion |

The first is the only path to true data loss the review found. The second is
not about failure at all — the migration can do exactly what it promised and
still leave someone wanting out.

## Why not the alternatives

**Copy-verify-finalize** (copy everything, validate, delete originals only on
confirmation) was considered and rejected. It buys a real undo, but:

- it is a rewrite of the runner, which is precisely the code that five review
  rounds and the E2E suite are *about*. New code resets that to zero, and this
  feature has produced a finding at every new angle taken at it;
- `rename` is atomic and copy is not, so it introduces torn files as a new
  failure mode;
- it needs 2× disk during the window, on a machine that may already be short —
  which is exactly when iCloud evicts, the risk being mitigated.

**A zip snapshot** was considered and rejected, for a reason that only showed
up when measured: a zip round-trip stores mtime at whole-second granularity
and drops creation dates entirely, so restoring from it would flatten the
library's history. `rename` preserves both by construction — same inode — and
Rust's `fs::copy` preserves both on macOS too (it clones via APFS rather than
looping bytes). Any archive-based path would have to re-apply timestamps by
hand, and getting that wrong is invisible: the bytes verify, and the whole
library silently reads as modified today. Notesage sorts and groups by that
date.

## Materialise first

A pre-flight, before the plan is shown.

1. Walk both roots for `.icloud` placeholders.
2. For each, call `icloud_ensure_downloaded` and wait for the file to appear.
3. **Refuse to start** while any placeholder remains, naming the files.

This removes the race rather than narrowing it: with nothing evicted, there is
nothing for the guard to miss between its check and the rename. The existing
guard stays — it is the backstop for anything evicted *during* the run.

It needs a progress indication and a cancel: on a large library over iCloud
this can take a long time, and a modal spinner with no way out is its own
failure.

## Undo by inversion

The migration already knows what it did. The undo is the same plan, reversed.

**Invertible today.** `move` and `rename-conflicting-project` — the bulk of a
library. The old root is empty of them by definition, so moving back cannot
collide.

**Not invertible today**, and what each needs:

| Step | Why it does not invert | Fix |
| --- | --- | --- |
| `merge-folder` | Children are moved individually into a folder that already had contents. Only *renamed* children are recorded, so an undo cannot tell which files came from the old root. | Record every move, not only renames. |
| `merge-pins`, `merge-reading-progress` | The destination's own copy was overwritten by the merged result. | Stash the destination's pre-merge content. |
| `drop` | `sync-settings.json` is deleted outright. | Stash it. |

The record is therefore: every move as `from → to`, plus a few small stashed
files. Kilobytes, whatever the library's size.

### Where it lives

Not in either root — both are moving. It goes in the app's own data directory,
keyed by migration id, and survives a restart: the moment someone notices
something is wrong is more likely to be the next morning than the next minute.

### What undo is

Undo is itself a migration. It takes the same library lock, applies the same
fail-closed checks, and runs the same verification pass afterwards. It can
partially fail, and reports that the same way. It also clears `migratedFrom`
from the marker and inverts the stored path rewrites, or the app follows a
container the files have just left.

### What undo is not

**It is not a backup.** It reverses what the migration did. It cannot help if
bytes were destroyed in the cloud, or if something outside the app changed a
file. Materialise-first is what closes that; the undo closes regret.

## Order of work

1. Record every move (foundation — the undo cannot be built without it).
2. Stash the destructive bits.
3. Persist the undo record outside both roots.
4. The undo itself, and its entry point in the report.
5. Materialise-first pre-flight, with progress and cancel.
6. A rehearsal case asserting timestamps survive — the regression that would
   otherwise ship in silence.
