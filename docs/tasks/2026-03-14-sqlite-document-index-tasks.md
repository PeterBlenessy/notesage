# SQLite Document Index — Implementation Tasks

**PRD:** `docs/prds/2026-03-14-sqlite-document-index.md`**Date:** 2026-03-14 **Status:** ✅Complete (18/18 tasks done)

## Summary

**18 tasks: 5S, 8M, 5L — all complete**

The work is structured in four layers:

1. **Foundation (Tasks 1–4):** Add rusqlite, create the index module with schema, DB lifecycle, and iCloud exclusion ✅
2. **Parser (Tasks 5–7):** comrak-based AST parser for tags, mentions, headings, tasks, goals, body text + FTS ✅
3. **Watcher & startup (Tasks 8–9):** Incremental reindex via watcher, startup hash-based change detection ✅
4. **Query commands (Tasks 10–14):** Tauri commands replacing all old scanners ✅
5. **Frontend integration (Tasks 15–18):** Wire command palette, actions dashboard, remove old stores, fix drilldown ✅

---

## Tasks

### ✅ 1. Add rusqlite and sha2 to Cargo.toml

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/Cargo.toml` |

**Description:**

- Add `rusqlite = { version = "0.34", features = ["bundled"] }` to dependencies
- Add `sha2 = "0.10"` for content hashing
- Verify `comrak` features include `default-features = true` or explicitly add `"shortcodes"` for frontmatter support (currently `default-features = false`)
- Run `cargo check` to confirm compilation

**Acceptance criteria:**

- `cargo build` succeeds with new dependencies
- No version conflicts with existing crates

---

### ✅ 2. Create index module with schema and DB lifecycle

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | #1 |
| **Files** | `src-tauri/src/index/mod.rs`, `src-tauri/src/index/db.rs`, `src-tauri/src/commands/mod.rs` |

**Description:**

- Create `src-tauri/src/index/` module directory
- `db.rs`: Schema creation (all tables from PRD), `open_or_create()`, `schema_version` check, migration support
- `mod.rs`: `IndexState` struct with `global_db`, `project_dbs`, `reindex_queue` fields
- `init_global()`: Create/open `~/.notesage/index.db`
- `init_project(path)`: Create/open `<project>/.notesage/index.db`
- `close_project(path)`: Close a project DB connection
- Enable WAL mode and foreign keys on each connection
- Register `IndexState` as Tauri managed state in `lib.rs`

**Acceptance criteria:**

- `index.db` created at `~/.notesage/index.db` on app startup
- Schema contains all tables (files, tags, mentions, headings, research, research_tags, tasks, goals, files_fts, schema_version)
- DB survives app restart (persisted)
- Deleting `index.db` triggers recreation on next startup

---

### ✅ 3. iCloud exclusion utility

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | #2 |
| **Files** | `src-tauri/src/index/icloud.rs` |

**Description:**

- Implement `exclude_from_icloud(path)` using `xattr` command on macOS
- Set `com.apple.metadata:com_apple_backup_excludeItem` extended attribute on `index.db`, `index.db-wal`, `index.db-shm`
- Call from `open_or_create()` after DB creation
- No-op on non-macOS platforms (`#[cfg(target_os = "macos")]`)

**Acceptance criteria:**

- `xattr -l ~/.notesage/index.db` shows the backup exclusion attribute
- Works on both global and per-project DBs

---

### ✅ 4. Add `index_init` and `index_rebuild` Tauri commands

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #2 |
| **Files** | `src-tauri/src/index/mod.rs`, `src-tauri/src/lib.rs` |

**Description:**

- `index_init(project_path: Option<String>)`: Initialize DB for project or global scope. Return `IndexStats` (file count, indexed_at)
- `index_rebuild(project_path: Option<String>)`: Drop all data, rescan all `.md` files, rebuild index. Return stats.
- Add both to `generate_handler![]` in `lib.rs`
- `IndexStats` struct: `{ file_count, tag_count, mention_count, task_count, goal_count, indexed_at }`
- Call `index_init(None)` during app setup in `lib.rs` (global DB)

**Acceptance criteria:**

- Global index initializes on app startup
- `index_rebuild` clears and repopulates all tables
- Stats returned accurately reflect DB state

---

### ✅ 5. comrak AST parser — tags, mentions, headings

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | #1 |
| **Files** | `src-tauri/src/index/parser.rs` |

**Description:**

- `index_file(content: &str) -> ParsedFile` — parse markdown with comrak, walk AST
- Enable comrak options: GFM tables, strikethrough, tasklist, autolink, frontmatter
- Extract tags from `NodeValue::Text` nodes using existing regex `#([a-zA-Z][a-zA-Z0-9_-]*)`, but ONLY when `!is_inside_code(node)` and not inside a heading
- `is_inside_code(node)` — walk ancestors, return true if any parent is `CodeBlock` or `Code`
- `is_inside_heading(node)` — walk ancestors, return true if parent is `Heading`
- Extract mentions with same `@([a-zA-Z][a-zA-Z0-9_-]*)` pattern, same filtering
- Filter out email-like mentions: skip if preceded by alphanumeric/dot/underscore (check previous text in same node)
- Extract headings from `NodeValue::Heading` nodes with `collect_text_content()`
- Extract `context_before` and `context_after` (\~50 chars) for each tag/mention from surrounding text
- Accumulate `body_text` from all non-code text nodes for FTS
- Parse frontmatter via `NodeValue::FrontMatter` → `serde_yaml::from_str()`
- Extract `title` from frontmatter `title:` field, falling back to first H1 heading, falling back to filename

**Acceptance criteria:**

- Tags inside code blocks, inline code, headings, and frontmatter are NOT extracted
- Tags in URLs are NOT extracted (comrak autolinks wrap URLs in `Link` nodes)
- `#climate` in body text → extracted with context
- `@mention` in body text → extracted; `user@example.com` → NOT extracted
- Headings extracted with correct level and text
- Frontmatter parsed via serde_yaml (proper YAML, not string matching)

---

### ✅ 6. comrak AST parser — tasks, goals, research

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #5 |
| **Files** | `src-tauri/src/index/parser.rs` |

**Description:**

- Extend `index_file()` to extract tasks from `NodeValue::TaskItem` nodes
- Each task: `text` (collected text content), `done` (checked boolean), `position` (sequential order), `context_before`, `context_after`
- Tasks inside code blocks already excluded by comrak's AST (code blocks don't contain TaskItem nodes)
- Detect goal files: check if frontmatter has `type: goal` (from parsed YAML, not string matching)
- For goal files: count total tasks and completed tasks from extracted task list
- Detect research files: check if frontmatter has `source_url` or file is in a `research/` directory
- Extract research metadata: `source_url`, `date_saved`, `word_count` (count words in body), `tags` (from frontmatter), `snippet` (first \~200 chars of body)

**Acceptance criteria:**

- `- [ ] Buy groceries` → task with `done=false`, text="Buy groceries"
- `- [x] Done task` → task with `done=true`
- Task items in code blocks are NOT extracted
- Goal files correctly identified from frontmatter YAML
- Research metadata extracted from frontmatter

---

### ✅ 7. File indexing pipeline (hash, parse, upsert)

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | #2, #5, #6 |
| **Files** | `src-tauri/src/index/mod.rs`, `src-tauri/src/index/db.rs` |

**Description:**

- `reindex_file(db: &Connection, path: &str)`: Read file, compute SHA-256 hash, check if hash changed, if so: delete old data for this file, parse with `index_file()`, insert into all tables
- Hash comparison: `SELECT content_hash FROM files WHERE path = ?` → skip if hash matches
- Single transaction for delete+insert (atomic)
- `reindex_directory(db: &Connection, dir: &str)`: Walk directory recursively, call `reindex_file` for each `.md` file
- For FTS: after inserting into `files`, insert body text into `files_fts` via `INSERT INTO files_fts(rowid, title, body) VALUES (?, ?, ?)`
- `remove_file(db: &Connection, path: &str)`: Delete file and cascade to all related tables
- `reindex_all(db: &Connection, dir: &str)`: Full rebuild — clear all tables, reindex directory
- Also index non-`.md` text files for FTS only (no AST parsing, just read content and insert into files + files_fts). Use the existing `TEXT_EXTENSIONS` list from `file.rs`.

**Acceptance criteria:**

- Unchanged files (same hash) are skipped (&lt; 1ms per file)
- Changed files are fully re-indexed (delete old + insert new)
- Full index of 500 .md files completes in &lt; 2 seconds
- FTS body text populated for all indexed files
- Deleted files removed from all tables via CASCADE

---

### ✅ 8. Watcher integration for incremental reindex

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #4, #7 |
| **Files** | `src-tauri/src/commands/watcher.rs`, `src-tauri/src/index/mod.rs` |

**Description:**

- In `watcher.rs`, after emitting `file-changed` Tauri event, check if path ends with `.md` (or other text extensions for FTS)
- If so, call `indexer.queue_reindex(path, kind)` on `IndexState` via `app.try_state::<IndexState>()`
- `IndexState::queue_reindex()`: Push to `reindex_queue`, spawn debounced processor (500ms)
- Debounced processor: drain queue, batch process all pending paths
- For `delete` kind: call `remove_file()`
- For `create`/`modify` kind: call `reindex_file()`
- Determine which DB to use based on file path (match against project paths, fall back to global)

**Acceptance criteria:**

- Saving a file triggers reindex within 1 second
- Deleting a file removes it from the index
- Bulk operations (git checkout) are batched, not processed one-by-one
- No frontend round-trip needed (Rust-side only)

---

### ✅ 9. Startup hash-based change detection

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #7 |
| **Files** | `src-tauri/src/index/mod.rs` |

**Description:**

- On `index_init()`: scan all `.md` files in scope, compute hashes, compare against `files.content_hash`
- Reindex files where hash differs
- Remove index entries for files that no longer exist on disk
- Add new files that aren't in the index yet
- Emit `index-ready` Tauri event when startup indexing completes
- For first-ever run (empty DB): full index build with progress events `index-progress { current, total }`

**Acceptance criteria:**

- Cold start (empty DB): full index completes in &lt; 2 seconds for 500 files
- Warm start (no changes): &lt; 100ms (hash comparison only)
- Files deleted externally are pruned from index
- New files added externally are indexed

---

### ✅ 10. Tag and mention query commands

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #7 |
| **Files** | `src-tauri/src/index/queries.rs`, `src-tauri/src/index/mod.rs`, `src-tauri/src/lib.rs` |

**Description:**

- `index_tags(project_paths, query)`: `SELECT tag, COUNT(DISTINCT file_id) FROM tags ... GROUP BY tag` with optional `LIKE` filter. Queries across multiple DBs (global + project DBs matching paths).
- `index_tag_occurrences(tag, project_paths)`: `SELECT f.path, f.name, t.context_before, t.context_after FROM tags t JOIN files f ...`
- `index_mentions(project_paths, query)`: Same pattern as tags
- `index_mention_occurrences(mention, project_paths)`: Same pattern as tags
- Add all four to `generate_handler![]`
- Multi-DB query pattern: iterate project_dbs matching given paths + global_db, merge results

**Acceptance criteria:**

- `index_tags` returns unique tags with file counts
- `index_tag_occurrences` returns all occurrences with context snippets
- Queries across global + multiple project DBs return merged results
- Sub-millisecond for typical workspace

---

### ✅ 11. Research, task, and goal query commands

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #7 |
| **Files** | `src-tauri/src/index/queries.rs`, `src-tauri/src/index/mod.rs`, `src-tauri/src/lib.rs` |

**Description:**

- `index_search_research(project_paths, query, tag, limit)`: Join research + research_tags + files. Filter by query (LIKE on title, source_url, snippet) and/or tag. Include project name from files.project_path.
- `index_tasks(project_paths, done, query, limit)`: Select from tasks + files. Optional filters on done status and text substring. Include project name.
- `index_goals(project_paths)`: Select from goals + files. Include task counts.
- Add all three to `generate_handler![]`

**Acceptance criteria:**

- Research search returns files from all projects, including files without source_url
- Task query supports filtering by completion status
- Goal query returns progress (total/completed tasks)

---

### ✅ 12. Task toggle command (context-based)

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | #7 |
| **Files** | `src-tauri/src/index/tasks.rs`, `src-tauri/src/index/mod.rs`, `src-tauri/src/lib.rs` |

**Description:**

- `index_toggle_task(path, context_before, context_after, task_text, done)`:
  1. Read file content from disk
  2. Find the task line by matching `context_before` + `#task_text` pattern (not line number)
  3. Toggle `[ ]` ↔ `[x]` on the matched line
  4. Write file back to disk (call `mark_self_write` first to suppress watcher)
  5. Reindex the file
- Context matching: search for a line containing `task_text` that is preceded by text matching `context_before` and followed by text matching `context_after`
- If multiple matches, use the first one (context should disambiguate in practice)

**Acceptance criteria:**

- Toggle works even when lines above the task have been added/removed
- File is correctly rewritten with toggled checkbox
- Self-write suppression prevents watcher loop
- Index updated after toggle

---

### ✅ 13. FTS5 content search command

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | #7 |
| **Files** | `src-tauri/src/index/queries.rs`, `src-tauri/src/index/mod.rs`, `src-tauri/src/lib.rs` |

**Description:**

- `index_search_content(project_paths, query, limit)`: Use FTS5 `MATCH` with `snippet()` function for context
- `SELECT f.path, f.name, f.title, snippet(files_fts, 1, '<b>', '</b>', '...', 20) as snippet, rank FROM files_fts JOIN files f ON files_fts.rowid = f.id WHERE files_fts MATCH ? ORDER BY rank LIMIT ?`
- Support prefix queries (append `*` to last token)
- Add to `generate_handler![]`

**Acceptance criteria:**

- Content search returns ranked results with snippets
- Sub-50ms for typical queries
- Prefix matching works (e.g., "clim" matches "climate")

---

### ✅ 14. Remove old Rust scanner commands

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | #10, #11, #12, #13 |
| **Files** | `src-tauri/src/commands/file.rs`, `src-tauri/src/commands/actions.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` |

**Description:**

- Remove from `file.rs`: `scan_tags_in_directories`, `find_tag_occurrences`, `scan_dir_for_tags`, `scan_dir_for_tag_occurrences`, `scan_mentions_in_directories`, `find_mention_occurrences`, `scan_dir_for_mentions`, `scan_dir_for_mention_occurrences`, `search_file_content`, `scan_dir_for_content`, `search_research`, `scan_dir_for_research`, `parse_research_file`, `strip_yaml_quotes`, `parse_yaml_array`, `generate_snippet_around_match`, and associated structs (`TagOccurrence`, `MentionOccurrence`, `ContentMatch`, `ResearchSearchResult`)
- Remove from `actions.rs`: `parse_task_items`, `parse_goal_items`, `scan_markdown_files`. Keep `scan_comments` (comments are JSON, not markdown-indexed). Refactor `scan_actions` to call index commands for tasks/goals and keep comment scanning.
- Remove all nine commands from `generate_handler![]` in `lib.rs`
- Remove from `commands/mod.rs` re-exports

**Acceptance criteria:**

- `cargo build` succeeds with removed code
- No dead code warnings for removed functions
- `scan_actions` still works for comments

---

### ✅ 15. Add tauriApi wrappers and wire CommandPalette

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #10, #11, #13 |
| **Files** | `src/lib/tauri.ts`, `src/components/CommandPalette.tsx`, `src/lib/command-palette.ts` |

**Description:**

- Add `tauriApi` wrappers for all `index_*` commands in `tauri.ts`
- `CommandPalette.tsx`:
  - Tags mode: call `tauriApi.indexTags(paths, query)` instead of reading `useTagStore`
  - Mentions mode: call `tauriApi.indexMentions(paths, query)` instead of reading `useMentionStore`
  - Research mode: call `tauriApi.indexSearchResearch(paths, query)` instead of building dirs and calling `tauriApi.searchResearch`
  - Content search (files mode): call `tauriApi.indexSearchContent(paths, query)` instead of `tauriApi.searchFileContent`
- Remove imports of `useTagStore` and `useMentionStore` from CommandPalette
- Update `SymbolSearchConfig` to call `tauriApi.indexTagOccurrences` / `tauriApi.indexMentionOccurrences`
- Occurrence results now have `context_before`/`context_after` instead of `line_number`/`occurrence_in_file`

**Acceptance criteria:**

- Tag, mention, research, and content search all use index commands
- No Zustand store reads for tags/mentions in CommandPalette
- Results appear instantly (&lt; 50ms)

---

### ✅ 16. Fix SymbolSearchResults drilldown and context-based navigation

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #15 |
| **Files** | `src/components/SymbolSearchResults.tsx`, `src/lib/command-palette.ts` |

**Description:**

- Remove the `query !== drilldown` useEffect that clears drilldown (the race condition bug)
- Track drilldown state independently: when user selects an item, enter drilldown mode regardless of query text
- Exit drilldown when: user presses Escape, backspaces past the prefix character, or palette closes
- Update `SymbolOccurrence` type: replace `line_number` and `occurrence_in_file` with `context_before` and `context_after`
- Update `onSelect` handler: instead of passing `occurrence_in_file`, pass context strings for in-document search
- In the parent handler (`handleSymbolSelect` in CommandPalette): open file, then trigger `SearchHighlight` to find the tag/mention using the symbol text + context for disambiguation

**Acceptance criteria:**

- Selecting a tag in the list shows all occurrences (drilldown works)
- Selecting an occurrence opens the file and scrolls to the correct position
- Drilldown exits cleanly on Escape or backspace

---

### ✅ 17. Wire actions dashboard to index commands

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #11, #12 |
| **Files** | `src/stores/action-store.ts`, `src/hooks/useGoalsDiscovery.ts`, `src/lib/tauri.ts` |

**Description:**

- `action-store.ts`:
  - Replace `toggleTaskDone()` with call to `tauriApi.indexToggleTask()` (context-based)
  - Replace task/goal loading logic that calls `scan_actions` → refactor to call `index_tasks` and `index_goals` for task/goal items, keep `scan_actions` for comments only
  - Adapt `ActionItem` type or map from `IndexedTask`/`IndexedGoal` to existing `ActionItem` shape
- `useGoalsDiscovery.ts`:
  - Replace file-by-file scanning with call to `tauriApi.indexGoals(projectPaths)`

**Acceptance criteria:**

- Actions dashboard shows tasks from index (no code block false positives)
- Task toggle works via context matching
- Goals discovered via index query

---

### ✅ 18. Remove old stores and cleanup

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | both |
| **Dependencies** | #14, #15, #16, #17 |
| **Files** | `src/stores/tag-store.ts`, `src/stores/mention-store.ts`, `src/hooks/useFileOperations.ts`, `src/App.tsx`, `src/components/editor/extensions/tag-suggestion.tsx` |

**Description:**

- Delete `src/stores/tag-store.ts`
- Delete `src/stores/mention-store.ts`
- Remove `refreshTags()` and `refreshMentions()` functions from `useFileOperations.ts`
- Remove `refreshTags()` and `refreshMentions()` calls from `App.tsx` startup
- Add `index_init()` call to `App.tsx` startup (for project-scoped DBs — global DB already initialized in Rust setup)
- Update `TagSuggestion` extension: autocomplete popup currently reads from `useTagStore` — replace with async call to `tauriApi.indexTags(paths, query)` for suggestions
- Clear orphaned localStorage keys for removed stores (`tag-store`, `mention-store`) on first launch after upgrade
- Remove old types from `tauri.ts`: `TagOccurrence` (old shape with line_number), `MentionOccurrence`, `ResearchSearchResult` (old shape)

**Acceptance criteria:**

- No references to `tag-store` or `mention-store` in codebase
- No orphaned localStorage keys
- Tag autocomplete in editor still works (reads from index)
- `cargo build` and `pnpm build` both succeed
- App starts and all search features work end-to-end