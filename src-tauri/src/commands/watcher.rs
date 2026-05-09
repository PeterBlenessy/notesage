use notify::RecursiveMode;
use notify::event::{ModifyKind, RenameMode};
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, RecommendedCache};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// The kind of filesystem change detected.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileChangeKind {
    Create,
    Modify,
    Delete,
}

/// Event payload emitted to the frontend via `file-changed`.
#[derive(Clone, Serialize)]
pub struct FileChangedEvent {
    pub path: String,
    pub kind: FileChangeKind,
}

/// How long a self-write mark stays active. Must cover:
///  - 500ms debounce window
///  - Multiple FSEvents re-reports on macOS (observed up to ~3s after write)
///  - iCloud sync latency on cloud-synced directories
const SELF_WRITE_TTL: Duration = Duration::from_secs(5);

/// Managed state holding the active watcher and self-write filter.
pub struct WatcherState {
    /// The debounced watcher handle — dropping it stops watching.
    watcher: Mutex<Option<Debouncer<notify::RecommendedWatcher, RecommendedCache>>>,
    /// Directories currently being watched.
    watched_paths: Mutex<HashSet<PathBuf>>,
    /// Paths that Notesage itself just wrote — skip events for these.
    /// Uses timestamps so a single mark covers the full debounce window.
    pub(crate) self_writes: Mutex<HashMap<PathBuf, Instant>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
            watched_paths: Mutex::new(HashSet::new()),
            self_writes: Mutex::new(HashMap::new()),
        }
    }

    /// Check watcher health: returns (alive, list of watched paths).
    pub fn health_info(&self) -> (bool, Vec<String>) {
        let watcher_alive = self.watcher.lock().is_some();
        let paths: Vec<String> = self.watched_paths.lock()
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        (watcher_alive, paths)
    }

    /// Drop the old watcher, create a new one, and re-watch all known paths.
    /// Used for automatic recovery when the watcher dies.
    pub fn recover_watcher(&self, app: &AppHandle) -> Result<(), String> {
        // 1. Drop existing watcher
        *self.watcher.lock() = None;

        // 2. Recreate the debouncer via ensure_watcher
        ensure_watcher(app)?;

        // 3. Re-watch all known paths
        let watched = self.watched_paths.lock();
        let count = watched.len();

        if count > 0 {
            let mut watcher_guard = self.watcher.lock();
            if let Some(ref mut debouncer) = *watcher_guard {
                for path in watched.iter() {
                    if path.is_dir() {
                        if let Err(e) = debouncer.watch(path, RecursiveMode::Recursive) {
                            log::warn!(
                                target: "notesage::watcher",
                                "Failed to re-watch {} during recovery: {:?}",
                                path.display(),
                                e
                            );
                        }
                    }
                }
            }
        }

        log::info!(
            target: "notesage::watcher",
            "Watcher recovered — re-watching {} paths",
            count
        );

        Ok(())
    }
}

/// Map a notify event kind to a `FileChangeKind` for the frontend.
fn event_kind(kind: &notify::EventKind) -> Option<FileChangeKind> {
    use notify::EventKind::*;
    match kind {
        Create(_) => Some(FileChangeKind::Create),
        Modify(_) => Some(FileChangeKind::Modify),
        Remove(_) => Some(FileChangeKind::Delete),
        _ => None,
    }
}

/// Try to canonicalize a path, falling back to the original if it fails.
fn normalize_path(path: &std::path::Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Check if a path is in the self-write set (using normalized comparison).
/// Returns true if the event should be suppressed.
fn is_self_write(self_writes: &mut HashMap<PathBuf, Instant>, path: &std::path::Path) -> bool {
    let normalized = normalize_path(path);
    let now = Instant::now();

    // Prune expired entries
    self_writes.retain(|_, ts| now.duration_since(*ts) < SELF_WRITE_TTL);

    // Check if this path was self-written recently
    self_writes.contains_key(&normalized)
}

/// Ensure the debouncer is created (lazy init) and return access to it.
fn ensure_watcher(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut watcher_guard = state.watcher.lock();

    if watcher_guard.is_some() {
        return Ok(());
    }

    let app_handle = app.clone();

    let debouncer = new_debouncer(
        Duration::from_millis(500),
        None,
        move |result: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| {
            let events = match result {
                Ok(events) => events,
                Err(errors) => {
                    for e in errors {
                        log::error!(target: "notesage::watcher", "Watcher error: {:?}", e);
                    }
                    return;
                }
            };

            let state = app_handle.state::<WatcherState>();
            let mut self_writes = state.self_writes.lock();

            let processed = process_watcher_events(events, &mut self_writes);

            // Emit rename events.
            for rename_event in &processed.rename_events {
                if let Err(e) = app_handle.emit("file-renamed", rename_event) {
                    log::error!(target: "notesage::watcher", "Failed to emit file-renamed event: {:?}", e);
                }
            }

            // Queue all reindex entries (rename + regular, including self-writes).
            if let Some(indexer) = app_handle.try_state::<crate::index::IndexState>() {
                for (path, kind) in &processed.reindex_entries {
                    indexer.queue_reindex(path.clone(), kind.clone());
                }
            }

            // Always drain the reindex queue — self-write events are filtered
            // from the frontend batch but still need the SQLite index updated.
            crate::index::process_reindex_queue(&app_handle);

            // Emit batch event with non-self-write changes to the frontend.
            if !processed.file_changes.is_empty() {
                if let Err(e) = app_handle.emit("file-changed-batch", &processed.file_changes) {
                    log::error!(target: "notesage::watcher", "Failed to emit file-changed-batch event: {:?}", e);
                }
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    *watcher_guard = Some(debouncer);
    Ok(())
}

/// Start watching a directory recursively. Can be called multiple times to
/// watch additional directories. Emits `file-changed` events.
#[tauri::command]
pub async fn watch_directory(app: AppHandle, path: String) -> Result<(), String> {
    let watch_path = PathBuf::from(&path);
    if !watch_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let state = app.state::<WatcherState>();

    // Check if already watching this path
    {
        if state.watched_paths.lock().contains(&watch_path) {
            return Ok(());
        }
    }

    // Ensure the debouncer exists
    ensure_watcher(&app)?;

    // Add the path to the watcher
    {
        let mut watcher_guard = state.watcher.lock();
        if let Some(ref mut debouncer) = *watcher_guard {
            debouncer
                .watch(&watch_path, RecursiveMode::Recursive)
                .map_err(|e| format!("Failed to watch directory: {}", e))?;
        }

        state.watched_paths.lock().insert(watch_path);
    }

    Ok(())
}

/// Stop watching all directories.
#[tauri::command]
pub async fn unwatch_directory(app: AppHandle) -> Result<(), String> {
    let state = app.state::<WatcherState>();

    *state.watcher.lock() = None;
    state.watched_paths.lock().clear();
    state.self_writes.lock().clear();

    Ok(())
}

/// Mark a file path as a self-write so change events for it are suppressed
/// for the next 2 seconds. Call this before writing a file from the frontend.
#[tauri::command]
pub async fn mark_self_write(app: AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let normalized = normalize_path(&PathBuf::from(path));
    state.self_writes.lock().insert(normalized, Instant::now());
    Ok(())
}

/// Remove a file path from the self-write set.
/// Call this if a write was cancelled or failed.
#[tauri::command]
pub async fn clear_self_write(app: AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let normalized = normalize_path(&PathBuf::from(path));
    state.self_writes.lock().remove(&normalized);
    Ok(())
}

/// Payload emitted to the frontend via `file-renamed`.
#[derive(Clone, Serialize)]
pub struct FileRenamedEvent {
    pub old_path: String,
    pub new_path: String,
    pub is_directory: bool,
}

/// Processed result from a batch of debounced watcher events.
/// Separated from `AppHandle` so the classification logic can be unit-tested.
pub(crate) struct ProcessedWatcherEvents {
    /// Rename-both events ready to emit as `file-renamed`.
    pub rename_events: Vec<FileRenamedEvent>,
    /// Non-self-write file change events ready to emit as `file-changed-batch`.
    pub file_changes: Vec<FileChangedEvent>,
    /// All reindex entries (including self-writes) that the SQLite index needs.
    pub reindex_entries: Vec<(String, FileChangeKind)>,
}

/// Classify a batch of debounced events into rename events, file-changed events,
/// and reindex entries — without touching `AppHandle` so this is unit-testable.
pub(crate) fn process_watcher_events(
    events: Vec<DebouncedEvent>,
    self_writes: &mut HashMap<PathBuf, Instant>,
) -> ProcessedWatcherEvents {
    let mut result = ProcessedWatcherEvents {
        rename_events: Vec::new(),
        file_changes: Vec::new(),
        reindex_entries: Vec::new(),
    };

    for event in events {
        // Handle rename-both events (same-volume renames where notify
        // knows both the old and new path in a single event).
        if let notify::EventKind::Modify(ModifyKind::Name(RenameMode::Both)) = event.kind {
            if event.paths.len() >= 2 {
                let old_path = &event.paths[0];
                let new_path = &event.paths[1];
                let is_directory = new_path.is_dir();
                result.rename_events.push(FileRenamedEvent {
                    old_path: old_path.to_string_lossy().to_string(),
                    new_path: new_path.to_string_lossy().to_string(),
                    is_directory,
                });
                // Queue reindex for both the old (delete) and new (create) paths.
                result.reindex_entries.push((
                    old_path.to_string_lossy().to_string(),
                    FileChangeKind::Delete,
                ));
                result.reindex_entries.push((
                    new_path.to_string_lossy().to_string(),
                    FileChangeKind::Create,
                ));
                // Skip normal event processing — rename is handled above.
                continue;
            }
        }

        let change_kind = match event_kind(&event.kind) {
            Some(k) => k,
            None => continue,
        };

        for path in &event.paths {
            // Skip .git/ internals, .DS_Store, and rename-txn/ staging directories.
            let path_str = path.to_string_lossy();
            if path_str.contains("/.git/")
                || path_str.ends_with("/.git")
                || path_str.ends_with("/.DS_Store")
                || path_str.contains("/.notesage/rename-txn/")
            {
                continue;
            }

            // On macOS, FSEvents often reports file deletions as "modify".
            // Reclassify: if notify says "modify" but path no longer exists, treat as delete.
            let effective_kind = if change_kind == FileChangeKind::Modify && !path.exists() {
                FileChangeKind::Delete
            } else {
                change_kind.clone()
            };

            // Skip directories, but NOT for delete events.
            if effective_kind != FileChangeKind::Delete && path.is_dir() {
                continue;
            }

            // Always reindex — even self-writes need SQLite kept current.
            result.reindex_entries.push((
                path.to_string_lossy().to_string(),
                effective_kind.clone(),
            ));

            // Skip frontend events for files Notesage itself wrote.
            if is_self_write(self_writes, path) {
                continue;
            }

            result.file_changes.push(FileChangedEvent {
                path: path.to_string_lossy().to_string(),
                kind: effective_kind,
            });
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn is_self_write_returns_true_for_recently_marked_path() {
        let mut self_writes: HashMap<PathBuf, Instant> = HashMap::new();
        let path = PathBuf::from("/tmp/test_file.md");
        self_writes.insert(path.clone(), Instant::now());

        assert!(is_self_write(&mut self_writes, &path));
    }

    #[test]
    fn is_self_write_returns_false_for_unmarked_path() {
        let mut self_writes: HashMap<PathBuf, Instant> = HashMap::new();
        let path = PathBuf::from("/tmp/test_file.md");

        assert!(!is_self_write(&mut self_writes, &path));
    }

    #[test]
    fn is_self_write_returns_false_after_ttl_expires() {
        let mut self_writes: HashMap<PathBuf, Instant> = HashMap::new();
        let path = PathBuf::from("/tmp/expired_file.md");
        // Insert with a timestamp that's already beyond the TTL
        self_writes.insert(
            path.clone(),
            Instant::now() - SELF_WRITE_TTL - Duration::from_millis(1),
        );

        assert!(!is_self_write(&mut self_writes, &path));
        // Expired entry should have been pruned
        assert!(self_writes.is_empty());
    }

    #[test]
    fn is_self_write_prunes_expired_entries_on_check() {
        let mut self_writes: HashMap<PathBuf, Instant> = HashMap::new();
        let expired = PathBuf::from("/tmp/expired.md");
        let fresh = PathBuf::from("/tmp/fresh.md");

        self_writes.insert(
            expired.clone(),
            Instant::now() - SELF_WRITE_TTL - Duration::from_millis(1),
        );
        self_writes.insert(fresh.clone(), Instant::now());

        // Checking expired path also prunes it
        let _ = is_self_write(&mut self_writes, &expired);

        // Fresh entry stays; expired is pruned
        assert!(!self_writes.contains_key(&expired));
        assert!(self_writes.contains_key(&fresh));
    }

    #[test]
    fn file_renamed_event_fields_are_correct() {
        let event = FileRenamedEvent {
            old_path: "/old/path/foo.md".to_string(),
            new_path: "/new/path/bar.md".to_string(),
            is_directory: false,
        };
        assert_eq!(event.old_path, "/old/path/foo.md");
        assert_eq!(event.new_path, "/new/path/bar.md");
        assert!(!event.is_directory);
    }

    #[test]
    fn file_renamed_event_is_directory_flag_works() {
        let event = FileRenamedEvent {
            old_path: "/old/dir".to_string(),
            new_path: "/new/dir".to_string(),
            is_directory: true,
        };
        assert!(event.is_directory);
    }

    #[test]
    fn process_watcher_events_rename_both_emits_one_rename_event() {
        use notify::event::{ModifyKind, RenameMode};

        let mut self_writes: HashMap<PathBuf, Instant> = HashMap::new();
        let events = vec![DebouncedEvent::new(
            notify::Event {
                kind: notify::EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                paths: vec![
                    PathBuf::from("/old/foo.md"),
                    PathBuf::from("/new/foo.md"),
                ],
                attrs: Default::default(),
            },
            Instant::now(),
        )];

        let result = process_watcher_events(events, &mut self_writes);

        assert_eq!(result.rename_events.len(), 1, "exactly one rename event expected");
        assert_eq!(result.rename_events[0].old_path, "/old/foo.md");
        assert_eq!(result.rename_events[0].new_path, "/new/foo.md");
        // Rename-both must not spill into the regular file-changed batch
        assert!(
            result.file_changes.is_empty(),
            "file-changed batch must be empty for a rename-both event"
        );
    }

    #[test]
    fn process_watcher_events_rename_both_suppresses_file_changed_batch() {
        use notify::event::{ModifyKind, RenameMode};

        let mut self_writes: HashMap<PathBuf, Instant> = HashMap::new();
        // Two rename-both events — simulates back-to-back renames in the debounced batch
        let events = vec![
            DebouncedEvent::new(
                notify::Event {
                    kind: notify::EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                    paths: vec![
                        PathBuf::from("/notes/a.md"),
                        PathBuf::from("/notes/b.md"),
                    ],
                    attrs: Default::default(),
                },
                Instant::now(),
            ),
            DebouncedEvent::new(
                notify::Event {
                    kind: notify::EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                    paths: vec![
                        PathBuf::from("/notes/c.md"),
                        PathBuf::from("/notes/d.md"),
                    ],
                    attrs: Default::default(),
                },
                Instant::now(),
            ),
        ];

        let result = process_watcher_events(events, &mut self_writes);

        assert_eq!(result.rename_events.len(), 2, "two rename events expected");
        // No paths from rename-both events must appear in the file-changed batch
        assert!(
            result.file_changes.is_empty(),
            "file-changed batch must be empty when all events are rename-both"
        );
    }

    #[test]
    fn process_watcher_events_excludes_rename_txn_staging_paths() {
        // Simulate a modify event for a file inside the rename-txn staging dir.
        // It must be silently dropped from both file_changes and not interfere with
        // the reindex entries intended for the frontend batch.
        let mut self_writes: HashMap<PathBuf, Instant> = HashMap::new();
        let staging_path = PathBuf::from(
            "/Users/test/Notesage/.notesage/rename-txn/txn-123/entry-0.json",
        );
        let normal_path = PathBuf::from("/Users/test/Notesage/doc.md");

        let events = vec![
            DebouncedEvent::new(
                notify::Event {
                    kind: notify::EventKind::Modify(notify::event::ModifyKind::Data(
                        notify::event::DataChange::Content,
                    )),
                    paths: vec![staging_path.clone()],
                    attrs: Default::default(),
                },
                Instant::now(),
            ),
            DebouncedEvent::new(
                notify::Event {
                    kind: notify::EventKind::Modify(notify::event::ModifyKind::Data(
                        notify::event::DataChange::Content,
                    )),
                    paths: vec![normal_path.clone()],
                    attrs: Default::default(),
                },
                Instant::now(),
            ),
        ];

        let result = process_watcher_events(events, &mut self_writes);

        // Only the normal path should appear in file_changes; the staging path must be excluded.
        let staging_str = staging_path.to_string_lossy();
        let staging_in_changes = result.file_changes.iter().any(|e| e.path == staging_str);
        assert!(
            !staging_in_changes,
            "rename-txn staging files must not appear in file-changed-batch"
        );

        // The normal doc.md event must still pass through.
        let normal_str = normal_path.to_string_lossy();
        // On systems where the file doesn't exist the effective_kind becomes Delete;
        // we just check the path appears in either reindex_entries (always) or file_changes.
        let in_reindex = result
            .reindex_entries
            .iter()
            .any(|(p, _)| p == normal_str.as_ref());
        assert!(in_reindex, "normal file must appear in reindex entries");
    }
}
