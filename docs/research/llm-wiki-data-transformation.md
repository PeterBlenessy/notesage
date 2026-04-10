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

The critical insight is that a single entity has **many surface forms**. The tag `#foo-bar` should match all of: "foo bar", "Foo Bar", "foobar", "FooBar", "Foo bar", "foo-bar". Similarly, the mention `@JohnSmith` should match "John Smith", "john smith", "JOHN SMITH".

**Normalization function:**

All surface forms reduce to a single canonical key by stripping separators and lowercasing:

```rust
/// Normalize a string to a canonical matching key.
/// "Foo Bar" → "foobar", "foo-bar" → "foobar", "FooBar" → "foobar"
fn normalize(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}
```

This means `normalize("foo bar") == normalize("foo-bar") == normalize("FooBar") == "foobar"`.

**Surface form generation:**

For each entity, generate all plausible surface forms that might appear in text:

```rust
fn surface_forms(canonical: &str) -> Vec<String> {
    // Input: tag name like "foo-bar" or mention like "JohnSmith"
    let mut forms = Vec::new();
    
    // Split on separators (hyphens, underscores) and camelCase boundaries
    let words = split_entity_words(canonical);  // ["foo", "bar"]
    
    // "foo bar" — space-separated lowercase
    forms.push(words.join(" "));
    // "Foo Bar" — title case
    forms.push(words.iter().map(|w| titlecase(w)).collect::<Vec<_>>().join(" "));
    // "foobar" — concatenated lowercase
    forms.push(words.join(""));
    // "FooBar" — PascalCase
    forms.push(words.iter().map(|w| titlecase(w)).collect::<Vec<_>>().join(""));
    // "foo-bar" — hyphenated (original tag form)
    forms.push(words.join("-"));
    // "foo_bar" — underscored
    forms.push(words.join("_"));
    
    // Deduplicate (some forms collapse for single-word entities)
    forms.sort();
    forms.dedup();
    forms
}

/// Split "foo-bar" → ["foo", "bar"], "FooBar" → ["Foo", "Bar"],
/// "machine_learning" → ["machine", "learning"]
fn split_entity_words(s: &str) -> Vec<String> {
    // Split on hyphens and underscores first
    let parts: Vec<&str> = s.split(|c: char| c == '-' || c == '_').collect();
    
    // Then split each part on camelCase boundaries
    parts.into_iter()
        .flat_map(|part| split_camel_case(part))
        .map(|w| w.to_lowercase())
        .filter(|w| !w.is_empty())
        .collect()
}
```

**Example: what gets generated for `#machine-learning`:**

| Surface form | Matches in text |
| --- | --- |
| `machine learning` | "I studied machine learning at MIT" |
| `Machine Learning` | "Machine Learning is transforming..." |
| `machinelearning` | "see #machinelearning" (informal) |
| `MachineLearning` | "the MachineLearning library" |
| `machine-learning` | "a machine-learning model" |
| `machine_learning` | "import machine_learning" |

**Example: what gets generated for `@JohnSmith`:**

| Surface form | Matches in text |
| --- | --- |
| `john smith` | "I met john smith yesterday" |
| `John Smith` | "John Smith presented the findings" |
| `johnsmith` | "email johnsmith@..." (filtered by boundary check) |
| `JohnSmith` | "cc @JohnSmith" (already tagged, skipped) |

**Dictionary structure:**

```rust
struct EntityDictionary {
    // Aho-Corasick automaton built from ALL surface forms of ALL entities
    automaton: AhoCorasick,
    // Map from surface form index → (entity_type, canonical_form)
    // Aho-Corasick returns pattern indices; this maps back to the entity
    pattern_map: Vec<EntityInfo>,
    // Normalization lookup for dedup: normalized_key → canonical_form
    norm_map: HashMap<String, String>,
}

fn build_entity_dictionary(conn: &Connection) -> EntityDictionary {
    let mut patterns: Vec<String> = Vec::new();
    let mut pattern_map: Vec<EntityInfo> = Vec::new();
    
    // Tags: "machine-learning" → generate all surface forms
    for tag in query_all_tag_names(conn) {
        for form in surface_forms(&tag) {
            patterns.push(form.clone());
            pattern_map.push(EntityInfo {
                entity_type: EntityType::Tag,
                canonical: format!("#{}", tag),  // e.g., "#machine-learning"
            });
        }
    }
    
    // Mentions: "JohnSmith" → generate all surface forms
    for mention in query_all_mention_names(conn) {
        for form in surface_forms(&mention) {
            patterns.push(form.clone());
            pattern_map.push(EntityInfo {
                entity_type: EntityType::Mention,
                canonical: format!("@{}", mention),
            });
        }
    }
    
    // File titles: "Transformer Architecture" → surface forms + the title itself
    for title in query_all_titles(conn) {
        patterns.push(title.clone());  // exact title match
        pattern_map.push(EntityInfo {
            entity_type: EntityType::Title,
            canonical: title.clone(),
        });
        // Also generate normalized forms if the title is multi-word
        if title.contains(' ') || title.contains('-') {
            for form in surface_forms(&title) {
                patterns.push(form.clone());
                pattern_map.push(EntityInfo {
                    entity_type: EntityType::Title,
                    canonical: title.clone(),
                });
            }
        }
    }
    
    // Build case-insensitive Aho-Corasick automaton
    let automaton = AhoCorasickBuilder::new()
        .ascii_case_insensitive(true)
        .build(&patterns)
        .unwrap();
    
    EntityDictionary { automaton, pattern_map, norm_map }
}
```

**Why Aho-Corasick?** The dictionary may have hundreds or thousands of patterns (especially with surface form expansion — 6x the entity count). Matching each one individually with regex would be O(n * m) per file. Aho-Corasick builds a finite automaton that matches all patterns in a single pass — O(n + matches), regardless of dictionary size. The `aho-corasick` crate is a Rust standard, already well-optimized, and supports case-insensitive matching natively.

**Multi-word matching is free with Aho-Corasick.** The automaton matches arbitrarily long patterns, not just single words. "machine learning" (with the space) is just another pattern in the automaton. The algorithm handles overlapping matches and longest-match disambiguation.

**Word boundary handling:**

After Aho-Corasick reports a match, validate word boundaries to avoid false positives:

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

This prevents "ML" from matching inside "HTML", and "john" from matching inside "johnson".

**Match deduplication:**

Multiple surface forms may match the same text span. "Foo Bar" matches both the "foo bar" pattern and the "Foo Bar" pattern for `#foo-bar`. Deduplicate by position: if two matches overlap, keep the longest one. If same length, prefer exact case match over case-insensitive.

**Case sensitivity:** All matching is case-insensitive via the Aho-Corasick `ascii_case_insensitive` flag. The canonical form is always preserved (e.g., `#machine-learning`, `@JohnSmith`).

#### Layer 2: Editor Decorations (TypeScript, runs on keystroke)

A new ProseMirror extension — `EntitySuggestion` — that decorates un-prefixed words (including multi-word phrases) matching the entity dictionary.

**The frontend can't use Aho-Corasick** (that's a Rust crate). Instead, it uses a different strategy: the backend provides pre-computed match results per file, and the editor also does lightweight live matching for the current document.

**Two matching strategies (choose based on phase):**

**Strategy A — Backend-computed suggestions (recommended for Phase E1):**

The Rust backend runs Aho-Corasick during reindexing and stores results in `suggested_entities`. The editor loads suggestions for the active file via a Tauri command and creates decorations from stored positions. This is the simplest approach — the editor just renders pre-computed data.

```typescript
// entity-suggestion.ts — backend-driven approach

interface EntitySuggestion {
  position: number;     // character offset in body text
  length: number;
  entityType: string;   // 'tag' | 'mention' | 'title'
  canonical: string;    // '#machine-learning', '@JohnSmith'
  status: string;       // 'suggested' | 'accepted' | 'dismissed'
}

// Loaded once on tab switch, refreshed on reindex
let suggestions: EntitySuggestion[] = [];

async function loadSuggestions(filePath: string) {
  suggestions = await invoke<EntitySuggestion[]>(
    'index_entity_suggestions', { path: filePath }
  );
}
```

The challenge is mapping byte offsets from the parser to ProseMirror positions. The existing tag/mention extraction already does this (the `position` field in `ExtractedTag`). The same offset-mapping logic applies.

**Strategy B — Frontend live matching (for real-time as-you-type):**

For instant feedback while typing (before the backend has reindexed), the frontend does its own matching using a normalized lookup map:

```typescript
// Normalized entity map: "foobar" → { type, canonical, surfaceForms }
// Built from backend dictionary, cached in memory
let entityNormMap: Map<string, EntityInfo> = new Map();

// All surface forms for fast text scanning
// Sorted longest-first so "machine learning" matches before "machine"
let surfaceForms: Array<{ form: string; normalized: string }> = [];

function normalize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function buildEntityDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  
  doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") return false;
    if (!node.isText || !node.text) return;
    if (node.marks.some(m => m.type.name === "code")) return;
    
    const text = node.text;
    const lowerText = text.toLowerCase();
    
    // Try each surface form against this text node
    // surfaceForms is sorted longest-first for greedy matching
    const matched: Array<{ from: number; to: number; info: EntityInfo }> = [];
    
    for (const { form, normalized } of surfaceForms) {
      const lowerForm = form.toLowerCase();
      let searchFrom = 0;
      
      while (searchFrom < lowerText.length) {
        const idx = lowerText.indexOf(lowerForm, searchFrom);
        if (idx === -1) break;
        
        const end = idx + form.length;
        
        // Word boundary check
        const beforeOk = idx === 0 || !/\w/.test(text[idx - 1]);
        const afterOk = end >= text.length || !/\w/.test(text[end]);
        
        if (beforeOk && afterOk) {
          const from = pos + idx;
          const to = pos + end;
          
          // Skip if inside existing #tag or @mention
          if (!isInsideTagOrMention(doc, from)) {
            const info = entityNormMap.get(normalized)!;
            matched.push({ from, to, info });
          }
        }
        searchFrom = idx + 1;
      }
    }
    
    // Deduplicate overlapping matches — keep longest
    const deduped = deduplicateOverlapping(matched);
    
    for (const { from, to, info } of deduped) {
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

function deduplicateOverlapping(
  matches: Array<{ from: number; to: number; info: EntityInfo }>
): Array<{ from: number; to: number; info: EntityInfo }> {
  // Sort by position, then longest first
  matches.sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from));
  
  const result: typeof matches = [];
  let lastEnd = -1;
  
  for (const m of matches) {
    if (m.from >= lastEnd) {
      result.push(m);
      lastEnd = m.to;
    }
  }
  return result;
}
```

**Performance considerations:**

With multi-word surface forms, the matching cost is higher than single-word `Set.has()`. For a dictionary of 200 entities with ~6 surface forms each (1,200 patterns) scanned against a 100KB document:

- Naive `indexOf` loop: ~1,200 scans per text node. With ~500 text nodes in a 100KB doc, that's 600K string searches. Too slow for every keystroke.
- **Optimization: only scan on idle.** Rebuild decorations via `requestIdleCallback` or after 300ms debounce, not on every `docChanged`. The user sees instant feedback for explicit `#tags` (existing `tag-highlight.ts` runs on every keystroke), and entity suggestions appear ~300ms later.
- **Optimization: incremental.** On `docChanged`, only re-scan text nodes in the changed range (ProseMirror's `tr.steps` tell you which positions were affected). Carry forward decorations for unchanged regions via `DecorationSet.map()`.
- **Optimization: short-circuit.** If the text node is shorter than the shortest surface form, skip it. If the dictionary is empty, the plugin is a no-op.
- **Strategy A avoids this entirely** — the backend does the heavy matching in Rust (Aho-Corasick, single-pass, fast), and the editor just renders stored positions. The only per-keystroke cost is re-mapping positions after edits, which ProseMirror's `DecorationSet.map(tr.mapping)` handles efficiently.

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
Example 1 — Tag matching with multi-word surface forms:

User writes: "We discussed machine learning approaches with the team"

Index knows: #machine-learning (8 files)

Surface forms generated: "machine learning", "Machine Learning",
                         "machinelearning", "MachineLearning",
                         "machine-learning", "machine_learning"

Editor shows: "We discussed machine learning approaches with the team"
                             ^^^^^^^^^^^^^^^^
                             (dotted underline — matches "machine learning")

User clicks "machine learning" → popover:
  [Tag it]     — replaces "machine learning" with "#machine-learning"
  [Link to: Machine Learning Overview.md]
  [Dismiss]    — hide this suggestion

User clicks "Tag it" → becomes "#machine-learning" → solid badge


Example 2 — Mention matching with first+last name:

User writes: "I need to follow up with Sarah Connor about the deadline"

Index knows: @SarahConnor (3 files), @sarah-connor (1 file)

Surface forms generated: "sarah connor", "Sarah Connor",
                         "sarahconnor", "SarahConnor"

Editor shows: "I need to follow up with Sarah Connor about the deadline"
                                        ^^^^^^^^^^^^
                                        (dotted underline)

User clicks "Sarah Connor" → popover:
  [Mention]    — replaces "Sarah Connor" with "@SarahConnor"
  [Dismiss]    — hide this suggestion


Example 3 — Variant detection across casing/formatting:

File A says: "The FooBar library is useful"
File B says: "I configured foo bar for the project"
File C says: "See docs on Foo-Bar integration"

All three normalize to "foobar". If #foo-bar exists as a tag:
  → All three occurrences get dotted underlines
  → Clicking any one offers to convert to "#foo-bar"

If #foo-bar does NOT exist yet (recurring word detection):
  → FTS5 vocab query finds "foobar" (normalized) appears in 3+ files
  → Suggestion: "This phrase appears in 3 files — create #foo-bar?"
```

### Recurring Word & Phrase Detection (New Entity Discovery)

Beyond matching against known entities, detect **new recurring words and phrases** that should become tags. This handles the case where "foo bar" / "FooBar" / "Foo Bar" appears across multiple files but nobody has created `#foo-bar` yet.

**Single-word detection via FTS5 vocabulary:**

SQLite's FTS5 already tokenizes and indexes all content. We can query term frequency:

```sql
-- Get terms that appear across many documents but aren't already tags
SELECT term, doc_count
FROM files_fts_vocab
WHERE doc_count >= 3
AND length(term) > 3
AND lower(term) NOT IN (SELECT DISTINCT lower(tag) FROM tags)
ORDER BY doc_count DESC;
```

This requires adding `files_fts_vocab` as an FTS5 vocabulary table:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts_vocab 
    USING fts5vocab(files_fts, instance);
```

This gives us cross-document single-word frequency for free — FTS5 already did the tokenization. But it only finds single tokens (porter-stemmed), not multi-word phrases.

**Multi-word phrase detection (bigrams/trigrams):**

FTS5 doesn't natively track multi-word phrases. To detect that "machine learning" (two words) recurs across files, we need an extraction step during indexing:

```rust
/// Extract significant bigrams and trigrams from body text.
/// Returns (normalized_phrase, original_form) pairs.
fn extract_phrases(body_text: &str) -> Vec<(String, String)> {
    let words: Vec<&str> = body_text.split_whitespace()
        .filter(|w| w.len() > 2)
        .filter(|w| !is_stop_word(w))
        .collect();
    
    let mut phrases = Vec::new();
    
    // Bigrams: "machine learning", "neural network", etc.
    for window in words.windows(2) {
        let original = format!("{} {}", window[0], window[1]);
        let normalized = normalize(&original);  // "machinelearning"
        if normalized.len() >= 6 {  // skip trivially short
            phrases.push((normalized, original));
        }
    }
    
    // Trigrams (optional, higher threshold): "large language model"
    for window in words.windows(3) {
        let original = format!("{} {} {}", window[0], window[1], window[2]);
        let normalized = normalize(&original);
        if normalized.len() >= 10 {
            phrases.push((normalized, original));
        }
    }
    
    phrases
}
```

**New schema for phrase frequency tracking:**

```sql
CREATE TABLE IF NOT EXISTS phrase_freq (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    normalized TEXT NOT NULL,       -- "machinelearning" (separator-stripped, lowered)
    example_form TEXT NOT NULL,     -- "machine learning" (one actual occurrence)
    file_count INTEGER DEFAULT 1,  -- number of distinct files containing this phrase
    UNIQUE(normalized)
);
CREATE INDEX IF NOT EXISTS idx_phrase_normalized ON phrase_freq(normalized);
```

During reindexing, for each file:
1. Extract bigrams/trigrams
2. For each normalized phrase, `INSERT OR UPDATE` incrementing `file_count`
3. On file delete/change, decrement counts (or rebuild periodically)

**Variant consolidation:**

The normalization function collapses all variants to a single key:

| Text occurrence | Normalized key | Same entity? |
| --- | --- | --- |
| "foo bar" | `foobar` | Yes |
| "Foo Bar" | `foobar` | Yes |
| "FooBar" | `foobar` | Yes |
| "foobar" | `foobar` | Yes |
| "foo-bar" | `foobar` | Yes |
| "FOO_BAR" | `foobar` | Yes |

So if "foo bar" appears in file A, "FooBar" in file B, and "Foo-Bar" in file C, the normalized key `foobar` has `file_count = 3`. This triggers the recurring entity suggestion.

**Query for candidates:**

```sql
-- Phrases appearing in 3+ files that don't match any existing tag
SELECT pf.normalized, pf.example_form, pf.file_count
FROM phrase_freq pf
WHERE pf.file_count >= 3
AND pf.normalized NOT IN (
    SELECT REPLACE(REPLACE(LOWER(tag), '-', ''), '_', '')
    FROM tags
)
ORDER BY pf.file_count DESC
LIMIT 50;
```

These appear with a different decoration style (e.g., dashed underline) and the popover says "This phrase appears in N files. Create tag `#foo-bar`?"

**Tag name suggestion:**

When the user accepts a recurring phrase as a new tag, suggest a canonical tag name by hyphenating the words: `normalize("FooBar") → split → ["foo", "bar"] → "#foo-bar"`. The user can edit before confirming.

**Name detection:**

The same mechanism detects recurring person names. If "John Smith", "john smith", and "John smith" appear across 3+ files, normalized key `johnsmith` has `file_count >= 3`. The suggestion becomes: "Create mention `@JohnSmith`?" — with the PascalCase form as the default canonical name.

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
| Surface form generation | <5ms for 500 entities | On dictionary rebuild | ~3000 patterns (6x expansion), done once |
| Editor decoration rebuild (Strategy A) | <1ms | On tab switch + `map()` per keystroke | Backend-computed positions, just render |
| Editor decoration rebuild (Strategy B) | <5ms for 100KB doc | Debounced 300ms | Multi-word `indexOf` scanning, idle-time only |
| Aho-Corasick match during reindex | <5ms per file | On file change | Single-pass, handles all surface forms |
| Phrase extraction (bigrams) | <2ms per file | On file change | Word splitting + normalization |
| Phrase frequency query | <50ms | On lint/manual trigger | Aggregate across all indexed files |
| FTS5 vocab query | <50ms | On lint/manual trigger | Single-word frequency |

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
