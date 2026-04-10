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

## Automatic Entity Recognition & Cross-Indexing

The sections above cover file-to-file link discovery. There's a second, equally valuable problem: **recognizing words inside documents that correspond to known tags, mentions, or recurring concepts — without the user typing `#` or `@` prefixes.**

Today, if a user writes "I discussed the transformer architecture with Sarah" in a note, none of that is indexed. But if the workspace already has `#transformer`, `#architecture`, and `@Sarah` in other files, the system should notice and offer to tag/link them.

### Current Architecture Gap

| Component | What it does today | What's missing |
| --- | --- | --- |
| `tag-highlight.ts` | Regex-matches `#tag` on every keystroke, decorates as badge | Only matches explicit `#` prefix. Doesn't know what tags exist. |
| `mention-highlight.ts` | Same for `@mention` | Same limitation. |
| `tag-suggestion.tsx` | Queries SQLite index for autocomplete after `#` typed | Only activates after user types `#`. |
| `parser.rs` | Extracts `#tag` and `@mention` from AST text nodes | Only matches prefixed patterns. |
| SQLite index | Stores all known tags + mentions with file counts | Data exists, but nothing consumes it for entity matching. |

The index *knows* every tag and mention in the workspace. The editor decorations *don't use this knowledge*. Bridging this gap enables automatic entity recognition.

### Design: Two-Layer Entity Recognition

#### Layer 1: Background Entity Index (Rust, runs on file change)

When the watcher triggers a reindex, the parser currently extracts `#tags` and `@mentions`. Extend it to also detect **un-prefixed occurrences** of known entities:

```
File changed → Reindex pipeline:
  1. Parse file (existing — extract #tags, @mentions, headings, tasks)
  2. [NEW] Load known entity dictionary from index:
     - All tags from `SELECT DISTINCT tag FROM tags`
     - All mentions from `SELECT DISTINCT mention FROM mentions`
     - All file titles from `SELECT DISTINCT title FROM files WHERE title IS NOT NULL`
  3. [NEW] Scan body text for un-prefixed matches:
     - Word-boundary match each entity against the document text
     - Skip matches inside code blocks, frontmatter, existing #tag/@mention patterns
     - Record as "suggested" entities with position and context
  4. [NEW] Store in a `suggested_entities` table
```

**New schema:**

```sql
CREATE TABLE IF NOT EXISTS suggested_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    entity_text TEXT NOT NULL,            -- the matched word(s)
    entity_type TEXT NOT NULL,            -- 'tag' | 'mention' | 'title' | 'recurring'
    canonical_form TEXT NOT NULL,         -- the normalized form (e.g., 'transformer' for #transformer)
    position INTEGER NOT NULL,            -- byte offset in body text
    context_before TEXT DEFAULT '',
    context_after TEXT DEFAULT '',
    status TEXT DEFAULT 'suggested'        -- 'suggested' | 'accepted' | 'dismissed'
);
CREATE INDEX IF NOT EXISTS idx_suggested_file ON suggested_entities(file_id);
CREATE INDEX IF NOT EXISTS idx_suggested_status ON suggested_entities(status);
```

**Entity dictionary construction:**

The dictionary is built incrementally from the index itself. Every confirmed `#tag` in any file adds that tag's name (minus the `#`) to the dictionary. As the user's knowledge base grows, the dictionary grows automatically. No manual configuration needed.

```rust
fn build_entity_dictionary(conn: &Connection) -> EntityDictionary {
    // Tags: "machine-learning" → EntityType::Tag
    let tags: Vec<String> = query_all_tag_names(conn);
    
    // Mentions: "Sarah" → EntityType::Mention  
    let mentions: Vec<String> = query_all_mention_names(conn);
    
    // File titles: "Transformer Architecture" → EntityType::Title
    let titles: Vec<String> = query_all_titles(conn);
    
    // Build Aho-Corasick automaton for multi-pattern matching
    EntityDictionary::new(tags, mentions, titles)
}
```

**Why Aho-Corasick?** The dictionary may have hundreds or thousands of patterns. Matching each one individually with regex would be O(n * m) per file. Aho-Corasick builds a finite automaton that matches all patterns in a single pass — O(n + matches), regardless of dictionary size. The `aho-corasick` crate is a Rust standard and already well-optimized.

**Word boundary handling:**

Matching "ML" shouldn't highlight "HTML". The matcher must enforce word boundaries:

```rust
fn is_word_boundary(text: &str, start: usize, end: usize) -> bool {
    let before = if start == 0 { true } else {
        !text[..start].chars().last().unwrap().is_alphanumeric()
    };
    let after = if end >= text.len() { true } else {
        !text[end..].chars().next().unwrap().is_alphanumeric()
    };
    before && after
}
```

**Case sensitivity:** Tags are case-insensitive for matching but preserve their canonical form. "Transformer" in text matches `#transformer` and suggests the canonical `#transformer`.

#### Layer 2: Editor Decorations (TypeScript, runs on keystroke)

A new ProseMirror extension — `EntitySuggestion` — that decorates un-prefixed words matching the entity dictionary:

```typescript
// entity-suggestion.ts — new Tiptap extension

const EntitySuggestionPluginKey = new PluginKey("entitySuggestion");

// Cached entity dictionary, refreshed from SQLite on tab switch / file change
let entitySet: Set<string> = new Set();
let entityMap: Map<string, EntityInfo> = new Map();  // word → { type, canonical }

function buildEntityDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  
  doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") return false;
    if (!node.isText || !node.text) return;
    if (node.marks.some(m => m.type.name === "code")) return;
    
    const text = node.text;
    // Split into words, check each against the entity set
    const wordRe = /\b([a-zA-Z][a-zA-Z0-9_-]*)\b/g;
    let match: RegExpExecArray | null;
    
    while ((match = wordRe.exec(text)) !== null) {
      const word = match[1].toLowerCase();
      if (!entitySet.has(word)) continue;
      
      // Skip if this word is already inside a #tag or @mention decoration
      const from = pos + match.index;
      const to = from + match[1].length;
      if (isInsideTagOrMention(doc, from)) continue;
      
      const info = entityMap.get(word)!;
      decorations.push(
        Decoration.inline(from, to, {
          class: `entity-suggestion entity-${info.type}`,
          "data-entity": info.canonical,
          "data-entity-type": info.type,
        })
      );
    }
  });
  
  return DecorationSet.create(doc, decorations);
}
```

**Performance concern:** The current `tag-highlight.ts` runs a regex on every keystroke and stays under 1ms for 100KB documents (see `decorations.perf.test.ts`). The entity suggestion extension does the same text traversal but checks each word against a `Set<string>` — O(1) per lookup. For a 100KB document with ~15,000 words and a dictionary of 1,000 entities, this is ~15,000 hash lookups per keystroke. This should be well under 2ms.

**But** — if performance becomes an issue:

1. **Debounce rebuilds:** Don't rebuild on every keystroke. Rebuild on idle (requestIdleCallback) or after 300ms of no typing. The existing `tag-highlight.ts` rebuilds on every `docChanged` because the regex is cheap. Entity matching may warrant debouncing.
2. **Incremental updates:** Only re-scan the changed paragraph, not the whole document. ProseMirror's transaction tells you which regions changed via `tr.mapping`.
3. **Skip if dictionary is empty:** If no tags/mentions exist in the workspace yet, the extension does nothing.

**Dictionary refresh:** The entity set is loaded from the SQLite index via a Tauri command (`index_entity_dictionary`) on:
- Editor mount / tab switch
- After reindexing completes (listen for `index-updated` Tauri event)
- Not on every keystroke — the dictionary changes infrequently

#### Decoration Styling

Suggested entities need a visually distinct treatment from confirmed tags:

```css
/* Confirmed tags: solid badge */
.tag-badge {
  background-color: var(--color-muted);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0.05em 0.45em;
}

/* Suggested entities: subtle underline, no badge */
.entity-suggestion {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-decoration-color: var(--color-muted-foreground);
  text-underline-offset: 3px;
  cursor: pointer;
}
.entity-suggestion:hover {
  text-decoration-style: solid;
  background-color: var(--color-muted);
  border-radius: 4px;
}
```

Clicking a suggested entity opens a popover with actions:
- **Tag it** — wraps the word with `#` prefix (turns "transformer" into "#transformer")
- **Link to file** — if the entity matches a file title, inserts `[transformer](./transformer.md)`
- **Dismiss** — hides the suggestion for this word in this file (persisted in `suggested_entities.status`)
- **Dismiss everywhere** — adds to a user-managed exclusion list

#### User Interaction Flow

```
User writes: "The transformer architecture uses attention mechanisms"

Index knows: #transformer (5 files), #attention (3 files), #architecture (2 files)

Editor shows: "The transformer architecture uses attention mechanisms"
                    ^^^^^^^^^^^  ^^^^^^^^^^^^        ^^^^^^^^^
                    (dotted underline on each)

User clicks "transformer" → popover:
  [Tag it]     — changes to "#transformer"
  [Link to: Transformer Overview.md]
  [Dismiss]    — hide this suggestion

User clicks "Tag it" → text becomes "#transformer" → TagHighlight kicks in → solid badge
```

### Recurring Word Detection (New Entity Discovery)

Beyond matching against known entities, detect **new recurring words** that should become tags:

**Backend (runs during reindex):**

```sql
-- Words that appear in 3+ files but aren't tagged anywhere
-- (simplified — actual implementation uses the body text from FTS5)
WITH word_counts AS (
    SELECT word, COUNT(DISTINCT file_id) as file_count
    FROM file_words  -- hypothetical: extracted during indexing
    WHERE length(word) > 3
    AND word NOT IN (SELECT DISTINCT lower(tag) FROM tags)
    GROUP BY word
    HAVING file_count >= 3
)
SELECT word, file_count FROM word_counts ORDER BY file_count DESC;
```

In practice, this would work by:

1. During parsing, extract significant words from body text (nouns, technical terms — skip stop words)
2. Count word frequency across files using the existing FTS5 token data
3. Words appearing in 3+ files that aren't already tags become "recurring entity" suggestions
4. These appear with a different decoration style (e.g., dashed underline) and the popover says "This word appears in N files. Create tag?"

**FTS5 auxiliary function approach (simpler):**

SQLite's FTS5 already tokenizes and indexes all content. We can query term frequency:

```sql
-- Get terms that appear across many documents
SELECT term, doc_count
FROM files_fts_vocab
WHERE doc_count >= 3
AND length(term) > 3
ORDER BY doc_count DESC;
```

This requires adding `files_fts_vocab` as an FTS5 vocabulary table:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts_vocab 
    USING fts5vocab(files_fts, instance);
```

This gives us cross-document term frequency for free — FTS5 already did the tokenization.

### New File Detection

Files copied into a project folder (not created through Notesage) trigger the same pipeline:

```
New file detected by watcher → file-changed event (kind: "create")
  → Reindex pipeline runs:
      1. Parse content, extract explicit tags/mentions (existing)
      2. Match body text against entity dictionary (new)
      3. Store suggested entities in SQLite
      4. Emit Tauri event: "entities-suggested" with file path + count
  → Frontend shows toast: "3 potential tags found in imported-notes.md"
  → User opens file → entity decorations visible immediately
```

This works for:
- Files synced via iCloud from another device
- Files copied from Finder into the project folder
- Files created by external tools (AI agents, scripts, etc.)
- Bulk imports (e.g., dragging 50 notes from another app)

### Implementation Phases (Entity Recognition)

**Phase E0: Entity Dictionary Tauri Command**

- New `index_entity_dictionary(project_paths)` command returning all known tag names, mention names, and file titles
- Build in Rust, return as `Vec<EntityEntry>` with type + canonical form
- Cached in-process with invalidation on reindex
- **Effort:** Small — one query aggregating existing tables

**Phase E1: Editor Entity Decoration Extension**

- New `entity-suggestion.ts` ProseMirror plugin
- Loads dictionary on mount and on `index-updated` event
- Word-boundary matching against `Set<string>`
- Dotted underline decoration (distinct from confirmed tag badges)
- Click handler opens action popover (Tag it / Link / Dismiss)
- **Effort:** Medium — new extension, popover component, styling

**Phase E2: Backend Entity Matching During Reindex**

- Extend `parser.rs` to accept an entity dictionary parameter
- After extracting explicit tags/mentions, scan body text for dictionary matches
- Use `aho-corasick` crate for efficient multi-pattern matching
- Store results in `suggested_entities` table
- Emit `entities-suggested` Tauri event with summary
- **Effort:** Medium — parser extension, new table, Aho-Corasick integration

**Phase E3: Recurring Word Detection**

- Add `files_fts_vocab` FTS5 vocabulary table to schema
- Query for high-frequency cross-document terms not already tagged
- Surface as a separate class of suggestion ("Appears in N files — create tag?")
- **Effort:** Small — one schema addition, one query, UI treatment

**Phase E4: Dismiss/Accept Persistence**

- `suggested_entities.status` tracks user decisions per file
- "Dismiss everywhere" adds to an exclusion list (new table or stored in settings)
- Accepted suggestions become confirmed tags/mentions in the document
- **Effort:** Small — status updates, exclusion list

### Performance Budget

| Operation | Budget | Frequency | Notes |
| --- | --- | --- | --- |
| Dictionary load from SQLite | <10ms | On tab switch, on reindex | Single query, cached |
| Editor decoration rebuild | <2ms for 100KB doc | Every keystroke (or debounced) | `Set.has()` is O(1), ~15K lookups |
| Aho-Corasick match during reindex | <5ms per file | On file change | Single-pass through body text |
| FTS5 vocab query | <50ms | On lint/manual trigger | Aggregate across all indexed files |

All within the existing performance budgets documented in `docs/performance-baseline.md`.

## Key Takeaway

The most impactful idea from Karpathy's pattern isn't the wiki format — it's that **the LLM should do the bookkeeping humans abandon**. In Notesage terms:

1. **Links should be discovered, not just authored.** Tag co-occurrence and FTS5 similarity can surface connections instantly, with zero AI cost.
2. **Ingestion should be transformation.** Saving a file should trigger a "what does this relate to?" step — at minimum SQL-based, optionally AI-assisted.
3. **Health checking should be routine.** Orphan detection, broken links, and tag hygiene are all cheap SQL queries that can run continuously.
4. **Entities should be recognized, not just typed.** The index already knows every tag and mention in the workspace. Matching plain text against that dictionary turns every document into a connected node in the knowledge graph — automatically, on every save.

The existing SQLite index, comrak parser, and skill system provide the foundation. The two main additions are:
- The `links` table and tag co-occurrence query for file-to-file discovery
- The entity dictionary and `entity-suggestion` extension for intra-document recognition

Both are incremental extensions of existing infrastructure, not new systems.
