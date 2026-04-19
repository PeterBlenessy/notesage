---
name: liteparse
description: Parse PDFs, Office documents, and images into markdown text or page screenshots using LlamaIndex liteparse
user-invocable: true
---

# Liteparse

Extract text and screenshots from PDFs, Office documents (Word, PowerPoint, Excel), and images using the `lit` CLI from [LlamaIndex liteparse](https://github.com/run-llama/liteparse). Output is written to a file the user chooses — stdout stays small so large documents do not flood the AI context window.

Use this skill when the user asks to:

- Read, summarize, or ask questions about a PDF, DOCX, PPTX, XLSX, or image file
- Convert a non-markdown document into a markdown file they can edit
- Run OCR on a scanned PDF or photo of text
- Produce page screenshots of a PDF for visual inspection (pass them back through the chat attachment flow)

## Prerequisites

`lit` must be on the user's `PATH`. Non-PDF formats also require LibreOffice (Office formats) and ImageMagick (image formats).

Always run `setup.sh` first. It is idempotent — it only prints install instructions when something is missing.

```
execute_skill_script("liteparse", "scripts/setup.sh", [])
```

If the script exits non-zero, show the user the missing-dependency message verbatim and stop. Do **not** attempt to install anything on their behalf.

## Workflow — Parse a document

1. **Get the input path.** Ask the user for the absolute path to the document if you do not already have it from the conversation (e.g., a file they opened, a research attachment, or a paste).

2. **Ask where to save the extracted text.** Default to a sibling `.md` file (e.g., `report.pdf` → `report.md`), but confirm before writing. For research ingestion, default to `.notesage/research/` in the current project.

3. **Run the parse script:**
   ```
   execute_skill_script("liteparse", "scripts/parse.sh", [input_path, output_path])
   ```

   Optional flags:
   - `--format "markdown"` — output format. Defaults to `markdown`. Other values: `text`, `json`.
   - `--no-ocr` — disable OCR entirely. Use this for digital-native PDFs where OCR is wasteful.
   - `--ocr-language "eng"` — Tesseract language code. Default `eng`. Use e.g. `swe` for Swedish, `fra+eng` for multi-language.
   - `--password "secret"` — password for encrypted PDFs.

   Output JSON on stdout:
   ```json
   {
     "file": "/path/to/output.md",
     "format": "markdown",
     "bytes": 48213,
     "ocrUsed": false,
     "status": "created"
   }
   ```

   **status values:**
   - `"created"` — new file saved
   - `"exists"` — file already exists, nothing was written
   - `"overwritten"` — existing file was replaced (when `--force` was used)

4. **Handle existing files.** If `status` is `"exists"`, present exactly these three options as a numbered list:
   1. **Overwrite** — re-run with `--force` added to the flags
   2. **Keep both** — append `-1` (or `-2`, etc.) to the output filename and re-run
   3. **Skip** — do nothing

5. **Report the result.** Tell the user the page count, whether OCR ran, and the output path. Offer to open the file as a new tab.

## Workflow — Screenshot PDF pages

Use this when the user wants to *see* specific pages (e.g., "show me page 3 of this PDF") or when you need to feed a vision model a page that liteparse cannot faithfully text-extract (complex tables, diagrams, handwriting where OCR quality is low).

1. **Get the input path and page range.** Page range syntax matches liteparse: `"1-5"`, `"1,3,7"`, `"all"`.

2. **Decide the output directory.** Use a temp directory under the project (e.g., `.notesage/tmp/screenshots/<doc-name>/`) unless the user specifies otherwise.

3. **Run the screenshot script:**
   ```
   execute_skill_script("liteparse", "scripts/screenshot.sh", [input_path, output_dir, "--target-pages", "1-5"])
   ```

   Optional flags:
   - `--dpi "150"` — render resolution. Default 150. Use 72 for drafts, 300 for print fidelity.
   - `--format "png"` — image format (`png` or `jpg`). Default `png`.

   Output JSON on stdout:
   ```json
   {
     "dir": "/path/to/screenshots",
     "pages": [
       { "page": 1, "file": "/path/to/screenshots/page-001.png" },
       { "page": 2, "file": "/path/to/screenshots/page-002.png" }
     ],
     "status": "created"
   }
   ```

4. **Follow-up.** After generating screenshots, suggest the user right-click "Add to chat" on any of the PNGs to attach them to the conversation for vision-based reasoning. Do not attempt to attach images yourself — the attachment event bus is user-driven.

## Error handling

- If `lit` is missing, `setup.sh` exits with a clear install snippet. Relay it verbatim.
- If LibreOffice is missing and the input is `.docx` / `.pptx` / `.xlsx`, the CLI errors out. Tell the user which dependency is missing and the install command.
- If OCR fails on a specific page, liteparse continues with a blank; report that the output may be incomplete.
- For encrypted PDFs without `--password`, surface the CLI error and ask the user for the password.

## When not to use this skill

- **Already a markdown file** — just read it directly with `read_file`.
- **User wants to *render* a PDF interactively** — open it as a tab instead; the built-in PDF viewer supports search and navigation.
- **User wants to *edit* an Office document** — converting to markdown is lossy; suggest they edit the original in its native app.

## Notes for AI

- The parse output can be large. Always write to a file and only read back the subset you need via `read_file` with line ranges.
- When summarizing a long PDF, parse once, then use structured slicing (e.g., read the first 200 lines, then the last 200) before synthesizing.
- For research ingestion, chain with `save-research` to add tags and frontmatter after parsing.
