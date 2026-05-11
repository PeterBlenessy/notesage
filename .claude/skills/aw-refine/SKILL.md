---
name: aw-refine
description: Rewrite a refine-flagged GitHub issue body into the outcome-oriented template (bug / enhancement / chore variants), preserving all reproduction details. Adds `refined` (state) + `slice` (action), removes `refine`. Runs after `aw-triage` has classified the issue.
---

# aw-refine

Rewrite a single GitHub issue body into the outcome-oriented template. The issue must already have a category label (`bug`, `enhancement`, or `chore`) and the `refine` action label — `aw-triage` is responsible for setting both.

## Inputs

- `ISSUE_NUMBER` — the issue to refine
- The issue's current body, title, labels (read via `gh issue view`)

## Process

1. **Read the issue, including comments.**
   - `gh issue view $ISSUE_NUMBER --json title,body,labels,comments`
   - Verify exactly one of `bug` / `enhancement` / `chore` is present AND `refine` is present. If not, post a clarification comment and stop.
   - If `refined` is already present, exit silently (idempotent).

1.5. **Read human comments since the trigger marker** — authoritative override material.

   When the user resets a refined issue to `refine` (via `aw-feedback`'s "Redo refined scope" / assumption-override path, or by manual label flip), they almost always leave a comment explaining what was wrong with the previous refine. **That comment is the most important input to this run.** Without reading it, this skill re-runs against the same body and predictably re-produces the same wrong refinement.

   - Filter the `comments` array to skip bot comments (any comment whose author is `github-actions[bot]`, `claude[bot]`, `app/claude`, or contains a `> *Refined automatically by the` / `> *Read by` marker line at the start).
   - Of the remaining human comments, focus on those posted after the issue's most recent state-change event. If the issue currently carries `refine` (was reset from `refined`), the relevant comments are everything posted after the most recent `refined` label was added to the issue (use `gh issue view` event history if needed, or simply: any human comment posted after the latest bot `Refined automatically` marker).
   - Treat each such human comment as **authoritative**. What the human explicitly stated outweighs any conflicting interpretation you would otherwise derive from the issue body alone. Fold the corrections into the rewritten body's `## Assumptions` section AND into the outcome / acceptance-criteria sections as needed — not just a passing mention, but a structural rewrite that makes the corrected scope impossible to re-derive wrong.
   - If a human comment includes "Files explicitly NOT touched" / "DO NOT" / "Wrong path" sections, mirror them in the rewritten body so `aw-tdd` can't miss them.

2. **Pick the matching template** (see Templates below) based on the category.

3. **Rewrite the body.** Default is assumption-and-proceed. Only bounce back (post a comment, leave `refine` in place) if the input is unintelligible — empty body, single-character title, no recoverable signal. "Vague but intelligible" is the common case; make defensible assumptions and proceed.

   Preserve verbatim: reproduction steps, error messages, code blocks, environment / version, user-provided technical context, original outcome if already clear.

   Improve: outcome focus, scope (in / out / non-goals), acceptance criteria (testable, observable). When you make assumptions because the original was silent or ambiguous, record them under `## Assumptions` in the rewritten body — they're override-able by comment.

   **When step 1.5 found human override comments**, the rewritten body is structurally different from the previous body, not a near-copy. Test: read the new body cold without seeing the comment, and ask "could I derive the override from this alone?" If no, expand the body until yes. The comment was a one-time correction; the body is the durable spec.

4. **Update the body** via `gh issue edit $ISSUE_NUMBER --body-file <(...)`.

5. **Update the title** ONLY if the current title is genuinely not outcome-shaped (e.g. one-word, clickbait, or describes implementation). Otherwise leave it alone.

6. **Update labels:**
   - Add `refined` (persistent state marker — agent has refined this issue's body)
   - Add `slice` (action label — signals `aw-slice` to pick this up next)
   - Remove `refine` (the action label that triggered this run)

7. **Post a brief comment** (template below).

## Templates

### Bug template

```
## Outcome

<one-sentence description of the broken behavior the user wants fixed>

## Assumptions

<bulleted list of any decisions made because the original report was silent or ambiguous; omit the section entirely if none. Override-able by comment.>

## Reproduction

1. <step from the original report>
2. ...

## Expected vs actual

- **Expected:** <what should happen>
- **Actual:** <what does happen>

## Environment

- <OS, app version, relevant config from the original report>

## Acceptance criteria

- [ ] <observable test that proves the bug is fixed>
- [ ] <regression tests are added or updated>

## Out of scope

- <related issues / behaviors that are NOT part of this fix>
```

### Enhancement (feature) template

```
## Outcome

<one-sentence description of the user-facing capability or improvement>

## Problem

<the user need or pain point this addresses; quote the original report where helpful>

## Assumptions

<bulleted list of any decisions made because the original report was silent or ambiguous; omit the section entirely if none. Override-able by comment.>

## Scope

### In scope

- <what this issue covers>

### Out of scope

- <related work not covered by this issue>

## Acceptance criteria

- [ ] <observable user-facing behavior>
- [ ] <regression tests cover the new path>

## Open questions

- <decisions that still need a human call; if these are blocking, `aw-slice` will create a research subtask first>
```

### Chore template

```
## Outcome

<one-sentence description of the non-functional improvement (refactor / docs / tooling / dependency bump)>

## Motivation

<why now? what does this enable or unblock?>

## Assumptions

<bulleted list of any decisions made because the original report was silent or ambiguous; omit the section entirely if none. Override-able by comment.>

## Scope

### In scope

- <files / modules / packages affected>

### Out of scope

- <related work not part of this chore>

## Acceptance criteria

- [ ] <observable verification — tests still pass, no behavior change, etc.>
```

## Output rules

- **Never** rewrite the body if `refined` is already present. Exit silently.
- **Never** modify the title unless it is genuinely not outcome-shaped — most titles are fine.
- **Preserve** all technical details from the original report verbatim. Quote in code blocks if needed.
- **`refined` is the state marker; `slice` is the action label** that triggers `aw-slice`. Both must be set after a successful run.
- **Assumption-and-proceed is the default**; bounce back with `refine` left in place only when the input is unintelligible. Humans override assumptions by comment; `aw-feedback` routes back here.

## Comment template

**Default (assumptions-and-proceed):**

```
> *Refined automatically by the `aw-refine` skill. Reply with corrections or additional context.*

Restructured the body into the outcome-oriented `<category>` template. Reproduction steps and technical details preserved verbatim.

<IF assumptions were made>
Recorded the following assumptions in the issue body to fill silence in the original report:
- <assumption 1>
- <assumption 2>

Comment to override any assumption — `aw-feedback` will route the comment back here.
</IF>
```

**Bounce-back (rare — unintelligible only):**

```
> *Read by the `aw-refine` skill — could not extract a recoverable outcome.*

The original report is missing enough context that I can't form a defensible interpretation. Could you say what user behaviour this should change? A one-sentence "User should be able to X" or "X is broken: Y happens instead of Z" is enough.
```

## Constraints from the dev process

- After this skill: issue should have `<category>` + `refined` (state) + `slice` (action). The `refine` action label is gone.
- `aw-slice` is the next workflow in line. It triggers on the `slice` label and decides per-issue whether to create a research subtask first or break straight into implementation subtasks.
- There is no separate `feature-research` skill — research becomes a regular subtask when `aw-slice` decides the parent is under-specified.
