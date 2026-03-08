use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, RecommendedCache};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Event payload emitted to the frontend via `file-changed`.
#[derive(Clone, Serialize)]
pub struct FileChangedEvent {
    pub path: String,
    pub kind: String,
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
    self_writes: Mutex<HashMap<PathBuf, Instant>>,
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
        let watcher_alive = self
            .watcher
            .lock()
            .map(|w| w.is_some())
            .unwrap_or(false);
        let paths: Vec<String> = self
            .watched_paths
            .lock()
            .map(|wp| wp.iter().map(|p| p.to_string_lossy().to_string()).collect())
            .unwrap_or_default();
        (watcher_alive, paths)
    }

    /// Drop the old watcher, create a new one, and re-watch all known paths.
    /// Used for automatic recovery when the watcher dies.
    pub fn recover_watcher(&self, app: &AppHandle) -> Result<(), String> {
        // 1. Drop existing watcher
        {
            let mut watcher_guard = self.watcher.lock().map_err(|e| e.to_string())?;
            *watcher_guard = None;
        }

        // 2. Recreate the debouncer via ensure_watcher
        ensure_watcher(app)?;

        // 3. Re-watch all known paths
        let watched = self.watched_paths.lock().map_err(|e| e.to_string())?;
        let count = watched.len();

        if count > 0 {
            let mut watcher_guard = self.watcher.lock().map_err(|e| e.to_string())?;
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

/// Map a notify event kind to a simple string for the frontend.
fn event_kind_str(kind: &notify::EventKind) -> Option<&'static str> {
    use notify::EventKind::*;
    match kind {
        Create(_) => Some("create"),
        Modify(_) => Some("modify"),
        Remove(_) => Some("delete"),
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
    let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;

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
            let mut self_writes = match state.self_writes.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };

            let mut batch: Vec<FileChangedEvent> = Vec::new();

            for event in events {
                let kind_str = match event_kind_str(&event.kind) {
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

                    // Skip events for files Notesage itself wrote
                    if is_self_write(&mut self_writes, path) {
                        continue;
                    }

                    // On macOS, FSEvents often reports file deletions as
                    // "modify" on the parent directory or the deleted path.
                    // Reclassify: if notify says "modify" but the path no
                    // longer exists, treat it as a delete.
                    let effective_kind = if kind_str == "modify" && !path.exists() {
                        "delete"
                    } else {
                        kind_str
                    };

                    // Skip directories, but NOT for delete events (file is
                    // already gone so is_dir() would return false anyway).
                    if effective_kind != "delete" && path.is_dir() {
                        continue;
                    }

                    let payload = FileChangedEvent {
                        path: path.to_string_lossy().to_string(),
                        kind: effective_kind.to_string(),
                    };

                    // Emit per-event for backward compatibility
                    if let Err(e) = app_handle.emit("file-changed", payload.clone()) {
                        log::error!(target: "notesage::watcher", "Failed to emit file-changed event: {:?}", e);
                    }

                    batch.push(payload);
                }
            }

            // Emit batch event with all filtered events at once
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
        let watched = state.watched_paths.lock().map_err(|e| e.to_string())?;
        if watched.contains(&watch_path) {
            return Ok(());
        }
    }

    // Ensure the debouncer exists
    ensure_watcher(&app)?;

    // Add the path to the watcher
    {
        let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut debouncer) = *watcher_guard {
            debouncer
                .watch(&watch_path, RecursiveMode::Recursive)
                .map_err(|e| format!("Failed to watch directory: {}", e))?;
        }

        let mut watched = state.watched_paths.lock().map_err(|e| e.to_string())?;
        watched.insert(watch_path);
    }

    Ok(())
}

/// Stop watching all directories.
#[tauri::command]
pub async fn unwatch_directory(app: AppHandle) -> Result<(), String> {
    let state = app.state::<WatcherState>();

    let mut watcher = state.watcher.lock().map_err(|e| e.to_string())?;
    *watcher = None;

    let mut watched = state.watched_paths.lock().map_err(|e| e.to_string())?;
    watched.clear();

    // Clear self-write set too
    let mut self_writes = state.self_writes.lock().map_err(|e| e.to_string())?;
    self_writes.clear();

    Ok(())
}

/// Mark a file path as a self-write so change events for it are suppressed
/// for the next 2 seconds. Call this before writing a file from the frontend.
#[tauri::command]
pub async fn mark_self_write(app: AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut self_writes = state.self_writes.lock().map_err(|e| e.to_string())?;
    let normalized = normalize_path(&PathBuf::from(path));
    self_writes.insert(normalized, Instant::now());
    Ok(())
}

/// Remove a file path from the self-write set.
/// Call this if a write was cancelled or failed.
#[tauri::command]
pub async fn clear_self_write(app: AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut self_writes = state.self_writes.lock().map_err(|e| e.to_string())?;
    let normalized = normalize_path(&PathBuf::from(path));
    self_writes.remove(&normalized);
    Ok(())
}
