# Task Breakdown: AI-Assisted Research (Phase 8)

**Status:** ✅ Complete

**PRD:** `docs/prds/2026-03-08-ai-assisted-research.md`
**Total:** 13 tasks — 13/13 done — 4S, 5M, 4L

## Suggested Implementation Order

**Wave 1 (parallel):** Tasks 1, 3, 6, 7 — independent foundation work (script enhancements, new Rust command, store extension)
**Wave 2 (parallel):** Tasks 2, 4, 5, 8 — skills that depend on Wave 1
**Wave 3 (parallel):** Tasks 9, 10, 11 — frontend wiring + skill registration
**Wave 4 (sequential):** Tasks 12, 13 — docs + end-to-end testing

## Risks & Open Questions

- `download-webpage` script changes (#1) must preserve backward compatibility — existing non-research usage must work identically
- `search_research` Rust command (#6) must be fast enough for real-time command palette filtering (<100ms for ~500 files)
- AI-only skills (#4, #5) depend entirely on prompt quality — may need iteration after initial testing with real AI providers
- Citation insertion (#5) requires the AI to manipulate editor content at cursor position — verify this works with both ACP and direct API connections

---

## Wave 1: Foundation (Parallel)

### Task 1 — Enhance `download-webpage` script with metadata extraction ✅ DONE

**Complexity:** M | **Category:** frontend (Node.js script) | **Dependencies:** none

**Description:**
Update `bundled-skills/download-webpage/scripts/download.mjs` to extract author and publication date from page metadata. Look for:
- `<meta name="author">`, `<meta property="article:author">`
- `og:article:published_time`, `<meta name="date">`, `<time>` elements
- JSON-LD `@type: Article` with `author` and `datePublished`

Add new frontmatter fields to the output:
- `source_url` (rename from existing `url` field, keep `url` for backward compat)
- `author` (string, empty if not found)
- `date_published` (ISO date string, empty if not found)
- `date_saved` (ISO date, always set)
- `tags` (empty array by default, populated via `--tags` CLI arg)
- `word_count` (already exists)

Add `--tags "tag1,tag2"` CLI argument support.

**Acceptance criteria:**
- Downloaded files include all research frontmatter fields
- Author and date extracted from at least `<meta>` tags and JSON-LD
- `--tags` argument populates the tags array
- Existing behavior without `--tags` is unchanged
- Existing `url` field still present for backward compat

**Files:**
- `bundled-skills/download-webpage/scripts/download.mjs`

---

### Task 3 — Create `search-research` skill with script ✅ DONE

**Complexity:** M | **Category:** both (skill + Node.js script) | **Dependencies:** none

**Description:**
Create `bundled-skills/search-research/` directory with:

**`SKILL.md`:** Frontmatter with `name: search-research`, `description: Search saved research files by tag, keyword, or content`, `user-invocable: true`. Body instructs AI to run the script with project `.notesage/research/` and global `~/Notesage/.notesage/research/` as search directories.

**`scripts/search.mjs`:** Node.js script that:
- Accepts `[query, ...search_dirs]` with optional `--tag "tagname"` and `--limit 20`
- Recursively scans `.md` files in given directories
- Parses YAML frontmatter between `---` delimiters (regex-based, no external deps)
- Matches `query` as case-insensitive substring against title, body content, and source_url
- Matches `--tag` as exact match against tags array
- Returns JSON array: `[{ file, title, tags, source_url, snippet, relevance, date_saved }]`
- `snippet`: first 200 chars of body or matched context window
- `relevance`: simple scoring (title match > tag match > body match)
- Sorted by relevance descending, limited by `--limit`

**Acceptance criteria:**
- Script finds files by tag (exact match)
- Script finds files by keyword (substring in title and content)
- Combined tag + keyword filtering works
- Returns valid JSON to stdout
- Handles empty directories gracefully (returns `[]`)
- SKILL.md follows Agent Skills spec

**Files:**
- `bundled-skills/search-research/SKILL.md`
- `bundled-skills/search-research/scripts/search.mjs`

---

### Task 6 — Add `search_research` Tauri command ✅ DONE

**Complexity:** L | **Category:** backend (Rust) | **Dependencies:** none

**Description:**
Add a new Tauri command for fast research file searching, needed for real-time command palette filtering (Node.js script is too slow for keystroke-by-keystroke search).

Follow the `find_tag_occurrences` pattern in `src-tauri/src/commands/file.rs`:

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct ResearchSearchResult {
    pub file: String,
    pub title: String,
    pub tags: Vec<String>,
    pub source_url: String,
    pub snippet: String,
    pub relevance: f32,
    pub date_saved: String,
    pub word_count: usize,
}

#[tauri::command]
pub async fn search_research(
    dirs: Vec<String>,
    query: Option<String>,
    tag: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ResearchSearchResult>, String>
```

Implementation:
- Recursively scan `.md` files in given directories (skip `.git/`, hidden files)
- Parse YAML frontmatter: split on `---` delimiters, extract `title`, `source_url`, `tags`, `date_saved`, `word_count` fields via simple string matching (or `serde_yaml` if already available)
- If `tag` provided: exact match against tags array
- If `query` provided: case-insensitive substring match against title + body content
- Relevance scoring: title match = 1.0, tag match = 0.8, body match = 0.5
- Sort by relevance descending, limit to `limit` (default 50)
- Snippet: first 200 chars of body, or context around first match

Register in `generate_handler![]` in `lib.rs`.

**Acceptance criteria:**
- Command returns results for tag-only, query-only, and combined searches
- Empty directories return empty array (no error)
- Performance: <100ms for 500 files
- Properly registered and callable from frontend

**Files:**
- `src-tauri/src/commands/file.rs` (add struct + command, or new `research.rs` if `file.rs` is getting large)
- `src-tauri/src/commands/mod.rs` (if new module)
- `src-tauri/src/lib.rs` (register in `generate_handler![]`)

---

### Task 7 — Add citation format fields to project metadata ✅ DONE

**Complexity:** S | **Category:** frontend | **Dependencies:** none

**Description:**
Extend the `ProjectMetadata` interface in `project-metadata-store.ts`:

```typescript
interface ProjectMetadata {
  // ... existing fields
  citationFormat?: 'links' | 'footnotes' | 'academic';
  citationStyle?: 'apa' | 'mla' | 'chicago';
}
```

Add these as top-level fields on the metadata object (not inside `ai` sub-object — citation format is a document concern, not an AI concern). Ensure they're included in the JSON serialization to `.notesage/project.json` and loaded on project open. No UI changes — the AI reads/writes these via existing project metadata.

**Acceptance criteria:**
- Fields persist to `.notesage/project.json` and survive app restart
- Default is `undefined` (not set until first use)
- Existing project metadata files without these fields load without error

**Files:**
- `src/stores/project-metadata-store.ts`

---

## Wave 2: Skills & Types (Depends on Wave 1)

### Task 2 — Create `save-research` skill with script ✅ DONE

**Complexity:** L | **Category:** both (skill + Node.js script) | **Dependencies:** #1

**Description:**
Create `bundled-skills/save-research/` directory with:

**`SKILL.md`:** Frontmatter with `name: save-research`, `description: Save and organize research files with metadata and tags`, `user-invocable: true`. Body instructs AI to:
1. Accept content (pasted text, URL, or file path) and metadata (tags, notes)
2. If input is a URL, delegate to `download-webpage` first
3. Run `scripts/save.mjs` to write the file with proper frontmatter
4. Handle `status: "exists"` with overwrite/keep-both/skip choices (same pattern as `download-webpage`)
5. Report where the file was saved

**`scripts/save.mjs`:** Node.js script that:
- Accepts `[content_or_path, output_dir]` with optional flags: `--title "..."`, `--tags "tag1,tag2"`, `--url "..."`, `--author "..."`, `--force`
- If `content_or_path` is a file path (exists on disk): reads content from file
- If `content_or_path` is `-`: reads from stdin
- Generates slugified filename from title (lowercase, hyphens, no special chars, max 60 chars)
- Checks for duplicate files by scanning existing files' `source_url` frontmatter
- Writes markdown with full research frontmatter (`source_url`, `title`, `author`, `date_saved`, `date_published`, `tags`, `word_count`)
- Creates `output_dir` if it doesn't exist
- Returns JSON: `{ file, title, tags, status }` with status `created`/`exists`/`overwritten`
- `--force` overwrites existing files

**Acceptance criteria:**
- Script creates properly formatted research files
- Duplicate URL detection works (scans existing files)
- Filename slugification produces clean filenames
- `--force` allows overwriting
- SKILL.md follows Agent Skills spec and references `download-webpage` for URL inputs

**Files:**
- `bundled-skills/save-research/SKILL.md`
- `bundled-skills/save-research/scripts/save.mjs`

---

### Task 4 — Create `synthesize-sources` AI-only skill ✅ DONE

**Complexity:** S | **Category:** frontend (skill definition) | **Dependencies:** #3

**Description:**
Create `bundled-skills/synthesize-sources/SKILL.md` — an AI-only skill with no scripts. Follow the `create-skill` pattern for AI-only skills.

SKILL.md frontmatter: `name: synthesize-sources`, `description: Synthesize findings across multiple research sources`, `user-invocable: true`.

Body instructs the AI to:
1. Ask the user what topic or tags to synthesize (or accept from the prompt)
2. Use `search-research` skill to find relevant sources by tag or keyword
3. Read each matched file's full content
4. Generate a synthesis document with:
   - **Executive summary** — key findings across all sources (2-3 paragraphs)
   - **Per-source summaries** — title, key quotes, main arguments (bulleted)
   - **Theme analysis** — common threads, disagreements, gaps in coverage
   - **Suggested further research** — areas not covered by existing sources
5. Offer to save as a new file in `.notesage/research/synthesis-{topic}.md` or insert into the active document
6. Use `<quick-replies>` to offer follow-up actions: "Save as file", "Insert into document", "Go deeper on [theme]"

**Acceptance criteria:**
- SKILL.md has valid frontmatter
- Instructions are clear and actionable for the AI
- References `search-research` for source discovery
- Follows Agent Skills spec

**Files:**
- `bundled-skills/synthesize-sources/SKILL.md`

---

### Task 5 — Create `insert-citation` AI-only skill ✅ DONE

**Complexity:** S | **Category:** frontend (skill definition) | **Dependencies:** #3

**Description:**
Create `bundled-skills/insert-citation/SKILL.md` — an AI-only skill with no scripts.

SKILL.md frontmatter: `name: insert-citation`, `description: Insert formatted citations from research sources into documents`, `user-invocable: true`.

Body instructs the AI to:
1. Check `project-metadata-store` for existing `citationFormat` preference
2. If not set, ask the user to choose:
   - **Inline links:** `[Title](url)` — simple markdown links
   - **Footnotes:** `[^1]` with `[^1]: Author. "Title." URL. Date.` at document end
   - **Academic:** APA, MLA, or Chicago with bibliography section
3. Save their choice to project metadata for future use
4. Use `search-research` to find the requested source
5. Format the citation according to the chosen style
6. Insert at cursor position or append to a References/Bibliography section

Include concrete examples of each format in the SKILL.md body so the AI has reference templates:
- Inline: `[Climate Policy in Europe](https://example.com/article)`
- Footnote: `[^1]` + `[^1]: Smith, J. "Climate Policy in Europe." https://example.com/article. 2026-03-01.`
- APA: `Smith, J. (2026). Climate Policy in Europe. *Example Publication*. https://example.com/article`
- MLA: `Smith, John. "Climate Policy in Europe." *Example Publication*, 1 Mar. 2026, example.com/article.`
- Chicago: `Smith, John. "Climate Policy in Europe." *Example Publication*, March 1, 2026. https://example.com/article.`

**Acceptance criteria:**
- SKILL.md has valid frontmatter
- All three citation formats documented with examples
- References `search-research` for source lookup
- References project metadata for format persistence

**Files:**
- `bundled-skills/insert-citation/SKILL.md`

---

### Task 8 — Add `ResearchSearchResult` type and Tauri wrapper ✅ DONE

**Complexity:** S | **Category:** frontend | **Dependencies:** #6

**Description:**
Add the TypeScript interface and typed invoke wrapper to the frontend. Follow the existing `findTagOccurrences` pattern in `src/lib/tauri.ts`:

```typescript
export interface ResearchSearchResult {
  file: string;
  title: string;
  tags: string[];
  source_url: string;
  snippet: string;
  relevance: number;
  date_saved: string;
  word_count: number;
}

export async function searchResearch(
  dirs: string[],
  query?: string,
  tag?: string,
  limit?: number,
): Promise<ResearchSearchResult[]> {
  return invoke<ResearchSearchResult[]>('search_research', { dirs, query, tag, limit });
}
```

**Acceptance criteria:**
- Type matches the Rust struct exactly
- Wrapper function callable with full type safety
- Optional parameters handled correctly

**Files:**
- `src/lib/tauri.ts`

---

## Wave 3: Frontend Wiring (Depends on Waves 1-2)

### Task 9 — Add Cmd+4 research search mode to command palette ✅ DONE

**Complexity:** L | **Category:** frontend | **Dependencies:** #8

**Description:**
Add a `researchSearchMode` to `CommandPalette.tsx`, following the exact pattern of `tagSearchMode` (Cmd+3).

**Keyboard shortcut wiring (`App.tsx`):**
- Add `Cmd+4` handler that opens the command palette with `researchSearchMode: true`
- Follow the existing `Cmd+3` wiring pattern

**Command palette changes (`CommandPalette.tsx`):**
- New prop `researchSearchMode?: boolean`
- When active: placeholder text "Search research..."
- Debounced (300ms) call to `searchResearch()` from `src/lib/tauri.ts`
- Collect search directories: project `.notesage/research/` paths from workspace-store projects + global `~/Notesage/.notesage/research/`
- Results display:
  - Title (primary text)
  - Tags rendered as small pills (follow tag badge styling from tag search)
  - Source URL domain (e.g., "example.com") in muted text
  - Word count in muted text
- Selecting a result calls `openFile(result.file)` to open in a new tab
- Keyboard navigation (up/down arrows, Enter to select, Escape to close)

**Acceptance criteria:**
- `Cmd+4` opens palette in research search mode
- Typing filters results via Tauri command in real-time
- Results show title, tag pills, source domain, word count
- Selecting a result opens the research file
- Empty state: "No research files found" message
- Matches existing command palette visual style (dark/light mode)
- Keyboard navigation works

**Files:**
- `src/components/CommandPalette.tsx`
- `src/App.tsx` (keyboard shortcut handler)

---

### Task 10 — Register new bundled skills in extraction pipeline ✅ DONE

**Complexity:** M | **Category:** both | **Dependencies:** #2, #3, #4, #5

**Description:**
Ensure the 4 new skills are included in the bundled skills extraction pipeline. Check `src-tauri/src/commands/skills.rs` — the `extract_bundled_skills` command copies bundled skills from the app bundle to `~/.notesage/bundled-skills/` on launch.

Verify that:
1. All 4 new skill directories are included in the Tauri resource bundle (check `tauri.conf.json` resources section or the build process)
2. `extract_bundled_skills` copies them alongside existing skills (`create-skill`, `create-agent`, `download-webpage`)
3. `useSkillDiscovery` picks them up during the scan cycle
4. They appear in Settings > Skills & Agents browser

If bundled skills are embedded via `include_dir!` or similar — add the new directories. If they're copied via the Tauri resource system — add them to `tauri.conf.json`.

**Acceptance criteria:**
- All 4 new skills appear in `~/.notesage/bundled-skills/` after app launch
- Skills are discoverable in Settings > Skills & Agents
- AI can reference and use the skills in chat
- Existing skills (`create-skill`, `create-agent`, `download-webpage`) still work

**Files:**
- `src-tauri/src/commands/skills.rs`
- `src-tauri/tauri.conf.json` (if resource-based)

---

### Task 11 — Update `download-webpage` SKILL.md for research context ✅ DONE

**Complexity:** S | **Category:** frontend (skill definition) | **Dependencies:** #1

**Description:**
Update `bundled-skills/download-webpage/SKILL.md` to mention the research workflow context. Add a "Research Mode" section that instructs the AI:
- When the user is saving for research purposes (mentions "research", "save for later", etc.), default the output directory to `.notesage/research/` in the current project
- Pass `--tags` if the user specified any tags
- Mention that the `save-research` skill can be used for additional organization after download

Keep existing non-research workflow instructions unchanged — the skill should work identically for users who just want to download a page to any directory.

**Acceptance criteria:**
- SKILL.md mentions research context with `.notesage/research/` default
- Existing non-research instructions preserved
- References `save-research` for post-download organization

**Files:**
- `bundled-skills/download-webpage/SKILL.md`

---

## Wave 4: Documentation & Testing

### Task 12 — Update documentation ✅ DONE

**Complexity:** S | **Category:** docs | **Dependencies:** #9

**Description:**
Update project documentation to reflect the new research capabilities:

1. **`docs/keyboard-shortcuts.md`:** Add `Cmd+4` (Research search) to the App Navigation table
2. **`docs/product-description.md`:** Update Phase 8 section from roadmap description to implemented feature documentation — list all 5 skills, the Cmd+4 shortcut, citation format support, and the `.notesage/research/` storage pattern
3. **`docs/architecture.md`:** Add `search_research` to the Tauri commands section, add `citationFormat`/`citationStyle` to `project-metadata-store` description
4. **`docs/tauri-commands.md`:** Add `search_research` command documentation with signature, parameters, return type, and frontend usage example

**Acceptance criteria:**
- All docs accurately reflect implemented features
- No stale roadmap language for shipped features
- Tauri command fully documented with examples

**Files:**
- `docs/keyboard-shortcuts.md`
- `docs/product-description.md`
- `docs/architecture.md`
- `docs/tauri-commands.md`

---

### Task 13 — End-to-end integration testing ✅ DONE

**Complexity:** L | **Category:** both | **Dependencies:** all previous tasks

**Description:**
Manual end-to-end test of the full research pipeline. Run through each scenario and verify all quality gates from the PRD:

**Collect:**
1. In chat, ask to save a URL → verify research file created in `.notesage/research/` with full frontmatter (source_url, title, author if available, date_saved, tags)
2. Save 3+ URLs with different tags → verify files organized with correct metadata
3. Save a duplicate URL → verify overwrite/keep-both/skip prompt appears
4. Batch save: paste multiple URLs → verify sequential processing with summary

**Search:**
5. `Cmd+4` → type a tag name → verify matching research files appear
6. `Cmd+4` → type a keyword from article content → verify content search works
7. Select a search result → verify file opens in a new tab
8. Search with no results → verify "No research files found" message

**Synthesize:**
9. Ask AI to "synthesize my research on [tag]" → verify it uses `search-research`, reads files, generates synthesis with executive summary, per-source summaries, theme analysis
10. Verify synthesis includes source attribution

**Cite:**
11. Ask AI to insert an inline link citation → verify `[Title](url)` format
12. Ask AI to insert a footnote citation → verify `[^1]` + reference at document end
13. Ask AI to insert an academic citation (APA) → verify proper format with bibliography
14. Change citation format → verify preference persists per-project
15. Close and reopen app → verify citation format preference survived

**Cross-cutting:**
16. Test with both direct API and ACP connections
17. Verify no console errors during all operations
18. Verify all skills appear in Settings > Skills & Agents
19. Test in both light and dark mode

**Acceptance criteria:**
- All PRD quality gates pass (functional, design, skill quality)
- No regressions in existing skills (`download-webpage`, `create-skill`, `create-agent`)

**Files:** None (testing only)
