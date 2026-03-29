# Bug: External file changes not always detected and loaded

|  |  |
| --- | --- |
| **Date observed** | 2026-03-29 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Impact** | Documents modified externally (by AI agents, other editors, or CLI tools) may not update in the editor |
| **Versions affected** | v0.25.0 |
| **Reproducibility** | Intermittent |

## Symptoms

1. A file open in the editor is modified externally (e.g., by Claude Code writing PRD files)
2. The editor does not always detect the change and reload the content
3. The user sees stale content until they manually switch tabs or reopen the file

## Additional finding: New files not appearing in file tree

Files added externally to projects open in the sidebar (e.g., creating a new PRD via CLI or AI agent) are not detected and listed in the file tree. The user must manually collapse and re-expand the folder, or reopen the project, to see the new files.

## Related: SQLite index database locked

When many files change rapidly (e.g., batch file creation), the SQLite document index fails with a locking error:

**Toast notification:** "File indexing failed — search may be incomplete"

**DevTools log:**

```
[Warning] Failed to index file /Users/peter/Development/note-sage/docs/prds/2026-03-29-drawing-canvas.md:
"Failed to insert file: database is locked" (useFileOperations.ts, line 238)
```

This suggests concurrent index writes are contending on the SQLite connection, likely from multiple watcher events firing in quick succession.

## Root causes found

1. **Duplicate event processing** — The frontend listened to both `file-changed` (per-event) and `file-changed-batch` events from the Rust watcher. Every watcher event was processed twice, causing debounce timers to reset and race conditions in modify handling.
2. **Duplicate indexing creating lock contention** — The Rust watcher callback already reindexes files via `queue_reindex` + `process_reindex_queue`. The frontend ALSO called `tauriApi.indexFile()` for the same events, creating concurrent writes that contended on the SQLite connection.
3. **No SQLite busy timeout** — The SQLite connection had no `busy_timeout` configured. When concurrent index writes contended on the lock, the second writer failed immediately with "database is locked" instead of retrying.

## Fixes applied

1. **Removed per-event `file-changed` listener** — Frontend now only listens to `file-changed-batch` (deduplicates by path). Removed per-event emission from Rust backend too.
2. **Removed frontend `indexFile` calls** — Reindexing is handled entirely by the Rust watcher callback. Removed redundant `tauriApi.indexFile()` calls for both create and modify events.
3. **Added SQLite `busy_timeout(5000ms)`** — In `db::open_or_create`, concurrent writers now retry for up to 5 seconds instead of failing immediately.
4. **Migrated `useActionScanner`** — Also used per-event `file-changed`; migrated to `file-changed-batch`.

## Key files

- `src-tauri/src/commands/watcher.rs` — filesystem watcher, debounce, self-write filter
- `src/hooks/useFileWatcher.ts` — frontend event handler for `file-changed-batch` events
- `src/hooks/useActionScanner.ts` — action scanner migrated to batch events
- `src-tauri/src/index/db.rs` — SQLite connection with busy_timeout
- `src-tauri/src/index/mod.rs` — indexing pipeline
- `src/hooks/__tests__/useFileWatcher.test.ts` — updated tests