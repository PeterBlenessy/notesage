# SQLite Document Index & Unified Storage Architecture

**Date:** 2026-03-14 **Status:** Draft **Supersedes:** Partially supersedes `2026-03-07-always-on-memory-agent.md` (storage layer only — memory agent features remain valid)

## Problem

The command palette's tag (#), mention (@), and research (?) search modes are fundamentally broken:

1. **False positive tags/mentions** — The Rust backend scans raw markdown text with regex, matching `#tag` patterns inside code blocks, YAML frontmatter, headings, URLs, and code comments. The editor's `TagHighlight` extension correctly filters these using ProseMirror's document model, but the backend scanner has no structural awareness. Result: users see dozens of erroneous matches.

2. **Drilldown race condition** — Selecting a tag/mention in the command palette immediately clears the drilldown due to a `query !== drilldown` effect, making it impossible to view occurrences.

3. **Research search finds nothing** — Only searches `.notesage/research/` subdirectories, requires strict YAML frontmatter format (inline arrays only), and silently skips files without both `title` and `source_url`.

4. **Wrong jump-to-position** — Backend returns raw file line numbers, but ProseMirror positions don't map to raw markdown lines. A workaround uses in-document search, but the architecture is fundamentally misaligned.

5. **No persistent index** — Every search re-scans the entire filesystem, re-reads every file, and re-applies regex. This is slow, produces stale results, and doesn't scale.

6. **Task/action scanning matches inside code blocks** — The actions dashboard (`actions.rs`) extracts `[ ] task text` patterns via regex on raw markdown, picking up example checklists in code fences. Goal discovery uses naive `type: goal` string matching instead of proper YAML parsing. The `action-store.ts` task toggle is especially fragile: when the line number is stale, it searches ±3 nearby lines using a 40-char text prefix as a fuzzy key.

7. **Content search re-scans on every keystroke** — `search_file_content` reads every text file in the workspace and applies substring matching line-by-line. No caching, no index, no FTS.

These are symptoms of a single architectural gap: **there is no persistent, structure-aware document index**. Every mature note-taking app (Obsidian, Bear, Apple Notes, Logseq) solves this with a database.

**Why now:** The memory agent PRD (`2026-03-07`) already introduces `rusqlite` and per-project SQLite databases. The document index should share this infrastructure rather than being bolted on separately. Building the storage layer correctly now prevents rework later.

## Goals

1. **Correct tag/mention extraction** — Parse markdown with comrak AST (already a dependency), extract tags and mentions only from text nodes, excluding code blocks, frontmatter, headings, and URLs

2. **Correct task extraction** — Extract task items from the AST, excluding tasks inside code blocks and example snippets

3. **Instant search** — Sub-millisecond tag, mention, research, task, and content queries via SQL/FTS5 instead of filesystem re-scanning

4. **Incremental indexing** — Re-index only changed files via filesystem watcher integration, not full workspace scans

5. **Position-independent navigation** — Store context snippets instead of line numbers, use in-document search for jumping to position (works regardless of markdown-to-ProseMirror position mapping)

6. **Reliable task toggle** — Toggle task completion via context-based matching instead of fragile line-number ±3 fuzzy search

7. **Unified storage architecture** — Establish the SQLite infrastructure that the memory agent will also use, with clear separation between derived data (index) and primary data (memory)

8. **Cross-device readiness** — Architecture that works with iCloud project sync without database corruption

## Non-Goals

- **Memory agent implementation** — Covered by existing PRD `2026-03-07-always-on-memory-agent.md`. This PRD establishes the shared storage layer; memory tables and AI pipelines are separate work.
- **Vector embeddings or semantic search** — Plain text indexing only. Semantic search is a future enhancement.
- **Cross-device memory sync** — Index DBs are derived caches (rebuild from files). Memory DB sync strategy is deferred.
- **Backlinks or graph view** — The schema supports these (headings + cross-references), but UI is out of scope.
- **Non-markdown file indexing** — Only `.md` files are parsed and indexed via comrak. Other text file types are indexed for FTS content search but without AST-level structure extraction.
- **Task dependencies or scheduling** — Tasks are indexed as flat items with completion status. No dependency graphs, due dates, or priority ordering.
- **Goal progress tracking UI changes** — Goals table stores task counts, but the actions dashboard UI is not redesigned in this phase.

## User Stories

 1. **As a user**, I want tag search (`#` in command palette) to show only real tags from document body text, so that code block comments, YAML keys, and heading markers don't pollute my results.

 2. **As a user**, I want to select a tag and see all its occurrences across files, so that I can navigate to any usage with one click.

 3. **As a user**, I want mention search (`@`) to show only intentional @mentions, not email addresses or code annotations like `@Override`.

 4. **As a user**, I want research search (`?`) to find all my research files across projects, even if they don't have perfect YAML frontmatter.

 5. **As a user**, I want search results to appear instantly when I open the command palette, not after a multi-second filesystem scan.

 6. **As a user**, I want clicking a search result to take me to the exact position in the document, not a wrong line.

 7. **As a user**, I want new tags and mentions to appear in search within seconds of saving a file, without restarting the app.

 8. **As a user syncing projects via iCloud**, I want search to work correctly on each device without database corruption.

 9. **As a user**, I want the actions dashboard to show only real task items, not example checklists inside code blocks.

10. **As a user**, I want toggling a task checkbox in the actions dashboard to reliably toggle the correct item, even if I've edited the file since the last scan.

11. **As a user**, I want content search (Cmd+Shift+F) to return results instantly from an index, not after scanning hundreds of files on every keystroke.

## Technical Approach

### Architecture Overview

```
File changes (watcher/save) ──> Parse with comrak ──> Walk AST ──> Upsert index.db
                                                                         |
Cmd+K tag search ────> SELECT tag, context FROM tags WHERE tag LIKE ? ───┘
Cmd+K research   ────> SELECT * FROM research WHERE title MATCH ? ───────┘
Cmd+K mentions   ────> SELECT mention, context FROM mentions ... ────────┘
```

Two separate SQLite database files per scope:

| File | Type | Purpose | iCloud sync? |
| --- | --- | --- | --- |
| `index.db` | **Derived cache** | Tags, mentions, headings, research metadata, FTS | Never synced. Rebuild from `.md` files on each device. |
| `memory.db` | **Primary data** | AI memories, consolidations (from memory agent PRD) | Future consideration. Not synced initially. |

Database locations:

| Scope | Index DB | Memory DB |
| --- | --- | --- |
| Global | `~/.notesage/index.db` | `~/.notesage/memory.db` |
| Per-project | `<project>/.notesage/index.db` | `<project>/.notesage/memory.db` |

### Why Separate Files

- `index.db` is a **disposable cache** — delete it and it rebuilds from files in seconds. Safe to exclude from backups and cloud sync.
- `memory.db` is **primary data** — contains AI-generated memories with no other source of truth. Must be backed up. May need sync strategy later.
- Different lifecycle: index DB can be dropped and rebuilt on schema changes. Memory DB needs migrations.
- iCloud safety: index DB is never in the sync folder (or is `.gitignore`d / excluded). No risk of corruption from concurrent writes.

### iCloud Sync Strategy

Projects configured for iCloud sync move their files to `~/Library/Mobile Documents/com~apple~CloudDocs/Notesage/`. The `.notesage/` directory travels with the project.

**Index DB (**`index.db`**):**

- Excluded from iCloud sync via `com.apple.metadata:com_apple_backup_excludeItem` extended attribute (set on DB creation)
- Alternatively: add `index.db`, `index.db-wal`, `index.db-shm` to a `.nosync` suffix convention
- Each device rebuilds its own index from the synced `.md` files
- When a synced file arrives (watcher detects create/modify), the local indexer re-parses and updates

**Memory DB (**`memory.db`**):**

- Initially: also excluded from iCloud sync (out of scope for this PRD)
- Future: explore exporting memories as `.md` files in `.notesage/memories/` that sync naturally, then importing on each device

**Implementation:**

```rust
// On DB creation, mark as excluded from iCloud backup
#[cfg(target_os = "macos")]
fn exclude_from_icloud(path: &Path) -> Result<(), String> {
    use std::process::Command;
    // Set the com.apple.metadata:com_apple_backup_excludeItem xattr
    Command::new("xattr")
        .args(["-w", "com.apple.metadata:com_apple_backup_excludeItem",
               "com.apple.asbd:com.apple.backup",
               &path.to_string_lossy()])
        .status()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

### Markdown Parsing with comrak

The Rust backend already depends on `comrak` (used in `markdown_to_typst.rs` for PDF export). The indexer reuses it to parse markdown into an AST and extract structured data:

```rust
use comrak::{parse_document, Arena, Options};
use comrak::nodes::NodeValue;

fn index_file(path: &Path, content: &str) -> IndexedFile {
    let arena = Arena::new();
    let options = comrak_options(); // GFM, frontmatter enabled, tasklist extension
    let root = parse_document(&arena, content, &options);

    let mut tags = Vec::new();
    let mut mentions = Vec::new();
    let mut headings = Vec::new();
    let mut tasks = Vec::new();
    let mut frontmatter = None;
    let mut body_text = String::new(); // accumulated for FTS indexing

    // Walk AST — only extract from text nodes in paragraphs/lists/etc.
    for node in root.descendants() {
        match &node.data.borrow().value {
            NodeValue::FrontMatter(fm) => {
                frontmatter = Some(parse_frontmatter(fm));
            }
            NodeValue::Text(text) => {
                // Extract from text nodes not inside code blocks/spans.
                // Headings are included — comrak strips the `#` markers,
                // so any `#tag` in heading text is genuine.
                if !is_inside_code(node) {
                    extract_tags(text, node, &mut tags);
                    extract_mentions(text, node, &mut mentions);
                    body_text.push_str(text);
                    body_text.push(' ');
                }
            }
            NodeValue::Heading(h) => {
                let text = collect_text_content(node);
                headings.push(Heading { level: h.level, text });
            }
            NodeValue::TaskItem(checked) => {
                // comrak parses `- [ ] text` and `- [x] text` as TaskItem nodes
                let text = collect_text_content(node);
                let context = collect_surrounding_context(node);
                tasks.push(Task {
                    text,
                    done: *checked,
                    context_before: context.0,
                    context_after: context.1,
                });
            }
            NodeValue::CodeBlock(_) | NodeValue::Code(_) => {
                // Skip entirely — descendants won't match Text
            }
            _ => {}
        }
    }

    IndexedFile { tags, mentions, headings, tasks, frontmatter, body_text }
}
```

This eliminates all false positives from code blocks, inline code, and frontmatter — because comrak has already parsed the structure.

**Implementation note:** Tags and mentions inside headings ARE extracted. comrak parses heading markers (`##`) out of the AST text content, so `#tag` in heading text is genuinely a tag, not a heading marker.

### Position-Independent Navigation via Nth-Occurrence Matching

Current approach stores raw line numbers → wrong position in editor. New approach:

```sql
-- Each tag stores surrounding context for potential future disambiguation
INSERT INTO tags (file_id, tag, context_before, context_after)
VALUES (1, 'climate', 'discussing the impact of ', ' change on coastal cities');
```

When the user clicks a tag occurrence:

1. Frontend opens the file with `scrollToText` set atomically on the tab (prevents saved scroll position from racing)
2. `findTextPositionInDoc` searches ProseMirror's `doc.textContent` for the symbol (e.g. `#climate`)
3. For multiple occurrences in the same file, the Nth-occurrence index (computed from the occurrence list order) is used to find the correct match
4. `scrollPosToCenter` uses `view.domAtPos` + `scrollIntoView({ block: "center" })` to center the element, then sets the ProseMirror selection
5. An `isProgrammaticScroll` guard prevents the `ResizeObserver` and scroll-save listeners from overriding the scroll during a 500ms window

**Key implementation decisions:**

- Context strings (`context_before`/`context_after`) are stored in the index but not used for navigation — ProseMirror's text representation can differ subtly from comrak's AST text nodes. Instead, Nth-occurrence counting provides reliable disambiguation.
- `scrollToText` is set atomically with tab activation in `openTab()` to prevent a race condition where the saved scroll position restore (triggered by the `ResizeObserver`) overwrites the programmatic scroll.
- The position search builds a text + position map in a single pass through ProseMirror's document tree, correctly handling non-text leaf nodes (e.g. `hardBreak` → `"\n"`) that contribute to `textContent`.

### Indexer Module

New Rust module: `src-tauri/src/index/`

```
src-tauri/src/index/
├── mod.rs          # Public API (init, index_file, query functions)
├── db.rs           # Schema creation, migrations, connection management
├── parser.rs       # comrak AST walking — tags, mentions, headings, tasks, goals, body text
├── queries.rs      # SQL query builders for all search operations
├── tasks.rs        # Task toggle via context matching (read file, find task, rewrite)
└── icloud.rs       # iCloud exclusion utilities (xattr on macOS)
```

### Watcher Integration

The existing filesystem watcher (`watcher.rs`) already emits `file-changed` events. The indexer hooks into this:

```
file-changed (create/modify) ──> is .md file? ──> re-index that single file
file-changed (delete) ──> remove file from index
```

On the Rust side, the indexer subscribes to watcher events directly (no frontend round-trip needed):

```rust
// In watcher.rs, after emitting the Tauri event:
if path_str.ends_with(".md") {
    if let Some(indexer) = app.try_state::<IndexState>() {
        indexer.queue_reindex(path_str.clone(), kind.clone());
    }
}
```

Reindexing is debounced (500ms) and batched to avoid thrashing during bulk operations (git checkout, iCloud sync burst).

### Startup Flow

1. App starts → `index_init()` called from `lib.rs` setup
2. For each project + global scope: open or create `index.db`
3. Compare `files.content_hash` against actual file hashes
4. Re-index any files that changed since last run (or all files on first run)
5. Full initial index of a typical project (\~500 files): &lt; 2 seconds
6. Subsequent startups with no changes: &lt; 100ms (hash comparison only)

### Replacing Existing Commands

| Current Rust command | File | Replacement | Status |
| --- | --- | --- | --- |
| `scan_tags_in_directories` | `file.rs` | `index_tags` → SQL on `tags` table | Replaced (old cmd still registered, unused) |
| `find_tag_occurrences` | `file.rs` | `index_tag_occurrences` → SQL join `tags` + `files` | Replaced (old cmd still registered, unused) |
| `scan_mentions_in_directories` | `file.rs` | `index_mentions` → SQL on `mentions` table | Replaced (old cmd still registered, unused) |
| `find_mention_occurrences` | `file.rs` | `index_mention_occurrences` → SQL join `mentions` + `files` | Replaced (old cmd still registered, unused) |
| `search_research` | `file.rs` | `index_search_research` → SQL on `research` + `research_tags` | Replaced (old cmd still registered, unused) |
| `search_file_content` | `file.rs` | `index_search_content` → FTS5 `MATCH` query | Replaced (old cmd still registered, unused) |
| `parse_task_items` | `actions.rs` | `index_tasks` → SQL on `tasks` table | Replaced via frontend (action-store calls indexTasks) |
| `parse_goal_items` | `actions.rs` | `index_goals` → SQL on `goals` table | Replaced via frontend (action-store calls indexGoals) |
| `scan_markdown_files` | `actions.rs` | Eliminated — indexer handles all scanning | Still used by `scan_actions` for comment discovery |
| `scan_actions` | `actions.rs` | Kept — still needed for comment scanning (JSON sidecar files) | Active — tasks/goals filtered out on frontend |

| Current frontend | File | Replacement | Status |
| --- | --- | --- | --- |
| `tag-store.ts` | Zustand store | `index_tags` command | Orphaned (zero imports), pending deletion |
| `mention-store.ts` | Zustand store | `index_mentions` command | Orphaned (zero imports), pending deletion |
| `refreshTags()` | `useFileOperations.ts` | Watcher-driven indexer | Removed |
| `refreshMentions()` | `useFileOperations.ts` | Watcher-driven indexer | Removed |
| `toggleTaskDone()` line ±3 search | `action-store.ts` | `index_toggle_task` with context matching | Replaced |
| Content search debounce + scan | `CommandPalette.tsx` | `index_search_content` FTS5 query | Replaced |
| Goal discovery file scan | `useGoalsDiscovery.ts` | `index_goals` → read only goal files | Replaced |

### Drilldown Fix

The `SymbolSearchResults.tsx` drilldown race condition is fixed as part of this work. The component is refactored to:

1. Remove the `query !== drilldown` effect that immediately clears drilldown (was clearing because query is always empty in prefix modes)
2. Fetch items asynchronously from the index via `config.fetchItems()` instead of reading from Zustand stores
3. Exit drilldown only when the palette closes (via the `!open` effect)
4. Pass Nth-occurrence index when selecting an occurrence (computed from occurrence list order within the same file)

### Prefix Selection Fix

When the command palette opens with a prefix mode (Cmd+2 for `@`, Cmd+3 for `#`), the Dialog auto-focus was selecting the prefix character, causing the user's first keystroke to replace it. Fixed with a `needsCursorFix` ref and `onFocus` handler that moves the cursor to the end of the prefix on the first focus after open.

### Scroll-to-Position Architecture

The scroll-to-position mechanism required solving several interacting problems:

1. **Atomic scroll target + tab activation:** `scrollToText` is set in the same Zustand `set()` call as `activeTabId` (inside `openTab`), preventing a race where the tab-switch effect runs before the scroll target is set and falls through to `restoreScrollRatio`.

2. **Position finding:** `findTextPositionInDoc` builds a text string and ProseMirror position map in a single pass through the document tree, handling non-text leaf nodes (e.g. `hardBreak` → `"\n"`) that contribute to `textContent`. Supports Nth-occurrence matching for disambiguation.

3. **Scroll centering:** Uses `view.domAtPos(pos)` + `el.scrollIntoView({ block: "center", behavior: "instant" })`. ProseMirror selection is set AFTER the scroll to prevent the browser's native selection-scroll from overriding centering.

4. **Scroll restoration guard:** `isProgrammaticScroll` ref prevents the `ResizeObserver` (which restores saved scroll position on resize) and the scroll-save listener from interfering during a 500ms window after programmatic scroll.

## UI/UX

### No New UI Surfaces

This is an infrastructure change. The command palette UX remains identical — same `#`, `@`, `?` prefix modes, same two-level drilldown, same keyboard shortcuts. The difference is:

- Results are correct (no false positives)
- Results appear instantly (SQL query, not filesystem scan)
- Clicking a result navigates to the correct position
- Research search finds files that were previously invisible

### Research Search Improvements

Research search (`?` mode) becomes more forgiving:

- Files without `title` use the filename (without extension) as title
- Files without `source_url` are still included (URL field shows empty)
- Multi-line YAML tag arrays are supported (comrak parses full YAML)
- Empty query shows all research files (sorted by date)
- Shows which project each research file belongs to

### Index Status Indicator

Subtle indicator during reindexing:

- Small spinner in the status bar during initial index build or bulk reindex
- No indicator during normal incremental updates (&lt; 100ms, imperceptible)
- Toast notification if index rebuild is triggered manually (e.g., after corruption)

## Data Model

### SQLite Schema (`index.db`)

```sql
-- Indexed files with content hash for change detection
CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,               -- filename without extension
    project_path TEXT,                -- NULL for global/explorer files
    content_hash TEXT NOT NULL,       -- SHA-256 of file content
    title TEXT,                       -- from frontmatter or first heading
    has_frontmatter INTEGER DEFAULT 0,
    indexed_at INTEGER NOT NULL       -- unix timestamp
);

-- Tags extracted from AST text nodes (not code, not frontmatter, not headings)
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,                -- without # prefix
    context_before TEXT DEFAULT '',   -- ~50 chars before for disambiguation
    context_after TEXT DEFAULT ''     -- ~50 chars after for disambiguation
);
CREATE INDEX idx_tags_tag ON tags(tag);
CREATE INDEX idx_tags_file ON tags(file_id);

-- Mentions extracted from AST text nodes
CREATE TABLE mentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    mention TEXT NOT NULL,            -- without @ prefix
    context_before TEXT DEFAULT '',
    context_after TEXT DEFAULT ''
);
CREATE INDEX idx_mentions_mention ON mentions(mention);
CREATE INDEX idx_mentions_file ON mentions(file_id);

-- Headings for document outline and future backlink support
CREATE TABLE headings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    level INTEGER NOT NULL,           -- 1-6
    text TEXT NOT NULL,
    position INTEGER NOT NULL         -- sequential order in document
);
CREATE INDEX idx_headings_file ON headings(file_id);

-- Research file metadata (parsed from frontmatter)
CREATE TABLE research (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
    source_url TEXT DEFAULT '',
    date_saved TEXT DEFAULT '',
    word_count INTEGER DEFAULT 0,
    snippet TEXT DEFAULT ''           -- first ~200 chars of body
);

-- Research tags (separate table for proper querying)
CREATE TABLE research_tags (
    research_id INTEGER NOT NULL REFERENCES research(id) ON DELETE CASCADE,
    tag TEXT NOT NULL
);
CREATE INDEX idx_research_tags ON research_tags(tag);

-- Task items extracted from AST TaskItem nodes (not code blocks)
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    text TEXT NOT NULL,                -- task description
    done INTEGER DEFAULT 0,           -- 0 = unchecked, 1 = checked
    position INTEGER NOT NULL,        -- sequential order in document
    context_before TEXT DEFAULT '',    -- ~50 chars before for disambiguation
    context_after TEXT DEFAULT ''      -- ~50 chars after for disambiguation
);
CREATE INDEX idx_tasks_file ON tasks(file_id);
CREATE INDEX idx_tasks_done ON tasks(done);

-- Goal file metadata (from frontmatter type: goal)
CREATE TABLE goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    template TEXT DEFAULT '',         -- okr, checklist, smart, milestone
    total_tasks INTEGER DEFAULT 0,
    completed_tasks INTEGER DEFAULT 0
);
CREATE INDEX idx_goals_file ON goals(file_id);

-- Full-text search for file content (replaces search_file_content re-scanning)
CREATE VIRTUAL TABLE files_fts USING fts5(
    title, body,
    content='files',
    content_rowid='id',
    tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync with files table
CREATE TRIGGER files_ai AFTER INSERT ON files BEGIN
    INSERT INTO files_fts(rowid, title, body) VALUES (new.id, new.title, '');
END;
CREATE TRIGGER files_ad AFTER DELETE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, title, body) VALUES ('delete', old.id, old.title, '');
END;

-- Schema version for migrations
CREATE TABLE schema_version (
    version INTEGER NOT NULL
);
```

### Rust Types

```rust
// src-tauri/src/index/mod.rs

pub struct IndexState {
    /// Global index DB connection
    global_db: Mutex<Connection>,
    /// Per-project index DB connections (project_path → connection)
    project_dbs: Mutex<HashMap<PathBuf, Connection>>,
    /// Pending reindex queue (debounced)
    reindex_queue: Mutex<Vec<(String, String)>>, // (path, kind)
}

#[derive(Serialize, Deserialize, Clone)]
pub struct IndexedTag {
    pub tag: String,
    pub file_count: usize,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TagOccurrence {
    pub path: String,
    pub file_name: String,
    pub context_before: String,
    pub context_after: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct IndexedMention {
    pub mention: String,
    pub file_count: usize,
}

#[derive(Serialize, Deserialize, Clone)]
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

#[derive(Serialize, Deserialize, Clone)]
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

#[derive(Serialize, Deserialize, Clone)]
pub struct IndexedGoal {
    pub path: String,
    pub file_name: String,
    pub title: String,
    pub template: String,
    pub total_tasks: usize,
    pub completed_tasks: usize,
    pub project_name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ContentSearchResult {
    pub path: String,
    pub file_name: String,
    pub title: Option<String>,
    pub snippet: String,           // FTS5 snippet with match highlights
    pub rank: f64,                 // FTS5 relevance rank
}
```

### Tauri Commands

```rust
// Initialize index for a project or global scope
#[tauri::command]
async fn index_init(
    state: State<'_, IndexState>,
    project_path: Option<String>,
) -> Result<IndexStats, String>

// Force reindex of a specific file (called after save)
#[tauri::command]
async fn index_file(
    state: State<'_, IndexState>,
    path: String,
) -> Result<(), String>

// Force full reindex of a project or global scope
#[tauri::command]
async fn index_rebuild(
    state: State<'_, IndexState>,
    project_path: Option<String>,
) -> Result<IndexStats, String>

// Query tags (replaces scan_tags_in_directories)
#[tauri::command]
async fn index_tags(
    state: State<'_, IndexState>,
    project_paths: Vec<String>,
    query: Option<String>,
) -> Result<Vec<IndexedTag>, String>

// Query tag occurrences (replaces find_tag_occurrences)
#[tauri::command]
async fn index_tag_occurrences(
    state: State<'_, IndexState>,
    tag: String,
    project_paths: Vec<String>,
) -> Result<Vec<TagOccurrence>, String>

// Query mentions (replaces scan_mentions_in_directories)
#[tauri::command]
async fn index_mentions(
    state: State<'_, IndexState>,
    project_paths: Vec<String>,
    query: Option<String>,
) -> Result<Vec<IndexedMention>, String>

// Query mention occurrences (replaces find_mention_occurrences)
#[tauri::command]
async fn index_mention_occurrences(
    state: State<'_, IndexState>,
    mention: String,
    project_paths: Vec<String>,
) -> Result<Vec<TagOccurrence>, String>

// Search research files (replaces search_research)
#[tauri::command]
async fn index_search_research(
    state: State<'_, IndexState>,
    project_paths: Vec<String>,
    query: Option<String>,
    tag: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ResearchResult>, String>

// Search tasks (replaces parse_task_items in actions.rs)
#[tauri::command]
async fn index_tasks(
    state: State<'_, IndexState>,
    project_paths: Vec<String>,
    done: Option<bool>,          // filter by completion status
    query: Option<String>,       // substring match on task text
    limit: Option<usize>,
) -> Result<Vec<IndexedTask>, String>

// Toggle task completion (replaces fragile line-number toggle in action-store.ts)
#[tauri::command]
async fn index_toggle_task(
    state: State<'_, IndexState>,
    path: String,
    context_before: String,      // context-based matching, not line numbers
    context_after: String,
    task_text: String,
    done: bool,                  // new completion state
) -> Result<(), String>

// Search goals (replaces parse_goal_items in actions.rs)
#[tauri::command]
async fn index_goals(
    state: State<'_, IndexState>,
    project_paths: Vec<String>,
) -> Result<Vec<IndexedGoal>, String>

// Full-text content search (replaces search_file_content filesystem scan)
#[tauri::command]
async fn index_search_content(
    state: State<'_, IndexState>,
    project_paths: Vec<String>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<ContentSearchResult>, String>

// Get index stats (for status bar indicator)
#[tauri::command]
async fn index_stats(
    state: State<'_, IndexState>,
    project_path: Option<String>,
) -> Result<IndexStats, String>
```

### Frontend Changes

**Remove:**

- `src/stores/tag-store.ts` — replaced by `index_tags` command
- `src/stores/mention-store.ts` — replaced by `index_mentions` command
- `refreshTags()` and `refreshMentions()` in `useFileOperations.ts` — indexer handles this
- `scan_tags_in_directories`, `find_tag_occurrences`, `scan_mentions_in_directories`, `find_mention_occurrences`, `search_research` from Rust backend
- `parse_task_items`, `parse_goal_items`, `scan_markdown_files` from Rust backend
- `search_file_content` from Rust backend (replaced by FTS5)
- `toggleTaskDone()` line-number-based toggle logic in `action-store.ts`

**Modify:**

- `CommandPalette.tsx` — Call `index_tags`/`index_mentions` instead of reading Zustand stores. Research search calls `index_search_research`. Content search calls `index_search_content`.
- `SymbolSearchResults.tsx` — Fix drilldown race condition. Receive `TagOccurrence` with context instead of line numbers.
- `App.tsx` — Remove `refreshTags()` / `refreshMentions()` startup calls. Add `index_init()` call.
- `useFileOperations.ts` — Remove tag/mention refresh after save (indexer handles via watcher).
- `action-store.ts` — Replace `toggleTaskDone()` with `index_toggle_task` command (context-based matching). Replace task/goal loading with `index_tasks` / `index_goals` commands.
- `useGoalsDiscovery.ts` — Replace file-by-file frontmatter scanning with `index_goals` command.

**Add:**

- `src/lib/tauri.ts` — New `tauriApi` wrappers for all `index_*` commands

### Convergence with Memory Agent PRD

The memory agent PRD (`2026-03-07`) specifies:

- `rusqlite` with `bundled` feature — **shared dependency**, added once
- `~/.notesage/memory.db` and `.notesage/memory.db` — **parallel to** `index.db`, same directory structure
- `MemoryState` managed state — **parallel to** `IndexState`
- `memory_init()` on startup — called alongside `index_init()`

When implementing the memory agent, the storage layer pattern established here (DB creation, iCloud exclusion, per-project scoping, connection management) is reused directly.

## Dependencies

### New Rust Dependencies

| Crate | Purpose | Notes |
| --- | --- | --- |
| `rusqlite` | SQLite access | `features = ["bundled"]` for self-contained builds. Shared with future memory agent. |
| `sha2` | Content hashing for change detection | Lightweight. May already be a transitive dependency. |

### Existing Dependencies (reused)

| Crate | Purpose |
| --- | --- |
| `comrak` | Markdown → AST parsing (already used by PDF export) |
| `regex` | Tag/mention pattern matching within text nodes (already used) |

### No New Frontend Dependencies

All UI changes use existing shadcn/ui components and Tauri invoke patterns.

## Quality Gates

### Functional — Tag/Mention Search

- [x] `#` in command palette shows tags from document body text, list items, and headings

- [x] Tags inside fenced code blocks are excluded

- [x] Tags inside inline code spans are excluded

- [x] Tags in YAML frontmatter keys/values are excluded (frontmatter `tags:` array parsed separately)

- [x] Tags in heading text are included (comrak strips `#` heading markers, so `#tag` in heading text is genuine)

- [x] Tags in URLs (e.g., `https://example.com#section`) are excluded

- [x] `@` in command palette shows only intentional mentions, not email addresses or code annotations

- [x] Selecting a tag shows all occurrences across files (drilldown works)

- [x] Selecting an occurrence opens the file and scrolls to the correct position (Nth-occurrence matching)

- [x] New tags appear in search within 2 seconds of saving a file

- [x] Deleted files are removed from the index

- [x] Renamed files update the index (watcher emits delete + create)

### Functional — Research Search

- [x] `?` in command palette shows research files from all projects

- [x] Research files without `title` use filename as title

- [x] Research files without `source_url` are still shown

- [x] Multi-line YAML tag arrays are parsed correctly

- [x] Empty query shows all research files sorted by date

- [x] Results show which project each file belongs to

- [x] Selecting a result opens the research file

### Functional — Task/Action Search

- [x] Actions dashboard shows only task items from document body (not from code blocks)

- [x] Task checkbox toggle reliably toggles the correct item via context matching

- [x] Task toggle works even when lines have been added/removed above the task

- [x] Goals are discovered via frontmatter `type: goal` parsed by comrak (not string matching)

- [x] Goal progress (completed/total tasks) is computed from indexed tasks in the same file

- [x] New tasks appear in actions dashboard within 2 seconds of saving

### Functional — Content Search (FTS5)

- [x] Content search (Cmd+Shift+F / files mode) queries FTS5 index instead of re-scanning files

- [x] FTS5 results include relevance ranking (most relevant first)

- [x] FTS5 supports partial word matching (prefix queries)

- [x] Results appear in &lt; 50ms for typical queries

- [x] FTS index stays in sync with file changes (watcher-driven)

- [x] Non-markdown text files are also indexed for content search

### Functional — Index Lifecycle

- [x] Index builds on first app launch (all projects + global scope)

- [x] Full index of 500 files completes in &lt; 2 seconds

- [x] Incremental reindex of single file completes in &lt; 100ms

- [x] Index survives app restart (persisted SQLite)

- [x] Corrupted or deleted `index.db` triggers automatic rebuild with no user action

- [x] Index DB excluded from iCloud sync (xattr set on macOS)

- [x] No performance degradation during normal editing (indexing is async via watcher debounce)

### Functional — Cross-Device (iCloud)

- [ ] Project synced via iCloud builds correct index on second device (not tested)

- [x] Files arriving via iCloud sync trigger reindex via watcher

- [x] No SQLite corruption when project folder is in iCloud

- [x] Index DB is not synced (each device has its own)

### Design

- [x] Command palette UX unchanged (same shortcuts, same prefix modes, same drilldown)

- [x] Status bar shows subtle spinner during bulk reindex only

- [x] No new settings or configuration required from user (zero-config)

### Migration

- [x] Existing `tag-store` and `mention-store` Zustand stores deleted

- [x] No orphaned localStorage keys from removed stores (cleared on first launch)

- [x] Old Rust commands removed from `generate_handler![]` and implementations deleted from `file.rs`/`actions.rs`

- [x] Old frontend scan logic removed: `refreshTags()`, `refreshMentions()`, line-number task toggle

- [x] First launch after upgrade builds index automatically

## Remaining Items

- [x] Clear orphaned `tag-store` and `mention-store` localStorage keys on first launch after upgrade

- [x] Status bar spinner during bulk reindex

- [ ] Cross-device iCloud testing (not tested on second device)

- [x] Renamed file index update (watcher emits delete + create events; indexer handles both)

## Out of Scope

- **Memory agent features** — AI ingestion, consolidation, query pipelines. Covered by `2026-03-07-always-on-memory-agent.md`. This PRD provides the shared `rusqlite` dependency and DB architecture patterns.
- **Cross-device memory sync** — Explore in a future PRD after memory agent ships.
- **Backlink graph** — Headings table enables this, but no UI.
- **Non-markdown indexing** — Only `.md` files. PDF, EPUB, DOCX content not indexed.
- **Tag rename/refactor** — Bulk rename of a tag across all files. Possible future feature using the index.
- **Custom tag patterns** — Some users may want `+tag` or `::tag` syntax. Not supported initially.
- **Windows/Linux iCloud equivalents** — iCloud exclusion is macOS-only. Other platforms don't have iCloud. Cloud sync for those platforms is deferred.