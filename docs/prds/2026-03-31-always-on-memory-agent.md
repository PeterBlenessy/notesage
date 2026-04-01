# Always-On Memory Agent

**Date:** 2026-03-31 **Status:** Draft **Origin:** Informed by [GoogleCloudPlatform/generative-ai/always-on-memory-agent](https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/agents/always-on-memory-agent), revised with competitive analysis and local-first architecture.

**Research:** [docs/research/2026-03-31-always-on-memory-agent.md](../research/2026-03-31-always-on-memory-agent.md)

## Problem

AI conversations in Notesage are ephemeral. Each chat session starts from zero context — the AI doesn't remember user preferences, past decisions, key facts, or accumulated project knowledge from prior interactions. Users must repeat context manually or rely on the limited chat history window.

Every major AI product now ships persistent memory: ChatGPT (2024), Claude (2025), Gemini (2025), Windsurf (2025). Memory has become table stakes. But all existing solutions share fundamental limitations:

1. **No project isolation** — ChatGPT, Claude, and Gemini memory is global. A consultant working on competing client projects cannot prevent cross-contamination.
2. **Provider lock-in** — ChatGPT memory only works in ChatGPT. Switch providers and your memory is gone.
3. **Black box** — Users can delete memories but can't read, edit, or audit what the AI actually knows in a structured way.
4. **Cloud dependency** — Memory capture and retrieval require an internet connection and send data to third-party servers.

Notesage's local-first architecture and multi-provider abstraction uniquely position it to offer memory that is private, portable, transparent, and provider-independent.

## Goals

1. **Your memory, your rules** — Per-project privacy scoping (global, project-isolated, or completely disabled). Confidential projects never leak into other contexts.

2. **Memory that works with any AI provider** — Memories persist across provider switches. Use Anthropic today, Ollama tomorrow, OpenAI next week — accumulated knowledge carries over.

3. **Memory you can read and edit** — Human-readable summary file (`.notesage/memory-summary.md`) alongside the database. Users can see, edit, and version-control what the AI knows.

4. **Memory that travels with your project** — Project-scoped memory lives in `.notesage/`, syncs with iCloud, moves when the project moves, can be shared with collaborators.

5. **Zero-cost, offline retrieval** — Local embedding model enables instant memory lookup without API calls. Memory works without an internet connection.

6. **Automatic capture with quality controls** — Key facts extracted from conversations and file saves, with deduplication, decay, and user feedback to maintain signal-to-noise ratio.

## Non-Goals

- **Multimodal ingestion** — Text only (markdown, chat messages). Media support deferred.
- **HTTP API** — Desktop app only; all access via Tauri IPC.
- **Real-time collaboration** — Memory is per-user, local-first.
- **Cross-project memory access** — Project-scoped memory is never readable by other projects.
- **Memory encryption at rest** — Users handling classified material should use OS-level disk encryption (FileVault). In-app encryption deferred.
- **Replacing the document index** — Memory complements the existing SQLite document index, doesn't replace it. The index provides structure-aware search (tags, mentions, tasks); memory provides learned facts and preferences.
- **Import from other AI products** — ChatGPT/Claude/Gemini memory import deferred (potential future feature following Gemini's lead).

## User Stories

1. **As a consultant**, I want to completely disable memory for a confidential client project, so that no information from that project is ever captured or surfaced in other contexts.

2. **As a user who switches AI providers**, I want my accumulated knowledge to persist when I change from Anthropic to OpenAI to Ollama, so that I don't lose context.

3. **As a privacy-conscious user**, I want to open a file and read exactly what the AI remembers about me and my projects, so that there are no hidden inferences.

4. **As a user**, I want the AI to remember key decisions from past conversations without me repeating them, so that every new chat session builds on previous work.

5. **As a user**, I want to tell the AI to "remember this" or "forget that" during conversation, with those changes taking effect immediately.

6. **As a user working on a confidential project**, I want project-scoped memory that stays isolated within that project and travels with the project folder if I move or share it.

7. **As a user on a metered API plan**, I want memory to work without additional API costs for retrieval, so that I'm not paying per-memory-lookup.

8. **As an offline user**, I want memory retrieval to work without an internet connection, so that accumulated knowledge is always available.

9. **As a user**, I want to control whether memories from other projects appear when I'm working in a specific project, so that I can maintain strict information boundaries.

10. **As a user**, I want stale or contradicted memories to be detected and cleaned up, so that the AI doesn't act on outdated information.

## Technical Approach

### Architecture Overview

Three-tier hybrid architecture: fast local retrieval, local LLM extraction, and optional cloud consolidation.

| Tier | Operations | Model | Latency | Cost |
| --- | --- | --- | --- | --- |
| **1: Math-only** | Embedding, similarity search, FTS5, dedup | Bundled embedding model (in-process) | <30ms | $0 |
| **2: Local LLM** | Extraction, summarization, simple consolidation | Shared llama-server / Ollama / any local model | 1-3s | $0 |
| **3: Best available** | Deep consolidation, contradiction detection, insight synthesis | User's configured provider (cloud or large local) | 5-30s | Variable |

**Key design decision — local embedding retrieval, not LLM-based retrieval:**

The original Google reference implementation uses the LLM to read all memories and rank them on every query. This doesn't scale: it's expensive (doubles per-message API cost), slow (adds 1-3s latency before every response), and fails offline. Every competitor using cloud memory has this limitation.

Notesage uses local vector embeddings + FTS5 for retrieval instead. This makes retrieval instant (<30ms), free, and offline-capable. LLMs are only used for ingestion (extracting structure from text) and consolidation (finding connections) — operations that happen infrequently and can tolerate latency.

**Honest trade-off:** Cloud models (Claude, GPT-4o) will extract higher-quality memories than local 1-3B models. Consolidation from a small local model will produce more generic insights than a frontier model. The quality gap is real, but the privacy/portability/cost benefits outweigh it for Notesage's target users.

### Data Flow

```
INGEST (on chat completion or file save):
  Text
  → Tier 1: compute embedding (bundled model, in-process, <10ms)
  → Tier 1: dedup check — cosine similarity against existing embeddings (<5ms)
  → If duplicate (>0.95 similarity): merge/skip, done
  → Tier 2: extract summary + entities + topics + type + importance (local LLM, 1-3s)
  → Store: SQLite row + embedding vector
  → Append to memory-summary.md

RETRIEVE (on every chat message, before system prompt):
  Query text
  → Tier 1: compute query embedding (<10ms)
  → Tier 1: vector cosine similarity top-20 + FTS5 keyword top-20 (<20ms)
  → Merge, rank by combined score + recency decay + importance (<1ms)
  → Inject top-N into system prompt (within token budget)
  Total: ~30ms, no API call, works offline

CONSOLIDATE (idle/scheduled, background):
  → Load unconsolidated memories
  → Tier 2 or 3: detect contradictions, merge duplicates, decay stale entries
  → Tier 3 (optional): synthesize cross-cutting insights
  → Regenerate memory-summary.md
  → Runs during idle time on shared llama-server or cloud provider
```

### Embedding Model

**Model:** `all-MiniLM-L6-v2` (Microsoft, via Sentence Transformers)

- **Size:** ~23MB (quantized INT8 ONNX)
- **Download:** Hugging Face direct HTTPS — no API key needed (same pattern as Whisper model downloads)
- **Storage:** `~/.notesage/models/embedding/all-MiniLM-L6-v2.onnx`
- **Runtime:** ONNX Runtime via `ort` Rust crate, in-process (no server needed)
- **Performance:** <10ms per embedding on Apple Silicon
- **Context:** 512 tokens per chunk (sufficient for memory summaries)
- **Trigger:** Downloaded on first memory enable, with progress bar (matches Whisper model UX)

**Alternatives for future consideration:**

- `nomic-embed-text-v1.5` (137MB, Apache 2.0, 8K context) — if longer context needed
- Ollama `nomic-embed-text` — if user already has Ollama, avoid bundling a separate model

### Per-Project Memory Isolation

Each project independently controls its memory behavior via `.notesage/project.json`. **This is the primary differentiator** — no competitor offers this granularity.

**Three memory modes:**

| Mode | `memory.scope` | Capture | Recall | Consolidation | Storage |
| --- | --- | --- | --- | --- | --- |
| **Global** (default) | `"global"` | Facts → `~/.notesage/memory.db` | Global + project memories surfaced | Global consolidation includes this project | `~/.notesage/memory.db` |
| **Project-scoped** | `"project"` | Facts → `.notesage/memory.db` | Only this project's memories | Isolated consolidation | `.notesage/memory.db` |
| **Disabled** | `"none"` | No capture | No recall | No consolidation | No DB created |

**Project metadata extension** (`.notesage/project.json`):

```typescript
interface ProjectMetadata {
  version: 1;
  name: string;
  description: string;
  ai: { /* existing */ };
  memory?: {
    scope: 'global' | 'project' | 'none';  // default: 'global'
    recall: boolean;                         // default: true — when false, global memories hidden
  };
}
```

**Enforcement rules:**

1. `scope: "none"` — All memory operations are no-ops. `memory_ingest` rejects calls. `memory_get_context` returns empty. Consolidation skips. Remember/recall/forget skills hidden. No `.notesage/memory.db` created.

2. `scope: "project"` — Separate SQLite DB at `<project>/.notesage/memory.db`. Never read by other projects. Global consolidation ignores it. Travels with the project folder.

3. `recall: false` (independent of scope) — Global memories NOT injected into this project's AI context. Useful for projects that should contribute to global knowledge but not be influenced by external memories.

**Cross-contamination prevention:**

- `memory_ingest` checks project settings BEFORE processing
- `memory_get_context` scopes queries based on active project settings
- `memory_consolidate` processes each DB independently — global never reads project-scoped, project never reads global
- Multi-project chat context: disabled projects contribute zero memories

### Memory Types

Memories are categorized by type, affecting retrieval priority and decay rate:

| Type | Examples | Decay Rate | Retrieval Priority |
| --- | --- | --- | --- |
| `preference` | "User prefers TypeScript" | Very slow | High (always relevant) |
| `decision` | "Chose PostgreSQL for project X" | Slow | High (project-scoped) |
| `fact` | "API endpoint is /api/v2" | Fast (may become stale) | Medium |
| `relationship` | "Alice is tech lead on Y" | Medium | Medium |
| `procedure` | "Deploy: run X then Y" | Slow | High (when relevant) |
| `insight` | Consolidation-generated connections | Slow | Low (supplementary) |

### Human-Readable Memory Layer

Alongside the SQLite database, maintain a `.notesage/memory-summary.md` file:

```markdown
# Memory Summary

Last updated: 2026-03-31T14:30:00Z
Total memories: 47 | Active: 42 | Archived: 5

## Preferences
- Prefers TypeScript with strict mode (from chat, 2026-03-15)
- Uses pnpm over npm (from chat, 2026-03-20)

## Decisions
- Chose PostgreSQL for the API backend (from chat, 2026-03-10)
- Using Tailwind v4, not CSS modules (from file: architecture.md, 2026-03-12)

## Key Facts
- API runs on port 3001 in development (from file: .env.example, 2026-03-25)
```

**Sync behavior:**

- Auto-generated after every consolidation run
- User edits to this file detected via file watcher and synced back to SQLite on next load
- If both DB and file change, DB wins for entries it tracks; new entries in the file are ingested

### Storage Schema

SQLite database at `~/.notesage/memory.db` (global) or `.notesage/memory.db` (project-scoped).

```sql
CREATE TABLE memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_type TEXT NOT NULL,         -- 'preference', 'decision', 'fact', 'relationship', 'procedure', 'insight'
    source TEXT NOT NULL,              -- 'chat', 'file_save', 'manual', 'consolidation'
    source_ref TEXT,                   -- conversation ID, file path, or parent memory IDs
    raw_input TEXT NOT NULL,           -- original text that was ingested
    summary TEXT NOT NULL,             -- 1-2 sentence AI-generated summary
    entities TEXT DEFAULT '[]',        -- JSON array of extracted entities
    topics TEXT DEFAULT '[]',          -- JSON array of topic tags
    importance REAL DEFAULT 0.5,       -- 0.0-1.0 AI-scored importance
    decay_score REAL DEFAULT 1.0,      -- recency * importance, updated on access
    embedding BLOB,                    -- float32 vector (~1.5KB), from embedding model
    embedding_model TEXT,              -- model that generated the embedding
    created_at TEXT NOT NULL,          -- ISO 8601
    last_accessed_at TEXT,             -- updated on retrieval hit
    access_count INTEGER DEFAULT 0,    -- how many times retrieved
    is_consolidated INTEGER DEFAULT 0,
    is_archived INTEGER DEFAULT 0,     -- soft delete / decayed below threshold
    project_path TEXT,                 -- NULL for global memories
    user_rating INTEGER               -- +1 (helpful) / -1 (unhelpful) / NULL
);

CREATE TABLE consolidations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_memory_ids TEXT NOT NULL,    -- JSON array of memory IDs
    summary TEXT NOT NULL,
    insights TEXT DEFAULT '[]',
    connections TEXT DEFAULT '[]',      -- JSON array of {from_id, to_id, relationship}
    contradictions_resolved TEXT DEFAULT '[]', -- JSON array of {old_id, new_id, reason}
    created_at TEXT NOT NULL
);

CREATE TABLE processed_files (
    path TEXT PRIMARY KEY,
    processed_at TEXT NOT NULL,
    content_hash TEXT NOT NULL          -- SHA-256 for change detection
);

-- Indexes for fast retrieval
CREATE INDEX idx_memories_active ON memories(is_archived, project_path);
CREATE INDEX idx_memories_type ON memories(memory_type);
```

At ~1.5KB per embedding, 10,000 memories = 15MB. Well within local storage budget.

### Rust Backend

**New module:** `src-tauri/src/memory/`

```
src-tauri/src/memory/
├── mod.rs          -- MemoryState, init, shutdown
├── db.rs           -- Schema, migrations, connection management
├── ingest.rs       -- Extraction pipeline (embedding + LLM summary)
├── retrieve.rs     -- Vector search + FTS5 + ranking
├── consolidate.rs  -- Background consolidation + contradiction detection
├── embedding.rs    -- ONNX Runtime embedding model (in-process)
├── summary_file.rs -- memory-summary.md generation and sync
└── decay.rs        -- Importance decay, archival
```

**Managed State:**

```rust
pub struct MemoryState {
    global_db: Mutex<Option<Connection>>,
    project_dbs: Mutex<HashMap<PathBuf, Connection>>,
    embedding_model: Mutex<Option<EmbeddingModel>>,  // ONNX in-process
    consolidation_handle: Mutex<Option<JoinHandle<()>>>,
}

pub struct EmbeddingModel {
    session: ort::Session,
    tokenizer: tokenizers::Tokenizer,
}
```

**Tauri Commands:**

| Command | Purpose | Tier |
| --- | --- | --- |
| `memory_init(project_path?)` | Initialize DB, load embedding model | 1 |
| `memory_shutdown()` | Stop timers, close DBs | — |
| `memory_ingest(text, source, source_ref?, project_path?, provider?, connection_id?)` | Extract + embed + store | 1+2 |
| `memory_retrieve(query, project_path?, limit?)` | Vector + FTS5 search, ranked results | 1 only |
| `memory_get_context(project_path?, max_tokens?)` | Build system prompt context string | 1 only |
| `memory_consolidate(project_path?, provider?, connection_id?)` | Trigger consolidation | 2/3 |
| `memory_list(project_path?, offset, limit, type_filter?)` | Paginated listing | — |
| `memory_delete(id, project_path?)` | Delete a memory | — |
| `memory_rate(id, project_path?, rating)` | +1/-1 user feedback | — |
| `memory_clear(project_path?)` | Clear all memories | — |
| `memory_stats(project_path?)` | Counts, last consolidation, token estimate | — |
| `memory_export(project_path?, format)` | Export as JSON or Markdown | — |
| `memory_download_embedding_model()` | Download model from HF | — |
| `memory_embedding_model_status()` | Check if model is ready | — |

**Retrieval algorithm (Tier 1 only — no LLM call):**

```rust
fn retrieve(query: &str, db: &Connection, model: &EmbeddingModel, limit: usize) -> Vec<MemoryResult> {
    let query_embedding = model.embed(query);

    // Vector similarity (cosine distance on all non-archived memories)
    let vector_results = db.query(
        "SELECT id, summary, embedding, decay_score FROM memories WHERE is_archived = 0",
    ).map(|row| {
        let similarity = cosine_similarity(&query_embedding, &row.embedding);
        (row.id, similarity * row.decay_score)
    }).top_n(20);

    // FTS5 keyword search
    let fts_results = db.query(
        "SELECT id, rank FROM memories_fts WHERE memories_fts MATCH ?",
        [query]
    ).top_n(20);

    // Merge and re-rank by combined score
    merge_ranked(vector_results, fts_results, limit)
}
```

### Resource Management (Local LLM)

Memory operations share the local LLM infrastructure without interfering with chat:

**Piggybacking (default):** Extraction requests use whatever model is currently loaded on llama-server. Memory ops run between user messages using the same model. Zero additional RAM.

**Idle processing:** When the user hasn't sent a chat message for 5+ minutes, process queued ingestions and run consolidation if due.

**Ollama advantage:** Users with Ollama can run the embedding model and a small extraction model concurrently without conflicting with their chat model.

**Graceful degradation:**

- No local model available → ingestion queued, or use cloud provider if configured
- No embedding model downloaded → memory disabled, prompt to download
- No AI provider at all → manual-only memory (user types facts via `remember` skill, stored with user-provided summary, no AI extraction)

### Frontend

**`src/stores/memory-store.ts`** — Zustand store:

```typescript
interface MemoryStore {
  // Settings (persisted)
  enabled: boolean;
  autoIngestChat: boolean;
  autoIngestFiles: boolean;
  consolidationMode: 'manual' | 'idle' | 'scheduled';
  consolidationIntervalMinutes: number;
  maxContextTokens: number;

  // Runtime state (not persisted)
  embeddingModelDownloaded: boolean;
  embeddingModelDownloading: boolean;
  stats: MemoryStats | null;
  memories: MemoryEntry[];
  isIngesting: boolean;
  isConsolidating: boolean;
}
```

**`src/hooks/useMemoryOperations.ts`** — Orchestration:

- `ingestFromChat(conversationId)` — after conversation turn, if enabled and project allows
- `ingestFromFile(filePath, content)` — after file save, if enabled and project allows
- `getMemoryContext()` — called during system prompt composition (Tier 1 only, fast)
- `queryMemory(question)` — explicit user query with citations
- `rateMemory(id, rating)` — thumbs up/down feedback

**Integration points:**

1. **System prompt** — `useAIContext.buildComposedSystemMessage()`: inject memory context with token budget
2. **Chat auto-ingest** — `useDirectApiChat.ts`: after assistant response completes, queue ingest
3. **File auto-ingest** — `useFileOperations.ts`: after save, queue ingest
4. **Project metadata** — `project-metadata-store.ts`: memory scope/recall settings

### Token Budget

Memory context competes with other system prompt sections. Explicit budgeting prevents crowding:

| Section | Default Budget | Configurable |
| --- | --- | --- |
| Agent body | Unlimited (agent-defined) | No |
| Project context | ~300 tokens | No |
| Goals | ~200 tokens | No |
| File tree | ~500 tokens | No |
| Current file info | ~100 tokens | No |
| Agent instructions | ~500 tokens | No |
| **Memory context** | **500 tokens** | **Yes (100-2000)** |
| Skill descriptions | Variable | No |

Memory context formatted as concise bullet list, prioritized by retrieval score:

```
## Remembered Context
- User prefers TypeScript with strict mode [preference, high confidence]
- Project uses PostgreSQL, chosen over MySQL for JSON support [decision, project-scoped]
- API server runs on port 3001 in development [fact, recent]
```

### Bundled Agent & Skills

**`bundled-agents/memory-assistant.md`:**

```yaml
---
name: memory-assistant
description: AI assistant with persistent memory — remembers past conversations and project knowledge
icon: brain
allowed-tools:
  - remember
  - recall
  - forget
---

You are a memory-aware assistant with access to a persistent memory system.

When the user shares important information, use the `remember` skill to store it.
When answering questions, use the `recall` skill to check your memory first.
When the user asks you to forget something, use the `forget` skill.

Always cite which memory a fact came from when using recalled information.
```

**Bundled skills:** `remember/`, `recall/`, `forget/` in `bundled-skills/`.

## UI/UX

### Memory Settings (Settings Dialog > new "Memory" tab)

- **Enable Memory** toggle (default: off)
  - On first enable: triggers embedding model download with progress bar
- **Auto-ingest chat conversations** toggle (default: on when memory enabled)
- **Auto-ingest file saves** toggle (default: off — can be noisy)
- **Consolidation mode** — Manual only / On idle / Scheduled (with interval slider: 1-24 hours)
- **Context token budget** — slider (100-2000 tokens, default 500)
- **Memory stats** — total memories by type, last consolidated, estimated token usage
- **"View all memories"** — opens memory browser
- **"Export memories"** — JSON or Markdown
- **"Clear all memories"** — destructive, with confirmation

### Project Memory Settings

In Project Settings (sidebar cog icon or Settings > Project):

- **Memory scope** — segmented control: Off / Project only / Global
- **Recall toggle** — "Show memories from other projects" (visible when scope is project or global)
- Brief explanation text for each mode:
  - Off: *"No conversations or files in this project will be remembered. Memories from other projects will not appear."*
  - Project only: *"The AI remembers things within this project but doesn't share them with other projects."*
  - Global: *"Memories are shared across all projects."*

### Status Bar Indicator

- `Brain` icon when memory is enabled
- Subtle animation during ingestion
- Click opens popover: quick stats, "View memories" link, "Consolidate now" button

### Memory Browser (Dialog)

- Scrollable list with:
  - Summary text
  - Type badge (preference/decision/fact/relationship/procedure/insight)
  - Source badge (chat/file/manual)
  - Topic pills
  - Recency/importance indicator
  - Thumbs up/down buttons
  - Delete button
- Search/filter bar (keyword + type filter)
- Consolidation history tab

### Chat Integration

- "Memory active" indicator in chat footer when enabled
- Memory context injected silently into system prompt
- When AI cites a memory, show as hoverable reference with source info
- Thumbs up/down on cited memories in responses

## Data Model

### TypeScript Interfaces

```typescript
interface MemoryEntry {
  id: number;
  memoryType: 'preference' | 'decision' | 'fact' | 'relationship' | 'procedure' | 'insight';
  source: 'chat' | 'file_save' | 'manual' | 'consolidation';
  sourceRef?: string;
  rawInput: string;
  summary: string;
  entities: string[];
  topics: string[];
  importance: number;
  decayScore: number;
  createdAt: string;
  lastAccessedAt?: string;
  accessCount: number;
  isConsolidated: boolean;
  isArchived: boolean;
  projectPath?: string;
  userRating?: number;
}

interface ConsolidationEntry {
  id: number;
  sourceMemoryIds: number[];
  summary: string;
  insights: string[];
  connections: MemoryConnection[];
  contradictionsResolved: ContradictionResolution[];
  createdAt: string;
}

interface MemoryConnection {
  fromId: number;
  toId: number;
  relationship: string;
}

interface ContradictionResolution {
  oldId: number;
  newId: number;
  reason: string;
}

interface MemoryStats {
  totalMemories: number;
  activeMemories: number;
  archivedMemories: number;
  totalConsolidations: number;
  unconsolidatedCount: number;
  lastConsolidatedAt?: string;
  byType: Record<string, number>;
  estimatedContextTokens: number;
}
```

## Dependencies

### New Rust Dependencies

| Crate | Purpose | Size Impact |
| --- | --- | --- |
| `ort` | ONNX Runtime for in-process embedding inference | ~15MB (dynamic lib) |
| `tokenizers` | HuggingFace tokenizer for embedding model input | ~2MB |

`rusqlite` and `sha2` already in dependency tree (document index).

### Downloadable Assets

| Asset | Size | When |
| --- | --- | --- |
| `all-MiniLM-L6-v2.onnx` | ~23MB | On first memory enable (user-triggered download) |

### No New Frontend Dependencies

All UI built with existing shadcn/ui components.

## Quality Gates

### Functional

- [ ] Embedding model downloads on first enable with progress bar
- [ ] Memory DB created at correct location based on project scope
- [ ] Manual ingest (`/remember "fact"`) stores with summary, entities, topics, type, embedding
- [ ] Chat auto-ingest captures key facts after conversation turn
- [ ] File save auto-ingest captures document summary (when enabled)
- [ ] Deduplication prevents near-identical memories at ingest time (embedding similarity >0.95)
- [ ] Retrieval returns relevant memories via vector + FTS5 search in <50ms
- [ ] Memory context appears in AI system prompt within token budget
- [ ] AI responses demonstrate awareness of previously stored facts
- [ ] Memory works with all provider paths: Anthropic, OpenAI, Ollama, local bundled, ACP
- [ ] Memory persists across app restarts and provider switches
- [ ] Memory retrieval works offline (no API call required)
- [ ] memory-summary.md generated and kept in sync with DB
- [ ] User edits to memory-summary.md detected and synced back
- [ ] Thumbs up/down feedback updates retrieval priority
- [ ] Consolidation detects contradictions, merges duplicates, decays stale entries
- [ ] Decay mechanism archives old low-importance memories
- [ ] No performance degradation — ingestion is async, retrieval is <50ms

### Per-Project Privacy

- [ ] Project `scope: "none"` — zero memories captured, recalled, or consolidated
- [ ] Project `scope: "none"` — no `.notesage/memory.db` created
- [ ] Project `scope: "none"` — remember/recall/forget skills hidden
- [ ] Project `scope: "project"` — memories in `.notesage/memory.db`, not global
- [ ] Project `scope: "project"` — memories never appear in other projects
- [ ] Project `scope: "project"` — global consolidation ignores this project
- [ ] Project `recall: false` — global memories excluded from context
- [ ] Multi-project chat — disabled projects contribute zero memories
- [ ] Memory settings in `.notesage/project.json` travel with the project

### Design

- [ ] Settings tab follows existing dialog patterns
- [ ] Memory browser follows shadcn/ui dialog patterns
- [ ] Status bar indicator is subtle and consistent
- [ ] All states handled: empty, downloading model, loading, error
- [ ] Works in both light and dark mode
- [ ] No chromatic accent colors — uses neutral palette

## Out of Scope

- **Multimodal ingestion** — Text only for now
- **Cross-device sync** — iCloud sync of `.notesage/memory.db` may work but is not tested
- **Memory sharing between users** — No import/export between users (backup export is in scope)
- **Memory encryption at rest** — Rely on OS-level disk encryption
- **Audit logging** — No compliance access log
- **Import from other AI products** — ChatGPT/Claude/Gemini memory import deferred
- **ACP agent memory routing** — Memory tools for ACP agents deferred
- **Cross-project memory merging** — Deliberate separation, no merge capability

## Implementation Priority

| Priority | Scope | What |
| --- | --- | --- |
| **P0** | Core | Embedding model download, SQLite schema, ingest + retrieve (Tier 1+2), system prompt injection, per-project scoping, settings tab |
| **P1** | Usability | Memory browser, bundled skills (remember/recall/forget), memory-summary.md, dedup at ingest |
| **P2** | Quality | Consolidation with contradiction detection, memory types, decay/archival, user feedback (thumbs), token budget UI |
| **P3** | Polish | Export, idle-mode consolidation, Ollama embedding fallback, consolidation changelog |
