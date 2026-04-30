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

1. **Read the issue.**
   - `gh issue view $ISSUE_NUMBER --json title,body,labels`
   - Verify exactly one of `bug` / `enhancement` / `chore` is present AND `refine` is present. If not, post a clarification comment and stop.
   - If `refined` is already present, exit silently (idempotent).

2. **Pick the matching template** (see Templates below) based on the category.

3. **Rewrite the body.** Preserve verbatim:
   - Reproduction steps, error messages, code blocks
   - Environment / version / hardware details
   - User-provided technical context
   - Original outcome statement if it's already clear

   Improve:
   - Outcome focus — what observable behavior does the user want?
   - Scope clarity — what's in, what's out, what are non-goals?
   - Acceptance criteria — testable, observable outcomes (NOT implementation details)

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
- If the issue is too vague to rewrite confidently (no clear outcome even after triage), post a clarification comment, leave `refine` in place, do NOT add `refined` or `slice`.

## Comment template

```
> *Refined automatically by the `aw-refine` skill. Reply with corrections or additional context.*

Restructured the body into the outcome-oriented `<category>` template. Reproduction steps and technical details preserved verbatim.
```

## Constraints from the dev process

- After this skill: issue should have `<category>` + `feature` + `refined` (state) + `slice` (action). The `refine` action label is gone.
- `aw-slice` is the next workflow in line. It triggers on the `slice` label and decides per-issue whether to create a research subtask first or break straight into implementation subtasks.
- There is no separate `feature-research` skill — research becomes a regular subtask when `aw-slice` decides the parent is under-specified.
