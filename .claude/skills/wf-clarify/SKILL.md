---
name: wf-clarify
description: Rewrite a triaged GitHub issue body into the outcome-oriented
  template (bug / enhancement / chore variants), preserving all reproduction
  details. Adds `enhanced`, removes `needs-triage`. Runs after `wf-triage`
  has classified the issue.
---

# Issue enhancer

Rewrite a single GitHub issue body into the outcome-oriented template. The issue must already have a category label (`bug`, `enhancement`, or `chore`) — the `wf-triage` skill is responsible for that.

## Inputs

- `ISSUE_NUMBER` — the issue to enhance
- The issue's current body, title, labels (read via `gh issue view`)

## Process

1. **Read the issue.**

   - `gh issue view $ISSUE_NUMBER --json title,body,labels`
   - Verify exactly one of `bug` / `enhancement` / `chore` is present. If not, post a clarification comment and stop.
   - If `enhanced` is already present, exit silently (idempotent).

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

   - Add `enhanced`
   - Add `ready-for-planning` (the explicit gate that wakes up `wf-slice`)
   - Remove `needs-triage`

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

- <decisions that still need a human call; if these are blocking, `wf-slice` will create a research subtask first>
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

- **Never** rewrite the body if the issue already has `enhanced`. Exit silently.
- **Never** modify the title unless it is genuinely not outcome-shaped — most titles are fine.
- **Preserve** all technical details from the original report verbatim. Quote in code blocks if needed.
- **`enhanced` + `ready-for-planning` together are the trigger** for `wf-slice`. Adding them without proper rewriting WILL cause the slicer to act on a half-baked issue.
- If the issue is too vague to rewrite confidently (no clear outcome even after triage), post a clarification comment, leave `needs-triage`, do NOT add `enhanced` or `ready-for-planning`.

## Comment template

```
> *Enhanced automatically by the `wf-clarify` skill. Reply with corrections or additional context.*

Restructured the body into the outcome-oriented `<category>` template. Reproduction steps and technical details preserved verbatim.
```

## Constraints from the dev process

- After this skill: issue should have `<category>` + `enhanced` + `ready-for-planning` (no `needs-triage`).
- `wf-slice` is the next workflow in line. It triggers on `ready-for-planning` and decides per-issue whether to create a research subtask first or break straight into implementation subtasks.
- There is no separate `feature-research` skill — research becomes a regular subtask when `wf-slice` decides the parent is under-specified.