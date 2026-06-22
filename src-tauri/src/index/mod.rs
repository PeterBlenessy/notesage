pub mod db;
mod file_scanner;
pub mod icloud;
pub mod links;
pub mod parser;
pub mod queries;
mod reindex_queue;
pub mod tasks;

use queries::*;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use file_scanner::{has_dotfolder_component, is_indexable, scan_files};
use reindex_queue::ReindexEntry;
pub use reindex_queue::process_reindex_queue;

/// Managed state for the document index.
pub struct IndexState {
    /// Global index DB connection (~/.notesage/index.db)
    pub(super) global_db: Mutex<Option<Connection>>,
    /// Per-project index DB connections (project_path → connection)
    pub(super) project_dbs: Mutex<HashMap<PathBuf, Connection>>,
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
    pub(super) fn index_links_for_file(&self, file_path: &str) {
        // Only markdown documents participate in the link graph.
        if !file_path.ends_with(".md") {
            return;
        }
        let scope_roots = self.link_scope_roots();
        // SECURITY (ADR 0003): bail before any read for out-of-scope paths so
        // explorer content is never even loaded for link extraction.
        if !links::is_path_in_scope(file_path, &scope_roots) {
            return;
        }
        if self.ensure_links_db().is_err() {
            return;
        }

        let content = match std::fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => return,
        };
        let file_name = Path::new(file_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let parsed = parser::parse_links(&content, file_path, &file_name);

        let guard = self.links_db.lock();
        if let Some(conn) = guard.as_ref() {
            let _ = links::replace_source(
                conn,
                file_path,
                &scope_roots,
                parsed.meta.doc_type.as_deref(),
                parsed.meta.title.as_deref(),
                parsed.meta.description.as_deref(),
                &parsed.edges,
            );
        }
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
    /// reconciles via `remove_links_for_file` + `index_links_for_file` (incoming
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
fn init_global_db(state: &IndexState) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let db_path = home.join(".notesage").join("index.db");

    let conn = db::open_or_create(&db_path)?;

    let mut global = state.global_db.lock();
    *global = Some(conn);

    log::info!(target: "notesage::index", "Global index DB initialized at {}", db_path.display());
    Ok(())
}

/// Initialize a per-project index database.
/// Stored under ~/.notesage/indexes/<hash>/ to avoid iCloud sync corruption.
/// Previously stored in <project>/.notesage/index.db which caused corruption
/// when the project folder was on iCloud Drive (multi-device SQLite writes).
fn init_project_db(state: &IndexState, project_path: &str) -> Result<(), String> {
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

    let mut projects = state.project_dbs.lock();
    projects.insert(PathBuf::from(project_path), conn);

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

/// Determine which DB a file belongs to based on its path.
pub(super) fn get_db_for_path<'a>(
    global: &'a Option<Connection>,
    projects: &'a HashMap<PathBuf, Connection>,
    file_path: &str,
) -> Option<(&'a Connection, Option<String>)> {
    // Check if this file belongs to any project
    for (project_path, conn) in projects.iter() {
        let project_str = project_path.to_string_lossy();
        if file_path.starts_with(project_str.as_ref()) {
            return Some((conn, Some(project_str.to_string())));
        }
    }
    // Fall back to global DB
    global.as_ref().map(|conn| (conn, None))
}

/// Reindex a single file in the given database.
pub(super) fn reindex_file_in_db(
    conn: &Connection,
    file_path: &str,
    project_path: Option<&str>,
) -> Result<bool, String> {
    let path = Path::new(file_path);

    // Skip transient temp files (e.g., .tmp from atomic writes)
    if let Some(ext) = path.extension() {
        if ext == "tmp" {
            return Ok(false);
        }
    }

    // Skip non-indexable files (binary, non-text extensions)
    if !is_indexable(file_path) {
        return Ok(false);
    }

    // Skip files inside any dotfolder (e.g. .git/, .ssh/, .config/).
    // scan_files() already skips these for bulk indexing; this guard closes the same
    // gap for the watcher-triggered single-file path that bypasses scan_files.
    // .notesage is excluded from this check so .notesage/research/ files remain indexable.
    if has_dotfolder_component(file_path) {
        return Ok(false);
    }

    // Skip .notesage metadata files (state/, index.db, etc.) — only research/ is indexable
    // scan_files() already filters this for bulk indexing, but watcher-triggered single-file
    // indexing bypasses scan_files and lands here directly.
    if file_path.contains("/.notesage/") && !file_path.contains("/.notesage/research/") {
        return Ok(false);
    }

    // Read file content
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            log::warn!(target: "notesage::index", "Cannot read {}: {}", file_path, e);
            return Ok(false);
        }
    };

    let hash = content_hash(&content);

    // Check if file already indexed with same hash
    let existing_hash: Option<String> = conn
        .query_row(
            "SELECT content_hash FROM files WHERE path = ?1",
            [file_path],
            |row| row.get(0),
        )
        .ok();

    if existing_hash.as_deref() == Some(hash.as_str()) {
        log::debug!(target: "notesage::index", "Skipping {} (hash unchanged)", file_path);
        return Ok(false); // No change
    }

    log::debug!(target: "notesage::index", "Indexing {} (hash {} → {})",
        file_path,
        existing_hash.as_deref().unwrap_or("new"),
        &hash[..8]
    );

    // Remove old data for this file and re-index inside a savepoint.
    // If any step fails, the savepoint rolls back so the stale hash doesn't
    // prevent future re-indexing of tags/mentions.
    conn.execute_batch("SAVEPOINT index_file").map_err(|e| format!("Savepoint: {}", e))?;
    let result = index_file_inner(conn, file_path, project_path, &content, &hash);
    if let Err(ref e) = result {
        log::warn!(target: "notesage::index", "Index failed for {}: {}", file_path, e);
        let _ = conn.execute_batch("ROLLBACK TO SAVEPOINT index_file");
    } else {
        let _ = conn.execute_batch("RELEASE SAVEPOINT index_file");
    }
    return result;
}

fn index_file_inner(
    conn: &rusqlite::Connection,
    file_path: &str,
    project_path: Option<&str>,
    content: &str,
    hash: &str,
) -> Result<bool, String> {
    let path = std::path::Path::new(file_path);
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let is_markdown = file_path.ends_with(".md");
    let is_in_research_dir = file_path.contains("/research/");

    let _ = db::remove_file(conn, file_path);

    if is_markdown {
        // Full AST parsing for markdown files
        let parsed = parser::parse_file(&content, &file_name, is_in_research_dir);
        log::debug!(target: "notesage::index",
            "Parsed {}: {} tags, {} mentions, {} headings, {} tasks",
            file_path, parsed.tags.len(), parsed.mentions.len(),
            parsed.headings.len(), parsed.tasks.len()
        );

        // Insert file record
        conn.execute(
            "INSERT OR REPLACE INTO files (path, name, project_path, content_hash, title, has_frontmatter, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                file_path,
                file_name,
                project_path,
                hash,
                parsed.title,
                parsed.has_frontmatter as i32,
                now_ts() as i64,
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
    } else {
        // FTS-only indexing for non-markdown text files
        let title = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string());

        conn.execute(
            "INSERT OR REPLACE INTO files (path, name, project_path, content_hash, title, has_frontmatter, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
            rusqlite::params![
                file_path,
                file_name,
                project_path,
                hash,
                title,
                now_ts() as i64,
            ],
        )
        .map_err(|e| format!("Failed to insert file: {}", e))?;

        let file_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO files_fts(rowid, title, body) VALUES (?1, ?2, ?3)",
            rusqlite::params![file_id, title.as_deref().unwrap_or(""), content],
        )
        .map_err(|e| format!("Failed to insert FTS: {}", e))?;
    }

    Ok(true) // Changed
}

/// Full index rebuild for a directory into a DB.
fn reindex_directory(
    conn: &Connection,
    dir: &str,
    project_path: Option<&str>,
    app: Option<&AppHandle>,
) -> Result<IndexStats, String> {
    let start = Instant::now();
    let dir_path = Path::new(dir);
    let mut files = Vec::new();
    scan_files(dir_path, &mut files);

    let total = files.len();
    let mut changed = 0;

    for (i, file_path) in files.iter().enumerate() {
        let path_str = file_path.to_string_lossy().to_string();
        match reindex_file_in_db(conn, &path_str, project_path) {
            Ok(true) => changed += 1,
            Ok(false) => {} // No change
            Err(e) => {
                log::warn!(target: "notesage::index", "Failed to index {}: {}", path_str, e);
            }
        }

        // Emit progress for large batches
        if let Some(app) = app {
            if total > 50 && (i % 50 == 0 || i == total - 1) {
                let _ = app.emit("index-progress", serde_json::json!({
                    "current": i + 1,
                    "total": total,
                }));
            }
        }
    }

    // Prune files that no longer exist on disk
    prune_deleted_files(conn)?;

    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    let project_name = project_path.unwrap_or("global");
    log::debug!(
        target: "notesage::index",
        "[perf:index] build: project={} files={} changed={} ms={:.1}",
        project_name, total, changed, elapsed_ms
    );

    log::info!(
        target: "notesage::index",
        "Indexed {}/{} files ({} changed) in {}",
        total, total, changed, dir
    );

    queries::query_stats(conn)
}

/// Bulk-index the link graph for every markdown file under `dir`.
///
/// Called after the content reindex (so the content-DB locks are released —
/// `index_links_for_file` locks `project_dbs` internally). Scope-gated per
/// file (ADR 0003); explorer paths never reach here because explorer folders
/// are never passed to `index_init`/`index_rebuild`.
fn reindex_links_for_directory(state: &IndexState, dir: &str) {
    let dir_path = Path::new(dir);
    let mut files = Vec::new();
    scan_files(dir_path, &mut files);
    for file_path in &files {
        let path_str = file_path.to_string_lossy().to_string();
        if path_str.ends_with(".md") {
            state.index_links_for_file(&path_str);
        }
    }
}

/// Remove index entries for files that no longer exist on disk.
fn prune_deleted_files(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id, path FROM files")
        .map_err(|e| e.to_string())?;

    let to_delete: Vec<(i64, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .filter(|(_, path): &(i64, String)| !Path::new(path).exists())
        .collect();

    for (_, path) in &to_delete {
        let _ = db::remove_file(conn, path);
    }

    if !to_delete.is_empty() {
        log::info!(
            target: "notesage::index",
            "Pruned {} deleted files from index",
            to_delete.len()
        );
    }

    Ok(())
}

// ---- Tauri Commands ----

/// Initialize the index for a project or global scope.
/// If project_path is None, initializes the global index.
/// Wraps initialization in catch_unwind to log panics instead of silently poisoning state.
#[tauri::command]
pub async fn index_init(
    app: AppHandle,
    state: tauri::State<'_, IndexState>,
    project_path: Option<String>,
) -> Result<IndexStats, String> {
    if let Some(ref pp) = project_path {
        // Wrap in catch_unwind to capture panics during init
        let pp_clone = pp.clone();
        let init_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            init_project_db(&state, &pp_clone)
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

        let stats = {
            let projects = state.project_dbs.lock();
            match projects.get(&PathBuf::from(pp)) {
                Some(conn) => reindex_directory(conn, pp, Some(pp), Some(&app))?,
                None => return Err("Failed to get project DB after init".to_string()),
            }
        };
        // Link-graph pass runs after the content-DB lock is released.
        reindex_links_for_directory(&state, pp);
        let _ = app.emit("index-ready", serde_json::json!({ "project_path": pp }));
        Ok(stats)
    } else {
        init_global_db(&state)?;
        let _ = state.ensure_links_db();

        let home = dirs::home_dir().ok_or("Cannot find home directory")?;
        let notesage_dir = home.join("Notesage");
        let notesage_str = notesage_dir.to_string_lossy().to_string();

        let stats = {
            let global = state.global_db.lock();
            match *global {
                Some(ref conn) => {
                    if notesage_dir.is_dir() {
                        reindex_directory(conn, &notesage_str, None, Some(&app))?
                    } else {
                        queries::query_stats(conn)?
                    }
                }
                None => return Err("Failed to get global DB after init".to_string()),
            }
        };
        // Link-graph pass for the ~/Notesage library (lock released above).
        if notesage_dir.is_dir() {
            reindex_links_for_directory(&state, &notesage_str);
        }
        let _ = app.emit("index-ready", serde_json::json!({ "project_path": serde_json::Value::Null }));
        Ok(stats)
    }
}

/// Force reindex a specific file.
#[tauri::command]
pub async fn index_file(
    state: tauri::State<'_, IndexState>,
    path: String,
) -> Result<(), String> {
    {
        let global = state.global_db.lock();
        let projects = state.project_dbs.lock();

        if let Some((conn, project_path)) = get_db_for_path(&global, &projects, &path) {
            reindex_file_in_db(conn, &path, project_path.as_deref())?;
        }
    }
    // Link-graph pass after content-DB locks are released (scope-gated).
    state.index_links_for_file(&path);
    Ok(())
}

/// Force full reindex of a project or global scope.
#[tauri::command]
pub async fn index_rebuild(
    app: AppHandle,
    state: tauri::State<'_, IndexState>,
    project_path: Option<String>,
) -> Result<IndexStats, String> {
    if let Some(ref pp) = project_path {
        let stats = {
            let projects = state.project_dbs.lock();
            match projects.get(&PathBuf::from(pp)) {
                Some(conn) => {
                    db::clear_all(conn)?;
                    reindex_directory(conn, pp, Some(pp), Some(&app))?
                }
                None => return Err("Project not initialized".to_string()),
            }
        };
        // Refresh link edges for the project's current files (lock released).
        reindex_links_for_directory(&state, pp);
        Ok(stats)
    } else {
        let home = dirs::home_dir().ok_or("Cannot find home directory")?;
        let notesage_dir = home.join("Notesage");
        let notesage_str = notesage_dir.to_string_lossy().to_string();
        let stats = {
            let global = state.global_db.lock();
            match *global {
                Some(ref conn) => {
                    db::clear_all(conn)?;
                    if notesage_dir.is_dir() {
                        reindex_directory(conn, &notesage_str, None, Some(&app))?
                    } else {
                        queries::query_stats(conn)?
                    }
                }
                None => return Err("Global index not initialized".to_string()),
            }
        };
        if notesage_dir.is_dir() {
            reindex_links_for_directory(&state, &notesage_str);
        }
        Ok(stats)
    }
}

/// Delete an index database (and WAL/SHM files) and remove it from state.
/// Called before retrying `index_init` when the DB is corrupted.
#[tauri::command]
pub async fn index_reset(
    state: tauri::State<'_, IndexState>,
    project_path: Option<String>,
) -> Result<(), String> {
    if let Some(ref pp) = project_path {
        // Remove connection from state (drops the Connection, closing the DB)
        {
            let mut projects = state.project_dbs.lock();
            projects.remove(&PathBuf::from(pp));
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
        // Remove global DB connection
        {
            let mut global = state.global_db.lock();
            *global = None;
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
fn with_dbs<T, F>(
    state: &IndexState,
    project_paths: &[String],
    query_fn: F,
) -> Result<Vec<T>, String>
where
    F: Fn(&Connection) -> Result<Vec<T>, String>,
{
    let global = state.global_db.lock();
    let projects = state.project_dbs.lock();

    let mut results = Vec::new();

    // Query project DBs that match the given paths
    for pp in project_paths {
        if let Some(conn) = projects.get(&PathBuf::from(pp)) {
            results.extend(query_fn(conn)?);
        }
    }

    // Always also query global DB
    if let Some(ref conn) = *global {
        results.extend(query_fn(conn)?);
    }

    Ok(results)
}

/// Query tags across projects.
#[tauri::command]
pub async fn index_tags(
    state: tauri::State<'_, IndexState>,
    project_paths: Vec<String>,
    query: Option<String>,
) -> Result<Vec<IndexedTag>, String> {
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
}

/// Query tag occurrences across projects.
#[tauri::command]
pub async fn index_tag_occurrences(
    state: tauri::State<'_, IndexState>,
    tag: String,
    project_paths: Vec<String>,
) -> Result<Vec<TagOccurrence>, String> {
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
}

/// Query mentions across projects.
#[tauri::command]
pub async fn index_mentions(
    state: tauri::State<'_, IndexState>,
    project_paths: Vec<String>,
    query: Option<String>,
) -> Result<Vec<IndexedMention>, String> {
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
}

/// Query mention occurrences across projects.
#[tauri::command]
pub async fn index_mention_occurrences(
    state: tauri::State<'_, IndexState>,
    mention: String,
    project_paths: Vec<String>,
) -> Result<Vec<TagOccurrence>, String> {
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
}

/// Search research files across projects.
#[tauri::command]
pub async fn index_search_research(
    state: tauri::State<'_, IndexState>,
    project_paths: Vec<String>,
    query: Option<String>,
    tag: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ResearchResult>, String> {
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
}

/// Query tasks across projects.
#[tauri::command]
pub async fn index_tasks(
    state: tauri::State<'_, IndexState>,
    project_paths: Vec<String>,
    done: Option<bool>,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<IndexedTask>, String> {
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
}

/// Toggle a task's completion status via context-based matching.
#[tauri::command]
pub async fn index_toggle_task(
    app: AppHandle,
    state: tauri::State<'_, IndexState>,
    path: String,
    context_before: String,
    context_after: String,
    task_text: String,
    done: bool,
) -> Result<(), String> {
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

    // Reindex the file
    {
        let global = state.global_db.lock();
        let projects = state.project_dbs.lock();
        if let Some((conn, project_path)) = get_db_for_path(&global, &projects, &path) {
            reindex_file_in_db(conn, &path, project_path.as_deref())?;
        }
    }
    // Refresh the file's link edges (lock released; scope-gated).
    state.index_links_for_file(&path);

    Ok(())
}

/// Query goals across projects.
#[tauri::command]
pub async fn index_goals(
    state: tauri::State<'_, IndexState>,
    project_paths: Vec<String>,
) -> Result<Vec<IndexedGoal>, String> {
    let start = Instant::now();
    let result = with_dbs(&state, &project_paths, |conn| queries::query_goals(conn))?;
    log::debug!(
        target: "notesage::index",
        "[perf:index] query: type=goals results={} ms={:.1}",
        result.len(), start.elapsed().as_secs_f64() * 1000.0
    );
    Ok(result)
}

/// Full-text content search across projects.
#[tauri::command]
pub async fn index_search_content(
    state: tauri::State<'_, IndexState>,
    project_paths: Vec<String>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<ContentSearchResult>, String> {
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
}

/// Filename substring search across projects.
///
/// Powers the FloatingCommandBar `:file` verb mode (PRD
/// `2026-04-28-cmd-bar-verb-prefixes`). Empty queries return an empty
/// list — the frontend renders an MRU list from `editor-store.recentFiles`
/// in that case rather than dumping every indexed file.
#[tauri::command]
pub async fn index_search_filenames(
    state: tauri::State<'_, IndexState>,
    project_paths: Vec<String>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<FilenameSearchResult>, String> {
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
}

/// Get index statistics.
#[tauri::command]
pub async fn index_stats(
    state: tauri::State<'_, IndexState>,
    project_path: Option<String>,
) -> Result<IndexStats, String> {
    if let Some(ref pp) = project_path {
        let projects = state.project_dbs.lock();
        if let Some(conn) = projects.get(&PathBuf::from(pp)) {
            return queries::query_stats(conn);
        }
        Err("Project not initialized".to_string())
    } else {
        let global = state.global_db.lock();
        if let Some(ref conn) = *global {
            return queries::query_stats(conn);
        }
        Err("Global index not initialized".to_string())
    }
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

    /// RED test: files inside dotfolders (e.g. .git/) must be skipped by the
    /// watcher-triggered reindex path, just as scan_files skips them during
    /// bulk indexing. Before the fix, reindex_file_in_db only skips
    /// .notesage/ non-research files — not arbitrary dotfolders.
    #[test]
    fn reindex_file_in_db_skips_dotfolder_paths() {
        // Use a non-dot prefix so the tempdir path itself has no dotfolder
        // components (on Linux, tempfile::tempdir() creates /tmp/.tmpXXX).
        let tmp = tempfile::Builder::new()
            .prefix("notesage_test_")
            .tempdir()
            .unwrap();
        let db_path = tmp.path().join("test.db");
        let conn = db::open_or_create(&db_path).unwrap();
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        let md_file = git_dir.join("notes.md");
        std::fs::write(&md_file, "# Git notes\n#secret-tag @secret-mention").unwrap();
        let path_str = md_file.to_string_lossy().to_string();
        let result = reindex_file_in_db(&conn, &path_str, None).unwrap();
        assert!(
            !result,
            "reindex_file_in_db must return false (skipped) for dotfolder paths"
        );
        let file_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            file_count, 0,
            "Files under dotfolders must not be inserted into the index"
        );
    }

    /// Regression guard: normal paths must still be indexed after the fix.
    #[test]
    fn reindex_file_in_db_indexes_normal_paths() {
        let tmp = tempfile::Builder::new()
            .prefix("notesage_test_")
            .tempdir()
            .unwrap();
        let db_path = tmp.path().join("test.db");
        let conn = db::open_or_create(&db_path).unwrap();
        let notes_dir = tmp.path().join("notes");
        std::fs::create_dir_all(&notes_dir).unwrap();
        let md_file = notes_dir.join("my_note.md");
        std::fs::write(&md_file, "# My Note\nSome content").unwrap();
        let path_str = md_file.to_string_lossy().to_string();
        let result = reindex_file_in_db(&conn, &path_str, None).unwrap();
        assert!(result, "reindex_file_in_db must return true for normal paths");
        let file_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .unwrap();
        assert_eq!(file_count, 1, "Normal path files must be indexed");
    }
}
