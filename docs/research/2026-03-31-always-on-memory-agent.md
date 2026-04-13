# Always-On Memory Agent: Research Report

**Date:** 2026-03-31 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | docs/prds/2026-03-07-always-on-memory-agent.md | Draft |

## Executive Summary

This report revisits the Always-On Memory Agent PRD (drafted 2026-03-07) in light of Notesage's current v0.27.0 feature set and the rapidly evolving competitive landscape. **Persistent AI memory has become table stakes in early 2026** — ChatGPT, Claude, Gemini, and every major coding tool now ships some form of memory. The window to differentiate on memory design is narrowing, but Notesage's local-first architecture and multi-provider abstraction create a unique opportunity.

**Key findings:**

1. **The original PRD's LLM-only retrieval doesn't scale.** Every memory lookup requires an AI call — expensive, slow, fails offline. The revised PRD adopts local vector embeddings (all-MiniLM-L6-v2, 23MB ONNX, downloaded on enable) for instant, free, offline retrieval.
2. **The real competitive edge is privacy/portability/transparency, not speed or cost.** Per-project memory isolation, provider-independent persistence, and human-readable memory files are features cloud competitors structurally cannot match.
3. **Ingestion quality is the hard problem.** Cloud models extract better memories than local 1-3B models. The quality gap is real but acceptable given the privacy/control trade-off.
4. Claude's Auto Dream consolidation (March 2026) sets the bar for memory quality. Notesage's consolidation will be simpler but can improve over time.
5. Notesage already has \~80% of the infrastructure needed: SQLite index, system prompt composition, tool calling, settings dialog, status bar, activity tracking.
6. Per-project privacy scoping (global/project/none + recall toggle) remains the strongest differentiator — no competitor offers this granularity.

---

## Part 1: Competitive Landscape (March 2026)

### Consumer AI Products

#### ChatGPT Memory (OpenAI)

- **Capture:** Automatic extraction of facts + manual "remember this." Since April 2025, can reference ALL past conversations.
- **Storage:** Cloud-based. No local option.
- **Scope:** Global (user-level). No project/workspace scoping.
- **Consolidation:** None. Memories accumulate as discrete facts without cleanup.
- **Privacy:** Toggle off saved memories or chat history independently. Temporary Chat mode. Delete individual memories or clear all.
- **Criticism:** Simon Willison (May 2025) called the "memory dossier" invasive — a profile page showing everything ChatGPT inferred with limited transparency.

#### Claude Memory (Anthropic)

- **Capture:** Automatic (Claude decides what's worth remembering) + manual. Launched progressively: Team/Enterprise (Aug 2025), Pro/Max (Oct 2025), Free (Mar 2026).
- **Storage:** Cloud-based. Distilled facts in XML format.
- **Consolidation — Auto Dream (March 2026):** The most sophisticated system in the market. Reviews accumulated memory like "REM sleep" — strengthens relevant entries, removes outdated ones, reorganizes into indexed topic files. Converts relative dates to absolute. Deletes contradicted facts. Merges duplicates.
- **Privacy:** View/edit/delete individual memories. Clear all. Incognito mode.

#### Claude Code Memory

- **Capture:** `CLAUDE.md` files (human-written, project-committed) + auto memory (Claude saves notes as it works).
- **Storage:** Fully local, file-based. Per-project directories at `~/.claude/projects/<project>/memory/`.
- **Consolidation:** Auto Dream applies here too — reorganizes memory files.
- **Recall:** CLAUDE.md loaded at startup. Auto memory loaded based on relevance.
- **Key insight:** This is the closest model to what Notesage proposes, but uses markdown files instead of SQLite.

#### Google Gemini Memory

- **Capture:** Automatic (Aug 2025, Gemini 2.5 Pro). Memory import from ChatGPT/Claude (Mar 2026).
- **Storage:** Cloud-based.
- **Privacy:** View/edit/delete. Enterprise disable. Memories never used for training.
- **Notable:** The memory import feature signals that memory portability is becoming a competitive battleground.

### Developer Tools

#### Cursor IDE

- **Capture:** Manual only — `.cursorrules` / `.cursor/rules/*.mdc` files. Basic "Memories" feature (user-enabled, applies cross-project).
- **Storage:** Local files.
- **Consolidation:** None.
- **Limitation:** Community's #1 complaint going into 2026 — agents forget everything between sessions. No automatic learning from interactions.

#### Windsurf (formerly Codeium)

- **Capture:** Automatic (Cascade auto-generates) + manual. Workspace-scoped.
- **Storage:** Local only at `~/.codeium/windsurf/memories/`. No credit cost for auto-generated memories.
- **Recall:** Context pipeline: Rules -&gt; Memories -&gt; Open files -&gt; Codebase retrieval -&gt; Recent actions -&gt; Final prompt.
- **Limitation:** No consolidation or deduplication. Workspace isolation (no cross-project transfer). For team sharing, must write to rules files manually.
- **Key insight:** Windsurf is the closest competitor to the PRD's vision — automatic, workspace-scoped, local memory for a desktop development tool.

### Note-Taking & Knowledge Management

#### Notion AI

- **Capture:** Implicit — the workspace IS memory. AI Connectors pull from Slack, JIRA, Google Drive.
- **Storage:** Cloud-based. No separate memory layer.
- **Recall:** Q&A grounded in workspace content with citations. Permission-based access control.
- **Notable:** Notion 3.0 agents (Sep 2025) use Notion pages/databases to maintain context during extended operations.

#### Obsidian + AI Plugins

- **Smart Connections:** Local vector embeddings of all notes. Chat with vault via 100+ APIs. Semantic similarity search.
- **Obsidian Copilot:** 100K+ users. Lexical + optional semantic indexing. Vault-wide Q&A.
- **Limitation:** Plugin fragmentation — no unified memory system. No automatic preference extraction or cross-session learning.

#### Mem.ai

- **Capture:** Self-organizing workspace. Voice mode for brain-dumps. Chrome extension for web capture.
- **Storage:** Cloud-based (not local-first).
- **Recall:** Deep Search by description/topic/vague memory. Auto-surfacing of related notes.
- **Notable:** Rebuilt from scratch as Mem 2.0, suggesting v1 had fundamental issues.

#### Reflect Notes

- **Capture:** Note graph understanding via backlinks.
- **Storage:** End-to-end encrypted cloud. MCP server available for external AI tools.
- **Recall:** AI chat with the full note graph. Knowledge synthesis across connected notes.

### Ambient/System-Level Memory

#### Apple Intelligence

- **Capture:** Fully automatic via Semantic Index — on-device vector DB indexing all content across apps.
- **Storage:** Entirely on-device. Private Cloud Compute for overflow.
- **Privacy:** Maximum by design — data never leaves device for indexing.
- **Limitation:** Hardware-gated (A17 Pro+, M-series). Invisible to users (no management UI).

#### Screenpipe (Open Source, filling Rewind/Limitless gap)

- **Capture:** Continuous screen + audio capture. Fully local.
- **Storage:** Local. MIT-licensed. Works as MCP server.
- **Notable:** 16K+ GitHub stars. Fills the void left by Limitless (acquired by Meta, Dec 2025).

### Memory Infrastructure (Developer SDKs)

#### Mem0

- **Type:** API/SDK for adding memory to any AI agent.
- **Architecture:** Hierarchical memory (User, Session, Agent, Organization levels).
- **Performance:** 26% accuracy improvement over OpenAI Memory on LOCOMO benchmark. 91% faster, 90% fewer tokens than full-context.

#### MemOS

- **Type:** Open-source Memory Operating System for LLMs.
- **Architecture:** Unified memory types — plaintext, activation-based, parameter-level.

#### Letta (formerly MemGPT)

- **Type:** Memory that agents actively manage, not just retrieve.

---

## Part 2: Comparative Analysis

### Memory Approaches by Category

| Approach | Products | Pros | Cons |
| --- | --- | --- | --- |
| **Cloud + auto-extract** | ChatGPT, Claude.ai, Gemini | Zero setup, cross-device | Privacy concerns, vendor lock-in |
| **Local files (manual)** | Cursor, CLAUDE.md | Transparent, version-controlled | No learning, manual maintenance |
| **Local files (auto)** | Windsurf, Claude Code auto | Best of both — automatic + private | No consolidation (Windsurf), no cross-project |
| **SQLite + LLM retrieval** | PRD proposal, Google reference | Simple, no embedding model needed | LLM cost per query, slower retrieval |
| **Vector embeddings** | Smart Connections, Apple, Mem0 | Fast semantic search | Embedding model dependency, storage overhead |
| **Workspace-as-memory** | Notion | No separate system | Only works for structured workspaces |

### Privacy Control Granularity

| Product | Global Toggle | Per-Project Scope | Cross-Project Isolation | Recall Suppression |
| --- | --- | --- | --- | --- |
| ChatGPT | Yes | No | No | No |
| Claude.ai | Yes | No | No | Incognito mode |
| Claude Code | Yes | Yes (per-repo) | Yes | N/A (file-based) |
| Cursor | N/A | Yes (per-repo rules) | Yes | N/A |
| Windsurf | N/A | Yes (per-workspace) | Yes | N/A |
| **Notesage PRD** | **Yes** | **Yes (3 modes)** | **Yes** | **Yes (recall toggle)** |

**Notesage's proposed per-project privacy model (global/project/none + recall toggle) is the most granular in the market.** This is a genuine differentiator for users working on confidential client projects.

---

## Part 3: Notesage Infrastructure Readiness

### Existing Infrastructure (\~80% Ready)

| Component | Status | Integration Point |
| --- | --- | --- |
| SQLite (rusqlite) | Already used by document index | Same crate, parallel DB |
| System prompt composition | `useAIContext.buildComposedSystemMessage()` | Add memory context section |
| Tool calling | 6 built-in tools + skill-to-tool pipeline | Add remember/recall/forget |
| Chat store (Zustand) | Persisted conversations with branching | Auto-ingest trigger |
| File save hooks | `useFileOperations.saveFile()` | Auto-ingest trigger |
| Project metadata | `.notesage/project.json` | Add memory settings |
| Settings dialog | Tab-based, 10 existing tabs | Add Memory tab |
| Status bar | Indicator pattern (IndexProgress, Actions) | Add MemoryIndicator |
| Activity tracking | AgentTask with progress activities | Track ingestion/consolidation |
| Credential storage | OS keychain via connections-store | Memory uses existing AI connection |
| Background tasks | Tokio runtime, debounced reindex queue | Consolidation timer |

### New Infrastructure Needed (\~20%)

| Component | Effort | Notes |
| --- | --- | --- |
| `memory.rs` Tauri commands | Medium | \~10 commands, follows existing patterns |
| `memory/` Rust module | Medium | Ingest/consolidate/query pipelines |
| SQLite schema (3 tables) | Small | Follows index DB pattern |
| `memory-store.ts` Zustand | Small | Settings + runtime state |
| `useMemoryOperations.ts` hook | Medium | Orchestration + auto-ingest |
| Memory Settings tab | Small | Follows existing settings pattern |
| Memory Browser dialog | Medium | New UI — list, search, delete |
| 3 bundled skills | Small | remember/recall/forget |
| Memory agent markdown | Small | `bundled-agents/memory-assistant.md` |

---

## Part 4: PRD Gap Analysis

### Strengths of Current PRD

1. **Per-project privacy** — Best-in-class granularity (global/project/none + recall toggle)
2. **Provider-agnostic** — Works with any AI provider, not locked to one vendor
3. **Local-first** — SQLite on disk, no cloud dependency
4. **Leverages existing infrastructure** — Minimal new dependencies
5. **Clear data model** — 3-table schema is simple and well-defined

### Gaps Identified Since PRD Was Written

#### 1. Consolidation is now table stakes, not a differentiator

The PRD's consolidation (batch 20 memories, find connections, compress) is significantly simpler than Claude's Auto Dream, which:

- Resolves contradictions (old fact replaced by new)
- Converts relative dates to absolute
- Merges duplicates across sessions
- Reorganizes memory into indexed topic files
- Runs asynchronously like "REM sleep"

**Recommendation:** Upgrade the consolidation pipeline to include contradiction detection and temporal normalization. These are the features that make consolidation actually useful vs. just accumulating more summaries.

#### 2. No memory import/export

Google Gemini now supports importing memories from ChatGPT and Claude. Memory portability is becoming a competitive feature.

**Recommendation:** Add export (JSON/Markdown) and import (from ChatGPT, Claude, other Notesage instances) to the roadmap. Not P0, but worth planning for.

#### 3. No semantic search fallback

The PRD explicitly lists vector embeddings as a non-goal, relying on LLM-based retrieval. This works for small memory sets but may not scale.

**Recommendation:** Keep the LLM-based approach for v1 but design the schema to accommodate optional embedding columns later. The existing document index already uses FTS5 — adding BM25-style retrieval as a fast pre-filter before LLM ranking would be a lightweight improvement.

#### 4. Consolidation timer cost

The PRD proposes a background timer (default 30 minutes) that calls the AI provider. For users on metered API plans, this could be expensive and unexpected.

**Recommendation:** Default consolidation to manual-only or very infrequent (daily). Show estimated token cost before enabling auto-consolidation. Consider using a local/cheap model for consolidation even if the main chat uses a premium provider.

#### 5. No "what changed" visibility

Claude Code's Auto Dream shows what it learned and what it reorganized. The PRD has `memory-consolidated` events but no user-facing changelog.

**Recommendation:** After consolidation, show a brief summary of what was learned/merged/removed. This builds trust and helps users verify the system is working correctly.

#### 6. File-based memory alternative

Claude Code uses markdown files for memory, not a database. This has advantages: version-controllable, human-readable, shareable, works with existing file sync. The PRD uses SQLite which is faster for queries but opaque.

**Recommendation:** Consider a hybrid approach — SQLite for fast runtime queries, but also generate a human-readable `memory-summary.md` in `.notesage/` that users can read and edit. Changes to the markdown file sync back to SQLite on next load.

#### 7. Memory context token budget

The PRD mentions `max_tokens` parameter but doesn't specify how memory context competes with other system prompt sections (agent body, project context, goals, file tree, skills). In a 4K system prompt, memory could crowd out other context.

**Recommendation:** Define explicit token budgets per system prompt section. Memory should have a configurable ceiling (default: 500 tokens) that the user can adjust. Show actual token usage in the Memory settings tab.

---

## Part 5: Honest Competitive Assessment

### Where the real edge is

The edge is **not** speed or cost of retrieval. 30ms vs 1s retrieval is invisible when the chat response itself takes 2-10 seconds to stream. Users with cloud API keys don't care about $0 retrieval cost — they're already paying for providers.

The actual competitive advantages are:

1. **Per-project privacy scoping** — Genuinely unique. No one else offers "this project's memories are completely isolated / this project has no memory at all." For consultants, lawyers, and anyone working on confidential client projects alongside personal ones, this is a deal-breaker feature that cloud products structurally cannot match (ChatGPT/Claude memory is global, full stop).

2. **Multi-provider memory** — Everyone else's memory is locked to their provider. ChatGPT memory only works in ChatGPT. Notesage's memory persists regardless of which AI provider you use — switch from Anthropic to Ollama to OpenAI and memories carry over.

3. **Memory you can read and edit** — The hybrid SQLite + markdown summary means users can open `.notesage/memory-summary.md` and directly read/edit what the AI knows. Claude Code has this (CLAUDE.md). ChatGPT's memory is a black box you can only delete from. Transparency builds trust.

4. **Memory + document index** — No competitor combines persistent AI memory with a structured document index. "What do I know about X?" can pull from memories AND the tag/mention/task/FTS5 index across all project files.

### Where we DON'T have an edge

- **Memory extraction quality** — Cloud models (Claude, GPT-4o) will extract better memories than local 1-3B models. Period. The quality gap is real.
- **Consolidation sophistication** — Claude's Auto Dream has a dedicated engineering team. We can't match that with prompts to a small local model.
- **Scale** — For power users with 10K+ memories, cloud vector databases outperform local SQLite. But most users won't hit this.

### What works in practice vs what doesn't

**Proven technology (will work):**

- Vector similarity search on small embedding models — this is what every RAG system in production uses. Boring, reliable.
- FTS5 keyword matching — already battle-tested in Notesage's document index.
- SQLite for structured memory storage — lightweight, well-understood.

**Hard problems (risk of mediocre results):**

- **Ingestion quality** — Will the system extract *useful* memories? Too aggressive = noise, too conservative = invisible. ChatGPT gets this wrong frequently (users complain about weird inferences). This requires careful prompt engineering and iteration.
- **Consolidation on small models** — "Find connections between memories" sounds great but producing genuinely useful insights requires a capable model. A 1-3B model will produce more generic summaries than Claude Sonnet.
- **Knowing when to remember vs forget** — The hardest UX problem in memory. No product has fully solved this.

### Positioning recommendation

Don't pitch as "free and fast local inference" — that's a technical detail, not a user benefit.

Pitch as:

1. **Your memory, your rules** — per-project privacy, local storage, works with any AI provider
2. **Memory that travels with your project** — lives in `.notesage/`, syncs, moves, can be shared
3. **Memory you can read and edit** — human-readable file, not a black box

The local embedding model is the *enabler* (makes retrieval private and offline), but it's not the selling point.

---

## Part 6: Architecture Recommendation

### Three-Tier Hybrid Architecture

| Tier | What it does | Technology | When it runs |
| --- | --- | --- | --- |
| **Tier 1: Math-only** | Embedding, dedup, vector search, FTS5 | Bundled `all-MiniLM-L6-v2` ONNX (23MB, downloaded on enable) | Every chat message (&lt;30ms) |
| **Tier 2: Local LLM** | Entity extraction, summarization | Shared llama-server / Ollama / any local model | On ingest (1-3s, async) |
| **Tier 3: Best available** | Deep consolidation, contradiction detection | User's configured provider (cloud or large local) | Idle/scheduled (background) |

**Why this split matters:**

- Retrieval (Tier 1) runs on every chat message — must be instant, free, offline
- Ingestion (Tier 2) happens occasionally — can tolerate seconds of latency
- Consolidation (Tier 3) is infrequent — can use expensive/slow providers

**Local LLM resource management:**

- Piggybacking: memory ops use whatever model is loaded for chat (zero extra RAM)
- Idle processing: batch queued ingestions when user is inactive for 5+ minutes
- Ollama advantage: concurrent models possible without conflict
- Graceful degradation: no local model → queue until available, or use cloud

### Embedding Model

`all-MiniLM-L6-v2` from Microsoft (Sentence Transformers). Hosted on Hugging Face, **no API key needed** — direct HTTPS download (same as Whisper models). 23MB quantized ONNX. Runs in-process via `ort` Rust crate. &lt;10ms per embedding on Apple Silicon. 512 token context (sufficient for memory summaries).

Downloaded to `~/.notesage/models/embedding/` on first memory enable, with progress bar matching the Whisper download UX.

### Human-Readable Memory File

`.notesage/memory-summary.md` auto-generated alongside the SQLite DB:

- Grouped by memory type (Preferences, Decisions, Facts, etc.)
- Each entry shows source and date
- User edits detected via file watcher and synced back to DB
- Regenerated after each consolidation run

### Token Budget

| Section | Default | Configurable |
| --- | --- | --- |
| Agent body | Unlimited | No |
| Project context | \~300 tokens | No |
| Goals | \~200 tokens | No |
| File tree | \~500 tokens | No |
| Current file | \~100 tokens | No |
| Agent instructions | \~500 tokens | No |
| **Memory context** | **500 tokens** | **Yes (100-2000)** |
| Skill descriptions | Variable | No |

### Implementation Priority

| Priority | What | Why |
| --- | --- | --- |
| **P0** | Embedding download, SQLite schema, ingest + retrieve, system prompt injection, per-project scoping, settings tab | Core value proposition |
| **P1** | Memory browser, bundled skills, memory-summary.md, dedup at ingest | Usability and transparency |
| **P2** | Consolidation + contradiction detection, memory types, decay, user feedback | Quality over time |
| **P3** | Export, idle consolidation, Ollama embedding fallback, consolidation changelog | Polish |

---

## Sources

- OpenAI Memory: openai.com/index/memory-and-new-controls-for-chatgpt
- Claude Memory & Auto Dream: claudefa.st/blog/guide/mechanics/auto-dream
- Claude Code Memory: code.claude.com/docs/en/memory
- Gemini Memory Import: macrumors.com/2026/03/26/gemini-import-tool
- Gemini Code Assist Memory: cloud.google.com/blog/products/ai-machine-learning/memory-for-ai-code-reviews
- Cursor Persistent Memory Forum: forum.cursor.com/t/persistent-ai-memory-for-cursor/145660
- Windsurf Cascade Memories: docs.windsurf.com/windsurf/cascade/memories
- Notion 3.0 Agents: notion.com/releases/2025-09-18
- Screenpipe: github.com/screenpipe/screenpipe
- Mem0 Benchmark: mem0.ai/blog/ai-memory-layer-guide
- Simon Willison ChatGPT Memory Criticism: simonwillison.net/2025/May/21/chatgpt-new-memory
- Meta acquires Limitless: winbuzzer.com (Dec 2025)
- Granola Series C: techcrunch.com (Mar 2026)