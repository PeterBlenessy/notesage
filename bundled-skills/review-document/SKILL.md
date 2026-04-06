---
name: review-document
description: Review documents and fix comments
user-invocable: true
---

# Review Document

Review a document by adding inline comments, then fix the issues raised. Two workflows: **Document Review** (read and comment) and **Comment Fixing** (read comments, edit, resolve).

## How It Works

Comments are added by writing a JSON file to the project's `.notesage/pending-comments/` directory. Notesage automatically detects the file, anchors each comment to the matching text, and creates inline highlights in the editor. The JSON file is updated with results (comment IDs and statuses) so you can read them back.

This works on **any document** in the project — it doesn't need to be open in the editor. You can review a single file or iterate over an entire project.

## Workflow 1: Document Review

1. **Read the document** to analyze its content.

2. **Analyze** for issues — clarity, tone, grammar, structure, accuracy. Focus on one category at a time.

3. **Write a pending comments file** to `<project_root>/.notesage/pending-comments/<name>.json`:

   ```json
   {
     "file": "relative/path/to/document.md",
     "comments": [
       { "anchor_text": "the exact text to highlight", "body": "[Important] This needs clarification — consider explaining why." },
       { "anchor_text": "another passage from the document", "body": "[Suggestion] Simplify to: 'Users can configure...'" }
     ]
   }
   ```

   **Rules:**
   - `file` is relative to the project root (e.g., `"notes/architecture.md"`)
   - `anchor_text` must be an **exact substring** copied from the document
   - **Use the plain text content**, not markdown syntax — e.g., use `"My Heading"` not `"## My Heading"`, use `"bold text"` not `"**bold text**"`. Notesage strips markdown formatting when matching.
   - Use longer, unique passages (10+ words) to avoid matching the wrong location
   - For headings, include a few words from the following paragraph to make the anchor unique
   - Optional: `"occurrence": 2` to target the 2nd occurrence of repeated text

4. **Wait briefly**, then read the file back to confirm results:

   ```json
   {
     "file": "notes/architecture.md",
     "status": "processed",
     "added": 3,
     "skipped": 1,
     "comments": [
       { "anchor_text": "...", "body": "...", "status": "added", "comment_id": "abc-123" },
       { "anchor_text": "...", "body": "...", "status": "skipped", "reason": "text not found" }
     ]
   }
   ```

   The `comment_id` values are needed for Workflow 2 (resolving comments).

5. **Summarize the review** for the user — how many comments, severity breakdown, top priorities.

## Workflow 2: Comment Fixing

1. **Read the pending comments file** (from a previous review) to get comment IDs and anchors.

2. **Read the document** to get the current content.

3. **Fix each issue** by editing the document. Write the corrected content back to the file.

4. **Write a resolution file** to `.notesage/pending-comments/resolve-<name>.json`:

   ```json
   {
     "file": "relative/path/to/document.md",
     "resolve": ["abc-123", "def-456"]
   }
   ```

   Notesage detects this and marks those comments as resolved (removes the highlight).

5. **Report** what was fixed and which comments were resolved.

## Reviewing an Entire Project

To review all documents in a project:

1. List the project directory to find all `.md` files
2. For each file, read it, analyze, and write a pending comments file
3. Use a unique name per file: `.notesage/pending-comments/review-{filename}.json`

## Comment Style Guide

Write comments that are **concise, actionable, and specific**. Every comment should tell the author exactly what to change and why.

### Severity Prefixes

| Severity | When to Use | Prefix |
|----------|-------------|--------|
| **Suggestion** | Nice-to-have improvements | `[Suggestion]` |
| **Important** | Should fix before publishing | `[Important]` |
| **Critical** | Must fix — errors, misleading claims | `[Critical]` |

### Example Comments

```
[Important] This sentence is 47 words long. Break it into two: one for the cause, one for the effect.
```

```
[Suggestion] "You must never do this" sounds prescriptive. Consider "Avoid this pattern because..."
```

```
[Critical] This claims the API returns JSON by default, but the docs say XML. Verify and correct.
```

## Tips

- **Focus scope.** Prioritize high-impact issues first. Don't flag every minor style preference.
- **Avoid redundant comments.** If the same issue appears 5 times, comment once and note "This pattern appears 4 more times."
- **Be specific.** Don't say "reword this" — suggest the rewording.
- **Section-focused review.** For long documents, offer to review one section at a time.
