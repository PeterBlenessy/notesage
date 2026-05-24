# aw-ci-repair

Auto-repair recurring CI perf-budget flakes on bot-authored draft PRs. Narrow, safe, one-attempt-only.

## Purpose

CI runners (macOS) pace ~3× slower than the dev machine used to set perf budgets. Bot-authored PRs from `aw-tdd` repeatedly fail with budget-exceeded messages because the budgets were written as bare numeric literals instead of `N * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1)`. The `test.yml` CI job already sets `PERF_BUDGET_MULTIPLIER=1.5` — the fix is to wrap the literal so the multiplier takes effect.

This skill performs ≤1 repair per PR, applies only well-understood mechanical fixes (Patterns A and B), and posts a comment on all other failure patterns explaining what it found.

## Step 0 — Load accumulated rules (mandatory; before anything else)

Read `.claude/feedback/INDEX.md` then read every `feedback_*.md` whose row lists this skill (or `all`) in `aw_applies_to`. These are corrections from past interactive sessions; they override conflicting guidance in this SKILL.md when they conflict. Skipping this step is the single biggest cause of avoidable AW failures.

For `aw_applies: with-modification` rules, read "user" as the issue or PR thread you're working on — the rule's `aw_note` frontmatter explains the modification.

## Pre-flight

1. **Check if this is a bot-authored draft PR on a `claude/` branch.**
   - PR must be: draft, on a branch matching `claude/*`, authored by `github-actions[bot]` or `claude[bot]`.
   - If not, exit silently.

2. **One-attempt cap — check for prior repair commits.**
   - Run: `git log --oneline --grep="fix(ci):" origin/main..HEAD`
   - If any `fix(ci):` commit exists on the PR branch already, **do not repair again**. Post a comment: "Prior repair commit found — skipping auto-repair to avoid loop." Then exit.

3. **One-attempt cap — check for prior repair comments.**
   - Use `gh pr view <PR_NUMBER> --json comments --jq '[.comments[].body | select(startswith("🔧 Auto-repair applied") or startswith("❌ Auto-repair could not apply") or startswith("Prior repair commit found"))]'`
   - If any such comment exists, exit silently (the skill already ran on this PR).

4. **Read the CI failure.**
   - Get the PR number from `workflow_dispatch` input or from `github.event.workflow_run` context.
   - Fetch the failing test log: `gh run list --branch <head_branch> --workflow test.yml --limit 1 --json databaseId --jq '.[0].databaseId'` then `gh run view <run_id> --log-failed`.
   - If no failure log is available, post a comment explaining and exit.

## Pattern Detection and Repair

### Pattern A — Missing `PERF_BUDGET_MULTIPLIER` wrap (auto-fix)

**Detection:** Failure log contains `toBeLessThan` or `toBeGreaterThan` assertion failure in a `src/perf/*.test.ts` file, AND the failing assertion uses a bare numeric literal (e.g., `toBeLessThan(500)` instead of `toBeLessThan(500 * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1))`).

**Repair:**
1. Locate the failing test file(s) from the log.
2. For each bare literal in a timing assertion (`toBeLessThan`, `toBeLessThanOrEqual`, `toBeGreaterThan` where the argument is ONLY a number), replace:
   - `toBeLessThan(N)` → `toBeLessThan(N * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1))`
   - `toBeLessThanOrEqual(N)` → `toBeLessThanOrEqual(N * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1))`
   - `toBeGreaterThan(N)` → `toBeGreaterThan(N * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1))`
3. Do NOT modify assertions where the argument is an expression (e.g., `sizeKB * 0.8`) or a variable — only bare numeric literals.
4. Limit: touch at most 2 files total across Pattern A + B combined.

**Then proceed to check Pattern B** (they are bundled in one commit).

### Pattern B — Missing `PERF_BUDGET_MULTIPLIER` env var in workflow YAML (auto-fix, bundled with A)

**Detection:** Failure log shows perf benchmark failures AND the failing job in `test.yml` does NOT set `PERF_BUDGET_MULTIPLIER` as an env var on the perf benchmark step.

**Repair:**
1. Read `.github/workflows/test.yml`.
2. Find the step that runs `pnpm test:perf` (or the equivalent perf benchmark command).
3. If that step does not have `PERF_BUDGET_MULTIPLIER` in its `env:` block, add:
   ```yaml
   env:
     PERF_BUDGET_MULTIPLIER: 1.5
   ```
4. This counts toward the ≤2 file limit.

**Note:** Pattern B is only repaired when Pattern A is also being repaired. Do not repair B in isolation — if B is the only issue, post a Pattern E comment instead.

### Pattern C — Snapshot drift (comment-only)

**Detection:** Failure log contains `snapshot` / `toMatchSnapshot` / `toMatchInlineSnapshot` mismatch.

**Action:** Post comment only:
> ❌ Auto-repair could not apply
>
> **Pattern C — Snapshot drift**
>
> The failing test uses snapshot assertions that are out of date. Auto-repair does not update snapshots because the new values require human review to confirm they represent correct behavior.
>
> To fix: run `pnpm vitest run --update-snapshots` locally, inspect the diff, then push the updated snapshots.

### Pattern D — DOM-changed assertion (comment-only)

**Detection:** Failure log contains assertion failure in an e2e spec (`.spec.ts`) where the expected DOM structure or text content has changed.

**Action:** Post comment only:
> ❌ Auto-repair could not apply
>
> **Pattern D — DOM-changed assertion**
>
> The failing E2E test asserts a DOM structure or text content that has changed. Auto-repair does not modify E2E assertions because they require visual verification that the new UI state is correct.
>
> To fix: review the failing assertion, verify the new behavior is correct, then update the test.

### Pattern E — Unrecognized failure (comment-only)

**Detection:** Failure log does not match Patterns A–D.

**Action:** Post comment only:
> ❌ Auto-repair could not apply
>
> **Pattern E — Unrecognized failure**
>
> The CI failure does not match any known auto-repair pattern. Manual investigation is needed.
>
> Failing step/log excerpt:
> ```
> <truncated failure log, max 40 lines>
> ```
>
> Next steps: investigate the failure, fix it manually, and push a follow-up commit to this PR.

## Hard Gates (in order — failing any aborts the repair)

1. **Pattern is A or B** — if only C, D, or E patterns are detected, post the appropriate comment and exit without touching any files.
2. **≤2 files modified** — the repair must touch at most 2 files total (the test file + optionally test.yml). If the repair would require touching more, post a Pattern E comment instead.
3. **Typecheck passes** — after applying the fix, run `pnpm typecheck`. If it fails, revert the changes and post a Pattern E comment with the typecheck error.
4. **Tests pass locally** — run `pnpm vitest run <affected-test-file>` to confirm the fix resolves the failure. If it still fails, revert and post a Pattern E comment.
5. **No force-push** — always `git push` without `--force`. If the push fails, investigate the cause; do not bypass with `--force`.

## Commit and Push

When all hard gates pass:

```
git add <file1> [<file2>]
git commit -m "fix(ci): honour PERF_BUDGET_MULTIPLIER in perf budget assertions

Pattern A: wrap bare numeric literals in timing assertions with
  N * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1)
so CI's 1.5× budget multiplier takes effect on macOS runners.

[Pattern B: add PERF_BUDGET_MULTIPLIER env var to test.yml perf step]"
git push
```

Then post a comment on the PR:
> 🔧 Auto-repair applied
>
> **Pattern A** — wrapped bare numeric literals in perf budget assertions with `PERF_BUDGET_MULTIPLIER` multiplier.
> [**Pattern B** — added `PERF_BUDGET_MULTIPLIER: 1.5` to the `test.yml` perf benchmark step env.]
>
> The push will trigger CI re-run. If CI still fails, the remaining issue is beyond this skill's scope — investigate manually.

## Output Rules

- **One attempt per PR.** Check for prior `fix(ci):` commits AND prior repair comments before doing anything. Exit if either exists.
- **Never force-push.** `--force` is explicitly forbidden.
- **≤2 files.** Reject the repair if it would require modifying more than 2 files.
- **Patterns C, D, E are comment-only.** Never modify files for these patterns.
- **Bot-authored draft PR on `claude/` branch only.** Exit silently for any other PR type.
- **Read-only when in doubt.** If the failure log is ambiguous or doesn't clearly match A or B, fall through to Pattern E and post a comment.
