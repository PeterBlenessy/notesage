# PRD: AW CI Repair — auto-fix recurring perf-budget flakes

|  |  |
| --- | --- |
| **Date** | 2026-05-11 |
| **Status** | Draft |
| **Priority** | Medium — pipeline-quality work. The current shape is "bot opens PR, CI fails on a known recoverable issue, human spends 5 minutes on a one-line fix, bot PR re-runs". Three of the last five bot PRs hit this pattern. |
| **Impact** | Bot-authored PRs that fail CI on a known recoverable pattern self-heal: a follow-up commit lands, CI re-runs, the human sees a green PR ready for review instead of a red one needing intervention. New tests can't introduce the same class of flake — a lint rule blocks the pattern at PR-write time. |
| **Trigger** | PR #191 CI failed three times across retries on `preview-fidelity.spec.ts:331` — `expect(p95).toBeLessThan(500)` against CI macos-latest pace, which lands p95 at 519–715 ms. The fix is one line: honour `PERF_BUDGET_MULTIPLIER` the same way the Vitest perf harness does. The test author already documented the CI pace drift in a sample-count tuning comment (line 306–309) but never patched the budget itself. v0.44.0-alpha.0 release CI hit the same shape on a different test (status-tray segmented picker click). |
| **Tasks** | [aw-ci-repair-tasks](../tasks/2026-05-11-aw-ci-repair-tasks.md) |
| **Phase** | AW pipeline maintenance |

## Problem

The AW pipeline (issue → triage → refine → slice → tdd → review → merge) optimises for the bot doing the work and a human doing the merge. The bot is good at writing tests for new behaviour. It is bad at noticing that its test will flake on CI because the absolute budget doesn't account for runner-pace drift.

**Concretely:** every recent bot-authored PR with a perf assertion has either:

1. Hardcoded a numeric literal (`expect(...).toBeLessThan(500)`) inside `e2e/**` or `src/perf/**` without wrapping it in `PERF_BUDGET_MULTIPLIER`, OR
2. Written the assertion in a file whose workflow job doesn't set `PERF_BUDGET_MULTIPLIER` (e.g. the Playwright e2e job — `PERF_BUDGET_MULTIPLIER=3` was only set on the frontend Vitest job before commit `c43b286a`).

Both shapes fail on CI runners that pace `setTimeout` ~1.5x slower than local AND share the runner with other jobs. The fix is a known migration: read the env var, multiply the budget, set the env var in the workflow file. Always identical. Always one-line.

The cost of these flakes isn't the CI minutes — it's the human cycle time. The user merges a bot PR, the bot opens the next PR five minutes later, that PR fails CI on a perf budget, the user has to context-switch into the failure log, identify the pattern, write the fix, push. Repeat. The aw-review skill explicitly does NOT touch code (read-only by design), so it can't pick this up.

Two failure shapes that look similar but should NOT be auto-fixed:

- **Snapshot drift** — `toMatchSnapshot` failure means the rendered output changed. Auto-accepting silently launders regressions. Human review only.
- **DOM-changed assertions** — `getByRole('radio')` failing after a component switched from RadioGroup to Select (alpha.0's StatusTray case) is not a flake; it's a test asserting stale DOM. Auto-fixing this would mean rewriting the test logic, which is closer to "implement the feature again" than to "apply a known migration".

The narrow scope below picks the one pattern that is reliably mechanical and high-frequency.

## Goals / Non-Goals

### Goals

1. **Prevent new hardcoded perf budgets.** A custom ESLint rule flags any `expect(...).toBeLessThan(<numeric literal>)` inside `e2e/**/*.spec.ts` or `src/perf/**/*.ts` unless the literal is multiplied by `PERF_BUDGET_MULTIPLIER` (or wrapped in a helper that does). PRs that introduce the pattern fail lint at PR-write time. ESLint runs as part of typecheck/test CI today; no new pipeline step needed.
2. **Auto-fix existing missing-multiplier failures on bot PRs.** A new `aw-ci-repair` skill triggered by `check_run.completed: failure` (or `workflow_run.completed: failure`) on a bot-authored draft PR's HEAD commit. Pattern-matches one shape only: `expect(N).toBeLessThan(M)` where `N` is within a small multiple of `M`, the assertion is in a perf-related file, and the test is missing the multiplier wrap. Patches the test, ensures the workflow env var is set, pushes one follow-up commit on the same branch.
3. **Bound the retry blast radius.** One repair attempt per PR. If the same job fails again after the repair commit, fall through to a human comment ("Repair attempted; failure persists — needs human review"). Never two repair commits on one PR.
4. **Be invisible when there's nothing to fix.** Non-bot PRs are ignored. Failures outside the pattern list post a one-liner comment naming the shape ("Snapshot drift — needs human") and exit. No file changes, no force-pushes.
5. **Document every repair.** The repair commit body names the pattern, links to the failed run, and shows the diff in plain English. Future retros can see how often the repair fires and on what surfaces.

### Non-Goals

- **Auto-bumping hardcoded thresholds.** "test failed at 715ms against a 500ms budget, so raise the budget to 800ms" hides regressions. The fix is to honour the multiplier; the underlying threshold stays put.
- **Auto-updating snapshots.** Same reason. `toMatchSnapshot` / `toMatchInlineSnapshot` failures fall through to human review.
- **Auto-fixing DOM-changed assertions.** `getByRole` / `getByText` failures after a component refactor mean the test is asserting stale DOM. Rewriting the assertion is "what the test should now check", which requires reading the diff and the component — out of scope for a mechanical repair skill.
- **Repair on human PRs.** Out of scope; humans can read the failure logs themselves.
- **More than one repair attempt per PR.** A second repair on a freshly-failed run risks loops on a genuinely-regressed test.
- **Repairing failures in workflow / config files** (`.github/workflows/`, `package.json`, etc.). Workflow-yml edits ARE in scope where the missing-multiplier env var needs to be added to a job — but only as part of the same repair, never as a standalone fix.
- **A general-purpose "fix any failing test" skill.** This PRD is scoped to ONE pattern. Future PRDs may add more patterns (e.g. type-only fixes — `pnpm typecheck` failures from a missing import) but each new pattern requires its own design review.

## User Stories

- **As Notesage's owner**, when a bot-authored draft PR fails CI on a perf-budget flake, I want the bot to push the one-line fix itself and have CI re-run, so that I don't have to context-switch into a known-recoverable failure to type the same fix again.
- **As Notesage's owner**, when a bot-authored draft PR fails CI on a NON-recoverable shape (snapshot drift, DOM-changed assertion), I want a one-line comment on the PR explaining why repair didn't fire, so that I know to take a closer look.
- **As a future contributor**, I want lint to fail my PR at write time if I add a hardcoded perf budget, so that I don't ship the bug class in the first place.
- **As the AW retrospect skill**, I want repair commits to be self-describing (named pattern, linked run, plain-English diff), so that retro can ask "is this pattern occurring often enough to warrant a different fix?"

## Technical Approach

The system is two independent pieces that compose: prevention (ESLint) keeps the bug class from growing; repair (`aw-ci-repair`) drains the existing tail without human cycles.

### Piece 1 — Regression-lock test: `no-bare-perf-budget`

The project does NOT have ESLint set up (no `eslint.config.*`, no `lint` script in `package.json`). Adding ESLint + a custom rule + a CI step is significant plumbing for a single rule. Notesage already uses a parallel pattern — vitest-based regression-lock tests that parse source files and assert conventions hold. Examples: `aw-workflow-concurrency.test.ts`, `aw-workflow-pat.test.ts`, `tauri-capability-surface.test.ts`.

A new test at `src/lib/__tests__/no-bare-perf-budget.test.ts` walks every file in `e2e/**/*.spec.ts` and `src/perf/**/*.ts`, looks for `expect(...).toBeLessThan(<number>)` (and the sibling matchers — `toBeLessThanOrEqual`, `toBeGreaterThan` for upper-bound durations), and asserts that the argument is NOT a bare numeric literal — it must be a `BinaryExpression` whose operand chain references `PERF_BUDGET_MULTIPLIER`. Approach options for parsing:

- Use the TypeScript compiler API directly (already a dev dep; `ts-morph` would be heavier).
- Simpler: regex-based parse since the patterns we're checking are syntactically narrow. Mirror the regex shape used in the existing aw-workflow tests.

Whichever approach is chosen, the test fails when:

1. An existing file is edited to introduce a new bare-literal assertion.
2. A new file is added with the bare-literal pattern.

Companion docs in the test header explain how to fix (the same wrap that `c43b286a` applied to `preview-fidelity.spec.ts:331`). No autofix — failing the test is enough signal at PR-write time.

If ESLint is added to the project for other reasons later, this rule can be migrated then; until then, the vitest regression-lock matches the existing project convention.

### Piece 2 — `aw-ci-repair` skill

Lives at `.claude/skills/aw-ci-repair/SKILL.md` and is driven by `.github/workflows/aw-ci-repair.yml`.

**Trigger:**

```yaml
on:
  workflow_run:
    workflows: ["Test", "Release"]   # the workflow names of CI runs we care about
    types: [completed]
  workflow_dispatch:
    inputs:
      pr_number:
        description: "PR number to repair (manual override)"
        required: true
```

Why `workflow_run` and not `check_run.completed`: `workflow_run` is the modern, documented trigger that gives the failed workflow's PR number via `workflow_run.pull_requests[0]`. `check_run` is per-job and would fire multiple times for the same failure.

**Job-level guards (cheap precheck before the LLM):**

```yaml
if: >
  github.event_name == 'workflow_dispatch' ||
  (github.event.workflow_run.conclusion == 'failure' &&
   github.event.workflow_run.event == 'pull_request' &&
   startsWith(github.event.workflow_run.head_branch, 'claude/'))
```

The branch-prefix filter is the same one `aw-review` uses to gate bot-authored PRs (see `aw-review.yml:46-49`).

**Hard guard inside the skill (pre-LLM bash):**

1. `gh pr view $PR_NUMBER --json author,headRefName,labels,isDraft` — verify draft + bot identity. Exit silently otherwise.
2. `gh pr view $PR_NUMBER --json comments -q '[.comments[] | select(.body | startswith("> *Repair attempted by `aw-ci-repair`"))]' | jq 'length'` — count prior repair attempts on this PR. If ≥1, exit silently (one-attempt cap).
3. Fetch the failed run's logs: `gh run view $RUN_ID --log-failed | head -200`. Pipe through `grep -E '^.*Error:|toBeLessThan|expect\('` to extract the failing assertion lines.

**LLM-driven pattern match:**

The skill (markdown body) prescribes:

1. Read the failed log lines. Identify ONE pattern from the list below. If no match, post a comment ("Failure shape not in repair list — needs human review: $SHAPE_NAME") and exit.
2. **Pattern A — missing PERF_BUDGET_MULTIPLIER in the assertion.** Symptoms: `expect(N).toBeLessThan(M)` where `N` is in the range `[M, M*5]`, file path is in `e2e/**` or `src/perf/**`. Fix: wrap the literal in `<M> * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1)`. Add a one-line comment above the assertion explaining the wrap.
3. **Pattern B — workflow job missing the env var.** Detection: after applying pattern A, grep the workflow file that runs the failing test for `PERF_BUDGET_MULTIPLIER`. If absent on the relevant job, add `env: { PERF_BUDGET_MULTIPLIER: "3" }` to the failing step. Use the same `"3"` as the existing frontend job (the chosen CI margin).
4. Run `pnpm typecheck` AND the targeted failing spec (`pnpm vitest run <file>` or `pnpm test:e2e -- <file>`) — both must pass before commit.
5. `git commit -m "fix(ci): honour PERF_BUDGET_MULTIPLIER in $FILE (auto-repair on PR #$N)"` + `git push origin $BRANCH`.
6. Post a structured comment on the PR documenting the repair (pattern matched, file changed, failed-run link).

**Hard gates (same shape as `aw-tdd`'s gate set):**

- `pnpm typecheck` — must pass after the change.
- The specific failing spec — must pass on the local repair runner.
- Modified files must be ≤2 (one test file + optionally one workflow yml). More than that means the pattern match was wrong; revert + exit + post comment.
- No `git push --force` ever. New commits on top of the PR branch only.

**Bot identity:** uses `WORKFLOW_PAT` (same as `aw-tdd` / `aw-iterate`) so the push fires `pull_request: synchronize` and CI re-runs naturally. The recursion-guard discussion from `docs/agentic-workflow.md` ("Choice: WORKFLOW_PAT for bot-PR CI gating") applies as-is.

**Concurrency group:** `aw-stage-ci-repair-${{ github.event.workflow_run.head_branch }}` with `cancel-in-progress: false`. One repair per branch at a time, queued not killed. This is the same pattern as the other aw-* workflows (see "Choice: shared `aw-stage-{stage}-{issue}` concurrency group" in `docs/agentic-workflow.md`).

### Pattern list (initial)

| Pattern | Detection | Repair | Auto? |
| --- | --- | --- | --- |
| **A — missing multiplier in test** | `expect(N).toBeLessThan(M)` in `e2e/**` or `src/perf/**`, N ≤ M*5, no `PERF_BUDGET_MULTIPLIER` reference in same expression | Wrap literal: `M * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1)` | ✅ |
| **B — missing env var in workflow job** | Detected as part of A; workflow yml job missing `PERF_BUDGET_MULTIPLIER` | Add `env: { PERF_BUDGET_MULTIPLIER: "3" }` to the failing step | ✅ (paired with A) |
| **C — snapshot drift** | `toMatchSnapshot` / `toMatchInlineSnapshot` failure | Comment: "Snapshot drift — needs human review" | ❌ |
| **D — DOM-changed assertion** | `Unable to find element with role/text "X"` | Comment: "Test asserts DOM that no longer exists — likely needs to follow a refactor in the same PR" | ❌ |
| **E — anything else** | Default | Comment: "Failure shape not in repair list" | ❌ |

The PRD ships with patterns A + B autofixing; C / D / E only post a comment and never touch code. Future PRDs may move C / D into auto-fix scope with explicit safety analysis per pattern.

### Why not a generic "fix the test" skill

The temptation is to give the LLM the failed log and let it figure out the fix. Three reasons that's worse:

1. **Loops.** A generic fixer that gets the diagnosis subtly wrong creates a new commit, CI fails differently, the fixer tries again, etc. The one-pattern-per-PRD scope structurally prevents this.
2. **Hiding regressions.** Snapshot updates and threshold bumps are the most-tempting low-effort fixes the LLM would propose, AND the most-dangerous to land silently. Forbidding them in the skill rules is more reliable than asking the LLM to be cautious.
3. **Auditability.** When repair fires, the human should be able to read the commit message ("Pattern A: missing multiplier in 1 file") and know what happened without diffing. Generic repair commits drift toward "fix tests" which is not auditable.

## UI/UX

This is pipeline infrastructure — there's no Notesage UI. The visible surface is the PR conversation:

- **On successful repair:** a new commit appears on the PR. The repair workflow posts a comment:
  > **🔧 Auto-repair applied — pattern A (missing PERF_BUDGET_MULTIPLIER)**
  >
  > File: `e2e/tests/preview-fidelity.spec.ts`
  > Failure: `expect(p95).toBeLessThan(500)` → observed 715 ms on CI macos-latest.
  > Fix: wrapped budget as `500 * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1)`.
  >
  > Linked failure: [Test #25652369214](https://...)
  >
  > CI will re-run automatically. If the same failure repeats, no further repair attempts will be made.
- **On unrepairable failure:** a single comment:
  > **❌ Auto-repair could not apply — pattern: snapshot drift**
  >
  > File: `src/components/__tests__/StatusTray.test.tsx`
  > This failure shape is not in the auto-repair list. A human reviewer should investigate.
  >
  > Linked failure: [Test #25652369214](https://...)
- **On a PR already at the one-attempt cap:** no comment, no action. The original repair comment + the persistent CI failure together signal "this needs human eyes" — no need to add more noise.

## Data Model

No new TypeScript interfaces or Zustand stores. Pure pipeline work.

New regression-lock test:

```ts
// src/lib/__tests__/no-bare-perf-budget.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { globSync } from "glob";

// Sibling shape to aw-workflow-pat.test.ts: walk a fixed file set, regex-parse,
// assert convention.
const PERF_FILES = [
  ...globSync("e2e/**/*.spec.ts"),
  ...globSync("src/perf/**/*.{ts,test.ts}"),
];

const MATCHERS = ["toBeLessThan", "toBeLessThanOrEqual", "toBeGreaterThan"];
const BARE_LITERAL = new RegExp(
  `\\.(?:${MATCHERS.join("|")})\\(\\s*(\\d+(?:\\.\\d+)?)\\s*\\)`,
  "g",
);

describe("perf-test budgets honor PERF_BUDGET_MULTIPLIER", () => {
  it.each(PERF_FILES)("%s uses scaled budgets", (file) => {
    const src = readFileSync(file, "utf8");
    const matches = [...src.matchAll(BARE_LITERAL)];
    expect(matches, `bare numeric budget in ${file} — wrap as N * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1)`)
      .toHaveLength(0);
  });
});
```

New skill file: `.claude/skills/aw-ci-repair/SKILL.md` (~120 lines, mirroring `aw-iterate`'s shape).

New workflow file: `.github/workflows/aw-ci-repair.yml` (~70 lines, mirroring `aw-iterate.yml`'s shape).

Regression-lock test: `src/lib/__tests__/aw-workflow-ci-repair.test.ts` — asserts the workflow's `if:` clause matches the documented gate (parallel to `aw-workflow-concurrency.test.ts` and `aw-workflow-pat.test.ts`).

## Dependencies

- **No new runtime libraries.** Custom ESLint rule uses the existing `@typescript-eslint/parser` AST shapes.
- **`WORKFLOW_PAT`** repo secret (already provisioned for aw-tdd / aw-iterate / aw-retrospect — see `docs/agentic-workflow.md` "Choice: WORKFLOW_PAT for bot-PR CI gating").
- **No new external services.** The skill only uses `gh` CLI + filesystem ops.

## Quality Gates

### Functional

- [ ] Regression-lock test `no-bare-perf-budget.test.ts` exists and fails when a bare numeric literal is the argument to `toBeLessThan` / `toBeLessThanOrEqual` / `toBeGreaterThan` inside `e2e/**` or `src/perf/**`.
- [ ] Test passes against current `main` (any existing tests with bare budgets are wrapped as part of the same PR — audit step lands first).
- [ ] Test runs as part of `pnpm test` (no new CI step needed).
- [ ] `aw-ci-repair` skill exists at `.claude/skills/aw-ci-repair/SKILL.md`.
- [ ] `aw-ci-repair.yml` workflow exists, triggers on `workflow_run.completed: failure`, gates on bot-authored draft PRs with `claude/*` branch prefix.
- [ ] On a synthetic PR with a missing-multiplier failure: skill applies pattern A, pushes one commit, CI re-runs, PR goes green.
- [ ] On a synthetic PR with a snapshot-drift failure: skill posts a comment naming pattern C and exits without touching files.
- [ ] One-attempt cap: synthetic PR with a repair commit already on the branch is ignored (no second repair).
- [ ] Concurrency group key matches the `aw-stage-{stage}-{branch}` convention; covered by the existing `aw-workflow-concurrency.test.ts` once the new workflow is added to its enumeration.
- [ ] `WORKFLOW_PAT` is used for the workflow's `github_token:` (covered by an extension to `aw-workflow-pat.test.ts`).

### Pipeline

- [ ] Repair commits are signed off with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (matches the rest of the AW pipeline's commit convention).
- [ ] Repair comments link to the failed run AND the human-readable pattern name.
- [ ] `aw-retrospect` is updated to recognise repair commits in merged PRs (so retros can count repair frequency per pattern and propose skill rule changes when a pattern fires often enough to suggest a different fix).

### Documentation

- [ ] `docs/agentic-workflow.md` is updated:
  - Pipeline overview diagram gets a "CI failure → aw-ci-repair → CI rerun" loop.
  - "Skills" table gets a row for `aw-ci-repair`.
  - "Workflows" table gets a row for `aw-ci-repair.yml`.
  - A new "Choice:" section explains the narrow-pattern scope and why generic repair is out of scope.
- [ ] `docs/architecture.md` doesn't need changes (this is process, not codebase).

### Design

- [ ] No Notesage UI changes; this section is N/A.

## Out of Scope

- **Auto-fixing snapshot drift** — explicit non-goal. Future PRD if signal warrants.
- **Auto-fixing DOM-changed assertions** — explicit non-goal. Requires reading the component diff in the same PR; closer to "re-implement" than to "repair".
- **Auto-fixing typecheck failures** — out of scope for v1. The shape is sometimes mechanical (`import { X }` from wrong path) but often non-trivial. Future PRD if pattern emerges.
- **Auto-fixing Rust test failures** — out of scope. Rust failures are rare in the AW pipeline (most aw-tdd work is frontend-heavy) and the failure shapes are less mechanical.
- **Auto-fixing on non-bot PRs** — humans can read their own failure logs.
- **More than one repair attempt per PR** — explicit non-goal. A second repair on a freshly-failed run risks loops.
- **A general-purpose "ask the LLM to fix any failing test" skill** — the whole point of this PRD is to NOT do that, on the grounds that auditability and bounded blast radius are more valuable than coverage.
- **Backfilling the multiplier wrap in existing passing tests** — the ESLint rule will flag them on next edit; no need for a mass-rewrite PR. (If `pnpm lint` fails immediately on landing, fix the specific files as part of the same PR; otherwise leave them alone.)
