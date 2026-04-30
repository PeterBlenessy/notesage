---
name: wf-triage
description: Classify a fresh GitHub issue (bug / enhancement / chore /
  duplicate / wontfix), set the right category label, and post a brief triage
  comment. Used by the wf-triage GitHub Actions workflow and invokable
  manually.
---

# Issue triage

Classify a single GitHub issue and set its category label. Do not modify the issue body — that is the `wf-clarify` skill's job.

## Inputs

- `ISSUE_NUMBER` — the issue to triage (env var when run from a workflow; pass as argument when run locally)
- The repository's open and closed issues (queried via `gh search issues`)

## Process

1. **Read the issue.**

   - `gh issue view $ISSUE_NUMBER --json title,body,labels,author`
   - Note any explicit hints from the user ("this is a bug", "feature idea", "small refactor").

2. **Search for duplicates and wontfix matches.**

   - Pick 3–5 key terms from the title and body.
   - Run `gh search issues "<terms>" --repo PeterBlenessy/notesage --state all --limit 10`.
   - Compare each candidate's *outcome* (not wording) to the current issue.

3. **Decide a status.** Exactly one of:

   - **Duplicate of an open or merged issue** → close, comment `Duplicate of #N`, add `duplicate` label, stop.
   - **Match for a closed** `wontfix` **issue** → close, comment with the link and the prior reasoning, add `wontfix` label, stop.
   - **Genuinely ambiguous** (one-line title, no body, mixes unrelated topics) → leave `needs-triage`, post a clarification comment, do NOT add a category label, stop.
   - **Otherwise** → continue to step 4.

4. **Classify into exactly one category:**

   - `bug` — broken behavior, regression, error, crash, wrong output
   - `enhancement` — new feature, capability, or material improvement
   - `chore` — refactor, docs-only, dependency bump, tooling, cleanup

5. **Apply labels and comment.**

   - Add the chosen category label.
   - Ensure `needs-triage` is present (add it if missing — fresh issues land without labels). The `wf-clarify` skill flips it to `enhanced` later.
   - Post the triage comment (template below).

## Output rules

- **Exactly one** of `bug` / `enhancement` / `chore` per issue (never two, never zero unless asking for clarification).
- Never modify title or body.
- Never apply state labels beyond `needs-triage`, `duplicate`, or `wontfix` — every other state is owned by a downstream skill.
- **Idempotent** — running twice on the same issue produces the same result.

## Comment templates

**Successful classification:**

```
> *Triaged automatically by the `wf-triage` skill. Reply if the classification looks wrong.*

**Classification:** `<category>` — <one-sentence reason>

**Considered duplicates:** <#N comma-list, or "none found">
```

**Closed as duplicate:**

```
> *Triaged automatically by the `wf-triage` skill.*

Duplicate of #N — <one-sentence reason the outcomes match>.
```

**Closed as wontfix (matches a prior wontfix decision):**

```
> *Triaged automatically by the `wf-triage` skill.*

This matches the outcome of #N, which was closed as `wontfix`. Closing for the same reason: <quote or summarize the prior decision>.

If the situation has materially changed, reopen with new context.
```

**Asking for clarification:**

```
> *Triaged automatically by the `wf-triage` skill.*

I couldn't confidently classify this. Could you clarify:

- <specific question 1>
- <specific question 2>

Once you reply, I'll re-run triage.
```

## When to ask for clarification instead of classifying

- Title is one or two words with no body
- "Idea" or "thinking about" without a stated problem or outcome
- Mixes multiple unrelated changes (ask the user to split)
- Mentions UI/UX feel without describing what is wrong or what would be better

In all of these: leave `needs-triage`, post the clarification template, do not add a category label.

## Constraints from the dev process

- Categories are mutually exclusive in this repo's scheme. Do not stack `bug` + `enhancement`.
- Area labels (`backend`, `frontend`, `rust`, `javascript`, `dependencies`, `documentation`) are NOT this skill's job — leave existing area labels alone, do not add new ones.
- The `enhanced` label is set by `wf-clarify`, not here.