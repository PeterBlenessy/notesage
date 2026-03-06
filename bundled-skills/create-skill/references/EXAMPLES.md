# Example Skills

## 1. Simple Prompt-Only Skill

A skill with no scripts — just instructions for the AI.

```
proofread/
  SKILL.md
```

```markdown
---
name: proofread
description: Proofread text for grammar, spelling, punctuation, and clarity
user-invocable: true
---

# Proofread

Review the provided text and fix:
- Grammar and spelling errors
- Punctuation issues
- Awkward phrasing
- Unclear sentences

Preserve the author's voice and tone. Only fix errors — do not rewrite for style unless asked.

Output the corrected text, then list the changes you made.
```

## 2. Skill with Scripts

A skill that uses a script to fetch and process data.

```
summarize-url/
  SKILL.md
  scripts/
    fetch-page.sh
```

```markdown
---
name: summarize-url
description: Fetch a web page and summarize its content
user-invocable: true
---

# Summarize URL

When the user provides a URL:

1. Run `scripts/fetch-page.sh <url>` to download and extract the page text
2. Read the output (plain text content of the page)
3. Write a concise summary covering:
   - Main topic and key points
   - Important facts or figures
   - Author's conclusions (if any)
4. Keep the summary under 300 words
```

`scripts/fetch-page.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
URL="${1:?Usage: fetch-page.sh <url>}"
curl -sL "$URL" | sed 's/<[^>]*>//g' | tr -s '[:space:]' ' ' | head -c 10000
```

## 3. Skill with References

A skill that uses reference documents for context.

```
code-review/
  SKILL.md
  references/
    style-guide.md
    common-issues.md
```

```markdown
---
name: code-review
description: Review code changes following project style guidelines
user-invocable: true
---

# Code Review

Review the provided code changes. Consult `references/style-guide.md` for project conventions and `references/common-issues.md` for known pitfalls.

For each issue found, provide:
- **File and line** — where the issue is
- **Severity** — error, warning, or suggestion
- **Description** — what's wrong and why
- **Fix** — how to resolve it

Organize feedback by file. Start with errors, then warnings, then suggestions.
```
