# Release v0.22.9

**Date:** 2026-03-23
**Previous version:** 0.22.8

## Changes

### Features

- **Tool call path filtering for delegation sandbox:** Agents in comment chat and background tasks are now restricted to the document's project folder. Tool calls targeting files in other projects are denied at the ACP permission layer. Structured tools (Read, Write, Glob, etc.) and terminal commands with absolute paths are checked. System paths, agent config dirs, and in-project paths are always allowed. 52 unit tests cover the path filter logic.
- **Per-project task agent respawn:** The task agent tracks which project it was spawned for and respawns when the project changes, ensuring correct sandbox scope per delegation.
- **Comment-to-chat path filtering:** When a comment conversation is moved to the chat panel, path filtering carries over — the chat agent inherits the source project's restriction.
- **Link button in editor toolbar:** New link/unlink button after the Code button. Popover with URL input, auto-prepends `https://` when no protocol specified. Shows Unlink icon when cursor is on a link.

### Fixes

- **Heading dropdown not updating:** The block type dropdown in the toolbar now reflects the current heading level when the cursor moves. Previously it only updated on re-render, not on selection changes.
- **Comment popover dead state after stopping agent:** Stopping an agent during chat mode set the comment status to "open", but the reply input requires "done" status. Comments with existing replies had no interactive UI after stopping. Now correctly sets status to "done" when replies exist.
- **Comments stuck as "delegated" after restart:** Comments with "delegated" status persisted to disk but agent sessions don't survive restart. On load, "delegated" comments are reset to "done" (if replies exist) or "open".
- **ACP rawInput serialization:** ACP tool calls send `rawInput` as an object, not a string. Now JSON.stringify'd before path extraction so the filter can parse it.
- **Chat auto-scroll:** Reworked with MutationObserver for reliable scrolling during async content rendering.
- **ACP session recovery:** Added health check, auto-retry on connection errors, and friendly error messages for dead agents.

### Improvements

- **Chat context pills:** Attached files shown as pills above the chat input for visibility.
- **Domain list UI:** Unified domain allowlist with API/Telemetry/User labels in connection settings.
- **Delegation toast refinement:** "Agent finished" toast only in delegate mode, "Agent stopped" instead of "Delegation cancelled" in chat mode.

### Documentation

- Delegation sandbox enforcement PRD complete with all 11 quality gates passed
- Watcher poisoned lock bug documented in `docs/bugs/`

## Files Changed

- 31 commits, touching hooks, stores, components, Rust commands, and documentation
