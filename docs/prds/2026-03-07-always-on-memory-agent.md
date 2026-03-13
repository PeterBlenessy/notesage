# Always-On Memory Agent

**Date:** 2026-03-07 **Status:** Draft **Origin:** Port of [GoogleCloudPlatform/generative-ai/always-on-memory-agent](https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/agents/always-on-memory-agent)

## Problem

AI conversations in Notesage are ephemeral. Each chat session starts from zero context — the AI doesn't remember user preferences, past decisions, key facts, or accumulated project knowledge from prior interactions. Users must repeat context manually or rely on the limited chat history window.

The Google Cloud "always-on-memory-agent" demonstrates a compelling architecture: ingest information, consolidate it on a background schedule (mirroring human sleep-based memory processing), and query it on demand with citations. This pattern maps naturally onto Notesage's existing infrastructure and would significantly enhance the AI collaboration experience.

**Why now:** Notesage already has the foundational pieces — multi-provider AI abstraction, Zustand persistence, Tauri IPC, agent/skill system, and background task infrastructure. The memory layer is the missing piece that turns Notesage from a stateless AI tool into a knowledge-aware assistant.

## Goals

1. **Persistent AI memory** — Information learned in one conversation is available in all future conversations, surviving app restarts

2. **Automatic ingestion** — Key facts captured from chat conversations and file saves without user effort

3. **Background consolidation** — Periodic review of memories to find connections, compress related facts, and generate cross-cutting insights

4. **On-demand recall** — Users and AI can query memories with source citations (which conversation/file the fact came from)

5. **Provider-agnostic** — Works with any configured AI provider (Anthropic, OpenAI, Ollama, ACP agents), not locked to Gemini

6. **Per-project privacy boundaries** — Confidential projects can fully opt out of memory (no capture, no recall, no cross-contamination), with project-scoped isolation for projects that want memory internally but not globally

## Non-Goals

- **Multimodal ingestion** — The original supports images/audio/video. Notesage is a text editor; we only ingest text (markdown, chat messages). Media support deferred.
- **HTTP API** — The original runs as a web server. Notesage is a desktop app; all access via Tauri IPC.
- **Streamlit dashboard** — Replaced by native React UI integrated into the existing settings/panel system.
- **Vector embeddings or RAG** — Following the original's design, we use the LLM itself to read, summarize, and connect memories. No embedding model or vector DB.
- **Real-time collaboration** — Memory is per-user, local-first. Shared memory across users is out of scope.
- **Automatic AI response injection** — Memory context is injected into the system prompt, but the system does NOT automatically answer questions from memory without the AI provider being involved.
- **Cross-project memory access** — A project-scoped memory DB is never readable by other projects. No "merge" or "share" between project memory stores.

## User Stories

 1. **As a user**, I want the AI to remember key decisions I've made across conversations, so that I don't have to re-explain project context every time I start a new chat.

 2. **As a user**, I want to explicitly tell the AI to "remember this" during a conversation, so that important facts are captured for future reference.

 3. **As a user**, I want to view, search, and delete stored memories, so that I can manage what the AI knows about me and my projects.

 4. **As a user**, I want memories consolidated automatically in the background, so that connections between related facts are discovered without manual effort.

 5. **As a user**, I want to ask "what do you know about X?" and get answers with citations back to source conversations, so that I can trace where information came from.

 6. **As a user**, I want memory to be opt-in and per-project configurable, so that sensitive projects can opt out entirely.

 7. **As a user working on confidential client projects**, I want to completely disable memory for specific projects, so that no information from those projects is ever captured, stored, recalled, or leaked into other conversations.

 8. **As a user**, I want a middle ground where a project has its own private memory (the AI remembers things within that project but doesn't share them globally), so that I get the benefit of persistent context without cross-project contamination.

 9. **As a user**, I want to control whether global memories (from other projects) are surfaced when I'm working in a specific project, so that I can keep a strict information boundary for sensitive work.

10. **As a user**, I want the memory privacy settings to be stored in the project's `.notesage/` directory, so that when I share a project folder with collaborators or sync it, the privacy intent travels with the project.

## Technical Approach

### Architecture Overview

The original Python system has 4 agents (IngestAgent, ConsolidateAgent, QueryAgent, Orchestrator) communicating via Google ADK. In Notesage, these become:

| Original | Notesage Implementation |
| --- | --- |
| IngestAgent | Rust module `memory::ingest` — extracts structured data from text via AI provider |
| ConsolidateAgent | Rust module `memory::consolidate` — tokio interval timer triggers AI-driven consolidation |
| QueryAgent | Rust module `memory::query` — searches memories and builds context for AI system prompt |
| Orchestrator | Frontend routing in `useMemoryOperations` hook — no separate agent needed |
| SQLite (Python) | `rusqlite` in Rust backend — same 3-table schema |
| Google ADK | Existing `AIProvider` abstraction via `ai_generate_text` Tauri command |

### Per-Project Memory Isolation

Each project can independently control its memory behavior via settings stored in `.notesage/project.json`. This is critical for users handling confidential client work where information must never leak between projects.

**Three memory modes per project:**

| Mode | `memory.scope` | Ingestion | Recall | Consolidation | DB location |
| --- | --- | --- | --- | --- | --- |
| **Global** (default) | `"global"` | Facts stored in `~/.notesage/memory.db` | Global + project memories surfaced | Global consolidation includes this project's memories | `~/.notesage/memory.db` |
| **Project-scoped** | `"project"` | Facts stored in `.notesage/memory.db` inside project | Only this project's memories surfaced, global memories excluded | Consolidation runs only on this project's memories, isolated | `.notesage/memory.db` |
| **Disabled** | `"none"` | No memories captured from any conversation or file save | No memories surfaced in AI context | No consolidation | No DB created |

**Project metadata extension** (`.notesage/project.json`):

```typescript
interface ProjectMetadata {
  version: 1;
  name: string;
  description: string;
  ai: { /* existing */ };
  memory?: {
    scope: 'global' | 'project' | 'none';  // default: 'global'
    recall: boolean;                         // default: true — when false, even global memories are hidden in this project
  };
}
```

**Enforcement rules:**

1. `scope: "none"` — All memory operations are no-ops for this project. `memory_ingest` rejects calls with this project path. `memory_get_context` returns empty string. Consolidation timer skips this project. The `remember` / `recall` / `forget` skills are hidden from the agent when this project is active. No `.notesage/memory.db` is created.

2. `scope: "project"` — A separate SQLite database lives at `<project>/.notesage/memory.db`. This DB is never read by other projects. Global consolidation ignores it. When building AI context, only this project's DB is queried. If the project folder is deleted, shared, or moved, its memory goes with it.

3. `recall: false` (independent of scope) — Even if the global DB has relevant memories, they are NOT injected into this project's AI system prompt. Useful for projects where you want the AI to learn (scope: global) but not be influenced by memories from other projects.

**Cross-contamination prevention:**

- `memory_ingest` checks project memory settings BEFORE processing. If disabled, returns early with no side effects.
- `memory_get_context` scopes its query based on the active project's settings. For `scope: "project"`, it ONLY reads `<project>/.notesage/memory.db`. For `scope: "none"`, it returns `""`.
- `memory_consolidate` processes each DB independently. Global consolidation never reads project-scoped DBs. Project consolidation never reads the global DB.
- The background consolidation timer maintains a list of active project DBs and their scopes. Disabled projects are skipped entirely.
- When multiple projects are selected in the chat footer's project context, each project's memory settings are respected independently — a disabled project contributes no memories even if other selected projects have memory enabled.

**UI surface:**

- Project Settings (sidebar cog icon or Settings &gt; Project) gains a "Memory" section
- Toggle with three states: "Off", "Project only", "Global" (segmented control)
- When "Off" is selected, a brief explanation: *"No conversations or files in this project will be remembered. Memories from other projects will not appear in this project's AI context."*
- When "Project only" is selected: *"The AI remembers things within this project but doesn't share them with other projects."*
- Recall toggle (checkbox): *"Show memories from other projects"* — only visible when scope is `"project"` or `"global"`

### Storage

SQLite database stored at:

- **Global:** `~/.notesage/memory.db` — cross-project memories
- **Per-project:** `.notesage/memory.db` — project-scoped memories (only created when `scope: "project"`)

Three tables, adapted from the original:

```sql
CREATE TABLE memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,          -- 'chat', 'file_save', 'manual', 'consolidation'
    source_ref TEXT,               -- conversation ID, file path, or parent memory IDs
    raw_input TEXT NOT NULL,       -- original text that was ingested
    summary TEXT NOT NULL,         -- 1-2 sentence AI-generated summary
    entities TEXT DEFAULT '[]',    -- JSON array of extracted entities
    topics TEXT DEFAULT '[]',      -- JSON array of topic tags
    importance REAL DEFAULT 0.5,   -- 0.0-1.0 AI-scored importance
    created_at TEXT NOT NULL,      -- ISO 8601 timestamp
    is_consolidated INTEGER DEFAULT 0,
    project_path TEXT              -- NULL for global memories
);

CREATE TABLE consolidations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_memory_ids TEXT NOT NULL, -- JSON array of memory IDs that were consolidated
    summary TEXT NOT NULL,           -- synthesized summary
    insights TEXT DEFAULT '[]',      -- JSON array of discovered insights
    connections TEXT DEFAULT '[]',   -- JSON array of {from_id, to_id, relationship}
    created_at TEXT NOT NULL
);

CREATE TABLE processed_files (
    path TEXT PRIMARY KEY,
    processed_at TEXT NOT NULL,
    content_hash TEXT NOT NULL      -- detect changes for re-processing
);
```

### Rust Backend (`src-tauri/src/commands/memory.rs` + `src-tauri/src/memory/`)

**Managed State:**

```rust
pub struct MemoryState {
    global_db: Mutex<Option<Connection>>,
    project_dbs: Mutex<HashMap<PathBuf, Connection>>,
    consolidation_handle: Mutex<Option<JoinHandle<()>>>,
}
```

**Tauri Commands:**

| Command | Purpose |
| --- | --- |
| `memory_init(project_path: Option<String>)` | Initialize DB, start consolidation timer |
| `memory_shutdown()` | Stop consolidation timer, close DBs |
| `memory_ingest(text: String, source: String, source_ref: Option<String>, project_path: Option<String>)` | Process text through AI → store structured memory |
| `memory_query(query: String, project_path: Option<String>, limit: Option<u32>)` | Search memories, return ranked results with citations |
| `memory_consolidate(project_path: Option<String>)` | Trigger manual consolidation |
| `memory_list(project_path: Option<String>, offset: u32, limit: u32)` | List memories with pagination |
| `memory_delete(id: u32, project_path: Option<String>)` | Delete a specific memory |
| `memory_clear(project_path: Option<String>)` | Clear all memories |
| `memory_stats(project_path: Option<String>)` | Return counts, last consolidation time |
| `memory_get_context(project_path: Option<String>, max_tokens: Option<u32>)` | Build memory context string for system prompt injection |

**Ingestion Pipeline** (mirrors original IngestAgent):

1. Receive raw text + source metadata

2. Call AI provider with extraction prompt:

   > "Extract from this text: a 1-2 sentence summary, key entities (people, places, concepts), topic tags, and an importance score 0.0-1.0. Return as JSON."

3. Parse AI response → insert into `memories` table

4. Return memory ID to caller

**Consolidation Pipeline** (mirrors original ConsolidateAgent):

1. Tokio interval timer (configurable, default 30 minutes)

2. Read unconsolidated memories (up to 20)

3. If &lt; 2, skip

4. Call AI provider with consolidation prompt:

   > "Review these memories and: identify connections between them, compress related facts into synthesized insights, score which connections are strongest. Return as JSON."

5. Store consolidation record, mark source memories as consolidated

6. Emit `memory-consolidated` Tauri event for UI update

**Query Pipeline** (mirrors original QueryAgent):

1. Read all memories + consolidations for the project (+ global)

2. Call AI provider with query prompt:

   > "Given these memories, answer the question. Cite specific memory IDs. If you don't know, say so."

3. Return answer with citations

### Frontend

`src/stores/memory-store.ts` — Zustand store (persisted for settings only):

```typescript
interface MemoryStore {
  // Settings (persisted)
  enabled: boolean;                    // Global opt-in
  autoIngestChat: boolean;             // Auto-ingest chat conversations
  autoIngestFiles: boolean;            // Auto-ingest on file save
  consolidationIntervalMinutes: number; // Background timer interval
  maxContextMemories: number;          // Max memories in system prompt

  // Runtime state (not persisted)
  stats: MemoryStats | null;
  memories: MemoryEntry[];
  isIngesting: boolean;
  isConsolidating: boolean;
  isQuerying: boolean;

  // Actions
  setEnabled: (enabled: boolean) => void;
  setAutoIngestChat: (enabled: boolean) => void;
  setAutoIngestFiles: (enabled: boolean) => void;
  setConsolidationInterval: (minutes: number) => void;
  setMaxContextMemories: (count: number) => void;
  refreshStats: (projectPath?: string) => Promise<void>;
  refreshMemories: (projectPath?: string) => Promise<void>;
}
```

**Per-project memory settings** are stored in `ProjectMetadata` (not in memory-store), following the existing pattern where project-level overrides live in `.notesage/project.json`:

```typescript
// In project-metadata-store.ts — extended ProjectMetadata interface
interface ProjectMetadata {
  version: 1;
  name: string;
  description: string;
  ai: { /* existing */ };
  memory?: {
    scope: 'global' | 'project' | 'none';  // default: 'global' (inherits global setting)
    recall: boolean;                         // default: true
  };
}

// New action on ProjectMetadataStore:
updateMemory: (projectPath: string, updates: Partial<NonNullable<ProjectMetadata['memory']>>) => void;
```

`src/hooks/useMemoryOperations.ts` — orchestration hook:

- `ingestFromChat(conversationId)` — extracts key facts from a completed conversation
- `ingestFromFile(filePath, content)` — extracts key facts from saved file
- `queryMemory(question)` — asks a question against stored memories
- `getMemoryContext()` — builds system prompt context from top memories

**Integration points with existing code:**

1. `useAIOperations.ts` — Inject memory context into `composedSystemMessage`, respecting project memory scope:

   ```typescript
   // In composedSystemMessage useMemo:
   // Check each active project's memory settings
   const memorySettings = getEffectiveMemorySettings(activeProjectPaths);
   if (memorySettings.contextEnabled && memoryContext) {
     parts.push(memoryContext);
   }
   ```

2. `useAIOperations.ts` **→** `sendChatMessage` — After a conversation turn completes, auto-ingest if enabled AND project allows it:

   ```typescript
   if (memoryStore.autoIngestChat && memoryStore.enabled) {
     // Only ingest for projects with scope !== 'none'
     const projectMemory = getProjectMemoryScope(activeProjectPath);
     if (projectMemory.scope !== 'none') {
       await ingestFromChat(conversationId, projectMemory.scope === 'project' ? activeProjectPath : undefined);
     }
   }
   ```

3. `useFileOperations.ts` **→** `saveFile` — After file save, auto-ingest if enabled AND the file's project allows it:

   ```typescript
   if (memoryStore.autoIngestFiles && memoryStore.enabled) {
     const projectMemory = getProjectMemoryScope(projectPathForFile);
     if (projectMemory.scope !== 'none') {
       await ingestFromFile(filePath, content, projectMemory.scope === 'project' ? projectPathForFile : undefined);
     }
   }
   ```

4. `useMemoryOperations.ts` **→** `getEffectiveMemorySettings` — Resolves the combined memory policy for the active project(s):

   ```typescript
   function getEffectiveMemorySettings(projectPaths: string[]): {
     contextEnabled: boolean;       // Should memory context be injected?
     ingestTarget: string | null;   // Which DB to write to (null = skip)
     queryScopes: string[];         // Which DBs to read from
   } {
     // If ANY active project has scope: 'none', that project contributes nothing
     // If ALL active projects have scope: 'none', contextEnabled = false
     // If a project has recall: false, global memories are excluded for its context
     // Project-scoped DBs are only queried for their own project
   }
   ```

### Bundled Agent & Skills

`bundled-agents/memory-assistant.md`**:**

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

You are a memory-aware assistant. You have access to a persistent memory system that stores facts, decisions, and insights from past conversations and documents.

When the user shares important information, use the `remember` skill to store it.
When answering questions, use the `recall` skill to check your memory first.
When the user asks you to forget something, use the `forget` skill.

Always cite which memory a fact came from when using recalled information.
```

**Bundled skills** (in `bundled-skills/`):

- `remember/` — Ingest a fact into memory manually
- `recall/` — Query memories and return results with citations
- `forget/` — Delete a specific memory by ID or topic

## UI/UX

### Memory Settings (Settings Dialog → new "Memory" tab)

- **Enable Memory** toggle (default: off)
- **Auto-ingest chat conversations** toggle (default: on when memory enabled)
- **Auto-ingest file saves** toggle (default: off — can be noisy)
- **Consolidation interval** slider (15 min – 2 hours, default 30 min)
- **Max context memories** number input (default: 10)
- **Memory stats** display: total memories, consolidations, last consolidated time
- **"Clear all memories"** destructive button with confirmation dialog

### Memory Panel (Status Bar indicator)

- Small `Brain` icon in the status bar when memory is enabled
- Click → popover showing:
  - Quick stats (X memories, last consolidated Y ago)
  - "View all memories" link → opens memory browser
  - "Consolidate now" button
  - Toggle for per-document auto-ingest

### Memory Browser (Dialog)

- Scrollable list of memories with:
  - Summary text
  - Source badge (chat / file / manual)
  - Topic pills
  - Importance indicator (subtle bar)
  - Timestamp
  - Delete button (with confirmation)
- Search/filter bar at top
- Consolidation history tab showing synthesized insights

### Chat Integration

- When memory is enabled, a subtle "Memory active" indicator in chat footer
- Memory context injected silently into system prompt (no visible UI change)
- When the AI cites a memory, show memory ID as a hoverable reference

## Data Model

### TypeScript Interfaces

```typescript
interface MemoryEntry {
  id: number;
  source: 'chat' | 'file_save' | 'manual' | 'consolidation';
  sourceRef?: string;
  rawInput: string;
  summary: string;
  entities: string[];
  topics: string[];
  importance: number;
  createdAt: string;
  isConsolidated: boolean;
  projectPath?: string;
}

interface ConsolidationEntry {
  id: number;
  sourceMemoryIds: number[];
  summary: string;
  insights: string[];
  connections: MemoryConnection[];
  createdAt: string;
}

interface MemoryConnection {
  fromId: number;
  toId: number;
  relationship: string;
}

interface MemoryStats {
  totalMemories: number;
  totalConsolidations: number;
  unconsolidatedCount: number;
  lastConsolidatedAt?: string;
  oldestMemory?: string;
  newestMemory?: string;
}

interface MemoryQueryResult {
  answer: string;
  citedMemories: number[];
  memories: MemoryEntry[];
}
```

### Tauri Command Signatures (Rust)

```rust
#[tauri::command]
async fn memory_init(app: AppHandle, project_path: Option<String>) -> Result<(), String>

#[tauri::command]
async fn memory_ingest(
    app: AppHandle,
    text: String,
    source: String,
    source_ref: Option<String>,
    project_path: Option<String>,
    // AI provider config passed from frontend
    provider: String,
    api_key: Option<String>,
    ollama_url: Option<String>,
) -> Result<u32, String>  // returns memory ID

#[tauri::command]
async fn memory_query(
    app: AppHandle,
    query: String,
    project_path: Option<String>,
    limit: Option<u32>,
    provider: String,
    api_key: Option<String>,
    ollama_url: Option<String>,
) -> Result<MemoryQueryResult, String>

#[tauri::command]
async fn memory_consolidate(
    app: AppHandle,
    project_path: Option<String>,
    provider: String,
    api_key: Option<String>,
    ollama_url: Option<String>,
) -> Result<u32, String>  // returns consolidation count

#[tauri::command]
async fn memory_list(
    app: AppHandle,
    project_path: Option<String>,
    offset: u32,
    limit: u32,
) -> Result<Vec<MemoryEntry>, String>

#[tauri::command]
async fn memory_delete(app: AppHandle, id: u32, project_path: Option<String>) -> Result<(), String>

#[tauri::command]
async fn memory_clear(app: AppHandle, project_path: Option<String>) -> Result<(), String>

#[tauri::command]
async fn memory_stats(app: AppHandle, project_path: Option<String>) -> Result<MemoryStats, String>

#[tauri::command]
async fn memory_get_context(
    app: AppHandle,
    project_path: Option<String>,
    max_memories: Option<u32>,
) -> Result<String, String>  // formatted context string for system prompt
```

## Dependencies

### New Rust Dependencies

| Crate | Purpose | Notes |
| --- | --- | --- |
| `rusqlite` | SQLite access | Well-established, `bundled` feature for self-contained builds |
| `sha2` | Content hashing for processed_files dedup | Lightweight, already in transitive deps |

### No New Frontend Dependencies

All UI built with existing shadcn/ui components. No new npm packages.

### Prerequisite Work

- None — all integration points (`useAIOperations`, `useFileOperations`, system prompt composition) are in place.

## Quality Gates

### Functional

- [ ] Memory DB created at `~/.notesage/memory.db` on first enable

- [ ] Per-project DB created at `.notesage/memory.db` when project memory enabled

- [ ] Manual ingest (`/remember "fact"`) stores a memory with summary, entities, topics, importance

- [ ] Chat auto-ingest captures key facts after conversation turn (when enabled)

- [ ] File save auto-ingest captures document summary (when enabled)

- [ ] Background consolidation runs on timer and finds connections between memories

- [ ] `memory_consolidate` can be triggered manually

- [ ] `memory_query` returns relevant memories with source citations

- [ ] `memory_get_context` produces a concise context string suitable for system prompt injection

- [ ] Memory context appears in AI system prompt when enabled

- [ ] AI responses demonstrate awareness of previously stored facts

- [ ] Memory list/search/delete works in memory browser

- [ ] Clear all memories works with confirmation

- [ ] Memory persists across app restarts

- [ ] Works with all three provider paths: Anthropic, OpenAI, Ollama

- [ ] Opt-in: no memory operations when globally disabled

- [ ] No performance degradation — ingestion and consolidation are async, non-blocking

### Per-Project Privacy

- [ ] Project with `scope: "none"` — no memories ingested from chat or file saves

- [ ] Project with `scope: "none"` — no memories recalled in AI system prompt

- [ ] Project with `scope: "none"` — no `.notesage/memory.db` created

- [ ] Project with `scope: "none"` — `remember` / `recall` / `forget` skills hidden from agent

- [ ] Project with `scope: "none"` — consolidation timer skips this project entirely

- [ ] Project with `scope: "project"` — memories stored in `<project>/.notesage/memory.db`, not global DB

- [ ] Project with `scope: "project"` — memories from this project never appear in other projects' AI context

- [ ] Project with `scope: "project"` — global consolidation does not read or process this project's memories

- [ ] Project with `recall: false` — global memories excluded from AI context even if this project's scope is `"global"`

- [ ] Multi-project chat context — disabled projects contribute zero memories even when other projects have memory enabled

- [ ] Memory settings persisted in `.notesage/project.json` — travels with project folder (sync, share, move)

- [ ] Default behavior for new projects: `scope: "global"`, `recall: true` (inherits global memory setting)

- [ ] Project Settings UI shows memory controls with clear explanations of each mode

### Design

- [ ] Memory settings tab follows existing settings dialog patterns

- [ ] Status bar indicator is subtle and consistent with existing icons

- [ ] Memory browser dialog follows shadcn/ui dialog patterns

- [ ] Memory entries are scannable with clear visual hierarchy

- [ ] All states handled: empty (no memories), loading, error

- [ ] Works in both light and dark mode

- [ ] No chromatic accent colors — uses existing neutral palette

## Out of Scope

- **Multimodal ingestion** — Images, audio, video. Text only for now.
- **Semantic search / embeddings** — Using LLM-based retrieval like the original. Vector search can be added later.
- **Cross-device sync** — Memories are local. iCloud sync of `.notesage/memory.db` may work naturally but is not tested/guaranteed.
- **Memory sharing** — No export/import of memory databases between users.
- **Selective conversation ingestion** — Currently all-or-nothing per conversation. Per-message "remember this" is possible via the skill.
- **Memory size limits / pruning** — No automatic cleanup of old/low-importance memories. Manual delete only for now.
- **ACP agent memory routing** — Memory ingestion/query uses direct API path only. ACP agents don't have memory tools exposed yet.
- **Cross-project memory merging** — No ability to merge a project-scoped DB into global or vice versa. Deliberate separation.
- **Memory encryption at rest** — SQLite DBs are stored as plaintext files. Users handling classified material should rely on OS-level disk encryption (FileVault, BitLocker). In-app encryption is a potential future enhancement.
- **Audit logging** — No log of which memories were accessed or when. Could be added for compliance-heavy environments.