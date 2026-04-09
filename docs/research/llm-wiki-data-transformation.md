# Research: LLM-Driven Data Transformation & Link Discovery

|  |  |
| --- | --- |
| **Date** | 2026-04-09 |
| **Source** | [Karpathy's LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) |
| **Focus** | How to apply the data-transformation and link-discovery ideas to Notesage |
| **Related PRD** | [Knowledge Base Synthesis](../prds/2026-04-05-knowledge-base-synthesis.md) |

## The Core Insight

Karpathy's LLM Wiki pattern is not really about wikis. The interesting idea is a **data transformation pipeline**: raw sources go in, and the LLM incrementally builds structured, interlinked knowledge out of them. The human provides material and asks questions; the LLM handles the tedious bookkeeping of cross-referencing, summarizing, and maintaining consistency.

Two operations are particularly relevant to Notesage:

1. **Ingest as transformation** — When new content enters the system, don't just store it. Extract entities, find relationships to existing content, and propose connections. A single new source might touch many existing notes.
2. **Lint as discovery** — Periodically scan the corpus to find contradictions, orphan content, missing connections, and gaps. This is link discovery after the fact.

Both are about turning **passive storage into active knowledge** — exactly the gap the existing Knowledge Base Synthesis PRD identifies.

## What Notesage Already Has

The infrastructure for this is largely in place:

| Capability | Status | Location |
| --- | --- | --- |
| AST-aware markdown parsing | Done | `src-tauri/src/index/parser.rs` — comrak extracts tags, mentions, headings, tasks, frontmatter |
| SQLite document index | Done | `src-tauri/src/index/` — FTS5, tag/mention indexes, research metadata |
| Incremental reindexing | Done | Filesystem watcher triggers reindex on file changes via content hash |
| Research file storage | Done | `.notesage/research/` with YAML frontmatter (source_url, tags, date_saved) |
| Research search | Done | `search-research` skill + `index_search_research` Tauri command (tag, keyword, relevance scoring) |
| Full-text search | Done | FTS5 with porter stemming across all indexed files |
| AI tool calling | Done | Direct API + ACP paths, skill-to-tool glue layer, 20-call execution loops |
| Headings table | Done | Schema ready in `db.rs:219-227` — stores level, text, position per file |
| Cross-source synthesis | Done | `synthesize-sources` skill generates thematic analysis |

What's **missing** is the connective tissue: the system can store and search, but it doesn't proactively discover relationships or transform raw content into linked knowledge.

## Proposed Enhancements

### 1. Link Table in SQLite Index

Add a `links` table to track file-to-file references discovered during indexing:

```sql
CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    target_path TEXT NOT NULL,          -- resolved relative/absolute path
    target_file_id INTEGER,             -- NULL if target not yet indexed
    link_text TEXT DEFAULT '',           -- display text of the link
    link_type TEXT DEFAULT 'explicit',   -- 'explicit' | 'tag_overlap' | 'ai_suggested'
    confidence REAL DEFAULT 1.0          -- 1.0 for explicit links, <1.0 for inferred
);
CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_file_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_file_id);
CREATE INDEX IF NOT EXISTS idx_links_target_path ON links(target_path);
```

**Why this matters:** The headings table already exists. Adding a links table completes the graph. Every `[text](./file.md)` in the AST becomes a row. This is a small schema change that enables:

- **Backlink queries:** "What links to this file?" — `SELECT * FROM links WHERE target_file_id = ?`
- **Orphan detection:** "Which files have no inbound or outbound links?" — a simple LEFT JOIN
- **Graph traversal:** "What's related to X?" — follow links 1-2 hops out
- **Link health:** "Which links point to files that don't exist?" — `WHERE target_file_id IS NULL`

The parser change is also small: comrak already walks the AST. Add a case for `NodeValue::Link` that records the URL and text.

### 2. Tag Co-occurrence as Implicit Links

Files that share tags are implicitly related. This doesn't require a new table — it's a query:

```sql
-- Files that share tags with a given file, ranked by overlap count
SELECT f2.path, f2.name, COUNT(DISTINCT t2.tag) as shared_tags
FROM tags t1
JOIN tags t2 ON t1.tag = t2.tag AND t1.file_id != t2.file_id
JOIN files f2 ON t2.file_id = f2.id
WHERE t1.file_id = ?
GROUP BY f2.id
ORDER BY shared_tags DESC
LIMIT 10;
```

This is cheap, runs entirely in SQLite, and gives immediate "related files" without any AI inference. It could power:

- A "Related Notes" section in a sidebar panel or at the bottom of the editor
- Input to the `ingest-research` skill when proposing cross-references
- The `lint-knowledge` skill's "missing cross-references" check

### 3. Ingest-Time Transformation Pipeline

The key Karpathy idea applied to Notesage's skill system. When a new file is saved (via `save-research`, `download-webpage`, or even a manual file create), trigger a transformation step:

```
File saved → Watcher detects change → Reindex (existing)
                                    → [NEW] Run link discovery:
                                        1. Query tag co-occurrence for related files
                                        2. Query FTS5 for content-similar files
                                        3. If matches found, queue a suggestion
```

**Implementation options (from lightest to heaviest):**

**Option A — Query-only (no AI, instant):**
After reindexing a file, run the tag co-occurrence query. If the file shares 2+ tags with another file and neither links to the other, surface a suggestion in the Activity panel or as a toast: "This note shares tags #X, #Y with [Other Note]. Link them?"

This is the lightest possible version. No AI calls, no latency, pure SQL. It catches the obvious connections.

**Option B — FTS5 similarity (no AI, fast):**
After reindexing, also run an FTS5 query using the new file's title and first heading as search terms. This catches content-similar files even when tags don't overlap. Still no AI, still fast.

**Option C — AI-assisted (full Karpathy pattern):**
After reindexing, if Option A or B finds related files, pass the new file + top related files to the AI with a prompt: "Analyze how this new source relates to these existing notes. Suggest: (a) cross-references to add, (b) existing claims that this source updates or contradicts, (c) whether a synthesis page would be valuable."

This is the `ingest-research` skill from the Knowledge Base Synthesis PRD. The key insight from Karpathy is that this should be **the default ingest path**, not a separate skill the user has to remember to invoke.

**Recommendation:** Start with Option A (tag co-occurrence) as an automatic background step. It's zero-cost, zero-latency, and immediately useful. Option B adds FTS5 similarity as a second signal. Option C (AI-assisted) remains a user-invoked skill for when deeper analysis is wanted, but the first two options handle the 80% case of "these files are obviously related."

### 4. Lint as Background Link Discovery

The `lint-knowledge` skill proposed in the Knowledge Base Synthesis PRD maps directly to Karpathy's "lint" operation. The key checks that relate to link discovery:

| Check | Implementation | AI needed? |
| --- | --- | --- |
| **Orphan files** | `LEFT JOIN links` — files with no inbound or outbound links and no tags | No |
| **Missing cross-refs** | Tag co-occurrence query where no explicit link exists | No |
| **Broken links** | `links WHERE target_file_id IS NULL` | No |
| **Contradictions** | Read file pairs with high tag overlap, ask AI to compare claims | Yes |
| **Stale sources** | `WHERE date_saved < (now - threshold)` | No |
| **Duplicate content** | FTS5 + title similarity scoring | No (or minimal AI for confirmation) |
| **Tag normalization** | Levenshtein distance on tag names (e.g., `#ML` vs `#machine-learning`) | No |

Most of these are pure SQL. Only contradiction detection truly needs AI. This means lint can run fast and often — even on every save if scoped to the changed file's neighborhood.

### 5. Embedding-Based Similarity (Future Layer)

The existing PRDs explicitly defer embeddings as a non-goal ("FTS5 sufficient for personal scale"). This is a reasonable position today, but worth revisiting as a future enhancement:

**When embeddings would add value:**
- Tag co-occurrence misses files that discuss the same concept with different vocabulary
- FTS5 misses semantic similarity ("machine learning" vs "neural networks" vs "deep learning")
- As knowledge bases grow past ~500 files, keyword overlap becomes noisy

**How it could work in Notesage:**
- Use the bundled `llama-server` to generate embeddings locally (privacy-first, no API calls)
- Store vectors in a new `embeddings` table (SQLite can store BLOBs; or use `sqlite-vss` extension)
- Generate embeddings for each file's title + first 500 words during indexing
- Cosine similarity queries replace or augment FTS5 for "related files"
- Budget: ~50ms per file for small models (e.g., `nomic-embed-text`), acceptable during incremental reindex

**Not recommended for Phase 1.** Tag co-occurrence + FTS5 handles the common case. Embeddings become the next step when users hit the ceiling of keyword-based discovery.

## Integration Points with Existing Architecture

### Watcher → Index → Link Discovery (automatic)

```
watcher.rs: file-changed event
  → index/mod.rs: reindex_file()
      → parser.rs: parse_file() [existing — add link extraction]
      → db.rs: insert into links table [new]
      → queries.rs: query_tag_cooccurrence() [new]
      → If suggestions found: emit Tauri event → frontend shows suggestion
```

This hooks into the existing incremental indexing pipeline. No new Tauri commands needed for the basic flow — just extend the parser and add a query.

### Skill System (user-invoked)

The `ingest-research` and `lint-knowledge` skills from the Knowledge Base Synthesis PRD become the AI-powered layer on top of the SQL-based link discovery. They can call:

- `index_search_content` (existing) for FTS5 similarity
- `index_tags` (existing) for tag-based discovery
- A new `index_related_files` Tauri command that combines tag co-occurrence + FTS5 + explicit link queries

### Editor UI

Once the `links` table exists, the editor can show:

- **Backlinks panel:** "N notes link to this file" — clickable list in sidebar or popover
- **Related notes:** Tag co-occurrence results shown below the editor or in the command palette
- **Link suggestions:** Inline decoration or toast when the system detects an unlinked related file
- **Graph view (future):** Visualization of the link network — requires backlinks infrastructure first

### Command Palette

Extend the existing command palette modes:

| Prefix | Mode | Source |
| --- | --- | --- |
| `#` | Tags | Existing |
| `@` | Mentions | Existing |
| `?` | Research | Existing |
| `~` | Related to current file | **New** — tag co-occurrence + backlinks |

## Implementation Phases

### Phase 0: Links Table + Parser Extension (foundation)

- Add `links` table to SQLite schema (migration v2)
- Extend `parser.rs` to extract `NodeValue::Link` URLs from the AST
- Resolve relative paths against source file directory
- Populate `links` table during reindexing
- Add `query_backlinks(file_id)` and `query_outbound_links(file_id)` to `queries.rs`
- Add `index_backlinks` and `index_outbound_links` Tauri commands
- **Effort:** Small — schema change, parser case, two queries

### Phase 1: Tag Co-occurrence Queries (zero-cost discovery)

- Add `query_related_by_tags(file_id, limit)` to `queries.rs`
- Add `index_related_files` Tauri command combining tag overlap + explicit links
- Surface in command palette (`~` prefix mode)
- Optional: show "Related Notes" count badge on status bar
- **Effort:** Small — one SQL query, one Tauri command, minor UI

### Phase 2: Ingest-Time Suggestions (automatic link proposals)

- After reindexing a file, run tag co-occurrence query
- If related files found with no mutual links, emit `link-suggestion` Tauri event
- Frontend shows non-intrusive suggestion (toast or activity panel entry)
- User can dismiss, open the related file, or insert a link
- **Effort:** Medium — event plumbing, suggestion UI component

### Phase 3: AI-Assisted Ingestion (full transformation)

- The `ingest-research` skill from the Knowledge Base Synthesis PRD
- Uses the SQL-based discovery from Phase 1-2 as input to the AI
- AI proposes cross-references, identifies contradictions, suggests synthesis
- User approves/rejects each proposal
- **Effort:** Medium — skill SKILL.md, prompt engineering, approval UX

### Phase 4: Lint & Health Checking

- The `lint-knowledge` skill from the Knowledge Base Synthesis PRD
- Most checks are pure SQL against the links + tags tables
- Contradiction detection uses AI on file pairs flagged by tag overlap
- Output as structured lint report
- **Effort:** Medium — skill script, SQL queries, report formatting

### Phase 5: Embeddings (when needed)

- Local embedding generation via bundled llama-server
- `embeddings` table in SQLite (file_id, vector BLOB)
- Cosine similarity for related-file queries
- Augments tag co-occurrence and FTS5, doesn't replace them
- **Effort:** Large — new embedding pipeline, vector math, model management

## Key Takeaway

The most impactful idea from Karpathy's pattern isn't the wiki format — it's that **the LLM should do the bookkeeping humans abandon**. In Notesage terms:

1. **Links should be discovered, not just authored.** Tag co-occurrence and FTS5 similarity can surface connections instantly, with zero AI cost.
2. **Ingestion should be transformation.** Saving a file should trigger a "what does this relate to?" step — at minimum SQL-based, optionally AI-assisted.
3. **Health checking should be routine.** Orphan detection, broken links, and tag hygiene are all cheap SQL queries that can run continuously.

The existing SQLite index, comrak parser, and skill system provide the foundation. The main missing piece is the `links` table and the tag co-occurrence query — both small additions that unlock the entire link-discovery pipeline.
