# PRD: AI-Assisted Research (Phase 8)

**Date:** 2026-03-08
**Status:** ✅ Complete
**Phase:** 8 — AI-Assisted Research (Skill Pack)

## Problem

Writers, students, and knowledge workers collect information from multiple web sources, then manually copy-paste, reformat, and organize it before they can synthesize findings into their own writing. This context-switching between browser, note-taking app, and AI chat breaks flow and loses provenance. Notesage already has AI chat and a `download-webpage` skill — but there's no structured way to organize saved research, synthesize across multiple sources, or insert properly cited references into documents.

## Goals

1. **Collect:** Users can save web pages as structured research files with metadata (URL, title, date, tags) from chat or by pasting a URL
2. **Organize:** Research files are discoverable and searchable by tag, source, or content across the workspace
3. **Synthesize:** AI can read multiple research files, summarize key findings, identify themes, and compare sources
4. **Draft:** AI can generate document sections with proper citations drawn from the research corpus
5. **Cite:** Users choose their citation format (inline links, footnotes, or academic) — citations reference actual saved sources

## Non-Goals

- Dedicated research panel or sidebar UI (files + chat + command palette is sufficient)
- Automatic background web crawling or scheduled fetching
- PDF/EPUB source ingestion (future enhancement — stick to web pages for now)
- Collaboration features for shared research
- Zotero/Mendeley/EndNote integration
- Full bibliographic database management

## User Stories

**Collecting:**
- As a writer, I want to say "save this article: [URL]" in chat, so that the page is downloaded with metadata and stored in my research folder
- As a researcher, I want to paste a list of URLs and have them all saved, so I can batch-collect sources for a topic
- As a user, I want saved research to include the original URL, title, date saved, and my tags, so I can find it later

**Organizing:**
- As a user, I want to search my saved research by tag or keyword (e.g., "find my research about climate policy"), so I can locate relevant sources
- As a writer, I want to see a summary of all research I've collected for a project, so I can assess coverage gaps

**Synthesizing:**
- As a researcher, I want to ask the AI to "synthesize my research on [topic]", so I get a summary of findings across all relevant sources
- As a student, I want the AI to compare two or more sources and highlight agreements, disagreements, and unique points

**Drafting:**
- As a writer, I want to ask the AI to "draft a section about [topic] using my research", so I get a well-cited first draft
- As a user, I want to choose my citation format (links, footnotes, or academic), so citations match my document's style
- As a researcher, I want to insert a citation for a specific source into my document at the cursor position

## Technical Approach

### Architecture: Skill Pack on Phase 7 Infrastructure

All research capabilities are implemented as **bundled skills** using the existing Agent Skills format. No new Tauri commands, Zustand stores, or UI panels. The AI orchestrates workflows by calling skills and reading/writing files.

### Skills

| Skill | Purpose | Scripts |
|-------|---------|---------|
| `download-webpage` | Fetch URL → clean markdown + images | **Exists** — enhance with research metadata |
| `save-research` | Organize research files with tags and metadata | `scripts/save.mjs` |
| `search-research` | Search research corpus by tag, source, keyword | `scripts/search.mjs` |
| `synthesize-sources` | Read multiple sources, generate synthesis | No script — AI-only skill |
| `insert-citation` | Insert formatted citation into document | No script — AI-only skill |

### Research File Format

Research files are standard markdown with YAML frontmatter, stored in `.notesage/research/` (project) or `~/Notesage/.notesage/research/` (global):

```markdown
---
source_url: https://example.com/article
title: "Article Title"
author: "Author Name"
date_saved: 2026-03-08
date_published: 2026-03-01
tags: [climate, policy, europe]
word_count: 1234
---

# Article Title

Extracted article content in clean markdown...
```

### Skill Details

#### `download-webpage` (Enhancement)

The existing skill already fetches and converts web pages. Enhancements:

- Default save location changes to `.notesage/research/` when used in a research context
- Frontmatter extended with `source_url`, `author`, `date_published`, `tags` fields
- Script attempts to extract author and publication date from page metadata (`<meta>` tags, JSON-LD, Open Graph)
- Existing behavior preserved when called outside research context

#### `save-research` (New)

Organizes a research file — adds/updates tags, moves between directories, generates a filename from the title.

**SKILL.md body instructs the AI to:**
1. Accept content (pasted text, URL, or file path) and metadata (tags, notes)
2. If input is a URL, delegate to `download-webpage` first
3. Run `scripts/save.mjs` to write the file with proper frontmatter
4. Report where the file was saved

**Script (`scripts/save.mjs`):**
- Input: `[content_or_path, output_dir, --title "...", --tags "tag1,tag2", --url "..."]`
- Output: JSON with `{ file, title, tags, status }`
- Handles filename slugification, duplicate detection, frontmatter generation

#### `search-research` (New)

Searches the research corpus across all project and global research directories.

**Script (`scripts/search.mjs`):**
- Input: `[query, ...search_dirs, --tag "tagname", --limit 20]`
- Searches frontmatter fields (title, tags, source_url) and body content
- Output: JSON array of matches with `{ file, title, tags, source_url, snippet, relevance }`
- Supports tag-only filtering (`--tag`), full-text search, or both

**Command palette integration:**
- New keyboard shortcut: `Cmd+4` opens command palette in research search mode
- Uses `search-research` script results to populate the palette
- Select a result to open the research file

#### `synthesize-sources` (New — AI-Only)

No script — the SKILL.md instructs the AI on how to synthesize:

1. Use `search-research` to find relevant sources by tag or keyword
2. Read each source file's content
3. Generate a synthesis document with:
   - Executive summary (key findings across all sources)
   - Per-source summaries with key quotes
   - Theme analysis (common threads, disagreements, gaps)
   - Suggested further research areas
4. Save the synthesis as a new markdown file or insert into the active document

#### `insert-citation` (New — AI-Only)

No script — the SKILL.md instructs the AI on citation insertion:

1. Ask the user which format they prefer (if not already specified):
   - **Inline links:** `[Title](url)` — simple markdown links
   - **Footnotes:** `[^1]` with `[^1]: Author. "Title." URL. Date.` at the document bottom
   - **Academic:** APA, MLA, or Chicago format with proper bibliography section
2. Search research corpus for the requested source
3. Format the citation according to the chosen style
4. Insert at the cursor position (via editor content manipulation) or append to a References section

### Data Flow

```
User: "Research climate policy in Europe"
  → AI uses search-research to check existing sources
  → AI reports coverage gaps
  → User provides URLs or asks AI to suggest search terms

User: "Save this: https://example.com/climate-policy"
  → AI calls download-webpage skill
  → save-research organizes with tags
  → File saved to .notesage/research/climate-policy-eu.md

User: "Synthesize my climate research"
  → AI calls search-research (--tag climate)
  → AI reads matched files
  → AI generates synthesis with cross-source analysis
  → Synthesis inserted into document or saved as new file

User: "Draft an introduction citing my sources, use footnotes"
  → AI reads relevant research files
  → AI generates text with footnote citations
  → References section appended to document
```

### File Storage

```
project/
  .notesage/
    research/           # Project-scoped research
      climate-policy-eu.md
      renewable-energy-trends.md
      images/           # Downloaded images
        article-1-fig1.png

~/Notesage/
  .notesage/
    research/           # Global research (cross-project)
```

## UI/UX

### No New Panels

Research interaction happens entirely through:

1. **Chat panel** — "save this URL", "synthesize my research on X", "cite source Y"
2. **File tree** — research files appear under `.notesage/research/` in the sidebar
3. **Command palette (Cmd+4)** — search saved research by tag, title, or content
4. **Existing inline actions** — AI can insert citations and drafted text into the editor

### Command Palette Research Mode

When triggered via `Cmd+4`:
- Search input with placeholder "Search research..."
- Results show: title, tags as pills, source URL domain, word count
- Select to open the research file in a new tab
- Same visual style as existing Cmd+3 tag search and Cmd+Shift+F file search

### Citation Format Preference

- Stored in `project-metadata-store` as `citationFormat: 'links' | 'footnotes' | 'academic'`
- AI asks on first citation insertion if not set; remembers per-project
- Can be changed via "change citation format" in chat
- Academic sub-format (APA/MLA/Chicago) specified in `citationStyle` field

### Research Summary in Chat

When AI synthesizes sources, the response includes:
- Source count and coverage overview
- Per-source cards (collapsible) with title, URL, key findings
- Identified themes with supporting source references
- Rendered using existing `MarkdownContent` component — no special UI needed

## Data Model

### Research File Frontmatter

```typescript
interface ResearchFrontmatter {
  source_url: string;
  title: string;
  author?: string;
  date_saved: string;       // ISO date
  date_published?: string;  // ISO date
  tags: string[];
  word_count: number;
}
```

### Project Metadata Extension

```typescript
// Added to existing ProjectMetadata interface
interface ProjectMetadata {
  // ... existing fields
  citationFormat?: 'links' | 'footnotes' | 'academic';
  citationStyle?: 'apa' | 'mla' | 'chicago';  // only when citationFormat === 'academic'
}
```

### Search Result

```typescript
interface ResearchSearchResult {
  file: string;            // absolute path
  title: string;
  tags: string[];
  source_url: string;
  snippet: string;         // first 200 chars or matched context
  relevance: number;       // 0-1 score
  date_saved: string;
}
```

### Tauri Command (Search Only)

One new Tauri command for fast research search (Node.js script is too slow for command palette real-time filtering):

```rust
#[tauri::command]
async fn search_research(
    dirs: Vec<String>,
    query: Option<String>,
    tag: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ResearchSearchResult>, String>
```

Scans `.md` files in the given directories, parses YAML frontmatter, matches against query/tag, returns sorted by relevance. Similar pattern to existing `find_tag_occurrences`.

## Dependencies

### New NPM Packages (for skill scripts)

None — the `download-webpage` skill already bundles `jsdom`, `turndown`, and `@mozilla/readability`. The `search-research` script uses only Node.js built-ins (`fs`, `path`, `readline`).

### New Rust Dependencies

None — YAML frontmatter parsing can use the existing `serde_yaml` (already in Cargo.toml for other features) or simple string parsing matching the `find_tag_occurrences` pattern.

### Prerequisite Work

- `download-webpage` skill enhancement (extended frontmatter, metadata extraction)
- `Cmd+4` command palette mode wiring (follows existing `Cmd+3` pattern exactly)

## Quality Gates

### Functional

- [x] `download-webpage` saves files with full research frontmatter (source_url, title, author, date_saved, tags)
- [x] Author and publication date extracted from page metadata when available
- [x] `save-research` skill creates properly formatted research files with slugified filenames
- [x] `save-research` detects duplicate URLs and offers overwrite/keep-both/skip
- [x] `search-research` finds files by tag name (exact match)
- [x] `search-research` finds files by title/content keyword (substring match)
- [x] `search-research` searches both project and global research directories
- [x] `Cmd+4` opens command palette in research search mode with results from `search_research` Tauri command
- [x] Selecting a search result opens the research file in a new tab
- [x] `synthesize-sources` reads multiple research files and generates a coherent synthesis
- [x] Synthesis output includes per-source attribution and cross-source theme analysis
- [x] `insert-citation` inserts inline link citations correctly at cursor position
- [x] `insert-citation` inserts footnote citations with references section at document end
- [x] `insert-citation` generates APA/MLA/Chicago formatted citations with bibliography
- [x] Citation format preference persisted per-project in project metadata
- [x] Batch URL saving works (multiple URLs processed sequentially with summary)
- [x] Research files appear in the file tree under `.notesage/research/`
- [x] Images downloaded by `download-webpage` are saved to `.notesage/research/images/`
- [x] No console errors during normal research operations

### Design

- [x] Command palette research mode matches existing tag search (Cmd+3) visual style
- [x] Research search results show title, tags as pills, source domain, and word count
- [x] Smooth keyboard navigation in research search results
- [x] Works correctly in both light and dark mode

### Skill Quality

- [x] All new skills follow the Agent Skills specification (valid SKILL.md frontmatter, proper structure)
- [x] Skills are discoverable by all connection types (ACP and direct API)
- [x] AI-only skills (synthesize-sources, insert-citation) work without scripts
- [x] Script-based skills (save-research, search-research) handle errors gracefully with clear messages

## Out of Scope

- **PDF/EPUB source ingestion** — potential future enhancement, requires different extraction pipeline
- **Automatic web crawling** — no scheduled or background fetching; all collection is user-initiated
- **Dedicated research panel UI** — files + chat + command palette is sufficient for v1
- **Zotero/Mendeley import** — academic reference manager integration deferred
- **Semantic/vector search** — v1 uses keyword/tag matching; semantic search is a future enhancement
- **Research sharing or collaboration** — single-user workflow only
- **Cross-project research linking** — research is scoped to project or global, no cross-references
- **Auto-tagging via AI** — users provide tags manually; AI can suggest but not auto-apply
