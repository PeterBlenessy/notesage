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

## Pre-flight

0. **Check for a PR already in flight.** Before anything else: `gh pr list --search "resolves #$ISSUE_NUMBER OR fixes #$ISSUE_NUMBER OR closes #$ISSUE_NUMBER" --state open --json number,url`. If any open PR referencing this issue is found, exit silently — a concurrent run has already claimed the issue. Do not rely solely on the `review` label: GitHub label writes have latency, and two concurrent triggers can both pass the label check before either has written to the API.

1. **Read the issue.** `gh issue view $ISSUE_NUMBER --json title,body,labels,number`.
   - Verify it has `tdd` AND `afk` AND `refined` AND exactly one of `bug` / `enhancement` / `chore`. If not, exit silently.
   - Verify it does NOT have `review` or be closed.

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

4.5. **Apply propose-don't-punt.** Look for prior agent guidance:

   - Issue body's `## Assumptions` section (set by `aw-refine`) — these are committed assumptions; honour them unless overridden by a comment.
   - Issue body's `## Open questions` section — if any are still unresolved (rare — slice should have resolved them), pick a defensible answer for each.
   - Slice rationale comment's `## Proposed answers` section (set by `aw-slice`) — these are authoritative; implement against them.

   Carry every assumption, proposed answer, or implementation-time decision forward into the PR body's `## Decisions made` section so reviewers see what was chosen and can override at PR review (or by comment, which `aw-feedback` routes back). Never block waiting for human input mid-implementation; pick a defensible choice and document it.

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
4. **Typecheck passes:** `pnpm typecheck`.
5. **Lint passes** (if the repo has a lint script): check `package.json` for `lint`. Skip if absent.
6. **No unrelated changes:** `git diff --stat` — should only touch the files listed in the subtask body (plus their tests). If unexpected files are modified, abort.

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
- If a subtask is too large to fit one PR (>500 lines diff, >5 files), it was sliced wrong. Post a comment recommending a re-slice rather than implementing partially.
