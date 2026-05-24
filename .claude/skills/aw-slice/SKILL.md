---
name: aw-slice
description: Decide whether a refined GitHub issue ships as one PR or as N PRs. Default is one PR (no slicing) — issues with a single user value pass directly to aw-tdd. Slice only when the issue delivers N independent user values, each independently shippable. Creates a research peer issue first if under-specified.
---

# aw-slice

Decide how a refined GitHub issue should be implemented: as one PR (the common case) or as N PRs (when it delivers multiple independent user values). The unit is **user value** — what a user can do after the PR merges that they couldn't do before. One PR = one shippable unit of user value.

## Inputs

- `ISSUE_NUMBER` — the parent issue to slice
- The issue body, title, labels, and any prior comments (read via `gh issue view`)

## Step 0 — Load accumulated rules (mandatory; before anything else)

Read `.claude/feedback/INDEX.md` then read every `feedback_*.md` whose row lists this skill (or `all`) in `aw_applies_to`. These are corrections from past interactive sessions; they override conflicting guidance in this SKILL.md when they conflict. Skipping this step is the single biggest cause of avoidable AW failures.

For `aw_applies: with-modification` rules, read "user" as the issue or PR thread you're working on — the rule's `aw_note` frontmatter explains the modification.

## Process

1. **Read the issue, including comments.**
   - `gh issue view $ISSUE_NUMBER --json title,body,labels,comments`
   - Verify it has `refined` AND `slice` AND one of `bug` / `enhancement` / `chore`.
   - Verify it does NOT have `sliced` or `awaiting-research`. If it does, exit silently (idempotent).
   - The `slice` action label is the explicit gate. Set by `aw-refine` after a successful clarification, or by a human after a research peer closes (`awaiting-research` → `slice`). Bare `refined` alone is NOT a trigger.
   - The `feature` label is **deprecated**. Don't check for it; don't add it. It was a parent marker from the original sub-issue model that we pivoted away from in favor of peer-issue splits.

1.5. **Read human comments since the latest `refined` marker** — authoritative override material.

   When the user resets an issue back to `slice` (after research, after a feedback cycle, or via `aw-feedback`'s "Redo slicing" path), they typically leave a comment explaining what should change. Comments posted between the most recent `refined` marker and now are authoritative input to this run.

   - Filter the `comments` array to skip bot comments (skip any comment whose author is `github-actions[bot]`, `claude[bot]`, `app/claude`, or whose body opens with a `> *Reviewed by` / `> *Sliced by` / `> *Refined automatically` marker).
   - Of the remaining human comments, focus on those posted after the issue's most recent `refined` event. Use the comment timestamp; if needed, fall back to: any human comment whose timestamp is after the latest bot `Refined automatically by the aw-refine skill` marker comment.
   - Treat each such human comment as **authoritative**. What the human explicitly stated outweighs any conflicting interpretation of the body alone. Fold the corrections into:
     - The slice rationale's `## Proposed answers` (when the comment answers an open question or overrides one of slice's would-be assumptions)
     - The peer-issue bodies, if slicing produces them (when the comment changes how values should split)
     - The `## Why hitl` section (when the comment reveals a security / data-loss concern that elevates from `afk` to `hitl`)
   - If the human comment includes "DO NOT" / "Wrong path" / "Files explicitly NOT touched" sections, mirror them in the slice rationale or the peer-issue bodies so `aw-tdd` can't miss them.

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
   - **1 value group** — check scope before deciding:
     - **Estimate the implementation size**: count distinct files that need to change and estimate
       total lines added/removed based on the issue body's "Files likely to change" section and
       acceptance criteria.
     - **If scope is large (estimated >500 lines OR >15 files modified)** → phased child issues path
       (see below).
     - **If scope is normal (<500 lines AND ≤15 files)** → DO NOT slice. The parent itself becomes
       the work unit:
       - Update parent labels: remove `slice`, add `tdd` and exactly one of `hitl` / `afk`
       - Post a "passing through unsliced" comment (template below)
       - Stop. `aw-tdd` will pick up the parent directly and produce one PR.

   - **1 value group, too large for one TDD run (>500 lines OR >15 files)** — one user value but
     total implementation scope exceeds what a single TDD run can reliably complete. Split into
     sequential **child issues** (NOT peer issues). Each child implements one phase and produces one
     PR; phases must land in order. The phases do NOT need to be independently shippable — they just
     need to be coherently separable steps toward the one value.

     When to use this path:
     - Estimated total diff is >500 lines or >15 files
     - You can identify 3+ coherent phases each with its own "red test → green" cycle
     - Each phase's files are substantially separate from the others (minimal overlap)
     - The phases form a strict sequence (phase N depends on phase N-1)

     Mechanism:
     - First create all child issues via `gh issue create`, then link them to the parent using the
       GraphQL `addSubIssue` mutation (requires the node ID of both parent and child):
       ```
       OWNER=$(gh repo view --json owner --jq '.owner.login')
       REPO=$(gh repo view --json name --jq '.name')
       PARENT_ID=$(gh api graphql -f query="query { repository(owner:\"$OWNER\",name:\"$REPO\") { issue(number: <N>) { id } } }" -q '.data.repository.issue.id')
       CHILD_ID=$(gh api graphql -f query="query { repository(owner:\"$OWNER\",name:\"$REPO\") { issue(number: <M>) { id } } }" -q '.data.repository.issue.id')
       gh api graphql -f query="mutation { addSubIssue(input: { issueId: \"$PARENT_ID\", subIssueId: \"$CHILD_ID\" }) { issue { id } } }"
       ```
     - Title format: `<parent title> — Phase N: <description>`
       (e.g. `Remove Classic Layout — Phase 2: delete ChatPanel & ActivityStrip`)
     - Body format: use the "Implementation subtask template". First line MUST be `Child of #<parent>`.
     - Labels:
       - Phase 1: category + `refined` + `tdd` + `afk` (auto-starts immediately)
       - Phases 2+: category + `refined` + `tdd` + `hitl` (human verifies each phase before unblocking the next)
     - Add `Depends on: #<prior-phase>` in each child's body (except phase 1)
     - Update parent labels: remove `slice`, add `sliced`
     - Post a phased-work comment (template below). Stop.

     **Default to NOT using this path.** Most large-looking issues are actually one phase. Only use
     child issues when each phase independently satisfies real acceptance criteria — not just "this is
     a lot of code."

   - **N independent value groups** — split into N peer issues (NOT sub-issues; no parent/child link):
     - **The original issue becomes the FIRST peer slice.** Rewrite its body to match the first value group only. Update its labels: remove `slice`, add `tdd` + one of `hitl` / `afk`. The original keeps its number, history, and comments.
     - **Create N-1 new peer issues**, one per remaining value group:
       - Title: `<verb-prefixed user-value statement>` (e.g. `feat(search): search across editor`)
       - Body: Goal (the user value) / Red tests / Green / Files likely to change / Definition of done. Reference the original issue with `Split from #<original>` for context, but no GraphQL sub-issue link.
       - Labels: same category as original + `refined` + `tdd` + one of `hitl` / `afk`.
     - Post a comment on the original explaining the split. Stop.

   **Default to "don't slice."** Most issues are one user value. Only slice when you can clearly name N independent values, each independently useful.

3a. **Research-first path** (the under-specified branch from step 2):

    Create ONE peer issue (NOT a sub-issue — no parent/child link):
    - Title: `Research: <specific question> for #<original>`
    - Body: see "Research peer template" below. The body MUST reference the original via `Spawned from #<original>` so the relationship is queryable later.
    - Labels: `chore`, `refined`, `tdd`, `hitl` (research peers always need human review)

    Update the original issue's labels:
    - Remove `slice`
    - Add `awaiting-research`

    Post a comment on the original (template below). Stop.

## HITL vs AFK — default `afk`

PR review is the human checkpoint. Mark `hitl` ONLY when one of these four narrow criteria applies:

1. **Destructive migration** to existing user data the user can't undo from the UI
2. **Security policy relaxation** (loosening — tightening is fine without `hitl`)
3. **Breaking change to a documented external API** (extension API, MCP, ACP, public Rust types — internal refactors don't count)
4. **Explicit human request** ("ask me first" in body or comment)

Design judgment, "many callers", "touches both shells", "I'm uncertain" — none of these are `hitl` triggers. Uncertainty routes to propose-answers or prototype-peers (below), not `hitl`. `Research:` peers are the one exception — they stay `hitl` because their output is a recommendation that needs sign-off before becoming acceptance criteria.

## Propose-don't-punt

For every open question in the refined body OR decision slicing surfaces, do exactly ONE:

(a) **Default — pick a defensible answer.** Update the body's `## Open questions` inline to resolve each. Record chosen answers + one-line reasoning each in slice rationale's `## Proposed answers` section. Mark `tdd + afk`. `aw-tdd` implements against the answers; humans override by comment (`aw-feedback` routes back here).

(b) **Prototype peers** — when N≥2 alternatives are defensibly different and only empirical comparison can pick. See below. Reserve for genuine empirical questions (perf trade-offs, motion-dependent UX feel, API ergonomics) — not "I can't decide between X and Y on paper."

(c) **`hitl`** — ONLY if no defensible answer exists AND prototyping isn't viable (e.g., a legal call). Rare.

Never mark `tdd + afk` with unanswered open questions in the body. Resolve inline, prototype, or `hitl` — never silent.

## Prototype peers mode

When (b) above triggers:

1. **Original becomes a tracking issue.** Body: one-paragraph summary + the N prototype hypotheses + how the user picks. Labels: remove `slice`, add `awaiting-prototypes` (no auto-action).
2. **Create N peer issues**, titled `Prototype <A|B|...>: <approach>`. Body: shared user-value goal + `Hypothesis: <what's distinct>` + acceptance criteria + `Tracking: #<original>`. Labels: category + `refined` + `tdd` + `afk` + `prototype`.
3. Each ships as its own draft PR in parallel. User picks the winner, merges, closes losing peers; tracking issue stays open until manually closed.

## Peer issue references

Child issues (sequential phase path) ARE linked via the GraphQL `addSubIssue` mutation — they have a
real parent/child relationship visible in the GitHub UI.

Peer issues are NOT linked via the GraphQL `addSubIssue` mutation — there is no parent/child relationship. Instead, the relationship is captured in the body text. Use one of these reference lines as the FIRST non-heading line of every newly-created peer's body:

- For value-split peers (multi-value path): `Split from #<original>`
- For research peers (research-first path): `Spawned from #<original>`

This keeps the relationship queryable (`gh issue list --search "Split from #<N>"`) without needing GraphQL or a parent label.

## Templates

### Research peer template

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
- **One PR = one shippable unit of user value.** A PR that delivers half a value (e.g. a settings store field with no consumer) is not a unit and should NOT be sliced out. Bundle it with the value it enables.
- **Slicing creates peer issues, not sub-issues.** When you split, rewrite the original issue body to be the FIRST peer slice; create N-1 NEW peer issues with `Split from #<original>` in the body. NO GraphQL parent/child link. NO `feature` label. The peers each independently enter the pipeline (each gets its own pipeline run, PR, merge).
- **Idempotent:** if the issue has `sliced` or `awaiting-research` or `tdd`, exit silently.
- **No body modification** when NOT slicing (the don't-slice path). When slicing, the original's body IS rewritten as slice 1 — that's the canonical path for the FIRST peer.
- **Peers inherit category** (`bug`/`enhancement`/`chore`) from the original. They get `refined` + `tdd` + `hitl|afk`. They do NOT get `feature`.
- **Each peer gets `hitl` or `afk`**, exactly one each. **Default is `afk`** (see "HITL vs AFK heuristics" — the four narrow `hitl` criteria are exhaustive).
- **Every `hitl` marking MUST cite which of the four narrow criteria applies** with one-line justification. A bare "Marked: tdd + hitl" without citing destructive-migration / security-relaxation / public-API-break / explicit-human-request is incomplete and incorrect — flip to `afk` instead.
- **Open questions get proposed answers**, never get punted. See "Propose-don't-punt". If empirical comparison genuinely beats reasoning, use prototype peers instead of `hitl`.

## Comment templates

**Don't-slice path (the common case):**

```
> *Reviewed by the `aw-slice` skill. This issue delivers one user value, so it ships as a single PR.*

**User value:** <one-sentence "User can …" statement>

**Marked:** `tdd + <afk|hitl>` — <REQUIRED if hitl: which of the four narrow criteria applies, with one-line justification; OPTIONAL but encouraged if afk: brief why-this-is-safe-to-automate>

<IF the issue body had `## Open questions` OR slicing surfaced decisions>
## Proposed answers

- **<question 1>** — <chosen answer>. <one-paragraph reasoning, including alternatives considered>
- **<question 2>** — <chosen answer>. <reasoning>

The issue body's `## Open questions` section has been updated inline to mark each question resolved. `aw-tdd` will implement against the chosen answers. To override an answer, comment "wrong assumption — use X instead" and `aw-feedback` will route the comment back here.
</IF>
```

**Slice path (multiple independent values):**

```
> *Sliced by the `aw-slice` skill. Reply with corrections or to flip hitl/afk on any peer.*

Identified <N> independent user values, each shipping as its own PR:

- #<A> — <user-value sentence> · `<afk|hitl>` — <REQUIRED if hitl: specific concern>
- #<B> — <user-value sentence> · `<afk|hitl>` — <REQUIRED if hitl: specific concern>
- #<C> — <user-value sentence> · `<afk|hitl>` — <REQUIRED if hitl: specific concern>

Order: <#A → #B → #C> (per `Depends on:` markers, if any).
```

**Research-first path:**

```
> *Sliced by the `aw-slice` skill.*

Not enough is known to identify the user values confidently. Created research subtask <#R> covering: <question 1; question 2; ...>.

When the research subtask closes, flip this parent's labels: remove `awaiting-research`, add `slice` to re-trigger.
```

**Prototype peers path:**

```
> *Sliced by the `aw-slice` skill — split into N prototype peers for empirical comparison.*

Identified N defensibly-different approaches that need to be tried before one can be picked:

- #<A> — **Prototype A: <approach>**. Hypothesis: <what makes A distinct>. Trade-off: <upside / downside vs B>.
- #<B> — **Prototype B: <approach>**. Hypothesis: <what makes B distinct>. Trade-off: <upside / downside vs A>.

Each prototype lands as its own draft PR. Try the live builds, merge the winner, close the losing peers (their PRs auto-close them; this tracking issue stays open until you close it).

This issue is now `awaiting-prototypes`. No further automation will run on it until you act.
```

**Phased child issues path:**

```
> *Sliced by the `aw-slice` skill — one user value, split into N sequential phases.*

This issue delivers one value but the implementation has <N> distinct sequential phases. Created <N> child issues:

- #<A> — Phase 1: <description> · `afk` — auto-starts
- #<B> — Phase 2: <description> · `hitl` — starts after human verifies phase 1 lands cleanly
- #<C> — Phase 3: <description> · `hitl` — starts after phase 2

Each child has `Child of #<this>` in its body and `Depends on:` its predecessor. Phases land in order; phases 2+ are `hitl` so you can verify each phase before the next begins.
```

**No-user-value path:**

```
> *Reviewed by the `aw-slice` skill. Could not identify a user value.*

This issue describes internal work without a user-observable result. Could you clarify what user behaviour this enables, or which value-delivering issue this should be bundled with?
```

## Constraints from the dev process

- Parent label transitions: `slice` → `tdd + (afk|hitl)` (don't-slice path), or `slice` → `sliced` (slice path, including phased child issues path), or `slice` → `awaiting-research` (research path), or `slice` → `awaiting-prototypes` (prototype-peers path).
- Re-slicing after research: human or automation flips `awaiting-research` → `slice` on the parent.
- Prototype-peers parent stays `awaiting-prototypes` until the user closes it manually after picking a winner. No auto-action.
- The `aw-tdd` workflow picks up any issue labeled `tdd` + `afk` regardless of whether it was the original or a peer split off from a multi-value parent.
- One PR = one user value. If a PR delivers two unrelated values, it was sliced wrong — split into two PRs.

## Most-relevant feedback rules for this skill

When context budget is tight, prioritise loading these rules from
`.claude/feedback/` (the full set is in `.claude/feedback/INDEX.md`).

<!-- BEGIN auto-generated by scripts/gen-feedback-index.py — do not hand-edit -->

**Universal (load for every skill):**

- `.claude/feedback/feedback_delete_old_skills.md` — Never ask the user to run commands or do mechanical steps — just do them yourself
- `.claude/feedback/feedback_generic_voice.md` — Never name the operator, contributors, or individuals when writing rules, READMEs, skill prompts, or commit messages intended to live in the repo. The text must be copy-pasteable to another repo without rewording.
- `.claude/feedback/feedback_write_feedback_to_repo.md` — When saving a memory in a project that has `.claude/feedback/`, behavioural-correction rules (anything that should change future behaviour on the same task class) MUST go in the repo so they're visible to AW agents and travel with the project. Local `~/.claude/projects/<project-slug>/memory/` is only for project-state memories (in-flight work, branch state, scratch notes).

**Specific to `aw-slice`:**

- `.claude/feedback/feedback_attach_docs_to_issue.md` — When a GitHub issue references docs files, ensure they are committed to the repo AND posted as collapsible comments on the issue
- `.claude/feedback/feedback_task_done_format.md` — Use checkmark emoji in task title to mark done, never use checkbox syntax
- `.claude/feedback/feedback_task_status_marks.md` — In tasks files, mark a task 🚧 when work is kicked off (by me or a sub-agent), flip to ✅ when the work lands — both via git apply --cached to bypass the formatter.
- `.claude/feedback/feedback_two_way_prd_tasks_links.md` — Every PRD must link to its tasks file and every tasks file must link back to the PRD — maintain bidirectional references always

<!-- END auto-generated -->
