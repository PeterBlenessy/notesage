---
name: aw-review
description: Independent reviewer of a draft PR opened by aw-tdd. Reads the issue body PLUS every comment posted after the latest `refined` marker, reads the PR diff and tests, and verifies that EVERY acceptance criterion AND every user-comment scope-change is satisfied. Posts a per-criterion checklist; if gaps are found, closes the PR and resets the issue to tdd+afk so aw-tdd can retry with the gap list as context.
---

# aw-review

Independent reviewer for a `claude[bot]` / `github-actions[bot]`-authored draft PR. Reads the issue cold, reads the PR cold, judges whether the implementation actually matches the user's stated bar.

The purpose is to catch failure modes that paper-pass-via-tests miss:
- Stale issue body (user added scope in comments that `aw-refine` didn't fold in)
- Narrow scope (agent took "all X" too literally)
- Qualitative criteria with no test ("more prominent", "consistent across themes", "visually unambiguous")
- Silent acceptance-criteria misses (test asserts presence, not the property the criterion names)

Runs as a SEPARATE workflow (`aw-review.yml`) on a fresh runner. The reviewer agent has NO shared context with the implementer — same pattern as a two-pizza review where the implementer and the reviewer are different people.

## Inputs

- `PR_NUMBER` — the draft PR to review
- The repo is checked out by the workflow (read-only — this skill never modifies code)

## Step 0 — Load accumulated rules (mandatory; before anything else)

Read `.claude/feedback/INDEX.md` then read every `feedback_*.md` whose row lists this skill (or `all`) in `aw_applies_to`. These are corrections from past interactive sessions; they override conflicting guidance in this SKILL.md when they conflict. Skipping this step is the single biggest cause of avoidable AW failures.

For `aw_applies: with-modification` rules, read "user" as the issue or PR thread you're working on — the rule's `aw_note` frontmatter explains the modification.

## Pre-flight

1. **Read the PR.** `gh pr view N --json title,body,labels,files,headRefName,author,isDraft,state`
   - Author must be `github-actions[bot]` or `claude[bot]` / `app/claude`. If not, exit silently.
   - State must be `OPEN` and `isDraft == true`. If not, exit silently.
2. **Find the linked issue.** Look for `Fixes #M` / `Resolves #M` / `Closes #M` (case-insensitive) in the PR body. If none, post a "no linked issue, cannot review" comment and exit.
3. **Read the issue + comments.** `gh issue view M --json body,labels,comments,timeline`
4. **Identify scope changes from comments.** Find every comment posted after the most recent timestamp where the `refined` label was added (use the timeline). These are user clarifications that may have been missed by `aw-refine` when it re-ran.
5. **Read the PR diff.** `gh pr diff N`
6. **Read the PR's test files** for any added or changed tests.

## Review process

### Outcome reread (before scoring criteria)

Before opening the criteria checklist, read the issue body's first paragraph (the operator's stated outcome) AND every comment posted since the latest `refined` marker. Ask the question that tests-passing does NOT answer: **if the operator opens this PR, do they get the experience they described?** Per `feedback_outcome_shaped_criteria`, criteria that name files/lines/functions are *suggested* implementation hints, not the bar. Per `feedback_code_review_mandatory_gate`, tests-green is necessary but not sufficient — read the diff with critical intent. If the diff satisfies every criterion but the user-observable outcome is something else (because the criteria over-specified the wrong implementation), the criteria were wrong; surface the gap as **✗ Outcome miss** in the review comment rather than approving the literal-but-wrong fix.

### Per acceptance criterion

For each item in the issue body's `## Acceptance criteria` checklist, classify. Remember from the outcome reread above: a criterion that passes literally while the outcome misses is still a gap. When in doubt, prefer the outcome to the literal criterion text.

#### Concrete (assert-testable)

The criterion names a specific file, function, behavior, or testable property. Verify:
- Does the diff change a file or behavior the criterion requires?
- Is there a test asserting the changed behavior?

→ **✓ Covered** if both yes; **✗ Missing** if either no.

#### Qualitative

The criterion uses words like *"more prominent"*, *"consistent across themes"*, *"sufficient contrast"*, *"visually unambiguous"*, *"user-friendly"*, *"polished"*. These can't be verified by assertion alone.

For each:
- Identify what the diff does that purportedly addresses the property (e.g. "increased strokeWidth from 1.5 to 2.5").
- Check whether tests verify the property (assertion on the strokeWidth class, snapshot of the rendered element, contrast assertion).
- If tests don't verify it, mark **⚠ Needs human visual review** and call out: "Tests assert presence/absence but not the qualitative property the criterion names."

→ **⚠ Needs human visual review** is acceptable for clean review. **Don't approve silently** — always flag.

#### Universal claims ("all X", "every Y", "across all", "consistently")

The criterion uses universal language. Verify by enumeration:
- Identify the pattern the universal refers to (e.g. "all command-bar pickers" → grep for picker components; "across all themes" → check both light and dark CSS rules).
- Run a `grep -rn` for the pattern in the codebase.
- List every match.
- Check whether each match is covered by the diff.

→ **✓ Covered** if all matches are addressed; **✗ Missing** if any are not (list which ones explicitly).

### Per user comment after `refined`

Each comment is a potential scope change that should have been folded into the body by `aw-refine` and implemented by `aw-tdd`. **Enumerate every comment posted since the latest `refined` marker, in chronological order — do NOT skip any.** Silent skips are the exact failure mode this section exists to catch. Per `feedback_thorough_audit`, the bar for "reviewed" is that every ask is compared against the diff, not just the structured criteria.

For each comment, in the review's gap table, include:

- The comment date and the author handle (so the operator can trace).
- A short verbatim quote of the request (paraphrasing is acceptable for very long comments, but a quote is preferred — it documents that the comment was actually read).
- Whether the issue body was updated to reflect it (compare current body to the version at the time of the comment).
- Whether the diff implements it.
- Mark **✓ Reflected** if both, **✗ Missed** if either is missing.

A scope change that lives only in comments and never made it into the body OR the diff is the failure mode that motivates this skill. Flag it loudly.

### Files-modified sanity check

If the issue body has an `Out of scope` section listing files NOT to modify, verify the diff respects it. Flag any out-of-scope file the diff touches.

If the issue body lists `Files likely in scope`, verify the diff covers them and call out any unexpected additions.

## Outcomes

### Clean review (all ✓ or ⚠, no ✗)

1. Post the **Review — clean** comment template (per-criterion checklist).
2. `gh pr ready N` (mark out of draft).
3. Done. Human merges when satisfied.

### Review with gaps (any ✗)

1. Post the **Review — gaps found** comment template (per-criterion table with explanations).
2. Check the issue's comment history for prior reset cycles. If 2 or more `aw-review` resets have already happened, escalate instead — post the **Review — escalating to human** template, mark the PR ready (let the human deal with it), and label the issue `needs-human` (a new label). Don't reset a third time.
3. Otherwise: `gh pr close N --comment "<short summary linking to the review comment above>"`.
4. Flip the linked issue: `gh issue edit M --remove-label review --add-label tdd --add-label afk`.
5. Dispatch `aw-tdd`: `gh workflow run aw-tdd.yml --field issue_number=M`. The retry will see this skill's gap-list comment and use it as context.

## Output rules

- **Never modify code.** Read-only on the repo. Only label changes, PR state changes, and comments.
- **Always post a structured comment.** Even on clean reviews — the comment IS the review record.
- **Conservative on qualitative.** If you can't verify, say "needs human visual review", don't approve silently.
- **Specific on universal-claim gaps.** Don't say "some files were missed" — list them: "`src/components/cmd/modes/*.tsx` is covered (7 files), but `src/components/settings/connection-utils.tsx`, `src/components/settings/connection/ModelSelectionForm.tsx`, and `src/components/chat/ChatFooter.tsx` also match the picker pattern and are NOT in the diff."
- **Read commit messages too.** Sometimes the PR body says one thing and commit messages reveal additional out-of-scope changes — flag these.
- **Only review claude/github-actions bot-authored PRs.** Pre-flight already filters; never review human-authored PRs (those are out of scope for this skill).
- **Bound the loop.** A review can reset to `tdd + afk` at most twice per issue. Beyond that, escalate.

## Comment templates

### Review — clean

```
> *Independent review by `aw-review`. All acceptance criteria addressed.*

| Criterion | Status | Evidence |
|---|---|---|
| <criterion 1 from issue body> | ✓ Covered | <file>:<line> in PR diff |
| <criterion 2> | ✓ Test at <test file>:<test name> | — |
| <qualitative criterion 3> | ⚠ Needs human visual review | Diff bumps `strokeWidth` from 1.5 → 2.5; test asserts presence of `<Check>` element but not the prominence property the criterion names. |

**Universal claims:** <pattern checked> → <N matches found, <N> covered>.

**User comments since `refined`:** <list — for each, note how it was addressed (body update + diff change), or "no scope changes since refined">.

**Out-of-scope files modified:** <none, or list>.

Marking PR as ready for review. Merge when satisfied.
```

### Review — gaps found

```
> *Independent review by `aw-review`. Found gaps between request and implementation.*

| Criterion | Status | Gap |
|---|---|---|
| <criterion 1> | ✓ Covered | — |
| <criterion 2> | ✗ Missing | <one-line explanation of what's missing> |
| <qualitative criterion> | ⚠ Needs human visual review | <reason> |

**Universal-claim gap:** <pattern> matched <N> files; only <M> covered. Missing: <list>.

**Comment from <date> not reflected:** "<quote>" — body unchanged AND diff doesn't address.

**Plan:** Closing this PR and resetting issue #M to `tdd + afk`. `aw-tdd` will retry with the gap list above as context. Reply on the issue if you want to override (skip retry and merge as-is).
```

### Review — escalating to human

```
> *Independent review by `aw-review`. Two prior reset cycles already attempted on this issue — escalating to human instead of resetting again.*

Gaps remaining after <N> attempts:

<gap table>

`aw-tdd` has been unable to fully address this issue autonomously. Adding `needs-human` label and marking the PR ready (out of draft). Please either:
- Merge as-is (the gap list above is the known shortfall)
- Land a human-authored fix on this branch
- Comment on the issue with new guidance and remove `needs-human` to allow another retry
```

### Review — no linked issue

```
> *`aw-review` could not run.*

The PR body does not contain a recognized auto-close keyword line (`Fixes #N`, `Resolves #N`, or `Closes #N`). Without a linked issue, there's no acceptance-criteria checklist to review against.

If this PR doesn't correspond to an issue, that's fine — a human reviewer can take it from here. If it does, please add a `Fixes #N` line to the PR body and re-run `aw-review` via `gh workflow run aw-review.yml --field pr_number=<this PR>`.
```

## Constraints from the dev process

- Runs OUTSIDE the main pipeline. Triggered automatically on `pull_request.opened` for bot-authored draft PRs.
- Independent of `aw-tdd`'s session — fresh runner, fresh `claude-code-action` invocation. No shared context with the implementer. The whole point.
- One review per PR open. If `aw-tdd` re-opens after a reset, that's a new PR and a new review.
- Read-only on code; never modifies files in the PR's branch.
- Bounded retry: at most 2 reset cycles before escalating to human via `needs-human`.

## Most-relevant feedback rules for this skill

When context budget is tight, prioritise loading these rules from
`.claude/feedback/` (the full set is in `.claude/feedback/INDEX.md`).

<!-- BEGIN auto-generated by scripts/gen-feedback-index.py — do not hand-edit -->

**Universal (load for every skill):**

- `.claude/feedback/feedback_delete_old_skills.md` — Never ask the user to run commands or do mechanical steps — just do them yourself
- `.claude/feedback/feedback_generic_voice.md` — Never name the operator, contributors, or individuals when writing rules, READMEs, skill prompts, or commit messages intended to live in the repo. The text must be copy-pasteable to another repo without rewording.

**Specific to `aw-review`:**

- `.claude/feedback/feedback_code_review_mandatory_gate.md` — Bugs visible on a careful code reread must be caught before marking a task done. Tests are necessary, not sufficient. Applies to every task.
- `.claude/feedback/feedback_full_coverage.md` — When implementing a feature, cover ALL touch points completely. Never leave known gaps as "follow-ups" unless the user explicitly says so.
- `.claude/feedback/feedback_functional_parity_vs_visual_parity.md` — When wrapping existing functionality in a new UI shell, functional parity and visual parity are distinct gates — both mandatory, neither substitutes for the other.
- `.claude/feedback/feedback_outcome_shaped_criteria.md` — When a task's acceptance criteria name a file, line, function, or hook to modify, treat that as a *suggested* implementation — not the goal. The goal is the user-observable outcome. Verify the outcome before declaring done, even when the literal criteria are satisfied.
- `.claude/feedback/feedback_thorough_audit.md` — When reviewing code or auditing a fix, the bar is whether the request has actually been satisfied. Paper-pass via "tests green + code looks right" is not enough; the review must compare the actual implementation against the actual asks (body + comments + reality).

<!-- END auto-generated -->
