---
name: aw-retrospect
description: After a claude-authored PR is merged, look for divergence between what the originating skill prescribed and what actually shipped. Propose skill patches as a draft docs PR. Never auto-merges — human reviews every proposed change.
---

# aw-retrospect

After a bot-authored PR is merged (the bot identity is `github-actions[bot]`; legacy `claude[bot]` PRs from before the GITHUB_TOKEN switch are also accepted), run a short retrospective. Identify whether the skill that produced the PR could be improved by what we learned. Propose patches as a separate draft PR.

## Inputs

- `PR_NUMBER` — the merged PR
- The repository's history (the merged PR, the issue it implemented, the skill that produced it)

## Step 0 — Load accumulated rules (mandatory; before anything else)

Read `.claude/feedback/INDEX.md` then read every `feedback_*.md` whose row lists this skill (or `all`) in `aw_applies_to`. These are corrections from past interactive sessions; they override conflicting guidance in this SKILL.md when they conflict. Skipping this step is the single biggest cause of avoidable AW failures.

For `aw_applies: with-modification` rules, read "user" as the issue or PR thread you're working on — the rule's `aw_note` frontmatter explains the modification.

## Process

1. **Read the merged PR.**
   - `gh pr view $PR_NUMBER --json title,body,additions,deletions,files,commits,reviews,comments`
   - Identify the linked issue from `Implements #N` in the PR body, or the `closes #N` keywords.

2. **Read the linked issue.**
   - `gh issue view $ISSUE_NUMBER --json title,body,labels,comments`
   - Read the comments — pay attention to the `aw-tdd` skill's start/done comments, and any human-authored corrections.

3. **Identify the originating skill.** Most claude PRs come from `aw-tdd`, but also possible: a research PR from `aw-slice`'s research subtask, or a docs PR from a previous retrospective. Check the PR's commit messages and the issue's comments.

4. **Look for divergence signals** between what the skill prescribed and what actually shipped. Run these in order — the first two are deterministic, easy to check, and catch the largest classes of mistake:
   - **Linked issue did NOT auto-close:** find the issue referenced in the PR body (look for `#<N>` mentions; the canonical pattern is `Fixes #N` for bugs and `Resolves #N` for enhancements/chores). Fetch its state via `gh issue view <N> --json state`. If `OPEN` after the PR merged, the skill's PR-body template used a keyword GitHub does NOT recognize (`Implements`, `Addresses`, `Implementing`, etc. — only `close|closes|closed`, `fix|fixes|fixed`, `resolve|resolves|resolved` trigger auto-close). **This is a strong signal — propose a patch.** Verify by checking `gh pr view <PR> --json closingIssuesReferences` is empty even though the PR body names an issue.
   - **Lingering related issues left open:** related issues that should have closed alongside this PR but didn't. Check three relationships:
     1. **Legacy sub-issue parent** — `gh api repos/{owner}/{repo}/issues/<N>/sub_issues --jq '.[] | {number, state}'`. If the merged PR's issue is a sub-issue (its parent has it listed) AND all sibling sub-issues are CLOSED, the parent should be closed too — GitHub does NOT auto-close parents when children close. Propose a patch to whichever skill manages the parent (likely `aw-slice` since the legacy path created the parent/child links).
     2. **Peer split cluster** — search the merged PR's issue body and comments for `Split from #<M>` or peer references. If found, list every peer (the original `#<M>` plus any siblings `gh issue list --search "Split from #<M>"`) and check their state. If most are closed but one or two are stale, flag — usually means a peer was abandoned or its scope was actually rolled into a different PR. The skill that wrote the split (`aw-slice`) should either close peers it abandoned OR cross-link them in their own PR bodies.
     3. **Multi-issue PR coverage** — sometimes a single PR satisfies more than one issue (e.g., a fix that closes both `#X` and a duplicate-but-not-marked `#Y`). Search the PR body and commit messages for ALL `#<N>` references that aren't explicitly marked `closes/fixes/resolves`. If any of those issues are OPEN and the PR's diff actually addresses them, the skill's PR-body rules should require ALL satisfied issues to be listed in the auto-close line (`Resolves #X, #Y`).
   - **Diff vs declared scope:** the issue body listed "Files likely to change: A, B" but the PR also touched C, D. Either the issue's scope was wrong or the skill should look harder before declaring scope.
   - **CI repair commit (`fix(ci):`):** check if the merged PR's branch had a `fix(ci):` commit from `aw-ci-repair` in its history (visible in the PR's commit list or via `gh pr view <PR> --json commits --jq '[.commits[].messageHeadline]'`). A `fix(ci):` commit is a **strong signal** that `aw-tdd` wrote a bare numeric literal in a perf budget assertion instead of wrapping it with `PERF_BUDGET_MULTIPLIER`. Propose a patch to `aw-tdd`'s SKILL.md reinforcing the `PERF_BUDGET_MULTIPLIER` rule.
   - **Manual fixes after merge:** look at the next 5 commits to `main` after the merge. If they fix something the agent introduced, that's a signal.
   - **Review comments:** human reviewers flagged something. Note the topic.
   - **Title or body edited:** the human reviewer rewrote the PR title/body. The skill's PR body template may need updating.
   - **Tests changed during review:** the agent's red tests were modified before merge. The skill's red-test rules need refinement.
   - **Re-runs:** if `aw-tdd` had to retry (failure comment then success), why did the first attempt fail? Add a guard to the skill.

5. **Decide whether to propose a patch.**
   - **Strong signal** (clear cause-and-effect, would prevent a recurring class of mistake): propose.
   - **Weak signal** (one-off, taste, or unclear root cause): skip.
   - **No signal** (clean merge, no divergence): post a positive retrospective comment, do not open a PR.

6. **If proposing a patch:**
   - Read the relevant SKILL.md
   - Make the minimum edit that addresses the signal
   - Create branch `claude-retro/<issue-number>-<skill-name>` (e.g. `claude-retro/64-aw-tdd`)
   - Commit with message `docs(skill): retrospect from #<PR> — <one-line summary>`
   - Open a **draft** PR titled `[retrospect] aw-<skill>: <one-line summary>`
   - PR body: see template below

7. **Post a comment on the merged PR** linking to the retro PR (or noting "no retro action needed").

## Output rules

- **Never** modify the skill directly without a PR. Always go through review.
- **Never** auto-merge the retro PR. Always open as draft.
- **Skip retrospect entirely** if the PR is one of:
  - A retro PR (`[retrospect]` title) — no retros on retros
  - A dependabot/renovate bot PR — not authored by an `aw-*` skill
  - A revert
- **One retro per merged PR**, max one skill patched per retro. If multiple skills could be improved, pick the most impactful and skip the rest (they'll come up again).
- **Idempotent:** if a retro PR for this merged PR already exists (search by branch name `claude-retro/<issue-number>-`), exit silently.

## Comment template

**Retro proposed (skill patch PR opened):**

```
> *Retrospect by `aw-retrospect`. Proposed skill patch in #<retro-pr>.*

**Signal:** <one-line description of what diverged>

**Proposed patch:** <one-line description of the skill change>

Review the draft PR before merging — the skill change applies to all future runs of `aw-<skill>`.
```

**No retro action:**

```
> *Retrospect by `aw-retrospect`. No skill patch proposed.*

This PR shipped cleanly: scope matched, no review pushback, tests held, no follow-up fixes. The originating skill (`aw-<skill>`) worked as designed for this case.
```

## PR body template

```
## Retrospective from #<merged-pr>

Looked at the merged PR for #<issue> and identified one signal worth feeding back into `aw-<skill>`:

### Signal

<one-paragraph description of the divergence>

### Root cause

<one-paragraph description of why the skill produced this divergence>

### Proposed patch

<one-line summary of the SKILL.md change>

### Why this prevents recurrence

<one-paragraph: when a similar PR is opened in the future, this rule catches the issue earlier>

### Out of scope

<other issues observed but not part of this patch — to be addressed in their own retros>

🤖 Generated by `aw-retrospect`. Review and adjust the SKILL.md edit before merging.
```

## Constraints from the dev process

- Triggers on `pull_request.closed` filtered to `merged == true` AND author ∈ {`github-actions[bot]`, `claude[bot]`}. (The current bot identity is `github-actions[bot]`; legacy `claude[bot]` PRs from before the GITHUB_TOKEN switch are also accepted.)
- Open issues in the queue are unaffected. Future agent runs use the patched skill if the retro PR is merged.
- Skill files live at `.claude/skills/aw-<name>/SKILL.md`. Never edit anything outside `.claude/skills/`.

## Most-relevant feedback rules for this skill

When context budget is tight, prioritise loading these rules from
`.claude/feedback/` (the full set is in `.claude/feedback/INDEX.md`).

<!-- BEGIN auto-generated by scripts/gen-feedback-index.py — do not hand-edit -->

**Universal (load for every skill):**

- `.claude/feedback/feedback_delete_old_skills.md` — Never ask the user to run commands or do mechanical steps — just do them yourself
- `.claude/feedback/feedback_generic_voice.md` — Never name the operator, contributors, or individuals when writing rules, READMEs, skill prompts, or commit messages intended to live in the repo. The text must be copy-pasteable to another repo without rewording.
- `.claude/feedback/feedback_write_feedback_to_repo.md` — When saving a memory in a project that has `.claude/feedback/`, behavioural-correction rules (anything that should change future behaviour on the same task class) MUST go in the repo so they're visible to AW agents and travel with the project. Local `~/.claude/projects/<project-slug>/memory/` is only for project-state memories (in-flight work, branch state, scratch notes).

<!-- END auto-generated -->
