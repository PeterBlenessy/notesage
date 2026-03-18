pub mod db;
pub mod icloud;
pub mod parser;
pub mod queries;
pub mod tasks;

use queries::*;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// Lock a Mutex, recovering from poison if a previous thread panicked while holding it.
fn lock_or_recover<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, String> {
    match mutex.lock() {
        Ok(guard) => Ok(guard),
        Err(poisoned) => {
            log::warn!(target: "notesage::index", "Recovering from poisoned lock");
            Ok(poisoned.into_inner())
        }
    }
}

/// Text file extensions for FTS-only indexing (non-markdown files).
const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "text", "log", "json", "yaml", "yml", "toml", "xml", "html", "htm", "css", "js",
    "ts", "tsx", "jsx", "py", "rb", "rs", "go", "java", "c", "cpp", "h", "hpp", "swift",
    "kt", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql", "r", "lua", "pl",
    "ini", "cfg", "conf", "env", "csv",
];

/// Managed state for the document index.
pub struct IndexState {
    /// Global index DB connection (~/.notesage/index.db)
    global_db: Mutex<Option<Connection>>,
    /// Per-project index DB connections (project_path → connection)
    project_dbs: Mutex<HashMap<PathBuf, Connection>>,
    /// Pending reindex queue (debounced)
    reindex_queue: Mutex<Vec<ReindexEntry>>,
    /// Whether a reindex batch is currently being processed
    processing: Mutex<bool>,
}

#[derive(Clone)]
struct ReindexEntry {
    path: String,
    kind: String,
}

impl IndexState {
    pub fn new() -> Self {
        Self {
            global_db: Mutex::new(None),
            project_dbs: Mutex::new(HashMap::new()),
            reindex_queue: Mutex::new(Vec::new()),
            processing: Mutex::new(false),
        }
    }

    /// Queue a file for reindexing (called from watcher).
    pub fn queue_reindex(&self, path: String, kind: String) {
        if let Ok(mut queue) = lock_or_recover(&self.reindex_queue) {
            queue.push(ReindexEntry { path, kind });
        }
    }
}

/// Initialize the global index database.
fn init_global_db(state: &IndexState) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let db_path = home.join(".notesage").join("index.db");

    let conn = db::open_or_create(&db_path)?;

    let mut global = lock_or_recover(&state.global_db)?;
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

    let mut projects = lock_or_recover(&state.project_dbs)?;
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
fn get_db_for_path<'a>(
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
fn reindex_file_in_db(
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

/// Check if a file extension is indexable.
fn is_indexable(path: &str) -> bool {
    if path.ends_with(".md") {
        return true;
    }
    if let Some(ext) = Path::new(path).extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        TEXT_EXTENSIONS.contains(&ext_str.as_str())
    } else {
        false
    }
}

/// Directories that contain metadata, config, or non-user-content — never index.
const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "dist", "build",
    // Skill & agent directories (contain SKILL.md, agent .md, not user notes)
    "bundled-skills", "bundled-agents", "skills", "agents",
    // Source code / build artifacts
    "src-tauri", "src", "public",
    // Package manager / tooling
    ".cargo", ".rustup", "__pycache__", ".venv", "venv",
];

/// Recursively scan a directory for indexable files.
/// Only indexes user content — skips metadata, config, skill/agent, and build directories.
fn scan_files(dir: &Path, files: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // Skip hidden except .notesage
        if name.starts_with('.') && name != ".notesage" {
            continue;
        }

        if path.is_dir() {
            // Skip non-content directories
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            // For .notesage, only scan research/ subdirectory (user research notes)
            if name == ".notesage" {
                let research_dir = path.join("research");
                if research_dir.is_dir() {
                    scan_files(&research_dir, files);
                }
                continue;
            }
            scan_files(&path, files);
        } else if is_indexable(&path.to_string_lossy()) {
            files.push(path);
        }
    }
}

/// Full index rebuild for a directory into a DB.
fn reindex_directory(
    conn: &Connection,
    dir: &str,
    project_path: Option<&str>,
    app: Option<&AppHandle>,
) -> Result<IndexStats, String> {
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

    log::info!(
        target: "notesage::index",
        "Indexed {}/{} files ({} changed) in {}",
        total, total, changed, dir
    );

    queries::query_stats(conn)
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

/// Process the reindex queue (called from watcher integration).
pub fn process_reindex_queue(app: &AppHandle) {
    let state = match app.try_state::<IndexState>() {
        Some(s) => s,
        None => return,
    };

    // Check if already processing
    {
        let mut processing = match lock_or_recover(&state.processing) {
            Ok(p) => p,
            Err(_) => return,
        };
        if *processing {
            return;
        }
        *processing = true;
    }

    // Drain the queue
    let entries: Vec<ReindexEntry> = {
        let mut queue = match lock_or_recover(&state.reindex_queue) {
            Ok(q) => q,
            Err(_) => {
                let _ = lock_or_recover(&state.processing).map(|mut p| *p = false);
                return;
            }
        };
        queue.drain(..).collect()
    };

    if entries.is_empty() {
        let _ = lock_or_recover(&state.processing).map(|mut p| *p = false);
        return;
    }

    let global = match lock_or_recover(&state.global_db) {
        Ok(g) => g,
        Err(_) => {
            let _ = lock_or_recover(&state.processing).map(|mut p| *p = false);
            return;
        }
    };

    let projects = match lock_or_recover(&state.project_dbs) {
        Ok(p) => p,
        Err(_) => {
            let _ = lock_or_recover(&state.processing).map(|mut p| *p = false);
            return;
        }
    };

    for entry in entries {
        if let Some((conn, project_path)) = get_db_for_path(&global, &projects, &entry.path) {
            if entry.kind == "delete" {
                let _ = db::remove_file(conn, &entry.path);
            } else if is_indexable(&entry.path) {
                let _ = reindex_file_in_db(conn, &entry.path, project_path.as_deref());
            }
        }
    }

    let _ = lock_or_recover(&state.processing).map(|mut p| *p = false);
}

// ---- Tauri Commands ----

/// Initialize the index for a project or global scope.
/// If project_path is None, initializes the global index.
#[tauri::command]
pub async fn index_init(
    app: AppHandle,
    state: tauri::State<'_, IndexState>,
    project_path: Option<String>,
) -> Result<IndexStats, String> {
    if let Some(ref pp) = project_path {
        init_project_db(&state, pp)?;

        let projects = lock_or_recover(&state.project_dbs)?;
        if let Some(conn) = projects.get(&PathBuf::from(pp)) {
            let stats = reindex_directory(conn, pp, Some(pp), Some(&app))?;
            let _ = app.emit("index-ready", serde_json::json!({ "project_path": pp }));
            return Ok(stats);
        }
        Err("Failed to get project DB after init".to_string())
    } else {
        init_global_db(&state)?;

        let global = lock_or_recover(&state.global_db)?;
        if let Some(ref conn) = *global {
            // For global, index the ~/Notesage directory if it exists
            let home = dirs::home_dir().ok_or("Cannot find home directory")?;
            let notesage_dir = home.join("Notesage");
            if notesage_dir.is_dir() {
                let stats = reindex_directory(conn, &notesage_dir.to_string_lossy(), None, Some(&app))?;
                let _ = app.emit("index-ready", serde_json::json!({ "project_path": serde_json::Value::Null }));
                return Ok(stats);
            }
            let _ = app.emit("index-ready", serde_json::json!({ "project_path": serde_json::Value::Null }));
            return queries::query_stats(conn);
        }
        Err("Failed to get global DB after init".to_string())
    }
}

/// Force reindex a specific file.
#[tauri::command]
pub async fn index_file(
    state: tauri::State<'_, IndexState>,
    path: String,
) -> Result<(), String> {
    let global = lock_or_recover(&state.global_db)?;
    let projects = lock_or_recover(&state.project_dbs)?;

    if let Some((conn, project_path)) = get_db_for_path(&global, &projects, &path) {
        reindex_file_in_db(conn, &path, project_path.as_deref())?;
    }
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
        let projects = lock_or_recover(&state.project_dbs)?;
        if let Some(conn) = projects.get(&PathBuf::from(pp)) {
            db::clear_all(conn)?;
            return reindex_directory(conn, pp, Some(pp), Some(&app));
        }
        Err("Project not initialized".to_string())
    } else {
        let global = lock_or_recover(&state.global_db)?;
        if let Some(ref conn) = *global {
            db::clear_all(conn)?;
            let home = dirs::home_dir().ok_or("Cannot find home directory")?;
            let notesage_dir = home.join("Notesage");
            if notesage_dir.is_dir() {
                return reindex_directory(conn, &notesage_dir.to_string_lossy(), None, Some(&app));
            }
            return queries::query_stats(conn);
        }
        Err("Global index not initialized".to_string())
    }
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
    let global = lock_or_recover(&state.global_db)?;
    let projects = lock_or_recover(&state.project_dbs)?;

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

    Ok(result)
}

/// Query tag occurrences across projects.
#[tauri::command]
pub async fn index_tag_occurrences(
    state: tauri::State<'_, IndexState>,
    tag: String,
    project_paths: Vec<String>,
) -> Result<Vec<TagOccurrence>, String> {
    with_dbs(&state, &project_paths, |conn| {
        queries::query_tag_occurrences(conn, &tag)
    })
}

/// Query mentions across projects.
#[tauri::command]
pub async fn index_mentions(
    state: tauri::State<'_, IndexState>,
    project_paths: Vec<String>,
    query: Option<String>,
) -> Result<Vec<IndexedMention>, String> {
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

    Ok(result)
}

/// Query mention occurrences across projects.
#[tauri::command]
pub async fn index_mention_occurrences(
    state: tauri::State<'_, IndexState>,
    mention: String,
    project_paths: Vec<String>,
) -> Result<Vec<TagOccurrence>, String> {
    with_dbs(&state, &project_paths, |conn| {
        queries::query_mention_occurrences(conn, &mention)
    })
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
    let lim = limit.unwrap_or(50);
    with_dbs(&state, &project_paths, |conn| {
        queries::query_research(conn, query.as_deref(), tag.as_deref(), lim)
    })
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
    let lim = limit.unwrap_or(500);
    with_dbs(&state, &project_paths, |conn| {
        queries::query_tasks(conn, done, query.as_deref(), lim)
    })
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
        if let Ok(mut sw) = watcher_state.self_writes.lock() {
            sw.insert(normalized, std::time::Instant::now());
        }
    }

    // Write file
    std::fs::write(&path, &new_content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    // Reindex the file
    let global = lock_or_recover(&state.global_db)?;
    let projects = lock_or_recover(&state.project_dbs)?;
    if let Some((conn, project_path)) = get_db_for_path(&global, &projects, &path) {
        reindex_file_in_db(conn, &path, project_path.as_deref())?;
    }

    Ok(())
}

/// Query goals across projects.
#[tauri::command]
pub async fn index_goals(
    state: tauri::State<'_, IndexState>,
    project_paths: Vec<String>,
) -> Result<Vec<IndexedGoal>, String> {
    with_dbs(&state, &project_paths, |conn| queries::query_goals(conn))
}

/// Full-text content search across projects.
#[tauri::command]
pub async fn index_search_content(
    state: tauri::State<'_, IndexState>,
    project_paths: Vec<String>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<ContentSearchResult>, String> {
    let lim = limit.unwrap_or(50);
    with_dbs(&state, &project_paths, |conn| {
        queries::query_content(conn, &query, lim)
    })
}

/// Get index statistics.
#[tauri::command]
pub async fn index_stats(
    state: tauri::State<'_, IndexState>,
    project_path: Option<String>,
) -> Result<IndexStats, String> {
    if let Some(ref pp) = project_path {
        let projects = lock_or_recover(&state.project_dbs)?;
        if let Some(conn) = projects.get(&PathBuf::from(pp)) {
            return queries::query_stats(conn);
        }
        Err("Project not initialized".to_string())
    } else {
        let global = lock_or_recover(&state.global_db)?;
        if let Some(ref conn) = *global {
            return queries::query_stats(conn);
        }
        Err("Global index not initialized".to_string())
    }
}
