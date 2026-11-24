# Release v0.63.0

**Date:** 2026-11-24
**Previous version:** 0.62.0

Notesage should feel fast again with a large library in iCloud and a full
Inbox. This release also finishes the second round of fixes from the November
review of the whole app.

The first time you open this version it reads through your library once to
rebuild its search index. After that, opening the app no longer re-reads files
that have not changed.

## Changes

### Improvements

- Opening the app no longer waits for your whole library to be indexed. You can
  start working straight away; search, tags and mentions fill in during the
  first moments if the index is still catching up.
- Files that have not changed are no longer read again every time the app
  starts, and files that iCloud has not downloaded yet are left alone instead
  of being fetched just to be indexed.
- The Inbox stays quick with hundreds of items. It only draws the items on
  screen, loads pictures and details as you scroll, and returns to where you
  were when you come back from reading an item.
- Filing or deleting several Inbox items at once happens in one go, and the
  items leave the list immediately.
- Saving no longer stalls while the app is indexing in the background.
- A file changing in one folder no longer makes the whole sidebar redraw, and
  no longer restarts your MCP servers.
- Search over saved web pages now matches the text you can read on the page,
  not its hidden markup.
- Many toolbar buttons, viewers and dialogs gained proper names and keyboard
  access for VoiceOver and keyboard users.

### Fixes

- Checklists could open as plain bullet lists and lose their ticks.
- The Inbox could show up as a project under Folders. It is a built-in part of
  the app and no longer appears there.
- Switching to another document, or closing one, within a second of typing
  could lose the last edit. The document is now saved first.
- Settings, drawings and typography could be overwritten with defaults when
  their file was damaged or failed to load once. The damaged file is now kept
  aside and you are told.
- Stopping an AI answer during its first moments could be ignored.
- Background AI tasks could run tools you had not approved. They now only use
  tools you have already allowed.
- The MCP server list could be wiped if its settings file had a typo in it.
- Search results, tags and mentions showed "nothing found" when the index could
  not be read. They now say that the index is unavailable.
- Git operations on a project could hang the app if git stopped responding.
- The search index kept old text after a file was edited, which made it grow
  and could return out-of-date matches.
- Further security fixes to how AI tools, MCP servers and agents are confined —
  no action required.

## Known limits

- These speed-ups were verified by tests that count the work done (files read,
  rows drawn, calls made), not by timing a real library. If the app is still
  slow for you, a launch log will show where the time goes.
