# Bug: New tags and mentions not picked up immediately

|  |  |
| --- | --- |
| **Date** | 2026-04-10 |
| **Severity** | Low |
| **Status** | Fixed |
| **Affects** | Tag badges, mention badges, command palette search (#, @) |
| **Recurring** | Yes — this issue has been reported and fixed multiple times before |

## Problem

When a user types a new `#tag` or `@mention` in a document, it is not immediately reflected in:
- Tag/mention autocomplete suggestions
- Command palette search (Cmd+3 for tags, Cmd+2 for mentions)
- Tag badge decorations (may require a re-render)

The new tag/mention only appears after a delay, tab switch, or app restart.

## Expected behavior

New tags and mentions should be indexed and searchable within seconds of being typed, without requiring manual intervention.

## Likely cause

The SQLite document index (`src-tauri/src/index/`) updates incrementally via the filesystem watcher. The reindex pipeline depends on:
1. File being saved to disk (auto-save on 1s debounce)
2. Watcher detecting the change (500ms debounce)
3. Content hash comparison (skips reindex if unchanged)
4. Index query cache invalidation

Any delay or failure in this chain causes stale results. Previous fixes have addressed:
- Reindex queue not draining after save
- Self-write suppression preventing reindex
- Watcher events being filtered incorrectly

## Previous fix (dc340ac, 2026-04-07)

The reindex queue drain was moved outside the `if !batch.is_empty()` block in `watcher.rs:221`, so `process_reindex_queue()` now runs unconditionally. This fixed the primary bug where self-write-only batches left the queue undrained.

See also: `docs/bugs/2026-04-07-tag-indexing-architecture-analysis.md`

## Remaining failure modes (analysis 2026-04-10)

Despite the queue drain fix, the user reports tags/mentions still don't work reliably on a second laptop after updating. The indexing pipeline has several secondary failure modes:

### 1. Explorer folders are intentionally NOT indexed

`index_init` only scans projects and `~/Notesage`. Explorer folders are excluded by design — this is a data security decision (users may open arbitrary system directories; indexing them would persist their content in our SQLite databases). Tags/mentions in explorer folder files will not appear in autocomplete or command palette search. This is expected behavior, not a bug.

### 2. Parser changes across versions not detected ✅ Fixed

`reindex_file_in_db` compares content SHA-256 hash to skip unchanged files (line 186). After an app update that changes the tag/mention parser (`parser.rs`), files that haven't been edited won't be re-parsed. Stale index entries persist.

- **Location:** `mod.rs:175-188` — content hash comparison
- **Impact:** After an update with parser improvements, existing tags might be missing or wrong until files are edited
- **Fix:** Added `PARSER_VERSION` constant in `db.rs`. On startup, `open_or_create` compares stored vs current parser version. If mismatched and DB has data, `clear_all()` wipes indexed data so the next `reindex_directory` rebuilds from scratch. Handles old DBs without the column via `ALTER TABLE ADD COLUMN`. 3 unit tests added.

### 3. Silent failure if index init errors

If `indexInit()` throws during startup, the error is caught at `useAppLifecycle.ts:452` and logged, but `startupReady` is still set at line 458. Watchers start, queue reindex entries, but `process_reindex_queue` silently drops them because `get_db_for_path` returns `None` (no DB was initialized).

- **Location:** `useAppLifecycle.ts:432-458`, `reindex_queue.rs:94` — `get_db_for_path` returns None
- **Impact:** Complete indexing failure with no user-visible error
- **Fix:** Either block `startupReady` on index success, or show a toast/banner when index init fails

### 4. Watcher not running during startup

Watchers are gated behind `startupReady` (`useStartWatchers.ts:21`). If the user types a tag and saves before startup completes, the watcher won't detect the save. The startup `reindex_directory` will eventually scan the file, but only when it reaches that file in the sequential scan order.

- **Impact:** Tags typed during startup may not appear in autocomplete for several seconds (until the startup scan reaches that file)
- **Severity:** Low — startup typically completes in 1-4 seconds

### 5. Self-write TTL on slow/cloud storage

The 5-second self-write TTL (`watcher.rs:26-30`) covers macOS FSEvents debounce + re-reporting + iCloud latency. On slower cloud storage (OneDrive, Google Drive, network mounts), additional FSEvents may arrive after the TTL expires. These would be treated as external changes, NOT queued for reindex (they'd go to the frontend batch instead). However, reindex still happens because self-write events ARE queued for reindex before the self-write check.

Wait — let me re-read the watcher code. Actually, ALL events (self-write or not) are queued via `queue_reindex` at line 196-203 BEFORE the self-write check at line 207. The self-write check only filters the FRONTEND batch. So reindex is not affected by self-write TTL. This failure mode is NOT real for indexing.

- **Correction:** Self-write TTL only affects frontend `file-changed-batch` events, not reindexing. Reindex queue is populated unconditionally.

### 6. DB locking under concurrent load

SQLite busy timeout is 5s (`db.rs:23`). During a large startup scan, the write lock is held while processing files sequentially. WAL mode allows concurrent reads, so tag queries should work. However, if watcher-triggered reindex (`process_reindex_queue`) runs concurrently with a startup scan's `reindex_directory`, both attempt writes and one may hit the busy timeout on a slow disk.

- **Impact:** Rare, only on very slow storage with large projects
- **Severity:** Low

## Recovery guidance

If tags/mentions don't work after an update:

1. **Quick fix:** Delete index files and restart:
   ```
   rm -rf ~/.notesage/indexes/
   rm -f ~/.notesage/index.db*
   ```
2. **Check logs:** Look for "Failed to initialize index" or "Index initialization panicked" in the console
3. **Force rebuild:** Settings > Advanced > Rebuild Index (if available), or restart the app

## Key files

- `src-tauri/src/index/mod.rs` — indexing pipeline, reindex triggers, `index_init` command
- `src-tauri/src/index/db.rs` — schema creation, `open_or_create`, content hash comparison
- `src-tauri/src/index/reindex_queue.rs` — queue processing, circuit breaker (5 per 30s)
- `src-tauri/src/commands/watcher.rs` — filesystem watcher, self-write filter, unconditional queue drain
- `src/hooks/useAppLifecycle.ts` — startup sequencing, index init, startupReady gating
- `src/hooks/useStartWatchers.ts` — watcher startup (gated on startupReady)
- `src/components/editor/extensions/tag-suggestion.tsx` — tag autocomplete (queries index)
- `src/components/editor/extensions/mention-suggestion.tsx` — mention autocomplete (queries index)
