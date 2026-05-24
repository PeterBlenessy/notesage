---
name: aw-feedback
description: When a human comments on a hitl-labeled issue OR comments/reviews a claude-authored PR, interpret the feedback and take the appropriate label/state action. Does not generate code — only translates feedback into pipeline state changes.
---

# aw-feedback

Interpret human feedback (issue comment, PR comment, or PR review) on an item in the AW pipeline. Translate "I want X" into the right label change or PR state change. **No code generation** — only pipeline state changes. Code changes go through aw-tdd.

## Two contexts

This skill runs in TWO contexts. The triggering workflow tells you which:

1. **Issue with `hitl` label** — the agent paused, waiting for human feedback. Human commented. Decide approve / redo refine / redo slice / chat.
2. **PR opened by our bot** (`github-actions[bot]`, or legacy `claude[bot]` / `app/claude` for older PRs) — human is reviewing the agent's PR. Comment or review submitted. Decide approve / reject / specific change / chat.

## Inputs

- `EVENT_NAME` — `issue_comment` or `pull_request_review`
- `TARGET_NUMBER` — the issue or PR number
- The latest human comment text (read it from the issue/PR's most recent non-bot comment)
- The issue/PR state via `gh issue view` / `gh pr view`

## Step 0 — Load accumulated rules (mandatory; before anything else)

Read `.claude/feedback/INDEX.md` then read every `feedback_*.md` whose row lists this skill (or `all`) in `aw_applies_to`. These are corrections from past interactive sessions; they override conflicting guidance in this SKILL.md when they conflict. Skipping this step is the single biggest cause of avoidable AW failures.

For `aw_applies: with-modification` rules, read "user" as the issue or PR thread you're working on — the rule's `aw_note` frontmatter explains the modification.

## Pre-flight

1. **Read the target.**
   - Issue: `gh issue view N --json title,body,labels,comments`
   - PR: `gh pr view N --json title,body,state,labels,comments,reviews,headRefName`
2. **Confirm context:**
   - Issue context: issue must have `hitl` label. If not, exit silently.
   - PR context: PR's author must be `github-actions[bot]` (or legacy `claude[bot]` / `app/claude`). If not, exit silently.
3. **Identify the latest human comment.** Skip bot comments. The triggering comment is usually the latest, but verify.
4. **Read prior agent comments** for context (especially aw-slice's "Why hitl" rationale or aw-tdd's "Done" comment).

## Process: issue HITL feedback

Categorize the human's comment into one of these intents:

### Why every label flip is followed by an explicit `gh workflow run`

The standalone workflows (`aw-refine.yml`, `aw-slice.yml`, `aw-tdd.yml`) listen on `issues.labeled`. Normally, a label change instantly fires the matching workflow. **But our workflows authenticate with `GITHUB_TOKEN`** (see `docs/agentic-workflow.md` → "GITHUB_TOKEN for surgical event triggers"), and per GitHub's recursion guard, events triggered by `GITHUB_TOKEN` do NOT create new workflow runs — only `workflow_dispatch` and `repository_dispatch` are exempt.

So when this skill flips `hitl → afk` or resets `→ refine`, the corresponding standalone does NOT auto-fire. The next cron sweep would eventually pick it up (15-min cadence), but that breaks the conversational tightness the feedback loop is built for. Every label flip in this skill MUST be followed by `gh workflow run <next>.yml --field issue_number=N` to advance the pipeline immediately.

### Approve / proceed

Phrases like "approved", "lgtm", "looks good", "go ahead", "ship it", "yes", "do it".

**Action:**
- `gh issue edit N --remove-label hitl --add-label afk`
- `gh workflow run aw-tdd.yml --field issue_number=N`
- Post comment (template: **Approved**)

### Redo refined scope

Phrases like "rewrite the scope", "redo refine", "the acceptance criteria are wrong", "I want different outcomes", "this isn't what I meant".

**Action:**
- `gh issue edit N --remove-label tdd --remove-label hitl --remove-label refined --add-label refine`
- `gh workflow run aw-refine.yml --field issue_number=N`
- The human's comment will be context for aw-refine when it re-runs.
- Post comment (template: **Re-refining**)

### Redo slicing

Phrases like "split this into N PRs", "wrong slicing", "this should be one PR not multiple", "merge these slices".

**Action:**
- `gh issue edit N --remove-label tdd --remove-label hitl --add-label slice`
- `gh workflow run aw-slice.yml --field issue_number=N`
- Post comment (template: **Re-slicing**)

### Clarification that resolves the open questions

The issue body's `## Open questions` section is where `aw-refine` or `aw-slice` flagged unresolved decisions. When the human comments answering one of those questions AND the answer covers ALL listed open questions AND the comment introduces no new concerns, treat as soft approval.

How to recognize: the comment maps cleanly onto a question in the body (e.g. "Should X happen for Y?" → "Yes, X should happen" / "No, leave Y alone"). Short, declarative, scoped to the existing question set. Does NOT introduce new requirements ("also do Z"), question existing acceptance criteria, or shift scope.

**Action:**
- Update the issue body's `## Open questions` section (or `## Acceptance criteria` if the answer affects a specific criterion) to reflect the resolution. Mark the question as resolved with the human's answer inline.
- `gh issue edit N --remove-label hitl --add-label afk`
- `gh workflow run aw-tdd.yml --field issue_number=N`
- Post comment (template: **Clarification accepted, proceeding**)

When in doubt — if the comment introduces ANY new requirement, raises a NEW question, or only partially answers the open questions — fall through to "Specific code/file guidance" or "Question / chat" instead of soft-approving.

### Override an assumption / proposed answer ("wrong assumption", "use X instead")

The comment overrides an entry in the issue body's `## Assumptions` (set by `aw-refine`), a slice rationale's `## Proposed answers` (set by `aw-slice`), or a PR body's `## Decisions made` (set by `aw-tdd`).

**Action:** route to the same path as the matching reset above — refine override → "Redo refined scope"; slice override → "Redo slicing"; tdd-PR override → "Specific change requested" (dispatches `aw-iterate`). The triggering comment is already the new context for the redispatched stage. Use the matching template (re-refining / re-slicing / iteration dispatched).

### Specific code/file guidance ("do it this way")

Phrases like "use library X", "change the approach to Y", "extract this into a helper", "use the existing utility".

**Action:**
- Don't change labels (specific code change requires aw-tdd).
- Post comment (template: **Code guidance noted**) telling the human to flip to `afk` when ready and that the guidance will be considered during implementation.

### Question / chat / unclear

Anything else — questions, partial agreement, requests for clarification, off-topic.

**Action:**
- No label change.
- Post a comment summarizing what you understood and asking what they want to happen.

## Process: PR review feedback

Categorize:

### Approve

Comment text like "lgtm", "approved", "ready", or a review with state `APPROVED`.

**Action:**
- `gh pr ready N` (mark as ready for review)
- Post PR comment (template: **PR Approved**)

### Reject implementation ("wrong code, redo")

Comment text like "wrong implementation", "redo this approach", "code is wrong but the design is right". The acceptance criteria + scope are still good; only the code needs another attempt.

**Action:**
- Find the linked issue from the PR body's auto-close line (`Fixes #M` / `Resolves #M`; legacy: `Implements #M`).
- `gh pr close N --comment "<rejection comment>"`
- On the linked issue: `gh issue edit M --remove-label review --add-label tdd --add-label afk`
- `gh workflow run aw-tdd.yml --field issue_number=M`
- Post a final PR comment (template: **PR Rejected — redo implementation**)

### Reject scope ("acceptance criteria are off")

Comment text like "this isn't what I asked for", "the acceptance criteria are wrong", "the scope is incorrect", "the issue body needs revision". The implementation may be fine, but it solved the wrong problem.

**Action:**
- Find the linked issue from the PR body's auto-close line (`Fixes #M` / `Resolves #M`; legacy: `Implements #M`).
- `gh pr close N --comment "<rejection: scope wrong, re-refining>"`
- On the linked issue: `gh issue edit M --remove-label review --remove-label refined --add-label refine`
- `gh workflow run aw-refine.yml --field issue_number=M`
- The human's review comment will be context for aw-refine when it re-runs.
- Post a final PR comment (template: **PR Rejected — re-refine scope**)

### Reject slicing ("should have been N PRs")

Comment text like "this should have been split", "too much in one PR", "this scope is too big".

**Action:**
- Find the linked issue from the PR body's auto-close line (`Fixes #M` / `Resolves #M`; legacy: `Implements #M`).
- `gh pr close N --comment "<rejection: slicing wrong, re-slicing>"`
- On the linked issue: `gh issue edit M --remove-label review --add-label slice`
- `gh workflow run aw-slice.yml --field issue_number=M`
- Post a final PR comment (template: **PR Rejected — re-slice**)

### Specific change requested ("rename / extract / use library X")

Phrases like "change X to Y", "rename this", "extract this into a helper", "use library Z instead", "add a case for empty input". The scope and approach are right; only a SMALL specific tweak is needed.

**Action:**
- Dispatch the `aw-iterate` workflow on the PR with the comment as context:
  ```
  gh workflow run aw-iterate.yml \
    --field pr_number=<N> \
    --field feedback_comment="<the human's comment text>"
  ```
- Post a PR comment (template: **Iteration dispatched**) acknowledging that a follow-up commit is on the way. `aw-iterate` will judge if the change is small enough and either push a commit or deflect back to label-reset.

### Question / chat

**Action:**
- Post a reply, no state change.

## Output rules

- **Never generate code.** Code changes go through aw-tdd.
- **One action per run.** Don't try to do multiple things on one comment.
- **Idempotent:** if labels are already in the target state, just post the comment and stop.
- **Never act on bot comments.** The pre-flight check should already have filtered, but double-check.
- **Always comment back.** Even when no label change, post what was interpreted. Otherwise the human doesn't know if you saw the comment.
- **Be conservative with categorization.** When unsure, treat as "Question / chat" and ask for clarification rather than taking the wrong action.

## Comment templates

### Issue HITL — Approved

```
> *Read by `aw-feedback`. Interpreted as: approve, proceed.*

Flipping `hitl → afk`. `aw-tdd` will pick this up next.
```

### Issue HITL — Re-refining

```
> *Read by `aw-feedback`. Interpreted as: redo refined scope.*

Resetting to `refine`. Your comment above will be context when `aw-refine` re-runs. The new refinement will reflect what you wrote.
```

### Issue HITL — Re-slicing

```
> *Read by `aw-feedback`. Interpreted as: redo slicing.*

Resetting to `slice`. `aw-slice` will re-evaluate with your feedback in mind.
```

### Issue HITL — Clarification accepted, proceeding

```
> *Read by `aw-feedback`. Interpreted as: clarification resolves the open questions in the issue body.*

Updated the issue body to reflect: <one-sentence paraphrase of the resolution>. All open questions are now resolved with no new concerns raised, so flipping `hitl → afk` and dispatching `aw-tdd` to proceed.
```

### Issue HITL — Assumption override — re-refining

```
> *Read by `aw-feedback`. Interpreted as: override an assumption recorded by `aw-refine`.*

Resetting to `refine` so the assumption is rewritten with your override folded in. The refine pass will pick up your comment as new context and update the issue body's `## Assumptions` section accordingly.
```

### Issue HITL — Assumption override — re-slicing

```
> *Read by `aw-feedback`. Interpreted as: override a proposed answer recorded by `aw-slice`.*

Resetting to `slice` so the answer is reconsidered with your override. The slice pass will use your comment as new context and update the `## Proposed answers` section accordingly.
```

### Issue HITL — Code guidance noted

```
> *Read by `aw-feedback`. Interpreted as: code-level guidance.*

I noted the guidance — but I can only act on label changes here, not modify code directly. When you're ready, comment "approve" or flip `hitl → afk` to let `aw-tdd` proceed. Your guidance above will be visible in the issue history.
```

### Issue HITL — Chat / unclear

```
> *Read by `aw-feedback`. I'm not sure what action to take.*

Here's what I understood: <one-sentence paraphrase>

Could you clarify which of these you want?
- "approve" / "go ahead" → flip to afk and start coding
- "redo scope" → reset to refine (rewrite the issue body)
- "redo slicing" → reset to slice (re-evaluate one-PR vs multi-PR)
```

### PR — Approved

```
> *Read by `aw-feedback`. Interpreted as: approve.*

Marked the PR as ready for review. Merge when you're satisfied.
```

### PR — Rejected — redo implementation

```
> *Read by `aw-feedback`. Interpreted as: implementation wrong, scope still right.*

Closing this PR and flipping issue #<N> back to `tdd + afk`. `aw-tdd` will take another pass with the scope unchanged.
```

### PR — Rejected — re-refine scope

```
> *Read by `aw-feedback`. Interpreted as: scope wrong, re-refining.*

Closing this PR and resetting issue #<N> to `refine`. The feedback above will be context for `aw-refine` when it re-runs. The new refinement may then produce a different slicing or implementation.
```

### PR — Rejected — re-slice

```
> *Read by `aw-feedback`. Interpreted as: slicing wrong.*

Closing this PR and resetting issue #<N> to `slice`. `aw-slice` will re-evaluate one-PR-vs-multiple with your feedback in mind.
```

### PR — Iteration dispatched

```
> *Read by `aw-feedback`. Interpreted as: specific code change.*

Dispatched `aw-iterate` to attempt a follow-up commit on this PR's branch. It'll judge whether the change is small enough for in-place iteration. If so, you'll see a new commit shortly. If too big, it'll deflect back here with a reset suggestion.
```

## Constraints from the dev process

- This skill runs OUTSIDE the main pipeline. It's a meta-skill for redirecting based on feedback, not advancing through stages.
- Forward progression is the job of `aw-triage`, `aw-refine`, `aw-slice`, `aw-tdd`. This skill only redirects (back to refine/slice) or unblocks (`hitl → afk`).
- This skill is the missing HITL conversation gate — without it, `hitl` is a one-way signal with no agent response to whatever the human writes.

## Most-relevant feedback rules for this skill

When context budget is tight, prioritise loading these rules from
`.claude/feedback/` (the full set is in `.claude/feedback/INDEX.md`).

<!-- BEGIN auto-generated by scripts/gen-feedback-index.py — do not hand-edit -->

**Universal (load for every skill):**

- `.claude/feedback/feedback_delete_old_skills.md` — Never ask the user to run commands or do mechanical steps — just do them yourself
- `.claude/feedback/feedback_generic_voice.md` — Never name the operator, contributors, or individuals when writing rules, READMEs, skill prompts, or commit messages intended to live in the repo. The text must be copy-pasteable to another repo without rewording.
- `.claude/feedback/feedback_write_feedback_to_repo.md` — When saving a memory in a project that has `.claude/feedback/`, behavioural-correction rules (anything that should change future behaviour on the same task class) MUST go in the repo so they're visible to AW agents and travel with the project. Local `~/.claude/projects/<project-slug>/memory/` is only for project-state memories (in-flight work, branch state, scratch notes).

<!-- END auto-generated -->
