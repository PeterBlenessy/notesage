use rusqlite::{Connection, Result as SqlResult};
use std::path::Path;

/// Current schema version — bump when adding migrations.
const SCHEMA_VERSION: i32 = 1;

/// Open or create an index database at the given path.
/// Enables WAL mode, foreign keys, and creates schema if needed.
pub fn open_or_create(db_path: &Path) -> Result<Connection, String> {
    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory for index DB: {}", e))?;
    }

    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open index DB at {}: {}", db_path.display(), e))?;

    // Enable WAL mode for concurrent reads during writes
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

    // Enable foreign key enforcement
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

    // Check schema version and create/migrate as needed
    let version = get_schema_version(&conn);
    if version < SCHEMA_VERSION {
        if version == 0 {
            create_schema(&conn)?;
        }
        // Future: add migration steps here for version > 1
        set_schema_version(&conn, SCHEMA_VERSION)?;
    }

    // Exclude from iCloud backup on macOS
    super::icloud::exclude_from_icloud(db_path);

    Ok(conn)
}

fn get_schema_version(conn: &Connection) -> i32 {
    conn.query_row(
        "SELECT version FROM schema_version LIMIT 1",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

fn set_schema_version(conn: &Connection, version: i32) -> Result<(), String> {
    conn.execute("DELETE FROM schema_version", [])
        .map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO schema_version (version) VALUES (?1)", [version])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn create_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(SCHEMA_SQL)
        .map_err(|e| format!("Failed to create index schema: {}", e))?;
    Ok(())
}

/// Clear all data from the database (for rebuild).
pub fn clear_all(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DELETE FROM research_tags;
         DELETE FROM research;
         DELETE FROM goals;
         DELETE FROM tasks;
         DELETE FROM headings;
         DELETE FROM mentions;
         DELETE FROM tags;
         DELETE FROM files_fts;
         DELETE FROM files;",
    )
    .map_err(|e| format!("Failed to clear index: {}", e))?;
    Ok(())
}

/// Remove all data for a given file path.
pub fn remove_file(conn: &Connection, path: &str) -> SqlResult<()> {
    // CASCADE handles tags, mentions, headings, tasks, goals, research, research_tags
    // But we need to manually handle FTS since content= tables need explicit sync
    let file_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM files WHERE path = ?1",
            [path],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = file_id {
        // Delete FTS entry first (before the files row is gone)
        let title: String = conn
            .query_row("SELECT COALESCE(title, '') FROM files WHERE id = ?1", [id], |row| row.get(0))
            .unwrap_or_default();
        conn.execute(
            "INSERT INTO files_fts(files_fts, rowid, title, body) VALUES ('delete', ?1, ?2, '')",
            rusqlite::params![id, title],
        )?;
        // Delete the file row (cascades to all child tables)
        conn.execute("DELETE FROM files WHERE id = ?1", [id])?;
    }
    Ok(())
}

const SCHEMA_SQL: &str = "
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
);

-- Indexed files with content hash for change detection
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    project_path TEXT,
    content_hash TEXT NOT NULL,
    title TEXT,
    has_frontmatter INTEGER DEFAULT 0,
    indexed_at INTEGER NOT NULL
);

-- Tags extracted from AST text nodes (not code, not frontmatter, not headings)
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    context_before TEXT DEFAULT '',
    context_after TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
CREATE INDEX IF NOT EXISTS idx_tags_file ON tags(file_id);

-- Mentions extracted from AST text nodes
CREATE TABLE IF NOT EXISTS mentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    mention TEXT NOT NULL,
    context_before TEXT DEFAULT '',
    context_after TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_mentions_mention ON mentions(mention);
CREATE INDEX IF NOT EXISTS idx_mentions_file ON mentions(file_id);

-- Headings for document outline and future backlink support
CREATE TABLE IF NOT EXISTS headings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    level INTEGER NOT NULL,
    text TEXT NOT NULL,
    position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_headings_file ON headings(file_id);

-- Research file metadata (parsed from frontmatter)
CREATE TABLE IF NOT EXISTS research (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
    source_url TEXT DEFAULT '',
    date_saved TEXT DEFAULT '',
    word_count INTEGER DEFAULT 0,
    snippet TEXT DEFAULT ''
);

-- Research tags (separate table for proper querying)
CREATE TABLE IF NOT EXISTS research_tags (
    research_id INTEGER NOT NULL REFERENCES research(id) ON DELETE CASCADE,
    tag TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_tags ON research_tags(tag);

-- Task items extracted from AST TaskItem nodes (not code blocks)
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    position INTEGER NOT NULL,
    context_before TEXT DEFAULT '',
    context_after TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_tasks_file ON tasks(file_id);
CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done);

-- Goal file metadata (from frontmatter type: goal)
CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    template TEXT DEFAULT '',
    total_tasks INTEGER DEFAULT 0,
    completed_tasks INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_goals_file ON goals(file_id);

-- Full-text search for file content
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    title, body,
    content='',
    tokenize='porter unicode61'
);
";
