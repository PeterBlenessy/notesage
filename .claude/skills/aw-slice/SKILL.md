---
name: aw-slice
description: Break a clarified GitHub issue into red-test-list child sub-issues using TDD red-green-refactor structure. Picks horizontal or vertical slicing per feature. Creates a research sub-issue first if under-specified. Links children as GitHub sub-issues. Sets `sliced` on the parent (or `awaiting-research`).
---

# aw-slice

Break a clarified GitHub issue into actionable child sub-issues. Each child is small enough to land in isolation under TDD (red-green-refactor). Decides slicing strategy per issue, and creates a research sub-issue first if too little is known to slice confidently.

## Inputs

- `ISSUE_NUMBER` — the parent issue to slice
- The issue body, title, labels, and any prior comments (read via `gh issue view`)

## Process

1. **Read the parent.**
   - `gh issue view $ISSUE_NUMBER --json title,body,labels,comments`
   - Verify it has `feature` AND `clarified` AND `slice` AND one of `bug` / `enhancement` / `chore`.
   - Verify it does NOT have `sliced` or `awaiting-research`. If it does, exit silently (idempotent).
   - The `slice` action label is the explicit gate. Set by `aw-clarify` after a successful clarification, or by a human after a research subtask closes (`awaiting-research` → `slice`). Bare `clarified` alone is NOT a trigger.

2. **Decide: clear plan or research first?**

   The parent is **clear** if:
   - The outcome is concrete and observable
   - Acceptance criteria are testable
   - The list of in-scope work is enumerable
   - You can name 2–6 distinct sub-tasks with confidence

   The parent is **under-specified** if:
   - The outcome describes a problem space, not a solution
   - You can't pick between obvious technical alternatives without more digging
   - Open questions in the body affect the breakdown shape (which library? which API?)
   - You'd be guessing at acceptance criteria for the children

3a. **Research-first path** (under-specified):

    Create ONE child issue:
    - Title: `Research: <specific question> for #<parent>`
    - Body: see "Research subtask template" below
    - Labels: `chore`, `clarified`, `tdd`, `hitl` (research subtasks always need human review)
    - Link as sub-issue of parent (see "Sub-issue linking" below)

    Update parent labels:
    - Remove `slice`
    - Add `awaiting-research`

    Post a comment on the parent (template below). Stop.

3b. **Clear-plan path**:

    Pick a **slicing strategy**:
    - **Horizontal** (one layer per subtask) — when the work has hard layer dependencies (schema → API → UI), tightly coupled changes that ship as one feature, or under ~6 children
    - **Vertical** (tracer-bullet end-to-end slices) — when the issue lists multiple distinct user outcomes, when you can ship something useful after each slice, or when the feature spans many files

    Default to horizontal when uncertain.

    Create N child issues (typically 3–6). For each:
    - Title: `<verb-prefixed concrete deliverable> for #<parent>` (e.g. `feat(store): add cmdBarExpandedHeight to settings store for #37`)
    - Body: see "Implementation subtask template" below — MUST include a red-test list as the definition of done
    - Labels: parent's category (`bug`/`enhancement`/`chore`), `clarified`, `tdd`, plus exactly one of `hitl` / `afk`. Children do NOT get `feature` (only top-level parents do).
    - Link as sub-issue of parent

    Update parent labels:
    - Remove `slice`
    - Add `sliced`

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

- **Sub-issue links are mandatory.** Every child must be linked as a sub-issue of the parent via the GraphQL mutation above. Without the link, the parent's UI does not show the children.
- **Idempotent:** if parent has `sliced` or `awaiting-research`, exit silently.
- **No body modification** of the parent. Update labels only.
- **Children inherit category** (`bug`/`enhancement`/`chore`) from parent. They get `clarified` (state — they are created already in template shape) + `tdd` (action) + `hitl|afk` (gate). They do NOT get `feature` (only top-level parents do).
- **Children get `hitl` or `afk`**, exactly one each. Never both, never neither.
- **Default count**: 3–6 children. If you'd create more, the parent is too big and should be split first (post a clarification comment instead of forcing an oversized plan).

## Comment templates

**Clear-plan path:**

```
> *Sliced automatically by the `aw-slice` skill. Reply with corrections or to flip hitl/afk on any subtask.*

Sliced into <N> sub-issues using <horizontal|vertical> strategy. Each child carries a red-test list as its definition of done. Subtasks: <#A, #B, #C>.

Order: <#A → #B → #C> (per `Depends on:` markers).

Reasoning: <one-sentence why this slicing>.
```

**Research-first path:**

```
> *Sliced automatically by the `aw-slice` skill.*

Not enough is known to plan implementation subtasks confidently. Created research subtask <#R> covering: <question 1; question 2; ...>.

When the research subtask closes, flip this parent's labels: remove `awaiting-research`, add `slice` to re-trigger.
```

## Constraints from the dev process

- Parent state transition: `slice` → `sliced` (clear path) or `slice` → `awaiting-research` (research path).
- Re-slicing after research: human or automation flips `awaiting-research` → `slice` on the parent.
- The `aw-tdd` workflow picks up children labeled `tdd` + `afk`. It does not look at parents.
