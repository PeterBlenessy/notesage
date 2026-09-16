# Release v0.60.0

**Date:** 2026-09-16
**Previous version:** 0.59.0

Moving files where you meant to put them, and a preview that shows the article
rather than its source.

## Changes

### Features

- Drag a file onto any folder to move it — a sub-folder, a project, a folder
  in the sidebar. Folders can be dragged too.
- "Move to…" in the right-click menu now opens into sub-folders instead of
  listing only top-level ones.
- Saved web pages preview as the article, with their pictures, instead of as
  raw HTML.

### Fixes

- Moving or renaming a folder left open tabs, recent files and pinned items
  pointing at the old location. They follow it now, contents included.
- A pinned file that was moved or renamed kept a dead link in the sidebar.
- Read times on short saved articles were wrong: something you were a third
  of the way through still claimed the whole length remained.

### Improvements

- Security: updated a networking component used for every HTTPS connection
  the app makes. No action required.

## Under the hood

- `useFileOperations.renamePath` — the one primitive behind the sidebar's
  rename and "Move to…", the Inbox drop, "File to…" and `e` — called
  `renameTab` (exact path match) rather than `renameOpenDocument` (prefix
  cascade), so a folder move stranded every descendant's tab, recent entry and
  scroll position. Pins had no rename path at all, though `deletePath` twenty
  lines below cleans them prefix-aware.
- `SidebarContextMenu` built a `tree` for every move destination and never read
  it; one recursive renderer replaced four flat blocks.
- Folder drags carry their own MIME so `PinnedSection`, which renders every row
  as a file, keeps refusing them by type.
- `FilePreview` renders HTML through DOMPurify, bounded by rendered text rather
  than by lines — a capture is effectively one line, so line-slicing kept the
  whole document.
- rustls 0.23.40 → 0.23.45 (RUSTSEC-2026-0285), shipped in v0.59.0 but not
  described in its notes, which were written before the advisory existed.
- The CI dependency audit is renamed from "(advisory)" to what it is: blocking
  since 2026-07-05. The stale label cost a release — see the job's comment.
- `docs/performance-baseline.md` gains a v0.59.0 startup entry, with two
  anomalies recorded rather than smoothed: `phase2-extract` at 18× against 5×
  the skills, and `[perf:tree] refresh` reporting all zeros.

## Files Changed

- 25 files across 3 commits (#1039, #1040, and this release).
