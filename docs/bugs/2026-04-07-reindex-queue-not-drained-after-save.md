# Bug: Reindex queue not drained after app-initiated saves — tags/mentions stale

**Reported:** 2026-04-07
**Severity:** Medium
**Status:** Fixed
**Affects:** All versions with SQLite document index

## Symptoms

- Type a new `#tag` or `@mention` in the editor
- Save the file (Cmd+S or auto-save)
- The tag/mention does NOT appear in autocomplete suggestions
- Tag/mention DOES appear after app restart (full reindex)
- Tag/mention DOES appear if an external file change happens (triggers queue drain)

## Root Cause

The watcher correctly queues reindex entries for self-written files but never drains the queue.

**In `src-tauri/src/commands/watcher.rs` (lines 196–226):**

```rust
// Line 196-203: Reindex is ALWAYS queued (correct)
if let Some(indexer) = app_handle.try_state::<crate::index::IndexState>() {
    indexer.queue_reindex(path, effective_kind.clone());
}

// Line 207-209: Self-writes filtered from frontend batch (correct)
if is_self_write(&mut self_writes, path) {
    continue;  // Skips adding to batch
}

// Line 219-226: Queue only drained when batch is non-empty (BUG)
if !batch.is_empty() {
    app_handle.emit("file-changed-batch", &batch);
    crate::index::process_reindex_queue(&app_handle);  // ← Never called for self-write-only batches
}
```

When all events in a debounce window are self-writes (the common case for saves from within the app), the `batch` is empty, so `process_reindex_queue()` is never called. The queued reindex entries sit in memory until either:
- An external file change occurs (drains the queue as a side effect)
- The app restarts (full reindex from disk)

**The comment at line 196 says:** "Always reindex — even self-writes need the SQLite index updated so the actions dashboard, tag search, etc. stay current." The intent was correct but the execution has a gap.

## Architecture Context

This bug sits at the intersection of two deliberate design choices:

1. **Self-write suppression:** `mark_self_write()` prevents false "external change" detection in the editor. This is correct — we don't want the editor to show reload banners for files we just saved.

2. **Watcher-driven reindexing:** The save path in `useFileOperations.ts` (line 291-293) explicitly avoids calling `indexFile()` directly, with a comment warning about lock contention with the watcher's reindex.

The gap: self-write suppression correctly filters the frontend batch, but the reindex queue processing was accidentally coupled to the frontend batch.

## Related Issues

- `2026-03-23-watcher-poisoned-lock.md` — Previous index locking issue
- `2026-03-29-external-changes-not-detected.md` — Previous watcher bug
- This is the third watcher-adjacent bug, suggesting the watcher→index coupling is fragile

## Fix Options

### Option A: Move `process_reindex_queue` outside batch check (minimal)

Move `process_reindex_queue()` before the `if !batch.is_empty()` check so it always runs after processing events. The reindex queue has its own safeguards: processing mutex, empty-queue fast path, circuit breaker throttling.

**Risk:** Low. `process_reindex_queue` already returns early if queue is empty. The `processing` mutex prevents concurrent execution. The circuit breaker throttles rapid reindexing.

### Option B: Trigger reindex from frontend after save (alternative)

Call `tauriApi.indexFile(filePath)` from `saveFile()` in `useFileOperations.ts`. This bypasses the watcher entirely for app-initiated saves.

**Risk:** Medium. The existing comment warns about lock contention. Would need to verify the index locking is safe for concurrent access from both watcher and direct calls.

### Option C: Decouple reindex queue from watcher event processing (structural)

Give the reindex queue its own processing timer (e.g., drain every 2s) independent of watcher event batching. The queue accumulates entries from both watcher events and direct save calls.

**Risk:** Adds complexity. Timer-based approach may introduce latency.

## Key Files

- `src-tauri/src/commands/watcher.rs` — Watcher event processing, self-write filter, batch emit
- `src-tauri/src/index/reindex_queue.rs` — Reindex queue, circuit breaker, `process_reindex_queue`
- `src/hooks/useFileOperations.ts` — `saveFile()` with `markSelfWrite` call
