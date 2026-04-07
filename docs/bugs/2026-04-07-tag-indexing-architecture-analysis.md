# Architecture Analysis: Tag/Mention Indexing Flow

**Date:** 2026-04-07 **Context:** Third watcher-related bug (`reindex-queue-not-drained`), plus history of poisoned lock (`2026-03-23`) and external changes not detected (`2026-03-29`). The watcher→index coupling is proving fragile.

## Current Architecture

```
[Editor typing]
     │
     ├── tag-highlight.ts → visual decoration (immediate, client-side)
     ├── tag-suggestion.tsx → queries SQLite index (stale until reindex)
     │
     └── [User saves / auto-save]
              │
              ├── markSelfWrite(path)     ← suppresses watcher frontend events
              ├── writeFile(path, content)
              │
              └── [FSEvents fires]
                       │
                       └── watcher.rs callback
                            ├── queue_reindex(path)   ← always queued
                            ├── is_self_write? → skip frontend batch
                            │
                            └── if batch non-empty:
                                  ├── emit file-changed-batch
                                  └── process_reindex_queue()  ← BUG: only runs here
```

**Problem:** The reindex queue is drained only as a side effect of having non-self-write events in the batch. Self-write-only batches (the common case for app saves) leave the queue undrained.

## Why the Current Design Is Fragile

1. **Coupling:** Three independent concerns (external change detection, index updates, watcher event filtering) are interleaved in one callback. A change to any concern risks breaking the others.

2. **Implicit dependency:** Reindex processing depends on batch emptiness, which depends on self-write state, which depends on save timing. This is a non-obvious chain of dependencies.

3. **Lock history:** The poisoned lock bug (2026-03-23) was caused by concurrent index access. The `useFileOperations` comment at line 292 ("do NOT call indexFile() here — lock contention") is a scar from that incident. The architecture was shaped by a bug rather than designed for correctness.

4. **Self-write TTL fragility:** The 5-second self-write window is tuned for macOS FSEvents + iCloud. Different cloud providers, slower machines, or future OS changes could break this.

## Two Distinct Update Paths (Should Be Explicit)

### Path 1: App-Initiated Edits (tags typed by user)

```
User types #tag → decoration shows immediately → file saved → index should update
```

The user already sees the tag visually. The index update is about making the tag discoverable in autocomplete and search. Latency tolerance: \~1-2 seconds (user expects the tag they just typed to appear in suggestions after saving).

### Path 2: External Changes (files modified by other editors, agents, git)

```
External write → watcher detects → frontend notified → editor may reload → index updated
```

The watcher must detect the change, notify the frontend, and update the index. Latency tolerance: \~2-5 seconds.

## Recommended Architecture

**Principle:** Decouple index updates from the watcher frontend event pipeline. The watcher should serve two independent consumers:

### Option 1: Always drain the reindex queue (minimal fix)

Move `process_reindex_queue()` outside the `if !batch.is_empty()` block. This is the smallest change that fixes the bug.

```rust
// Always drain — queue has its own safeguards
crate::index::process_reindex_queue(&app_handle);

// Emit frontend events separately
if !batch.is_empty() {
    app_handle.emit("file-changed-batch", &batch);
}
```

**Pros:** Minimal change, fixes the bug, preserves all existing safeguards. **Cons:** Doesn't address the architectural coupling. The reindex queue still depends on the watcher callback firing.

### Option 2: Independent reindex timer (structural)

Give the reindex queue its own periodic drain timer (e.g., every 1-2s), independent of watcher events:

```rust
// In watcher initialization:
std::thread::spawn(move || {
    loop {
        std::thread::sleep(Duration::from_secs(2));
        process_reindex_queue(&app_handle);
    }
});
```

**Pros:** Completely decouples reindex from watcher. Queue entries from any source (watcher, direct API calls, future features) are drained reliably. **Cons:** Adds a background thread. 2-second latency for all reindexes (vs. immediate for external changes today). Slightly more complex.

### Option 3: Frontend-driven reindex after save (hybrid)

After saving a file, the frontend calls a Tauri command to reindex that specific file, bypassing the watcher entirely:

```typescript
// In saveFile():
await tauriApi.writeFile(filePath, raw);
await tauriApi.indexFile(filePath);  // Direct reindex
```

The watcher continues to handle external changes. App-initiated changes are indexed immediately.

**Pros:** Clear separation of concerns. No watcher dependency for self-writes. Zero latency for app saves. **Cons:** The poisoned lock bug (2026-03-23) was caused by concurrent index access from watcher + direct calls. Would need to verify the current locking is safe, or add a dedicated index access serializer.

### Recommendation

**Start with Option 1** (minimal fix) for the immediate bug. It's safe and well-guarded.

**Consider Option 3** for a future refactor if more watcher issues surface. The lock contention concern from 2026-03-23 should be re-evaluated — the current `processing` mutex in `reindex_queue.rs` may already be sufficient, and the `indexFile` command uses `get_db_for_path` which acquires locks per-database.

**Avoid:** Adding tag/mention indexing directly from the ProseMirror decoration plugins. While the tags ARE detected client-side during decoration building, pushing them to the SQLite index from the frontend would bypass the comrak AST parser and create a second indexing path that could diverge from the canonical disk-based index. The index should have a single source of truth: the file on disk.