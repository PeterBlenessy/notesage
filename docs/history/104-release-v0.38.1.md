# Release v0.38.1

**Date:** 2026-04-20
**Previous version:** 0.38.0

Completes the project isolation work from v0.38.0. No breaking changes — every new gate has an opt-out setting.

## Changes

### Features

- A file tab outside your selected projects is no longer auto-attached to chats. An "Add this file to chat" chip appears next to the input so you can opt in explicitly
- Attachments you send with a chat message are now visible in the activity panel with a paperclip icon and a full-path tooltip, so you can audit what got shipped to the provider after the fact

### Improvements

- The workspace overview Notesage injects into AI prompts now stays within your selected projects (capped at 200 files / 4 directory levels). Filenames from unselected projects no longer appear in the model's context
- Switching projects while an agent is responding now cleanly cancels the in-flight turn and clears any pending permission prompts. No more stale prompts from an agent that's been restarted

### Fixes

- Conversation branching after a "Start fresh" provider switch now correctly slices history based on the branch's own thread, not the full conversation length

## Under the hood

Follow-up release that closes out the project-data-isolation PRD: tasks #23, #27, #28, #29, #30, plus the red-team verification pass (#32) and a full documentation sweep (#33). No Critical or High finding from the 2026-04-18 isolation audit remains reproducible.

See `docs/audits/2026-04-20-red-team.md` for the red-team pass.

## Files Changed

27 files changed, +1,984 / −91 across 7 commits. 3,106 unit tests passing, 28 sandbox tests passing, all performance benchmarks within budget.
