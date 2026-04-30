---
name: aw-feedback
description: When a human comments on a hitl-labeled issue OR comments/reviews a claude-authored PR, interpret the feedback and take the appropriate label/state action. Does not generate code — only translates feedback into pipeline state changes.
---

# aw-feedback

Interpret human feedback (issue comment, PR comment, or PR review) on an item in the AW pipeline. Translate "I want X" into the right label change or PR state change. **No code generation** — only pipeline state changes. Code changes go through aw-tdd.

## Two contexts

This skill runs in TWO contexts. The triggering workflow tells you which:

1. **Issue with `hitl` label** — the agent paused, waiting for human feedback. Human commented. Decide approve / redo refine / redo slice / chat.
2. **PR opened by `claude[bot]`** — human is reviewing the agent's PR. Comment or review submitted. Decide approve / reject / specific change / chat.

## Inputs

- `EVENT_NAME` — `issue_comment` or `pull_request_review`
- `TARGET_NUMBER` — the issue or PR number
- The latest human comment text (read it from the issue/PR's most recent non-bot comment)
- The issue/PR state via `gh issue view` / `gh pr view`

## Pre-flight

1. **Read the target.**
   - Issue: `gh issue view N --json title,body,labels,comments`
   - PR: `gh pr view N --json title,body,state,labels,comments,reviews,headRefName`
2. **Confirm context:**
   - Issue context: issue must have `hitl` label. If not, exit silently.
   - PR context: PR's author must be `claude[bot]`. If not, exit silently.
3. **Identify the latest human comment.** Skip bot comments. The triggering comment is usually the latest, but verify.
4. **Read prior agent comments** for context (especially aw-slice's "Why hitl" rationale or aw-tdd's "Done" comment).

## Process: issue HITL feedback

Categorize the human's comment into one of these intents:

### Approve / proceed

Phrases like "approved", "lgtm", "looks good", "go ahead", "ship it", "yes", "do it".

**Action:**
- `gh issue edit N --remove-label hitl --add-label afk`
- Post comment (template: **Approved**)

### Redo refined scope

Phrases like "rewrite the scope", "redo refine", "the acceptance criteria are wrong", "I want different outcomes", "this isn't what I meant".

**Action:**
- `gh issue edit N --remove-label tdd --remove-label hitl --remove-label refined --add-label refine`
- The human's comment will be context for aw-refine when it re-runs.
- Post comment (template: **Re-refining**)

### Redo slicing

Phrases like "split this into N PRs", "wrong slicing", "this should be one PR not multiple", "merge these slices".

**Action:**
- `gh issue edit N --remove-label tdd --remove-label hitl --add-label slice`
- Post comment (template: **Re-slicing**)

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

### Reject / wrong approach

Comment text like "close this", "wrong direction", "start over", "not the right approach", or a review with state `CHANGES_REQUESTED` plus rejection sentiment.

**Action:**
- Find the linked issue from `Implements #N` in the PR body.
- `gh pr close N --comment "<rejection comment>"`
- On the linked issue: `gh issue edit M --remove-label review --add-label tdd --add-label afk`
- Post a final PR comment (template: **PR Rejected**)

### Specific change requested

Phrases like "change X", "extract this", "use a different name", "move this code". Without code-modification capability, the agent can't iterate on the PR directly.

**Action:**
- Post PR comment (template: **Code change noted, manual flow needed**) explaining that for now, the human should close the PR and flip the issue back to `tdd + afk` if they want a redo with this guidance.

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

### PR — Rejected

```
> *Read by `aw-feedback`. Interpreted as: reject + reset.*

Closing this PR and flipping issue #<N> back to `tdd + afk`. `aw-tdd` will take another pass.
```

### PR — Code change noted, manual flow needed

```
> *Read by `aw-feedback`. Interpreted as: requested code change.*

I noted the change — but I can only act on label changes from this skill, not iterate on code in an existing PR. To redo with this guidance:
1. Close this PR
2. Flip issue #<N> back to `tdd + afk`

`aw-tdd` will take another pass with your comment in scope.

(Code-iteration on PRs is planned but not yet implemented — see "Tier 2" in the design doc.)
```

## Constraints from the dev process

- This skill runs OUTSIDE the main pipeline. It's a meta-skill for redirecting based on feedback, not advancing through stages.
- Forward progression is the job of `aw-triage`, `aw-refine`, `aw-slice`, `aw-tdd`. This skill only redirects (back to refine/slice) or unblocks (`hitl → afk`).
- This skill is the missing HITL conversation gate — without it, `hitl` is a one-way signal with no agent response to whatever the human writes.
