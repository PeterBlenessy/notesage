# AW CI Repair — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-05-11 |
| **Status** | Not started |
| **PRD** | [aw-ci-repair](../prds/2026-05-11-aw-ci-repair.md) |
| **Total** | 14 tasks: 5S, 7M, 2L |
| **Suggested order** | M1 Prevention (#1 → #2 → #3) → M2 Skill body (#4 → #5) → M3 Workflow (#6 → #7) → M4 Regression locks (#8 → #9) → M5 Documentation (#10 → #11 → #12) → M6 Validation (#13 → #14) |

## Scope

Two tightly-coupled pieces from PRD §"Technical Approach":

1. **Prevention** — a vitest regression-lock test (`no-bare-perf-budget.test.ts`) that fails when a perf assertion uses a bare numeric literal as its threshold. Mirrors the existing `aw-workflow-*.test.ts` convention; no ESLint plumbing needed.
2. **Repair** — `aw-ci-repair` skill + `aw-ci-repair.yml` workflow. Triggered by `workflow_run.completed: failure` on a bot-authored draft PR; pattern-matches one of A–E, auto-fixes A+B, comments-and-exits on C–E. One repair attempt per PR.

The MVP scope is intentionally narrow: only Pattern A (missing `PERF_BUDGET_MULTIPLIER` wrap in test) and Pattern B (missing env var in workflow yml) are auto-fixed. C (snapshot drift), D (DOM-changed assertion), E (anything else) only post a comment.

## Risks and open questions

- **Sample size for repair triggers.** Right now we have ~2 known instances of the pattern (PR #191 `preview-fidelity.spec.ts`, alpha.0 release `status-tray.perf.test.ts`). If the bot rarely writes new perf assertions, the repair skill may sit idle for weeks. Prevention is the higher-leverage piece; repair is the existing-tail drain.
- **`workflow_run` payload reliability.** `workflow_run.pull_requests` is empty for cross-repo PRs and sometimes flaky for same-repo. The skill needs a `gh pr list --search "head:<branch>"` fallback. #6 must include this defensively.
- **One-attempt cap detection.** Counting prior `aw-ci-repair` comments is a robust signal, but if the bot's own follow-up commits trigger a fresh `workflow_run.failure`, we don't want to re-attempt. The check needs to look for ANY prior repair commit OR comment, not just comment.
- **False positives on pattern A.** "test failed at 715ms against 500ms" looks like pattern A, but could be a genuine 1.4x regression. The skill's safety net is: it ONLY adds the multiplier wrap, never bumps the threshold. The threshold stays put; if there's an actual regression, the multiplied budget (1500ms) is still exceeded and CI fails again — at which point the one-attempt cap kicks in and the human sees the failure.
- **ESLint deferred.** PRD originally proposed ESLint; downgraded to vitest regression-lock because the project doesn't have ESLint set up. If ESLint is added for other reasons later, this rule should migrate to a proper ESLint plugin.

---

## M1 — Prevention layer (3 tasks)

### #1 — Audit existing perf assertions and wrap bare budgets

| Field | Value |
| --- | --- |
| Description | Walk `e2e/**/*.spec.ts` and `src/perf/**/*.ts` for `expect(...).toBeLessThan(<number>)`, `toBeLessThanOrEqual`, and `toBeGreaterThan` calls. For each call where the argument is a bare numeric literal, wrap it: `N * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1)`. Note: `c43b286a` already wrapped `preview-fidelity.spec.ts:331`. Other suspected sites: `src/perf/*.perf.test.ts` may pass budgets via the `benchmark()` helper which already honors the multiplier — verify. Goal of this task is "no bare literals remain", not "rewrite the assertions". Run `pnpm test:perf` and `pnpm test:e2e` locally to confirm nothing breaks. |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `e2e/**/*.spec.ts`, `src/perf/**/*.ts` (audit only — list files actually changed in commit message) |

### #2 — Add `no-bare-perf-budget.test.ts` regression-lock

| Field | Value |
| --- | --- |
| Description | New vitest regression-lock at `src/lib/__tests__/no-bare-perf-budget.test.ts`. Walk `e2e/**/*.spec.ts` and `src/perf/**/*.{ts,test.ts}` via `globSync`. For each file, regex-scan for `\.(toBeLessThan\|toBeLessThanOrEqual\|toBeGreaterThan)\(\s*(\d+(?:\.\d+)?)\s*\)` — bare numeric argument. Assert zero matches per file. Failure message names the file and tells the reader to wrap as `N * (Number(process.env.PERF_BUDGET_MULTIPLIER) || 1)`. Mirror the shape of `src/lib/__tests__/aw-workflow-pat.test.ts` for consistency. Include 1–2 in-test negative-control snippets that demonstrate the regex catches the bad shape AND skips the good shape (multiplied literal, identifier reference). Skip files matching a documented allowlist if any genuinely-fixed budgets exist (e.g. a `setTimeout` target inside a `page.evaluate`); allowlist must be in the test file with a comment explaining each entry. |
| Complexity | M |
| Category | frontend |
| Depends on | #1 |
| Files | `src/lib/__tests__/no-bare-perf-budget.test.ts` (new) |

### #3 — Verify `pnpm test` includes the new lock

| Field | Value |
| --- | --- |
| Description | Run `pnpm test` and confirm `no-bare-perf-budget.test.ts` is picked up. Notesage's default `vitest.config.ts` excludes `src/perf/**` from the main run — confirm `src/lib/__tests__/no-bare-perf-budget.test.ts` lands in the main suite. No new CI step needed; the test runs alongside the existing `aw-workflow-*` regression locks. Verify the test fails on a synthetic bad file (temporarily revert one of the wraps from #1, confirm red, re-apply). |
| Complexity | S |
| Category | frontend |
| Depends on | #2 |
| Files | `vitest.config.ts` (read-only verification), test runs locally |

---

## M2 — `aw-ci-repair` skill body (2 tasks)

### #4 — Create `.claude/skills/aw-ci-repair/SKILL.md`

| Field | Value |
| --- | --- |
| Description | New skill file mirroring the shape of `aw-iterate/SKILL.md`. Frontmatter: `name: aw-ci-repair` + `description:` line. Body covers: (a) when to use vs when to defer (only on bot-authored draft PRs with a `claude/*` branch, only when CI failure shape matches A or B, only when no prior repair attempt has been made); (b) inputs (`PR_NUMBER`, `RUN_ID`, failed-log excerpt); (c) pre-flight bash (verify draft + bot, count prior repair comments/commits, fetch + grep the failed log); (d) pattern list (A–E with detection + repair instructions); (e) hard gates (`pnpm typecheck`, targeted failing spec, ≤2 files modified, no force-push); (f) commit message + comment templates with the documented "🔧 Auto-repair applied" / "❌ Auto-repair could not apply" shapes from the PRD; (g) bot identity (uses `WORKFLOW_PAT` for the push so CI re-runs naturally — same as aw-tdd / aw-iterate). |
| Complexity | L |
| Category | tooling |
| Depends on | none (skill body is self-contained markdown) |
| Files | `.claude/skills/aw-ci-repair/SKILL.md` (new) |

### #5 — Pattern A + B implementation guidance in SKILL.md

| Field | Value |
| --- | --- |
| Description | Inside the SKILL.md body, write the concrete recipe for patterns A and B as numbered steps the LLM agent will follow. Pattern A: identify the failing assertion line from the log; verify the file is in `e2e/**` or `src/perf/**`; confirm the bare-literal shape; apply the wrap via the `Edit` tool with surgical `old_string` / `new_string`; verify the targeted spec passes (`pnpm vitest run <file>` or `pnpm test:e2e <file>`); commit + push. Pattern B: after applying A, read the workflow yml that ran the failing job; if the `PERF_BUDGET_MULTIPLIER` env var is missing on the step that runs the test, add `env: { PERF_BUDGET_MULTIPLIER: "3" }` (matching the value used in `test.yml`'s frontend job). Bundle A + B in the same commit. Document the specific `gh run view --log-failed` parsing recipe — the failure log shape from PR #191 is the reference. Reference the actual fix that landed in `c43b286a` as the worked example. |
| Complexity | M |
| Category | tooling |
| Depends on | #4 |
| Files | `.claude/skills/aw-ci-repair/SKILL.md` |

---

## M3 — Workflow file (2 tasks)

### #6 — Create `.github/workflows/aw-ci-repair.yml`

| Field | Value |
| --- | --- |
| Description | New workflow mirroring `aw-iterate.yml`'s shape. Trigger: `workflow_run.completed` on the workflows we care about (initial list: `Test`, optionally `Release`) + `workflow_dispatch` with `pr_number` input. Job-level `if:` clause: dispatched events always pass; `workflow_run` events pass only when `conclusion == 'failure'` AND `event == 'pull_request'` AND `head_branch` starts with `claude/`. Resolve the PR number defensively: `workflow_run.pull_requests[0]` first, fall back to `gh pr list --search "head:<branch>"` if empty. Permissions block: `contents: write`, `pull-requests: write`, `actions: read`, `id-token: write`. `concurrency.group` = `aw-stage-ci-repair-${{ github.event.workflow_run.head_branch || github.run_id }}` with `cancel-in-progress: false`. claude-code-action step: `github_token: ${{ secrets.WORKFLOW_PAT }}` (PR-creating workflow per Choice: WORKFLOW_PAT for bot-PR CI gating). `--allowedTools` includes Bash(gh:*), Bash(grep:*), Bash(rg:*), Read, Edit, Write, Glob — repair needs Edit and Write that aw-review doesn't. `--max-turns 40` is sufficient given the narrow pattern set. |
| Complexity | M |
| Category | tooling |
| Depends on | #4 (skill must exist for the workflow to invoke) |
| Files | `.github/workflows/aw-ci-repair.yml` (new) |

### #7 — Workflow prompt body + hard-constraint reminders

| Field | Value |
| --- | --- |
| Description | The `prompt:` block in `aw-ci-repair.yml` invokes the skill and restates the hard constraints (same convention as `aw-review.yml:65-86`). Constraints to restate: (a) only patterns A and B may modify files; (b) ≤2 files per commit; (c) never `--force` push; (d) one repair attempt per PR — abort if a prior repair comment OR commit exists; (e) `pnpm typecheck` AND the targeted spec MUST pass before commit; (f) the commit message MUST name the pattern and link to the failed run. Include the run id, branch, and resolved PR number as variables interpolated into the prompt. |
| Complexity | S |
| Category | tooling |
| Depends on | #6 |
| Files | `.github/workflows/aw-ci-repair.yml` |

---

## M4 — Regression locks (2 tasks)

### #8 — Add `aw-ci-repair.yml` to existing aw-workflow-*.test.ts files

| Field | Value |
| --- | --- |
| Description | Extend the three existing AW workflow regression-lock tests so they enumerate the new workflow: (a) `aw-workflow-concurrency.test.ts` — assert the workflow has `concurrency.group` matching `aw-stage-ci-repair-*` and `cancel-in-progress: false`; (b) `aw-workflow-pat.test.ts` — assert the claude-code-action step uses `${{ secrets.WORKFLOW_PAT }}` (this is a PR-modifying workflow per "Choice: WORKFLOW_PAT for bot-PR CI gating"); (c) `aw-workflow-defensive-checks.test.ts` — extend whatever scope this lock covers to include the new workflow. Walk each test, find the file-list constant or pattern that enumerates workflows, add `aw-ci-repair.yml`. |
| Complexity | S |
| Category | frontend |
| Depends on | #6 |
| Files | `src/lib/__tests__/aw-workflow-concurrency.test.ts`, `src/lib/__tests__/aw-workflow-pat.test.ts`, `src/lib/__tests__/aw-workflow-defensive-checks.test.ts` |

### #9 — Dedicated `aw-ci-repair-shape.test.ts` regression lock

| Field | Value |
| --- | --- |
| Description | New `src/lib/__tests__/aw-ci-repair-shape.test.ts` that asserts properties specific to this workflow: (a) trigger includes `workflow_run.completed` AND `workflow_dispatch`; (b) `if:` clause checks `conclusion == 'failure'` AND branch prefix `claude/`; (c) one-attempt cap is documented in the SKILL.md body (regex-search the skill markdown for "one attempt" or "≤1 repair"); (d) pattern list covers A, B (autofix) AND C, D, E (comment-only). Mirror the shape of `aw-author-association-gate.test.ts`. |
| Complexity | M |
| Category | frontend |
| Depends on | #4, #6 |
| Files | `src/lib/__tests__/aw-ci-repair-shape.test.ts` (new) |

---

## M5 — Documentation (3 tasks)

### #10 — Update `docs/agentic-workflow.md` pipeline diagram + tables

| Field | Value |
| --- | --- |
| Description | Add `aw-ci-repair` to (a) the mermaid pipeline overview as a "CI failure → aw-ci-repair → CI rerun" branch from the Draft PR node; (b) the Skills table (one row, mirroring the aw-iterate row); (c) the Workflows table (one row). Update the workflow count from "ten workflows" to "eleven" wherever it appears. |
| Complexity | M |
| Category | docs |
| Depends on | #4, #6 |
| Files | `docs/agentic-workflow.md` |

### #11 — New "Choice:" section explaining the narrow-pattern scope

| Field | Value |
| --- | --- |
| Description | Add a new "Choice: narrow-pattern auto-repair (#TBD)" subsection under "Design choices and rationale" in `docs/agentic-workflow.md`. Explain: (a) the recurring failure pattern (missing `PERF_BUDGET_MULTIPLIER`); (b) why generic "fix any failing test" repair is rejected (loops, hiding regressions, auditability); (c) why patterns C/D/E are comment-only; (d) the one-attempt cap rationale. Mirror the tone of "Choice: WORKFLOW_PAT for bot-PR CI gating" — problem statement, fix, side effects, knock-on changes, regression-lock reference. |
| Complexity | M |
| Category | docs |
| Depends on | #10 |
| Files | `docs/agentic-workflow.md` |

### #12 — Teach `aw-retrospect` to recognise repair commits

| Field | Value |
| --- | --- |
| Description | Update `.claude/skills/aw-retrospect/SKILL.md` so the retrospect agent knows about repair commits and can include them as signal. Specifically: the merge-commit history walk should recognise commits authored by the WORKFLOW_PAT owner with subject starting `fix(ci): honour PERF_BUDGET_MULTIPLIER` and treat repeated occurrences as a "this pattern is firing often — consider a different skill rule" signal. No code in `aw-retrospect` itself (it's a markdown skill) — just instruction updates so the LLM picks the pattern up. |
| Complexity | S |
| Category | tooling |
| Depends on | #4 |
| Files | `.claude/skills/aw-retrospect/SKILL.md` |

---

## M6 — Validation (2 tasks)

### #13 — Live validation via synthetic failure

| Field | Value |
| --- | --- |
| Description | After M1–M5 land on `main`, validate end-to-end by opening a synthetic PR that contains a bare-literal perf assertion. Branch name must be `claude/<something>` so the gate fires. Push → CI should fail on `no-bare-perf-budget.test.ts` FIRST (prevention layer catches it before runtime). Force the perf assertion to fail at runtime by setting an unreachable budget (e.g. `expect(p95).toBeLessThan(1)`) — confirm `aw-ci-repair` fires, applies the wrap, pushes a commit, CI re-runs. Document the validation run in `.claude/skill-feedback.md` for future retros. Close the synthetic PR afterward; do not merge. |
| Complexity | L |
| Category | tooling |
| Depends on | #1–#12 (everything must be on main) |
| Files | synthetic test PR (closed after validation) |

### #14 — Pattern C (snapshot drift) validation

| Field | Value |
| --- | --- |
| Description | Second validation: open a `claude/*` PR that modifies a snapshot test so the snapshot fails. Verify `aw-ci-repair` posts the documented "❌ Auto-repair could not apply — pattern: snapshot drift" comment AND makes zero file changes. Close the synthetic PR without merging. Document in `.claude/skill-feedback.md`. |
| Complexity | M |
| Category | tooling |
| Depends on | #13 |
| Files | synthetic test PR (closed after validation) |

---

## Done definition

- All 14 tasks marked ✅
- `pnpm test` passes including the new `no-bare-perf-budget.test.ts` and `aw-ci-repair-shape.test.ts`
- `docs/agentic-workflow.md` reflects the new skill + workflow + Choice section
- Two live validation runs documented (#13 + #14)
- Repair commit subject convention (`fix(ci): honour PERF_BUDGET_MULTIPLIER`) is documented in `aw-retrospect`'s SKILL.md so retros count occurrences over time
