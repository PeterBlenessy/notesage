# Release v0.55.3

**Date:** 2026-08-31
**Previous version:** 0.55.2

Saved articles show up in your Inbox on their own, sharing a page that turns
out to have no article in it now says so instead of saving the small print, and
agents that quietly ignore attached files are caught.

## Changes

### Fixes

- **Captured articles appear on their own.** An article shared from Safari or
  your phone did not show up in the Inbox until you refreshed the folder by
  hand. It appears by itself now. The same fix covers a file renamed outside
  Notesage, which also used to leave the sidebar showing the old name.
- **Sharing a page with no article in it no longer saves the small print.**
  Some pages — a topic hub, a list of links, a video index — have no article on
  them at all. Sharing one used to save the page's legal disclaimer, complete
  with the right title and a picture, so it looked like a real capture until you
  read it. Notesage now notices and saves a plain link instead, which is honest
  about what it is.
- **Saving a file can no longer block its own name.** If a capture failed to
  write, it left an empty file holding the name, so the next capture of the same
  article was saved as "…-1" and the one after that as "…-2", for good.
- **A file share can no longer hang the share sheet.** Choosing a name for a
  saved file could search forever in a folder that already held a great many
  similarly named files, leaving the sheet spinning with no way out.

### Improvements

- **You are told when an agent ignores a file you attached.** Attaching a file
  to a custom AI agent relies on the agent choosing to read it, and one that
  does not simply answers as though it had — no error, nothing to notice. When
  you add a custom agent, Notesage now checks, and warns you if you attach a
  file to one that will not read it.

## Under the hood

- **#788.** Captures land via `NSFileCoordinator .forReplacing`, which is
  atomic: the bytes are staged and RENAMED into place. `notify` reports that as
  `Modify(Name(Both))`, which `process_watcher_events` routes to `file-renamed`
  and excludes from `file-changed-batch` — so the create-driven refresh never
  ran. `useFileRenameSync` refreshed for folder renames but not file renames.
  Now refreshes both parents, per-directory debounced at 300 ms to match
  `useFileWatcher` (a bare refresh is ~2 s on iCloud).
- **#783.** Five iOS name-pickers looped unbounded where macOS bounds at 999
  (the issue counted four; `writeXCapture` was missed). All now route through
  `claimName`, which is bounded AND claims atomically — macOS's note path had
  kept check-then-use `dedupedURL` before a `.forReplacing` write. Review
  follow-up: all six writers now remove the placeholder when the write fails,
  as `saveDocuments` already did.
- **#807.** Root cause was not timing or scoring: the pages are topic hubs with
  no article, and readability correctly picked the densest prose, which was
  boilerplate. Mozilla's `isProbablyReaderable` was tested against the live page
  and returns readerable, so it would not have caught this either. The gate now
  asks the page's own `og:type` / JSON-LD, and judges boilerplate by WHERE it
  starts — a body that is boilerplate opens with it; an article merely ends with
  a footer. `MIN_ARTICLE_CHARS` is a floor again, not the decision.
- **#815.** `ContentBlock::ResourceLink` has no capability gate, resting on the
  spec's "all agents MUST support resource links". A new smoke-test stage
  attaches an unguessable token and checks it comes back; only a substantive
  answer WITHOUT the token is a failure, mirroring the permission probe. Runs in
  the background at registration (awaiting it added minutes to "Add
  Connection"), `custom_acp` only, with `Drop`-guarded cleanup of the temp file
  and the event listener.
- **#736.** Nine order-dependent test failures across eight files, every cause
  different — module state, persisted stores missing from a file's reset, a
  `document.body` live region outliving its test, `clearMessages()` deleting
  only the active conversation, two test-vs-component races, `vi.spyOn`
  returning the existing mock with its history, and a one-shot flag left set by
  a test that stops mid-gesture. Green under three seeds.
- Code review of this batch found four defects in the new code — the placeholder
  litter above, a `slice`/`substring` sign bug, a missing debounce, and a
  boilerplate gate that would have rejected real articles. All fixed and
  mutation-tested.

## Files Changed

- 23 files across 5 PRs (#822, #823, #824, #825, #826)
