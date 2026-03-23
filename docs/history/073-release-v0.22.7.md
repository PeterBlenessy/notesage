# Release v0.22.7

**Date:** 2026-03-21 **Previous version:** 0.22.6

## Changes

### Features

- **Kernel-enforced network deny (Seatbelt):** Replace `(allow network*)` with `(deny default)` + proxy-port-only allows. Agents physically cannot bypass the HTTP proxy, even if they ignore `HTTP_PROXY` env vars. Based on Anthropic sandbox-runtime pattern. Configurable per connection via "Kernel enforcement" toggle.
- **Seatbelt violation monitoring:** Stream macOS unified log for sandbox deny entries, filter by agent PIDs, deduplicate within 5s windows, surface as error entries in the Activity panel alongside tool calls and domain approvals.
- **Debug-level proxy logging:** CONNECT and HTTP requests logged at debug level with domain, port, and agent ID. Enable via Settings &gt; Advanced &gt; Debug Logging.
- **Ephemeral sandbox profiles:** Profiles written to `$TMPDIR` instead of cached in `~/.notesage/sandbox/profiles/`. Cleaned up on agent exit. Legacy profiles directory removed on startup.

### Fixes

- **Sandbox toggle ignored for system-installed agents:** `sandboxEnabled` was never passed from frontend to backend for system-installed agents (claude, copilot). The UI toggle was cosmetic — agents ran unsandboxed. Now correctly threaded through both interactive and task spawn paths.
- **Skill discovery infinite loop:** Extraction writes to `~/.notesage/skills/` triggered the file watcher, which triggered a rescan, which extracted again. Fixed with timestamp-based cooldown (2s) + stable dependency keys derived from provider:authMethod instead of full connection array.
- **Debug logging toggle not working:** `tauri-plugin-log` was initialized with `level(Info)` which filtered debug messages inside the plugin. Fixed: plugin accepts Debug, global `log::set_max_level` controls filtering at runtime.
- **Codex hanging after domain approvals:** Codex CLI uses `chatgpt.com` for API calls, not in the built-in allowlist. Added `chatgpt.com` and `*.chatgpt.com` to Codex default domains.
- **Missing** `/dev/null` **write access in sandbox:** Git failed with "could not open '/dev/null'" under sandbox. Added `/dev/null`, `/dev/tty`, `/dev/zero`, `/dev/random`, `/dev/urandom` to Seatbelt file-write allows.
- **Indexer processing non-content files:** File watcher sent chat-history.json and index.db to the SQLite indexer on every change. Added `is_indexable()` and `.notesage/` path guards to `reindex_file_in_db`.
- **File tree rename focus and Escape handling**
- **Date picker popover positioning near bottom of window**
- **Suggestion popup positioning, stacking, and Escape dismissal**
- **Full-width selection bars between block elements**
- **Actions dashboard not updating editor and not indexing new tasks**

### Improvements

- **Soft contrast theme mode** for reduced eye strain (Settings &gt; Appearance)
- **Per-tab undo/redo preservation** across tab switches via EditorState cache
- **Comment position sync** — positions survive document edits and tab switches
- **Research-to-PRD pipeline tracking** — standardized metadata tables across all 11 research docs
- **PRD and plan-tasks skills** updated to maintain research doc pipeline tables

## Files Changed

- 24 commits, \~50 files changed across sandbox hardening, editor fixes, and infrastructure improvements

## PRDs Completed

- [sandbox-hardening-macos](../prds/2026-03-21-sandbox-hardening-macos.md) — Kernel-level Seatbelt network deny + violation monitoring