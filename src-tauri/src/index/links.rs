//! Standalone link-graph store (`~/.notesage/links.db`).
//!
//! This is a **separate** SQLite database from the content index
//! (`index.db`), deliberately so per ADR 0002/0003: the content index feeds
//! AI context, whereas the cross-project link graph intentionally spans the
//! project-isolation boundary (it is a *human* navigation primitive). Keeping
//! it in its own file makes it physically isolated from anything that feeds AI
//! context and trivial to audit against the "never auto-widens AI context"
//! rule.
//!
//! Scope (ADR 0003): only **projects + `~/Notesage`** are persisted here.
//! Explorer-folder content — including the surrounding-block context text of
//! ADR 0006 — is NEVER written. This is a data-security rule, enforced by
//! [`is_path_in_scope`] at every write path.
//!
//! The store records every internal document-to-document edge
//! (`link_edges`) plus a generalized per-file frontmatter capture
//! (`link_files`: `doc_type` / `title` / `description`, ADR 0005). Both tables
//! are scoped to the same in-scope roots; the graph is a derived, rebuildable,
//! iCloud-excluded artifact maintained by the existing watcher/reindex
//! pipeline.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;

use super::parser::LinkEdge;

/// Schema version for the link store — bump on table/column migrations.
const LINKS_SCHEMA_VERSION: i32 = 1;

/// Open or create the standalone link-graph database at the given path.
/// Enables WAL mode, sets a busy timeout, creates the schema if needed, and
/// excludes the DB (and its WAL/SHM companions) from iCloud backup.
pub fn open_or_create(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory for links DB: {}", e))?;
    }

    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open links DB at {}: {}", db_path.display(), e))?;

    // Same 5s busy timeout as index.db — rapid watcher-triggered reindex calls
    // contend on the write lock and would otherwise fail with "database is locked".
    conn.busy_timeout(Duration::from_millis(5000))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

    let version = get_schema_version(&conn);
    if version < LINKS_SCHEMA_VERSION {
        if version == 0 {
            create_schema(&conn)?;
        }
        // Future: migration steps for version > 1 here.
        set_schema_version(&conn, LINKS_SCHEMA_VERSION)?;
    }

    // Exclude from iCloud backup on macOS (derived, rebuildable per device).
    super::icloud::exclude_from_icloud(db_path);

    Ok(conn)
}

fn get_schema_version(conn: &Connection) -> i32 {
    conn.query_row("SELECT version FROM links_schema_version LIMIT 1", [], |row| {
        row.get(0)
    })
    .unwrap_or(0)
}

fn set_schema_version(conn: &Connection, version: i32) -> Result<(), String> {
    conn.execute("DELETE FROM links_schema_version", [])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO links_schema_version (version) VALUES (?1)",
        [version],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn create_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(SCHEMA_SQL)
        .map_err(|e| format!("Failed to create links schema: {}", e))?;
    Ok(())
}

/// Clear the whole link store (for a full rebuild / reset).
///
/// Mirrors `db::clear_all` for the content index. The current rebuild path
/// (`index_rebuild`) refreshes the graph per-source via [`replace_source`]
/// instead, so this is the primitive reserved for a future full
/// links-DB reset; kept for store-API parity.
#[allow(dead_code)]
pub fn clear_all(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DELETE FROM link_edges;
         DELETE FROM link_files;",
    )
    .map_err(|e| format!("Failed to clear links: {}", e))?;
    Ok(())
}

/// True if `path` lives inside any in-scope root.
///
/// In-scope roots are the registered project roots plus the `~/Notesage`
/// library root. Explorer folders are NOT in `scope_roots`, so this returns
/// `false` for them — the load-bearing security gate of ADR 0003. A trailing
/// path separator is appended to the prefix comparison so that a project root
/// `/a/proj` does not spuriously match a sibling `/a/proj-other`.
pub fn is_path_in_scope(path: &str, scope_roots: &[String]) -> bool {
    for root in scope_roots {
        if root.is_empty() {
            continue;
        }
        if path == root.as_str() {
            return true;
        }
        let with_sep = if root.ends_with('/') {
            root.clone()
        } else {
            format!("{}/", root)
        };
        if path.starts_with(&with_sep) {
            return true;
        }
    }
    false
}

/// Remove all rows (edges sourced from + file meta of) a given source file.
///
/// Edges TARGETING this path are intentionally retained: the target may be
/// re-created or another doc may still link to it, and a backlink to a
/// now-deleted file is still a valid "pending reference" (ADR 0007). On delete
/// we additionally null out the `target_file_id` of edges that pointed at it
/// (see [`reconcile_delete`]).
pub fn remove_source(conn: &Connection, source_path: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM link_edges WHERE source_path = ?1",
        [source_path],
    )
    .map_err(|e| format!("Failed to delete edges for source: {}", e))?;
    conn.execute("DELETE FROM link_files WHERE path = ?1", [source_path])
        .map_err(|e| format!("Failed to delete file meta: {}", e))?;
    Ok(())
}

/// Upsert the generalized frontmatter capture for a file.
fn upsert_file_meta(
    conn: &Connection,
    path: &str,
    doc_type: Option<&str>,
    title: Option<&str>,
    description: Option<&str>,
) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO link_files (path, doc_type, title, description)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(path) DO UPDATE SET
            doc_type = excluded.doc_type,
            title = excluded.title,
            description = excluded.description",
        params![path, doc_type, title, description],
    )
    .map_err(|e| format!("Failed to upsert file meta: {}", e))?;

    let id: i64 = conn
        .query_row("SELECT id FROM link_files WHERE path = ?1", [path], |row| {
            row.get(0)
        })
        .map_err(|e| format!("Failed to read file meta id: {}", e))?;
    Ok(id)
}

/// Resolve the `link_files.id` for a path if it is already known, else `None`.
fn known_file_id(conn: &Connection, path: &str) -> Option<i64> {
    conn.query_row("SELECT id FROM link_files WHERE path = ?1", [path], |row| {
        row.get(0)
    })
    .ok()
}

/// Replace all edges + file meta for one in-scope source file.
///
/// This is the single write entry point used by the reindex pipeline. The
/// caller MUST have already checked [`is_path_in_scope`] for `source_path`;
/// this function additionally guards on `scope_roots` so a stray call can
/// never persist out-of-scope content (defense-in-depth for the ADR 0003
/// regression lock).
///
/// Steps:
/// 1. Bail (no-op) if `source_path` is out of scope.
/// 2. Delete prior edges/meta for this source.
/// 3. Upsert generalized frontmatter (`doc_type`/`title`/`description`).
/// 4. Insert one row per extracted [`LinkEdge`], resolving `target_file_id`
///    from `link_files` when the target is already known.
#[allow(clippy::too_many_arguments)]
pub fn replace_source(
    conn: &Connection,
    source_path: &str,
    scope_roots: &[String],
    doc_type: Option<&str>,
    title: Option<&str>,
    description: Option<&str>,
    edges: &[LinkEdge],
) -> Result<(), String> {
    // SECURITY (ADR 0003): never persist out-of-scope (explorer) content.
    if !is_path_in_scope(source_path, scope_roots) {
        return Ok(());
    }

    remove_source(conn, source_path)?;

    let source_file_id = upsert_file_meta(conn, source_path, doc_type, title, description)?;

    for edge in edges {
        // Resolve target file-id from known file meta when possible.
        let target_file_id = if edge.is_internal {
            known_file_id(conn, &edge.target_path)
        } else {
            None
        };

        conn.execute(
            "INSERT INTO link_edges
                (source_path, source_file_id, target_path, target_file_id, link_text, context, is_internal)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                source_path,
                source_file_id,
                edge.target_path,
                target_file_id,
                edge.link_text,
                edge.context,
                edge.is_internal as i32,
            ],
        )
        .map_err(|e| format!("Failed to insert link edge: {}", e))?;
    }

    // A newly-(re)indexed source may itself be the target of pre-existing
    // unresolved edges — resolve those now so backlinks light up immediately.
    conn.execute(
        "UPDATE link_edges SET target_file_id = ?1
         WHERE target_path = ?2 AND target_file_id IS NULL",
        params![source_file_id, source_path],
    )
    .map_err(|e| format!("Failed to resolve pending edges: {}", e))?;

    Ok(())
}

/// Reconcile the graph after a file delete: drop the deleted source's own
/// rows, then null out `target_file_id` for any edge that pointed at it so the
/// edge survives as an unresolved/pending reference (ADR 0007).
pub fn reconcile_delete(conn: &Connection, path: &str) -> Result<(), String> {
    remove_source(conn, path)?;
    conn.execute(
        "UPDATE link_edges SET target_file_id = NULL WHERE target_path = ?1",
        [path],
    )
    .map_err(|e| format!("Failed to unresolve edges to deleted target: {}", e))?;
    Ok(())
}

/// Reconcile the graph after a file rename. Edges sourced from / targeting the
/// old path are repointed to the new path; file meta is repathed.
pub fn reconcile_rename(conn: &Connection, old_path: &str, new_path: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE link_edges SET source_path = ?1 WHERE source_path = ?2",
        params![new_path, old_path],
    )
    .map_err(|e| format!("Failed to repoint source edges on rename: {}", e))?;
    conn.execute(
        "UPDATE link_edges SET target_path = ?1 WHERE target_path = ?2",
        params![new_path, old_path],
    )
    .map_err(|e| format!("Failed to repoint target edges on rename: {}", e))?;
    conn.execute(
        "UPDATE link_files SET path = ?1 WHERE path = ?2",
        params![new_path, old_path],
    )
    .map_err(|e| format!("Failed to repath file meta on rename: {}", e))?;
    Ok(())
}

// ---- Query result types ----

// NOTE: these IPC result structs intentionally serialize as snake_case to match
// the rest of the `index::*` command surface (e.g. `FilenameSearchResult`,
// `IndexedTask` in queries.rs all use snake_case fields, consumed snake_case in
// `src/lib/tauri.ts`). The #7 frontend bindings live alongside those, so we keep
// the same convention rather than introducing a camelCase island here.

/// One occurrence of a backlink: a single edge from a source document.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BacklinkOccurrence {
    pub link_text: String,
    pub context: String,
}

/// Backlinks grouped by their source document.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BacklinkGroup {
    pub source_path: String,
    pub source_title: Option<String>,
    pub source_type: Option<String>,
    pub source_description: Option<String>,
    pub occurrences: Vec<BacklinkOccurrence>,
}

/// One outgoing (forward) link row — enriched with the target's frontmatter.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinkRow {
    pub source_path: String,
    pub target_path: String,
    pub link_text: String,
    pub context: String,
    pub is_internal: bool,
    /// `true` when the target resolves to a known in-scope file.
    pub resolved: bool,
    pub target_title: Option<String>,
    pub target_type: Option<String>,
    pub target_description: Option<String>,
}

/// A wikilink resolution candidate (filename + title match).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WikiTarget {
    pub path: String,
    pub title: Option<String>,
    pub doc_type: Option<String>,
    pub description: Option<String>,
}

// ---- Query functions ----

/// Backlinks for a target path, grouped by source document. Each group carries
/// the source's frontmatter (title/type/description, ADR 0006) and its
/// occurrences (link text + surrounding context).
pub fn query_backlinks(conn: &Connection, target_path: &str) -> Result<Vec<BacklinkGroup>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.source_path, lf.title, lf.doc_type, lf.description, e.link_text, e.context
             FROM link_edges e
             LEFT JOIN link_files lf ON lf.path = e.source_path
             WHERE e.target_path = ?1
             ORDER BY e.source_path ASC, e.id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([target_path], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut groups: Vec<BacklinkGroup> = Vec::new();
    for row in rows {
        let (source_path, title, doc_type, description, link_text, context) =
            row.map_err(|e| e.to_string())?;

        if let Some(group) = groups.last_mut() {
            if group.source_path == source_path {
                group
                    .occurrences
                    .push(BacklinkOccurrence { link_text, context });
                continue;
            }
        }

        groups.push(BacklinkGroup {
            source_path,
            source_title: title,
            source_type: doc_type,
            source_description: description,
            occurrences: vec![BacklinkOccurrence { link_text, context }],
        });
    }

    Ok(groups)
}

/// Outgoing (forward) links from a source path, enriched with each target's
/// frontmatter (title/type/description, ADR 0006).
pub fn query_outlinks(conn: &Connection, source_path: &str) -> Result<Vec<LinkRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.source_path, e.target_path, e.link_text, e.context, e.is_internal,
                    e.target_file_id, lf.title, lf.doc_type, lf.description
             FROM link_edges e
             LEFT JOIN link_files lf ON lf.path = e.target_path
             WHERE e.source_path = ?1
             ORDER BY e.id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([source_path], |row| {
            let target_file_id: Option<i64> = row.get(5)?;
            Ok(LinkRow {
                source_path: row.get(0)?,
                target_path: row.get(1)?,
                link_text: row.get(2)?,
                context: row.get(3)?,
                is_internal: row.get::<_, i32>(4)? != 0,
                resolved: target_file_id.is_some(),
                target_title: row.get(6)?,
                target_type: row.get(7)?,
                target_description: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Broken (dangling / unresolved) internal links: every internal edge whose
/// `target_file_id` is NULL (the target file is not known to the store).
/// Optionally restricted to sources under the given scope roots.
pub fn query_broken_links(conn: &Connection, scope_roots: &[String]) -> Result<Vec<LinkRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT source_path, target_path, link_text, context, is_internal
             FROM link_edges
             WHERE is_internal = 1 AND target_file_id IS NULL
             ORDER BY source_path ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(LinkRow {
                source_path: row.get(0)?,
                target_path: row.get(1)?,
                link_text: row.get(2)?,
                context: row.get(3)?,
                is_internal: row.get::<_, i32>(4)? != 0,
                resolved: false,
                target_title: None,
                target_type: None,
                target_description: None,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut all = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    // When scope roots are given, filter to sources within them. An empty
    // `scope_roots` means "no filter" (all broken links).
    if !scope_roots.is_empty() {
        all.retain(|row| is_path_in_scope(&row.source_path, scope_roots));
    }

    Ok(all)
}

/// Resolve a wikilink query against the link store — matches filename (the
/// path's basename, sans `.md`) and frontmatter title, workspace-global
/// (ADR 0002). Case-insensitive substring match; ranked by exactness.
pub fn resolve_wikilink(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<WikiTarget>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let escaped = trimmed
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    let pattern = format!("%{}%", escaped);
    let lower = trimmed.to_lowercase();

    // Basename is derived from `path` in SQL via a portable substring trick:
    // we can't easily basename in SQLite, so match against title OR the full
    // path's trailing segment. We over-match on path with LIKE then refine the
    // rank in Rust by comparing the basename.
    let mut stmt = conn
        .prepare(
            "SELECT path, title, doc_type, description
             FROM link_files
             WHERE title LIKE ?1 ESCAPE '\\' COLLATE NOCASE
                OR path LIKE ?1 ESCAPE '\\' COLLATE NOCASE
             ORDER BY title COLLATE NOCASE ASC, path COLLATE NOCASE ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&pattern], |row| {
            Ok(WikiTarget {
                path: row.get(0)?,
                title: row.get(1)?,
                doc_type: row.get(2)?,
                description: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut candidates: Vec<WikiTarget> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Keep only rows whose basename or title actually contains the query —
    // the `path LIKE` clause can match an interior directory segment.
    candidates.retain(|c| {
        let basename = basename_no_ext(&c.path).to_lowercase();
        let title_match = c
            .title
            .as_deref()
            .map(|t| t.to_lowercase().contains(&lower))
            .unwrap_or(false);
        basename.contains(&lower) || title_match
    });

    // Rank: exact basename/title match first, then prefix, then substring.
    candidates.sort_by_key(|c| {
        let basename = basename_no_ext(&c.path).to_lowercase();
        let title = c.title.as_deref().unwrap_or("").to_lowercase();
        let exact = basename == lower || title == lower;
        let prefix = basename.starts_with(&lower) || title.starts_with(&lower);
        // Lower sort key sorts first.
        if exact {
            0
        } else if prefix {
            1
        } else {
            2
        }
    });

    candidates.truncate(limit);
    Ok(candidates)
}

/// Basename of a path with a trailing `.md` removed.
fn basename_no_ext(path: &str) -> String {
    let base = path.rsplit('/').next().unwrap_or(path);
    base.strip_suffix(".md").unwrap_or(base).to_string()
}

const SCHEMA_SQL: &str = "
-- Schema version tracking (separate from index.db's schema_version)
CREATE TABLE IF NOT EXISTS links_schema_version (
    version INTEGER NOT NULL
);

-- Generalized per-file frontmatter capture (ADR 0005). One row per in-scope
-- file that participates in the link graph (as a source, or as a known
-- target once it is itself indexed).
CREATE TABLE IF NOT EXISTS link_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    doc_type TEXT,
    title TEXT,
    description TEXT
);
CREATE INDEX IF NOT EXISTS idx_link_files_path ON link_files(path);

-- Directed document-to-document edges (ADR 0003). `target_file_id` is NULL for
-- unresolved / dangling targets (ADR 0007). `context` is the surrounding-block
-- text of the link (ADR 0006), stored only for in-scope documents.
CREATE TABLE IF NOT EXISTS link_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL,
    source_file_id INTEGER,
    target_path TEXT NOT NULL,
    target_file_id INTEGER,
    link_text TEXT NOT NULL DEFAULT '',
    context TEXT NOT NULL DEFAULT '',
    is_internal INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_link_edges_source ON link_edges(source_path);
CREATE INDEX IF NOT EXISTS idx_link_edges_target ON link_edges(target_path);
";

#[cfg(test)]
mod tests {
    use super::*;

    fn open_mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(SCHEMA_SQL).unwrap();
        conn
    }

    fn edge(target: &str, text: &str, ctx: &str, internal: bool) -> LinkEdge {
        LinkEdge {
            target_path: target.to_string(),
            link_text: text.to_string(),
            context: ctx.to_string(),
            is_internal: internal,
        }
    }

    #[test]
    fn open_or_create_sets_wal_and_schema() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("links.db");
        let conn = open_or_create(&db_path).expect("open links db");

        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");

        let table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('link_edges','link_files')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 2, "both link tables must exist");

        let v = get_schema_version(&conn);
        assert_eq!(v, LINKS_SCHEMA_VERSION);
    }

    #[test]
    fn is_path_in_scope_matches_project_and_notes_root_only() {
        let roots = vec![
            "/Users/me/Code/proj".to_string(),
            "/Users/me/Notesage".to_string(),
        ];
        assert!(is_path_in_scope("/Users/me/Code/proj/a.md", &roots));
        assert!(is_path_in_scope("/Users/me/Notesage/note.md", &roots));
        assert!(is_path_in_scope("/Users/me/Code/proj", &roots)); // root itself
        // Sibling that shares a prefix but is a different folder.
        assert!(!is_path_in_scope("/Users/me/Code/proj-other/a.md", &roots));
        // An explorer folder elsewhere.
        assert!(!is_path_in_scope("/Users/me/Desktop/random/a.md", &roots));
    }

    #[test]
    fn replace_source_persists_edges_and_meta() {
        let conn = open_mem();
        let roots = vec!["/p".to_string()];
        let edges = vec![
            edge("/p/b.md", "B", "see B here", true),
            edge("https://x.com", "X", "external X", false),
        ];
        replace_source(
            &conn,
            "/p/a.md",
            &roots,
            Some("note"),
            Some("Doc A"),
            Some("about a"),
            &edges,
        )
        .unwrap();

        let edge_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM link_edges", [], |r| r.get(0))
            .unwrap();
        assert_eq!(edge_count, 2);

        let file_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM link_files", [], |r| r.get(0))
            .unwrap();
        assert_eq!(file_count, 1);

        let (doc_type, title, desc): (Option<String>, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT doc_type, title, description FROM link_files WHERE path='/p/a.md'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(doc_type.as_deref(), Some("note"));
        assert_eq!(title.as_deref(), Some("Doc A"));
        assert_eq!(desc.as_deref(), Some("about a"));
    }

    #[test]
    fn replace_source_is_noop_for_out_of_scope_source() {
        // REGRESSION LOCK (ADR 0003): explorer-folder content is NEVER persisted.
        let conn = open_mem();
        let roots = vec!["/p".to_string(), "/Users/me/Notesage".to_string()];
        let edges = vec![edge("/explorer/secret.md", "Secret", "leaked context", true)];

        replace_source(
            &conn,
            "/explorer/random.md", // outside every scope root
            &roots,
            Some("secret"),
            Some("Secret Notes"),
            Some("private explorer content"),
            &edges,
        )
        .unwrap();

        let edge_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM link_edges", [], |r| r.get(0))
            .unwrap();
        let file_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM link_files", [], |r| r.get(0))
            .unwrap();
        assert_eq!(edge_count, 0, "explorer edges must never be written");
        assert_eq!(file_count, 0, "explorer file meta must never be written");

        // And no explorer context text leaked anywhere.
        let ctx_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM link_edges WHERE context LIKE '%leaked%' OR context LIKE '%private%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ctx_count, 0);
    }

    #[test]
    fn replace_source_resolves_pending_target() {
        let conn = open_mem();
        let roots = vec!["/p".to_string()];

        // a.md links to b.md before b.md is indexed → unresolved edge.
        replace_source(
            &conn,
            "/p/a.md",
            &roots,
            None,
            Some("A"),
            None,
            &[edge("/p/b.md", "B", "ctx", true)],
        )
        .unwrap();
        let target_id: Option<i64> = conn
            .query_row("SELECT target_file_id FROM link_edges WHERE source_path='/p/a.md'", [], |r| r.get(0))
            .unwrap();
        assert!(target_id.is_none(), "edge must start unresolved");

        // Now index b.md → the pending edge resolves.
        replace_source(&conn, "/p/b.md", &roots, None, Some("B"), None, &[]).unwrap();
        let target_id2: Option<i64> = conn
            .query_row("SELECT target_file_id FROM link_edges WHERE source_path='/p/a.md'", [], |r| r.get(0))
            .unwrap();
        assert!(target_id2.is_some(), "edge must resolve once target is indexed");
    }

    #[test]
    fn query_backlinks_groups_by_source() {
        let conn = open_mem();
        let roots = vec!["/p".to_string()];
        // a.md links to target twice; c.md links once.
        replace_source(
            &conn,
            "/p/a.md",
            &roots,
            Some("note"),
            Some("Doc A"),
            Some("desc a"),
            &[
                edge("/p/target.md", "first", "first ctx", true),
                edge("/p/target.md", "second", "second ctx", true),
            ],
        )
        .unwrap();
        replace_source(
            &conn,
            "/p/c.md",
            &roots,
            None,
            Some("Doc C"),
            None,
            &[edge("/p/target.md", "third", "third ctx", true)],
        )
        .unwrap();

        let groups = query_backlinks(&conn, "/p/target.md").unwrap();
        assert_eq!(groups.len(), 2, "two distinct source docs");
        let a = groups.iter().find(|g| g.source_path == "/p/a.md").unwrap();
        assert_eq!(a.occurrences.len(), 2);
        assert_eq!(a.source_title.as_deref(), Some("Doc A"));
        assert_eq!(a.source_type.as_deref(), Some("note"));
        assert_eq!(a.source_description.as_deref(), Some("desc a"));
        let c = groups.iter().find(|g| g.source_path == "/p/c.md").unwrap();
        assert_eq!(c.occurrences.len(), 1);
        assert_eq!(c.occurrences[0].context, "third ctx");
    }

    #[test]
    fn query_outlinks_enriches_with_target_meta() {
        let conn = open_mem();
        let roots = vec!["/p".to_string()];
        // Index target first so its meta is known.
        replace_source(
            &conn,
            "/p/b.md",
            &roots,
            Some("table"),
            Some("Table B"),
            Some("a table"),
            &[],
        )
        .unwrap();
        replace_source(
            &conn,
            "/p/a.md",
            &roots,
            None,
            Some("A"),
            None,
            &[
                edge("/p/b.md", "B", "see B", true),
                edge("/p/missing.md", "M", "see M", true),
                edge("https://x.com", "X", "ext", false),
            ],
        )
        .unwrap();

        let out = query_outlinks(&conn, "/p/a.md").unwrap();
        assert_eq!(out.len(), 3);
        let b = out.iter().find(|r| r.target_path == "/p/b.md").unwrap();
        assert!(b.resolved);
        assert_eq!(b.target_title.as_deref(), Some("Table B"));
        assert_eq!(b.target_type.as_deref(), Some("table"));
        let m = out.iter().find(|r| r.target_path == "/p/missing.md").unwrap();
        assert!(!m.resolved, "missing target is unresolved");
        let x = out.iter().find(|r| r.target_path == "https://x.com").unwrap();
        assert!(!x.is_internal);
    }

    #[test]
    fn query_broken_links_returns_unresolved_internal_only() {
        let conn = open_mem();
        let roots = vec!["/p".to_string()];
        replace_source(
            &conn,
            "/p/a.md",
            &roots,
            None,
            Some("A"),
            None,
            &[
                edge("/p/missing.md", "M", "ctx m", true),
                edge("https://x.com", "X", "ext", false), // external, not broken
            ],
        )
        .unwrap();

        let broken = query_broken_links(&conn, &[]).unwrap();
        assert_eq!(broken.len(), 1);
        assert_eq!(broken[0].target_path, "/p/missing.md");

        // Scope filter excludes sources outside the given roots.
        let broken_scoped = query_broken_links(&conn, &["/other".to_string()]).unwrap();
        assert!(broken_scoped.is_empty());
    }

    #[test]
    fn resolve_wikilink_matches_filename_and_title() {
        let conn = open_mem();
        let roots = vec!["/p".to_string()];
        replace_source(&conn, "/p/orders.md", &roots, Some("table"), Some("Orders Table"), Some("orders"), &[]).unwrap();
        replace_source(&conn, "/p/customers.md", &roots, None, Some("Customers"), None, &[]).unwrap();
        replace_source(&conn, "/p/notes/order-history.md", &roots, None, Some("Order History"), None, &[]).unwrap();

        // Match by filename basename.
        let by_name = resolve_wikilink(&conn, "orders", 10).unwrap();
        let paths: Vec<&str> = by_name.iter().map(|t| t.path.as_str()).collect();
        assert!(paths.contains(&"/p/orders.md"));

        // Match by title substring.
        let by_title = resolve_wikilink(&conn, "Customers", 10).unwrap();
        assert_eq!(by_title.len(), 1);
        assert_eq!(by_title[0].path, "/p/customers.md");

        // Exact basename ranks ahead of substring matches.
        let ranked = resolve_wikilink(&conn, "orders", 10).unwrap();
        assert_eq!(ranked[0].path, "/p/orders.md", "exact basename match ranks first");
    }

    #[test]
    fn resolve_wikilink_empty_query_returns_empty() {
        let conn = open_mem();
        assert!(resolve_wikilink(&conn, "", 10).unwrap().is_empty());
        assert!(resolve_wikilink(&conn, "   ", 10).unwrap().is_empty());
    }

    #[test]
    fn reconcile_delete_unresolves_incoming_edges() {
        let conn = open_mem();
        let roots = vec!["/p".to_string()];
        replace_source(&conn, "/p/b.md", &roots, None, Some("B"), None, &[]).unwrap();
        replace_source(&conn, "/p/a.md", &roots, None, Some("A"), None, &[edge("/p/b.md", "B", "ctx", true)]).unwrap();
        // edge a→b is resolved
        let resolved: Option<i64> = conn
            .query_row("SELECT target_file_id FROM link_edges WHERE source_path='/p/a.md'", [], |r| r.get(0))
            .unwrap();
        assert!(resolved.is_some());

        reconcile_delete(&conn, "/p/b.md").unwrap();
        // b.md's own meta is gone, but the incoming edge survives as unresolved.
        let edge_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM link_edges WHERE source_path='/p/a.md'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(edge_count, 1, "incoming edge survives delete (pending reference)");
        let resolved_after: Option<i64> = conn
            .query_row("SELECT target_file_id FROM link_edges WHERE source_path='/p/a.md'", [], |r| r.get(0))
            .unwrap();
        assert!(resolved_after.is_none(), "edge becomes unresolved after target delete");
    }

    #[test]
    fn reconcile_rename_repoints_edges_and_meta() {
        let conn = open_mem();
        let roots = vec!["/p".to_string()];
        replace_source(&conn, "/p/old.md", &roots, None, Some("Old"), None, &[edge("/p/x.md", "X", "ctx", true)]).unwrap();
        replace_source(&conn, "/p/c.md", &roots, None, Some("C"), None, &[edge("/p/old.md", "Old", "ctx2", true)]).unwrap();

        reconcile_rename(&conn, "/p/old.md", "/p/new.md").unwrap();

        // Source edges repointed.
        let src: String = conn
            .query_row("SELECT source_path FROM link_edges WHERE link_text='X'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(src, "/p/new.md");
        // Target edges repointed.
        let tgt: String = conn
            .query_row("SELECT target_path FROM link_edges WHERE source_path='/p/c.md'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tgt, "/p/new.md");
        // File meta repathed.
        let meta_path: String = conn
            .query_row("SELECT path FROM link_files WHERE title='Old'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(meta_path, "/p/new.md");
    }
}
