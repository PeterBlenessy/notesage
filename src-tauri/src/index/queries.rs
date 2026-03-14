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
            file_count: row.get(1).map_err(|e| e.to_string())?,
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
            file_count: row.get(1).map_err(|e| e.to_string())?,
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
                row.get::<_, usize>(5)?,
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
                position: row.get(4)?,
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
                total_tasks: row.get(4)?,
                completed_tasks: row.get(5)?,
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
        .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let tag_count: usize = conn
        .query_row("SELECT COUNT(DISTINCT tag) FROM tags", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let mention_count: usize = conn
        .query_row("SELECT COUNT(DISTINCT mention) FROM mentions", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let task_count: usize = conn
        .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let goal_count: usize = conn
        .query_row("SELECT COUNT(*) FROM goals", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let indexed_at: u64 = conn
        .query_row(
            "SELECT COALESCE(MAX(indexed_at), 0) FROM files",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(IndexStats {
        file_count,
        tag_count,
        mention_count,
        task_count,
        goal_count,
        indexed_at,
    })
}
