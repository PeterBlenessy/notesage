---
name: download-webpage
description: Download a web page by URL and save it as clean markdown with images
user-invocable: true
---

# Download Webpage

Download a web page, extract the main article content, download referenced images, and save it all as a clean markdown file.

## Workflow

1. **Get the URL.** Ask the user for the URL to download, or receive it as part of a batch operation.

2. **Ask where to save the file.** This is required — do not skip this step. Ask the user for an output folder path. Suggest a reasonable default like `articles/` in the current project, but always confirm before proceeding.

3. **Ensure dependencies are installed** (first use only):
   ```
   execute_skill_script("download-webpage", "scripts/setup.sh", [skill_scripts_dir])
   ```
   Where `skill_scripts_dir` is the absolute path to the skill's `scripts/` directory.

4. **Run the download script:**
   ```
   execute_skill_script("download-webpage", "scripts/download.mjs", [url, output_dir])
   ```

   The script:
   - Fetches the page and extracts article content
   - Downloads all referenced images to `<output_dir>/images/`
   - Rewrites image URLs in the markdown to use local relative paths
   - Saves the markdown file with YAML frontmatter

   Output JSON to stdout:
   ```json
   {
     "title": "Article Title",
     "url": "https://example.com/article",
     "file": "/path/to/saved/article-title.md",
     "wordCount": 1234,
     "images": 5,
     "status": "created"
   }
   ```

   **status values:**
   - `"created"` — new file saved
   - `"exists"` — file already exists, nothing was written
   - `"overwritten"` — existing file was replaced (when `--force` was used)

5. **Handle existing files.** If `status` is `"exists"`, you MUST present exactly these three choices as a numbered list:
   1. **Overwrite** — re-run with `--force` flag: `[url, output_dir, "--force"]`
   2. **Keep both** — rename the existing file by appending `-1` (or `-2`, etc.) to the filename, then re-run without `--force`
   3. **Skip** — do nothing, move to the next URL

6. **Report the result.** Tell the user:
   - The article title and word count
   - How many images were downloaded
   - Where the file was saved
   - If the download failed, show the error from stderr

## Batch Mode

When processing multiple URLs (e.g., from a bookmarks file):

1. Read the bookmarks file and extract all URLs
2. Run the download script for each URL sequentially
3. Report a summary: how many succeeded, how many failed, and the list of saved files

## Error Handling

- If the URL is unreachable, report the HTTP error
- If the page has no extractable content, save whatever is available with a warning
- If an image fails to download, keep the original URL in the markdown and continue
- Do not check for file existence yourself — just run the script and handle the `status` field

## Research Mode

When the user is saving a page for research purposes (mentions "research", "save for later", "add to research", "collect", etc.):

1. **Default output directory:** Use `research/` in the current project (e.g. `<project>/research/`) instead of asking for a custom directory. If no project is open, use `~/Notesage/research/`.

2. **Pass tags:** If the user specified any tags (e.g., "save this for my #climate research"), pass them via the `--tags` flag:
   ```
   execute_skill_script("download-webpage", "scripts/download.mjs", [url, output_dir, "--tags", "climate"])
   ```

3. **Post-download organization:** After a successful download, mention that the `save-research` skill can be used to further organize the file (add more tags, move between directories, update metadata).

4. **Research frontmatter:** The download script automatically includes research-friendly frontmatter fields (`source_url`, `date_saved`, `date_published`, `author`, `tags`, `word_count`), so no additional processing is needed.

When the user is NOT in a research context (just wants to download a page to a specific directory), follow the standard workflow above — ask for the output directory as usual.
