---
name: aw-triage
description: Classify a fresh GitHub issue (bug / enhancement / chore / duplicate / wontfix), set the category label, and add the `refine` action label so aw-refine picks it up next.
---

# aw-triage

Classify a single top-level GitHub issue and set its category label. Don't modify the body — that is `aw-refine`'s job.

## Inputs

- `ISSUE_NUMBER` — the issue to triage
- The repository's open and closed issues (queried via `gh search issues`)

## Step 0 — Load accumulated rules (mandatory; before anything else)

Read `.claude/feedback/INDEX.md` then read every `feedback_*.md` whose row lists this skill (or `all`) in `aw_applies_to`. These are corrections from past interactive sessions; they override conflicting guidance in this SKILL.md when they conflict. Skipping this step is the single biggest cause of avoidable AW failures.

For `aw_applies: with-modification` rules, read "user" as the issue or PR thread you're working on — the rule's `aw_note` frontmatter explains the modification.

## Process

1. **Read the issue.**
   - `gh issue view $ISSUE_NUMBER --json title,body,labels,author`
   - Note any explicit hints from the user ("this is a bug", "feature idea", "small refactor").

2. **Search for duplicates and wontfix matches.**
   - Pick 3–5 key terms from the title and body.
   - Run `gh search issues "<terms>" --repo "$(gh repo view --json nameWithOwner --jq .nameWithOwner)" --state all --limit 10`.
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

4.5. **Out-of-AW-scope check (dependency bumps).** If the issue is a dependency upgrade — `chore(deps)`, lockfile update, package bump, lint sweep across the codebase — do NOT proceed with the standard refine→slice→tdd pipeline. Per `feedback_aw_dep_upgrades`, AW has historically failed to close these out cleanly (test failures from the upstream change cascade through multiple AW retries without converging). Instead: add labels `chore` + `needs-human` (do NOT add `refine`), post the out-of-scope comment template, and exit. The operator handles the bump locally and batch-merges.

5. **Apply labels and comment.**
   - Add the chosen category label.
   - Add the `refine` action label (signals `aw-refine` to pick this up next).
   - Post the triage comment (template below).

## Output rules

- **Exactly one** of `bug` / `enhancement` / `chore` per issue (or none, if asking for clarification).
- **Exactly one** action label after a successful run: `refine` for in-scope issues, OR `needs-human` for out-of-AW-scope dependency bumps (step 4.5). Never set `slice`, `sliced`, `tdd`, or `review` here.
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

**Out-of-AW-scope (dependency bump / lint sweep):**

```
> *Triaged automatically by the `aw-triage` skill.*

**Classification:** `chore` — dependency bump / lockfile update / lint sweep.

This kind of change has historically not converged through the AW pipeline (per `feedback_aw_dep_upgrades`): upstream behavioural changes cascade into test failures that AW retries fail to resolve. Marking `needs-human` for local handling — the operator updates, runs the suite, and batch-merges.

If this should run through AW anyway, remove the `needs-human` label and add `refine`.
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
- The `feature` label is **deprecated** and must NOT be added. It was a parent marker from the original sub-issue / parent–child design that we pivoted away from in favor of peer-issue splits. New work uses the category label (`bug` / `enhancement` / `chore`) alone — there is no separate "this is a parent" marker. If you encounter an issue with the legacy `feature` label, leave it as-is (don't strip historical labels) but do not add it to new issues.

## Most-relevant feedback rules for this skill

When context budget is tight, prioritise loading these rules from
`.claude/feedback/` (the full set is in `.claude/feedback/INDEX.md`).

<!-- BEGIN auto-generated by scripts/gen-feedback-index.py — do not hand-edit -->

**Universal (load for every skill):**

- `.claude/feedback/feedback_delete_old_skills.md` — Never ask the user to run commands or do mechanical steps — just do them yourself
- `.claude/feedback/feedback_generic_voice.md` — Never name the operator, contributors, or individuals when writing rules, READMEs, skill prompts, or commit messages intended to live in the repo. The text must be copy-pasteable to another repo without rewording.
- `.claude/feedback/feedback_write_feedback_to_repo.md` — When saving a memory in a project that has `.claude/feedback/`, behavioural-correction rules (anything that should change future behaviour on the same task class) MUST go in the repo so they're visible to AW agents and travel with the project. Local `~/.claude/projects/<project-slug>/memory/` is only for project-state memories (in-flight work, branch state, scratch notes).

**Specific to `aw-triage`:**

- `.claude/feedback/feedback_aw_dep_upgrades.md` — Don't route dep bumps / lint sweeps / mechanical changes through the AW pipeline — do them locally, batch-merge them
- `.claude/feedback/feedback_issue_titles_plain.md` — The repo follows Conventional Commits (`feat(area):`, `fix(area):`, etc.) for commit messages and PR titles, but ISSUE titles should remain plain descriptive — no verb-prefix, no scope. The verb prefix can be presumptuous at the issue stage (you don't yet know if it's a fix vs feat) and the type often drifts through triage/refine anyway.

<!-- END auto-generated -->
