# Release v0.22.2

**Date:** 2026-03-17
**Previous version:** 0.22.1

## Changes

### Fixes
- **Index DB moved to local storage** — per-project index.db relocated from `<project>/.notesage/index.db` to `~/.notesage/indexes/<hash>/index.db`. Prevents iCloud sync corruption from multi-device SQLite writes. Old DB files cleaned up automatically on startup.
- **llama-server sidecar resolution** — Tauri v2 externalBin keeps the target triple suffix at runtime (`llama-server-aarch64-apple-darwin`). The bundled sidecar was invisible in production because the code only looked for the plain name. Now checks both.
- **Index transaction safety** — SAVEPOINT wraps each file's indexing so partial failures (e.g., tag INSERT after file INSERT) roll back cleanly instead of leaving stale hashes that block future re-indexing.
- **Missed INSERT OR REPLACE** — second INSERT for non-markdown files now uses UPSERT, eliminating remaining UNIQUE constraint errors.

### Features
- **Incremental indexing** — tags, mentions, and FTS updated on every file save and watcher modify event (200ms debounce). Previously only indexed on app startup.

### Improvements
- **Dictation diagnostic logging** — debug-level logging at each pipeline stage (buffer, RMS, whisper segments, hallucination filter) for diagnosing production failures.
- **Index debug logging** — hash checks, parse results (tag/mention counts), and failure details logged at debug level.

## Files Changed
- 5 files changed across 2 commits
