use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use super::file_scanner::is_indexable;
use super::{db, get_db_for_path, reindex_file_in_db, IndexState};
use crate::commands::watcher::FileChangeKind;

/// Max reindexes per file within the circuit breaker window.
const REINDEX_CIRCUIT_BREAKER_MAX: u32 = 5;
/// Circuit breaker window duration.
const REINDEX_CIRCUIT_BREAKER_WINDOW: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub(crate) struct ReindexEntry {
    pub path: String,
    pub kind: FileChangeKind,
}

impl IndexState {
    /// Queue a file for reindexing (called from watcher).
    pub fn queue_reindex(&self, path: String, kind: FileChangeKind) {
        self.reindex_queue.lock().push(ReindexEntry { path, kind });
    }

    /// Check if reindexing should be throttled for this file.
    /// Returns true if the file has been reindexed too many times recently.
    pub(crate) fn is_reindex_throttled(&self, path: &str) -> bool {
        let mut counts = self.reindex_counts.lock();
        let now = Instant::now();

        if let Some((count, window_start)) = counts.get_mut(path) {
            if now.duration_since(*window_start) > REINDEX_CIRCUIT_BREAKER_WINDOW {
                // Window expired — reset
                *count = 1;
                *window_start = now;
                false
            } else if *count >= REINDEX_CIRCUIT_BREAKER_MAX {
                // Log once at the threshold, then suppress
                if *count == REINDEX_CIRCUIT_BREAKER_MAX {
                    log::warn!(
                        target: "notesage::index",
                        "Throttling rapid reindex for {} ({} times in 30s)",
                        path, count
                    );
                }
                *count += 1;
                true
            } else {
                *count += 1;
                false
            }
        } else {
            counts.insert(path.to_string(), (1, now));
            false
        }
    }
}

/// Process the reindex queue (called from watcher event handler —
/// must run unconditionally, not gated on frontend batch emptiness,
/// so that self-write reindex entries are drained).
pub fn process_reindex_queue(app: &AppHandle) {
    let state = match app.try_state::<IndexState>() {
        Some(s) => s,
        None => return,
    };

    // Check if already processing
    {
        let mut processing = state.processing.lock();
        if *processing {
            return;
        }
        *processing = true;
    }

    // Drain the queue
    let entries: Vec<ReindexEntry> = state.reindex_queue.lock().drain(..).collect();

    if entries.is_empty() {
        *state.processing.lock() = false;
        return;
    }

    // Collect link-graph work to run AFTER the content-DB locks are released —
    // `index_links_for_file` locks `project_dbs` to compute scope roots, so
    // doing it inside this loop (which already holds that lock) would deadlock
    // on the non-reentrant parking_lot mutex.
    let mut link_updates: Vec<String> = Vec::new();
    let mut link_deletes: Vec<String> = Vec::new();

    {
        let global = state.global_db.lock();
        let projects = state.project_dbs.lock();

        for entry in entries {
            // Apply circuit breaker — skip files being reindexed too rapidly
            if entry.kind != FileChangeKind::Delete && state.is_reindex_throttled(&entry.path) {
                continue;
            }

            if let Some((conn, project_path)) = get_db_for_path(&global, &projects, &entry.path) {
                if entry.kind == FileChangeKind::Delete {
                    let _ = db::remove_file(conn, &entry.path);
                    link_deletes.push(entry.path.clone());
                } else if is_indexable(&entry.path) {
                    let _ = reindex_file_in_db(conn, &entry.path, project_path.as_deref());
                    link_updates.push(entry.path.clone());
                }
            }
        }
    }

    // Link-graph reconciliation (scope-gated inside each call — explorer paths
    // are no-ops, ADR 0003). Collect every path whose link edges/meta were
    // touched so the frontend can refresh anything derived from `links.db`
    // (the RelationsPanel via `useDocumentRelations`, the wiki-link unresolved
    // decoration) without busy-polling. This is the single, authoritative
    // "links settled" signal and fires for ALL write paths — self-write saves
    // (which are filtered out of `file-changed-batch`) AND external/tool writes
    // alike, only AFTER the reindex has actually landed.
    let mut affected: Vec<String> = Vec::new();
    for path in link_deletes {
        state.remove_links_for_file(&path);
        affected.push(path);
    }
    for path in link_updates {
        state.index_links_for_file(&path);
        affected.push(path);
    }

    *state.processing.lock() = false;

    if !affected.is_empty() {
        let _ = app.emit("links-reindexed", affected);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_reindex_adds_entry() {
        let state = IndexState::new();
        assert_eq!(state.reindex_queue.lock().len(), 0);

        state.queue_reindex("/tmp/test.md".to_string(), FileChangeKind::Modify);
        assert_eq!(state.reindex_queue.lock().len(), 1);

        state.queue_reindex("/tmp/test2.md".to_string(), FileChangeKind::Create);
        assert_eq!(state.reindex_queue.lock().len(), 2);
    }

    #[test]
    fn circuit_breaker_allows_up_to_max() {
        let state = IndexState::new();
        let path = "/tmp/rapid.md";

        // First REINDEX_CIRCUIT_BREAKER_MAX calls should not be throttled
        for _ in 0..REINDEX_CIRCUIT_BREAKER_MAX {
            assert!(!state.is_reindex_throttled(path));
        }

        // The next call should be throttled
        assert!(state.is_reindex_throttled(path));
    }

    #[test]
    fn circuit_breaker_resets_after_window() {
        let state = IndexState::new();
        let path = "/tmp/window.md";

        // Exhaust the circuit breaker
        for _ in 0..REINDEX_CIRCUIT_BREAKER_MAX {
            state.is_reindex_throttled(path);
        }
        assert!(state.is_reindex_throttled(path));

        // Simulate window expiry by manually resetting the timestamp
        {
            let mut counts = state.reindex_counts.lock();
            if let Some((_, window_start)) = counts.get_mut(path) {
                *window_start = Instant::now() - REINDEX_CIRCUIT_BREAKER_WINDOW - Duration::from_secs(1);
            }
        }

        // Should be allowed again after window expires
        assert!(!state.is_reindex_throttled(path));
    }

    #[test]
    fn circuit_breaker_independent_per_file() {
        let state = IndexState::new();

        // Exhaust breaker for file A
        for _ in 0..REINDEX_CIRCUIT_BREAKER_MAX {
            state.is_reindex_throttled("/tmp/a.md");
        }
        assert!(state.is_reindex_throttled("/tmp/a.md"));

        // File B should still be allowed
        assert!(!state.is_reindex_throttled("/tmp/b.md"));
    }
}
