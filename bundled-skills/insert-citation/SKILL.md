---
name: insert-citation
description: Insert formatted citations from research sources into documents
user-invocable: true
---

# Insert Citation

Insert a properly formatted citation from the user's research corpus into the active document.

## Workflow

1. **Check citation format preference.** Look at the project metadata for `citationFormat` and `citationStyle` fields. If not set, ask the user which format they prefer:

   - **Inline links** — Simple markdown links: `[Title](url)`
   - **Footnotes** — Footnote markers with references at document end: `[^1]` ... `[^1]: Author. "Title." URL. Date.`
   - **Academic** — Formal citation style. If chosen, ask which sub-style:
     - APA (American Psychological Association)
     - MLA (Modern Language Association)
     - Chicago (Chicago Manual of Style)

   Save their choice to the project metadata (`citationFormat` and optionally `citationStyle`) so it persists for future citations in this project.

2. **Find the source.** Use the `search-research` skill to locate the research file the user wants to cite:
   ```
   execute_skill_script("search-research", "scripts/search.mjs", [query, research_dir_1, research_dir_2])
   ```
   If multiple results match, present them and ask the user to choose.

3. **Read source metadata.** From the matched research file's frontmatter, extract:
   - `title`
   - `author`
   - `source_url`
   - `date_published`
   - `source` (publication name)

4. **Format the citation** according to the chosen style:

### Inline Links

```markdown
[Climate Policy in Europe](https://example.com/article)
```

Insert directly at the cursor position within the text.

### Footnotes

At the citation point in the text:
```markdown
[^1]
```

At the end of the document (create a "References" section if it doesn't exist):
```markdown
[^1]: Smith, J. "Climate Policy in Europe." https://example.com/article. 2026-03-01.
```

Number footnotes sequentially. If the document already has footnotes, continue from the last number.

### Academic — APA

In-text citation:
```markdown
(Smith, 2026)
```

In the References section (create if it doesn't exist, alphabetized by author):
```markdown
Smith, J. (2026). Climate Policy in Europe. *Example Publication*. https://example.com/article
```

### Academic — MLA

In-text citation:
```markdown
(Smith)
```

In the Works Cited section:
```markdown
Smith, John. "Climate Policy in Europe." *Example Publication*, 1 Mar. 2026, example.com/article.
```

### Academic — Chicago

Footnote style:
```markdown
[^1]
```

In the footnotes:
```markdown
[^1]: John Smith, "Climate Policy in Europe," *Example Publication*, March 1, 2026, https://example.com/article.
```

In the Bibliography section:
```markdown
Smith, John. "Climate Policy in Europe." *Example Publication*, March 1, 2026. https://example.com/article.
```

5. **Insert the citation.** Place it at the appropriate location:
   - Inline links and in-text citations: at the cursor position
   - Footnote markers: at the cursor position, with the reference added to the end of the document
   - Bibliography/References entries: in the appropriate section at the end of the document (create if needed)

6. **Offer follow-up actions:**

   <quick-replies>
   Insert another citation|Change citation format|View all citations
   </quick-replies>

## Handling Missing Metadata

- If `author` is missing: use "Unknown" for academic styles, omit for inline links
- If `date_published` is missing: use "n.d." (no date) for academic styles, omit for inline/footnotes
- If `source` (publication name) is missing: omit the italicized publication name
- Always include `source_url` when available — it's the most reliable identifier

## Guidelines

- Always scan for existing footnotes/references in the document before inserting to avoid numbering conflicts
- For academic styles, maintain alphabetical ordering in the bibliography/references section
- If the user says "change citation format," update the project metadata and offer to reformat existing citations
- The user can also directly ask "cite [source name]" without going through the format selection if a format is already set
