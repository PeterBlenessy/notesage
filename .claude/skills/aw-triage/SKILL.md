---
name: aw-triage
description: Classify a fresh top-level GitHub issue (bug / enhancement / chore / duplicate / wontfix), set the category label, mark it as `feature` (parent), and add the `refine` action label so aw-refine picks it up next.
---

# aw-triage

Classify a single top-level GitHub issue and set its category label. Don't modify the body — that is `aw-refine`'s job.

## Inputs

- `ISSUE_NUMBER` — the issue to triage
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
   - **Match for a closed `wontfix` issue** → close, comment with the link and the prior reasoning, add `wontfix` label, stop.
   - **Genuinely ambiguous** (one-line title, no body, mixes unrelated topics) → post a clarification comment, do NOT add a category label, do NOT add `refine`. Stop.
   - **Otherwise** → continue to step 4.

4. **Classify into exactly one category:**
   - `bug` — broken behavior, regression, error, crash, wrong output
   - `enhancement` — new feature, capability, or material improvement
   - `chore` — refactor, docs-only, dependency bump, tooling, cleanup

5. **Apply labels and comment.**
   - Add the chosen category label.
   - Add the `refine` action label (signals `aw-refine` to pick this up next).
   - Post the triage comment (template below).

## Output rules

- **Exactly one** of `bug` / `enhancement` / `chore` per issue (or none, if asking for clarification).
- **Exactly one** action label after a successful run: `refine`. Never set `slice`, `sliced`, `tdd`, or `review` here.
- Never modify title or body.
- **Idempotent** — running twice on the same issue produces the same result. The workflow precheck filters re-runs by checking for an existing category; the skill should still no-op if it sees one.

## Comment templates

**Successful classification:**

```
> *Triaged automatically by the `aw-triage` skill. Reply if the classification looks wrong.*

**Classification:** `<category>` — <one-sentence reason>

**Considered duplicates:** <#N comma-list, or "none found">
```

**Closed as duplicate:**

```
> *Triaged automatically by the `aw-triage` skill.*

Duplicate of #N — <one-sentence reason the outcomes match>.
```

**Closed as wontfix:**

```
> *Triaged automatically by the `aw-triage` skill.*

This matches the outcome of #N, which was closed as `wontfix`. Closing for the same reason: <quote or summarize the prior decision>.

If the situation has materially changed, reopen with new context.
```

**Asking for clarification:**

```
> *Triaged automatically by the `aw-triage` skill.*

I couldn't confidently classify this. Could you refine:

- <specific question 1>
- <specific question 2>

Once you reply, I'll re-run triage.
```

## When to ask for clarification instead of classifying

- Title is one or two words with no body
- "Idea" or "thinking about" without a stated problem or outcome
- Mixes multiple unrelated changes (ask the user to split)
- Mentions UI/UX feel without describing what is wrong or what would be better

In all of these: post the clarification template, do not add a category, do not add `refine`. The issue stays untriaged.

## Constraints from the dev process

- Categories are mutually exclusive: do not stack `bug` + `enhancement`.
- Area labels (`backend`, `frontend`, `rust`, `javascript`, `dependencies`, `documentation`) are NOT this skill's job — leave existing area labels alone, do not add new ones.
- After a successful run: issue has `<category>` + `refine` (plus any pre-existing area labels).
- `feature` ≠ category. `feature` is the "this is a top-level issue" marker, set on all parents regardless of whether they're bugs, enhancements, or chores. `enhancement` is the category for "new functionality / improvement". They co-exist on a feature-request issue: `enhancement + feature + refine`.
