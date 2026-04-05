# PRD: Knowledge Base Synthesis & Maintenance

|  |  |
| --- | --- |
| **Date** | 2026-04-05 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | Transforms Notesage from a research storage tool into a living knowledge base — research is automatically synthesized into existing notes, cross-referenced, and maintained for consistency over time |
| **Inspiration** | [Andrej Karpathy's LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) |

## Problem

Notesage has solid research infrastructure: `download-webpage` fetches sources, `save-research` stores them with metadata, `search-research` finds them, and `synthesize-sources` generates cross-source analysis. But the workflow stops at *storage*. Each research file is an isolated artifact. There is no automatic integration of new knowledge into existing notes, no health checking for stale or contradictory information, and no auto-generated knowledge map.

This means:

1. **Knowledge doesn't compound.** Saving 50 research files doesn't make the 51st more useful. A user must manually find related notes and update them.
2. **Knowledge rots silently.** Contradictions between notes, outdated information, and orphan files with no connections accumulate without warning.
3. **Navigation is manual.** The command palette search works, but there's no high-level view of "what do I know about X?" organized by topic.
4. **Research is project-scoped but invisible.** Research files live in `.notesage/research/` which is a hidden directory. Users can search them via the command palette (`?` prefix) but cannot browse or organize them visually.

Additionally, the existing research skills need alignment on project scoping:

5. **Project-scoped storage must be the default.** When working within a project, all research operations (save, download, synthesize) must target that project's `.notesage/research/` directory — never a global `~/Notesage/.notesage/research/` unless no project is active. The global fallback exists for Quick Notes and non-project contexts only.

## Goals

1. **Ingest, don't just save.** When new research is saved, the AI identifies related existing notes in the project and offers to update them with new information, cross-references, and synthesis — not just store another file.
2. **Knowledge health checking.** A lint skill scans the project's research corpus and notes for contradictions, stale information, orphan pages, and missing cross-references.
3. **Auto-generated knowledge index.** A navigable index page organized by topic/tag, auto-generated from the document index, giving users a "map" of their knowledge base.
4. **Activity log.** A chronological record of knowledge base changes (sources ingested, syntheses created, contradictions found) persisted as a readable markdown file.
5. **Project-first research scoping.** All research skills default to the active project's `.notesage/research/` directory. Global fallback only when no project context exists.

## Non-Goals

- **Backlink index / bidirectional linking** — important but a separate infrastructure PRD; requires SQLite schema changes and editor UI
- **Embedding-based semantic search** — the existing FTS5 + tag system is sufficient at the scale of personal knowledge bases
- **Real-time collaborative knowledge bases** — single-user for now
- **Automatic ingestion without user action** — all ingestion is user-initiated; no background crawling
- **Displaying `.notesage/` contents in the sidebar** — covered by a separate PRD for hidden file visibility

## User Stories

1. **As a researcher**, I want to save a webpage and have the AI automatically find my related notes and offer to update them, so that new knowledge integrates into my existing understanding rather than sitting in isolation.

2. **As a writer**, I want to run a health check on my research corpus and get a report of contradictions, outdated sources, and orphan files, so that I can maintain the quality of my knowledge base.

3. **As a student**, I want an auto-generated index page organized by topic that shows me everything I've collected, so that I can navigate my knowledge without remembering individual file names.

4. **As a user**, I want a chronological log of what was added, updated, and flagged in my knowledge base, so that I can track how my research evolves over time.

5. **As a project user**, I want my research to always be saved within my active project, so that project-specific knowledge stays with the project and doesn't leak into a global folder.

## Design

### 1. Knowledge Ingestion Skill (`ingest-research`)

A new bundled skill that wraps `save-research` + `download-webpage` with a synthesis step:

**Flow:**

```
User provides URL or content
  → download-webpage (if URL) or save-research (if content)
  → search-research (find related existing notes in project)
  → AI analyzes relationships:
      - Which existing notes should reference this new source?
      - Does this new source update, contradict, or extend existing knowledge?
      - Should a new synthesis page be created?
  → Propose updates to user (diff preview per file)
  → User approves/rejects each proposed change
  → Apply approved changes + update cross-references
```

**Skill file:** `bundled-skills/ingest-research/SKILL.md`

**Key behaviors:**

- Always targets the active project's `.notesage/research/` directory
- Proposes changes as a list — never silently modifies existing notes
- Cross-references inserted as standard markdown links (`[Related: Title](./filename.md)`)
- Tags from the new source are merged into related notes' frontmatter where relevant
- If no related notes exist, falls back to standard `save-research` behavior with a suggestion to create a synthesis page

### 2. Knowledge Lint Skill (`lint-knowledge`)

A new bundled skill that performs health checks on the knowledge base:

**Checks performed:**

| Check | Description | Output |
|-------|-------------|--------|
| **Contradictions** | Finds claims in different files that conflict (AI-assessed) | List of file pairs with conflicting statements |
| **Stale sources** | Sources older than a configurable threshold (default 6 months) with no recent updates | List of files with `date_saved` + suggestion to re-verify |
| **Orphan files** | Research files not referenced by any other file and with no tags | List of isolated files |
| **Missing cross-references** | Files with overlapping tags that don't link to each other | Suggested links to add |
| **Duplicate content** | Files with high content overlap (title + tag similarity) | Merge candidates |
| **Tag hygiene** | Inconsistent tag naming (e.g., `#machine-learning` vs `#ML` vs `#machinelearning`) | Normalization suggestions |

**Skill file:** `bundled-skills/lint-knowledge/SKILL.md`

**Output:** A structured markdown report saved to `.notesage/research/lint-report.md` with actionable items. Each finding includes the file path(s), a description, and a suggested fix.

**Scope:** Scans the active project's `.notesage/research/` directory. If multiple projects are selected in the chat footer, scans all of them and reports per-project.

### 3. Knowledge Index Generator (`generate-index`)

A skill that produces an auto-generated `index.md` from the document index:

**Structure:**

```markdown
# Knowledge Index
*Auto-generated on 2026-04-05 — 47 sources across 12 topics*

## By Topic
### Machine Learning
- [Transformer Architecture Overview](./transformers-overview.md) — 3 tags, 2 cross-refs
- [Attention Is All You Need (paper)](./attention-paper.md) — 5 tags, 4 cross-refs

### Climate Science
- [IPCC AR6 Summary](./ipcc-ar6.md) — 2 tags, 1 cross-ref
...

## Recent Additions
- 2026-04-05: [New source title](./file.md)
- 2026-04-03: [Another source](./file2.md)
...

## Health Summary
- 3 orphan files need connections
- 2 sources older than 6 months
- 1 potential contradiction flagged
```

**Generation:** Uses the SQLite document index (tags, headings, research metadata) to build the index. Topics derived from tag clustering — tags that frequently co-occur are grouped.

**Skill file:** `bundled-skills/generate-index/SKILL.md`

**Location:** Saved to `.notesage/research/index.md` in the active project.

### 4. Knowledge Activity Log

An append-only `log.md` tracking knowledge base changes:

**Format:**

```markdown
# Knowledge Base Log

## 2026-04-05
- **INGEST** [Transformer Architecture](./transformers-overview.md) — updated 2 related notes
- **LINT** Found 3 orphan files, 1 contradiction
- **INDEX** Regenerated — 47 sources, 12 topics

## 2026-04-03
- **SAVE** [IPCC AR6 Summary](./ipcc-ar6.md) — tagged: climate, policy
- **SYNTHESIZE** Created [Climate Policy Synthesis](./climate-synthesis.md) from 4 sources
```

**Implementation:** Each skill (`ingest-research`, `lint-knowledge`, `save-research`, `generate-index`, `synthesize-sources`) appends an entry to `.notesage/research/log.md` after completing its operation. Appending is handled by a shared utility in the skill scripts.

### 5. Research Skill Project-Scoping Alignment

Update existing bundled research skills to enforce project-first scoping:

**Current behavior (needs fixing):**

- `save-research`: Prompts user to confirm directory — may default to global
- `download-webpage`: Uses heuristics to pick directory — may choose global
- `synthesize-sources`: Reads from all directories — output location unclear

**Required behavior:**

- When a project is active in the chat footer's project selector, all research operations target `<project-root>/.notesage/research/`
- The project context is passed to skills via the existing `projectRoots` parameter
- If multiple projects are selected, the AI asks which project to save to
- If no project is active, falls back to `~/Notesage/.notesage/research/` with a note in the chat that the research was saved globally
- `search-research` continues to aggregate across all projects (this is correct behavior — cross-project search is a feature)

**Skill files to update:**

- `bundled-skills/save-research/SKILL.md`
- `bundled-skills/download-webpage/SKILL.md`
- `bundled-skills/synthesize-sources/SKILL.md`

## Implementation Plan

### Phase 1: Research Scoping Fix

- [ ] Update `save-research` SKILL.md to enforce project-first directory selection
- [ ] Update `download-webpage` SKILL.md to use active project's research directory
- [ ] Update `synthesize-sources` SKILL.md to save output in the active project
- [ ] Verify `search-research` correctly aggregates across projects (no change expected)
- [ ] Add tests for project-scoped research directory resolution

### Phase 2: Knowledge Lint Skill

- [ ] Create `bundled-skills/lint-knowledge/` directory with SKILL.md and lint script
- [ ] Implement contradiction detection (AI-assessed comparison of related files)
- [ ] Implement stale source detection (date-based threshold check)
- [ ] Implement orphan file detection (no inbound links, no tags)
- [ ] Implement tag hygiene check (fuzzy match on similar tag names)
- [ ] Output structured lint report to `.notesage/research/lint-report.md`

### Phase 3: Knowledge Ingestion Skill

- [ ] Create `bundled-skills/ingest-research/` directory with SKILL.md and ingest script
- [ ] Implement related-note discovery (search by tags + content similarity)
- [ ] Implement cross-reference proposal generation
- [ ] Implement user approval flow for proposed changes
- [ ] Integrate with activity log (append INGEST entries)

### Phase 4: Index Generator & Activity Log

- [ ] Create `bundled-skills/generate-index/` directory with SKILL.md and generation script
- [ ] Implement tag-based topic clustering for index organization
- [ ] Implement log.md append utility shared across skills
- [ ] Wire log appending into existing skills (save-research, synthesize-sources)
- [ ] Wire log appending into new skills (ingest-research, lint-knowledge, generate-index)

## Quality Gates

1. All existing research skill tests continue to pass
2. Project-scoped save: research saved while a project is active lands in `<project>/.notesage/research/`, never global
3. Global fallback: research saved with no active project lands in `~/Notesage/.notesage/research/`
4. Cross-project search: `search-research` returns results from all open projects regardless of which is active
5. Lint report accurately identifies known test cases (planted contradictions, orphan files, duplicate tags)
6. Ingestion proposes but never silently modifies existing files
7. Index generation produces valid markdown with working relative links
8. Activity log entries are appended atomically (no corruption on concurrent operations)
9. All new skills discoverable in the chat (`/` prefix) and settings Skills tab

## Out of Scope

- **Bidirectional link index in SQLite** — separate infrastructure PRD
- **Scheduled/automatic lint runs** — manual invocation only for now
- **AI-powered auto-tagging of existing notes** — could be a future lint check
- **Research file browser UI** — research files are accessed via command palette search; visual browsing deferred to the hidden files visibility PRD
- **Embedding-based semantic similarity** — FTS5 + tags sufficient for personal scale
