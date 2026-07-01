---
name: aw-tdd
description: Implement a `tdd + afk` issue using TDD red-green-refactor. The issue is either an issue that aw-slice did not split (the common case) OR one of the peer issues created by aw-slice when an issue had multiple independent user values. Writes failing tests first, implements minimum to pass, runs full test suite as a hard gate, opens a draft PR. Updates labels through tdd → review. Reverts and reports if anything fails.
---

# aw-tdd

Implement a single issue end-to-end following the red-green-refactor cycle. The issue is either an issue that aw-slice decided not to split (the common case) or a peer issue created by aw-slice when an issue had multiple independent user values. Open a draft PR for human review when done. Fail closed (no PR) if anything goes wrong.

**One PR = one shippable unit of user value.** This is the core contract. The PR you open should make the user's life better in a concrete, observable way after merge. Settings store fields, CSS variables, or other infrastructure changes are NOT a unit on their own — they ship inside the PR that delivers the user value they enable.

## Inputs

- `ISSUE_NUMBER` — the issue to implement (parent or sub-issue)
- The issue body (must include `Red tests` section or equivalent acceptance criteria)
- The codebase (already checked out)
- `pnpm test`, `pnpm typecheck`, `pnpm lint` available

## Step 0 — Load accumulated rules (mandatory; before anything else)

Read `.claude/feedback/INDEX.md` then read every `feedback_*.md` whose row lists this skill (or `all`) in `aw_applies_to`. These are corrections from past interactive sessions; they override conflicting guidance in this SKILL.md when they conflict. Skipping this step is the single biggest cause of avoidable AW failures.

For `aw_applies: with-modification` rules, read "user" as the issue or PR thread you're working on — the rule's `aw_note` frontmatter explains the modification.

## Pre-flight

0. **Check for a PR already in flight.** Before anything else: `gh pr list --search "resolves #$ISSUE_NUMBER OR fixes #$ISSUE_NUMBER OR closes #$ISSUE_NUMBER" --state open --json number,url`. If any open PR referencing this issue is found, exit silently — a concurrent run has already claimed the issue. Do not rely solely on the `review` label: GitHub label writes have latency, and two concurrent triggers can both pass the label check before either has written to the API.

1. **Read the issue, including comments.** `gh issue view $ISSUE_NUMBER --json title,body,labels,number,comments`.
   - Verify it has `tdd` AND `afk` AND `refined` AND exactly one of `bug` / `enhancement` / `chore`. If not, exit silently.
   - Verify it does NOT have `review` or be closed.

1.4. **Read human comments since the latest `refined` marker** — authoritative override material.

   When the user resets an issue back to `tdd` (manually, or via `aw-feedback`'s "Redo implementation" path), they typically leave a comment explaining what was wrong with the previous attempt or what the implementation must do differently. **Comments posted between the most recent `refined` event and now are authoritative input to this run.** Without folding them in, the same wrong implementation will ship again.

   - Filter the `comments` array to skip bot comments (any comment whose author is `github-actions[bot]`, `claude[bot]`, `app/claude`, or whose body opens with a `> *Refined automatically` / `> *Sliced by` / `> *Reviewed by` / `> *Read by` / `> *Implemented by` marker).
   - Of the remaining human comments, focus on those posted after the issue's most recent `refined` event. As a fallback heuristic: any human comment whose timestamp is after the latest bot `Refined automatically` marker comment, or after the latest bot `Reviewed by aw-review` comment if that came later.
   - Treat each such human comment as **authoritative**. What the human explicitly stated outweighs any conflicting interpretation of the body alone. In particular:
     - "Wrong path" / "Files explicitly NOT touched" / "DO NOT" → those files are forbidden in this run, regardless of what `Files likely to change` in the body says.
     - "It should be transient, not persistent" / "session-only, not stored" → semantic overrides on storage / persistence shape.
     - "The previous PR did X but should have done Y" → Y is the requirement; write a red test that asserts Y, not X.
   - **Combine with retry gaps from step 1.5.** If both override comments AND aw-review rejections exist, treat them as one merged list of red tests — every override-comment requirement gets its own failing test, alongside every `✗ Missing` / regression from the prior PR.

1.5. **Check for prior `aw-review` rejections (retry detection).** Find any closed bot-authored PRs for this issue:
   ```
   gh pr list --search "resolves #$ISSUE_NUMBER OR fixes #$ISSUE_NUMBER OR closes #$ISSUE_NUMBER" --state closed --json number,author --jq '[.[] | select(.author.login == "github-actions[bot]" or .author.login == "app/github-actions")]'
   ```
   If any exist, this is a **retry**. For the most recent closed PR:
   - Read its review comments: `gh pr view <N> --json comments --jq '[.comments[] | select(.author.login == "github-actions")] | last | .body'`
   - Extract every criterion marked `✗ Missing` or identified as a bug/regression (empty callbacks, wrong behavior)
   - **These gaps are your highest-priority red tests.** Write a failing test for each before writing any other implementation. The aw-review will check the same criteria again — if there is no test for a gap, you will introduce the same gap again.
   - Also check if the issue body lists files in scope that were NOT in the previous PR's diff; read those files before starting implementation.

2. **Check `Depends on:` blockers.** Parse the body for `Depends on: #N` references. For each:
   - `gh issue view N --json state,labels --jq '.state'` — if not `CLOSED`, the dependency is not done.
   - If any blocker is open, post a comment (template below), exit silently. Cron will retry later.

3. **Read the parent issue context.** The subtask title contains `for #<parent>`. Read the parent's body and any sibling subtasks to understand the broader feature.

4. **Read the relevant files.** The subtask body lists `Files likely to change:` — read each, plus their tests, plus 1–2 levels of imports/callers.

   **Before opening any single file, grep for parallel implementations.** Per `feedback_search_all_renderers`: run `grep -rn` for every UI element, function, store action, or component the issue mentions, across `src/` (or the project's source root). Single-file fixes that miss a parallel implementation are the most common cause of `aw-review` resets. Projects often carry parallel implementations transiently — two layout shells during a migration, two settings dialogs while one is being deprecated, a legacy plus a new sidebar tree. If the grep returns more than one renderer of the same concern, list every match in the PR body's `## Decisions made` and either fix all of them or explicitly defer the others with a rationale. Do not silently fix one and ship.

4.5. **Apply propose-don't-punt.** Look for prior agent guidance:

   - Issue body's `## Assumptions` section (set by `aw-refine`) — these are committed assumptions; honour them unless overridden by a comment.
   - Issue body's `## Open questions` section — if any are still unresolved (rare — slice should have resolved them), pick a defensible answer for each.
   - Slice rationale comment's `## Proposed answers` section (set by `aw-slice`) — these are authoritative; implement against them.

   Carry every assumption, proposed answer, or implementation-time decision forward into the PR body's `## Decisions made` section so reviewers see what was chosen and can override at PR review (or by comment, which `aw-feedback` routes back). Never block waiting for human input mid-implementation; pick a defensible choice and document it.

   **Escape hatch — tangled-issue circuit breaker.** Per `feedback_no_partial_fixes`: if the issue surfaces THREE OR MORE interrelated sub-decisions that propose-don't-punt can't resolve confidently (each choice constrains the next; getting any one wrong cascades), STOP. Do NOT proceed with a defensible-guess implementation — a partial fix to a tangled issue is worse than no fix because it creates a PR the reviewer cannot evaluate. Instead: post the tangled-issue comment template (below), flip the issue to `hitl` (remove `tdd` + `afk`), and exit. The operator unwinds the tangle by clarifying the issue body or splitting into peer issues, then re-flips to `tdd + afk` for retry.

## Lifecycle labels

Update the subtask issue's labels at three points:
- **Start:** remove `afk` (claim it). The agent is now working on it. Post the start comment.
- **PR opened:** add `review`, remove `tdd`. Post the done comment. (Keep `refined`; `afk` was removed at start.)
- **Failure:** re-add `afk`. Post the failure comment with the specific failure.

## Process: red-green-refactor

### Red

1. Write the failing tests EXACTLY as specified in the subtask's `Red tests` list. One assertion per bullet.
2. Place tests in the convention used by the repo: co-located `__tests__/<file>.test.tsx` for components, `*.test.ts` for utilities.
3. Run only the new tests:
   - For Vitest: `pnpm vitest run <test-file>`
   - For Playwright: `pnpm playwright test <test-spec>`
4. **Verify the tests are RED.** They MUST fail. If any test passes here:
   - **Exception for additive changes:** if a listed test covers an *existing, unchanged* code path (e.g. a regression guard verifying 'file behaviour still works when the new flag is false'), it is expected to be green before implementation. Continue as long as at least one test covering the *new* behaviour is red.
   - Otherwise: the test is wrong (it's testing something already true) or the bug is not real — post a comment explaining, fail the workflow, do NOT proceed to green

5. **Security / isolation carve-out — red MUST prove the leak is real.** Per `feedback_red_team_tdd`: if the issue is a security, isolation, sandboxing, permission, or privacy concern, the red test must demonstrate the LEAK before the fix. Write the attack: a test that simulates the unauthorized read, the cross-boundary call, the bypassed permission — and confirm it currently SUCCEEDS (i.e., the test asserts the leak is observable, and the assertion passes against unmodified code). Only then write the fix and flip the assertion. Tests that assert "the gate correctly denies X" without first proving "X was previously not denied" are worthless as regression locks — the gate may have already existed. If you can't make the attack succeed against current code, the bug is not real or the test is wrong; escalate via `hitl`, do NOT proceed to green.

### Green

1. Write the minimum implementation to make the tests pass. Do not add features not required by the tests.
2. Re-run only the new tests. They MUST all pass now.
3. If any still fail, iterate (up to 3 attempts). If still failing after 3 attempts, post a failure comment, fail closed.

### Refactor

1. Look at the changes you just made. If there's an obvious cleanup (extracted helper, deduplication, dead code) that does NOT change behavior, apply it.
2. Re-run the new tests. They must still pass.
3. If you can't think of an obvious refactor, skip — don't invent one.

## Hard gates (in order — failing any aborts the run)

1. **Red tests were red:** verified before green phase. No PR opens if green-from-start.
2. **Red tests are green after implementation:** verified after green phase.
3. **Full test suite passes:** `pnpm test` — all existing tests still green.

   **Pre-existing failures count.** Per `feedback_fix_all_test_failures` and `feedback_fix_ci_always`: a failure that existed on `main` before this branch is still a failure on this branch — CI runs the same suite and will fail identically. Either fix the failure as part of this PR (a one-line side commit on this branch is fine) OR, if the failure is genuinely environmental (CI runner image regression, third-party stack outage), follow the bounded-retry escape hatch in `feedback_fix_all_test_failures`: up to 3 fix attempts, then post a diagnostic comment and label `needs-human` rather than pushing red. Do NOT loosen the failing assertion, the tolerance, or the timeout to make red turn green — that anti-pattern was explicitly called out.

4. **Typecheck passes:** `pnpm typecheck`.
5. **Lint passes** (if the repo has a lint script): check `package.json` for `lint`. Skip if absent.
6. **Outcome check (post-implementation).** Per `feedback_outcome_shaped_criteria` and `feedback_code_review_mandatory_gate`: re-read the issue body's first paragraph (the operator's stated outcome) AND every comment posted since the latest `refined` marker. List every behaviour the diff changes. For each, identify the user-observable scenario it should affect and either (a) **run** a test that exercises that scenario end-to-end and confirms the outcome, or (b) describe in the PR body's `## Decisions made` why no automated scenario can be run and what manual verification was performed. **Asking the question is not the same as running it** — an agent that reads the issue and shrugs passes the gate trivially; running the scenario is the actual gate. If the criteria pass literally but the outcome misses, the criteria were wrong; flip the issue back to `refine` with a comment surfacing the mismatch rather than shipping the literal-but-wrong implementation.
7. **No unrelated changes:** `git diff --stat` — should only touch the files listed in the subtask body (plus their tests). If unexpected files are modified, abort.

## Branch + PR

When all gates pass:

1. Create a branch following `claude/<entityType>-<issue-number>-<short-description>` convention (claude-code-action handles this when `branch_prefix` is set).
2. Commit changes with a message matching the repo's convention. The commit body must include a GitHub auto-close keyword so the PR auto-closes the issue on merge. Pick by category:
   - `bug` → `Fixes #<issue-number>`
   - `enhancement` or `chore` → `Resolves #<issue-number>`

   GitHub only auto-closes on these keywords (with `close|closes|closed`, `fix|fixes|fixed`, `resolve|resolves|resolved` all working). `Implements`, `Addresses`, and similar do NOT trigger auto-close — earlier versions of this skill used `Implements` and produced PRs that merged without closing the issue.
3. Push the branch.
4. Open a **draft** PR via `gh pr create --draft --title "..." --body "..."`. Title pattern: same as commit subject. Body template below.

   The aw-tdd workflow uses the `WORKFLOW_PAT` fine-grained token (not `GITHUB_TOKEN`) for PR creation. The PAT has `pull-requests: write` and `workflows: write`, so `gh pr create` succeeds AND the resulting `pull_request: opened` event fires CI normally — the recursion guard does NOT apply to PAT-initiated events. See `docs/agentic-workflow.md` → "Choice: WORKFLOW_PAT for bot-PR CI gating" for the rationale.
5. Update the subtask issue: add `review`, remove `tdd`. Post the done comment.

6. **Optional: explicitly dispatch `aw-review`.**

   Since the PR was created via `WORKFLOW_PAT`, `aw-review.yml`'s `pull_request: opened` trigger fires automatically — no explicit dispatch is required. The dispatch step below is kept as a defence-in-depth safety net in case the `pull_request` event was somehow missed (e.g. CI was paused on the repo).

   ```
   gh workflow run aw-review.yml --field pr_number=<N>
   ```

   If you ran step 4 successfully, you can skip step 6.

## On failure

If any hard gate fails:

1. Discard local changes: `git checkout -- .` and `git clean -fd` (only files that were modified by this run — never touch the user's pre-existing uncommitted work).
2. Update the subtask issue: re-add `afk` (so cron retries don't see this as already-running).
3. Post a failure comment with: which gate failed, the exact error output (truncated to ~50 lines), and any next-step suggestions.

## Comment templates

**Start:**

```
> *Starting implementation via the `aw-tdd` skill (run id: <github.run_id>).*

Following red-green-refactor:
1. Writing failing tests from the red-test list above
2. Implementing minimum to pass
3. Running full test suite
4. Opening draft PR if all gates pass

Will update this comment thread with progress.
```

**Done (PR opened):**

```
> *Implementation complete. Draft PR <#PR> opened for review.*

- Red phase: <N> tests written, all initially failing ✓
- Green phase: minimum implementation, all <N> tests passing ✓
- Full test suite: passing ✓
- Typecheck: clean ✓
- Refactor: <one-line summary or "skipped — implementation already minimal">

Review the draft PR before marking it ready.
```

**Failure:**

```
> *Implementation failed at: <gate name>.*

<one-line summary of what went wrong>

<truncated error output, in code block, ~50 lines max>

Reset back to `tdd + afk`. Cron will not auto-retry — investigate and either:
- Fix the issue body / red-test list and let cron pick this up again, or
- Flip to `hitl` to force human implementation, or
- Close as `wontfix` if the issue is no longer relevant.
```

**Blocked by depends-on:**

```
> *Skipping for now — blocked by open dependency.*

`Depends on: <#blocker>` is not yet closed. Will retry when it closes.
```

**Tangled-issue circuit breaker (from Pre-flight step 4.5):**

```
> *Escalating to human — issue surfaces 3+ tangled sub-decisions per `feedback_no_partial_fixes`.*

Stopping before implementation. The propose-don't-punt heuristic isn't safe to apply here because each of the following decisions constrains the others, and getting one wrong cascades:

- <sub-decision 1> — <why it's tangled with the others>
- <sub-decision 2> — <why it's tangled with the others>
- <sub-decision 3> — <why it's tangled with the others>

A partial fix would create a PR that can't be reviewed cleanly. Flipping to `hitl` for the operator to either clarify the issue body or split into peer issues with the tangle resolved upfront. Re-flip to `tdd + afk` to retry.
```

## PR body template

The first line MUST be a GitHub auto-close line — `Fixes #<issue-number>` for `bug` issues, `Resolves #<issue-number>` for `enhancement` / `chore` issues. Without it the linked issue will not close on merge.

```
<Fixes|Resolves> #<issue-number>

## Summary

<one-paragraph summary of what changed>

## Red tests added

- `<test file>::<test name>` — <one-line behavior under test>

## Green implementation

<bulleted list of files changed and the change>

## Refactor

<note any cleanup, or "skipped">

## Decisions made

<one bullet per assumption (from the issue body's `## Assumptions`), proposed answer (from slice's `## Proposed answers`), or implementation-time decision the agent made because the spec was silent. Each bullet: question | chosen answer | one-line reasoning. Use "—" if no decisions were made beyond following the spec verbatim. Reviewers can comment "wrong assumption — use X" to override; `aw-feedback` routes that back to the appropriate stage.>

## Verification

- [x] Red tests were red before implementation
- [x] All red tests now green
- [x] `pnpm test` passes (full suite)
- [x] `pnpm typecheck` clean
- [x] No unrelated files modified

## Notes for reviewer

<anything the reviewer should pay attention to: edge cases, design alternatives considered, things that surprised the agent>

🤖 Generated with [Claude Code](https://claude.com/claude-code) via the `aw-tdd` skill.
```

## Output rules

- **Never push to `main`.** Always work on `claude/...` branches.
- **Always open as draft.** Human reviews before merging.
- **Hard gates are hard:** any failure → revert + comment + exit. Do not "force through".
- **Idempotent on labels:** if `review` already exists when this skill starts, exit silently — another run is in flight or crashed; don't double-implement.
- **One subtask per run.** Pick the first eligible from the candidates list and stop.
- **Do not modify the issue body.** That is `aw-slice`'s authorship.
- **Do not modify sibling subtasks.** Each runs in its own coder pass.
- **Do not bump dependencies, refactor adjacent code, or add features beyond the subtask scope.** Stay narrow.

## Constraints from the dev process

- Pick from `tdd` + `afk` + `refined` + category (sub-issues created by `aw-slice`).
- The retrospective workflow runs after merge — do not write retro entries from here.
- If a subtask is too large to fit one PR (>500 lines diff OR >15 files — the same budget `aw-slice` uses), it was sliced wrong. Post a comment recommending a re-slice rather than implementing partially.

## Most-relevant feedback rules for this skill

When context budget is tight, prioritise loading these rules from
`.claude/feedback/` (the full set is in `.claude/feedback/INDEX.md`).

<!-- BEGIN auto-generated by scripts/gen-feedback-index.py — do not hand-edit -->

**Universal (load for every skill):**

- `.claude/feedback/feedback_delete_old_skills.md` — Never ask the user to run commands or do mechanical steps — just do them yourself
- `.claude/feedback/feedback_generic_voice.md` — Never name the operator, contributors, or individuals when writing rules, READMEs, skill prompts, or commit messages intended to live in the repo. The text must be copy-pasteable to another repo without rewording.
- `.claude/feedback/feedback_write_feedback_to_repo.md` — When saving a memory in a project that has `.claude/feedback/`, behavioural-correction rules (anything that should change future behaviour on the same task class) MUST go in the repo so they're visible to AW agents and travel with the project. Local `~/.claude/projects/<project-slug>/memory/` is only for project-state memories (in-flight work, branch state, scratch notes).

**Specific to `aw-tdd`:**

- `.claude/feedback/feedback_add_tests.md` — When verifying bug fixes with test cases, add them as proper vitest tests in the project instead of running ad-hoc scripts
- `.claude/feedback/feedback_branch_protection_ci_required.md` — main branch has protection rules — CI must pass before any PR can merge; never try to merge without waiting for checks
- `.claude/feedback/feedback_check_before_workarounds.md` — When a feature gap forces a choice between two options, surface the choice to the user — don't pick a workaround silently. The "obvious safe default" often isn't what the user wants. *(modification: AW flips to `hitl` label + posts a comment with the choice instead of asking interactively.)*
- `.claude/feedback/feedback_fix_all_test_failures.md` — Never dismiss local test failures as "pre-existing on main" — CI uses the same suite and will fail. Fix every failure that surfaces locally, regardless of cause.
- `.claude/feedback/feedback_full_coverage.md` — When implementing a feature, cover ALL touch points completely. Never leave known gaps as "follow-ups" unless the user explicitly says so.
- `.claude/feedback/feedback_functional_parity_vs_visual_parity.md` — When wrapping existing functionality in a new UI shell, functional parity and visual parity are distinct gates — both mandatory, neither substitutes for the other.
- `.claude/feedback/feedback_manage_branch_yourself.md` — When the work belongs on a specific branch, the agent must check / switch / create the branch via git, not tell the user to do it
- `.claude/feedback/feedback_mark_prd_done.md` — When completing tasks, mark them done in BOTH the task breakdown file AND the PRD — headings and checkboxes
- `.claude/feedback/feedback_no_at_in_claude_md.md` — Never use @ prefix for large reference docs in CLAUDE.md — @ causes auto-loading into every conversation context regardless of relevance *(modification: Applies as-is when aw-tdd edits CLAUDE.md (rare). Does not apply to AW skill files (which are not @-loaded).)*
- `.claude/feedback/feedback_no_partial_fixes.md` — Don't rush partial fixes after identifying an issue as architecturally complex — do proper analysis first
- `.claude/feedback/feedback_outcome_shaped_criteria.md` — When a task's acceptance criteria name a file, line, function, or hook to modify, treat that as a *suggested* implementation — not the goal. The goal is the user-observable outcome. Verify the outcome before declaring done, even when the literal criteria are satisfied.
- `.claude/feedback/feedback_perf_store_selectors.md` — Never use destructured useStore() — always use individual selectors. Debounce editor serialization.
- `.claude/feedback/feedback_red_team_tdd.md` — Drive security/isolation work from failing attack tests — write the attack, confirm it succeeds (leak is real), flip the assertion, land the fix, keep the test as a regression lock
- `.claude/feedback/feedback_reduce_rust_weight.md` — Project has too much Rust complexity. Prefer browser/frontend solutions over Rust backends when the browser can do the job.
- `.claude/feedback/feedback_search_all_renderers.md` — When a visual bug appears in a UI element, grep the whole codebase for every renderer of that element before assuming one file is "the" implementation. Especially in apps with multiple layout shells.
- `.claude/feedback/feedback_survey_shadcn_first.md` — Notesage's design system says "use shadcn first." When the user asks whether a shadcn component fits, the right answer is a structured survey of every relevant primitive (CommandItem, DropdownMenuRadioItem, DropdownMenuCheckboxItem, SelectItem, etc.), not "no, only X exists, build custom." Surveying first prevents recommending tailor-made components when shadcn already covers the pattern.
- `.claude/feedback/feedback_task_done_format.md` — Use checkmark emoji in task title to mark done, never use checkbox syntax
- `.claude/feedback/feedback_task_status_marks.md` — In tasks files, mark a task 🚧 when work is kicked off (by me or a sub-agent), flip to ✅ when the work lands — both via git apply --cached to bypass the formatter.
- `.claude/feedback/feedback_test_before_promising.md` — When a UI component doesn't work as expected, research and fix it instead of falling back to inferior alternatives
- `.claude/feedback/feedback_verify_prod_dev.md` — Always verify changes work in BOTH production builds and dev mode before saying they're safe *(modification: AW can't run prod builds — modified rule: avoid changes that obviously break the prod path (e.g., dev-only imports, `import.meta.env.DEV` gates without a prod fallback).)*
- `.claude/feedback/feedback_wysiwyg_exports.md` — Export styling must come from the editor, not template pickers. Templates are for document creation, not export.

<!-- END auto-generated -->
