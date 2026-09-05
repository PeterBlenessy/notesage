# Inbox (desktop)

The phone's read-later list at desk width, with the one thing the phone
can't do well: filing. Same folder, same captures, same progress — the Mac
adds selection, keyboard, and drag-to-project.

## What it is

- **The folder.** `<library root>/Inbox` — where both share extensions land
  captures (`src/lib/inbox.ts` explains why the name is a literal). The root
  is the synced iCloud library (`settings.icloudNotesagePath`, the same root
  the pins file uses) when sync is on, else `settings.notesRootPath` expanded
  by `resolveNotesRoot` (`src/lib/notes-root.ts`), the one place its `~` is
  handled. `Recordings/` follows the same root rule (`recordingsDir`, same
  file) — the phone's recording bundles land beside the Inbox and the Mac's
  `useRecordingsInbox` scans them there (docs/features/ai-workflows.md
  § Meeting Recording).
- **A mode, not a document.** Quiet Composer is a single-document shell, so
  the list cannot be a tab beside the article it opens. `inbox-store.open`
  swaps the document column between `InboxView` and the editor
  (`QuietLayout.tsx`). Opening an item leaves the mode; so does any other
  document becoming active (the store watches `activeTabId`), and so does
  re-opening the file already active behind the list (`openFile` closes the
  Inbox itself, since that changes nothing the store could watch — v0.56.0
  left the list up in that case). The reader pill's "‹ Inbox" (or ⌘⇧I)
  returns to it.
- **The sidebar row.** `InboxSection` sits above Pinned, shown once the root
  is known and the folder has ever received something. Its badge is the
  unread count. The row only lists and renders — the first listing once the
  root resolves, then whatever the store holds.
- **The folder watch and "New in Inbox".** `useInboxArrivals`
  (`src/hooks/useInboxArrivals.ts`, mounted in `App.tsx`) watches `Inbox/`
  and reloads the listing on any change under it (not its `.notesage/`
  sidecar), 300 ms debounced. It lives at the app root, not in the sidebar
  row: the sidebar unmounts on ⌘⇧L, and a share landing while it is hidden
  must still be noticed (the always-mounted-listener rule). The same hook
  diffs the listing's names across loads: the first completed load for a
  root is the baseline — startup never announces a backlog, and the root
  resolving in two steps (local, then iCloud) starts a fresh baseline each
  time — and every later load that adds names produces **one** desktop
  notification through `notify("inbox_capture", …)`: title *New in Inbox*
  with the item's title as the body (the cached article header when known,
  else the filename stem) for one arrival; *3 new in Inbox* with the first
  two titles "and 1 more" for several. Gated on
  `settings.notifyInboxCaptures` (Settings → System → Notifications → "New
  Inbox items", default **on** — arrivals are rare and wanted) and
  suppressed while the window is focused *and* the Inbox view is open.
  Clicking the notification opens the Inbox and focuses the window
  (`extra: { inbox: true }` on the notification, the `onAction` pattern from
  `useSessionManager`). The Mac's own Share Extension captures are
  indistinguishable from the phone's on disk and are announced too — the
  desktop sheet closes at once, and "it landed" is worth one banner. PRD:
  `docs/prds/2026-09-05-ios-notifications.md`, "The Mac's side".

## The view

- **No header bar.** "Inbox · 12 items · 7 unread" is content, set like a
  document title. The controls — filter, List / Gallery, Condensed or the
  S / M / L card size, Mark all read — live in the same floating pill the
  viewers use (`ViewerToolbarPill`), top right so it never covers the title.
- **Rows** (`InboxRow`): unread dot · thumbnail · serif title · `site · 2 of
  4 min left` with a progress bar · two-line excerpt. Documents show their
  type instead of a reading time. Grouped by date with sticky headers
  (`inbox-grouping.ts`: Today · Yesterday · Previous 7 Days · months).
- **Gallery** (`InboxCard`): the same items and selection as cards, at three
  sizes. Layout, density and size are global preferences in settings-store
  (`inboxLayout`, `inboxCondensed`, `inboxGallerySize`).
- **Article headers** come from the capture's own masthead, read natively by
  path (`inbox_card_meta` → `notesage_capture::article_card_meta`), so a
  multi-megabyte capture never crosses IPC for four strings. `sourceUrl` is
  what "Open original" opens.
- **Thumbnails** (`src/lib/desktop-thumbnails.ts`): images through the asset
  protocol, PDFs through pdf.js, captures through the article's inlined lead
  image (`article_lead_image`, the same picture the phone shows). No
  QuickLook on the desktop, so other document types keep their icon.

## Triage

All verbs live in `useInboxActions` — the row's hover actions, the context
menu, the reader pill and the keyboard call the same functions.

| Verb | Where | Keys |
| --- | --- | --- |
| Open | double-click, ↩ | ↩ |
| File to the last-used project | hover button, menu, reader pill | `e` |
| File to… | menu submenu, **drag onto a project row** | — |
| Pin / Unpin | hover glyph, menu, reader pill | `p` |
| Move to Trash (recoverable) | hover glyph, menu | ⌘⌫ |
| Mark read / unread, Mark all read | menu, pill | — |
| Open original in browser | menu, reader pill | — |
| Move the cursor / extend selection | — | `j` `k` ↓ ↑, ⇧ to extend, ⌘A |
| Next / previous item while reading | reader pill hint | ⌘↓ ⌘↑ |

"File to Research" names the last destination so the common case is one key.
Until one has been chosen (File to… or a drop) `e` does nothing but say so —
it never guesses a project.
A dropped selection is the whole selection (`FILE_DRAG_PATHS_MIME` beside the
single-file payload; `droppedFilePaths` reads either). `ProjectRow` accepts
the drop and `ProjectsSection` moves the files through `fileTo`. Names are
deduped like the phone does (`name-1.ext`).

Deleting uses `trash_path` (the `trash` crate — Finder's Trash), never the
permanent `delete_path`: throwing away a read-later item must be as safe as
it is in Mail.

## Reading

Opening an item uses the viewers that exist. The only new chrome is the
reader's controls as the **leading slot of the column's pill**
(`PillLeadingContext`, consumed by `ViewerToolbarPill` and the editor
`Toolbar`'s pill variant): "‹ Inbox", `4 / 12` with a progress bar, File to
…, pin, open original, and the ⌘↑ ⌘↓ hint. A second pill would fight the
viewer's own; a full-width strip is what Quiet Composer does not have.

Progress is the scroll position of the viewer's tagged container
(`[data-doc-scroll]` on the HTML and PDF viewers' scrollers), sampled at most
every 250 ms and forward-only. The HTML viewer's iframe paths (scripts
enabled / unsafe preview) scroll inside the frame and are not observed.

## State lives with the folder

`Inbox/.notesage/reading-progress.json` (`src/lib/reading-progress-file.ts`),
the way a project keeps its metadata in its own `.notesage/`. iCloud syncs
dot-folders; Finder and Files hide them.

```json
{
  "version": 1,
  "items": {
    "Riksbanken lämnar räntan oförändrad.html": { "fraction": 0.48, "openedAt": "2026-09-02T21:14:07Z", "device": "Peter's iPhone" },
    "Reading on screens.html": { "fraction": 1, "openedAt": "2026-09-02T07:40:11Z", "speech": { "paragraph": 31 } }
  }
}
```

- Keyed by the item's name relative to the Inbox. Every entry carries
  `updatedAt`, the change time on the writing device.
- **Unread** = `openedAt` null (never opened on any device). **Finished** =
  fraction ≥ 0.97 (the phone's rule).
- Every write is read → merge → write, and the merge is safe in any order:
  progress is monotonic (larger fraction, earliest `openedAt`); **mark as
  unread** is a `resetAt` stamp that voids what either device recorded
  before it; trashing or filing writes a **tombstone** (`deleted`) that beats
  any live entry older than it — so the other device's copy cannot resurrect
  a removed item, and a capture re-shared under the same name starts unread
  because its first open is newer than the stone — and that new life carries
  the stone's time as `deletedAt`, so a third device's copy from before the
  deletion is still void when it rejoins. Tombstones and orphans older than
  30 days are pruned at write time (stamp-less pre-v2 entries are stamped
  first, so they get the same grace).
- Every precedence is a wall-clock comparison between devices; there is no
  logical clock. A device with a badly wrong clock can win or lose merges it
  should not — the known limit of this scheme. Its other edge: entries are
  keyed by filename, so a capture re-shared under a trashed name whose first
  open (on an offline device) predates the deletion reads as the old life and
  stays dead until it is opened again; the next open on that device heals it.
- Filing an item moves its live entry into the project's `.notesage/`
  sidecar and leaves a tombstone behind. The desktop writes coalesced
  (400 ms after the last change), serialised so bursts never interleave.
- **The phone** keeps its local store and treats it as a write-through cache
  (`src/lib/inbox-progress-sync.ts`): the sidecar's live entries are merged
  in whenever the Inbox is listed, and any change to an Inbox item's
  progress, listen position or first open marks it dirty and schedules one
  write of the dirty items, stamped with their change time. Only what the
  phone changed is ever written — its timestamp-free local store may still
  hold items the Mac trashed or reset. A Mac "mark as unread" reaches the
  phone as the entry's `resetAt`, applied once through a persisted ledger
  (#876, docs/features/mobile.md).

## Verification

`e2e-real/tests/inbox.test.ts` drives the real app through the sidebar
badge, the view, opening with the reader controls, filing with `e` (state
carried into the project's sidecar) and the Trash — on a throw-away library
under the OS temp dir, via `inbox-store.rootOverride`. It must never run
against the user's library; see the guard in the spec.

## Keyboard shortcuts added

`⌘⇧I` open / close the Inbox · `⌘↑` `⌘↓` previous / next item while one is
open (no-ops otherwise). See `docs/keyboard-shortcuts.md`.

## Key files

| File | Purpose |
| --- | --- |
| `src/stores/inbox-store.ts` | Mode flag, listing, sidecar state, headers, selection, file / trash |
| `src/components/inbox/InboxView.tsx` | The view: pill controls, groups, keyboard |
| `src/components/inbox/InboxRow.tsx`, `InboxCard.tsx` | Row and card |
| `src/components/inbox/InboxItemMenu.tsx` | Context menu |
| `src/components/inbox/InboxReaderControls.tsx` | Reader pill slot + scroll progress |
| `src/components/inbox/useInboxActions.ts` | The triage verbs |
| `src/components/inbox/pill-leading-context.tsx` | The pill's leading slot |
| `src/components/sidebar/quiet/InboxSection.tsx` | Sidebar row + badge (first listing; no watcher) |
| `src/hooks/useInboxArrivals.ts` | Always-mounted folder watch + "New in Inbox" notification + click-to-open |
| `src/lib/reading-progress-file.ts` | Sidecar format, parse / merge |
| `src/lib/inbox-progress-sync.ts` | The phone's write-through |
| `src/lib/desktop-thumbnails.ts` | Desktop thumbnail pipeline |
| `src-tauri/src/commands/preview.rs` | `article_card_meta`, `inbox_card_meta`, `article_lead_image` |
| `src-tauri/src/commands/file.rs` | `trash_path`; `list_files_shallow` now carries `modified` |
