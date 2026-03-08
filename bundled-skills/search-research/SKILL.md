---
name: search-research
description: Search saved research files by tag, keyword, or content
user-invocable: true
---

# Search Research

Search through saved research files to find articles, notes, and sources by topic, tag, or keyword. Works across all research directories in the current workspace and the global library.

## Workflow

1. **Get the search query.** Ask the user what they're looking for — a topic, tag name, keyword, or phrase.

2. **Determine search directories.** Gather all research directories to search:
   - For each open project in the workspace: `<project_path>/.notesage/research/`
   - Global research directory: `~/Notesage/.notesage/research/`
   - Only include directories that exist.

3. **Run the search script:**
   ```
   execute_skill_script("search-research", "scripts/search.mjs", [query, ...search_dirs])
   ```

   **Optional flags:**
   - `--tag "tagname"` — filter results to only files with an exact tag match (case-insensitive)
   - `--limit 20` — limit the number of results returned (default: 50)

   Flags go after the directories. Examples:
   ```
   execute_skill_script("search-research", "scripts/search.mjs", [query, dir1, dir2, "--tag", "ai", "--limit", "10"])
   execute_skill_script("search-research", "scripts/search.mjs", [query, dir1])
   ```

   Output JSON array to stdout:
   ```json
   [
     {
       "file": "/path/to/research/article.md",
       "title": "Article Title",
       "tags": ["ai", "research"],
       "source_url": "https://example.com/article",
       "snippet": "First 200 characters of the article body...",
       "relevance": 1.0,
       "date_saved": "2026-03-01"
     }
   ]
   ```

   **Relevance scoring:**
   - `1.0` — query matches the title
   - `0.8` — query matches a tag
   - `0.6` — query matches the source URL
   - `0.5` — query matches body content
   - Highest applicable score is used when multiple fields match

4. **Present results to the user.** For each result, show:
   - **Title** and relevance indicator
   - **Tags** (if any)
   - **Source URL** (if any, as a clickable link)
   - **Date saved**
   - **Snippet** of the content

   If no results are found, tell the user and suggest broadening the search or trying different keywords.

5. **Offer to open results.** Ask the user if they'd like to open any of the found files. If they select one, open it in the editor.

## Tag Search

When the user asks to "find articles tagged X" or "search by tag X", use the `--tag` flag for precise matching:
```
execute_skill_script("search-research", "scripts/search.mjs", ["", dir1, "--tag", "machine-learning"])
```

The query can be empty when using `--tag` alone — this returns all files with that tag.

## Error Handling

- If no research directories exist, inform the user that no research has been saved yet and suggest using the `download-webpage` skill to start collecting research.
- If all directories are empty, return an empty result set.
- If the script fails, show the error from stderr.
