---
name: okf-enrich
description: Fill missing type, title, and description frontmatter on documents using structured AI output
user-invocable: true
license: MIT
---

# OKF Enrich

Walk a document — or a set of documents — and fill in the **missing**
`type` / `title` / `description` YAML frontmatter fields. This is the "enrichment
agent" pattern: each field is produced by the model under a strict JSON schema
(via Notesage's `generateStructured()` structured-output infra), so the values
come back in a guaranteed shape, then merged back into the file's frontmatter.

These three fields are what power the wiki reader: the Relations panel's type
badges and headers, and the in-editor link hover previews. Running enrich makes
an ordinary folder of Markdown read like a typed, navigable knowledge base —
this is generic [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) frontmatter, not an
OKF-specific format. No marker file or manifest is required.

**Only missing fields are filled.** Existing `type`, `title`, or `description`
values are never overwritten — enrich is additive. A document that already has
all three is reported as `complete` and skipped.

## What gets filled

| Field | Meaning | How the model derives it |
| --- | --- | --- |
| `type` | The kind of document (a short, lowercase, single-token noun, e.g. `note`, `meeting`, `spec`, `person`, `table`, `concept`, `task`) | Inferred from the content's role |
| `title` | A concise human-readable title | The document's main heading or the gist of the opening |
| `description` | One sentence summarizing what the document is about | A short abstract of the body |

## Workflow

1. **Pick the target(s).** Accept either a single absolute file path or a
   directory. If a directory, ask the user to confirm scope before walking it.
   Only operate on Markdown files (`.md`). Stay inside projects or `~/Notesage`
   — do not enrich files from an arbitrary Explorer folder unless the user
   explicitly asks.

2. **Scan each document** to find which fields are missing and to read the body
   the model needs:

   ```
   execute_skill_script("okf-enrich", "scripts/scan.mjs", [file_path])
   ```

   Output JSON to stdout:
   ```json
   {
     "file": "/abs/path/to/doc.md",
     "missing": ["type", "title", "description"],
     "present": { "title": "Existing Title" },
     "status": "incomplete",
     "body": "first ~4000 chars of the document body (frontmatter stripped)"
   }
   ```

   **status values:**
   - `"incomplete"` — at least one of `type`/`title`/`description` is missing
   - `"complete"` — all three already present; nothing to do, skip this file

   For a directory, run `scan.mjs` once per `.md` file (the script takes one
   path), or pass `--list <dir>` to enumerate the `.md` files first:
   ```
   execute_skill_script("okf-enrich", "scripts/scan.mjs", ["--list", dir_path])
   ```

3. **Generate the missing fields with structured output.** For each document
   with `status: "incomplete"`, produce ONLY the missing fields using
   schema-constrained generation. The shape is guaranteed by the JSON schema —
   the model cannot return a malformed object. Use a schema that includes only
   the keys listed in `missing`, for example (when all three are missing):

   ```json
   {
     "type": "object",
     "additionalProperties": false,
     "required": ["type", "title", "description"],
     "properties": {
       "type":        { "type": "string", "description": "one lowercase single-token noun for the document kind" },
       "title":       { "type": "string", "description": "concise human-readable title" },
       "description": { "type": "string", "description": "one-sentence summary of the document" }
     }
   }
   ```

   Feed the model the `body` returned by `scan.mjs` and ask it to return the
   object. Notesage routes this through `generateStructured()` /
   `buildJsonSchemaResponseFormat()` (see
   `docs/features/ai-providers.md` → "Structured Output (Schema-Constrained
   Generation)"). On `local_bundled` / `openai_compatible` / `ollama` the schema
   is enforced at the token level (GBNF/XGrammar), so output is guaranteed valid.

   Keep values terse: `type` is a single lowercase token, `title` a short phrase,
   `description` a single sentence. Do not include fields that were already
   present — only the missing ones.

4. **Merge the generated fields back into the document.** Pass the model's JSON
   to `apply.mjs`. The script merges the new fields into the existing frontmatter
   — filling only keys that are absent, never overwriting — and prints the full
   merged file content to stdout. **It does not write to disk.**

   ```
   execute_skill_script("okf-enrich", "scripts/apply.mjs", [file_path, fields_json])
   ```

   Where `fields_json` is the model's JSON object as a string, e.g.
   `{"type":"note","title":"Q3 Planning","description":"Notes from the Q3 planning session."}`.

   Output JSON to stdout:
   ```json
   {
     "file": "/abs/path/to/doc.md",
     "applied": ["type", "description"],
     "skipped": ["title"],
     "content": "---\n…merged frontmatter…\n---\n\n…body…\n"
   }
   ```

   - `applied` — fields that were missing and got filled
   - `skipped` — fields the model returned that were already present (left untouched)
   - `content` — the complete merged document to write

5. **Write the file through the approval path.** Take the `content` from step 4
   and write it with the `write_file` tool:

   ```
   write_file(path=file_path, content=<content from apply.mjs>)
   ```

   `write_file` requires user approval — this is intentional. **Never write the
   file from inside a skill script**; enrich only computes the merged content and
   leaves the actual disk write to the approval-gated `write_file` tool. If the
   user denies the write, report it and move on without retrying.

6. **Report the result.** For each document tell the user which fields were
   filled and with what values, and list any skipped (already-complete) files.

## Batch Mode

When enriching a directory:

1. Enumerate the `.md` files (`scripts/scan.mjs --list <dir>`).
2. For each file: scan → (if incomplete) generate → apply → `write_file`.
3. Skip files reported `complete`.
4. Report a summary: how many enriched, how many skipped, how many writes were
   denied, and the list of filled files with the fields added.

Process files sequentially so each `write_file` approval is unambiguous.

## Guidelines

- **Additive only.** Never overwrite an existing `type`/`title`/`description`.
  The merge in `apply.mjs` enforces this, but you should also only ask the model
  for the `missing` fields.
- **Stay in scope.** Enrich projects and `~/Notesage` content. Don't enrich
  files from arbitrary Explorer folders unless the user explicitly points at one.
- **One sentence for `description`** — it feeds a hover preview and a panel row;
  keep it tight.
- **`type` is a single lowercase token** so it renders cleanly as a badge.
- If `scan.mjs` reports `complete`, do nothing for that file — don't re-run the
  model.
- If the document has no readable body (empty file), skip it and tell the user.
