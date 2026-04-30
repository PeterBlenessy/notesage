---
name: aw-slice
description: Decide whether a refined GitHub issue ships as one PR or as N PRs. Default is one PR (no slicing) — issues with a single user value pass directly to aw-tdd. Slice only when the issue delivers N independent user values, each independently shippable. Creates a research sub-issue first if under-specified.
---

# aw-slice

Decide how a refined GitHub issue should be implemented: as one PR (the common case) or as N PRs (when it delivers multiple independent user values). The unit is **user value** — what a user can do after the PR merges that they couldn't do before. One PR = one shippable unit of user value.

## Inputs

- `ISSUE_NUMBER` — the parent issue to slice
- The issue body, title, labels, and any prior comments (read via `gh issue view`)

## Process

1. **Read the parent.**
   - `gh issue view $ISSUE_NUMBER --json title,body,labels,comments`
   - Verify it has `feature` AND `refined` AND `slice` AND one of `bug` / `enhancement` / `chore`.
   - Verify it does NOT have `sliced` or `awaiting-research`. If it does, exit silently (idempotent).
   - The `slice` action label is the explicit gate. Set by `aw-refine` after a successful clarification, or by a human after a research subtask closes (`awaiting-research` → `slice`). Bare `refined` alone is NOT a trigger.

2. **First branch — research vs value-listing.**

   The parent is **under-specified** (research-first) if:
   - The outcome describes a problem space, not a solution
   - You can't pick between obvious technical alternatives without more digging
   - Open questions in the body affect the implementation shape (which library? which API?)
   - You'd be guessing at acceptance criteria

   Otherwise, proceed to **value-listing** (step 3).

3. **List the user values delivered by this issue.**

   The core question: **what can a user DO after this PR merges that they couldn't do before?** Each answer is a "user value." Phrase each one as: "User can [observable behaviour]."

   Examples:
   - "User can resize the cmd-bar by dragging the top edge, and the height persists." → 1 value
   - "User can search across the editor" + "User can search across the sidebar" → 2 values (independent, each useful alone)
   - "Internal: refactor the rename helper" → 0 user values; this isn't shippable on its own — it should be bundled with the user value it enables, or rejected

   **Group values that share a single solution.** If two user behaviours come from the same change, they're one PR. Example: "drag handle works" + "viewport clamps the height" + "height persists across reloads" all share one solution (the resize implementation), so they're one value group.

   **Test for groupings:** "If I stop here (after this PR merges), has the user gained something concrete and useful?" Yes → ship it as one PR. Half a value (e.g. just the settings store field, no UI) → not a PR; bundle it with the value it enables.

4. **Decide: don't slice OR slice into N value-aligned children.**

   - **0 value groups** — the issue describes only internal work with no user-visible result. Post a clarification comment asking "what user behaviour does this enable?" Leave `slice` in place. Stop.
   - **1 value group (the common case)** — DO NOT slice. The parent itself becomes the work unit:
     - Update parent labels: remove `slice`, add `tdd` and exactly one of `hitl` / `afk`
     - Post a "passing through unsliced" comment (template below)
     - Stop. `aw-tdd` will pick up the parent directly and produce one PR.
   - **N independent value groups** — slice into N sub-issues, one per group:
     - Title: `<verb-prefixed user-value statement> for #<parent>` (e.g. `feat(search): search across editor for #99`)
     - Body: Goal (the user value) / Red tests / Green / Files likely to change / Definition of done
     - Labels: parent's category + `refined` + `tdd` + one of `hitl` / `afk`. Children do NOT get `feature`.
     - Link as sub-issue of parent
     - Update parent labels: remove `slice`, add `sliced`. Stop.

   **Default to "don't slice."** Most issues are one user value. Only slice when you can clearly name N independent values, each independently useful.

3a. **Research-first path** (the under-specified branch from step 2):

    Create ONE child issue:
    - Title: `Research: <specific question> for #<parent>`
    - Body: see "Research subtask template" below
    - Labels: `chore`, `refined`, `tdd`, `hitl` (research subtasks always need human review)
    - Link as sub-issue of parent (see "Sub-issue linking" below)

    Update parent labels:
    - Remove `slice`
    - Add `awaiting-research`

    Post a comment on the parent (template below). Stop.

## HITL vs AFK heuristics

Mark a subtask `hitl` (human approves before coder runs) when:
- It changes a public API or breaks compatibility
- It modifies the database schema or migrations
- It touches authentication, sandboxing, or security policy
- It removes or replaces a major dependency
- It rewrites a file that has more than ~10 callers
- The acceptance criteria reference design judgment (visual polish, UX feel)
- It's a `Research:` subtask (research findings always get human review)

Mark `afk` (coder may pick autonomously) when:
- The change is localized (one or two files in one package)
- The red-test list is fully observable (no "looks right" criteria)
- The component is well-tested already
- It's a doc-only or comment-only update
- It's a clear bug fix with a known repro

When uncertain, default to `hitl`. The user can flip to `afk` later.

## Sub-issue linking

After `gh issue create` returns a URL, extract the child issue number and run:

```
PARENT_ID=$(gh api graphql -f query="query { repository(owner:\"OWNER\", name:\"REPO\") { issue(number:PARENT_NUM) { id } } }" --jq '.data.repository.issue.id')
CHILD_ID=$(gh api graphql -f query="query { repository(owner:\"OWNER\", name:\"REPO\") { issue(number:CHILD_NUM) { id } } }" --jq '.data.repository.issue.id')
gh api graphql -f query="mutation { addSubIssue(input: { issueId: \"$PARENT_ID\", subIssueId: \"$CHILD_ID\" }) { issue { number } subIssue { number } } }"
```

Substitute owner / repo / parent / child numbers from the trigger context.

## Templates

### Research subtask template

```
## Goal

Find <specific information> needed to plan #<parent>.

## Questions to answer

- <bulleted list of concrete questions, each answerable in a paragraph or with a code citation>

## Where to look

- <files / docs / external resources to consult>

## Output

Post findings as a comment on this issue, then close as completed. Flip the parent (#<parent>) from `awaiting-research` to `slice` to re-trigger planning.

## Definition of done

- [ ] All questions above have written answers
- [ ] Recommended approach is named with one-paragraph justification
- [ ] Any blocking unknowns are escalated as new comments on #<parent>
```

### Implementation subtask template

```
## Goal

<one-sentence description of what this subtask delivers>

## Red tests (TDD red phase — must exist and be red BEFORE implementation)

- [ ] <test 1 — describes a behavior the implementation must satisfy>
- [ ] <test 2>
- [ ] <test 3>

## Green

<bullet list of the minimum implementation needed to pass the red tests>

## Refactor

<optional — note any cleanup or extraction expected after green>

## Files likely to change

- <path 1>
- <path 2>

## Depends on

- <#N if any sibling subtask must land first; omit if none>

## Definition of done

- All red tests above were red before this PR and are green after
- Existing test suite still passes (`pnpm test`)
- No new lint or type errors
```

## Output rules

- **Default to NOT slicing.** Most issues deliver one user value (or several values that share one solution). The parent itself is the work unit — pass it directly to `aw-tdd`. Slicing is the exception, not the default.
- **Slice ONLY when you can name N independent user values.** If you can't articulate the N values as separate "User can …" sentences that each independently make the user's life better, don't slice.
- **One PR = one shippable unit of user value.** A PR that delivers half a value (e.g. a settings store field with no consumer) is not a unit and should NOT be sliced out as its own subtask. Bundle it with the value it enables.
- **Sub-issue links are mandatory** when slicing. Every child must be linked as a sub-issue of the parent via the GraphQL mutation. Without the link, the parent's UI does not show the children.
- **Idempotent:** if parent has `sliced` or `awaiting-research` or `tdd`, exit silently.
- **No body modification** of the parent. Update labels only.
- **Children inherit category** (`bug`/`enhancement`/`chore`) from parent. They get `refined` + `tdd` + `hitl|afk`. They do NOT get `feature` (only top-level parents do).
- **Children get `hitl` or `afk`**, exactly one each.

## Comment templates

**Don't-slice path (the common case):**

```
> *Reviewed by the `aw-slice` skill. This issue delivers one user value, so it ships as a single PR.*

**User value:** <one-sentence "User can …" statement>

Passing this directly to `aw-tdd` (no sub-issues created). Marked `tdd + <afk|hitl>`.
```

**Slice path (multiple independent values):**

```
> *Sliced by the `aw-slice` skill. Reply with corrections or to flip hitl/afk on any subtask.*

Identified <N> independent user values, each shipping as its own PR:

- #<A> — <user-value sentence>
- #<B> — <user-value sentence>
- #<C> — <user-value sentence>

Order: <#A → #B → #C> (per `Depends on:` markers, if any).
```

**Research-first path:**

```
> *Sliced by the `aw-slice` skill.*

Not enough is known to identify the user values confidently. Created research subtask <#R> covering: <question 1; question 2; ...>.

When the research subtask closes, flip this parent's labels: remove `awaiting-research`, add `slice` to re-trigger.
```

**No-user-value path:**

```
> *Reviewed by the `aw-slice` skill. Could not identify a user value.*

This issue describes internal work without a user-observable result. Could you clarify what user behaviour this enables, or which value-delivering issue this should be bundled with?
```

## Constraints from the dev process

- Parent label transitions: `slice` → `tdd + (afk|hitl)` (don't-slice path), or `slice` → `sliced` (slice path), or `slice` → `awaiting-research` (research path).
- Re-slicing after research: human or automation flips `awaiting-research` → `slice` on the parent.
- The `aw-tdd` workflow picks up any issue labeled `tdd` + `afk` regardless of whether it has `feature` (don't-slice parent) or not (sub-issue child).
- One PR = one user value. If a PR delivers two unrelated values, it was sliced wrong — split into two PRs.
