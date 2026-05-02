use notify::event::{ModifyKind, RenameMode};
use notify::RecursiveMode;
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

/// Event payload emitted to the frontend via `file-renamed`.
/// Both paths are populated; `is_directory` reflects the new path.
#[derive(Clone, Serialize)]
pub struct FileRenamedEvent {
    pub old_path: String,
    pub new_path: String,
    pub is_directory: bool,
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

            let mut batch: Vec<FileChangedEvent> = Vec::new();

            for event in events {
                // Handle same-volume renames: notify_debouncer_full with
                // FileIdMap correlates old+new paths into a single event with
                // RenameMode::Both. Emit `file-renamed` and skip the paired
                // delete+create so the frontend does not double-handle.
                if let notify::EventKind::Modify(ModifyKind::Name(RenameMode::Both)) = &event.kind {
                    if let (Some(old_path), Some(new_path)) =
                        (event.paths.get(0), event.paths.get(1))
                    {
                        // Honor mark_self_write — sidebar-initiated renames use this.
                        if is_self_write(&mut self_writes, old_path)
                            || is_self_write(&mut self_writes, new_path)
                        {
                            continue;
                        }

                        // Queue reindex for both paths so the SQLite index
                        // stays consistent (delete old row, insert new row).
                        if let Some(indexer) =
                            app_handle.try_state::<crate::index::IndexState>()
                        {
                            indexer.queue_reindex(
                                old_path.to_string_lossy().to_string(),
                                FileChangeKind::Delete,
                            );
                            indexer.queue_reindex(
                                new_path.to_string_lossy().to_string(),
                                FileChangeKind::Create,
                            );
                        }

                        let payload = FileRenamedEvent {
                            old_path: old_path.to_string_lossy().to_string(),
                            new_path: new_path.to_string_lossy().to_string(),
                            is_directory: new_path.is_dir(),
                        };
                        if let Err(e) = app_handle.emit("file-renamed", &payload) {
                            log::error!(
                                target: "notesage::watcher",
                                "Failed to emit file-renamed event: {:?}",
                                e
                            );
                        }
                    }
                    continue; // suppress paired delete+create batch entries
                }

                let change_kind = match event_kind(&event.kind) {
                    Some(k) => k,
                    None => continue,
                };

                for path in &event.paths {
                    // Skip .git/ internals — these are never user-facing files
                    // and iCloud-synced repos flood the watcher with index.lock events.
                    // Also skip .DS_Store (macOS Finder metadata).
                    let path_str = path.to_string_lossy();
                    if path_str.contains("/.git/")
                        || path_str.ends_with("/.git")
                        || path_str.ends_with("/.DS_Store")
                    {
                        continue;
                    }

                    // On macOS, FSEvents often reports file deletions as
                    // "modify" on the parent directory or the deleted path.
                    // Reclassify: if notify says "modify" but the path no
                    // longer exists, treat it as a delete.
                    let effective_kind = if change_kind == FileChangeKind::Modify && !path.exists() {
                        FileChangeKind::Delete
                    } else {
                        change_kind.clone()
                    };

                    // Skip directories, but NOT for delete events (file is
                    // already gone so is_dir() would return false anyway).
                    if effective_kind != FileChangeKind::Delete && path.is_dir() {
                        continue;
                    }

                    // Always reindex — even self-writes need the SQLite index updated
                    // so the actions dashboard, tag search, etc. stay current.
                    if let Some(indexer) = app_handle.try_state::<crate::index::IndexState>() {
                        indexer.queue_reindex(
                            path.to_string_lossy().to_string(),
                            effective_kind.clone(),
                        );
                    }

                    // Skip frontend events for files Notesage itself wrote
                    // (prevents false "external change" detection in the editor).
                    if is_self_write(&mut self_writes, path) {
                        continue;
                    }

                    batch.push(FileChangedEvent {
                        path: path.to_string_lossy().to_string(),
                        kind: effective_kind,
                    });
                }
            }

            // Always drain the reindex queue — self-write events are filtered
            // from the frontend batch but still queue reindex entries that need
            // processing for tag/mention autocomplete to stay current.
            crate::index::process_reindex_queue(&app_handle);

            // Emit batch event with non-self-write changes to the frontend
            if !batch.is_empty() {
                if let Err(e) = app_handle.emit("file-changed-batch", &batch) {
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
