use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, FileIdMap};
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

/// How long a self-write mark stays active. Covers debounce window + multiple
/// FS events that macOS can emit for a single write (create tmp, rename, modify).
const SELF_WRITE_TTL: Duration = Duration::from_secs(2);

/// Managed state holding the active watcher and self-write filter.
pub struct WatcherState {
    /// The debounced watcher handle — dropping it stops watching.
    watcher: Mutex<Option<Debouncer<notify::RecommendedWatcher, FileIdMap>>>,
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
                        eprintln!("Watcher error: {:?}", e);
                    }
                    return;
                }
            };

            let state = app_handle.state::<WatcherState>();
            let mut self_writes = match state.self_writes.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };

            for event in events {
                let kind_str = match event_kind_str(&event.kind) {
                    Some(k) => k,
                    None => continue,
                };

                for path in &event.paths {
                    // Skip events for files Notesage itself wrote
                    if is_self_write(&mut self_writes, path) {
                        continue;
                    }

                    // Only emit for files, not directories
                    if path.is_dir() {
                        continue;
                    }

                    let payload = FileChangedEvent {
                        path: path.to_string_lossy().to_string(),
                        kind: kind_str.to_string(),
                    };

                    if let Err(e) = app_handle.emit("file-changed", payload) {
                        eprintln!("Failed to emit file-changed event: {:?}", e);
                    }
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
