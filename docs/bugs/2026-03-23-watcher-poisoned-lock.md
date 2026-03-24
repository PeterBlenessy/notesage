# Bug: Index and watcher mutex poisoning causes cascading failures

|  |  |
| --- | --- |
| **Date observed** | 2026-03-22 (dev), 2026-03-16 (production) |
| **Status** | Partially mitigated, not fixed |
| **Severity** | High |
| **Impact** | Breaks actions dashboard, causes unbounded log/store growth, degrades watcher |
| **Versions affected** | v0.21.0 → v0.22.10 (current) |

## Symptoms

### Production (v0.21.0 → v0.22.10, laptop)

1. **Actions dashboard broken:** `fullScan()` fails on every call with "poisoned lock: another task failed inside" — retried every \~1 second by the frontend, producing hundreds of ERROR log lines per minute (observed: 250+ errors in 2 minutes on v0.21.0)
2. **Index lock permanently poisoned:** After `lock_or_recover()` was added (v0.22.x), lock is recovered on access but WARN fires on every single lock acquisition — hundreds per session
3. **Action store unbounded growth:** `notesage-action-store` grows \~1KB per reindex cycle (232KB → 255KB in one session), likely duplicate entries accumulating
4. **OneDrive file reindex loop:** `w26-13.md` on OneDrive is reindexed every 2-3 seconds with a new hash, triggering watcher → reindex → action scan loops continuously

### Dev (v0.22.x, dev machine)

5. **Watcher stops emitting frontend events:** External file changes not detected, sidebar doesn't update. App restart restores behavior.
6. **Self-write suppression after poison:** `self_writes` HashMap may be inconsistent after recovery, causing legitimate external changes to be falsely suppressed

## Timeline from production logs

```
[2026-03-16][16:13:43] Notesage starting up (version 0.21.0)
[2026-03-16][16:15:23] ERROR Failed to initialize index "poisoned lock: another task failed inside"
[2026-03-16][16:15:23] ERROR Full scan failed "poisoned lock: another task failed inside"
  ... repeats every ~1 second for the rest of the session (lines 243-494+) ...
[2026-03-16][16:17:59] WARN  Reader timeout — checking process health  (Copilot LSP, unrelated)
```

After upgrade to v0.22.x with `lock_or_recover()`:

```
[2026-03-24][10:01:21] WARN  Recovering from poisoned lock
[2026-03-24][10:01:21] DEBUG Indexing w26-13.md (hash new → 90ff2a9e)
[2026-03-24][10:01:22] WARN  Recovering from poisoned lock   (x2)
[2026-03-24][10:01:31] WARN  Recovering from poisoned lock
[2026-03-24][10:01:31] DEBUG Indexing w26-13.md (hash 90ff2a9e → 2204dd90)
  ... same file reindexed every 2-3 seconds, lock recovered each time ...
[2026-03-24][10:28:24] store_write: 'notesage-action-store' (255892 bytes)   ← growing
```

## Root cause analysis

### What poisons the lock

The initial panic is not captured in logs. It occurs during `init_project_db()` or `index_directory()` at startup. Candidates:

- **SQLite open/migration failure** on a cloud-synced path (OneDrive or iCloud) — e.g., file locked by sync agent, corrupt WAL
- **Thread panic in watcher callback** — the `notify` debouncer callback runs on a dedicated thread; a panic there poisons any mutex held at the time
- **Concurrent access** between watcher callback thread and Tauri async command threads accessing the same `IndexState` mutexes

### Why the lock stays poisoned forever

`std::sync::Mutex` marks itself as poisoned when a thread panics while holding the guard. `lock_or_recover()` returns the inner data via `poisoned.into_inner()`, but **does not clear the poison flag** — every subsequent `.lock()` call still returns `Err(PoisonError)`, triggering the warn log on every access for the rest of the process lifetime.

### Why the OneDrive file keeps reindexing

The file `w26-13.md` on OneDrive gets a new hash every 2-3 seconds. This is likely OneDrive's sync agent modifying file metadata or extended attributes, which triggers the filesystem watcher, which triggers reindex, which finds a "changed" hash. This creates an infinite loop of: watcher event → reindex → action scan → store write → repeat.

### Index databases are local (confirmed)

All index DBs are correctly stored on local filesystem:

- Global: `~/.notesage/index.db`
- Per-project: `~/.notesage/indexes/<hash>/index.db`
- Old `<project>/.notesage/index.db` files are migrated (deleted) on first access

The **source files** being indexed may be on cloud drives (iCloud, OneDrive), but the SQLite databases themselves are local. The issue is not DB corruption from cloud sync — it's that cloud-synced source files trigger excessive watcher events.

## Affected files

- `src-tauri/src/index/mod.rs` — `IndexState` uses `std::sync::Mutex` for `global_db`, `project_dbs`, `reindex_queue`, `processing`
- `src-tauri/src/commands/watcher.rs` — `WatcherState` uses `std::sync::Mutex` for `watcher`, `watched_paths`, `self_writes`
- `src/stores/action-store.ts` — `fullScan()` calls `indexTasks`/`indexGoals` which hit the poisoned lock
- `src/hooks/useActionScanner.ts` — triggers `fullScan()` on startup and on file-changed events

## Proposed fixes

### P0: Prevent the poison from persisting

1. **Switch to** `parking_lot::Mutex` — does not poison on panic, drop-in replacement. This eliminates the entire class of poisoning bugs. (\~30 min change)
2. **Or: wrap indexer operations in** `catch_unwind` — prevent panics from propagating to the mutex holder

### P1: Stop the cascading failures

3. **Circuit breaker for reindex loops** — if the same file is reindexed more than 3 times in 30 seconds, skip it and log once. Prevents OneDrive/iCloud sync churn from flooding the system.
4. **Rate-limit** `lock_or_recover` **warnings** — log at most once per minute per mutex, not on every access
5. **Deduplicate action store entries** — `fullScan()` should dedup by ID before persisting, and the store write should be debounced

### P2: Improve diagnostics

6. **Log the initial panic** — wrap `init_project_db()` and `index_directory()` in `catch_unwind` with error logging before the panic propagates
7. **Add** `watcher_alive` **to health check output** — production health checks don't currently report watcher state accurately

## Also observed

- `database is locked` SQLite errors during concurrent watcher events — separate concurrency issue
- Copilot LSP `Reader timeout` warnings during idle periods — unrelated, cosmetic
- HF API `401 Unauthorized` warnings — model metadata fetcher lacks auth token, cosmetic