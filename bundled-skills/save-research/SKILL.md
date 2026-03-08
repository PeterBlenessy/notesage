---
name: save-research
description: Save and organize research files with metadata and tags
user-invocable: true
---

# Save Research

Save and organize research content with structured metadata — pasted text, URLs, or existing files are stored as clean markdown with YAML frontmatter in the project's research directory.

## Workflow

1. **Get the content.** Accept content from the user. This can be:
   - **Pasted text** — raw content to save directly
   - **A URL** — delegate to the `download-webpage` skill first to fetch and convert the page, then organize the result with `save-research`
   - **A file path** — an existing file on disk to organize into the research directory

2. **Ask for metadata.** Ask the user for:
   - **Tags** (required) — comma-separated tags for categorization (e.g., `ai, machine-learning, transformers`)
   - **Title** (optional) — a descriptive title. If not provided, the script will try to extract one from existing frontmatter or use "untitled-research"
   - **Author** (optional) — the content author

3. **Determine the output directory.** Default to `.notesage/research/` in the current project. If no project is open, use `~/Notesage/.notesage/research/`. Always confirm the output directory with the user before proceeding.

4. **If the input is a URL**, run the `download-webpage` skill first:
   ```
   execute_skill_script("download-webpage", "scripts/download.mjs", [url, output_dir, "--tags", "tag1,tag2"])
   ```
   Then use the resulting file path as input to `save-research` to ensure consistent metadata and organization. If `download-webpage` already saved the file with the correct metadata, you can skip re-saving and just report the result.

5. **Run the save script:**
   ```
   execute_skill_script("save-research", "scripts/save.mjs", [content_or_path, output_dir, "--title", "Article Title", "--tags", "tag1,tag2"])
   ```

   Optional flags:
   - `--url "https://..."` — source URL for attribution
   - `--author "Author Name"` — content author
   - `--force` — overwrite an existing file with the same name or source URL

   For pasted text content, pass the text as the first argument. For file paths, pass the absolute path — the script detects whether the argument is an existing file and reads from it.

   Output JSON to stdout:
   ```json
   {
     "file": "/path/to/saved/article-title.md",
     "title": "Article Title",
     "tags": ["tag1", "tag2"],
     "status": "created"
   }
   ```

   **status values:**
   - `"created"` — new file saved
   - `"exists"` — file already exists (by filename or matching `source_url`), nothing was written
   - `"overwritten"` — existing file was replaced (when `--force` was used)

6. **Handle existing files.** If `status` is `"exists"`, you MUST present exactly these three choices as a numbered list:
   1. **Overwrite** — re-run with `--force` flag added to the arguments
   2. **Keep both** — rename the existing file by appending `-1` (or `-2`, etc.) to the filename, then re-run without `--force`
   3. **Skip** — do nothing, move on

7. **Report the result.** Tell the user:
   - The saved file title and location
   - The tags applied
   - If the save failed, show the error from stderr

## Batch Mode

When processing multiple items (e.g., a list of text snippets or file paths):

1. Process each item sequentially using the save script
2. Report a summary: how many succeeded, how many failed, and the list of saved files with their tags

## Error Handling

- If content is empty, report the error from the script
- If the output directory cannot be created, report the filesystem error
- If a file path argument does not exist on disk, the script treats it as inline text content — this is intentional
- Do not check for file existence yourself — just run the script and handle the `status` field
