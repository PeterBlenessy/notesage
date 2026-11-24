use rusqlite::{Connection, Result as SqlResult};
use std::path::Path;
use std::time::Duration;

/// Current schema version — bump when adding table/column migrations.
/// Note: if parser extraction logic changes (not schema), bump PARSER_VERSION
/// instead — it triggers a data-only rebuild without schema migration.
///
/// v2: `files.mtime` / `files.size` (the stat gate that lets an unchanged file
/// be skipped without reading it) and `files_fts` recreated with
/// `contentless_delete=1` so a reindexed or removed file's postings are really
/// deleted. Saved HTML is indexed as visible text from v2 on. The migration
/// causes one full re-read on the next launch WITHOUT clearing the index, so
/// `PARSER_VERSION` did not need a bump for it. See [`migrate_to_v2`].
const SCHEMA_VERSION: i32 = 2;

/// Current parser version — bump when parser.rs extraction logic changes
/// (e.g., new tag/mention patterns, heading extraction fixes, task parsing).
/// A bump triggers a full data clear + rebuild on next startup, without
/// touching the schema itself. This ensures stale index entries from an
/// older parser are replaced even if file content hasn't changed.
/// Note: independent of SCHEMA_VERSION — schema changes don't require a
/// parser version bump, and vice versa.
///
/// The bump is also what forces a full rebuild past the stat gate: with the
/// rows cleared there is no stored mtime/size to match, so every file is read.
/// The link graph (`links.db`) is only rewritten for files whose content index
/// entry changed, so a change to `parser::parse_links` needs a bump here too.
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
        // Idempotent, so it is also safe on a database `create_schema` just
        // made and on one whose earlier migration was interrupted.
        migrate_to_v2(&conn)?;
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
    // Update in place: replacing the row would reset `parser_version` to its
    // default, and the mismatch would then clear the whole index on a schema
    // migration that was written to keep it.
    let updated = conn
        .execute("UPDATE schema_version SET version = ?1", [version])
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        conn.execute("INSERT INTO schema_version (version) VALUES (?1)", [version])
            .map_err(|e| e.to_string())?;
    }
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
    conn.execute_batch(FTS_SQL)
        .map_err(|e| format!("Failed to create index schema: {}", e))?;
    Ok(())
}

/// Bring a v1 database to v2 in place.
///
/// - `files` gains nullable `mtime` and `size` columns.
/// - `files_fts` is dropped and recreated with `contentless_delete=1`. The old
///   table was contentless without it, where the `'delete'` command needs the
///   original text to remove postings; it was given an empty body, so every
///   reindex of a changed file left its old postings behind. Those cannot be
///   removed row by row, so the table is rebuilt.
/// - The indexed rows are KEPT. Their `mtime` is NULL, which the indexer reads
///   as "rewrite this file's rows" (`reindex_file`), so the next pass re-reads
///   every local file once and puts its full-text row back. Clearing the rows
///   instead (what a `PARSER_VERSION` bump does) would be simpler but would
///   drop the tags, mentions and tasks of every evicted iCloud file until it
///   is downloaded again, because those files are deliberately not read.
fn migrate_to_v2(conn: &Connection) -> Result<(), String> {
    let has_column = |name: &str| -> bool {
        conn.query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('files') WHERE name = ?1",
            [name],
            |row| row.get(0),
        )
        .unwrap_or(false)
    };
    let fts_sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name = 'files_fts'",
            [],
            |row| row.get(0),
        )
        .ok();
    let fts_current = fts_sql
        .as_deref()
        .is_some_and(|sql| sql.contains("contentless_delete"));
    let add_mtime = !has_column("mtime");
    let add_size = !has_column("size");
    if fts_current && !add_mtime && !add_size {
        return Ok(());
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to begin schema migration: {}", e))?;
    if add_mtime {
        tx.execute("ALTER TABLE files ADD COLUMN mtime INTEGER", [])
            .map_err(|e| format!("Failed to add files.mtime: {}", e))?;
    }
    if add_size {
        tx.execute("ALTER TABLE files ADD COLUMN size INTEGER", [])
            .map_err(|e| format!("Failed to add files.size: {}", e))?;
    }
    if !fts_current {
        // A row indexed before this migration must be rewritten even if its
        // columns already existed (an interrupted earlier attempt), so the
        // stat is cleared along with the full-text table.
        tx.execute_batch(&format!(
            "DROP TABLE IF EXISTS files_fts;
             {}
             UPDATE files SET mtime = NULL, size = NULL;",
            FTS_SQL
        ))
        .map_err(|e| format!("Failed to rebuild the full-text table: {}", e))?;
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit schema migration: {}", e))?;

    if !fts_current && fts_sql.is_some() {
        log::info!(target: "notesage::index",
            "Index schema migrated to v2 (full-text table rebuilt); every file is re-read once");
        // Give the pages of the dropped table back to the filesystem. Best
        // effort: a failure only leaves the file larger than it needs to be.
        let _ = conn.execute_batch("VACUUM");
    }
    Ok(())
}

/// Start a transaction unless one is already open on this connection.
///
/// Index passes release the connection lock between files so queries can
/// interleave, so "is a transaction open" is a property of the connection, not
/// of the caller: whoever writes next makes sure there is one, and whoever
/// reaches a commit point commits whatever is open ([`commit_txn`]).
pub(crate) fn ensure_txn(conn: &Connection) {
    if conn.is_autocommit() {
        let _ = conn.execute_batch("BEGIN");
    }
}

/// Commit the open transaction, if any.
pub(crate) fn commit_txn(conn: &Connection) {
    if !conn.is_autocommit() {
        if let Err(e) = conn.execute_batch("COMMIT") {
            log::warn!(target: "notesage::index", "Index commit failed: {}", e);
        }
    }
}

/// Run `work` inside a savepoint: all of it lands or none of it does. Nests
/// inside an open transaction; on its own it is a transaction.
pub(crate) fn with_savepoint<T>(
    conn: &Connection,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    // ROLLBACK TO leaves the savepoint open; RELEASE closes it.
    const UNDO: &str = "ROLLBACK TO SAVEPOINT index_unit; RELEASE SAVEPOINT index_unit";
    conn.execute_batch("SAVEPOINT index_unit")
        .map_err(|e| format!("Savepoint: {}", e))?;
    let result = work();
    if result.is_err() {
        let _ = conn.execute_batch(UNDO);
    } else if let Err(e) = conn.execute_batch("RELEASE SAVEPOINT index_unit") {
        let _ = conn.execute_batch(UNDO);
        return Err(format!("Release savepoint: {}", e));
    }
    result
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
    // CASCADE handles tags, mentions, headings, tasks, goals, research, research_tags.
    // The FTS row is deleted explicitly: `files_fts` is a contentless table
    // with `contentless_delete=1`, so a plain DELETE removes its postings.
    let file_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM files WHERE path = ?1",
            [path],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = file_id {
        conn.execute("DELETE FROM files_fts WHERE rowid = ?1", [id])?;
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
            conn.execute_batch(FTS_SQL).unwrap();
        }

        // open_or_create should add the column and set parser version
        let conn = open_or_create(&db_path).expect("Failed to open old DB");
        let pv = get_parser_version(&conn);
        assert_eq!(pv, PARSER_VERSION, "Parser version must be set after column migration");
    }

    /// The statements schema v1 shipped with (v0.62 and earlier), kept here so
    /// the migration is tested against a database made the old way.
    const SCHEMA_V1_SQL: &str = "
        CREATE TABLE schema_version (version INTEGER NOT NULL, parser_version INTEGER DEFAULT 0);
        CREATE TABLE files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            project_path TEXT,
            content_hash TEXT NOT NULL,
            title TEXT,
            has_frontmatter INTEGER DEFAULT 0,
            indexed_at INTEGER NOT NULL
        );
        CREATE TABLE tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            context_before TEXT DEFAULT '',
            context_after TEXT DEFAULT ''
        );
        CREATE TABLE mentions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            mention TEXT NOT NULL,
            context_before TEXT DEFAULT '',
            context_after TEXT DEFAULT ''
        );
        CREATE TABLE headings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            level INTEGER NOT NULL,
            text TEXT NOT NULL,
            position INTEGER NOT NULL
        );
        CREATE TABLE research (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
            source_url TEXT DEFAULT '',
            date_saved TEXT DEFAULT '',
            word_count INTEGER DEFAULT 0,
            snippet TEXT DEFAULT ''
        );
        CREATE TABLE research_tags (
            research_id INTEGER NOT NULL REFERENCES research(id) ON DELETE CASCADE,
            tag TEXT NOT NULL
        );
        CREATE TABLE tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            text TEXT NOT NULL,
            done INTEGER DEFAULT 0,
            position INTEGER NOT NULL,
            context_before TEXT DEFAULT '',
            context_after TEXT DEFAULT ''
        );
        CREATE TABLE goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            template TEXT DEFAULT '',
            total_tasks INTEGER DEFAULT 0,
            completed_tasks INTEGER DEFAULT 0
        );
        CREATE VIRTUAL TABLE files_fts USING fts5(
            title, body,
            content='',
            tokenize='porter unicode61'
        );
    ";

    fn fts_matches(conn: &Connection, term: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM files_fts WHERE files_fts MATCH ?1",
            [term],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn old_schema_db_migrates_in_place_and_works() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("index.db");

        // A v1 database with indexed data, including the stale FTS postings
        // the old delete left behind.
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(SCHEMA_V1_SQL).unwrap();
            conn.execute("INSERT INTO schema_version (version, parser_version) VALUES (1, 1)", [])
                .unwrap();
            conn.execute(
                "INSERT INTO files (path, name, content_hash, title, indexed_at) VALUES ('/p/a.md', 'a.md', 'h1', 'A', 1)",
                [],
            )
            .unwrap();
            conn.execute("INSERT INTO files_fts(rowid, title, body) VALUES (1, 'A', 'stale wording')", [])
                .unwrap();
            conn.execute("INSERT INTO tags (file_id, tag) VALUES (1, 'old')", []).unwrap();
        }

        let conn = open_or_create(&db_path).expect("a v1 database must open");

        assert_eq!(get_schema_version(&conn), SCHEMA_VERSION);
        assert_eq!(get_parser_version(&conn), PARSER_VERSION);
        let stat_columns: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name IN ('mtime', 'size')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stat_columns, 2, "files must gain mtime and size");
        let fts_sql: String = conn
            .query_row("SELECT sql FROM sqlite_master WHERE name = 'files_fts'", [], |r| r.get(0))
            .unwrap();
        assert!(fts_sql.contains("contentless_delete"), "{}", fts_sql);

        // The stale postings are gone; the rows themselves are kept (an
        // evicted iCloud file cannot be re-read to restore them) and carry no
        // stat, which makes the next pass rewrite every local file once.
        assert_eq!(fts_matches(&conn, "stale"), 0);
        let files: i64 = conn.query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0)).unwrap();
        let tags: i64 = conn.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0)).unwrap();
        assert_eq!((files, tags), (1, 1));
        let without_stat: i64 = conn
            .query_row("SELECT COUNT(*) FROM files WHERE mtime IS NULL AND size IS NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(without_stat, 1);

        // And the migrated database takes new-style rows.
        conn.execute(
            "INSERT INTO files (path, name, content_hash, indexed_at, mtime, size) VALUES ('/p/b.md', 'b.md', 'h2', 2, 123, 45)",
            [],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        conn.execute("INSERT INTO files_fts(rowid, title, body) VALUES (?1, 'B', 'fresh wording')", [id])
            .unwrap();
        assert_eq!(fts_matches(&conn, "fresh"), 1);
        remove_file(&conn, "/p/b.md").unwrap();
        assert_eq!(fts_matches(&conn, "fresh"), 0);

        // Re-opening is a no-op: the migration does not run a second time.
        conn.execute(
            "INSERT INTO files (path, name, content_hash, indexed_at, mtime, size) VALUES ('/p/c.md', 'c.md', 'h3', 3, 7, 8)",
            [],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        conn.execute("INSERT INTO files_fts(rowid, title, body) VALUES (?1, 'C', 'kept wording')", [id])
            .unwrap();
        drop(conn);
        let conn = open_or_create(&db_path).unwrap();
        let with_stat: i64 = conn
            .query_row("SELECT COUNT(*) FROM files WHERE mtime = 7 AND size = 8", [], |r| r.get(0))
            .unwrap();
        assert_eq!(with_stat, 1, "a second open must not reset the stat again");
        assert_eq!(fts_matches(&conn, "kept"), 1, "nor rebuild the full-text table again");
    }

    #[test]
    fn remove_file_deletes_its_fts_postings() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_or_create(&dir.path().join("test.db")).unwrap();

        for round in 0..5 {
            let _ = remove_file(&conn, "/p/a.md");
            conn.execute(
                "INSERT INTO files (path, name, content_hash, indexed_at) VALUES ('/p/a.md', 'a.md', ?1, 0)",
                [format!("h{}", round)],
            )
            .unwrap();
            let id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO files_fts(rowid, title, body) VALUES (?1, 'A', ?2)",
                rusqlite::params![id, format!("version{} shared", round)],
            )
            .unwrap();
        }

        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM files_fts", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1, "one file must be one FTS row however often it was reindexed");
        assert_eq!(fts_matches(&conn, "shared"), 1);
        assert_eq!(fts_matches(&conn, "version0"), 0, "text of an old version must not match");
        assert_eq!(fts_matches(&conn, "version4"), 1);

        clear_all(&conn).unwrap();
        assert_eq!(fts_matches(&conn, "shared"), 0);
    }

    #[test]
    fn savepoint_rolls_back_a_failed_unit_and_closes_itself() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_or_create(&dir.path().join("test.db")).unwrap();

        let failed: Result<(), String> = with_savepoint(&conn, || {
            conn.execute(
                "INSERT INTO files (path, name, content_hash, indexed_at) VALUES ('/p/a.md', 'a.md', 'h', 0)",
                [],
            )
            .map_err(|e| e.to_string())?;
            Err("boom".to_string())
        });
        assert!(failed.is_err());
        assert!(conn.is_autocommit(), "a failed savepoint must not leave a transaction open");
        let files: i64 = conn.query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0)).unwrap();
        assert_eq!(files, 0);

        // Inside a pass transaction the savepoint nests and the pass commits.
        ensure_txn(&conn);
        ensure_txn(&conn); // idempotent
        with_savepoint(&conn, || {
            conn.execute(
                "INSERT INTO files (path, name, content_hash, indexed_at) VALUES ('/p/a.md', 'a.md', 'h', 0)",
                [],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
        })
        .unwrap();
        assert!(!conn.is_autocommit());
        commit_txn(&conn);
        commit_txn(&conn); // idempotent
        assert!(conn.is_autocommit());
        let files: i64 = conn.query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0)).unwrap();
        assert_eq!(files, 1);
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
    indexed_at INTEGER NOT NULL,
    -- Stat gate (schema v2): modification time (ns since epoch) and byte size
    -- as of the last read. NULL until the file has been read under v2.
    mtime INTEGER,
    size INTEGER
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

";

/// Full-text search for file content. Contentless (the text lives in the
/// files themselves); `contentless_delete=1` (SQLite 3.43+; the bundled one is
/// 3.54) makes `DELETE FROM files_fts WHERE rowid = ?` remove the postings.
const FTS_SQL: &str = "
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    title, body,
    content='',
    contentless_delete=1,
    tokenize='porter unicode61'
);
";
