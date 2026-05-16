use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

// ---- Result types ----

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IndexedTag {
    pub tag: String,
    pub file_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TagOccurrence {
    pub path: String,
    pub file_name: String,
    pub context_before: String,
    pub context_after: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IndexedMention {
    pub mention: String,
    pub file_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ResearchResult {
    pub file: String,
    pub title: String,
    pub tags: Vec<String>,
    pub source_url: String,
    pub snippet: String,
    pub date_saved: String,
    pub word_count: usize,
    pub project_name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IndexedTask {
    pub path: String,
    pub file_name: String,
    pub text: String,
    pub done: bool,
    pub position: usize,
    pub context_before: String,
    pub context_after: String,
    pub project_name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IndexedGoal {
    pub path: String,
    pub file_name: String,
    pub title: String,
    pub template: String,
    pub total_tasks: usize,
    pub completed_tasks: usize,
    pub project_name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContentSearchResult {
    pub path: String,
    pub file_name: String,
    pub title: Option<String>,
    pub snippet: String,
    pub rank: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FilenameSearchResult {
    /// Absolute path to the file.
    pub path: String,
    /// Basename (last path segment).
    pub file_name: String,
    /// Parent directory of the file (`""` when the file lives at filesystem root).
    pub parent_dir: String,
    /// Project root the file belongs to, or `None` for files in the
    /// `~/Notesage` library / other non-project scopes.
    pub project_root: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IndexStats {
    pub file_count: usize,
    pub tag_count: usize,
    pub mention_count: usize,
    pub task_count: usize,
    pub goal_count: usize,
    pub indexed_at: u64,
}

// ---- Query functions ----

/// Get unique tags with file counts, optionally filtered by prefix.
pub fn query_tags(conn: &Connection, query: Option<&str>) -> Result<Vec<IndexedTag>, String> {
    let pattern = query.map(|q| format!("%{}%", q));

    let sql = if pattern.is_some() {
        "SELECT tag, COUNT(DISTINCT file_id) as cnt FROM tags WHERE tag LIKE ?1 GROUP BY tag ORDER BY cnt DESC, tag ASC"
    } else {
        "SELECT tag, COUNT(DISTINCT file_id) as cnt FROM tags GROUP BY tag ORDER BY cnt DESC, tag ASC"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    let mut rows = if let Some(ref p) = pattern {
        stmt.query(rusqlite::params![p])
    } else {
        stmt.query([])
    }
    .map_err(|e| e.to_string())?;

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        results.push(IndexedTag {
            tag: row.get(0).map_err(|e| e.to_string())?,
            file_count: row.get::<_, i64>(1).map_err(|e| e.to_string())? as usize,
        });
    }

    Ok(results)
}

/// Get all occurrences of a specific tag.
pub fn query_tag_occurrences(conn: &Connection, tag: &str) -> Result<Vec<TagOccurrence>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT f.path, f.name, t.context_before, t.context_after
             FROM tags t JOIN files f ON t.file_id = f.id
             WHERE t.tag = ?1
             ORDER BY f.name ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([tag], |row| {
            Ok(TagOccurrence {
                path: row.get(0)?,
                file_name: row.get(1)?,
                context_before: row.get(2)?,
                context_after: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Get unique mentions with file counts, optionally filtered.
pub fn query_mentions(conn: &Connection, query: Option<&str>) -> Result<Vec<IndexedMention>, String> {
    let pattern = query.map(|q| format!("%{}%", q));

    let sql = if pattern.is_some() {
        "SELECT mention, COUNT(DISTINCT file_id) as cnt FROM mentions WHERE mention LIKE ?1 GROUP BY mention ORDER BY cnt DESC, mention ASC"
    } else {
        "SELECT mention, COUNT(DISTINCT file_id) as cnt FROM mentions GROUP BY mention ORDER BY cnt DESC, mention ASC"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    let mut rows = if let Some(ref p) = pattern {
        stmt.query(rusqlite::params![p])
    } else {
        stmt.query([])
    }
    .map_err(|e| e.to_string())?;

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        results.push(IndexedMention {
            mention: row.get(0).map_err(|e| e.to_string())?,
            file_count: row.get::<_, i64>(1).map_err(|e| e.to_string())? as usize,
        });
    }

    Ok(results)
}

/// Get all occurrences of a specific mention.
pub fn query_mention_occurrences(conn: &Connection, mention: &str) -> Result<Vec<TagOccurrence>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT f.path, f.name, m.context_before, m.context_after
             FROM mentions m JOIN files f ON m.file_id = f.id
             WHERE m.mention = ?1
             ORDER BY f.name ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([mention], |row| {
            Ok(TagOccurrence {
                path: row.get(0)?,
                file_name: row.get(1)?,
                context_before: row.get(2)?,
                context_after: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Search research files.
pub fn query_research(
    conn: &Connection,
    query: Option<&str>,
    tag: Option<&str>,
    limit: usize,
) -> Result<Vec<ResearchResult>, String> {
    // Build SQL dynamically based on filters
    let mut conditions = Vec::new();
    let mut param_values: Vec<String> = Vec::new();

    if let Some(q) = query {
        let pattern = format!("%{}%", q);
        conditions.push(format!(
            "(f.title LIKE ?{n} OR r.source_url LIKE ?{n} OR r.snippet LIKE ?{n})",
            n = param_values.len() + 1
        ));
        param_values.push(pattern);
    }

    if let Some(t) = tag {
        conditions.push(format!(
            "EXISTS (SELECT 1 FROM research_tags rt WHERE rt.research_id = r.id AND rt.tag LIKE ?{})",
            param_values.len() + 1
        ));
        param_values.push(format!("%{}%", t));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        "SELECT f.path, COALESCE(f.title, f.name) as title, r.source_url, r.snippet, r.date_saved, r.word_count, f.project_path, r.id
         FROM research r
         JOIN files f ON r.file_id = f.id
         {}
         ORDER BY r.date_saved DESC
         LIMIT ?{}",
        where_clause,
        param_values.len() + 1
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    // Build params dynamically
    let limit_i64 = limit as i64;
    let mut all_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    for v in &param_values {
        all_params.push(Box::new(v.clone()));
    }
    all_params.push(Box::new(limit_i64));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = all_params.iter().map(|p| p.as_ref()).collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)? as usize,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, i64>(7)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        let (path, title, source_url, snippet, date_saved, word_count, project_path, research_id) =
            row.map_err(|e| e.to_string())?;

        // Fetch tags for this research entry
        let tags = query_research_tags(conn, research_id)?;

        let project_name = project_path.as_ref().and_then(|p| {
            std::path::Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
        });

        results.push(ResearchResult {
            file: path,
            title,
            tags,
            source_url,
            snippet,
            date_saved,
            word_count,
            project_name,
        });
    }

    Ok(results)
}

fn query_research_tags(conn: &Connection, research_id: i64) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT tag FROM research_tags WHERE research_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([research_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<String>, _>>().map_err(|e| e.to_string())
}

/// Query tasks, optionally filtered by completion status and text.
pub fn query_tasks(
    conn: &Connection,
    done: Option<bool>,
    query: Option<&str>,
    limit: usize,
) -> Result<Vec<IndexedTask>, String> {
    let mut conditions = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(d) = done {
        conditions.push(format!("t.done = ?{}", param_values.len() + 1));
        param_values.push(Box::new(d as i32));
    }

    if let Some(q) = query {
        conditions.push(format!("t.text LIKE ?{}", param_values.len() + 1));
        param_values.push(Box::new(format!("%{}%", q)));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        "SELECT f.path, f.name, t.text, t.done, t.position, t.context_before, t.context_after, f.project_path
         FROM tasks t
         JOIN files f ON t.file_id = f.id
         {}
         ORDER BY f.name ASC, t.position ASC
         LIMIT ?{}",
        where_clause,
        param_values.len() + 1
    );

    let limit_i64 = limit as i64;
    param_values.push(Box::new(limit_i64));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            let project_path: Option<String> = row.get(7)?;
            let project_name = project_path.as_ref().and_then(|p| {
                std::path::Path::new(p)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
            });
            Ok(IndexedTask {
                path: row.get(0)?,
                file_name: row.get(1)?,
                text: row.get(2)?,
                done: row.get::<_, i32>(3)? != 0,
                position: row.get::<_, i64>(4)? as usize,
                context_before: row.get(5)?,
                context_after: row.get(6)?,
                project_name,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Query goal files.
pub fn query_goals(conn: &Connection) -> Result<Vec<IndexedGoal>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT f.path, f.name, g.title, g.template, g.total_tasks, g.completed_tasks, f.project_path
             FROM goals g
             JOIN files f ON g.file_id = f.id
             ORDER BY g.title ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let project_path: Option<String> = row.get(6)?;
            let project_name = project_path.as_ref().and_then(|p| {
                std::path::Path::new(p)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
            });
            Ok(IndexedGoal {
                path: row.get(0)?,
                file_name: row.get(1)?,
                title: row.get(2)?,
                template: row.get(3)?,
                total_tasks: row.get::<_, i64>(4)? as usize,
                completed_tasks: row.get::<_, i64>(5)? as usize,
                project_name,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Full-text content search using FTS5.
pub fn query_content(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<ContentSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    // Escape FTS5 special characters and append * for prefix matching
    let fts_query = build_fts_query(query);

    let mut stmt = conn
        .prepare(
            "SELECT f.path, f.name, f.title,
                    snippet(files_fts, 1, '<b>', '</b>', '...', 20) as snip,
                    rank
             FROM files_fts
             JOIN files f ON files_fts.rowid = f.id
             WHERE files_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![fts_query, limit as i64], |row| {
            Ok(ContentSearchResult {
                path: row.get(0)?,
                file_name: row.get(1)?,
                title: row.get(2)?,
                snippet: row.get(3)?,
                rank: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Search files by basename (case-insensitive substring match).
///
/// Used by the FloatingCommandBar `:file` verb mode (PRD
/// `2026-04-28-cmd-bar-verb-prefixes`). Empty/whitespace-only queries
/// return an empty list — callers wanting an MRU listing render that
/// from `editor-store.recentFiles` instead.
///
/// `LIKE` over `files.name` is fast enough for typical N=1k–10k file
/// workspaces; switch to FTS5-on-name if rank/scale becomes an issue.
pub fn query_filenames(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<FilenameSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    // SQL `LIKE` `%` and `_` are wildcards — escape them so the user's
    // literal text matches as a substring. `\` is the escape char (set
    // via `ESCAPE` clause) so it also needs escaping.
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    let pattern = format!("%{}%", escaped);

    let mut stmt = conn
        .prepare(
            "SELECT path, name, project_path
             FROM files
             WHERE name LIKE ?1 ESCAPE '\\' COLLATE NOCASE
             ORDER BY name COLLATE NOCASE ASC
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![pattern, limit as i64], |row| {
            let path: String = row.get(0)?;
            let file_name: String = row.get(1)?;
            let project_root: Option<String> = row.get(2)?;
            // Derive parent_dir from path; cheaper than another column
            // and stays in sync with renames automatically.
            let parent_dir = path
                .rfind('/')
                .map(|i| path[..i].to_string())
                .unwrap_or_default();
            Ok(FilenameSearchResult {
                path,
                file_name,
                parent_dir,
                project_root,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Build an FTS5 query string from user input.
/// Appends * to the last token for prefix matching.
fn build_fts_query(input: &str) -> String {
    let tokens: Vec<&str> = input.split_whitespace().collect();
    if tokens.is_empty() {
        return String::new();
    }

    let mut parts: Vec<String> = Vec::new();
    for (i, token) in tokens.iter().enumerate() {
        // Escape double quotes
        let escaped = token.replace('"', "\"\"");
        if i == tokens.len() - 1 {
            // Last token gets prefix matching
            parts.push(format!("\"{}\"*", escaped));
        } else {
            parts.push(format!("\"{}\"", escaped));
        }
    }
    parts.join(" ")
}

/// Get index statistics.
pub fn query_stats(conn: &Connection) -> Result<IndexStats, String> {
    let file_count: usize = conn
        .query_row("SELECT COUNT(*) FROM files", [], |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())? as usize;
    let tag_count: usize = conn
        .query_row("SELECT COUNT(DISTINCT tag) FROM tags", [], |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())? as usize;
    let mention_count: usize = conn
        .query_row("SELECT COUNT(DISTINCT mention) FROM mentions", [], |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())? as usize;
    let task_count: usize = conn
        .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())? as usize;
    let goal_count: usize = conn
        .query_row("SELECT COUNT(*) FROM goals", [], |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())? as usize;
    let indexed_at: u64 = conn
        .query_row(
            "SELECT COALESCE(MAX(indexed_at), 0) FROM files",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())? as u64;

    Ok(IndexStats {
        file_count,
        tag_count,
        mention_count,
        task_count,
        goal_count,
        indexed_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    const SCHEMA_SQL: &str = "
        CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
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
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            context_before TEXT DEFAULT '',
            context_after TEXT DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
        CREATE INDEX IF NOT EXISTS idx_tags_file ON tags(file_id);
        CREATE TABLE IF NOT EXISTS mentions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            mention TEXT NOT NULL,
            context_before TEXT DEFAULT '',
            context_after TEXT DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_mentions_mention ON mentions(mention);
        CREATE INDEX IF NOT EXISTS idx_mentions_file ON mentions(file_id);
        CREATE TABLE IF NOT EXISTS headings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            level INTEGER NOT NULL,
            text TEXT NOT NULL,
            position INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_headings_file ON headings(file_id);
        CREATE TABLE IF NOT EXISTS research (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
            source_url TEXT DEFAULT '',
            date_saved TEXT DEFAULT '',
            word_count INTEGER DEFAULT 0,
            snippet TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS research_tags (
            research_id INTEGER NOT NULL REFERENCES research(id) ON DELETE CASCADE,
            tag TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_research_tags ON research_tags(tag);
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
        CREATE TABLE IF NOT EXISTS goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            template TEXT DEFAULT '',
            total_tasks INTEGER DEFAULT 0,
            completed_tasks INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_goals_file ON goals(file_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
            title, body,
            tokenize='porter unicode61'
        );
    ";

    /// Create an in-memory database with the full schema.
    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("Failed to open in-memory DB");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("Failed to enable foreign keys");
        conn.execute_batch(SCHEMA_SQL)
            .expect("Failed to create schema");
        conn
    }

    /// Insert a file record and return its id.
    fn insert_file(conn: &Connection, path: &str, name: &str, project_path: Option<&str>, title: Option<&str>) -> i64 {
        conn.execute(
            "INSERT INTO files (path, name, project_path, content_hash, title, has_frontmatter, indexed_at)
             VALUES (?1, ?2, ?3, 'hash123', ?4, 0, 1000)",
            params![path, name, project_path, title],
        )
        .expect("Failed to insert file");
        conn.last_insert_rowid()
    }

    // ---- query_tags tests ----

    #[test]
    fn test_query_tags_empty_db() {
        let conn = setup_db();
        let result = query_tags(&conn, None).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_query_tags_returns_unique_tags_with_counts() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/notes.md", "notes.md", None, None);
        let file2 = insert_file(&conn, "/a/todo.md", "todo.md", None, None);

        // #rust in both files, #python in one
        conn.execute("INSERT INTO tags (file_id, tag, context_before, context_after) VALUES (?1, 'rust', 'before', 'after')", [file1]).unwrap();
        conn.execute("INSERT INTO tags (file_id, tag, context_before, context_after) VALUES (?1, 'rust', 'ctx', 'ctx')", [file2]).unwrap();
        conn.execute("INSERT INTO tags (file_id, tag, context_before, context_after) VALUES (?1, 'python', 'ctx', 'ctx')", [file1]).unwrap();

        let result = query_tags(&conn, None).unwrap();
        assert_eq!(result.len(), 2);
        // Sorted by count desc: rust (2 files) first, python (1 file) second
        assert_eq!(result[0].tag, "rust");
        assert_eq!(result[0].file_count, 2);
        assert_eq!(result[1].tag, "python");
        assert_eq!(result[1].file_count, 1);
    }

    #[test]
    fn test_query_tags_with_filter() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/notes.md", "notes.md", None, None);

        conn.execute("INSERT INTO tags (file_id, tag) VALUES (?1, 'rust')", [file1]).unwrap();
        conn.execute("INSERT INTO tags (file_id, tag) VALUES (?1, 'rustlang')", [file1]).unwrap();
        conn.execute("INSERT INTO tags (file_id, tag) VALUES (?1, 'python')", [file1]).unwrap();

        let result = query_tags(&conn, Some("rust")).unwrap();
        assert_eq!(result.len(), 2);
        // Both "rust" and "rustlang" match the LIKE %rust% filter
        let tags: Vec<&str> = result.iter().map(|t| t.tag.as_str()).collect();
        assert!(tags.contains(&"rust"));
        assert!(tags.contains(&"rustlang"));
    }

    #[test]
    fn test_query_tags_duplicate_in_same_file_counts_as_one() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/notes.md", "notes.md", None, None);

        // Same tag twice in the same file
        conn.execute("INSERT INTO tags (file_id, tag) VALUES (?1, 'rust')", [file1]).unwrap();
        conn.execute("INSERT INTO tags (file_id, tag) VALUES (?1, 'rust')", [file1]).unwrap();

        let result = query_tags(&conn, None).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].file_count, 1); // COUNT(DISTINCT file_id) = 1
    }

    // ---- query_tag_occurrences tests ----

    #[test]
    fn test_query_tag_occurrences() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/notes.md", "notes.md", None, None);
        let file2 = insert_file(&conn, "/a/todo.md", "todo.md", None, None);

        conn.execute("INSERT INTO tags (file_id, tag, context_before, context_after) VALUES (?1, 'rust', 'learning', 'is fun')", [file1]).unwrap();
        conn.execute("INSERT INTO tags (file_id, tag, context_before, context_after) VALUES (?1, 'rust', 'use', 'here')", [file2]).unwrap();

        let result = query_tag_occurrences(&conn, "rust").unwrap();
        assert_eq!(result.len(), 2);
        // Sorted by file name ASC
        assert_eq!(result[0].file_name, "notes.md");
        assert_eq!(result[0].context_before, "learning");
        assert_eq!(result[0].context_after, "is fun");
        assert_eq!(result[1].file_name, "todo.md");
    }

    #[test]
    fn test_query_tag_occurrences_no_match() {
        let conn = setup_db();
        let result = query_tag_occurrences(&conn, "nonexistent").unwrap();
        assert!(result.is_empty());
    }

    // ---- query_mentions tests ----

    #[test]
    fn test_query_mentions_empty() {
        let conn = setup_db();
        let result = query_mentions(&conn, None).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_query_mentions_returns_unique_with_counts() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/notes.md", "notes.md", None, None);
        let file2 = insert_file(&conn, "/a/todo.md", "todo.md", None, None);

        conn.execute("INSERT INTO mentions (file_id, mention) VALUES (?1, 'alice')", [file1]).unwrap();
        conn.execute("INSERT INTO mentions (file_id, mention) VALUES (?1, 'alice')", [file2]).unwrap();
        conn.execute("INSERT INTO mentions (file_id, mention) VALUES (?1, 'bob')", [file1]).unwrap();

        let result = query_mentions(&conn, None).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].mention, "alice");
        assert_eq!(result[0].file_count, 2);
        assert_eq!(result[1].mention, "bob");
        assert_eq!(result[1].file_count, 1);
    }

    #[test]
    fn test_query_mentions_with_filter() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/notes.md", "notes.md", None, None);

        conn.execute("INSERT INTO mentions (file_id, mention) VALUES (?1, 'alice')", [file1]).unwrap();
        conn.execute("INSERT INTO mentions (file_id, mention) VALUES (?1, 'bob')", [file1]).unwrap();

        let result = query_mentions(&conn, Some("ali")).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].mention, "alice");
    }

    // ---- query_mention_occurrences tests ----

    #[test]
    fn test_query_mention_occurrences() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/notes.md", "notes.md", None, None);

        conn.execute("INSERT INTO mentions (file_id, mention, context_before, context_after) VALUES (?1, 'alice', 'ask', 'about it')", [file1]).unwrap();

        let result = query_mention_occurrences(&conn, "alice").unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].context_before, "ask");
        assert_eq!(result[0].context_after, "about it");
    }

    // ---- query_content (FTS5) tests ----

    #[test]
    fn test_query_content_empty_query_returns_empty() {
        let conn = setup_db();
        let result = query_content(&conn, "", 10).unwrap();
        assert!(result.is_empty());

        let result2 = query_content(&conn, "   ", 10).unwrap();
        assert!(result2.is_empty());
    }

    #[test]
    fn test_query_content_finds_matching_documents() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/notes.md", "notes.md", None, Some("Rust Guide"));
        let file2 = insert_file(&conn, "/a/todo.md", "todo.md", None, Some("Python Guide"));

        conn.execute(
            "INSERT INTO files_fts(rowid, title, body) VALUES (?1, 'Rust Guide', 'Learning Rust programming language is rewarding')",
            [file1],
        ).unwrap();
        conn.execute(
            "INSERT INTO files_fts(rowid, title, body) VALUES (?1, 'Python Guide', 'Python is a great scripting language')",
            [file2],
        ).unwrap();

        let result = query_content(&conn, "Rust", 10).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].file_name, "notes.md");
        assert_eq!(result[0].title, Some("Rust Guide".to_string()));
    }

    #[test]
    fn test_query_content_prefix_matching() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/notes.md", "notes.md", None, Some("Programming"));

        conn.execute(
            "INSERT INTO files_fts(rowid, title, body) VALUES (?1, 'Programming', 'Rust and Rustaceans love programming')",
            [file1],
        ).unwrap();

        // "Progr" should match "Programming" via prefix matching (last token gets *)
        let result = query_content(&conn, "Progr", 10).unwrap();
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_query_content_respects_limit() {
        let conn = setup_db();

        for i in 0..5 {
            let path = format!("/a/file{}.md", i);
            let name = format!("file{}.md", i);
            let fid = insert_file(&conn, &path, &name, None, None);
            conn.execute(
                "INSERT INTO files_fts(rowid, title, body) VALUES (?1, '', 'common search term here')",
                [fid],
            ).unwrap();
        }

        let result = query_content(&conn, "common", 3).unwrap();
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn test_query_content_multi_word() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/notes.md", "notes.md", None, Some("Guide"));

        conn.execute(
            "INSERT INTO files_fts(rowid, title, body) VALUES (?1, 'Guide', 'Rust programming language guide for beginners')",
            [file1],
        ).unwrap();

        let result = query_content(&conn, "Rust programming", 10).unwrap();
        assert_eq!(result.len(), 1);
    }

    // ---- query_tasks tests ----

    #[test]
    fn test_query_tasks_all() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/todo.md", "todo.md", None, None);

        conn.execute("INSERT INTO tasks (file_id, text, done, position, context_before, context_after) VALUES (?1, 'Buy milk', 0, 0, '', '')", [file1]).unwrap();
        conn.execute("INSERT INTO tasks (file_id, text, done, position, context_before, context_after) VALUES (?1, 'Write tests', 1, 1, '', '')", [file1]).unwrap();

        let result = query_tasks(&conn, None, None, 100).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_query_tasks_filter_by_done() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/todo.md", "todo.md", None, None);

        conn.execute("INSERT INTO tasks (file_id, text, done, position) VALUES (?1, 'Buy milk', 0, 0)", [file1]).unwrap();
        conn.execute("INSERT INTO tasks (file_id, text, done, position) VALUES (?1, 'Write tests', 1, 1)", [file1]).unwrap();

        let pending = query_tasks(&conn, Some(false), None, 100).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].text, "Buy milk");
        assert!(!pending[0].done);

        let completed = query_tasks(&conn, Some(true), None, 100).unwrap();
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].text, "Write tests");
        assert!(completed[0].done);
    }

    #[test]
    fn test_query_tasks_filter_by_text() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/todo.md", "todo.md", None, None);

        conn.execute("INSERT INTO tasks (file_id, text, done, position) VALUES (?1, 'Buy milk', 0, 0)", [file1]).unwrap();
        conn.execute("INSERT INTO tasks (file_id, text, done, position) VALUES (?1, 'Write tests', 0, 1)", [file1]).unwrap();

        let result = query_tasks(&conn, None, Some("milk"), 100).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].text, "Buy milk");
    }

    #[test]
    fn test_query_tasks_respects_limit() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/todo.md", "todo.md", None, None);

        for i in 0..10 {
            conn.execute(
                "INSERT INTO tasks (file_id, text, done, position) VALUES (?1, ?2, 0, ?3)",
                params![file1, format!("Task {}", i), i as i64],
            ).unwrap();
        }

        let result = query_tasks(&conn, None, None, 5).unwrap();
        assert_eq!(result.len(), 5);
    }

    #[test]
    fn test_query_tasks_includes_project_name() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/projects/myproject/todo.md", "todo.md", Some("/projects/myproject"), None);

        conn.execute("INSERT INTO tasks (file_id, text, done, position) VALUES (?1, 'A task', 0, 0)", [file1]).unwrap();

        let result = query_tasks(&conn, None, None, 100).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].project_name, Some("myproject".to_string()));
    }

    // ---- query_goals tests ----

    #[test]
    fn test_query_goals_empty() {
        let conn = setup_db();
        let result = query_goals(&conn).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_query_goals_returns_data() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/goals.md", "goals.md", Some("/a"), None);

        conn.execute(
            "INSERT INTO goals (file_id, title, template, total_tasks, completed_tasks) VALUES (?1, 'Q1 Goals', 'okr', 5, 2)",
            [file1],
        ).unwrap();

        let result = query_goals(&conn).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "Q1 Goals");
        assert_eq!(result[0].template, "okr");
        assert_eq!(result[0].total_tasks, 5);
        assert_eq!(result[0].completed_tasks, 2);
        assert_eq!(result[0].project_name, Some("a".to_string()));
    }

    // ---- query_research tests ----

    #[test]
    fn test_query_research_empty() {
        let conn = setup_db();
        let result = query_research(&conn, None, None, 50).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_query_research_returns_data_with_tags() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/research/article.md", "article.md", None, Some("Climate Policy"));

        conn.execute(
            "INSERT INTO research (file_id, source_url, date_saved, word_count, snippet) VALUES (?1, 'https://example.com', '2026-01-15', 500, 'A study on climate')",
            [file1],
        ).unwrap();
        let research_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO research_tags (research_id, tag) VALUES (?1, 'climate')", [research_id]).unwrap();
        conn.execute("INSERT INTO research_tags (research_id, tag) VALUES (?1, 'policy')", [research_id]).unwrap();

        let result = query_research(&conn, None, None, 50).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "Climate Policy");
        assert_eq!(result[0].source_url, "https://example.com");
        assert_eq!(result[0].word_count, 500);
        assert_eq!(result[0].tags.len(), 2);
        assert!(result[0].tags.contains(&"climate".to_string()));
        assert!(result[0].tags.contains(&"policy".to_string()));
    }

    #[test]
    fn test_query_research_filter_by_query() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/r1.md", "r1.md", None, Some("Climate Study"));
        let file2 = insert_file(&conn, "/a/r2.md", "r2.md", None, Some("Math Paper"));

        conn.execute("INSERT INTO research (file_id, source_url, date_saved, word_count, snippet) VALUES (?1, 'https://a.com', '2026-01-15', 100, 'About climate change')", [file1]).unwrap();
        conn.execute("INSERT INTO research (file_id, source_url, date_saved, word_count, snippet) VALUES (?1, 'https://b.com', '2026-01-16', 200, 'About math')", [file2]).unwrap();

        let result = query_research(&conn, Some("climate"), None, 50).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "Climate Study");
    }

    #[test]
    fn test_query_research_filter_by_tag() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/r1.md", "r1.md", None, Some("Article A"));
        let file2 = insert_file(&conn, "/a/r2.md", "r2.md", None, Some("Article B"));

        conn.execute("INSERT INTO research (file_id, source_url, date_saved, word_count, snippet) VALUES (?1, '', '', 100, '')", [file1]).unwrap();
        let rid1 = conn.last_insert_rowid();
        conn.execute("INSERT INTO research_tags (research_id, tag) VALUES (?1, 'science')", [rid1]).unwrap();

        conn.execute("INSERT INTO research (file_id, source_url, date_saved, word_count, snippet) VALUES (?1, '', '', 200, '')", [file2]).unwrap();
        let rid2 = conn.last_insert_rowid();
        conn.execute("INSERT INTO research_tags (research_id, tag) VALUES (?1, 'history')", [rid2]).unwrap();

        let result = query_research(&conn, None, Some("science"), 50).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "Article A");
    }

    // ---- query_stats tests ----

    #[test]
    fn test_query_stats_empty_db() {
        let conn = setup_db();
        let stats = query_stats(&conn).unwrap();
        assert_eq!(stats.file_count, 0);
        assert_eq!(stats.tag_count, 0);
        assert_eq!(stats.mention_count, 0);
        assert_eq!(stats.task_count, 0);
        assert_eq!(stats.goal_count, 0);
        assert_eq!(stats.indexed_at, 0);
    }

    #[test]
    fn test_query_stats_with_data() {
        let conn = setup_db();
        let file1 = insert_file(&conn, "/a/notes.md", "notes.md", None, None);
        let file2 = insert_file(&conn, "/a/todo.md", "todo.md", None, None);

        conn.execute("INSERT INTO tags (file_id, tag) VALUES (?1, 'rust')", [file1]).unwrap();
        conn.execute("INSERT INTO tags (file_id, tag) VALUES (?1, 'python')", [file1]).unwrap();
        conn.execute("INSERT INTO tags (file_id, tag) VALUES (?1, 'rust')", [file2]).unwrap();

        conn.execute("INSERT INTO mentions (file_id, mention) VALUES (?1, 'alice')", [file1]).unwrap();

        conn.execute("INSERT INTO tasks (file_id, text, done, position) VALUES (?1, 'Do stuff', 0, 0)", [file1]).unwrap();
        conn.execute("INSERT INTO tasks (file_id, text, done, position) VALUES (?1, 'More stuff', 1, 1)", [file2]).unwrap();

        conn.execute("INSERT INTO goals (file_id, title, template, total_tasks, completed_tasks) VALUES (?1, 'Goal', 'simple', 3, 1)", [file1]).unwrap();

        let stats = query_stats(&conn).unwrap();
        assert_eq!(stats.file_count, 2);
        assert_eq!(stats.tag_count, 2); // "rust" and "python" (distinct)
        assert_eq!(stats.mention_count, 1);
        assert_eq!(stats.task_count, 2);
        assert_eq!(stats.goal_count, 1);
        assert_eq!(stats.indexed_at, 1000); // From our insert_file helper
    }

    // ---- build_fts_query tests ----

    #[test]
    fn test_build_fts_query_single_word() {
        assert_eq!(build_fts_query("rust"), "\"rust\"*");
    }

    #[test]
    fn test_build_fts_query_multi_word() {
        assert_eq!(build_fts_query("rust programming"), "\"rust\" \"programming\"*");
    }

    #[test]
    fn test_build_fts_query_empty() {
        assert_eq!(build_fts_query(""), "");
    }

    #[test]
    fn test_build_fts_query_whitespace_only() {
        assert_eq!(build_fts_query("   "), "");
    }

    // ---- task toggle (via tasks module) ----

    #[test]
    fn test_task_toggle_integration() {
        use crate::index::tasks::toggle_task_in_content;

        let content = "# Tasks\n\n- [ ] Buy groceries\n- [x] Done task\n";
        let toggled = toggle_task_in_content(content, "Buy groceries", "", "", true).unwrap();
        assert!(toggled.contains("- [x] Buy groceries"));

        // Toggle back
        let toggled2 = toggle_task_in_content(&toggled, "Buy groceries", "", "", false).unwrap();
        assert!(toggled2.contains("- [ ] Buy groceries"));
    }

    // ---- query_filenames tests (PRD 2026-04-28-cmd-bar-verb-prefixes #1) ----

    #[test]
    fn test_query_filenames_empty_query_returns_empty() {
        let conn = setup_db();
        insert_file(&conn, "/p/notes.md", "notes.md", None, None);
        // Empty + whitespace-only inputs both return empty; the verb-mode
        // frontend renders an MRU list in that case, not the entire index.
        assert!(query_filenames(&conn, "", 50).unwrap().is_empty());
        assert!(query_filenames(&conn, "   ", 50).unwrap().is_empty());
    }

    #[test]
    fn test_query_filenames_substring_match_case_insensitive() {
        let conn = setup_db();
        insert_file(&conn, "/p/README.md", "README.md", Some("/p"), None);
        insert_file(&conn, "/p/notes.md", "notes.md", Some("/p"), None);
        let result = query_filenames(&conn, "read", 50).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].file_name, "README.md");
        assert_eq!(result[0].path, "/p/README.md");
        assert_eq!(result[0].parent_dir, "/p");
        assert_eq!(result[0].project_root, Some("/p".to_string()));
    }

    #[test]
    fn test_query_filenames_returns_files_alphabetically() {
        let conn = setup_db();
        insert_file(&conn, "/p/zebra.md", "zebra.md", Some("/p"), None);
        insert_file(&conn, "/p/alpha.md", "alpha.md", Some("/p"), None);
        insert_file(&conn, "/p/middle.md", "middle.md", Some("/p"), None);
        let result = query_filenames(&conn, ".md", 50).unwrap();
        let names: Vec<&str> = result.iter().map(|r| r.file_name.as_str()).collect();
        assert_eq!(names, vec!["alpha.md", "middle.md", "zebra.md"]);
    }

    #[test]
    fn test_query_filenames_respects_limit() {
        let conn = setup_db();
        for i in 0..10 {
            let path = format!("/p/file{}.md", i);
            let name = format!("file{}.md", i);
            insert_file(&conn, &path, &name, Some("/p"), None);
        }
        let result = query_filenames(&conn, "file", 3).unwrap();
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn test_query_filenames_returns_dotfiles_when_matched() {
        // Rust returns hits regardless of leading dot — the
        // hidden-files toggle gating happens in the frontend
        // (per task #9 in the verb-prefixes breakdown) so the user
        // can flip the toggle without re-querying.
        let conn = setup_db();
        insert_file(&conn, "/p/.hidden.md", ".hidden.md", Some("/p"), None);
        let result = query_filenames(&conn, "hidden", 50).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].file_name, ".hidden.md");
    }

    #[test]
    fn test_query_filenames_project_root_null_for_library_files() {
        // Files indexed via the global DB carry no project_path
        // (the field is nullable on the SQL side); the result's
        // project_root should be None so the frontend can render
        // a "library" badge instead of a project badge.
        let conn = setup_db();
        insert_file(&conn, "/Users/me/Notesage/quick-notes.md", "quick-notes.md", None, None);
        let result = query_filenames(&conn, "quick", 50).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].project_root, None);
        assert_eq!(result[0].parent_dir, "/Users/me/Notesage");
    }

    #[test]
    fn test_query_filenames_escapes_like_wildcards() {
        // `%` and `_` are LIKE wildcards. A literal underscore in
        // the user's query must match an underscore character in
        // the filename, not "any single character".
        let conn = setup_db();
        insert_file(&conn, "/p/my_file.md", "my_file.md", Some("/p"), None);
        insert_file(&conn, "/p/myXfile.md", "myXfile.md", Some("/p"), None);
        let result = query_filenames(&conn, "my_file", 50).unwrap();
        assert_eq!(result.len(), 1, "underscore should match literal _, not any char");
        assert_eq!(result[0].file_name, "my_file.md");

        // `%` similarly should be a literal substring search.
        insert_file(&conn, "/p/100%report.md", "100%report.md", Some("/p"), None);
        let result2 = query_filenames(&conn, "100%report", 50).unwrap();
        assert_eq!(result2.len(), 1);
        assert_eq!(result2[0].file_name, "100%report.md");
    }
}
