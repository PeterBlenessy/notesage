use notify::RecursiveMode;
use notify::event::{ModifyKind, RenameMode};
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, RecommendedCache};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};
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
pub const SELF_WRITE_TTL: Duration = Duration::from_secs(5);

/// Managed state holding the active watcher and self-write filter.
pub struct WatcherState {
    /// The debounced watcher handle — dropping it stops watching.
    watcher: Mutex<Option<Debouncer<notify::RecommendedWatcher, RecommendedCache>>>,
    /// Directories currently being watched.
    watched_paths: Mutex<HashSet<PathBuf>>,
    /// Paths that Notesage itself just wrote — skip events for these.
    /// Uses timestamps so a single mark covers the full debounce window.
    pub(crate) self_writes: Mutex<HashMap<PathBuf, Instant>>,
    /// Roots that were asked for but not registered, because a recursively
    /// watched ancestor already delivers their events. Kept so recovery can
    /// register them directly if that ancestor can no longer be watched.
    covered_paths: Mutex<HashSet<PathBuf>>,
    /// What the watcher last saw of each file's content, so a metadata-only
    /// event can be told apart from content arriving (see `ContentTracker`).
    /// Only the debouncer thread locks it.
    content: Mutex<ContentTracker>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
            watched_paths: Mutex::new(HashSet::new()),
            self_writes: Mutex::new(HashMap::new()),
            covered_paths: Mutex::new(HashSet::new()),
            content: Mutex::new(ContentTracker::new()),
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
        // Lock order everywhere: watched_paths → covered_paths → watcher.
        let mut watched = self.watched_paths.lock();
        let mut covered = self.covered_paths.lock();
        let count = watched.len();

        if count > 0 || !covered.is_empty() {
            let mut watcher_guard = self.watcher.lock();
            if let Some(ref mut debouncer) = *watcher_guard {
                let mut active: HashSet<PathBuf> = HashSet::new();
                for path in watched.iter() {
                    if path.is_dir() {
                        match debouncer.watch(path, RecursiveMode::Recursive) {
                            Ok(()) => {
                                active.insert(path.clone());
                            }
                            Err(e) => log::warn!(
                                target: "notesage::watcher",
                                "Failed to re-watch {} during recovery: {:?}",
                                path.display(),
                                e
                            ),
                        }
                    }
                }

                // A covered root relies on its ancestor's stream. If that
                // ancestor did not come back, register the root itself so it
                // is not silently left without events.
                for path in orphaned_covered_roots(&active, &covered) {
                    // An orphan registered a moment ago may cover this one.
                    if covering_root(&active, &path).is_some() {
                        continue;
                    }
                    match debouncer.watch(&path, RecursiveMode::Recursive) {
                        Ok(()) => {
                            covered.remove(&path);
                            active.insert(path.clone());
                            watched.insert(path);
                        }
                        Err(e) => log::warn!(
                            target: "notesage::watcher",
                            "Failed to watch formerly covered root {} during recovery: {:?}",
                            path.display(),
                            e
                        ),
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

/// What a notify event means for a path, before the path itself is looked at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EventClass {
    Create,
    /// Data or name change (or an unspecified modify): the content may differ.
    Modify,
    /// Metadata only (xattr, inode metadata, owner, Finder info). iCloud emits
    /// these constantly; the content is unchanged, so they are neither
    /// reindexed nor reported — unless `ContentTracker` says content arrived.
    Metadata,
    Delete,
}

/// Classify a notify event kind.
fn classify_event(kind: &notify::EventKind) -> Option<EventClass> {
    use notify::EventKind::*;
    match kind {
        Create(_) => Some(EventClass::Create),
        Modify(ModifyKind::Metadata(_)) => Some(EventClass::Metadata),
        Modify(_) => Some(EventClass::Modify),
        Remove(_) => Some(EventClass::Delete),
        _ => None,
    }
}

/// What one `stat` says about a file's content.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContentSignature {
    /// An evicted iCloud placeholder: the size is known, the bytes are not local.
    pub dataless: bool,
    pub len: u64,
    pub modified: Option<SystemTime>,
}

impl ContentSignature {
    fn from_metadata(meta: &std::fs::Metadata) -> Self {
        Self {
            dataless: is_dataless(meta),
            len: meta.len(),
            modified: meta.modified().ok(),
        }
    }
}

/// `SF_DATALESS` from `<sys/stat.h>`: the file's content is not on disk.
#[cfg(target_os = "macos")]
fn is_dataless(meta: &std::fs::Metadata) -> bool {
    use std::os::macos::fs::MetadataExt;
    const SF_DATALESS: u32 = 0x4000_0000;
    meta.st_flags() & SF_DATALESS != 0
}

#[cfg(not(target_os = "macos"))]
fn is_dataless(_meta: &std::fs::Metadata) -> bool {
    false
}

/// Entries kept before the tracker is reset (a path costs ~100 bytes).
const CONTENT_TRACKER_MAX_ENTRIES: usize = 50_000;

/// Remembers the last `ContentSignature` seen for each path, so a
/// metadata-only event can be dropped when nothing about the content moved
/// and promoted to a modification when something did.
///
/// The case this exists for: an iCloud download completing flips a file from
/// dataless to local. FSEvents normally reports that with a data-modified
/// flag, but that could not be verified, and missing it would leave a newly
/// downloaded file unindexed and its listeners (Inbox, Recordings) unaware.
pub struct ContentTracker {
    seen: HashMap<PathBuf, ContentSignature>,
    /// Whether a metadata event for a LOCAL file the watcher has never seen
    /// counts as content arriving. True on macOS only: the file may have been
    /// dataless since before launch. Costs one reindex per file per session.
    promote_unknown: bool,
}

impl ContentTracker {
    pub fn new() -> Self {
        Self::with_promote_unknown(cfg!(target_os = "macos"))
    }

    pub fn with_promote_unknown(promote_unknown: bool) -> Self {
        Self { seen: HashMap::new(), promote_unknown }
    }

    fn record(&mut self, path: &Path, signature: ContentSignature) -> Option<ContentSignature> {
        if self.seen.len() >= CONTENT_TRACKER_MAX_ENTRIES && !self.seen.contains_key(path) {
            self.seen.clear();
        }
        self.seen.insert(path.to_path_buf(), signature)
    }

    fn forget(&mut self, path: &Path) {
        self.seen.remove(path);
    }

    /// Record `signature` for a metadata-only event and say whether the event
    /// should be handled as a content modification.
    fn metadata_event_carries_content(&mut self, path: &Path, signature: ContentSignature) -> bool {
        let previous = self.record(path, signature);
        if signature.dataless {
            // Nothing to read; reindexing would force a download.
            return false;
        }
        match previous {
            Some(previous) => previous != signature,
            None => self.promote_unknown,
        }
    }
}

impl Default for ContentTracker {
    fn default() -> Self {
        Self::new()
    }
}

/// `~/.notesage`, where the app's own indexes and persisted state live.
fn notesage_home() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".notesage"))
}

/// Paths the app writes for itself and nothing listens for: the SQLite
/// indexes and persisted store state under `~/.notesage`, and SQLite sidecar
/// files anywhere. `~/.notesage` is watched on purpose (skills, agents,
/// automations, settings), so only these are dropped — otherwise every
/// reindex and every store write comes back as a batch.
fn is_internal_echo_path(path: &Path, notesage_home: Option<&Path>) -> bool {
    if let Some(home) = notesage_home {
        if path.starts_with(home.join("indexes")) || path.starts_with(home.join("state")) {
            return true;
        }
    }
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(name) => name,
        None => return false,
    };
    const SQLITE_EXTENSIONS: [&str; 3] = [".db", ".sqlite", ".sqlite3"];
    const SQLITE_SIDECARS: [&str; 3] = ["-wal", "-shm", "-journal"];
    SQLITE_SIDECARS.iter().any(|sidecar| {
        name.strip_suffix(sidecar)
            .is_some_and(|db| SQLITE_EXTENSIONS.iter().any(|ext| db.ends_with(ext)))
    })
}

/// The watched root that already delivers events for `candidate`, if any:
/// a recursively watched ancestor. Compared on canonical paths, because a
/// root reached through a symlink is NOT covered by the stream of the folder
/// holding the link.
fn covering_root(watched: &HashSet<PathBuf>, candidate: &Path) -> Option<PathBuf> {
    let canonical = normalize_path(candidate);
    watched
        .iter()
        .find(|root| {
            let root_canonical = normalize_path(root);
            canonical != root_canonical && canonical.starts_with(&root_canonical)
        })
        .cloned()
}

/// Covered roots that no root in `active` covers any more and that still
/// exist — they have to be registered themselves.
fn orphaned_covered_roots(active: &HashSet<PathBuf>, covered: &HashSet<PathBuf>) -> Vec<PathBuf> {
    let mut orphans: Vec<PathBuf> = covered
        .iter()
        .filter(|path| path.is_dir() && covering_root(active, path).is_none())
        .cloned()
        .collect();
    // Parents sort before their children, so a parent is registered first.
    orphans.sort();
    orphans
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
            let home = notesage_home();

            handle_debounced_batch(
                events,
                &state.self_writes,
                &state.content,
                home.as_deref(),
                |processed| {
                    // Emit rename events.
                    for rename_event in &processed.rename_events {
                        if let Err(e) = app_handle.emit("file-renamed", rename_event) {
                            log::error!(target: "notesage::watcher", "Failed to emit file-renamed event: {:?}", e);
                        }
                    }

                    // Emit batch event with non-self-write changes to the frontend.
                    if !processed.file_changes.is_empty() {
                        if let Err(e) = app_handle.emit("file-changed-batch", &processed.file_changes) {
                            log::error!(target: "notesage::watcher", "Failed to emit file-changed-batch event: {:?}", e);
                        }
                    }
                },
                |reindex_entries| {
                    // Queue all reindex entries (rename + regular, including self-writes).
                    if let Some(indexer) = app_handle.try_state::<crate::index::IndexState>() {
                        for (path, kind) in reindex_entries {
                            indexer.queue_reindex(path.clone(), kind.clone());
                        }
                    }

                    // Always drain the reindex queue — self-write events are filtered
                    // from the frontend batch but still need the SQLite index updated.
                    crate::index::process_reindex_queue(&app_handle);
                },
            );
        },
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    *watcher_guard = Some(debouncer);
    Ok(())
}

/// Handle one debounced batch: classify it, tell the frontend, then index.
///
/// Two orderings matter and are pinned by tests:
///  - `self_writes` is copied and released BEFORE anything slow. Every save
///    calls `mark_self_write` first, so holding the guard across indexing made
///    saves wait for the reindex to finish.
///  - `emit` runs BEFORE `index`, so the UI does not hear about a change only
///    after the index and link passes are done.
fn handle_debounced_batch(
    events: Vec<DebouncedEvent>,
    self_writes: &Mutex<HashMap<PathBuf, Instant>>,
    content: &Mutex<ContentTracker>,
    notesage_home: Option<&Path>,
    emit: impl FnOnce(&ProcessedWatcherEvents),
    index: impl FnOnce(&[(String, FileChangeKind)]),
) {
    // Prune expired marks in the shared map, then work on a copy. A mark set
    // after this point belongs to a write whose events are not in this batch.
    let mut self_writes_snapshot = {
        let mut guard = self_writes.lock();
        let now = Instant::now();
        guard.retain(|_, ts| now.duration_since(*ts) < SELF_WRITE_TTL);
        guard.clone()
    };

    let processed = {
        let mut content = content.lock();
        process_watcher_events(events, &mut self_writes_snapshot, &mut content, notesage_home)
    };

    emit(&processed);
    index(&processed.reindex_entries);
}

/// Start watching a directory recursively. Can be called multiple times to
/// watch additional directories. Emits `file-changed` events.
#[tauri::command]
pub async fn watch_directory(app: AppHandle, path: String) -> Result<(), String> {
    // `watch()` walks the whole root on macOS (file-id cache) and restarts the
    // FSEvents stream — seconds on an iCloud library, so not on an async worker.
    tokio::task::spawn_blocking(move || watch_directory_blocking(&app, &path))
        .await
        .map_err(|e| format!("Watch task failed: {e}"))?
}

fn watch_directory_blocking(app: &AppHandle, path: &str) -> Result<(), String> {
    let started = Instant::now();
    let watch_path = PathBuf::from(path);
    if !watch_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let state = app.state::<WatcherState>();

    // Held across the registration so two calls for the same (or a nested)
    // root are decided one after the other.
    // Lock order everywhere: watched_paths → covered_paths → watcher.
    let mut watched = state.watched_paths.lock();

    // Check if already watching this path
    if watched.contains(&watch_path) {
        return Ok(());
    }

    // A recursively watched ancestor already delivers this root's events;
    // registering it again would only walk the same files a second time.
    if let Some(ancestor) = covering_root(&watched, &watch_path) {
        log::info!(
            target: "notesage::watcher",
            "[perf:watcher] watch skipped: {} is covered by {}",
            watch_path.display(),
            ancestor.display()
        );
        state.covered_paths.lock().insert(watch_path);
        return Ok(());
    }

    // Ensure the debouncer exists
    ensure_watcher(app)?;

    // Add the path to the watcher
    {
        let mut watcher_guard = state.watcher.lock();
        if let Some(ref mut debouncer) = *watcher_guard {
            debouncer
                .watch(&watch_path, RecursiveMode::Recursive)
                .map_err(|e| format!("Failed to watch directory: {}", e))?;
        }
    }

    log::info!(
        target: "notesage::watcher",
        "[perf:watcher] watch registered: {} ms={}",
        watch_path.display(),
        started.elapsed().as_millis()
    );
    state.covered_paths.lock().remove(&watch_path);
    watched.insert(watch_path);

    Ok(())
}

/// Mark a file path as a self-write so change events for it are suppressed
/// for `SELF_WRITE_TTL`. Call this before writing a file from the frontend.
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
pub struct ProcessedWatcherEvents {
    /// Rename-both events ready to emit as `file-renamed`.
    pub rename_events: Vec<FileRenamedEvent>,
    /// Non-self-write file change events ready to emit as `file-changed-batch`.
    pub file_changes: Vec<FileChangedEvent>,
    /// All reindex entries (including self-writes) that the SQLite index needs.
    pub reindex_entries: Vec<(String, FileChangeKind)>,
}

/// Classify a batch of debounced events into rename events, file-changed events,
/// and reindex entries — without touching `AppHandle` so this is unit-testable.
pub fn process_watcher_events(
    events: Vec<DebouncedEvent>,
    self_writes: &mut HashMap<PathBuf, Instant>,
    content: &mut ContentTracker,
    notesage_home: Option<&Path>,
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

        let class = match classify_event(&event.kind) {
            Some(c) => c,
            None => continue,
        };

        for path in &event.paths {
            // Skip .git/ internals, .DS_Store, and rename-txn/ staging directories.
            let path_str = path.to_string_lossy();
            if path_str.contains("/.git/")
                || path_str.ends_with("/.git")
                || path_str.ends_with("/.DS_Store")
                || path_str.contains("/.notesage/rename-txn/")
                || is_internal_echo_path(path, notesage_home)
            {
                continue;
            }

            // One stat answers "does it exist", "is it a directory" and what
            // the content looks like. A remove event needs none of it.
            let meta = if class == EventClass::Delete {
                None
            } else {
                std::fs::metadata(path).ok()
            };

            let effective_kind = match (class, &meta) {
                (EventClass::Delete, _) => FileChangeKind::Delete,
                (EventClass::Create, _) => FileChangeKind::Create,
                // On macOS, FSEvents often reports file deletions as "modify".
                // Reclassify: if notify says "modify" but path no longer exists, treat as delete.
                (EventClass::Modify | EventClass::Metadata, None) => FileChangeKind::Delete,
                (EventClass::Modify | EventClass::Metadata, Some(_)) => FileChangeKind::Modify,
            };

            // Skip directories, but NOT for delete events.
            if effective_kind != FileChangeKind::Delete && meta.as_ref().is_some_and(|m| m.is_dir()) {
                continue;
            }

            if effective_kind == FileChangeKind::Delete {
                content.forget(path);
            } else if let Some(meta) = &meta {
                let signature = ContentSignature::from_metadata(meta);
                if class == EventClass::Metadata {
                    // Metadata only: no reindex and no frontend event, unless
                    // the content itself arrived or changed underneath.
                    if !content.metadata_event_carries_content(path, signature) {
                        continue;
                    }
                } else {
                    content.record(path, signature);
                }
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

        let result = process_watcher_events(events, &mut self_writes, &mut ContentTracker::new(), None);

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

        let result = process_watcher_events(events, &mut self_writes, &mut ContentTracker::new(), None);

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

        let result = process_watcher_events(events, &mut self_writes, &mut ContentTracker::new(), None);

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

    // ── W-1: metadata events are not content changes ────────────────────────

    use notify::event::{CreateKind, DataChange, MetadataKind, RemoveKind};

    fn event(kind: notify::EventKind, paths: &[&Path]) -> DebouncedEvent {
        DebouncedEvent::new(
            notify::Event {
                kind,
                paths: paths.iter().map(|p| p.to_path_buf()).collect(),
                attrs: Default::default(),
            },
            Instant::now(),
        )
    }

    fn metadata_event(path: &Path) -> DebouncedEvent {
        event(
            notify::EventKind::Modify(ModifyKind::Metadata(MetadataKind::Extended)),
            &[path],
        )
    }

    fn data_event(path: &Path) -> DebouncedEvent {
        event(
            notify::EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            &[path],
        )
    }

    fn signature(dataless: bool, len: u64) -> ContentSignature {
        ContentSignature { dataless, len, modified: Some(SystemTime::UNIX_EPOCH) }
    }

    #[test]
    fn classify_event_separates_metadata_from_data_name_create_and_remove() {
        use notify::EventKind;
        for kind in [
            MetadataKind::Any,
            MetadataKind::Extended,
            MetadataKind::Ownership,
            MetadataKind::Permissions,
            MetadataKind::WriteTime,
            MetadataKind::Other,
        ] {
            assert_eq!(
                classify_event(&EventKind::Modify(ModifyKind::Metadata(kind))),
                Some(EventClass::Metadata)
            );
        }
        assert_eq!(
            classify_event(&EventKind::Modify(ModifyKind::Data(DataChange::Any))),
            Some(EventClass::Modify)
        );
        assert_eq!(classify_event(&EventKind::Modify(ModifyKind::Any)), Some(EventClass::Modify));
        for mode in [RenameMode::Any, RenameMode::From, RenameMode::To, RenameMode::Both] {
            assert_eq!(
                classify_event(&EventKind::Modify(ModifyKind::Name(mode))),
                Some(EventClass::Modify)
            );
        }
        assert_eq!(classify_event(&EventKind::Create(CreateKind::File)), Some(EventClass::Create));
        assert_eq!(classify_event(&EventKind::Remove(RemoveKind::File)), Some(EventClass::Delete));
        assert_eq!(classify_event(&EventKind::Access(notify::event::AccessKind::Any)), None);
        assert_eq!(classify_event(&EventKind::Any), None);
    }

    #[test]
    fn metadata_only_events_are_neither_reindexed_nor_reported() {
        let tmp = tempfile::TempDir::new().unwrap();
        let doc = tmp.path().join("doc.md");
        std::fs::write(&doc, "hello").unwrap();

        let mut self_writes = HashMap::new();
        // The watcher has seen this file's content (a data event), as it has
        // for any file edited or created during the session.
        let mut content = ContentTracker::with_promote_unknown(true);
        let first = process_watcher_events(vec![data_event(&doc)], &mut self_writes, &mut content, None);
        assert_eq!(first.reindex_entries.len(), 1);
        assert_eq!(first.file_changes.len(), 1);
        assert_eq!(first.file_changes[0].kind, FileChangeKind::Modify);

        // iCloud touching xattrs / inode metadata, repeatedly.
        let storm: Vec<DebouncedEvent> = (0..25).map(|_| metadata_event(&doc)).collect();
        let result = process_watcher_events(storm, &mut self_writes, &mut content, None);
        assert!(result.reindex_entries.is_empty(), "a metadata event must not queue a reindex");
        assert!(result.file_changes.is_empty(), "a metadata event is not a content modification");
    }

    #[test]
    fn metadata_event_for_a_never_seen_file_follows_the_platform_default() {
        let tmp = tempfile::TempDir::new().unwrap();
        let doc = tmp.path().join("doc.md");
        std::fs::write(&doc, "hello").unwrap();
        let mut self_writes = HashMap::new();

        // Where a file cannot be dataless: dropped from the first event on.
        let mut strict = ContentTracker::with_promote_unknown(false);
        let result = process_watcher_events(vec![metadata_event(&doc)], &mut self_writes, &mut strict, None);
        assert!(result.reindex_entries.is_empty());
        assert!(result.file_changes.is_empty());

        // macOS: it may have been dataless since before launch, so the first
        // one counts once — and only once.
        let mut cautious = ContentTracker::with_promote_unknown(true);
        let first = process_watcher_events(vec![metadata_event(&doc)], &mut self_writes, &mut cautious, None);
        assert_eq!(first.reindex_entries.len(), 1);
        assert_eq!(first.file_changes.len(), 1);
        let again = process_watcher_events(vec![metadata_event(&doc)], &mut self_writes, &mut cautious, None);
        assert!(again.reindex_entries.is_empty());
        assert!(again.file_changes.is_empty());
    }

    #[test]
    fn metadata_event_after_the_content_changed_underneath_is_reported() {
        let tmp = tempfile::TempDir::new().unwrap();
        let doc = tmp.path().join("doc.md");
        std::fs::write(&doc, "hello").unwrap();
        let mut self_writes = HashMap::new();
        let mut content = ContentTracker::with_promote_unknown(false);
        process_watcher_events(vec![data_event(&doc)], &mut self_writes, &mut content, None);

        // The bytes change but only a metadata event reaches us.
        std::fs::write(&doc, "hello, a longer body").unwrap();
        let result = process_watcher_events(vec![metadata_event(&doc)], &mut self_writes, &mut content, None);
        assert_eq!(result.reindex_entries.len(), 1);
        assert_eq!(result.reindex_entries[0].1, FileChangeKind::Modify);
        assert_eq!(result.file_changes.len(), 1);
    }

    #[test]
    fn content_tracker_reports_a_download_completing_but_not_an_eviction() {
        let path = Path::new("/library/Inbox/article.html");
        let mut tracker = ContentTracker::with_promote_unknown(false);

        // Evicted placeholder: nothing to read, never a content event.
        assert!(!tracker.metadata_event_carries_content(path, signature(true, 4096)));
        assert!(!tracker.metadata_event_carries_content(path, signature(true, 4096)));
        // dataless → local with the same size and mtime: the download landed.
        assert!(tracker.metadata_event_carries_content(path, signature(false, 4096)));
        // Further xattr noise on the now-local file.
        assert!(!tracker.metadata_event_carries_content(path, signature(false, 4096)));
        // local → dataless (eviction) must not trigger a read.
        assert!(!tracker.metadata_event_carries_content(path, signature(true, 4096)));
        // …and the next download is reported again.
        assert!(tracker.metadata_event_carries_content(path, signature(false, 4096)));
    }

    #[test]
    fn metadata_event_for_a_vanished_path_is_still_a_delete() {
        // FSEvents reports some deletions as modify; that reclassification
        // must keep working for metadata-flavoured modifies.
        let mut self_writes = HashMap::new();
        let mut content = ContentTracker::with_promote_unknown(false);
        let gone = Path::new("/definitely/not/here/doc.md");
        let result = process_watcher_events(vec![metadata_event(gone)], &mut self_writes, &mut content, None);
        assert_eq!(result.reindex_entries, vec![(gone.to_string_lossy().to_string(), FileChangeKind::Delete)]);
        assert_eq!(result.file_changes.len(), 1);
        assert_eq!(result.file_changes[0].kind, FileChangeKind::Delete);
    }

    #[test]
    fn create_data_and_remove_events_keep_their_kinds() {
        let tmp = tempfile::TempDir::new().unwrap();
        let created = tmp.path().join("new.md");
        let edited = tmp.path().join("edited.md");
        std::fs::write(&created, "a").unwrap();
        std::fs::write(&edited, "b").unwrap();
        let removed = tmp.path().join("removed.md");

        let mut self_writes = HashMap::new();
        let mut content = ContentTracker::with_promote_unknown(false);
        let result = process_watcher_events(
            vec![
                event(notify::EventKind::Create(CreateKind::File), &[&created]),
                data_event(&edited),
                event(notify::EventKind::Modify(ModifyKind::Name(RenameMode::To)), &[&edited]),
                event(notify::EventKind::Remove(RemoveKind::File), &[&removed]),
                // A directory is skipped for create/modify.
                event(notify::EventKind::Create(CreateKind::Folder), &[tmp.path()]),
            ],
            &mut self_writes,
            &mut content,
            None,
        );
        let kinds: Vec<FileChangeKind> = result.file_changes.iter().map(|c| c.kind.clone()).collect();
        assert_eq!(
            kinds,
            vec![
                FileChangeKind::Create,
                FileChangeKind::Modify,
                FileChangeKind::Modify,
                FileChangeKind::Delete,
            ]
        );
        assert_eq!(result.reindex_entries.len(), 4);
    }

    // ── W-4: the app's own index/state writes are not echoed ────────────────

    #[test]
    fn index_state_and_sqlite_sidecar_paths_are_dropped_from_the_batch() {
        let home = Path::new("/Users/test/.notesage");
        let dropped = [
            "/Users/test/.notesage/indexes/abc123/index.db",
            "/Users/test/.notesage/indexes/abc123/index.db-wal",
            "/Users/test/.notesage/indexes/abc123/links.db-shm",
            "/Users/test/.notesage/state/workspace.json",
            "/Users/test/.notesage/state/settings.corrupt.json",
            // SQLite sidecars anywhere, including inside a project.
            "/Users/test/Notes/project/.notesage/cache.db-wal",
            "/Users/test/Notes/project/data.sqlite-journal",
            "/Users/test/Notes/project/data.sqlite3-shm",
        ];
        let kept = [
            // Watched on purpose.
            "/Users/test/.notesage/skills/review/SKILL.md",
            "/Users/test/.notesage/agents/helper.md",
            "/Users/test/.notesage/automations/daily.json",
            "/Users/test/.notesage/settings.json",
            "/Users/test/.notesage/mcp.json",
            // Look-alikes that are ordinary files.
            "/Users/test/.notesage/state-of-things.md",
            "/Users/test/Notes/project/state/notes.md",
            "/Users/test/Notes/project/indexes/a.md",
            "/Users/test/Notes/project/trip-journal",
            "/Users/test/Notes/project/2026-journal.md",
            "/Users/test/Notes/project/data.db",
        ];
        for p in dropped {
            assert!(is_internal_echo_path(Path::new(p), Some(home)), "{p} should be dropped");
        }
        for p in kept {
            assert!(!is_internal_echo_path(Path::new(p), Some(home)), "{p} should be kept");
        }

        // Through the batch: neither the frontend nor the reindex queue sees them.
        let events: Vec<DebouncedEvent> = dropped
            .iter()
            .chain(kept.iter())
            .map(|p| event(notify::EventKind::Remove(RemoveKind::File), &[Path::new(p)]))
            .collect();
        let mut self_writes = HashMap::new();
        let result = process_watcher_events(events, &mut self_writes, &mut ContentTracker::new(), Some(home));
        let reported: Vec<&str> = result.file_changes.iter().map(|c| c.path.as_str()).collect();
        assert_eq!(reported, kept.to_vec());
        let queued: Vec<&str> = result.reindex_entries.iter().map(|(p, _)| p.as_str()).collect();
        assert_eq!(queued, kept.to_vec());
    }

    // ── W-2 / W-3: emit first, index after, no self-write guard held ────────

    #[test]
    fn batch_is_emitted_before_indexing_and_the_self_write_guard_is_free_meanwhile() {
        let tmp = tempfile::TempDir::new().unwrap();
        let own = tmp.path().join("own.md");
        let external = tmp.path().join("external.md");
        std::fs::write(&own, "mine").unwrap();
        std::fs::write(&external, "theirs").unwrap();

        let self_writes: Mutex<HashMap<PathBuf, Instant>> = Mutex::new(HashMap::new());
        self_writes.lock().insert(normalize_path(&own), Instant::now());
        let content = Mutex::new(ContentTracker::with_promote_unknown(false));
        let order = std::cell::RefCell::new(Vec::<&str>::new());
        let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();

        std::thread::scope(|scope| {
            handle_debounced_batch(
                vec![data_event(&own), data_event(&external)],
                &self_writes,
                &content,
                None,
                |processed| {
                    order.borrow_mut().push("emit");
                    assert!(self_writes.try_lock().is_some(), "guard held while emitting");
                    // Self-write suppression is unchanged: the app's own save
                    // is not reported, the external edit is.
                    let reported: Vec<&str> =
                        processed.file_changes.iter().map(|c| c.path.as_str()).collect();
                    assert_eq!(reported, vec![external.to_str().unwrap()]);
                },
                |reindex_entries| {
                    order.borrow_mut().push("index");
                    // …but both are reindexed.
                    assert_eq!(reindex_entries.len(), 2);
                    // A save arriving during a slow reindex: `mark_self_write`
                    // takes the same lock on another thread and must not wait
                    // for this closure to return.
                    let self_writes = &self_writes;
                    scope.spawn(move || {
                        self_writes.lock().insert(PathBuf::from("/saved/meanwhile.md"), Instant::now());
                        let _ = done_tx.send(());
                    });
                    done_rx
                        .recv_timeout(Duration::from_secs(10))
                        .expect("mark_self_write blocked while indexing");
                },
            );
        });

        assert_eq!(*order.borrow(), vec!["emit", "index"]);
        assert!(self_writes.lock().contains_key(Path::new("/saved/meanwhile.md")));
        // The mark itself is still there for later batches (FSEvents re-reports).
        assert!(self_writes.lock().contains_key(&normalize_path(&own)));
    }

    #[test]
    fn handle_debounced_batch_prunes_expired_self_writes_in_the_shared_map() {
        let self_writes: Mutex<HashMap<PathBuf, Instant>> = Mutex::new(HashMap::new());
        self_writes.lock().insert(
            PathBuf::from("/tmp/expired.md"),
            Instant::now() - SELF_WRITE_TTL - Duration::from_millis(1),
        );
        let content = Mutex::new(ContentTracker::new());
        handle_debounced_batch(Vec::new(), &self_writes, &content, None, |_| {}, |_| {});
        assert!(self_writes.lock().is_empty());
    }

    // ── W-5: a root under a watched root is not registered again ────────────

    #[test]
    fn covering_root_finds_a_watched_ancestor_only() {
        let tmp = tempfile::TempDir::new().unwrap();
        let library = tmp.path().join("library");
        let project = library.join("project");
        let sibling = tmp.path().join("library-2");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();

        let watched: HashSet<PathBuf> = [library.clone()].into_iter().collect();
        assert_eq!(covering_root(&watched, &project), Some(library.clone()));
        // The root itself, a sibling sharing a name prefix, and the parent are not covered.
        assert_eq!(covering_root(&watched, &library), None);
        assert_eq!(covering_root(&watched, &sibling), None);
        assert_eq!(covering_root(&watched, tmp.path()), None);
        assert_eq!(covering_root(&HashSet::new(), &project), None);
    }

    #[cfg(unix)]
    #[test]
    fn covering_root_does_not_trust_a_symlinked_path() {
        let tmp = tempfile::TempDir::new().unwrap();
        let library = tmp.path().join("library");
        let elsewhere = tmp.path().join("elsewhere");
        std::fs::create_dir_all(&library).unwrap();
        std::fs::create_dir_all(&elsewhere).unwrap();
        // library/linked → elsewhere: the library's stream does not follow it.
        let linked = library.join("linked");
        std::os::unix::fs::symlink(&elsewhere, &linked).unwrap();

        let watched: HashSet<PathBuf> = [library.clone()].into_iter().collect();
        assert_eq!(covering_root(&watched, &linked), None);

        // And the other way round: a root named through a link that really
        // sits inside a watched root IS covered.
        let real_child = library.join("real");
        std::fs::create_dir_all(&real_child).unwrap();
        let alias = tmp.path().join("alias");
        std::os::unix::fs::symlink(&real_child, &alias).unwrap();
        assert_eq!(covering_root(&watched, &alias), Some(library));
    }

    #[test]
    fn orphaned_covered_roots_are_the_ones_whose_ancestor_is_gone() {
        let tmp = tempfile::TempDir::new().unwrap();
        let library = tmp.path().join("library");
        let project = library.join("project");
        let other = tmp.path().join("other");
        let other_child = other.join("child");
        let vanished = other.join("vanished");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&other_child).unwrap();

        let covered: HashSet<PathBuf> =
            [project.clone(), other_child.clone(), vanished].into_iter().collect();
        // Only `library` came back; `other` could not be re-watched.
        let active: HashSet<PathBuf> = [library].into_iter().collect();
        assert_eq!(orphaned_covered_roots(&active, &covered), vec![other_child]);
    }
}
