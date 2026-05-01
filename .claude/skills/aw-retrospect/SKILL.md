---
name: aw-retrospect
description: After a claude-authored PR is merged, look for divergence between what the originating skill prescribed and what actually shipped. Propose skill patches as a draft docs PR. Never auto-merges — human reviews every proposed change.
---

# aw-retrospect

After a bot-authored PR is merged (the bot identity is `github-actions[bot]`; legacy `claude[bot]` PRs from before the GITHUB_TOKEN switch are also accepted), run a short retrospective. Identify whether the skill that produced the PR could be improved by what we learned. Propose patches as a separate draft PR.

## Inputs

- `PR_NUMBER` — the merged PR
- The repository's history (the merged PR, the issue it implemented, the skill that produced it)

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
   - **Diff vs declared scope:** the issue body listed "Files likely to change: A, B" but the PR also touched C, D. Either the issue's scope was wrong or the skill should look harder before declaring scope.
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
