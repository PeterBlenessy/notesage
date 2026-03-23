# Bug: File watcher stops emitting frontend events after poisoned lock

**Date observed:** 2026-03-22
**Status:** Observed, not yet fixed
**Severity:** Medium — watcher silently degrades during long sessions

## Symptoms

- Files modified externally (terminal, other editors, Claude Code) are not detected by the editor
- Open tabs don't reload when their files change on disk
- New files created externally don't appear in the sidebar
- App refresh (Cmd+R or restart) restores normal behavior

## Root cause (likely)

During a long dev session, a thread panicked while holding a `std::sync::Mutex` in the watcher or indexer subsystem. This poisons the mutex. Subsequent lock acquisitions go through `lock_or_recover()` which recovers the lock but the data inside (particularly the `self_writes` HashMap in `WatcherState`) may be in an inconsistent state.

The watcher callback in `watcher.rs` (line ~164) acquires `self_writes`, then for each event checks `is_self_write()` (line ~216). If the HashMap contains stale or corrupt entries after poison recovery, legitimate external changes may be falsely identified as self-writes and suppressed. The indexer still runs (it's called before the self-write check), but the `file-changed` event is never emitted to the frontend.

## Evidence

Rust logs during the degraded session showed repeated `Recovering from poisoned lock` warnings on every watcher event:

```
[WARN][notesage::watcher] Recovering from poisoned lock
[WARN][notesage::index] Recovering from poisoned lock
[DEBUG][notesage::index] Indexing /Users/peter/Notesage/My test project/test.md ...
```

The indexer processed the file (hash changed), but no `file-changed` event reached the frontend. After app restart (fresh process, fresh mutexes), the same test worked correctly.

## What triggers the initial panic

Unknown. The panic that poisons the lock was not captured. Candidates:
- SQLite index operations (`database is locked` errors were also observed)
- File I/O errors during indexing (e.g., reading a file that's being written)
- Concurrent access patterns between the watcher callback thread and Tauri command threads

## Affected files

- `src-tauri/src/commands/watcher.rs` — `WatcherState` uses `std::sync::Mutex` for `watcher`, `watched_paths`, and `self_writes`
- `src-tauri/src/index/mod.rs` — `IndexState` uses `std::sync::Mutex` for its queue and database connection

## Possible fixes

1. **Find and fix the panic source** — add logging or use `catch_unwind` around indexer operations to prevent mutex poisoning in the first place
2. **Clear self_writes on recovery** — when `lock_or_recover` detects a poisoned `self_writes` mutex, clear the HashMap to prevent false suppression
3. **Use `parking_lot::Mutex`** — unlike `std::sync::Mutex`, `parking_lot` mutexes are not poisoned on panic. Drop-in replacement.
4. **Periodic watcher recovery** — on `visibilitychange`, always drop and recreate the watcher debouncer (not just when `watcher_alive` is false)

## Also observed

- `database is locked` errors when multiple watcher events hit the SQLite indexer simultaneously — separate concurrency issue
- Copilot LSP `Reader timeout` warnings during idle periods — unrelated, cosmetic
