//! Integration tests for the filesystem watcher lifecycle.
//!
//! These tests exercise the real `notify` crate against a real temp directory.
//! The unit tests in `src/commands/watcher.rs` verify event _classification_
//! logic with synthetic `DebouncedEvent` values.  This harness adds the missing
//! layer: a live `notify` subscription, a real debounce window, and real
//! filesystem operations — so any breakage from bumping `notify` or
//! `notify-debouncer-full` is caught automatically.
//!
//! ## Running
//!
//! ```bash
//! cd src-tauri
//! cargo test --test watcher_integration -- --ignored
//! ```
//!
//! All tests are `#[ignore]` because they require real wall time
//! (~700 ms per test for the debounce settle window).  A plain `cargo test`
//! skips them; the dedicated CI step runs them with `-- --ignored`.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, RecommendedCache};
use tauri_app_lib::watcher::{
    process_watcher_events, FileChangeKind, ProcessedWatcherEvents, SELF_WRITE_TTL,
};
use tempfile::TempDir;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extra buffer on top of the 500 ms debounce window.
const SETTLE_MS: u64 = 700;

fn settle() {
    std::thread::sleep(Duration::from_millis(SETTLE_MS));
}

type WatcherHandle = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

/// Build a live debouncer that accumulates events into a shared buffer, and
/// start watching `dir` recursively.
fn start_watcher(dir: &std::path::Path) -> (WatcherHandle, Arc<Mutex<Vec<DebouncedEvent>>>) {
    let buf: Arc<Mutex<Vec<DebouncedEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let buf_tx = buf.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        None,
        move |result: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| {
            if let Ok(evts) = result {
                buf_tx.lock().unwrap().extend(evts);
            }
        },
    )
    .expect("failed to create notify debouncer");

    debouncer
        .watch(dir, RecursiveMode::Recursive)
        .expect("failed to watch temp dir");

    (debouncer, buf)
}

/// Drain the event buffer and run `process_watcher_events` with an empty
/// self-write map (no suppression).
fn drain_and_process(buf: &Arc<Mutex<Vec<DebouncedEvent>>>) -> ProcessedWatcherEvents {
    let evts: Vec<DebouncedEvent> = buf.lock().unwrap().drain(..).collect();
    let mut self_writes = HashMap::new();
    process_watcher_events(evts, &mut self_writes)
}

/// Drain the event buffer and run `process_watcher_events` with a caller-
/// supplied self-write map.
fn drain_and_process_with(
    buf: &Arc<Mutex<Vec<DebouncedEvent>>>,
    self_writes: &mut HashMap<PathBuf, Instant>,
) -> ProcessedWatcherEvents {
    let evts: Vec<DebouncedEvent> = buf.lock().unwrap().drain(..).collect();
    process_watcher_events(evts, self_writes)
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/// Writing a new file inside the watched directory emits a create event.
#[test]
#[ignore = "requires real filesystem notify; run with `cargo test --test watcher_integration -- --ignored`"]
fn create_event_is_detected() {
    let tmp = TempDir::new().unwrap();
    let (_watcher, buf) = start_watcher(tmp.path());

    let foo = tmp.path().join("foo.md");
    std::fs::write(&foo, "hello").unwrap();

    settle();
    let result = drain_and_process(&buf);

    let found = result.file_changes.iter().any(|e| {
        PathBuf::from(&e.path).file_name() == Some(OsStr::new("foo.md"))
            && e.kind == FileChangeKind::Create
    });
    assert!(
        found,
        "expected a create event for foo.md in file-changed-batch; got {:?}",
        result
            .file_changes
            .iter()
            .map(|e| (e.path.as_str(), &e.kind))
            .collect::<Vec<_>>()
    );
}

// ---------------------------------------------------------------------------
// Modify
// ---------------------------------------------------------------------------

/// Writing to an already-existing file emits a modify event.
#[test]
#[ignore = "requires real filesystem notify; run with `cargo test --test watcher_integration -- --ignored`"]
fn modify_event_is_detected() {
    let tmp = TempDir::new().unwrap();

    // Pre-create the file *before* the watcher starts so the create event
    // is never captured.
    let foo = tmp.path().join("foo.md");
    std::fs::write(&foo, "original").unwrap();

    let (_watcher, buf) = start_watcher(tmp.path());

    // Overwrite → modify.
    std::fs::write(&foo, "modified").unwrap();

    settle();
    let result = drain_and_process(&buf);

    let found = result.file_changes.iter().any(|e| {
        PathBuf::from(&e.path).file_name() == Some(OsStr::new("foo.md"))
            && e.kind == FileChangeKind::Modify
    });
    assert!(
        found,
        "expected a modify event for foo.md in file-changed-batch; got {:?}",
        result
            .file_changes
            .iter()
            .map(|e| (e.path.as_str(), &e.kind))
            .collect::<Vec<_>>()
    );
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

/// A same-directory rename emits a `file-renamed` event and must NOT appear
/// in `file-changed-batch`.
#[test]
#[ignore = "requires real filesystem notify; run with `cargo test --test watcher_integration -- --ignored`"]
fn rename_event_appears_only_in_file_renamed_not_in_batch() {
    let tmp = TempDir::new().unwrap();

    // Pre-create the source file before watching.
    let foo = tmp.path().join("foo.md");
    let bar = tmp.path().join("bar.md");
    std::fs::write(&foo, "content").unwrap();

    let (_watcher, buf) = start_watcher(tmp.path());

    std::fs::rename(&foo, &bar).unwrap();

    settle();

    let evts: Vec<DebouncedEvent> = buf.lock().unwrap().drain(..).collect();
    let mut sw = HashMap::new();
    let result = process_watcher_events(evts, &mut sw);

    // The rename must surface as a file-renamed event.
    let renamed = result.rename_events.iter().any(|e| {
        PathBuf::from(&e.old_path).file_name() == Some(OsStr::new("foo.md"))
            && PathBuf::from(&e.new_path).file_name() == Some(OsStr::new("bar.md"))
    });
    assert!(
        renamed,
        "expected a file-renamed event (foo.md → bar.md); rename_events={:?}",
        result
            .rename_events
            .iter()
            .map(|e| (e.old_path.as_str(), e.new_path.as_str()))
            .collect::<Vec<_>>()
    );

    // Neither the old nor new path must appear in file-changed-batch.
    let in_batch = result.file_changes.iter().any(|e| {
        let name = PathBuf::from(&e.path).file_name().map(|n| n.to_owned());
        name == Some(OsStr::new("foo.md").to_owned())
            || name == Some(OsStr::new("bar.md").to_owned())
    });
    assert!(
        !in_batch,
        "renamed paths must NOT appear in file-changed-batch; file_changes={:?}",
        result
            .file_changes
            .iter()
            .map(|e| e.path.as_str())
            .collect::<Vec<_>>()
    );
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/// Deleting a file emits a delete event in `file-changed-batch`.
#[test]
#[ignore = "requires real filesystem notify; run with `cargo test --test watcher_integration -- --ignored`"]
fn delete_event_is_detected() {
    let tmp = TempDir::new().unwrap();

    // Pre-create before watcher starts to capture only the delete.
    let foo = tmp.path().join("foo.md");
    std::fs::write(&foo, "content").unwrap();

    let (_watcher, buf) = start_watcher(tmp.path());

    std::fs::remove_file(&foo).unwrap();

    settle();
    let result = drain_and_process(&buf);

    let found = result.file_changes.iter().any(|e| {
        PathBuf::from(&e.path).file_name() == Some(OsStr::new("foo.md"))
            && e.kind == FileChangeKind::Delete
    });
    assert!(
        found,
        "expected a delete event for foo.md in file-changed-batch; got {:?}",
        result
            .file_changes
            .iter()
            .map(|e| (e.path.as_str(), &e.kind))
            .collect::<Vec<_>>()
    );
}

// ---------------------------------------------------------------------------
// Self-write suppression
// ---------------------------------------------------------------------------

/// When a path is marked as a self-write before the event arrives,
/// `process_watcher_events` must suppress it from `file-changed-batch`.
#[test]
#[ignore = "requires real filesystem notify; run with `cargo test --test watcher_integration -- --ignored`"]
fn self_write_filter_suppresses_event_within_ttl() {
    let tmp = TempDir::new().unwrap();

    // Pre-create so `canonicalize` succeeds when we mark it.
    let foo = tmp.path().join("foo.md");
    std::fs::write(&foo, "original").unwrap();
    let canonical = std::fs::canonicalize(&foo).unwrap();

    let (_watcher, buf) = start_watcher(tmp.path());

    // Insert the canonical path into self_writes with a fresh timestamp.
    let mut self_writes: HashMap<PathBuf, Instant> = HashMap::new();
    self_writes.insert(canonical, Instant::now());

    // Write to the file — would normally emit a modify event.
    std::fs::write(&foo, "self-written").unwrap();

    settle();
    let result = drain_and_process_with(&buf, &mut self_writes);

    assert!(
        result.file_changes.is_empty(),
        "self-write must be suppressed from file-changed-batch; got {:?}",
        result
            .file_changes
            .iter()
            .map(|e| e.path.as_str())
            .collect::<Vec<_>>()
    );
}

// ---------------------------------------------------------------------------
// Self-write TTL expiry
// ---------------------------------------------------------------------------

/// After the self-write TTL elapses, the next write to the same path MUST
/// appear in `file-changed-batch`.
///
/// Instead of sleeping 5 s, we pre-populate `self_writes` with an already-
/// expired timestamp — the same technique used by the unit tests in
/// `watcher.rs`.  This exercises the TTL pruning path inside
/// `process_watcher_events` against a real `DebouncedEvent` captured from a
/// live `notify` subscription.
#[test]
#[ignore = "requires real filesystem notify; run with `cargo test --test watcher_integration -- --ignored`"]
fn self_write_ttl_expiry_allows_subsequent_event() {
    let tmp = TempDir::new().unwrap();

    // Pre-create so `canonicalize` succeeds.
    let foo = tmp.path().join("foo.md");
    std::fs::write(&foo, "original").unwrap();
    let canonical = std::fs::canonicalize(&foo).unwrap();

    let (_watcher, buf) = start_watcher(tmp.path());

    // Insert with an already-expired timestamp (beyond SELF_WRITE_TTL).
    let mut self_writes: HashMap<PathBuf, Instant> = HashMap::new();
    self_writes.insert(
        canonical,
        Instant::now() - SELF_WRITE_TTL - Duration::from_millis(1),
    );

    // Write to the file — the event MUST pass through because the TTL has expired.
    std::fs::write(&foo, "post-ttl content").unwrap();

    settle();
    let result = drain_and_process_with(&buf, &mut self_writes);

    let found = result.file_changes.iter().any(|e| {
        PathBuf::from(&e.path).file_name() == Some(OsStr::new("foo.md"))
    });
    assert!(
        found,
        "event must pass through after TTL expiry; file_changes is empty or missing foo.md; got {:?}",
        result
            .file_changes
            .iter()
            .map(|e| e.path.as_str())
            .collect::<Vec<_>>()
    );
}

// ---------------------------------------------------------------------------
// Filter: .git/ internals and .DS_Store
// ---------------------------------------------------------------------------

/// Writes to `.git/` subdirectories and `.DS_Store` files must produce no
/// event in `file-changed-batch`.
#[test]
#[ignore = "requires real filesystem notify; run with `cargo test --test watcher_integration -- --ignored`"]
fn git_internals_and_ds_store_produce_no_batch_event() {
    let tmp = TempDir::new().unwrap();

    // Create .git/ before the watcher so only the file-write events are captured.
    let git_dir = tmp.path().join(".git");
    std::fs::create_dir(&git_dir).unwrap();

    let (_watcher, buf) = start_watcher(tmp.path());

    // Write inside .git/ — must be filtered.
    std::fs::write(git_dir.join("COMMIT_EDITMSG"), "commit message").unwrap();

    // Write a .DS_Store file — must be filtered.
    std::fs::write(tmp.path().join(".DS_Store"), "mac metadata").unwrap();

    settle();
    let result = drain_and_process(&buf);

    assert!(
        result.file_changes.is_empty(),
        ".git/ internals and .DS_Store must be filtered from file-changed-batch; got {:?}",
        result
            .file_changes
            .iter()
            .map(|e| e.path.as_str())
            .collect::<Vec<_>>()
    );
}
