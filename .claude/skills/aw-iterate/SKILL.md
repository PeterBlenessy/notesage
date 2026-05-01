---
name: aw-iterate
description: Push a small follow-up commit on an existing draft PR branch in response to specific human feedback. Same hard gates as aw-tdd. Deflects to label-reset if the requested change is too large or scope-changing.
---

# aw-iterate

Make a SMALL, SPECIFIC change to an existing claude[bot]-authored draft PR in response to human review feedback. Push a follow-up commit on the same branch — no new PR, no closing the existing one.

This skill is the in-place iteration path. For "wrong scope" or "wrong approach," that's a different feedback intent — `aw-feedback` resets the issue to `refine` or `tdd + afk` and a new PR is opened from scratch.

## When to use vs when to defer

**Use this skill when** the human's comment is:
- A rename ("call this X instead of Y")
- An extraction ("pull this into a helper")
- A library swap ("use Z instead of W")
- A small bug fix in the diff ("this should handle the empty case")
- A doc tweak ("explain why")
- A test improvement ("add a case for X")

**Defer (post a deflection comment) when** the comment is:
- Scope-changing ("also do X" — that's a separate user value, deserves its own PR)
- Refactor of substantially more than the PR diff ("rewrite this module")
- Architectural ("use a different pattern across the whole codebase")
- Question / chat (handled by aw-feedback already, shouldn't reach this skill)

The size budget: ≤200 lines diff added beyond the existing PR, ≤5 files modified. If the requested change clearly exceeds that, deflect.

## Inputs

- `PR_NUMBER` — the draft PR to iterate on
- `FEEDBACK_COMMENT` — the human's comment text (passed in workflow prompt)
- The PR's branch is already checked out by the workflow

## Pre-flight

1. **Read the PR.** `gh pr view $PR_NUMBER --json title,body,labels,files,headRefName,author`
   - Verify author is `claude[bot]`. If not, exit silently (we don't iterate on human PRs).
   - Verify state is `OPEN` and `isDraft == true`. If merged or non-draft, exit silently.
2. **Read the issue** linked from the PR body (`Implements #N`). Need the original acceptance criteria for context.
3. **Read the feedback comment** + any prior review comments on the PR.

## Decide: iterate or defer

Ask: is this change SMALL and SPECIFIC?

- **SMALL** = ≤200 lines diff added beyond the current PR, ≤5 files modified, no test rewrites of more than ~30 lines, change is bounded
- **SPECIFIC** = the human named what they want (rename X to Y; extract this; add this case; use this library)

If both are true → iterate.
If either is false → deflect.

**Deflection comment template:**

```
> *Read by `aw-iterate`. The requested change is larger than what in-place iteration can safely handle.*

I can iterate on small, specific changes (rename, extract, library swap, small bug fix). The change you described looks <bigger / scope-changing / architectural>.

Two options:
- **Reset to `tdd + afk`**: I'll open a new draft PR with this guidance baked in. Use this if the implementation needs a substantial rewrite.
- **Reset to `refine`**: I'll re-refine the issue body with your guidance, then re-slice and re-implement. Use this if the issue's scope or acceptance criteria are off.

Which do you want? Reply with the choice and `aw-feedback` will route accordingly.
```

## Process: iterate

When the change qualifies as small + specific:

### Red (if the change has observable behavior)

If the change adds new behavior the user can observe (e.g. a bug fix), write a failing test that captures it BEFORE making the change.

Run the new test — it must be RED. If green from start, the bug isn't real or the test is wrong; post a comment, exit.

### Green (always)

Make the requested change. Re-run the new test (if any). It must pass.

### Hard gates (same as aw-tdd)

1. **Full test suite passes:** `pnpm test`
2. **Typecheck passes:** `pnpm typecheck`
3. **Lint passes** (if `lint` script exists)
4. **No surprise files modified:** `git diff --stat` against the PR's previous head. The new files in this commit should match what the human asked for. If you accidentally touched something unrelated, abort.
5. **Diff stays bounded:** total diff in this commit ≤200 lines added, ≤5 files modified. If the change naturally exceeds this, you're doing too much — deflect.

### Commit + push

When all gates pass:

1. `git add <only the files you intended to change>`
2. `git commit -m "<verb-prefixed: short summary of the change>"` — commit body should reference the comment that requested it.
3. `git push` to the same PR branch.
4. Post a PR comment (template below).

### On failure

If any hard gate fails:
1. `git checkout -- .` and `git clean -fd` to reset working tree.
2. Post a failure comment (template below) with the gate that failed.
3. Exit.

## Comment templates

**Iterated successfully:**

```
> *Iterated by `aw-iterate`. Pushed follow-up commit <sha-short> in response to your feedback above.*

**Change:** <one-line description>

**Files touched:** <list>

**Verification:**
- Full test suite: passing ✓
- Typecheck: clean ✓
- Diff scope: <X lines / Y files>

Re-review the new commit. If you have more feedback, comment again — I'll iterate (or deflect if it's too big).
```

**Iteration failed:**

```
> *Iteration failed at: <gate name>.*

<one-sentence summary>

<truncated error output, ~30 lines max>

The PR is unchanged (no commit pushed). Options:
- Reply with refined feedback and I'll try again
- Reset to `tdd + afk` for a fresh attempt
- Close the PR and start over via `refine`
```

## Output rules

- **Never push to `main`.** Always to the PR's existing branch.
- **One commit per iteration.** Don't bundle unrelated changes — if the human asked for X, just do X.
- **Don't change the PR title or body** (those reflect the original work).
- **Don't update the linked issue's labels.** The PR is still in `review` state; label changes are aw-feedback's job.
- **Defer when in doubt.** A small wrong commit pollutes the PR; a deflection is recoverable.
- **The hard gates are hard.** Failing tests = revert + deflect, never push broken code.

## Constraints from the dev process

- Triggered by `aw-feedback` via `gh workflow run aw-iterate.yml` when feedback is "specific code change."
- Runs on the PR's branch, NOT main. The workflow checks out the branch before invoking this skill.
- Does not change the issue's pipeline state (`refined`, `tdd`, `review`, etc.). Only the PR is modified.
- For larger changes that exceed the iteration budget, this skill deflects back to `aw-feedback`'s reset paths (close + reset to refine/tdd).
