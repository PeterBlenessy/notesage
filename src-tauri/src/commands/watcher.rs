use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, FileIdMap};
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Event payload emitted to the frontend via `file-changed`.
#[derive(Clone, Serialize)]
pub struct FileChangedEvent {
    pub path: String,
    pub kind: String,
}

/// Managed state holding the active watcher and self-write filter.
pub struct WatcherState {
    /// The debounced watcher handle — dropping it stops watching.
    watcher: Mutex<Option<Debouncer<notify::RecommendedWatcher, FileIdMap>>>,
    /// The directory currently being watched.
    watched_path: Mutex<Option<PathBuf>>,
    /// Paths that Notesage itself just wrote — skip events for these.
    self_writes: Mutex<HashSet<PathBuf>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
            watched_path: Mutex::new(None),
            self_writes: Mutex::new(HashSet::new()),
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

/// Start watching a directory recursively. Emits `file-changed` events.
#[tauri::command]
pub async fn watch_directory(app: AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<WatcherState>();

    // Stop any existing watcher first
    {
        let mut watcher = state.watcher.lock().map_err(|e| e.to_string())?;
        *watcher = None;
        let mut watched = state.watched_path.lock().map_err(|e| e.to_string())?;
        *watched = None;
    }

    let watch_path = PathBuf::from(&path);
    if !watch_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
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
                    if self_writes.remove(path) {
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

    // Store the debouncer and start watching
    {
        let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;
        let mut debouncer = debouncer;

        debouncer
            .watch(&watch_path, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch directory: {}", e))?;

        *watcher_guard = Some(debouncer);

        let mut watched = state.watched_path.lock().map_err(|e| e.to_string())?;
        *watched = Some(watch_path);
    }

    Ok(())
}

/// Stop watching the current directory.
#[tauri::command]
pub async fn unwatch_directory(app: AppHandle) -> Result<(), String> {
    let state = app.state::<WatcherState>();

    let mut watcher = state.watcher.lock().map_err(|e| e.to_string())?;
    *watcher = None;

    let mut watched = state.watched_path.lock().map_err(|e| e.to_string())?;
    *watched = None;

    // Clear self-write set too
    let mut self_writes = state.self_writes.lock().map_err(|e| e.to_string())?;
    self_writes.clear();

    Ok(())
}

/// Mark a file path as a self-write so the next change event for it is skipped.
/// Call this before writing a file from the frontend.
#[tauri::command]
pub async fn mark_self_write(app: AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut self_writes = state.self_writes.lock().map_err(|e| e.to_string())?;
    self_writes.insert(PathBuf::from(path));
    Ok(())
}

/// Remove a file path from the self-write set.
/// Call this if a write was cancelled or failed.
#[tauri::command]
pub async fn clear_self_write(app: AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut self_writes = state.self_writes.lock().map_err(|e| e.to_string())?;
    self_writes.remove(&PathBuf::from(path));
    Ok(())
}
