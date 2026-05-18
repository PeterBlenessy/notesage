---
name: synthesize-sources
description: Synthesize findings across multiple research sources
user-invocable: true
---

# Synthesize Sources

Read multiple research files from the user's research corpus and generate a comprehensive synthesis document.

## Workflow

1. **Identify the topic.** Ask the user what topic, tag, or set of sources to synthesize. Accept any of:
   - A tag name (e.g., "synthesize my #climate research")
   - A keyword or topic (e.g., "summarize what I've collected about AI safety")
   - Specific file names or paths

2. **Find relevant sources.** Use the `search-research` skill to locate matching research files:
   ```
   execute_skill_script("search-research", "scripts/search.mjs", [query, research_dir_1, research_dir_2, --tag "tagname"])
   ```
   Search directories should include:
   - Project `research/` for each open project (e.g. `<project>/research/`)
   - Global `~/Notesage/research/`

3. **Read source files.** For each matched result, read the full file content to access the complete article text and frontmatter metadata (title, author, source_url, date_published, tags).

4. **Generate the synthesis.** Produce a well-structured document with these sections:

   **Executive Summary** — 2-3 paragraphs covering the key findings across all sources. What are the main takeaways? What consensus or trends emerge?

   **Per-Source Summaries** — For each source, include:
   - Title and author (with source URL)
   - 3-5 key points or arguments
   - Notable quotes (with attribution)
   - Unique contributions of this source

   **Theme Analysis** — Identify and discuss:
   - Common threads across sources
   - Areas of agreement and disagreement
   - Gaps in coverage — what topics are underrepresented?
   - Evolving perspectives (if sources span different time periods)

   **Suggested Further Research** — Based on the gaps and themes identified, suggest:
   - Specific topics to research next
   - Types of sources that would strengthen the corpus
   - Questions that remain unanswered

5. **Offer next actions.** Use quick replies to let the user choose:

   <quick-replies>
   Save synthesis as file|Insert into document|Go deeper on [first theme]|Find more sources
   </quick-replies>

   - "Save as file": Save to `research/synthesis-{topic}.md` using `save-research` skill
   - "Insert into document": Insert the synthesis at the cursor position in the active document
   - "Go deeper on [theme]": Focus the synthesis on a specific theme identified in the analysis
   - "Find more sources": Suggest search terms or URLs to expand the research corpus

## Guidelines

- Always attribute findings to specific sources — never present information without citing which article it came from
- Use the source's title and author for attribution, not file paths
- If fewer than 2 sources are found, tell the user and suggest collecting more research first
- Keep the executive summary accessible to someone who hasn't read any of the sources
- Prioritize insights that emerge from comparing multiple sources over restating individual articles
