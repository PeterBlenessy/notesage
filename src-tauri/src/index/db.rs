use rusqlite::{Connection, Result as SqlResult};
use std::path::Path;
use std::time::Duration;

/// Current schema version — bump when adding table/column migrations.
/// Note: if parser extraction logic changes (not schema), bump PARSER_VERSION
/// instead — it triggers a data-only rebuild without schema migration.
const SCHEMA_VERSION: i32 = 1;

/// Current parser version — bump when parser.rs extraction logic changes
/// (e.g., new tag/mention patterns, heading extraction fixes, task parsing).
/// A bump triggers a full data clear + rebuild on next startup, without
/// touching the schema itself. This ensures stale index entries from an
/// older parser are replaced even if file content hasn't changed.
/// Note: independent of SCHEMA_VERSION — schema changes don't require a
/// parser version bump, and vice versa.
const PARSER_VERSION: i32 = 1;

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

    // Retry for up to 5 seconds when the database is busy (concurrent writes).
    // Without this, rapid watcher-triggered reindex calls fail immediately with
    // "database is locked" when they contend on the write lock.
    conn.busy_timeout(Duration::from_millis(5000))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

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

    // Check parser version — if the parser changed, clear all data so files
    // are re-parsed on the next reindex_directory scan (content hashes reset).
    let stored_parser = get_parser_version(&conn);
    if stored_parser != PARSER_VERSION {
        // Clear if the DB has indexed data (distinguishes "old DB with stale
        // parser" from "brand-new empty DB that just needs the version set").
        let has_data: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM files)", [], |row| row.get(0))
            .unwrap_or(false);
        if has_data {
            log::info!(target: "notesage::index",
                "Parser version changed ({} → {}), clearing index for rebuild",
                stored_parser, PARSER_VERSION
            );
            clear_all(&conn)?;
        }
        set_parser_version(&conn, PARSER_VERSION)?;
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

fn get_parser_version(conn: &Connection) -> i32 {
    conn.query_row(
        "SELECT parser_version FROM schema_version LIMIT 1",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

fn set_parser_version(conn: &Connection, version: i32) -> Result<(), String> {
    // Add column if it doesn't exist (one-time migration from older DBs).
    // Wrapped in a transaction so a crash between ALTER TABLE and UPDATE
    // doesn't leave the column at DEFAULT 0 (which would trigger a spurious
    // full rebuild on every subsequent open).
    let has_col: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('schema_version') WHERE name = 'parser_version'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    let tx = conn.unchecked_transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;
    if !has_col {
        tx.execute("ALTER TABLE schema_version ADD COLUMN parser_version INTEGER DEFAULT 0", [])
            .map_err(|e| format!("Failed to add parser_version column: {}", e))?;
    }
    tx.execute("UPDATE schema_version SET parser_version = ?1", [version])
        .map_err(|e| format!("Failed to set parser version: {}", e))?;
    tx.commit()
        .map_err(|e| format!("Failed to commit parser version: {}", e))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_timeout_is_configured() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = open_or_create(&db_path).expect("Failed to open DB");

        let timeout_ms: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .expect("Failed to read busy_timeout");

        assert_eq!(timeout_ms, 5000, "busy_timeout must be 5000ms to prevent 'database is locked' errors");
    }

    #[test]
    fn wal_mode_is_enabled() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = open_or_create(&db_path).expect("Failed to open DB");

        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .expect("Failed to read journal_mode");

        assert_eq!(mode.to_lowercase(), "wal", "WAL mode must be enabled for concurrent read safety");
    }

    #[test]
    fn foreign_keys_are_enabled() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = open_or_create(&db_path).expect("Failed to open DB");

        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("Failed to read foreign_keys");

        assert_eq!(fk, 1, "Foreign keys must be enabled for CASCADE deletes");
    }

    #[test]
    fn schema_is_created_on_first_open() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = open_or_create(&db_path).expect("Failed to open DB");

        // Verify core tables exist
        let table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('files', 'tags', 'mentions', 'tasks')",
                [],
                |row| row.get(0),
            )
            .expect("Failed to query tables");

        assert_eq!(table_count, 4, "Core tables (files, tags, mentions, tasks) must exist after open_or_create");
    }

    #[test]
    fn parser_version_stored_on_fresh_db() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = open_or_create(&db_path).expect("Failed to open DB");

        let pv = get_parser_version(&conn);
        assert_eq!(pv, PARSER_VERSION, "Parser version must be set on fresh DB");
    }

    #[test]
    fn parser_version_bump_clears_data() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        // Create DB and insert a file row
        {
            let conn = open_or_create(&db_path).expect("Failed to open DB");
            conn.execute(
                "INSERT INTO files (path, name, content_hash, indexed_at) VALUES ('test.md', 'test.md', 'abc', 0)",
                [],
            ).expect("insert file");
            let count: i64 = conn.query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0)).unwrap();
            assert_eq!(count, 1, "Should have 1 file");
        }

        // Simulate a parser version bump by lowering the stored version
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute("UPDATE schema_version SET parser_version = 0", []).unwrap();
        }

        // Re-open — should detect version mismatch and clear data
        {
            let conn = open_or_create(&db_path).expect("Failed to re-open DB");
            let count: i64 = conn.query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0)).unwrap();
            assert_eq!(count, 0, "Files table must be empty after parser version bump");

            let pv = get_parser_version(&conn);
            assert_eq!(pv, PARSER_VERSION, "Parser version must be updated after rebuild");
        }
    }

    #[test]
    fn parser_version_column_added_to_old_db() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        // Create a DB with the old schema (no parser_version column)
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch("CREATE TABLE schema_version (version INTEGER NOT NULL);").unwrap();
            conn.execute("INSERT INTO schema_version (version) VALUES (1)", []).unwrap();
            // Create minimal tables so clear_all doesn't fail
            conn.execute_batch(SCHEMA_SQL).unwrap();
        }

        // open_or_create should add the column and set parser version
        let conn = open_or_create(&db_path).expect("Failed to open old DB");
        let pv = get_parser_version(&conn);
        assert_eq!(pv, PARSER_VERSION, "Parser version must be set after column migration");
    }
}

const SCHEMA_SQL: &str = "
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL,
    parser_version INTEGER DEFAULT 0
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
