pub mod db;
mod file_scanner;
mod fs_access;
mod html_text;
pub mod icloud;
pub mod links;
pub mod parser;
pub mod queries;
mod reindex_queue;
pub mod tasks;

use queries::*;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use file_scanner::{has_dotfolder_component, is_indexable, scan_files};
use fs_access::{FileAccess, FileStat, RealFs};
use reindex_queue::ReindexEntry;
pub use reindex_queue::process_reindex_queue;

/// One content-index database: a connection behind its own lock, shared
/// between the registry (`global_db` / `project_dbs`) and whoever is using it.
pub(super) type DbHandle = Arc<Mutex<Connection>>;

/// Managed state for the document index.
///
/// # Lock ordering
///
/// There are three kinds of lock, and the rule is short: **hold at most one
/// connection lock at a time, and never take a connection lock while holding
/// a registry lock.**
///
/// 1. *Registry / bookkeeping locks* — `global_db`, `project_dbs`,
///    `reindex_queue`, `processing`, `reindex_counts`. These are leaves: they
///    are held only long enough to clone a [`DbHandle`] out, insert or remove
///    one, or read/update a small value, and nothing else is locked while one
///    is held. (`link_scope_roots()` takes `project_dbs` this way, so it is
///    safe to call from anywhere, including while a connection is locked.)
/// 2. *Content connections* — the `Mutex` inside a [`DbHandle`]. Taken per
///    unit of work (one file's rows, one query, one commit) and released in
///    between, so a full reindex pass and queries on the same database
///    interleave. A pass keeps its transaction open across those releases;
///    a query that runs in between reads through the same connection and so
///    sees what the pass has written so far.
/// 3. *The link-graph connection* — `links_db`, taken per file the same way.
///
/// A content connection and `links_db` are never held together: a file's
/// content rows are written and the connection released before its link rows
/// are written. File I/O (stat, read, parse) happens with no lock held at all.
/// The watcher's `self_writes` lock belongs to another module; it is only
/// ever taken here with nothing else held (`index_toggle_task`).
pub struct IndexState {
    /// Global index DB connection (~/.notesage/index.db)
    pub(super) global_db: Mutex<Option<DbHandle>>,
    /// Per-project index DB connections (project_path → connection)
    pub(super) project_dbs: Mutex<HashMap<PathBuf, DbHandle>>,
    /// Standalone link-graph DB connection (~/.notesage/links.db).
    /// Deliberately separate from the content index (ADR 0002/0003) — it holds
    /// the cross-project link graph and must never feed AI context.
    pub(super) links_db: Mutex<Option<Connection>>,
    /// Pending reindex queue (debounced)
    pub(super) reindex_queue: Mutex<Vec<ReindexEntry>>,
    /// Whether a reindex batch is currently being processed
    pub(super) processing: Mutex<bool>,
    /// Per-file reindex rate limiter: path → (count, window_start)
    pub(super) reindex_counts: Mutex<HashMap<String, (u32, Instant)>>,
}

impl IndexState {
    pub fn new() -> Self {
        Self {
            global_db: Mutex::new(None),
            project_dbs: Mutex::new(HashMap::new()),
            links_db: Mutex::new(None),
            reindex_queue: Mutex::new(Vec::new()),
            processing: Mutex::new(false),
            reindex_counts: Mutex::new(HashMap::new()),
        }
    }

    /// In-scope roots for the link graph (ADR 0003): every registered project
    /// root plus the `~/Notesage` library root. Explorer folders are NOT
    /// registered as project DBs, so they are excluded here — the load-bearing
    /// gate that keeps explorer content out of `links.db`.
    pub(super) fn link_scope_roots(&self) -> Vec<String> {
        let mut roots: Vec<String> = self
            .project_dbs
            .lock()
            .keys()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join("Notesage").to_string_lossy().to_string());
        }
        roots
    }

    /// Ensure the standalone links DB is open, returning early if it can't be
    /// initialized. Used lazily so the link store comes up alongside the global
    /// index without a separate init command.
    fn ensure_links_db(&self) -> Result<(), String> {
        {
            if self.links_db.lock().is_some() {
                return Ok(());
            }
        }
        let home = dirs::home_dir().ok_or("Cannot find home directory")?;
        let db_path = home.join(".notesage").join("links.db");
        let conn = links::open_or_create(&db_path)?;
        *self.links_db.lock() = Some(conn);
        log::info!(target: "notesage::index", "Links DB initialized at {}", db_path.display());
        Ok(())
    }

    /// Index (or re-index) the link edges for a single file into `links.db`,
    /// scope-gated to projects + `~/Notesage` (ADR 0003). A no-op for
    /// out-of-scope (explorer) paths, non-markdown files, and unreadable files.
    ///
    /// Takes the content the caller has already read for the content index,
    /// so the file is not read a second time, and is only called for a file
    /// whose content changed (or that is missing from the graph). Returns true
    /// when the graph was written.
    ///
    /// SECURITY (ADR 0003): callers that have to read a file only for its
    /// links check [`Self::is_link_source`] first, so explorer content is
    /// never loaded for link extraction.
    ///
    /// `in_pass` joins the write to the pass transaction on `links.db`
    /// (opening it if needed) instead of committing per file; the pass commits
    /// it. Must be called with no connection lock held (see the lock ordering
    /// on [`IndexState`]).
    pub(super) fn index_links_with_content(
        &self,
        file_path: &str,
        content: &str,
        in_pass: bool,
    ) -> bool {
        // Only markdown documents participate in the link graph.
        if !file_path.ends_with(".md") {
            return false;
        }
        let scope_roots = self.link_scope_roots();
        if !links::is_path_in_scope(file_path, &scope_roots) {
            return false;
        }
        if self.ensure_links_db().is_err() {
            return false;
        }

        let file_name = Path::new(file_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let parsed = parser::parse_links(content, file_path, &file_name);

        let guard = self.links_db.lock();
        match guard.as_ref() {
            Some(conn) => {
                if in_pass {
                    db::ensure_txn(conn);
                }
                links::replace_source(
                    conn,
                    file_path,
                    &scope_roots,
                    parsed.meta.doc_type.as_deref(),
                    parsed.meta.title.as_deref(),
                    parsed.meta.description.as_deref(),
                    &parsed.edges,
                )
                .is_ok()
            }
            None => false,
        }
    }

    /// True when `file_path` participates in the link graph: a markdown
    /// document inside a project or `~/Notesage` (ADR 0003).
    fn is_link_source(&self, file_path: &str) -> bool {
        file_path.ends_with(".md")
            && links::is_path_in_scope(file_path, &self.link_scope_roots())
    }

    /// Paths under `dir` already present in the link graph, or `None` when
    /// the link store is unavailable.
    fn linked_paths_under(&self, dir: &str) -> Option<HashSet<String>> {
        let guard = self.links_db.lock();
        guard
            .as_ref()
            .and_then(|conn| links::indexed_paths_under(conn, dir).ok())
    }

    /// Open the pass transaction on `links.db` unless one is already open.
    fn begin_links_pass(&self) {
        if let Some(conn) = self.links_db.lock().as_ref() {
            db::ensure_txn(conn);
        }
    }

    /// Commit the pass transaction on `links.db`, if one is open.
    fn commit_links(&self) {
        if let Some(conn) = self.links_db.lock().as_ref() {
            db::commit_txn(conn);
        }
    }

    /// The database a file belongs to: the first registered project whose
    /// path prefixes it, else the global database. The handle is cloned out
    /// so no registry lock is held while it is used.
    pub(super) fn db_for_path(&self, file_path: &str) -> Option<(DbHandle, Option<String>)> {
        {
            let projects = self.project_dbs.lock();
            for (project_path, handle) in projects.iter() {
                let project_str = project_path.to_string_lossy();
                // Component-wise, so `/lib/Work-archive/a.md` is not taken for
                // a file of the project `/lib/Work`.
                if Path::new(file_path).starts_with(project_path) {
                    return Some((handle.clone(), Some(project_str.to_string())));
                }
            }
        }
        // Fall back to global DB
        self.global_db.lock().as_ref().map(|handle| (handle.clone(), None))
    }

    /// Handles for the given projects (those that are registered) followed by
    /// the global database.
    fn query_handles(&self, project_paths: &[String]) -> Vec<DbHandle> {
        let mut handles = Vec::new();
        {
            let projects = self.project_dbs.lock();
            for pp in project_paths {
                if let Some(handle) = projects.get(&PathBuf::from(pp)) {
                    handles.push(handle.clone());
                }
            }
        }
        if let Some(handle) = self.global_db.lock().as_ref() {
            handles.push(handle.clone());
        }
        handles
    }

    /// Remove a file's link edges + meta from `links.db` (delete reconcile).
    pub(super) fn remove_links_for_file(&self, file_path: &str) {
        let guard = self.links_db.lock();
        if let Some(conn) = guard.as_ref() {
            let _ = links::reconcile_delete(conn, file_path);
        }
    }

    /// Repoint a file's link edges + meta on rename (rename reconcile).
    ///
    /// The watcher currently surfaces same-volume renames to the reindex queue
    /// as a Delete(old) + Create(new) pair, which `process_reindex_queue`
    /// reconciles via `remove_links_for_file` + `index_links_with_content` (incoming
    /// edges to the old path survive as pending references, ADR 0007). This
    /// atomic-repoint primitive is the alternative the rename-sync path can call
    /// directly when both paths are known, preserving backlink resolution rather
    /// than briefly unresolving it. Kept available + tested for that wiring.
    #[allow(dead_code)]
    pub(super) fn rename_links_for_file(&self, old_path: &str, new_path: &str) {
        let guard = self.links_db.lock();
        if let Some(conn) = guard.as_ref() {
            let _ = links::reconcile_rename(conn, old_path, new_path);
        }
    }

    /// Return index health info for the health check subsystem.
    pub fn health_info(&self) -> (bool, usize, usize) {
        let global_ok = self.global_db.lock().is_some();
        let project_count = self.project_dbs.lock().len();
        let queue_len = self.reindex_queue.lock().len();
        (global_ok, project_count, queue_len)
    }
}

/// Initialize the global index database.
///
/// An already-open database is kept: a second connection to the same file
/// would contend with a pass that is still running on the first (`index_reset`
/// is what closes a database so it can be reopened).
fn init_global_db(state: &IndexState) -> Result<(), String> {
    if state.global_db.lock().is_some() {
        return Ok(());
    }
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let db_path = home.join(".notesage").join("index.db");

    let conn = db::open_or_create(&db_path)?;

    let mut global = state.global_db.lock();
    if global.is_none() {
        *global = Some(Arc::new(Mutex::new(conn)));
    }
    drop(global);

    log::info!(target: "notesage::index", "Global index DB initialized at {}", db_path.display());
    Ok(())
}

/// Initialize a per-project index database.
/// Stored under ~/.notesage/indexes/<hash>/ to avoid iCloud sync corruption.
/// Previously stored in <project>/.notesage/index.db which caused corruption
/// when the project folder was on iCloud Drive (multi-device SQLite writes).
/// An already-open database is kept, for the same reason as the global one.
fn init_project_db(state: &IndexState, project_path: &str) -> Result<(), String> {
    if state.project_dbs.lock().contains_key(Path::new(project_path)) {
        return Ok(());
    }
    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let path_hash = {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        project_path.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    };
    let db_dir = home.join(".notesage").join("indexes").join(&path_hash);
    std::fs::create_dir_all(&db_dir)
        .map_err(|e| format!("Failed to create index dir: {}", e))?;
    let db_path = db_dir.join("index.db");

    let conn = db::open_or_create(&db_path)?;

    state
        .project_dbs
        .lock()
        .entry(PathBuf::from(project_path))
        .or_insert_with(|| Arc::new(Mutex::new(conn)));

    // Migrate: remove old index.db from project's .notesage/ folder (was synced via iCloud)
    let old_db = Path::new(project_path).join(".notesage").join("index.db");
    if old_db.exists() {
        for suffix in &["", "-wal", "-shm"] {
            let p = format!("{}{}", old_db.display(), suffix);
            let _ = std::fs::remove_file(&p);
        }
        log::info!(target: "notesage::index", "Migrated: removed old index.db from {}", old_db.display());
    }

    log::info!(target: "notesage::index", "Project index DB initialized at {}", db_path.display());
    Ok(())
}

/// Compute SHA-256 hash of content.
fn content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Current unix timestamp.
fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// A file's stat is only trusted on its own when the file was indexed at least
/// this long after its modification time. Inside the window a second write
/// could land in the same timestamp tick (filesystems with 1s or 2s mtime
/// granularity) with the same size, so the content is read and hashed instead.
const RACY_STAT_WINDOW_SECS: i64 = 4;

/// A pass commits after this many changed files, so quitting during a first
/// build keeps most of the work, without paying for a commit per file.
const PASS_COMMIT_EVERY: usize = 500;

/// What a reindex did with one file.
#[derive(Debug)]
pub(super) enum FileOutcome {
    /// Not a file the index covers (extension, dotfolder, `.notesage` metadata).
    Ignored,
    /// Could not be stat'ed or read.
    Unreadable,
    /// The content is not on this machine (an evicted iCloud file). It was not
    /// read, and whatever the index already holds for it is left in place; it
    /// is indexed when it becomes local (its flags, mtime or size change, or
    /// the watcher reports it).
    Dataless,
    /// mtime and size match the indexed row: not read.
    UnchangedStat,
    /// Read, and the content hash matches the indexed row.
    UnchangedContent(String),
    /// Read and (re)indexed. Carries the content so the link graph can be
    /// updated without reading the file again.
    Changed(String),
}

/// The indexed row's change-detection columns.
struct IndexedRow {
    hash: String,
    mtime: Option<i64>,
    size: Option<i64>,
    indexed_at: i64,
}

/// The stat gate: true when the file can be skipped without reading it.
///
/// A file whose mtime AND size both equal the stored values is taken as
/// unchanged. Anything else falls through to a read and the content hash,
/// which stays the authority on what changed (so a touched-but-identical file
/// is read, found equal, and only has its stat refreshed). A row from before
/// the stat columns existed has NULLs and never matches, so the first launch
/// after that migration reads everything once (and rewrites it, see
/// `reindex_file`). A forced full rebuild (parser version bump) clears the
/// rows, which bypasses the gate entirely.
///
/// The one thing the gate cannot see is an edit that keeps both mtime and
/// size (an editor that restores the old mtime); that is rare, and the next
/// edit of the file corrects it.
fn stat_gate_holds(row: &IndexedRow, stat: &FileStat) -> bool {
    row.mtime == Some(stat.mtime_ns)
        && row.size == Some(stat.size)
        && stat.mtime_ns.div_euclid(1_000_000_000) + RACY_STAT_WINDOW_SECS <= row.indexed_at
}

/// A file's rows, computed from its content before any lock is taken.
enum Prepared<'a> {
    Markdown(Box<parser::ParsedFile>),
    /// Non-markdown text: indexed for full-text search only.
    Text { body: Cow<'a, str> },
}

fn prepare_file<'a>(file_path: &str, file_name: &str, content: &'a str) -> Prepared<'a> {
    if file_path.ends_with(".md") {
        // Full AST parsing for markdown files
        let is_in_research_dir = file_path.contains("/research/");
        let parsed = parser::parse_file(content, file_name, is_in_research_dir);
        log::debug!(target: "notesage::index",
            "Parsed {}: {} tags, {} mentions, {} headings, {} tasks",
            file_path, parsed.tags.len(), parsed.mentions.len(),
            parsed.headings.len(), parsed.tasks.len()
        );
        Prepared::Markdown(Box::new(parsed))
    } else if html_text::is_html_path(file_path) {
        // A saved page is searchable by what a reader sees, not by its markup,
        // inline CSS/JS or base64 images.
        Prepared::Text {
            body: Cow::Owned(html_text::visible_text(content, html_text::MAX_HTML_TEXT_CHARS)),
        }
    } else {
        Prepared::Text { body: Cow::Borrowed(content) }
    }
}

/// Reindex a single file into the given database.
///
/// The connection is locked only around the row lookup and the row write;
/// stat, read, hashing and parsing run with no lock held, so queries on the
/// same database are not held up by file I/O.
///
/// `in_pass` joins the write to the pass transaction (opening it if needed)
/// instead of committing per file; the pass commits it.
pub(super) fn reindex_file(
    db: &Mutex<Connection>,
    fs: &dyn FileAccess,
    file_path: &str,
    project_path: Option<&str>,
    in_pass: bool,
) -> Result<FileOutcome, String> {
    let path = Path::new(file_path);

    // Skip transient temp files (e.g., .tmp from atomic writes)
    if let Some(ext) = path.extension() {
        if ext == "tmp" {
            return Ok(FileOutcome::Ignored);
        }
    }

    // Skip non-indexable files (binary, non-text extensions)
    if !is_indexable(file_path) {
        return Ok(FileOutcome::Ignored);
    }

    // Skip files inside any dotfolder (e.g. .git/, .ssh/, .config/).
    // scan_files() already skips these for bulk indexing; this guard closes the same
    // gap for the watcher-triggered single-file path that bypasses scan_files.
    // .notesage is excluded from this check so .notesage/research/ files remain indexable.
    if has_dotfolder_component(file_path) {
        return Ok(FileOutcome::Ignored);
    }

    // Skip .notesage metadata files (state/, index.db, etc.) — only research/ is indexable
    // scan_files() already filters this for bulk indexing, but watcher-triggered single-file
    // indexing bypasses scan_files and lands here directly.
    if file_path.contains("/.notesage/") && !file_path.contains("/.notesage/research/") {
        return Ok(FileOutcome::Ignored);
    }

    let stat = match fs.stat(path) {
        Ok(s) => s,
        Err(e) => {
            log::warn!(target: "notesage::index", "Cannot read {}: {}", file_path, e);
            return Ok(FileOutcome::Unreadable);
        }
    };

    // An evicted iCloud file: reading it would download it. Leave it, and
    // whatever is indexed for it, alone.
    if stat.dataless {
        log::debug!(target: "notesage::index", "Skipping {} (not downloaded)", file_path);
        return Ok(FileOutcome::Dataless);
    }

    let existing: Option<IndexedRow> = db
        .lock()
        .query_row(
            "SELECT content_hash, mtime, size, indexed_at FROM files WHERE path = ?1",
            [file_path],
            |row| {
                Ok(IndexedRow {
                    hash: row.get(0)?,
                    mtime: row.get(1)?,
                    size: row.get(2)?,
                    indexed_at: row.get(3)?,
                })
            },
        )
        .ok();

    if existing.as_ref().is_some_and(|row| stat_gate_holds(row, &stat)) {
        return Ok(FileOutcome::UnchangedStat);
    }

    // Read file content
    let content = match fs.read(path) {
        Ok(c) => c,
        Err(e) => {
            log::warn!(target: "notesage::index", "Cannot read {}: {}", file_path, e);
            return Ok(FileOutcome::Unreadable);
        }
    };

    let hash = content_hash(&content);

    // Same content as indexed: only remember the new stat, so the next pass
    // can skip the read. A row without a stat predates schema v2, whose
    // migration dropped the full-text table, so that row is rewritten in full
    // even though its hash matches.
    if existing
        .as_ref()
        .is_some_and(|row| row.hash == hash && row.mtime.is_some())
    {
        log::debug!(target: "notesage::index", "Skipping {} (hash unchanged)", file_path);
        let conn = db.lock();
        if in_pass {
            db::ensure_txn(&conn);
        }
        let _ = conn.execute(
            "UPDATE files SET mtime = ?1, size = ?2, indexed_at = ?3 WHERE path = ?4",
            rusqlite::params![stat.mtime_ns, stat.size, now_ts() as i64, file_path],
        );
        return Ok(FileOutcome::UnchangedContent(content));
    }

    log::debug!(target: "notesage::index", "Indexing {} (hash {} → {})",
        file_path,
        existing.as_ref().map(|row| row.hash.as_str()).unwrap_or("new"),
        &hash[..8]
    );

    let result = {
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let prepared = prepare_file(file_path, &file_name, &content);

        // Remove old data for this file and re-index inside a savepoint.
        // If any step fails, the savepoint rolls back so the stale hash doesn't
        // prevent future re-indexing of tags/mentions.
        let conn = db.lock();
        if in_pass {
            db::ensure_txn(&conn);
        }
        db::with_savepoint(&conn, || {
            write_file_rows(&conn, file_path, &file_name, project_path, &hash, &stat, &prepared)
        })
    };
    match result {
        Ok(()) => Ok(FileOutcome::Changed(content)),
        Err(e) => {
            log::warn!(target: "notesage::index", "Index failed for {}: {}", file_path, e);
            Err(e)
        }
    }
}

fn write_file_rows(
    conn: &rusqlite::Connection,
    file_path: &str,
    file_name: &str,
    project_path: Option<&str>,
    hash: &str,
    stat: &FileStat,
    prepared: &Prepared<'_>,
) -> Result<(), String> {
    let _ = db::remove_file(conn, file_path);

    match prepared {
        Prepared::Markdown(parsed) => {
            // Insert file record
            conn.execute(
                "INSERT OR REPLACE INTO files (path, name, project_path, content_hash, title, has_frontmatter, indexed_at, mtime, size)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    file_path,
                    file_name,
                    project_path,
                    hash,
                    parsed.title,
                    parsed.has_frontmatter as i32,
                    now_ts() as i64,
                    stat.mtime_ns,
                    stat.size,
                ],
            )
            .map_err(|e| format!("Failed to insert file: {}", e))?;

            let file_id = conn.last_insert_rowid();

            // Insert FTS data
            conn.execute(
                "INSERT INTO files_fts(rowid, title, body) VALUES (?1, ?2, ?3)",
                rusqlite::params![file_id, parsed.title.as_deref().unwrap_or(""), parsed.body_text],
            )
            .map_err(|e| format!("Failed to insert FTS: {}", e))?;

            // Insert tags
            for tag in &parsed.tags {
                conn.execute(
                    "INSERT INTO tags (file_id, tag, context_before, context_after) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![file_id, tag.tag, tag.context_before, tag.context_after],
                )
                .map_err(|e| format!("Failed to insert tag: {}", e))?;
            }

            // Insert mentions
            for mention in &parsed.mentions {
                conn.execute(
                    "INSERT INTO mentions (file_id, mention, context_before, context_after) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![file_id, mention.mention, mention.context_before, mention.context_after],
                )
                .map_err(|e| format!("Failed to insert mention: {}", e))?;
            }

            // Insert headings
            for heading in &parsed.headings {
                conn.execute(
                    "INSERT INTO headings (file_id, level, text, position) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![file_id, heading.level as i32, heading.text, heading.position as i64],
                )
                .map_err(|e| format!("Failed to insert heading: {}", e))?;
            }

            // Insert tasks
            for task in &parsed.tasks {
                conn.execute(
                    "INSERT INTO tasks (file_id, text, done, position, context_before, context_after) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![file_id, task.text, task.done as i32, task.position as i64, task.context_before, task.context_after],
                )
                .map_err(|e| format!("Failed to insert task: {}", e))?;
            }

            // Insert research metadata
            if let Some(ref research) = parsed.research {
                conn.execute(
                    "INSERT INTO research (file_id, source_url, date_saved, word_count, snippet) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![file_id, research.source_url, research.date_saved, research.word_count as i64, research.snippet],
                )
                .map_err(|e| format!("Failed to insert research: {}", e))?;

                let research_id = conn.last_insert_rowid();
                for tag in &research.tags {
                    conn.execute(
                        "INSERT INTO research_tags (research_id, tag) VALUES (?1, ?2)",
                        rusqlite::params![research_id, tag],
                    )
                    .map_err(|e| format!("Failed to insert research tag: {}", e))?;
                }
            }

            // Insert goal metadata
            if let Some(ref goal) = parsed.goal {
                conn.execute(
                    "INSERT INTO goals (file_id, title, template, total_tasks, completed_tasks) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![file_id, goal.title, goal.template, goal.total_tasks as i64, goal.completed_tasks as i64],
                )
                .map_err(|e| format!("Failed to insert goal: {}", e))?;
            }
        }
        Prepared::Text { body } => {
            // FTS-only indexing for non-markdown text files
            let title = Path::new(file_path)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string());

            conn.execute(
                "INSERT OR REPLACE INTO files (path, name, project_path, content_hash, title, has_frontmatter, indexed_at, mtime, size)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8)",
                rusqlite::params![
                    file_path,
                    file_name,
                    project_path,
                    hash,
                    title,
                    now_ts() as i64,
                    stat.mtime_ns,
                    stat.size,
                ],
            )
            .map_err(|e| format!("Failed to insert file: {}", e))?;

            let file_id = conn.last_insert_rowid();

            conn.execute(
                "INSERT INTO files_fts(rowid, title, body) VALUES (?1, ?2, ?3)",
                rusqlite::params![file_id, title.as_deref().unwrap_or(""), body.as_ref()],
            )
            .map_err(|e| format!("Failed to insert FTS: {}", e))?;
        }
    }

    Ok(())
}

/// What one directory pass did. `read` is the number that matters on an
/// unchanged launch: it should be 0.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct PassCounters {
    /// Indexable files found under the directory.
    pub scanned: usize,
    /// Files whose content was read.
    pub read: usize,
    /// Files whose index rows were rewritten.
    pub changed: usize,
    /// Evicted iCloud files left alone.
    pub skipped_dataless: usize,
    /// Files whose link-graph rows were rewritten.
    pub links_written: usize,
    /// Index rows removed because the file is gone.
    pub pruned: usize,
}

/// The transaction(s) of one directory pass: one on the content database and
/// one on `links.db`, opened lazily by the first write and committed in
/// chunks and at the end (also when the pass unwinds).
///
/// The link graph is committed FIRST. A content row is what lets the next
/// launch skip a file, so it must never be durable before the link rows it
/// vouches for; the other way round only costs a re-read.
struct PassTxn<'a> {
    state: &'a IndexState,
    db: &'a Mutex<Connection>,
}

impl PassTxn<'_> {
    fn commit(&self) {
        self.state.commit_links();
        db::commit_txn(&self.db.lock());
    }
}

impl Drop for PassTxn<'_> {
    fn drop(&mut self) {
        self.commit();
    }
}

/// True for a markdown document that has no row in the link graph yet.
fn missing_from_graph(linked: &Option<HashSet<String>>, file_path: &str) -> bool {
    file_path.ends_with(".md") && linked.as_ref().is_some_and(|known| !known.contains(file_path))
}

/// How many files a pass handles between two `index-progress` events.
const PROGRESS_EVERY: usize = 50;

/// The payload of an `index-progress` event.
///
/// `project_path` names the scope the numbers belong to (`null` for the
/// global `~/Notesage` pass), the same way `index-ready` does. Startup runs
/// one pass per scope, several of them at once, and each counts from zero:
/// without the scope the frontend cannot add them up into one total.
fn progress_payload(project_path: Option<&str>, current: usize, total: usize) -> serde_json::Value {
    serde_json::json!({
        "project_path": project_path,
        "current": current,
        "total": total,
    })
}

/// Whether a pass that has just finished its `done`th file of `total` owes an
/// in-between progress event. The first (`0`) and the last (`total`) event
/// are emitted by the pass itself, unconditionally, so they are not due here.
fn progress_due(done: usize, total: usize) -> bool {
    done > 0 && done < total && done % PROGRESS_EVERY == 0
}

/// Emit `index-progress`. Call with no lock held. `app` is `None` in tests.
fn emit_progress(app: Option<&AppHandle>, project_path: Option<&str>, current: usize, total: usize) {
    if let Some(app) = app {
        let _ = app.emit("index-progress", progress_payload(project_path, current, total));
    }
}

/// Bring a directory's index up to date: content rows and link graph.
///
/// Files are statted, and read only when the stat gate does not hold. The
/// link graph is updated for the files that changed, from the content already
/// read. The connection locks are taken per file (see the lock ordering on
/// [`IndexState`]), and writes go into one transaction per pass, committed
/// every [`PASS_COMMIT_EVERY`] changed files.
fn reindex_directory(
    state: &IndexState,
    db: &Mutex<Connection>,
    fs: &dyn FileAccess,
    dir: &str,
    project_path: Option<&str>,
    app: Option<&AppHandle>,
) -> Result<(IndexStats, PassCounters), String> {
    let start = Instant::now();
    let dir_path = Path::new(dir);
    let mut files = Vec::new();
    scan_files(dir_path, &mut files);
    let paths: Vec<String> = files
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    let total = paths.len();
    let mut counters = PassCounters {
        scanned: total,
        ..PassCounters::default()
    };

    let _ = state.ensure_links_db();
    // Documents the graph already knows. An unchanged document that is NOT in
    // it (links.db deleted or reset on its own) is read once more to restore
    // its links; with an intact graph this costs one query and no reads.
    let linked = state.linked_paths_under(dir);

    let txn = PassTxn { state, db };
    let mut uncommitted = 0;

    // Every pass announces itself, whatever its size, so the frontend can add
    // this scope's total to the overall one before the first file is done.
    emit_progress(app, project_path, 0, total);

    for (i, path_str) in paths.iter().enumerate() {
        match reindex_file(db, fs, path_str, project_path, true) {
            Ok(FileOutcome::Changed(content)) => {
                counters.read += 1;
                counters.changed += 1;
                uncommitted += 1;
                if state.index_links_with_content(path_str, &content, true) {
                    counters.links_written += 1;
                }
            }
            Ok(FileOutcome::UnchangedContent(content)) => {
                counters.read += 1;
                if missing_from_graph(&linked, path_str)
                    && state.index_links_with_content(path_str, &content, true)
                {
                    counters.links_written += 1;
                }
            }
            Ok(FileOutcome::UnchangedStat) => {
                // SECURITY (ADR 0003): the scope check comes before the read.
                if missing_from_graph(&linked, path_str) && state.is_link_source(path_str) {
                    if let Ok(content) = fs.read(Path::new(path_str)) {
                        counters.read += 1;
                        if state.index_links_with_content(path_str, &content, true) {
                            counters.links_written += 1;
                        }
                    }
                }
            }
            Ok(FileOutcome::Dataless) => counters.skipped_dataless += 1,
            Ok(FileOutcome::Ignored) | Ok(FileOutcome::Unreadable) => {}
            Err(e) => {
                log::warn!(target: "notesage::index", "Failed to index {}: {}", path_str, e);
            }
        }

        if uncommitted >= PASS_COMMIT_EVERY {
            txn.commit();
            uncommitted = 0;
        }

        // In between the pass's first and last event (see below), one event
        // every `PROGRESS_EVERY` files. No lock is held here: the connection
        // locks are taken and released inside the calls above.
        if progress_due(i + 1, total) {
            emit_progress(app, project_path, i + 1, total);
        }
    }

    // Prune files that no longer exist on disk, and their links with them.
    let scanned: HashSet<&str> = paths.iter().map(String::as_str).collect();
    let pruned = prune_deleted_files(db, &scanned)?;
    counters.pruned = pruned.len();
    if pruned.iter().any(|path| path.ends_with(".md")) {
        state.begin_links_pass();
        for path in pruned.iter().filter(|path| path.ends_with(".md")) {
            state.remove_links_for_file(path);
        }
    }

    txn.commit();
    drop(txn);

    // ...and every pass ends at `current == total`, once its writes are
    // committed and with nothing locked.
    emit_progress(app, project_path, total, total);

    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    let project_name = project_path.unwrap_or("global");
    // Info, so a launch profile can be read from the log file. `read` is the
    // cost to watch: on a launch where nothing changed it should be 0.
    log::info!(
        target: "notesage::index",
        "[perf:index] build: project={} files={} read={} changed={} skipped_dataless={} links_written={} pruned={} ms={:.1}",
        project_name,
        counters.scanned,
        counters.read,
        counters.changed,
        counters.skipped_dataless,
        counters.links_written,
        counters.pruned,
        elapsed_ms
    );

    log::info!(
        target: "notesage::index",
        "Indexed {}/{} files ({} changed) in {}",
        total, total, counters.changed, dir
    );

    let stats = queries::query_stats(&db.lock())?;
    Ok((stats, counters))
}

/// True when the path, or the placeholder older macOS versions leave for an
/// evicted iCloud file (`.name.icloud` beside it), exists. Uses `stat` only,
/// so it never downloads anything.
fn path_is_present(path: &str) -> bool {
    let path = Path::new(path);
    if path.exists() {
        return true;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => parent
            .join(format!(".{}.icloud", name.to_string_lossy()))
            .exists(),
        _ => false,
    }
}

/// Remove index entries for files that no longer exist on disk, returning
/// their paths.
///
/// A file the scan just listed exists, so only rows the scan did NOT list are
/// checked on disk (rows for files outside the scanned directory, or in a
/// directory the scan skips, are kept as long as the file is there). An
/// evicted iCloud file is listed by the scan and is therefore never pruned.
fn prune_deleted_files(
    db: &Mutex<Connection>,
    scanned: &HashSet<&str>,
) -> Result<Vec<String>, String> {
    let unlisted: Vec<String> = {
        let conn = db.lock();
        let mut stmt = conn
            .prepare("SELECT path FROM files")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok())
            .filter(|path| !scanned.contains(path.as_str()))
            .collect()
    };

    // Disk checks with the connection released.
    let to_delete: Vec<String> = unlisted
        .into_iter()
        .filter(|path| !path_is_present(path))
        .collect();

    if !to_delete.is_empty() {
        let conn = db.lock();
        db::ensure_txn(&conn);
        for path in &to_delete {
            let _ = db::remove_file(&conn, path);
        }
        log::info!(
            target: "notesage::index",
            "Pruned {} deleted files from index",
            to_delete.len()
        );
    }

    Ok(to_delete)
}

/// Remove rows from the GLOBAL database for files that the given project's own
/// database holds, returning how many files were removed.
///
/// A file under a registered project is indexed into that project's database.
/// It can still have rows in the global one: the watcher indexed it there
/// before the project's database was registered (a project added while the
/// app was running used to stay unregistered until the next launch), or it was
/// indexed as a loose library or explorer file before its folder became a
/// project. Nothing else removes those rows (the file exists, so the prune
/// keeps it), and every query adds the global database's answer to the
/// project's, so the file is counted twice.
///
/// Only true duplicates go: a global row whose file the project's database
/// does not hold (an evicted iCloud file its pass skipped, say) is the only
/// copy there is, and is kept.
///
/// `global_pass_dir` is the directory the global pass itself indexes
/// (`~/Notesage`). A project inside it is left alone: that pass indexes
/// everything below it, projects included, and would only write the rows back
/// (after reading every file again).
///
/// Locking (see the ordering on [`IndexState`]): one connection at a time,
/// global, then the project's, then global again, each released before the
/// next is taken. The deletes join the pass transaction if one is open on the
/// global connection and are their own transaction otherwise.
fn purge_project_rows_from_global(
    global: &Mutex<Connection>,
    project: &Mutex<Connection>,
    project_root: &Path,
    global_pass_dir: Option<&Path>,
) -> Result<usize, String> {
    if global_pass_dir.is_some_and(|dir| project_root.starts_with(dir)) {
        return Ok(0);
    }

    // Usually nothing: then the project's database is not asked at all.
    let candidates: Vec<String> = {
        let conn = global.lock();
        let mut stmt = conn
            .prepare("SELECT path FROM files")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        // Component-wise, like `db_for_path`.
        rows.filter_map(|r| r.ok())
            .filter(|path| Path::new(path).starts_with(project_root))
            .collect()
    };
    if candidates.is_empty() {
        return Ok(0);
    }

    let duplicates: Vec<String> = {
        let conn = project.lock();
        let mut stmt = conn
            .prepare("SELECT 1 FROM files WHERE path = ?1")
            .map_err(|e| e.to_string())?;
        candidates
            .into_iter()
            .filter(|path| stmt.exists([path.as_str()]).unwrap_or(false))
            .collect()
    };
    if duplicates.is_empty() {
        return Ok(0);
    }

    let conn = global.lock();
    db::with_savepoint(&conn, || {
        for path in &duplicates {
            db::remove_file(&conn, path).map_err(|e| e.to_string())?;
        }
        Ok(())
    })?;
    log::info!(
        target: "notesage::index",
        "Removed {} files of {} from the global index (they are in the project's own)",
        duplicates.len(),
        project_root.display()
    );
    Ok(duplicates.len())
}

/// Run [`purge_project_rows_from_global`] for a registered project against
/// the open global database. A failure is logged and otherwise ignored: the
/// rows are duplicates, not missing data.
fn drop_project_rows_from_global(state: &IndexState, project_path: &str) {
    // Registry locks are taken and released one at a time, before any
    // connection is locked.
    let Some(global) = state.global_db.lock().clone() else {
        return;
    };
    let Some(project) = state.project_dbs.lock().get(Path::new(project_path)).cloned() else {
        return;
    };
    let pass_dir = global_pass_dir().filter(|dir| dir.is_dir());
    if let Err(e) = purge_project_rows_from_global(
        &global,
        &project,
        Path::new(project_path),
        pass_dir.as_deref(),
    ) {
        log::warn!(
            target: "notesage::index",
            "Could not clean the files of {} out of the global index: {}",
            project_path, e
        );
    }
}

/// The directory the global pass indexes: `~/Notesage`.
fn global_pass_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join("Notesage"))
}

// ---- Tauri Commands ----

/// Run long, synchronous index work on tokio's blocking pool.
///
/// A full reindex walks a directory, parses every file and writes SQLite
/// while holding an index lock. Done on an async worker it ties that worker
/// up for the whole pass, and every other index command then parks a second
/// worker on the same lock, which stalls unrelated async commands.
async fn run_blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| format!("Index task failed: {}", e))?
}

/// Initialize the index for a project or global scope.
/// If project_path is None, initializes the global index.
/// Wraps initialization in catch_unwind to log panics instead of silently poisoning state.
#[tauri::command]
pub async fn index_init(app: AppHandle, project_path: Option<String>) -> Result<IndexStats, String> {
    // `State` borrows from the app handle, so it is looked up inside the
    // closure instead of being moved into it.
    run_blocking(move || {
        let state = app.state::<IndexState>();
        index_init_blocking(&app, &state, project_path)
    })
    .await
}

fn index_init_blocking(
    app: &AppHandle,
    state: &IndexState,
    project_path: Option<String>,
) -> Result<IndexStats, String> {
    if let Some(ref pp) = project_path {
        // Wrap in catch_unwind to capture panics during init
        let pp_clone = pp.clone();
        let init_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            init_project_db(state, &pp_clone)
        }));
        match init_result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(e),
            Err(panic_payload) => {
                let msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = panic_payload.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "unknown panic".to_string()
                };
                log::error!(target: "notesage::index", "Index initialization panicked for {}: {}", pp_clone, msg);
                return Err(format!("Index initialization panicked: {}", msg));
            }
        }

        // Clone the handle out: the registry lock is not held during the pass,
        // and the pass locks the connection per file, so queries interleave.
        let handle = state.project_dbs.lock().get(&PathBuf::from(pp)).cloned();
        let stats = match handle {
            // Content rows and link graph are updated in the same pass.
            Some(db) => reindex_directory(state, &db, &RealFs, pp, Some(pp), Some(app))?.0,
            None => return Err("Failed to get project DB after init".to_string()),
        };
        // The project's own rows are in place; drop the copies the global
        // database may hold for the same files.
        drop_project_rows_from_global(state, pp);
        let _ = app.emit("index-ready", serde_json::json!({ "project_path": pp }));
        Ok(stats)
    } else {
        init_global_db(state)?;
        let _ = state.ensure_links_db();

        let notesage_dir = global_pass_dir().ok_or("Cannot find home directory")?;
        let notesage_str = notesage_dir.to_string_lossy().to_string();

        let handle = state.global_db.lock().clone();
        let stats = match handle {
            Some(db) => {
                if notesage_dir.is_dir() {
                    // Content rows and link graph for the ~/Notesage library.
                    reindex_directory(state, &db, &RealFs, &notesage_str, None, Some(app))?.0
                } else {
                    queries::query_stats(&db.lock())?
                }
            }
            None => return Err("Failed to get global DB after init".to_string()),
        };
        let _ = app.emit("index-ready", serde_json::json!({ "project_path": serde_json::Value::Null }));
        Ok(stats)
    }
}

/// Open the global database and every given project's database WITHOUT
/// indexing anything.
///
/// Startup no longer waits for the index pass, so the file watcher is live
/// while projects are still being indexed one after another. A watcher event
/// for a file in a project whose database is not registered yet would fall
/// back to the global database (`db_for_path`), be indexed there, never be
/// pruned from it, and be counted twice by every query from then on. The
/// frontend therefore calls this before it starts the watchers: opening a
/// database is cheap, and once it is registered events route correctly even
/// though the project's own pass has not run.
///
/// A project whose database cannot be opened is logged and skipped; the
/// index pass that follows reports and recovers it.
#[tauri::command]
pub async fn index_open(app: AppHandle, project_paths: Vec<String>) -> Result<(), String> {
    run_blocking(move || {
        let state = app.state::<IndexState>();
        open_databases(&state, &project_paths);
        Ok(())
    })
    .await
}

fn open_databases(state: &IndexState, project_paths: &[String]) {
    if let Err(e) = init_global_db(state) {
        log::warn!(target: "notesage::index", "Could not open the global index: {}", e);
    }
    for project_path in project_paths {
        let opened = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            init_project_db(state, project_path)
        }));
        match opened {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                log::warn!(target: "notesage::index", "Could not open the index for {}: {}", project_path, e)
            }
            Err(_) => {
                log::warn!(target: "notesage::index", "Opening the index for {} panicked", project_path)
            }
        }
    }
}

/// Force reindex a specific file.
#[tauri::command]
pub async fn index_file(app: AppHandle, path: String) -> Result<(), String> {
    // Off the async workers: this does file I/O and waits on a connection.
    run_blocking(move || {
        let state = app.state::<IndexState>();
        reindex_one(&state, &RealFs, &path)
    })
    .await
}

/// Reindex one file into the database it belongs to, then its links if its
/// content changed (scope-gated; the connection is released first).
fn reindex_one(state: &IndexState, fs: &dyn FileAccess, path: &str) -> Result<(), String> {
    if let Some((db, project_path)) = state.db_for_path(path) {
        if let FileOutcome::Changed(content) =
            reindex_file(&db, fs, path, project_path.as_deref(), false)?
        {
            state.index_links_with_content(path, &content, false);
        }
    }
    Ok(())
}

/// Delete an index database (and WAL/SHM files) and remove it from state.
/// Called before retrying `index_init` when the DB is corrupted.
#[tauri::command]
pub async fn index_reset(
    state: tauri::State<'_, IndexState>,
    project_path: Option<String>,
) -> Result<(), String> {
    if let Some(ref pp) = project_path {
        // Remove the connection from state. It closes when the last handle to
        // it is dropped; taking its lock once (with the registry lock already
        // released) waits out a write that is in flight. A pass still running
        // on the old handle finishes against the unlinked file and its work
        // is discarded, which is what a reset asks for.
        let removed = state.project_dbs.lock().remove(&PathBuf::from(pp));
        if let Some(handle) = removed {
            drop(handle.lock());
        }

        // Delete DB files
        let home = dirs::home_dir().ok_or("Cannot find home directory")?;
        let path_hash = {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            pp.hash(&mut hasher);
            format!("{:x}", hasher.finish())
        };
        let db_dir = home.join(".notesage").join("indexes").join(&path_hash);
        let db_path = db_dir.join("index.db");
        for suffix in &["", "-wal", "-shm"] {
            let p = format!("{}{}", db_path.display(), suffix);
            let _ = std::fs::remove_file(&p);
        }

        log::info!(target: "notesage::index", "Reset project index for {}", pp);
    } else {
        // Remove global DB connection (see the project branch above)
        let removed = state.global_db.lock().take();
        if let Some(handle) = removed {
            drop(handle.lock());
        }

        // Delete DB files
        let home = dirs::home_dir().ok_or("Cannot find home directory")?;
        let db_path = home.join(".notesage").join("index.db");
        for suffix in &["", "-wal", "-shm"] {
            let p = format!("{}{}", db_path.display(), suffix);
            let _ = std::fs::remove_file(&p);
        }

        log::info!(target: "notesage::index", "Reset global index");
    }

    Ok(())
}

/// Helper to run a query across multiple DBs and merge results.
///
/// Queries the project DBs that match the given paths, then always the global
/// DB. Each connection is locked for its own query only, so a reindex pass on
/// the same database delays a query by at most one file's write, and the
/// query sees what that pass has indexed so far.
fn with_dbs<T, F>(
    state: &IndexState,
    project_paths: &[String],
    query_fn: F,
) -> Result<Vec<T>, String>
where
    F: Fn(&Connection) -> Result<Vec<T>, String>,
{
    let mut results = Vec::new();
    for handle in state.query_handles(project_paths) {
        let conn = handle.lock();
        results.extend(query_fn(&conn)?);
    }
    Ok(results)
}

/// Query tags across projects.
#[tauri::command]
pub async fn index_tags(
    app: AppHandle,
    project_paths: Vec<String>,
    query: Option<String>,
) -> Result<Vec<IndexedTag>, String> {
    // Off the async workers: this waits on a connection a reindex may be using.
    run_blocking(move || {
        let state = app.state::<IndexState>();
        let start = Instant::now();
        let mut all_tags: HashMap<String, usize> = HashMap::new();

        let tags_per_db = with_dbs(&state, &project_paths, |conn| {
            queries::query_tags(conn, query.as_deref())
        })?;

        // Merge tags across DBs
        for tag in tags_per_db {
            *all_tags.entry(tag.tag).or_insert(0) += tag.file_count;
        }

        let mut result: Vec<IndexedTag> = all_tags
            .into_iter()
            .map(|(tag, file_count)| IndexedTag { tag, file_count })
            .collect();
        result.sort_by(|a, b| b.file_count.cmp(&a.file_count).then(a.tag.cmp(&b.tag)));

        log::debug!(
            target: "notesage::index",
            "[perf:index] query: type=tags results={} ms={:.1}",
            result.len(), start.elapsed().as_secs_f64() * 1000.0
        );

        Ok(result)
    })
    .await
}

/// Query tag occurrences across projects.
#[tauri::command]
pub async fn index_tag_occurrences(
    app: AppHandle,
    tag: String,
    project_paths: Vec<String>,
) -> Result<Vec<TagOccurrence>, String> {
    // Off the async workers: this waits on a connection a reindex may be using.
    run_blocking(move || {
        let state = app.state::<IndexState>();
        let start = Instant::now();
        let result = with_dbs(&state, &project_paths, |conn| {
            queries::query_tag_occurrences(conn, &tag)
        })?;
        log::debug!(
            target: "notesage::index",
            "[perf:index] query: type=tag_occurrences results={} ms={:.1}",
            result.len(), start.elapsed().as_secs_f64() * 1000.0
        );
        Ok(result)
    })
    .await
}

/// Query mentions across projects.
#[tauri::command]
pub async fn index_mentions(
    app: AppHandle,
    project_paths: Vec<String>,
    query: Option<String>,
) -> Result<Vec<IndexedMention>, String> {
    // Off the async workers: this waits on a connection a reindex may be using.
    run_blocking(move || {
        let state = app.state::<IndexState>();
        let start = Instant::now();
        let mut all_mentions: HashMap<String, usize> = HashMap::new();

        let mentions_per_db = with_dbs(&state, &project_paths, |conn| {
            queries::query_mentions(conn, query.as_deref())
        })?;

        for mention in mentions_per_db {
            *all_mentions.entry(mention.mention).or_insert(0) += mention.file_count;
        }

        let mut result: Vec<IndexedMention> = all_mentions
            .into_iter()
            .map(|(mention, file_count)| IndexedMention { mention, file_count })
            .collect();
        result.sort_by(|a, b| b.file_count.cmp(&a.file_count).then(a.mention.cmp(&b.mention)));

        log::debug!(
            target: "notesage::index",
            "[perf:index] query: type=mentions results={} ms={:.1}",
            result.len(), start.elapsed().as_secs_f64() * 1000.0
        );

        Ok(result)
    })
    .await
}

/// Query mention occurrences across projects.
#[tauri::command]
pub async fn index_mention_occurrences(
    app: AppHandle,
    mention: String,
    project_paths: Vec<String>,
) -> Result<Vec<TagOccurrence>, String> {
    // Off the async workers: this waits on a connection a reindex may be using.
    run_blocking(move || {
        let state = app.state::<IndexState>();
        let start = Instant::now();
        let result = with_dbs(&state, &project_paths, |conn| {
            queries::query_mention_occurrences(conn, &mention)
        })?;
        log::debug!(
            target: "notesage::index",
            "[perf:index] query: type=mention_occurrences results={} ms={:.1}",
            result.len(), start.elapsed().as_secs_f64() * 1000.0
        );
        Ok(result)
    })
    .await
}

/// Search research files across projects.
#[tauri::command]
pub async fn index_search_research(
    app: AppHandle,
    project_paths: Vec<String>,
    query: Option<String>,
    tag: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ResearchResult>, String> {
    // Off the async workers: this waits on a connection a reindex may be using.
    run_blocking(move || {
        let state = app.state::<IndexState>();
        let start = Instant::now();
        let lim = limit.unwrap_or(50);
        let result = with_dbs(&state, &project_paths, |conn| {
            queries::query_research(conn, query.as_deref(), tag.as_deref(), lim)
        })?;
        log::debug!(
            target: "notesage::index",
            "[perf:index] query: type=search_research results={} ms={:.1}",
            result.len(), start.elapsed().as_secs_f64() * 1000.0
        );
        Ok(result)
    })
    .await
}

/// Query tasks across projects.
#[tauri::command]
pub async fn index_tasks(
    app: AppHandle,
    project_paths: Vec<String>,
    done: Option<bool>,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<IndexedTask>, String> {
    // Off the async workers: this waits on a connection a reindex may be using.
    run_blocking(move || {
        let state = app.state::<IndexState>();
        let start = Instant::now();
        let lim = limit.unwrap_or(500);
        let result = with_dbs(&state, &project_paths, |conn| {
            queries::query_tasks(conn, done, query.as_deref(), lim)
        })?;
        log::debug!(
            target: "notesage::index",
            "[perf:index] query: type=tasks results={} ms={:.1}",
            result.len(), start.elapsed().as_secs_f64() * 1000.0
        );
        Ok(result)
    })
    .await
}

/// Toggle a task's completion status via context-based matching.
#[tauri::command]
pub async fn index_toggle_task(
    app: AppHandle,
    path: String,
    context_before: String,
    context_after: String,
    task_text: String,
    done: bool,
) -> Result<(), String> {
    // Off the async workers: file I/O, and a wait on a connection.
    run_blocking(move || {
        // Read current file content
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read file: {}", e))?;

        // Toggle the task
        let new_content = tasks::toggle_task_in_content(
            &content,
            &task_text,
            &context_before,
            &context_after,
            done,
        )?;

        // Mark as self-write to suppress watcher
        if let Some(watcher_state) = app.try_state::<crate::commands::WatcherState>() {
            let normalized = std::fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(&path));
            watcher_state.self_writes.lock().insert(normalized, Instant::now());
        }

        // Write file
        std::fs::write(&path, &new_content)
            .map_err(|e| format!("Failed to write file: {}", e))?;

        // Reindex the file, and its link edges if the content changed.
        let state = app.state::<IndexState>();
        reindex_one(&state, &RealFs, &path)
    })
    .await
}

/// Query goals across projects.
#[tauri::command]
pub async fn index_goals(
    app: AppHandle,
    project_paths: Vec<String>,
) -> Result<Vec<IndexedGoal>, String> {
    // Off the async workers: this waits on a connection a reindex may be using.
    run_blocking(move || {
        let state = app.state::<IndexState>();
        let start = Instant::now();
        let result = with_dbs(&state, &project_paths, |conn| queries::query_goals(conn))?;
        log::debug!(
            target: "notesage::index",
            "[perf:index] query: type=goals results={} ms={:.1}",
            result.len(), start.elapsed().as_secs_f64() * 1000.0
        );
        Ok(result)
    })
    .await
}

/// Full-text content search across projects.
#[tauri::command]
pub async fn index_search_content(
    app: AppHandle,
    project_paths: Vec<String>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<ContentSearchResult>, String> {
    // Off the async workers: this waits on a connection a reindex may be using.
    run_blocking(move || {
        let state = app.state::<IndexState>();
        let start = Instant::now();
        let lim = limit.unwrap_or(50);
        let result = with_dbs(&state, &project_paths, |conn| {
            queries::query_content(conn, &query, lim)
        })?;
        log::debug!(
            target: "notesage::index",
            "[perf:index] query: type=search_content results={} ms={:.1}",
            result.len(), start.elapsed().as_secs_f64() * 1000.0
        );
        Ok(result)
    })
    .await
}

/// Filename substring search across projects.
///
/// Powers the FloatingCommandBar `:file` verb mode (PRD
/// `2026-04-28-cmd-bar-verb-prefixes`). Empty queries return an empty
/// list — the frontend renders an MRU list from `editor-store.recentFiles`
/// in that case rather than dumping every indexed file.
#[tauri::command]
pub async fn index_search_filenames(
    app: AppHandle,
    project_paths: Vec<String>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<FilenameSearchResult>, String> {
    // Off the async workers: this waits on a connection a reindex may be using.
    run_blocking(move || {
        let state = app.state::<IndexState>();
        let start = Instant::now();
        let lim = limit.unwrap_or(50);
        let result = with_dbs(&state, &project_paths, |conn| {
            queries::query_filenames(conn, &query, lim)
        })?;
        log::debug!(
            target: "notesage::index",
            "[perf:index] query: type=search_filenames results={} ms={:.1}",
            result.len(), start.elapsed().as_secs_f64() * 1000.0
        );
        Ok(result)
    })
    .await
}

// ---- Link-graph commands (OKF wiki-navigation, ADR 0002–0007) ----
//
// All four query the standalone `links.db` (NOT the content index), keeping the
// cross-project link graph physically isolated from anything that feeds AI
// context (ADR 0002/0003). Each returns `Result<T, String>` per the
// tauri-commands conventions.

/// Backlinks ("Linked from") for a target document, grouped by source document
/// with each source's frontmatter (title/type/description) and occurrence
/// context (ADR 0006).
#[tauri::command]
pub async fn get_backlinks(
    state: tauri::State<'_, IndexState>,
    path: String,
) -> Result<Vec<links::BacklinkGroup>, String> {
    let start = Instant::now();
    state.ensure_links_db()?;
    let guard = state.links_db.lock();
    let conn = guard
        .as_ref()
        .ok_or_else(|| "Links DB not initialized".to_string())?;
    let result = links::query_backlinks(conn, &path)?;
    log::debug!(
        target: "notesage::index",
        "[perf:index] query: type=backlinks results={} ms={:.1}",
        result.len(), start.elapsed().as_secs_f64() * 1000.0
    );
    Ok(result)
}

/// Outgoing ("Links to") links from a source document, enriched with each
/// target's frontmatter (title/type/description, ADR 0006).
#[tauri::command]
pub async fn get_outlinks(
    state: tauri::State<'_, IndexState>,
    path: String,
) -> Result<Vec<links::LinkRow>, String> {
    let start = Instant::now();
    state.ensure_links_db()?;
    let guard = state.links_db.lock();
    let conn = guard
        .as_ref()
        .ok_or_else(|| "Links DB not initialized".to_string())?;
    let result = links::query_outlinks(conn, &path)?;
    log::debug!(
        target: "notesage::index",
        "[perf:index] query: type=outlinks results={} ms={:.1}",
        result.len(), start.elapsed().as_secs_f64() * 1000.0
    );
    Ok(result)
}

/// Broken / dangling internal links across the given scope (unresolved
/// internal edges). An empty `scope` returns every broken link.
#[tauri::command]
pub async fn get_broken_links(
    state: tauri::State<'_, IndexState>,
    scope: Vec<String>,
) -> Result<Vec<links::LinkRow>, String> {
    let start = Instant::now();
    state.ensure_links_db()?;
    let guard = state.links_db.lock();
    let conn = guard
        .as_ref()
        .ok_or_else(|| "Links DB not initialized".to_string())?;
    let result = links::query_broken_links(conn, &scope)?;
    log::debug!(
        target: "notesage::index",
        "[perf:index] query: type=broken_links results={} ms={:.1}",
        result.len(), start.elapsed().as_secs_f64() * 1000.0
    );
    Ok(result)
}

/// Resolve a wikilink query against the link store — matches filename + title
/// workspace-global (ADR 0002).
#[tauri::command]
pub async fn resolve_wikilink(
    state: tauri::State<'_, IndexState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<links::WikiTarget>, String> {
    let start = Instant::now();
    state.ensure_links_db()?;
    let lim = limit.unwrap_or(20);
    let guard = state.links_db.lock();
    let conn = guard
        .as_ref()
        .ok_or_else(|| "Links DB not initialized".to_string())?;
    let result = links::resolve_wikilink(conn, &query, lim)?;
    log::debug!(
        target: "notesage::index",
        "[perf:index] query: type=resolve_wikilink results={} ms={:.1}",
        result.len(), start.elapsed().as_secs_f64() * 1000.0
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    use super::reindex_queue::process_entries;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::Duration;

    /// A filesystem that counts reads, can present files as evicted from
    /// iCloud, and can pause inside a read so a test can look at the index
    /// while a pass is in the middle of its work.
    #[derive(Default)]
    struct TestFs {
        reads: AtomicUsize,
        read_paths: Mutex<Vec<String>>,
        dataless: Mutex<HashSet<PathBuf>>,
        /// Pause inside the Nth read (1-based); 0 never pauses.
        pause_on_read: AtomicUsize,
        paused: AtomicBool,
        resume: AtomicBool,
    }

    impl TestFs {
        fn reads(&self) -> usize {
            self.reads.load(Ordering::SeqCst)
        }

        fn take_read_paths(&self) -> Vec<String> {
            std::mem::take(&mut *self.read_paths.lock())
        }
    }

    impl FileAccess for TestFs {
        fn stat(&self, path: &Path) -> std::io::Result<FileStat> {
            let evicted = self.dataless.lock().contains(path);
            fs_access::stat_with(path, |_| evicted)
        }

        fn read(&self, path: &Path) -> std::io::Result<String> {
            assert!(
                !self.dataless.lock().contains(path),
                "{} is dataless: reading it would download it",
                path.display()
            );
            let nth = self.reads.fetch_add(1, Ordering::SeqCst) + 1;
            self.read_paths.lock().push(path.to_string_lossy().to_string());
            if nth == self.pause_on_read.load(Ordering::SeqCst) {
                self.paused.store(true, Ordering::SeqCst);
                while !self.resume.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(2));
                }
            }
            std::fs::read_to_string(path)
        }
    }

    /// Lets a paused read continue even when the test fails first.
    struct ResumeOnDrop<'a>(&'a TestFs);

    impl Drop for ResumeOnDrop<'_> {
        fn drop(&mut self) {
            self.0.resume.store(true, Ordering::SeqCst);
        }
    }

    /// One registered project with its own index database and link store, all
    /// under a temp directory (nothing touches `~/.notesage`).
    struct Harness {
        _tmp: tempfile::TempDir,
        state: IndexState,
        db: DbHandle,
        project: String,
        fs: TestFs,
    }

    impl Harness {
        fn new() -> Self {
            // A non-dot prefix so the path has no dotfolder component (on
            // Linux, tempfile::tempdir() creates /tmp/.tmpXXX).
            let tmp = tempfile::Builder::new()
                .prefix("notesage_test_")
                .tempdir()
                .unwrap();
            let project_dir = tmp.path().join("project");
            std::fs::create_dir_all(&project_dir).unwrap();
            let project = project_dir.to_string_lossy().to_string();

            let db: DbHandle = Arc::new(Mutex::new(
                db::open_or_create(&tmp.path().join("index.db")).unwrap(),
            ));
            let state = IndexState::new();
            state
                .project_dbs
                .lock()
                .insert(PathBuf::from(&project), db.clone());
            *state.links_db.lock() =
                Some(links::open_or_create(&tmp.path().join("links.db")).unwrap());

            Self {
                _tmp: tmp,
                state,
                db,
                project,
                fs: TestFs::default(),
            }
        }

        fn path(&self, name: &str) -> String {
            format!("{}/{}", self.project, name)
        }

        /// Write a file whose mtime is `age_secs` in the past. Files written
        /// "now" are inside the racy-stat window and are deliberately re-read,
        /// so tests of the stat gate need files that look settled.
        fn write_aged(&self, name: &str, content: &str, age_secs: u64) -> String {
            let path = self.path(name);
            std::fs::write(&path, content).unwrap();
            self.set_age(name, age_secs);
            path
        }

        fn set_age(&self, name: &str, age_secs: u64) {
            let file = std::fs::File::options()
                .write(true)
                .open(self.path(name))
                .unwrap();
            file.set_modified(SystemTime::now() - Duration::from_secs(age_secs))
                .unwrap();
        }

        fn pass(&self) -> PassCounters {
            reindex_directory(
                &self.state,
                &self.db,
                &self.fs,
                &self.project,
                Some(&self.project),
                None,
            )
            .unwrap()
            .1
        }

        fn count(&self, sql: &str) -> i64 {
            self.db.lock().query_row(sql, [], |row| row.get(0)).unwrap()
        }

        /// Paths of the files whose full-text rows match `term`.
        fn search(&self, term: &str) -> Vec<String> {
            let conn = self.db.lock();
            let mut stmt = conn
                .prepare(
                    "SELECT f.path FROM files_fts JOIN files f ON files_fts.rowid = f.id
                     WHERE files_fts MATCH ?1 ORDER BY f.path",
                )
                .unwrap();
            let rows = stmt.query_map([term], |row| row.get::<_, String>(0)).unwrap();
            rows.map(|r| r.unwrap()).collect()
        }

        fn links_changes(&self) -> u64 {
            self.state.links_db.lock().as_ref().unwrap().total_changes()
        }

        fn outlinks(&self, name: &str) -> Vec<String> {
            let guard = self.state.links_db.lock();
            links::query_outlinks(guard.as_ref().unwrap(), &self.path(name))
                .unwrap()
                .into_iter()
                .map(|row| row.target_path)
                .collect()
        }
    }

    /// Three linked notes and a text file, all old enough to be "settled".
    fn seeded() -> Harness {
        let h = Harness::new();
        h.write_aged("alpha.md", "# Alpha\n\nSee [beta](beta.md). firstdraft #topic\n", 100);
        h.write_aged("beta.md", "# Beta\n\nBack to [alpha](alpha.md). betaonly\n", 100);
        h.write_aged("gamma.md", "# Gamma\n\n- [ ] a task\n", 100);
        h.write_aged("notes.txt", "plain text file\n", 100);
        h
    }

    /// Files inside dotfolders (e.g. .git/) must be skipped by the
    /// watcher-triggered reindex path, just as scan_files skips them during
    /// bulk indexing.
    #[test]
    fn the_progress_payload_names_its_scope() {
        let project = progress_payload(Some("/lib/Work"), 50, 120);
        assert_eq!(
            project,
            serde_json::json!({ "project_path": "/lib/Work", "current": 50, "total": 120 })
        );

        // The global pass has no project: an explicit null, as in `index-ready`.
        let global = progress_payload(None, 0, 0);
        assert_eq!(global["project_path"], serde_json::Value::Null);
        assert_eq!(global["current"], 0);
        assert_eq!(global["total"], 0);
        assert_eq!(global.as_object().map(|o| o.len()), Some(3));
    }

    #[test]
    fn in_between_progress_is_due_every_fifty_files_and_never_at_the_ends() {
        // The pass emits 0 and `total` itself; neither is due a second time.
        assert!(!progress_due(0, 120));
        assert!(!progress_due(120, 120));
        assert!(!progress_due(50, 50));
        assert!(!progress_due(0, 0));

        assert!(progress_due(50, 120));
        assert!(progress_due(100, 120));
        assert!(!progress_due(49, 120));
        assert!(!progress_due(51, 120));

        // A small pass has nothing in between: just its first and last event.
        assert_eq!((1..=7).filter(|done| progress_due(*done, 7)).count(), 0);
        assert_eq!((1..=120).filter(|done| progress_due(*done, 120)).count(), 2);
    }

    #[test]
    fn reindex_file_skips_dotfolder_paths() {
        let h = Harness::new();
        let git_dir = Path::new(&h.project).join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        let md_file = git_dir.join("notes.md");
        std::fs::write(&md_file, "# Git notes\n#secret-tag @secret-mention").unwrap();
        let path_str = md_file.to_string_lossy().to_string();
        let outcome = reindex_file(&h.db, &h.fs, &path_str, None, false).unwrap();
        assert!(
            matches!(outcome, FileOutcome::Ignored),
            "dotfolder paths must be ignored, got {:?}",
            outcome
        );
        assert_eq!(h.fs.reads(), 0, "an ignored file must not be read");
        assert_eq!(
            h.count("SELECT COUNT(*) FROM files"),
            0,
            "Files under dotfolders must not be inserted into the index"
        );
    }

    /// Regression guard: normal paths must still be indexed.
    #[test]
    fn reindex_file_indexes_normal_paths() {
        let h = Harness::new();
        let path = h.write_aged("my_note.md", "# My Note\nSome content", 100);
        let outcome = reindex_file(&h.db, &h.fs, &path, None, false).unwrap();
        assert!(matches!(outcome, FileOutcome::Changed(_)), "{:?}", outcome);
        assert_eq!(h.count("SELECT COUNT(*) FROM files"), 1, "Normal path files must be indexed");
        assert_eq!(
            h.count("SELECT COUNT(*) FROM files WHERE mtime IS NOT NULL AND size = 22"),
            1,
            "the stat must be stored with the row"
        );
        assert!(h.db.lock().is_autocommit(), "a single-file reindex must commit");
    }

    #[test]
    fn an_unchanged_pass_reads_no_files() {
        let h = seeded();

        let first = h.pass();
        assert_eq!(
            first,
            PassCounters {
                scanned: 4,
                read: 4,
                changed: 4,
                skipped_dataless: 0,
                links_written: 3,
                pruned: 0,
            }
        );
        assert_eq!(h.fs.reads(), 4);

        let content_changes = h.db.lock().total_changes();
        let second = h.pass();
        assert_eq!(
            second,
            PassCounters {
                scanned: 4,
                ..PassCounters::default()
            },
            "nothing changed, so nothing may be read or written"
        );
        assert_eq!(h.fs.reads(), 4, "the second pass must not read any file");
        assert_eq!(h.db.lock().total_changes(), content_changes);
        assert!(h.db.lock().is_autocommit(), "the pass must leave no transaction open");
    }

    #[test]
    fn a_changed_mtime_rereads_only_that_file() {
        let h = seeded();
        h.pass();
        h.fs.take_read_paths();

        // New content: reindexed.
        let beta = h.write_aged("beta.md", "# Beta\n\nRewritten paragraph.\n", 50);
        let counters = h.pass();
        assert_eq!((counters.read, counters.changed), (1, 1));
        assert_eq!(h.fs.take_read_paths(), vec![beta.clone()]);
        assert_eq!(h.search("rewritten"), vec![beta.clone()]);

        // Touched only (mtime moved, same bytes): read once, the hash says
        // unchanged, nothing is rewritten, and the new stat is remembered.
        h.set_age("beta.md", 30);
        let counters = h.pass();
        assert_eq!((counters.read, counters.changed, counters.links_written), (1, 0, 0));
        assert_eq!(h.fs.take_read_paths(), vec![beta]);
        let counters = h.pass();
        assert_eq!(counters.read, 0);

        // Same mtime, different size: read.
        let gamma = h.path("gamma.md");
        let mtime = std::fs::metadata(&gamma).unwrap().modified().unwrap();
        std::fs::write(&gamma, "# Gamma\n\n- [ ] a task\n- [ ] another\n").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&gamma)
            .unwrap()
            .set_modified(mtime)
            .unwrap();
        let counters = h.pass();
        assert_eq!((counters.read, counters.changed), (1, 1));
        assert_eq!(h.count("SELECT COUNT(*) FROM tasks"), 2);
    }

    #[test]
    fn rows_from_before_the_stat_columns_are_rebuilt_once_then_gated() {
        let h = seeded();
        h.pass();
        // What a database looks like right after the v2 migration: rows kept,
        // no stat, full-text table empty. beta is evicted from iCloud.
        h.db.lock()
            .execute_batch("UPDATE files SET mtime = NULL, size = NULL; DELETE FROM files_fts;")
            .unwrap();
        let beta = h.path("beta.md");
        h.fs.dataless.lock().insert(PathBuf::from(&beta));

        // Every local file is read and rewritten (same hash or not), which
        // restores its full-text row and rebuilds the link graph.
        let counters = h.pass();
        assert_eq!(
            (counters.read, counters.changed, counters.links_written, counters.skipped_dataless),
            (3, 3, 2, 1)
        );
        assert_eq!(h.search("firstdraft"), vec![h.path("alpha.md")]);
        // The evicted file keeps the rows it had; it was not read.
        assert_eq!(h.count("SELECT COUNT(*) FROM files"), 4);
        assert_eq!(h.count("SELECT COUNT(*) FROM files WHERE mtime IS NULL"), 1);

        assert_eq!(h.pass().read, 0, "the stored stat must gate the next pass");

        // When it is local again it is rebuilt like the others were.
        h.fs.dataless.lock().clear();
        let counters = h.pass();
        assert_eq!((counters.read, counters.changed), (1, 1));
        assert_eq!(h.search("betaonly"), vec![beta]);
        assert_eq!(h.count("SELECT COUNT(*) FROM files_fts"), 4);
    }

    #[test]
    fn a_file_modified_moments_before_it_was_indexed_is_not_trusted_by_stat() {
        // Written "now": a second write in the same timestamp tick with the
        // same size would be invisible to the stat, so the content is checked.
        let h = Harness::new();
        std::fs::write(h.path("fresh.md"), "# Fresh\n").unwrap();
        assert_eq!(h.pass().changed, 1);
        let counters = h.pass();
        assert_eq!((counters.read, counters.changed), (1, 0));

        let row = IndexedRow {
            hash: String::new(),
            mtime: Some(10_000_000_000),
            size: Some(5),
            indexed_at: 10 + RACY_STAT_WINDOW_SECS,
        };
        let stat = FileStat { mtime_ns: 10_000_000_000, size: 5, dataless: false };
        assert!(stat_gate_holds(&row, &stat));
        assert!(!stat_gate_holds(&IndexedRow { indexed_at: 10 + RACY_STAT_WINDOW_SECS - 1, ..row_copy(&row) }, &stat));
        assert!(!stat_gate_holds(&row, &FileStat { size: 6, ..stat }));
        assert!(!stat_gate_holds(&row, &FileStat { mtime_ns: 10_000_000_001, ..stat }));
        assert!(!stat_gate_holds(&IndexedRow { mtime: None, ..row_copy(&row) }, &stat));
    }

    fn row_copy(row: &IndexedRow) -> IndexedRow {
        IndexedRow {
            hash: row.hash.clone(),
            mtime: row.mtime,
            size: row.size,
            indexed_at: row.indexed_at,
        }
    }

    #[test]
    fn a_dataless_file_is_skipped_and_not_pruned() {
        let h = seeded();
        h.pass();
        let beta = h.path("beta.md");

        // beta is evicted (and its stat no longer matches the row), and a
        // never-indexed evicted file sits beside it. TestFs::read panics if
        // either is read.
        h.set_age("beta.md", 40);
        h.write_aged("evicted.md", "# Evicted\n\nremote words\n", 100);
        let evicted = h.path("evicted.md");
        h.fs.dataless.lock().extend([PathBuf::from(&beta), PathBuf::from(&evicted)]);
        let reads = h.fs.reads();

        let counters = h.pass();
        assert_eq!(
            counters,
            PassCounters {
                scanned: 5,
                skipped_dataless: 2,
                ..PassCounters::default()
            }
        );
        assert_eq!(h.fs.reads(), reads, "a dataless file must not be read");
        assert_eq!(
            h.search("betaonly"),
            vec![beta.clone()],
            "the evicted file's existing rows must be left alone"
        );
        assert_eq!(h.outlinks("beta.md").len(), 1, "and so must its links");
        assert_eq!(h.count("SELECT COUNT(*) FROM files"), 4);

        // The watcher path treats it the same way.
        let outcome = reindex_file(&h.db, &h.fs, &evicted, Some(&h.project), false).unwrap();
        assert!(matches!(outcome, FileOutcome::Dataless), "{:?}", outcome);

        // Once local again, both are picked up: the new file is indexed, and
        // beta (stat differs from its row) is read and found unchanged.
        h.fs.dataless.lock().clear();
        let counters = h.pass();
        assert_eq!((counters.read, counters.changed, counters.skipped_dataless), (2, 1, 0));
        assert_eq!(h.search("remote"), vec![evicted]);
    }

    #[test]
    fn repeated_reindex_of_a_changed_file_does_not_grow_or_go_stale() {
        let h = seeded();
        h.pass();
        let alpha = h.path("alpha.md");

        for round in 0..6u64 {
            h.write_aged(
                "alpha.md",
                &format!("# Alpha\n\nrevision{} keepsake\n", round),
                90 - round,
            );
            assert_eq!(h.pass().changed, 1);
        }

        assert_eq!(h.count("SELECT COUNT(*) FROM files"), 4);
        assert_eq!(
            h.count("SELECT COUNT(*) FROM files_fts"),
            4,
            "one full-text row per file, however often a file was reindexed"
        );
        assert_eq!(h.search("keepsake"), vec![alpha.clone()]);
        assert_eq!(h.search("revision5"), vec![alpha]);
        for stale in ["revision0", "revision4", "firstdraft"] {
            assert!(
                h.search(stale).is_empty(),
                "text of an earlier version must not match: {}",
                stale
            );
        }
        // The command-level query agrees (and works against the real,
        // contentless table: a hit has no snippet text, not an error).
        let content_hits = |term: &str| -> Vec<String> {
            with_dbs(&h.state, &[h.project.clone()], |conn| {
                queries::query_content(conn, term, 50)
            })
            .unwrap()
            .into_iter()
            .map(|hit| hit.path)
            .collect()
        };
        assert!(content_hits("revision0").is_empty());
        assert_eq!(content_hits("revision5"), vec![h.path("alpha.md")]);

        // A deleted file's text goes too.
        std::fs::remove_file(h.path("notes.txt")).unwrap();
        assert_eq!(h.pass().pruned, 1);
        assert!(h.search("plain").is_empty());
        assert_eq!(h.count("SELECT COUNT(*) FROM files_fts"), 3);
    }

    #[test]
    fn saved_html_is_indexed_by_its_visible_text_only_up_to_the_cap() {
        let h = Harness::new();
        let page = h.write_aged(
            "page.html",
            "<!DOCTYPE html><html><head><title>Harbour</title>\
             <style>.lighthouse { color: red }</style>\
             <script>var secretToken = 'abc';</script></head>\
             <body><div class=\"wrapperclass\"><p>The ferry leaves at dawn.</p>\
             <img src=\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ\">\
             </div></body></html>",
            100,
        );
        // More visible text than the cap allows: the tail is not indexed.
        let filler = "lorem ".repeat(html_text::MAX_HTML_TEXT_CHARS / 6 + 10);
        let long = h.write_aged(
            "long.htm",
            &format!("<html><body><p>earlymarker {} latemarker</p></body></html>", filler),
            100,
        );
        // Markdown is not run through the HTML stripper.
        let note = h.write_aged("note.md", "# Note\n\nwrapperclass in prose\n", 100);

        assert_eq!(h.pass().changed, 3);

        assert_eq!(h.search("ferry"), vec![page.clone()]);
        assert_eq!(h.search("harbour"), vec![page]);
        for markup in ["secretToken", "lighthouse", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ", "DOCTYPE"] {
            assert!(h.search(markup).is_empty(), "{} must not be indexed", markup);
        }
        assert_eq!(h.search("wrapperclass"), vec![note], "only the prose mention matches");
        assert_eq!(h.search("earlymarker"), vec![long]);
        assert!(h.search("latemarker").is_empty(), "text past the cap must not be indexed");
    }

    #[test]
    fn the_link_pass_writes_nothing_for_unchanged_files() {
        let h = seeded();
        assert_eq!(h.pass().links_written, 3);
        assert_eq!(h.outlinks("alpha.md"), vec![h.path("beta.md")]);
        assert_eq!(h.outlinks("beta.md"), vec![h.path("alpha.md")]);

        let before = h.links_changes();
        let counters = h.pass();
        assert_eq!(counters.links_written, 0);
        assert_eq!(h.links_changes(), before, "an unchanged pass must not write to links.db");
        assert!(
            h.state.links_db.lock().as_ref().unwrap().is_autocommit(),
            "the pass must leave no transaction open on links.db"
        );

        // A changed file's links are rewritten, from the content already read.
        h.fs.take_read_paths();
        h.write_aged("alpha.md", "# Alpha\n\nNow see [gamma](gamma.md).\n", 60);
        let counters = h.pass();
        assert_eq!((counters.read, counters.links_written), (1, 1));
        assert_eq!(h.fs.take_read_paths().len(), 1, "the file is read once for both stores");
        assert_eq!(h.outlinks("alpha.md"), vec![h.path("gamma.md")]);
        assert_eq!(h.outlinks("beta.md"), vec![h.path("alpha.md")]);
    }

    #[test]
    fn a_missing_link_graph_is_rebuilt_and_deleted_files_lose_their_links() {
        let h = seeded();
        h.pass();

        // links.db was reset on its own: the content index is intact, so the
        // stat gate holds for every file, but the graph must come back.
        links::clear_all(h.state.links_db.lock().as_ref().unwrap()).unwrap();
        assert!(h.outlinks("alpha.md").is_empty());
        let counters = h.pass();
        assert_eq!((counters.changed, counters.links_written, counters.read), (0, 3, 3));
        assert_eq!(h.outlinks("alpha.md"), vec![h.path("beta.md")]);
        assert_eq!(h.pass().read, 0, "restored once, not on every pass");

        // A file deleted while the app was closed: its rows and links go.
        std::fs::remove_file(h.path("alpha.md")).unwrap();
        let counters = h.pass();
        assert_eq!(counters.pruned, 1);
        assert!(h.outlinks("alpha.md").is_empty());
        assert_eq!(h.count("SELECT COUNT(*) FROM files"), 3);
        // beta's edge to the deleted file survives as a pending reference.
        assert_eq!(h.outlinks("beta.md"), vec![h.path("alpha.md")]);
    }

    #[test]
    fn a_query_made_while_a_reindex_is_in_progress_returns() {
        let h = Harness::new();
        for i in 0..5 {
            h.write_aged(&format!("note{}.md", i), &format!("# Note {}\n", i), 100);
        }
        // The pass stops inside its third read, with two files indexed.
        h.fs.pause_on_read.store(3, Ordering::SeqCst);

        let h = &h;
        std::thread::scope(|scope| {
            let resume = ResumeOnDrop(&h.fs);
            let pass = scope.spawn(|| h.pass());

            let deadline = Instant::now() + Duration::from_secs(20);
            while !h.fs.paused.load(Ordering::SeqCst) {
                assert!(Instant::now() < deadline, "the pass never reached its third read");
                std::thread::sleep(Duration::from_millis(2));
            }

            let (tx, rx) = std::sync::mpsc::channel();
            scope.spawn(move || {
                let found = with_dbs(&h.state, &[h.project.clone()], |conn| {
                    queries::query_filenames(conn, "note", 50)
                });
                let _ = tx.send(found);
            });
            let found = rx
                .recv_timeout(Duration::from_secs(10))
                .expect("the query waited for the whole reindex pass")
                .unwrap();
            assert_eq!(found.len(), 2, "the query sees what the pass has indexed so far");
            assert!(h.fs.paused.load(Ordering::SeqCst) && !h.fs.resume.load(Ordering::SeqCst));

            // Other lookups used while indexing do not wait either.
            assert!(h.state.db_for_path(&h.path("note0.md")).is_some());
            assert_eq!(h.state.health_info().1, 1);

            drop(resume);
            let counters = pass.join().unwrap();
            assert_eq!((counters.read, counters.changed), (5, 5));
        });

        assert_eq!(h.count("SELECT COUNT(*) FROM files"), 5);
        assert!(h.db.lock().is_autocommit());
    }

    #[test]
    fn a_pass_commits_what_it_wrote() {
        let h = seeded();
        h.pass();
        // A second connection only sees committed rows.
        let other = Connection::open(h._tmp.path().join("index.db")).unwrap();
        let committed: i64 = other
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .unwrap();
        assert_eq!(committed, 4, "the pass must commit what it wrote");
    }

    fn entry(path: &str, kind: crate::commands::watcher::FileChangeKind) -> ReindexEntry {
        ReindexEntry {
            path: path.to_string(),
            kind,
        }
    }

    #[test]
    fn the_watcher_queue_reads_only_changed_files_and_keeps_links_in_step() {
        use crate::commands::watcher::FileChangeKind;
        let h = seeded();
        h.pass();
        let alpha = h.path("alpha.md");
        let beta = h.path("beta.md");
        let reads = h.fs.reads();
        let links_before = h.links_changes();

        // An event for a file that did not change (a metadata-only event that
        // got through): no read, no link write, still announced.
        let affected = process_entries(
            &h.state,
            &h.fs,
            vec![entry(&alpha, FileChangeKind::Modify)],
        );
        assert_eq!(affected, vec![alpha.clone()]);
        assert_eq!(h.fs.reads(), reads);
        assert_eq!(h.links_changes(), links_before);

        // A real change: one read, content and links both updated.
        h.write_aged("alpha.md", "# Alpha\n\nNow [gamma](gamma.md). queuedword\n", 50);
        let affected = process_entries(
            &h.state,
            &h.fs,
            vec![entry(&alpha, FileChangeKind::Modify)],
        );
        assert_eq!(affected, vec![alpha.clone()]);
        assert_eq!(h.fs.reads(), reads + 1);
        assert_eq!(h.search("queuedword"), vec![alpha.clone()]);
        assert_eq!(h.outlinks("alpha.md"), vec![h.path("gamma.md")]);
        assert!(h.db.lock().is_autocommit());

        // A delete: rows and links removed.
        std::fs::remove_file(&beta).unwrap();
        let affected = process_entries(
            &h.state,
            &h.fs,
            vec![entry(&beta, FileChangeKind::Delete)],
        );
        assert_eq!(affected, vec![beta]);
        assert!(h.search("betaonly").is_empty());
        assert!(h.outlinks("beta.md").is_empty());
    }

    /// Index a file into the given database the way the watcher does.
    fn index_into(h: &Harness, db: &DbHandle, path: &str) {
        let outcome = reindex_file(db, &h.fs, path, None, false).unwrap();
        assert!(matches!(outcome, FileOutcome::Changed(_)), "{:?}", outcome);
    }

    fn global_db(h: &Harness) -> DbHandle {
        Arc::new(Mutex::new(
            db::open_or_create(&h._tmp.path().join("global.db")).unwrap(),
        ))
    }

    fn paths_in(db: &DbHandle) -> Vec<String> {
        let conn = db.lock();
        let mut stmt = conn.prepare("SELECT path FROM files ORDER BY path").unwrap();
        let rows = stmt.query_map([], |row| row.get::<_, String>(0)).unwrap();
        rows.map(|r| r.unwrap()).collect()
    }

    fn count_in(db: &DbHandle, sql: &str) -> i64 {
        db.lock().query_row(sql, [], |row| row.get(0)).unwrap()
    }

    fn fts_matches(db: &DbHandle, term: &str) -> i64 {
        db.lock()
            .query_row(
                "SELECT COUNT(*) FROM files_fts WHERE files_fts MATCH ?1",
                [term],
                |row| row.get(0),
            )
            .unwrap()
    }

    /// A project added while the app was running had no registered database,
    /// so the watcher indexed its files into the global one, where nothing
    /// ever removed them.
    #[test]
    fn global_rows_the_project_database_also_holds_are_removed_and_the_rest_kept() {
        let h = seeded();
        h.pass();
        let global = global_db(&h);

        // Indexed into the global database before the project was registered.
        index_into(&h, &global, &h.path("alpha.md"));
        index_into(&h, &global, &h.path("gamma.md"));
        // Under the project, but not in its database: the only copy there is.
        let only_global = h.write_aged("late.md", "# Late\n\nlateword\n", 100);
        index_into(&h, &global, &only_global);

        // A loose file, and a folder that only shares the project's name prefix.
        let root = h._tmp.path();
        let write = |rel: &str, body: &str| {
            let path = root.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, body).unwrap();
            path.to_string_lossy().to_string()
        };
        let loose = write("loose.md", "# Loose\n\nlooseword #topic\n");
        let sibling = write("project-archive/old.md", "# Old\n\nsiblingword\n");
        index_into(&h, &global, &loose);
        index_into(&h, &global, &sibling);
        assert_eq!(fts_matches(&global, "firstdraft"), 1);
        assert_eq!(
            count_in(&global, "SELECT COUNT(*) FROM tasks"),
            1,
            "gamma.md's task is in the global database before the cleanup"
        );

        let project_root = PathBuf::from(&h.project);
        let project_files = h.count("SELECT COUNT(*) FROM files");
        let removed =
            purge_project_rows_from_global(&global, &h.db, &project_root, None).unwrap();

        assert_eq!(removed, 2);
        let mut kept = vec![only_global, loose, sibling];
        kept.sort();
        assert_eq!(paths_in(&global), kept);
        // The child rows and the full-text postings went with the files.
        assert_eq!(fts_matches(&global, "firstdraft"), 0);
        assert_eq!(fts_matches(&global, "lateword"), 1);
        assert_eq!(fts_matches(&global, "looseword"), 1);
        assert_eq!(fts_matches(&global, "siblingword"), 1);
        assert_eq!(count_in(&global, "SELECT COUNT(*) FROM tasks"), 0);
        assert_eq!(
            count_in(&global, "SELECT COUNT(*) FROM tags"),
            1,
            "only the loose file's tag is left"
        );
        assert!(global.lock().is_autocommit(), "the cleanup must commit");
        assert_eq!(
            h.count("SELECT COUNT(*) FROM files"),
            project_files,
            "the project's own database is not touched"
        );
        assert_eq!(h.search("firstdraft"), vec![h.path("alpha.md")]);

        // Nothing left to do the second time, and nothing written.
        let changes = global.lock().total_changes();
        assert_eq!(
            purge_project_rows_from_global(&global, &h.db, &project_root, None).unwrap(),
            0
        );
        assert_eq!(global.lock().total_changes(), changes);
    }

    /// The global pass indexes everything under its own directory, projects
    /// included, so removing those rows would only make it read the files
    /// again on the next launch.
    #[test]
    fn a_project_inside_the_global_pass_directory_keeps_its_global_rows() {
        let h = seeded();
        h.pass();
        let global = global_db(&h);
        index_into(&h, &global, &h.path("alpha.md"));

        let library = h._tmp.path().to_path_buf();
        let removed = purge_project_rows_from_global(
            &global,
            &h.db,
            Path::new(&h.project),
            Some(library.as_path()),
        )
        .unwrap();

        assert_eq!(removed, 0);
        assert_eq!(paths_in(&global), vec![h.path("alpha.md")]);
    }

    #[test]
    fn the_global_cleanup_joins_an_open_pass_transaction() {
        let h = seeded();
        h.pass();
        let global = global_db(&h);
        index_into(&h, &global, &h.path("alpha.md"));

        // A pass on the global database is between two files.
        db::ensure_txn(&global.lock());
        let removed =
            purge_project_rows_from_global(&global, &h.db, Path::new(&h.project), None).unwrap();
        assert_eq!(removed, 1);
        assert!(
            !global.lock().is_autocommit(),
            "the pass transaction must be left open for the pass to commit"
        );
        db::commit_txn(&global.lock());
        assert!(paths_in(&global).is_empty());
    }

    #[test]
    fn the_global_cleanup_finds_both_databases_through_the_registry() {
        let h = seeded();
        h.pass();
        let global = global_db(&h);
        let outside = h._tmp.path().join("outside.md");
        std::fs::write(&outside, "# Outside\n").unwrap();
        let outside = outside.to_string_lossy().to_string();
        index_into(&h, &global, &h.path("alpha.md"));
        index_into(&h, &global, &outside);

        // No global database open: nothing to do, and no panic.
        drop_project_rows_from_global(&h.state, &h.project);
        assert_eq!(paths_in(&global).len(), 2);

        *h.state.global_db.lock() = Some(global.clone());
        // An unregistered project is left alone.
        drop_project_rows_from_global(&h.state, &outside);
        assert_eq!(paths_in(&global).len(), 2);

        // The temp project is not under ~/Notesage, so its duplicates go.
        drop_project_rows_from_global(&h.state, &h.project);
        assert_eq!(paths_in(&global), vec![outside]);
    }

    #[test]
    fn opening_a_database_twice_keeps_the_first_connection() {
        let h = Harness::new();
        // `init_project_db` must not replace a registered connection: a pass
        // may be running on it.
        init_project_db(&h.state, &h.project).unwrap();
        let registered = h.state.project_dbs.lock().get(Path::new(&h.project)).cloned().unwrap();
        assert!(Arc::ptr_eq(&registered, &h.db));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn run_blocking_keeps_long_index_work_off_the_async_worker() {
        let async_thread = std::thread::current().id();
        let worker = run_blocking(|| Ok(std::thread::current().id()))
            .await
            .unwrap();
        assert_ne!(worker, async_thread, "the work ran on the async worker");
    }

    #[tokio::test]
    async fn run_blocking_reports_errors_and_panics_as_errors() {
        let err = run_blocking(|| Err::<(), String>("db is locked".to_string()))
            .await
            .unwrap_err();
        assert_eq!(err, "db is locked");

        let panicked = run_blocking(|| -> Result<(), String> { panic!("boom") })
            .await
            .unwrap_err();
        assert!(panicked.starts_with("Index task failed"), "{}", panicked);
    }
}
